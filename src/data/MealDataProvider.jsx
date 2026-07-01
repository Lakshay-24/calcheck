import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { calculateDailyTotals, getMealLogsForLocalDateRange, getMealLogsToday } from '../services/database'
import { logAppEvent } from '../utils/appDiagnostics'
import { getErrorMessage, isAbortError } from '../utils/errorUtils'
import { getLocalDate, getUserTimezone, parseDatabaseTimestamp } from '../utils/timezone'
import { onMealSaved } from '../utils/mealEvents'

const STATUS = {
  IDLE: 'idle',
  INITIAL_LOADING: 'initialLoading',
  READY: 'ready',
  REFRESHING: 'refreshing',
  STALE: 'stale',
  ERROR: 'error',
  RETRYING: 'retrying'
}

const EMPTY_TOTALS = { calories: 0, protein: 0, carbs: 0, fat: 0 }
const RESUME_REFRESH_DEBOUNCE_MS = 1200

const MealDataContext = createContext(null)

const initialState = {
  queries: {},
  activeQueries: {}
}

export function MealDataProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  const inFlightRef = useRef(new Map())
  const resumeRefreshRef = useRef(new Map())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const setActiveQuery = useCallback((key, details) => {
    if (!key) return () => {}
    dispatch({ type: 'REGISTER_ACTIVE_QUERY', key, details })
    return () => dispatch({ type: 'UNREGISTER_ACTIVE_QUERY', key })
  }, [])

  const refreshQuery = useCallback(async ({ key, fetcher, reason = 'manual', force = false, retry = false }) => {
    if (!key || typeof fetcher !== 'function') return null

    const now = Date.now()
    if (reason === 'app-resume') {
      const previousResumeAt = resumeRefreshRef.current.get(key) || 0
      if (!force && now - previousResumeAt < RESUME_REFRESH_DEBOUNCE_MS) {
        console.info('[CalCheck] APP_RESUME_MEAL_REFRESH_DEBOUNCED', { key, reason })
        logAppEvent('APP_RESUME_MEAL_REFRESH_DEBOUNCED', {
          level: 'info',
          operation: 'meal query refresh',
          metadata: { key, reason }
        })
        return inFlightRef.current.get(key) || getQuery(stateRef.current, key)
      }
      resumeRefreshRef.current.set(key, now)
    }

    if (!force && inFlightRef.current.has(key)) {
      console.info('[CalCheck] MEAL_QUERY_REFRESH_DEDUPED', { key, reason })
      return inFlightRef.current.get(key)
    }

    const previous = getQuery(stateRef.current, key)
    const requestVersion = (previous?.requestVersion || 0) + 1
    dispatch({ type: 'QUERY_START', key, requestVersion, reason, retry })

    const requestPromise = (async () => {
      try {
        const data = await fetcher()
        if (!Array.isArray(data)) {
          console.warn('[CalCheck] REFRESH_FALLBACK_NOT_COMMITTED', {
            key,
            reason,
            requestVersion,
            result_type: typeof data
          })
          logAppEvent('REFRESH_FALLBACK_NOT_COMMITTED', {
            level: 'warn',
            operation: 'meal query refresh',
            metadata: { key, reason, requestVersion, result_type: typeof data }
          })
          throw new Error('Meal refresh did not return confirmed data.')
        }

        const latest = getQuery(stateRef.current, key)
        if (latest?.requestVersion !== requestVersion) {
          console.info('[CalCheck] REFRESH_RESULT_DISCARDED_STALE', {
            key,
            reason,
            requestVersion,
            latestVersion: latest?.requestVersion || null
          })
          logAppEvent('REFRESH_RESULT_DISCARDED_STALE', {
            level: 'info',
            operation: 'meal query refresh',
            metadata: { key, reason, requestVersion, latestVersion: latest?.requestVersion || null }
          })
          return latest
        }

        if (reason === 'meal-saved' && Array.isArray(latest?.data) && latest.data.length > data.length) {
          logAppEvent('MEAL_SAVE_REFETCH_MERGED_WITH_OPTIMISTIC_CACHE', {
            level: 'info',
            operation: 'meal save forced refetch',
            metadata: { key, requestVersion, previous_count: latest.data.length, fetched_count: data.length }
          })
        }

        dispatch({ type: 'QUERY_SUCCESS', key, requestVersion, data, reason })
        console.info('[CalCheck] MEAL_CACHE_UPDATED', {
          key,
          reason,
          requestVersion,
          count: data.length
        })
        logAppEvent('MEAL_CACHE_UPDATED', {
          level: 'info',
          operation: 'meal query refresh',
          metadata: { key, reason, requestVersion, count: data.length }
        })
        return getQuery(stateRef.current, key)
      } catch (error) {
        const latest = getQuery(stateRef.current, key)
        if (latest?.requestVersion !== requestVersion) {
          console.info('[CalCheck] REFRESH_RESULT_DISCARDED_STALE', {
            key,
            reason,
            requestVersion,
            latestVersion: latest?.requestVersion || null,
            failed: true
          })
          logAppEvent('REFRESH_RESULT_DISCARDED_STALE', {
            level: 'info',
            operation: 'meal query refresh',
            metadata: { key, reason, requestVersion, latestVersion: latest?.requestVersion || null, failed: true }
          })
          return latest
        }

        const hadData = hasQueryData(latest)
        dispatch({ type: 'QUERY_ERROR', key, requestVersion, error, reason })
        if (hadData) {
          console.info('[CalCheck] MEAL_QUERY_BACKGROUND_REFRESH_FAILED_STALE_PRESERVED', {
            key,
            reason,
            requestVersion
          })
          logAppEvent('MEAL_QUERY_BACKGROUND_REFRESH_FAILED_STALE_PRESERVED', {
            level: 'warn',
            operation: 'meal query refresh',
            metadata: { key, reason, requestVersion }
          })
        }
        return getQuery(stateRef.current, key)
      } finally {
        if (inFlightRef.current.get(key) === requestPromise) {
          inFlightRef.current.delete(key)
        }
      }
    })()

    inFlightRef.current.set(key, requestPromise)
    return requestPromise
  }, [])

  const refreshToday = useCallback(({ userId, timezone = getUserTimezone(), localDate, reason = 'manual', force = false, retry = false } = {}) => {
    if (!userId) return Promise.resolve(null)
    const targetLocalDate = localDate || getLocalDate(new Date(), timezone)
    const key = getTodayQueryKey(userId, targetLocalDate)
    console.info('[CalCheck] SCAN_TODAY_QUERY_KEY', { key, local_date: targetLocalDate, reason })
    return refreshQuery({
      key,
      reason,
      force,
      retry,
      fetcher: () => getMealLogsToday(userId, timezone)
    })
  }, [refreshQuery])

  const refreshWeek = useCallback(({ userId, weekRange, timezone = getUserTimezone(), reason = 'manual', force = false, retry = false } = {}) => {
    if (!userId || !weekRange?.startLocalDate || !weekRange?.endLocalDate) return Promise.resolve(null)
    const key = getWeekQueryKey(userId, weekRange.startLocalDate, weekRange.endLocalDate)
    console.info('[CalCheck] PROGRESS_WEEK_QUERY_KEY', {
      key,
      week_start: weekRange.startLocalDate,
      week_end: weekRange.endLocalDate,
      reason
    })
    return refreshQuery({
      key,
      reason,
      force,
      retry,
      fetcher: () => getMealLogsForLocalDateRange(
        userId,
        weekRange.startLocalDate,
        weekRange.endLocalDate,
        timezone
      )
    })
  }, [refreshQuery])

  const mergeSavedMealIntoCache = useCallback((savedMeal, reason = 'meal-saved') => {
    if (!savedMeal?.id || !savedMeal?.user_id) return

    const mealLocalDate = getMealLocalDate(savedMeal)
    const activeQueries = stateRef.current.activeQueries || {}
    let mergedCount = 0

    Object.entries(activeQueries).forEach(([key, details]) => {
      if (!shouldMergeMealIntoQuery(savedMeal, mealLocalDate, details)) return
      dispatch({ type: 'MERGE_MEAL', key, meal: savedMeal, reason })
      mergedCount += 1
    })

    console.info('[CalCheck] MEAL_SAVE_CACHE_MERGED', {
      meal_id: savedMeal.id,
      local_date: mealLocalDate,
      merged_queries: mergedCount
    })
    logAppEvent('MEAL_SAVE_CACHE_MERGED', {
      level: 'info',
      operation: 'meal save cache merge',
      metadata: { meal_id: savedMeal.id, local_date: mealLocalDate, merged_queries: mergedCount }
    })

    Object.entries(activeQueries).forEach(([key, details]) => {
      if (!details?.userId || details.userId !== savedMeal.user_id) return
      console.info('[CalCheck] MEAL_SAVE_FORCED_REFETCH_STARTED', { key, meal_id: savedMeal.id })
      logAppEvent('MEAL_SAVE_FORCED_REFETCH_STARTED', {
        level: 'info',
        operation: 'meal save forced refetch',
        metadata: { key, meal_id: savedMeal.id }
      })

      const refreshPromise = details.type === 'today'
        ? refreshToday({
            userId: details.userId,
            timezone: details.timezone,
            localDate: details.localDate,
            reason: 'meal-saved',
            force: true
          })
        : refreshWeek({
            userId: details.userId,
            timezone: details.timezone,
            weekRange: {
              startLocalDate: details.startLocalDate,
              endLocalDate: details.endLocalDate
            },
            reason: 'meal-saved',
            force: true
          })

      refreshPromise
        .then(() => {
          console.info('[CalCheck] MEAL_SAVE_FORCED_REFETCH_SUCCESS', { key, meal_id: savedMeal.id })
          logAppEvent('MEAL_SAVE_FORCED_REFETCH_SUCCESS', {
            level: 'info',
            operation: 'meal save forced refetch',
            metadata: { key, meal_id: savedMeal.id }
          })
        })
        .catch((error) => {
          console.warn('[CalCheck] MEAL_SAVE_FORCED_REFETCH_FAILED_STALE_PRESERVED', {
            key,
            meal_id: savedMeal.id,
            error: getErrorMessage(error, 'Could not refresh meals.')
          })
          logAppEvent('MEAL_SAVE_FORCED_REFETCH_FAILED_STALE_PRESERVED', {
            level: 'warn',
            operation: 'meal save forced refetch',
            metadata: { key, meal_id: savedMeal.id, error: getErrorMessage(error, 'Could not refresh meals.') }
          })
        })
    })
  }, [refreshToday, refreshWeek])

  useEffect(() => onMealSaved((savedMeal) => {
    if (!savedMeal) return
    console.info('[CalCheck] MEAL_CACHE_INVALIDATED_AFTER_SAVE', {
      meal_id: savedMeal.id || null,
      local_date: savedMeal.local_date || null
    })
    logAppEvent('MEAL_CACHE_INVALIDATED_AFTER_SAVE', {
      level: 'info',
      operation: 'meal save invalidation',
      metadata: { meal_id: savedMeal.id || null, local_date: savedMeal.local_date || null }
    })
    mergeSavedMealIntoCache(savedMeal, 'meal-saved-event')
  }), [mergeSavedMealIntoCache])

  const invalidateMeals = useCallback((reason = 'manual') => {
    console.info('[CalCheck] MEAL_CACHE_INVALIDATED', { reason })
    logAppEvent('MEAL_CACHE_INVALIDATED', {
      level: 'info',
      operation: 'meal cache invalidation',
      metadata: { reason }
    })
    dispatch({ type: 'MARK_ALL_STALE', reason })
  }, [])

  const getMealCacheSnapshot = useCallback(() => stateRef.current.queries, [])

  const value = useMemo(() => ({
    queries: state.queries,
    activeQueries: state.activeQueries,
    setActiveQuery,
    refreshToday,
    refreshWeek,
    mergeSavedMealIntoCache,
    invalidateMeals,
    getMealCacheSnapshot
  }), [
    state.queries,
    state.activeQueries,
    setActiveQuery,
    refreshToday,
    refreshWeek,
    mergeSavedMealIntoCache,
    invalidateMeals,
    getMealCacheSnapshot
  ])

  return <MealDataContext.Provider value={value}>{children}</MealDataContext.Provider>
}

