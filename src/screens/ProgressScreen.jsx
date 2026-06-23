import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getMealLogsToday,
  getMealLogsForLocalDateRange,
  getFirstMealLog,
  calculateDailyTotals,
  calculateWeeklyBreakdown,
  getUserProfile
} from '../services/database'
import { recordPerformanceMetric, recordStartupStep, trackApiRequest, trackStartupStep } from '../services/diagnostics'
import { createLifecycleAbortController, getLifecycleGeneration, recordAppLifecycleEvent } from '../services/lifecycle'
import { getLocalDate, getUserTimezone, getUserWeekRange, parseDatabaseTimestamp } from '../utils/timezone'
import { onMealSaved } from '../utils/mealEvents'
import { getErrorMessage, logSafeError } from '../utils/errorUtils'
import { getNutritionQuality } from '../utils/nutritionQuality'
import { MealCard, MealDetailSheet } from '../Components/MealCard'

const PROGRESS_LOAD_TIMEOUT_MS = 5000
const DEFAULT_GOALS = { calories: 2500, protein: 150 }

export default function ProgressScreen({ user, resumeSignal = 0 }) {
  const loadRequestRef = useRef(0)
  const activeLoadRef = useRef(null)
  const progressSnapshotRef = useRef({ todayCount: 0, weeklyDays: 0 })
  const [todayTotals, setTodayTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [todayMeals, setTodayMeals] = useState([])
  const [weeklyBreakdown, setWeeklyBreakdown] = useState({})
  const [weeklyTotals, setWeeklyTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 })
  const [weeklyMeals, setWeeklyMeals] = useState([])
  const [weekRange, setWeekRange] = useState(null)
  const [goals, setGoals] = useState(DEFAULT_GOALS)
  const [loading, setLoading] = useState(true)
  const [recoveryKey, setRecoveryKey] = useState(0)
  const [slowNotice, setSlowNotice] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [selectedMeal, setSelectedMeal] = useState(null)
  const timezone = getUserTimezone()

  useEffect(() => {
    progressSnapshotRef.current = {
      todayCount: todayMeals.length,
      weeklyDays: Object.keys(weeklyBreakdown).length
    }
  }, [todayMeals.length, weeklyBreakdown])

  const loadProgress = useCallback(async (reason = 'screen-load', options = {}) => {
    if (!user?.id) {
      setLoading(false)
      return
    }

    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    activeLoadRef.current?.abort('new progress load started')
    const lifecycleRequest = createLifecycleAbortController(`progress:${reason}`)
    activeLoadRef.current = lifecycleRequest
    const lifecycleGeneration = getLifecycleGeneration()
    const loadStartedAt = performance.now()
    const loadStartTime = new Date().toISOString()

    try {
      console.info('[CalCheck] data refresh started', { screen: 'progress', reason })
      if (reason === 'meal-saved') {
        console.info('[CalCheck] PROGRESS_REFRESH_AFTER_SAVE_START', {
          force: Boolean(options.force)
        })
      }
      if (!hasProgressSnapshotRef(progressSnapshotRef.current)) {
        recordPerformanceMetric('SCREEN_SKELETON_SHOWN', {
          screen: 'progress',
          reason
        })
      }
      setLoading(true)
      setSlowNotice(null)
      setLoadError(null)
      recordProgressStep('progress screen open', {
        reason,
        startTime: loadStartTime,
        durationMs: 0,
        success: true,
        blocksRender: false
      })

      const [todayLogs, profile, firstMeal] = await withProgressTimeout(
        trackApiRequest(
          'progress base data load',
          () => Promise.all([
            trackStartupStep(
              'progress today history query',
              () => getMealLogsToday(user.id, timezone, { signal: lifecycleRequest.signal }),
              {
                blocksRender: true,
                timeoutMs: PROGRESS_LOAD_TIMEOUT_MS,
                fallbackValue: null
              }
            ),
            trackStartupStep('progress profile query', () => getUserProfile(user.id, { signal: lifecycleRequest.signal }).catch(() => null), {
              blocksRender: true,
              timeoutMs: PROGRESS_LOAD_TIMEOUT_MS,
              fallbackValue: null
            }),
            trackStartupStep('progress first meal query', () => getFirstMealLog(user.id, timezone, { signal: lifecycleRequest.signal }).catch(() => null), {
              blocksRender: true,
              timeoutMs: PROGRESS_LOAD_TIMEOUT_MS,
              fallbackValue: null
            })
          ]),
          {
            dedupeKey: options.force ? null : `progress-history:${user.id}:${timezone}:${lifecycleGeneration}`,
            profileFetchBlockedByDedupe: true,
            onLongRequest: (message) => setSlowNotice(message)
          }
        ),
        null,
        'progress base data load',
        lifecycleRequest
      )

      if (!Array.isArray(todayLogs)) {
        console.warn('[CalCheck] PROGRESS_FALLBACK_USED', {
          reason: 'today-logs-unavailable',
          kept_previous_data: true
        })
        throw new Error('Could not refresh today progress. Please retry.')
      }

      const accountCreatedAt = profile?.created_at || user?.created_at || null
      const firstMealAnchor = firstMeal?.fallback_anchor_date || firstMeal?.timestamp || null
      const weekAnchor = accountCreatedAt || firstMealAnchor || new Date().toISOString()
      const nextWeekRange = getUserWeekRange(weekAnchor, new Date(), timezone)

      console.info('[CalCheck] USER_CREATED_AT_FOR_WEEK', {
        user_created_at: user?.created_at || null,
        profile_created_at: profile?.created_at || null,
        fallback_first_meal_at: firstMealAnchor,
        anchor_used: weekAnchor
      })
      console.info('[CalCheck] USER_WEEK_START', {
        local_date: nextWeekRange.startLocalDate,
        timezone
      })
      console.info('[CalCheck] USER_WEEK_END', {
        local_date: nextWeekRange.endLocalDate,
        timezone
      })

      const weekLogs = await withProgressTimeout(
        trackStartupStep(
          'progress user-week history query',
          () => getMealLogsForLocalDateRange(
            user.id,
            nextWeekRange.startLocalDate,
            nextWeekRange.endLocalDate,
            timezone,
            { signal: lifecycleRequest.signal }
          ),
          {
            blocksRender: true,
            timeoutMs: PROGRESS_LOAD_TIMEOUT_MS,
            fallbackValue: null
          }
        ),
        null,
        'progress user-week history query',
        lifecycleRequest
      )

      if (!Array.isArray(weekLogs)) {
        console.warn('[CalCheck] PROGRESS_FALLBACK_USED', {
          reason: 'week-logs-unavailable',
          kept_previous_data: true
        })
        throw new Error('Could not refresh weekly progress. Please retry.')
      }

      if (
        loadRequestRef.current !== requestId ||
        lifecycleRequest.signal.aborted ||
        getLifecycleGeneration() !== lifecycleGeneration
      ) {
        recordAppLifecycleEvent('stale progress result ignored', {
          reason,
          requestId,
          aborted: lifecycleRequest.signal.aborted,
          lifecycleGeneration,
          currentLifecycleGeneration: getLifecycleGeneration()
        })
        return
      }

      const calculationStart = performance.now()
      const calculationStartTime = new Date().toISOString()
      const safeTodayLogs = Array.isArray(todayLogs) ? todayLogs : []
      const safeWeekLogs = Array.isArray(weekLogs) ? weekLogs : []
      const nextTodayTotals = calculateDailyTotals(safeTodayLogs)
      const nextWeeklyBreakdown = calculateWeeklyBreakdown(safeWeekLogs, timezone)
      const nextWeeklyTotals = calculateWeeklyTotals(safeWeekLogs)
      const nextGoals = profile
        ? {
            calories: normalizeGoal(profile.calorie_target, DEFAULT_GOALS.calories),
            protein: normalizeGoal(profile.protein_target, DEFAULT_GOALS.protein)
          }
        : DEFAULT_GOALS
      const weeklyCaloriePercent = getPercent(nextWeeklyTotals.calories, nextGoals.calories * 7)
      const weeklyProteinPercent = getPercent(nextWeeklyTotals.protein, nextGoals.protein * 7)
      console.info('[CalCheck] PROGRESS_TODAY_LOGS_COUNT', {
        count: safeTodayLogs.length,
        timezone
      })
      console.info('[CalCheck] PROGRESS_TODAY_TOTALS', nextTodayTotals)
      compareAgainstScanTodayTotals(nextTodayTotals, getLocalDate(new Date(), timezone))
      console.info('[CalCheck] PROGRESS_WEEK_LOGS_COUNT', {
        count: safeWeekLogs.length,
        week_start: nextWeekRange.startLocalDate,
        week_end: nextWeekRange.endLocalDate
      })
      console.info('[CalCheck] WEEKLY_PROGRESS_CALCULATION', {
        timezone,
        week_start: nextWeekRange.startLocalDate,
        week_end: nextWeekRange.endLocalDate,
        week_logs_count: safeWeekLogs.length,
        weekly_totals: nextWeeklyTotals,
        target_values: {
          daily_calories: nextGoals.calories,
          daily_protein: nextGoals.protein,
          weekly_calories: nextGoals.calories * 7,
          weekly_protein: nextGoals.protein * 7
        },
        computed_progress_percentage: {
          calories: weeklyCaloriePercent,
          protein: weeklyProteinPercent
        },
        breakdown_days: Object.keys(nextWeeklyBreakdown)
      })
      recordPerformanceMetric('WEEKLY_PROGRESS_CALCULATION', {
        screen: 'progress',
        timezone,
        week_start: nextWeekRange.startLocalDate,
        week_end: nextWeekRange.endLocalDate,
        week_logs_count: safeWeekLogs.length,
        weekly_calories: nextWeeklyTotals.calories,
        weekly_protein: nextWeeklyTotals.protein,
        weekly_calorie_target: nextGoals.calories * 7,
        weekly_protein_target: nextGoals.protein * 7,
        calorie_percent: weeklyCaloriePercent,
        protein_percent: weeklyProteinPercent
      })
      console.info('[CalCheck] WEEKLY_CALORIES_TOTAL', { calories: nextWeeklyTotals.calories })
      console.info('[CalCheck] WEEKLY_PROTEIN_TOTAL', { protein: nextWeeklyTotals.protein })
      console.info('[CalCheck] WEEKLY_MEALS_COUNT', { count: nextWeeklyTotals.count })
      console.info('[CalCheck] WEEKLY_TARGETS_USED', {
        daily_calories: nextGoals.calories,
        daily_protein: nextGoals.protein,
        weekly_calories: nextGoals.calories * 7,
        weekly_protein: nextGoals.protein * 7
      })
      recordProgressStep('progress calculations', {
        startTime: calculationStartTime,
        endTime: new Date().toISOString(),
        durationMs: Math.round(performance.now() - calculationStart),
        success: true,
        blocksRender: true,
        todayCount: safeTodayLogs.length,
        weekCount: safeWeekLogs.length
      })

      setTodayMeals(safeTodayLogs)
      setTodayTotals(nextTodayTotals)
      setWeeklyBreakdown(nextWeeklyBreakdown)
      setWeeklyTotals(nextWeeklyTotals)
      setWeeklyMeals(safeWeekLogs)
      setWeekRange(nextWeekRange)

      if (profile) {
        setGoals(nextGoals)
      }
      recordProgressStep('progress render ready', {
        startTime: loadStartTime,
        endTime: new Date().toISOString(),
        durationMs: Math.round(performance.now() - loadStartedAt),
        success: true,
        blocksRender: true
      })
      console.info('[CalCheck] data refresh completed', { screen: 'progress', reason })
      if (reason === 'meal-saved') {
        console.info('[CalCheck] PROGRESS_REFRESH_AFTER_SAVE_SUCCESS', {
          today_count: safeTodayLogs.length,
          week_count: safeWeekLogs.length
        })
      }
    } catch (error) {
      recordProgressStep('progress data load failed', {
        startTime: loadStartTime,
        endTime: new Date().toISOString(),
        durationMs: Math.round(performance.now() - loadStartedAt),
        success: false,
        blocksRender: true,
        error: getErrorMessage(error)
      })
      logSafeError('SUPABASE_OPERATION_FAILED', error, { screen: 'progress', operation: 'load progress' })
      setLoadError(getErrorMessage(error, 'Could not load progress. Please retry.'))
      if (reason === 'meal-saved') {
        console.warn('[CalCheck] PROGRESS_REFRESH_AFTER_SAVE_FAILED', {
          error: getErrorMessage(error)
        })
      }
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false)
      }
      if (activeLoadRef.current?.id === lifecycleRequest.id) {
        activeLoadRef.current = null
      }
      lifecycleRequest.release()
    }
  }, [timezone, user?.created_at, user?.id])

  useEffect(() => {
    if (user?.id) {
      loadProgress('user-change')
    } else {
      loadRequestRef.current += 1
      setLoading(false)
    }
  }, [loadProgress, user?.id])

  useEffect(() => {
    return () => {
      activeLoadRef.current?.abort('progress unmounted')
      activeLoadRef.current = null
      loadRequestRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!resumeSignal || !user?.id) return
    loadProgress('app-resume')
  }, [loadProgress, resumeSignal, user?.id])

  useEffect(() => {
    if (!user?.id) return undefined

    return onMealSaved((savedMeal) => {
      if (!savedMeal || savedMeal.user_id !== user.id) return

      const mealLocalDate = getMealLocalDate(savedMeal, timezone)
      const todayLocalDate = getLocalDate(new Date(), timezone)

      if (mealLocalDate === todayLocalDate) {
        setTodayMeals((currentMeals) => {
          const nextMeals = mergeMeal(currentMeals, savedMeal)
          setTodayTotals(calculateDailyTotals(nextMeals))
          return nextMeals
        })
      }

      if (weekRange && mealLocalDate >= weekRange.startLocalDate && mealLocalDate <= weekRange.endLocalDate) {
        setWeeklyMeals((currentMeals) => {
          const nextMeals = mergeMeal(currentMeals, savedMeal)
          setWeeklyBreakdown(calculateWeeklyBreakdown(nextMeals, timezone))
          setWeeklyTotals(calculateWeeklyTotals(nextMeals))
          return nextMeals
        })
      }

      loadProgress('meal-saved', { force: true })
    })
  }, [loadProgress, timezone, user?.id, weekRange])

  useEffect(() => {
    if (!loading) return undefined

    const retryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { screen: 'progress', seconds: 5 })
      loadRequestRef.current += 1
      activeLoadRef.current?.abort('progress loading timeout')
      activeLoadRef.current = null
      setLoading(false)
      setRecoveryKey((value) => value + 1)
    }, 5000)

    return () => {
      window.clearTimeout(retryTimer)
    }
  }, [loadProgress, loading])

  const recentWeeklyMeals = weeklyMeals.slice(0, 5)
  const nutritionQuality = useMemo(
    () => getNutritionQuality(weeklyMeals, timezone),
    [weeklyMeals, timezone]
  )

  const caloriePercent = goals.calories
    ? getPercent(todayTotals.calories, goals.calories)
    : 0
  const proteinPercent = goals.protein
    ? getPercent(todayTotals.protein, goals.protein)
    : 0
  const weeklyCalorieTarget = goals.calories * 7
  const weeklyProteinTarget = goals.protein * 7
  const weeklyCaloriePercent = getPercent(weeklyTotals.calories, weeklyCalorieTarget)
  const weeklyProteinPercent = getPercent(weeklyTotals.protein, weeklyProteinTarget)
  const showSkeleton = loading && !hasProgressSnapshot(todayMeals, weeklyBreakdown)
  const showRefreshing = loading && !showSkeleton
  const showWeeklyEmpty = !loading && !loadError && weeklyTotals.count === 0

  useEffect(() => {
    if (!showWeeklyEmpty) return
    console.info('[CalCheck] PROGRESS_EMPTY_STATE_RENDERED', {
      scope: 'current-user-week',
      week_start: weekRange?.startLocalDate || null,
      week_end: weekRange?.endLocalDate || null
    })
  }, [showWeeklyEmpty, weekRange?.endLocalDate, weekRange?.startLocalDate])

  if (showSkeleton) {
    return (
      <div className="h-full w-full bg-white overflow-y-auto pb-24">
        <ProgressHeader refreshing={false} />
        <div className="px-6 py-6 space-y-6">
          <SummarySkeleton />
          <WeeklySkeleton />
          <MacroSkeleton />
        </div>
        {slowNotice && (
          <p className="mx-6 rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm font-semibold text-yellow-800">
            {slowNotice}
          </p>
        )}
      </div>
    )
  }

  return (
    <div key={recoveryKey} className="h-full w-full bg-white overflow-y-auto pb-24">
      <ProgressHeader refreshing={showRefreshing} />

      <div className="px-6 py-6 space-y-6">
        {slowNotice && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm font-semibold text-yellow-800">
            {slowNotice}
          </div>
        )}

        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-red-700">{loadError}</p>
            <button
              type="button"
              onClick={() => loadProgress('manual-retry')}
              className="shrink-0 text-sm font-semibold text-red-800 bg-white border border-red-200 rounded-lg px-3 py-2"
            >
              Retry
            </button>
          </div>
        )}

        <div className="bg-gradient-to-br from-brand-50 to-transparent border border-brand-300/50 rounded-3xl p-6 space-y-5">
          <h2 className="text-lg font-bold text-gray-900">Today</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl p-4 border border-orange-100">
              <p className="text-xs font-semibold text-orange-700 uppercase">Calories</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{todayTotals.calories}</p>
              <p className="text-xs text-gray-500">/ {goals.calories} kcal</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-blue-100">
              <p className="text-xs font-semibold text-blue-700 uppercase">Protein</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{todayTotals.protein}g</p>
              <p className="text-xs text-gray-500">/ {goals.protein}g</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Calorie progress</span>
              <span className="font-semibold">{Math.min(caloriePercent, 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-brand-400 to-brand-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(caloriePercent, 100)}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Protein progress</span>
              <span className="font-semibold">{Math.min(proteinPercent, 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(proteinPercent, 100)}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-brand-300/50">
            <div>
              <p className="text-xs text-gray-600">Carbs today</p>
              <p className="text-lg font-bold">{todayTotals.carbs}g</p>
            </div>
            <div>
              <p className="text-xs text-gray-600">Fat today</p>
              <p className="text-lg font-bold">{todayTotals.fat}g</p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">This Week</h2>
            <p className="text-xs text-gray-500 mt-0.5">{weekRange?.label || 'Current account week'}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-gray-900">Weekly progress</p>
                <p className="text-xs text-gray-500">{weeklyTotals.count} meal{weeklyTotals.count !== 1 ? 's' : ''} logged</p>
              </div>
              <p className="text-sm font-bold text-brand-700">{Math.min(weeklyCaloriePercent, 100)}%</p>
            </div>
            <ProgressMeter
              label="Calories"
              value={weeklyTotals.calories}
              target={weeklyCalorieTarget}
              percent={weeklyCaloriePercent}
              barClassName="bg-gradient-to-r from-brand-400 to-brand-500"
              unit="kcal"
            />
            <ProgressMeter
              label="Protein"
              value={weeklyTotals.protein}
              target={weeklyProteinTarget}
              percent={weeklyProteinPercent}
              barClassName="bg-blue-500"
              unit="g"
            />
          </div>

          <EssentialNutrientsCard nutritionQuality={nutritionQuality} />

          <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-gray-900">This Week's Meals</p>
              <Link to="/" className="text-xs font-semibold text-brand-700">
                View all meals
              </Link>
            </div>
            {showWeeklyEmpty ? (
              <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-4">No meals logged this week.</p>
            ) : recentWeeklyMeals.length > 0 ? (
              recentWeeklyMeals.map((meal) => (
                <MealCard
                  key={meal.id}
                  meal={meal}
                  timezone={timezone}
                  compact
                  onClick={setSelectedMeal}
                />
              ))
            ) : (
              <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-4">Keeping your last progress snapshot while refresh finishes.</p>
            )}
          </div>
        </div>
      </div>
      <MealDetailSheet
        meal={selectedMeal}
        user={user}
        timezone={timezone}
        onClose={() => setSelectedMeal(null)}
      />
    </div>
  )
}