export function useMealData() {
  const value = useContext(MealDataContext)
  if (!value) throw new Error('useMealData must be used inside MealDataProvider')
  return value
}

export function useTodayMeals(userId, { timezone = getUserTimezone(), resumeSignal = 0 } = {}) {
  const { queries, setActiveQuery, refreshToday } = useMealData()
  const localDate = getLocalDate(new Date(), timezone)
  const key = userId ? getTodayQueryKey(userId, localDate) : null
  const query = getQueryFromMap(queries, key)

  useEffect(() => {
    if (!userId || !key) return undefined
    return setActiveQuery(key, { type: 'today', userId, timezone, localDate })
  }, [key, localDate, setActiveQuery, timezone, userId])

  useEffect(() => {
    if (!userId || !key) return
    refreshToday({ userId, timezone, localDate, reason: 'screen-load' })
  }, [key, localDate, refreshToday, timezone, userId])

  useEffect(() => {
    if (!resumeSignal || !userId || !key) return
    refreshToday({ userId, timezone, localDate, reason: 'app-resume' })
  }, [key, localDate, refreshToday, resumeSignal, timezone, userId])

  return useMemo(() => ({
    key,
    query,
    meals: query.data,
    totals: calculateDailyTotals(query.data),
    refresh: (options = {}) => refreshToday({ userId, timezone, localDate, ...options }),
    hasData: query.data.length > 0,
    isInitialLoading: query.status === STATUS.INITIAL_LOADING,
    isRefreshing: query.status === STATUS.REFRESHING,
    isRetrying: query.status === STATUS.RETRYING,
    isStale: query.isStale,
    error: query.error
  }), [key, localDate, query, refreshToday, timezone, userId])
}

export function useWeekMeals(userId, weekRange, { timezone = getUserTimezone(), resumeSignal = 0 } = {}) {
  const { queries, setActiveQuery, refreshWeek } = useMealData()
  const key = userId && weekRange?.startLocalDate && weekRange?.endLocalDate
    ? getWeekQueryKey(userId, weekRange.startLocalDate, weekRange.endLocalDate)
    : null
  const query = getQueryFromMap(queries, key)

  useEffect(() => {
    if (!userId || !key || !weekRange?.startLocalDate || !weekRange?.endLocalDate) return undefined
    return setActiveQuery(key, {
      type: 'week',
      userId,
      timezone,
      startLocalDate: weekRange.startLocalDate,
      endLocalDate: weekRange.endLocalDate
    })
  }, [key, setActiveQuery, timezone, userId, weekRange?.endLocalDate, weekRange?.startLocalDate])

  useEffect(() => {
    if (!userId || !key) return
    refreshWeek({ userId, weekRange, timezone, reason: 'screen-load' })
  }, [key, refreshWeek, timezone, userId, weekRange])

  useEffect(() => {
    if (!resumeSignal || !userId || !key) return
    refreshWeek({ userId, weekRange, timezone, reason: 'app-resume' })
  }, [key, refreshWeek, resumeSignal, timezone, userId, weekRange])

  return useMemo(() => ({
    key,
    query,
    meals: query.data,
    refresh: (options = {}) => refreshWeek({ userId, weekRange, timezone, ...options }),
    hasData: query.data.length > 0,
    isInitialLoading: query.status === STATUS.INITIAL_LOADING,
    isRefreshing: query.status === STATUS.REFRESHING,
    isRetrying: query.status === STATUS.RETRYING,
    isStale: query.isStale,
    error: query.error
  }), [key, query, refreshWeek, timezone, userId, weekRange])
}