function recordProgressStep(name, details) {
  recordStartupStep({
    name,
    timestamp: new Date().toISOString(),
    timedOut: false,
    timeoutMs: PROGRESS_LOAD_TIMEOUT_MS,
    ...details
  })
}

function ProgressHeader({ refreshing }) {
  return (
    <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 z-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Progress</h1>
          <p className="text-sm text-gray-500 mt-1">Daily totals and history</p>
        </div>
        {refreshing && (
          <span className="text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-3 py-1">
            Refreshing
          </span>
        )}
      </div>
    </div>
  )
}

function ProgressMeter({ label, value, target, percent, barClassName, unit }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-gray-600">{label}</span>
        <span className="font-bold text-gray-900">
          {value}{unit === 'g' ? 'g' : ''} / {target}{unit === 'g' ? 'g' : ''}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div
          className={`${barClassName} h-full rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  )
}

function EssentialNutrientsCard({ nutritionQuality }) {
  useEffect(() => {
    console.info('[CalCheck] NUTRITION_CARD_RENDERED', {
      state: nutritionQuality.state,
      score: nutritionQuality.score,
      likely_low_count: nutritionQuality.likelyLow.length,
      foods_count: nutritionQuality.foodsToAdd.length
    })
  }, [nutritionQuality])

  if (nutritionQuality.state === 'empty') {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2">
        <p className="text-sm font-bold text-gray-900">Essential nutrients</p>
        <p className="text-sm font-semibold text-gray-700">Building your weekly nutrition pattern</p>
        <p className="text-xs text-gray-500">Log a few more meals to see likely gaps and foods to add.</p>
        <p className="text-[11px] text-gray-400">Estimated from your logged meals.</p>
      </div>
    )
  }

  if (nutritionQuality.state === 'building') {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2">
        <p className="text-sm font-bold text-gray-900">Essential nutrients</p>
        <p className="text-sm font-semibold text-gray-700">Building your weekly nutrition pattern</p>
        <p className="text-xs text-gray-500">Add 2-3 more meals for sharper suggestions.</p>
        <p className="text-[11px] text-gray-400">Estimated from your logged meals.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-gray-900">Essential nutrients</p>
          <p className="text-xs text-gray-500">Nutrition quality</p>
        </div>
        <p className="text-2xl font-bold text-brand-700">{nutritionQuality.score}/100</p>
      </div>

      {nutritionQuality.likelyLow.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-gray-500">Likely low</p>
          <div className="flex flex-wrap gap-2">
            {nutritionQuality.likelyLow.slice(0, 2).map((item) => (
              <span
                key={item.key}
                className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-800"
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {nutritionQuality.foodsToAdd.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-gray-500">Foods to add</p>
          <div className="flex flex-wrap gap-2">
            {nutritionQuality.foodsToAdd.slice(0, 3).map((food) => (
              <span
                key={food.name}
                className="rounded-full bg-brand-50 border border-brand-300/60 px-3 py-1 text-xs font-semibold text-brand-900"
              >
                {food.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {nutritionQuality.sodiumHigh && (
        <p className="text-xs font-semibold text-gray-500">Sodium looked high this week.</p>
      )}

      <p className="text-[11px] text-gray-400">Estimated from your logged meals.</p>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 space-y-4 animate-pulse">
      <div className="h-5 w-24 rounded bg-gray-200" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-24 rounded-xl bg-white border border-gray-100" />
        <div className="h-24 rounded-xl bg-white border border-gray-100" />
      </div>
      <div className="h-3 rounded-full bg-gray-200" />
      <div className="h-3 rounded-full bg-gray-200" />
    </div>
  )
}

function WeeklySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-5 w-32 rounded bg-gray-100" />
      <div className="h-32 rounded-2xl bg-gray-100" />
      <div className="h-16 rounded-xl bg-gray-100" />
      <div className="h-16 rounded-xl bg-gray-100" />
    </div>
  )
}

function MacroSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-5 w-40 rounded bg-gray-100" />
      <div className="h-20 rounded-xl bg-gray-100" />
      <div className="h-20 rounded-xl bg-gray-100" />
    </div>
  )
}

function hasProgressSnapshot(todayMeals, weeklyBreakdown) {
  return todayMeals.length > 0 || Object.keys(weeklyBreakdown).length > 0
}

function hasProgressSnapshotRef(snapshot) {
  return (snapshot?.todayCount || 0) > 0 || (snapshot?.weeklyDays || 0) > 0
}

function calculateWeeklyTotals(mealLogs) {
  return mealLogs.reduce((totals, meal) => ({
    calories: totals.calories + (meal.calories || 0),
    protein: totals.protein + (meal.protein || 0),
    carbs: totals.carbs + (meal.carbs || 0),
    fat: totals.fat + (meal.fat || 0),
    count: totals.count + 1
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 })
}

function mergeMeal(mealLogs, savedMeal) {
  const existing = Array.isArray(mealLogs) ? mealLogs : []
  const withoutSavedMeal = existing.filter((meal) => meal.id !== savedMeal.id)
  return [savedMeal, ...withoutSavedMeal].sort((a, b) =>
    parseDatabaseTimestamp(b.timestamp).getTime() - parseDatabaseTimestamp(a.timestamp).getTime()
  )
}

function getMealLocalDate(meal, timezone) {
  return meal?.local_date || getLocalDate(parseDatabaseTimestamp(meal?.timestamp), meal?.timezone || timezone)
}

function compareAgainstScanTodayTotals(progressTotals, localDate) {
  if (typeof localStorage === 'undefined') return

  try {
    const raw = localStorage.getItem('calcheck-scan-today-totals')
    if (!raw) return
    const scanSnapshot = JSON.parse(raw)
    if (scanSnapshot.localDate !== localDate) return
    const scanTotals = scanSnapshot.totals || {}
    const mismatch = ['calories', 'protein', 'carbs', 'fat'].some(
      (key) => Number(scanTotals[key] || 0) !== Number(progressTotals[key] || 0)
    )

    if (mismatch) {
      console.warn('[CalCheck] PROGRESS_DATA_MISMATCH', {
        local_date: localDate,
        scan_totals: scanTotals,
        progress_totals: progressTotals
      })
    }
  } catch {
    // Diagnostics-only comparison.
  }
}

function normalizeGoal(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getPercent(value, target) {
  if (!target || target <= 0) return 0
  return Math.max(0, Math.round((value / target) * 100))
}

function withProgressTimeout(promise, fallbackValue, stepName, lifecycleRequest) {
  let timeoutId
  let timedOut = false
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  const guardedPromise = Promise.resolve(promise).catch((error) => {
    if (timedOut) {
      console.warn('[CalCheck] progress request rejected after timeout', { stepName, error })
      return fallbackValue
    }

    throw error
  })

  const timeoutPromise = new Promise((resolve) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true
      lifecycleRequest?.abort(`${stepName} timeout`)
      recordProgressStep(stepName, {
        startTime,
        endTime: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startMs),
        success: false,
        timedOut: true,
        blocksRender: true
      })
      resolve(fallbackValue)
    }, PROGRESS_LOAD_TIMEOUT_MS)
  })

  return Promise.race([guardedPromise, timeoutPromise]).finally(() => {
    window.clearTimeout(timeoutId)
  })
}