export function getTodayQueryKey(userId, localDate) {
  return userId && localDate ? `today:${userId}:${localDate}` : null
}

export function getWeekQueryKey(userId, startLocalDate, endLocalDate) {
  return userId && startLocalDate && endLocalDate ? `week:${userId}:${startLocalDate}:${endLocalDate}` : null
}


function reducer(state, action) {
  switch (action.type) {
    case 'REGISTER_ACTIVE_QUERY':
      return {
        ...state,
        activeQueries: {
          ...state.activeQueries,
          [action.key]: action.details
        }
      }
    case 'UNREGISTER_ACTIVE_QUERY': {
      const next = { ...state.activeQueries }
      delete next[action.key]
      return { ...state, activeQueries: next }
    }
    case 'QUERY_START': {
      const previous = getQuery(state, action.key)
      const hasData = hasQueryData(previous)
      const status = action.retry
        ? STATUS.RETRYING
        : hasData
        ? STATUS.REFRESHING
        : STATUS.INITIAL_LOADING
      const nextQuery = {
        ...previous,
        status,
        error: null,
        lastAttemptAt: new Date().toISOString(),
        requestVersion: action.requestVersion,
        isStale: hasData && previous.isStale
      }
      logStateChanged(action.key, previous, nextQuery, action.reason)
      return setQuery(state, action.key, nextQuery)
    }
    case 'QUERY_SUCCESS': {
      const previous = getQuery(state, action.key)
      if (previous.requestVersion !== action.requestVersion) return state
      const nextData = action.reason === 'meal-saved'
        ? mergeMealLists(previous.data || [], action.data || [])
        : action.data
      const nextQuery = {
        ...previous,
        data: nextData,
        status: STATUS.READY,
        error: null,
        lastSuccessfulAt: new Date().toISOString(),
        lastAttemptAt: previous.lastAttemptAt || new Date().toISOString(),
        isStale: false
      }
      logStateChanged(action.key, previous, nextQuery, action.reason)
      return setQuery(state, action.key, nextQuery)
    }
    case 'QUERY_ERROR': {
      const previous = getQuery(state, action.key)
      if (previous.requestVersion !== action.requestVersion) return state
      const hasData = hasQueryData(previous)
      const nextQuery = {
        ...previous,
        status: hasData ? STATUS.STALE : STATUS.ERROR,
        error: getFriendlyError(action.error),
        lastAttemptAt: previous.lastAttemptAt || new Date().toISOString(),
        isStale: hasData
      }
      logStateChanged(action.key, previous, nextQuery, action.reason)
      return setQuery(state, action.key, nextQuery)
    }
    case 'MERGE_MEAL': {
      const previous = getQuery(state, action.key)
      const nextData = mergeMeal(previous.data || [], action.meal)
      const nextQuery = {
        ...previous,
        data: nextData,
        status: STATUS.READY,
        error: null,
        lastSuccessfulAt: previous.lastSuccessfulAt || new Date().toISOString(),
        isStale: true
      }
      logStateChanged(action.key, previous, nextQuery, action.reason)
      return setQuery(state, action.key, nextQuery)
    }
    case 'MARK_ALL_STALE': {
      const queries = Object.entries(state.queries).reduce((next, [key, query]) => {
        next[key] = hasQueryData(query)
          ? { ...query, status: STATUS.STALE, isStale: true }
          : query
        return next
      }, {})
      return { ...state, queries }
    }
    default:
      return state
  }
}

function getQueryFromMap(queries, key) {
  return key && queries[key] ? queries[key] : createEmptyQuery()
}

function getQuery(state, key) {
  return getQueryFromMap(state.queries || {}, key)
}

function setQuery(state, key, query) {
  return {
    ...state,
    queries: {
      ...state.queries,
      [key]: query
    }
  }
}

function createEmptyQuery() {
  return {
    data: [],
    status: STATUS.IDLE,
    error: null,
    lastSuccessfulAt: null,
    lastAttemptAt: null,
    isStale: false,
    requestVersion: 0
  }
}

function hasQueryData(query) {
  return Array.isArray(query?.data) && query.data.length > 0
}

function mergeMeal(mealLogs, savedMeal) {
  const existing = Array.isArray(mealLogs) ? mealLogs : []
  const withoutSavedMeal = existing.filter((meal) => meal.id !== savedMeal.id)
  return sortMealsNewestFirst([savedMeal, ...withoutSavedMeal])
}

function mergeMealLists(existingMeals, fetchedMeals) {
  const mergedById = new Map()
  const fetched = Array.isArray(fetchedMeals) ? fetchedMeals : []
  const existing = Array.isArray(existingMeals) ? existingMeals : []

  fetched.forEach((meal) => {
    if (meal?.id) mergedById.set(meal.id, meal)
  })

  existing.forEach((meal) => {
    if (meal?.id && !mergedById.has(meal.id)) mergedById.set(meal.id, meal)
  })

  return sortMealsNewestFirst(Array.from(mergedById.values()))
}

function sortMealsNewestFirst(meals) {
  return meals.sort((a, b) =>
    parseDatabaseTimestamp(b.timestamp).getTime() - parseDatabaseTimestamp(a.timestamp).getTime()
  )
}

function shouldMergeMealIntoQuery(savedMeal, mealLocalDate, details) {
  if (!details || details.userId !== savedMeal.user_id) return false
  if (details.type === 'today') return mealLocalDate === details.localDate
  if (details.type === 'week') return mealLocalDate >= details.startLocalDate && mealLocalDate <= details.endLocalDate
  return false
}

function getMealLocalDate(meal) {
  const timezone = meal?.timezone || getUserTimezone()
  return meal?.local_date || getLocalDate(parseDatabaseTimestamp(meal?.timestamp), timezone)
}

function getFriendlyError(error) {
  if (!error) return 'Could not refresh meals.'
  if (isAbortError(error)) return ''
  return getErrorMessage(error, 'Could not refresh meals.')
}

function logStateChanged(key, previous, next, reason) {
  if (!key || previous.status === next.status && previous.isStale === next.isStale && previous.data === next.data) return
  const metadata = {
    key,
    reason,
    previous_status: previous.status,
    next_status: next.status,
    is_stale: next.isStale,
    count: next.data?.length || 0,
    requestVersion: next.requestVersion
  }
  console.info('[CalCheck] MEAL_QUERY_STATE_CHANGED', metadata)
  logAppEvent('MEAL_QUERY_STATE_CHANGED', {
    level: 'info',
    operation: 'meal query state',
    metadata
  })
}

export const EMPTY_MEAL_TOTALS = EMPTY_TOTALS
