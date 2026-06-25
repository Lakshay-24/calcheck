import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logAppEvent } from '../utils/appDiagnostics'
import {
  getMealLogsForLocalDateRange,
  getFirstMealLog,
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
const REFRESH_WARNING_MESSAGE = 'Check your connection and try again.'

export default function ProgressScreen({ user, resumeSignal = 0 }) {
  const loadRequestRef = useRef(0)
  const activeLoadRef = useRef(null)
  const progressSnapshotRef = useRef({ weeklyCount: 0, weeklyDays: 0 })
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
  const weeklyMealsSectionRef = useRef(null)
  const timezone = getUserTimezone()

  useEffect(() => {
    progressSnapshotRef.current = {
      weeklyCount: weeklyMeals.length,
      weeklyDays: Object.keys(weeklyBreakdown).length
    }
  }, [weeklyMeals.length, weeklyBreakdown])

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

      const [profile, firstMeal] = await withProgressTimeout(
        trackApiRequest(
          'progress base data load',
          () => Promise.all([
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
      const safeWeekLogs = Array.isArray(weekLogs) ? weekLogs : []
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
        weekCount: safeWeekLogs.length
      })

      setWeeklyBreakdown(nextWeeklyBreakdown)
      setWeeklyTotals(nextWeeklyTotals)
      setWeeklyMeals(safeWeekLogs)
      setWeekRange(nextWeekRange)
      setLoadError(null)

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
          week_count: safeWeekLogs.length
        })
      }
    } catch (error) {
      const normalizedMessage = getErrorMessage(error, REFRESH_WARNING_MESSAGE)
      const hasStaleData = hasProgressSnapshotRef(progressSnapshotRef.current)
      recordProgressStep('progress data load failed', {
        startTime: loadStartTime,
        endTime: new Date().toISOString(),
        durationMs: Math.round(performance.now() - loadStartedAt),
        success: false,
        blocksRender: false,
        error: normalizedMessage,
        kept_previous_data: hasStaleData
      })
      logSafeError('PROGRESS_ERROR_NORMALIZED', error, { screen: 'progress', operation: 'load progress' })
      console.info('[CalCheck] PROGRESS_STALE_DATA_PRESERVED', {
        reason,
        kept_previous_data: hasStaleData,
        weekly_count: progressSnapshotRef.current.weeklyCount,
        weekly_days: progressSnapshotRef.current.weeklyDays
      })
      if (hasStaleData && reason !== 'manual-retry') {
        console.info('[CalCheck] PROGRESS_BACKGROUND_REFRESH_ERROR_SUPPRESSED', {
          reason,
          kept_previous_data: true
        })
        logAppEvent('PROGRESS_BACKGROUND_REFRESH_ERROR_SUPPRESSED', {
          reason,
          kept_previous_data: true,
          weekly_count: progressSnapshotRef.current.weeklyCount,
          weekly_days: progressSnapshotRef.current.weeklyDays
        })
        setLoadError(null)
      } else {
        console.info('[CalCheck] PROGRESS_VISIBLE_REFRESH_ERROR_SHOWN', {
          reason,
          kept_previous_data: hasStaleData
        })
        logAppEvent('PROGRESS_VISIBLE_REFRESH_ERROR_SHOWN', {
          reason,
          kept_previous_data: hasStaleData
        })
        setLoadError(REFRESH_WARNING_MESSAGE)
      }
      if (reason === 'meal-saved') {
        console.warn('[CalCheck] PROGRESS_REFRESH_AFTER_SAVE_FAILED', {
          error: normalizedMessage,
          kept_previous_data: hasStaleData
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
      const hasStaleData = hasProgressSnapshotRef(progressSnapshotRef.current)
      console.warn('[CalCheck] loading timeout triggered', { screen: 'progress', seconds: 5 })
      console.info('[CalCheck] PROGRESS_STALE_DATA_PRESERVED', {
        reason: 'loading-timeout',
        kept_previous_data: hasStaleData,
        weekly_count: progressSnapshotRef.current.weeklyCount,
        weekly_days: progressSnapshotRef.current.weeklyDays
      })
      loadRequestRef.current += 1
      activeLoadRef.current?.abort('progress loading timeout')
      activeLoadRef.current = null
      setSlowNotice(null)
      if (hasStaleData) {
        console.info('[CalCheck] PROGRESS_BACKGROUND_REFRESH_ERROR_SUPPRESSED', {
          reason: 'loading-timeout',
          kept_previous_data: true
        })
        logAppEvent('PROGRESS_BACKGROUND_REFRESH_ERROR_SUPPRESSED', {
          reason: 'loading-timeout',
          kept_previous_data: true,
          weekly_count: progressSnapshotRef.current.weeklyCount,
          weekly_days: progressSnapshotRef.current.weeklyDays
        })
        setLoadError(null)
      } else {
        console.info('[CalCheck] PROGRESS_VISIBLE_REFRESH_ERROR_SHOWN', {
          reason: 'loading-timeout',
          kept_previous_data: false
        })
        logAppEvent('PROGRESS_VISIBLE_REFRESH_ERROR_SHOWN', {
          reason: 'loading-timeout',
          kept_previous_data: false
        })
        setLoadError(REFRESH_WARNING_MESSAGE)
      }
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

  const weeklyCalorieTarget = goals.calories * 7
  const weeklyProteinTarget = goals.protein * 7
  const weeklyCaloriePercent = getPercent(weeklyTotals.calories, weeklyCalorieTarget)
  const weeklyProteinPercent = getPercent(weeklyTotals.protein, weeklyProteinTarget)
  const showSkeleton = loading && !hasProgressSnapshot(weeklyMeals, weeklyBreakdown)
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

  useEffect(() => {
    console.info('[CalCheck] PROGRESS_UI_REDESIGN_RENDERED', {
      weekly_meals: weeklyTotals.count,
      refreshing: showRefreshing
    })
  }, [showRefreshing, weeklyTotals.count])

  useEffect(() => {
    if (!loadError) return
    console.info('[CalCheck] PROGRESS_VISIBLE_REFRESH_ERROR_SHOWN', {
      kept_previous_data: hasProgressSnapshot(weeklyMeals, weeklyBreakdown),
      message: REFRESH_WARNING_MESSAGE
    })
  }, [loadError, weeklyMeals, weeklyBreakdown])

  if (showSkeleton) {
    return <ProgressDashboardSkeleton slowNotice={slowNotice} onRetry={() => loadProgress('manual-retry')} />
  }

  return (
    <div key={recoveryKey} className="h-full w-full overflow-y-auto bg-[#FFF9F2] pb-24 text-[#151A22]">
      <ProgressHeader refreshing={showRefreshing} />

      <main className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5">
        {loadError && (
          <RefreshWarning
            message={loadError || 'This is taking longer than expected. Try again.'}
            onRetry={() => loadProgress('manual-retry')}
          />
        )}
        <WeekDashboardCard
          totals={weeklyTotals}
          weekRange={weekRange}
          calorieTarget={weeklyCalorieTarget}
          proteinTarget={weeklyProteinTarget}
          caloriePercent={weeklyCaloriePercent}
          proteinPercent={weeklyProteinPercent}
        />

        <EssentialNutrientsCard nutritionQuality={nutritionQuality} />

        <MealPreviewSection
          meals={recentWeeklyMeals}
          timezone={timezone}
          showEmpty={showWeeklyEmpty}
          isRefreshing={showRefreshing}
          onSelectMeal={setSelectedMeal}
          sectionRef={weeklyMealsSectionRef}
        />
      </main>

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
    <header className="sticky top-0 z-10 border-b border-[rgba(21,26,34,0.08)] bg-[#FFF9F2]/95 px-5 py-4 backdrop-blur-xl">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-black leading-tight tracking-normal text-[#151A22]">Progress</h1>
          <p className="mt-0.5 text-sm font-semibold text-[#5F6978]">Your food week</p>
        </div>
        {refreshing && (
          <span className="rounded-full border border-[rgba(21,26,34,0.08)] bg-white/80 px-3 py-1 text-xs font-bold text-[#5F6978] shadow-[0_8px_24px_rgba(21,26,34,0.06)]">
            Refreshing
          </span>
        )}
      </div>
    </header>
  )
}

function RefreshWarning({ message, onRetry }) {
  return (
    <section className="flex items-center justify-between gap-3 rounded-[22px] border border-[#F1D79B] bg-[#FFF4D8] px-4 py-3 shadow-[0_14px_36px_rgba(144,98,36,0.08)]">
      <div className="min-w-0">
        <p className="text-sm font-black text-[#151A22]">Couldn't refresh</p>
        <p className="mt-0.5 text-xs font-semibold text-[#7A6849]">{message || 'Check your connection and try again.'}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-full bg-[#151A22] px-4 py-2 text-xs font-black text-white shadow-[0_10px_22px_rgba(21,26,34,0.16)] transition active:scale-95"
      >
        Retry
      </button>
    </section>
  )
}

function WeekDashboardCard({ totals, weekRange, calorieTarget, proteinTarget, caloriePercent, proteinPercent }) {
  return (
    <section className="rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-[#151A22] p-5 text-white shadow-[0_18px_50px_rgba(21,26,34,0.12)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black">This Week</p>
          <p className="mt-1 text-xs font-semibold text-white/60">{weekRange?.label || 'Current account week'}</p>
        </div>
        <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/80">
          {totals.count} meal{totals.count !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <MetricPill dark label="Calories" value={formatNumber(totals.calories)} detail="kcal" />
        <MetricPill dark label="Protein" value={`${formatNumber(totals.protein)}g`} detail="this week" />
        <MetricPill dark label="Meals" value={totals.count} detail="logged" />
      </div>

      <div className="mt-5 space-y-3">
        <SoftProgressLine dark label="Calories" percent={caloriePercent} value={`${formatNumber(totals.calories)} / ${formatNumber(calorieTarget)} kcal`} tone="sage" />
        <SoftProgressLine dark label="Protein" percent={proteinPercent} value={`${formatNumber(totals.protein)}g / ${formatNumber(proteinTarget)}g`} tone="amber" />
      </div>
    </section>
  )
}

function MetricPill({ label, value, detail, dark = false }) {
  return (
    <div className={`${dark ? 'bg-white/10 text-white' : 'bg-[#F7F4EE] text-[#151A22]'} min-w-0 rounded-[20px] px-3 py-3`}>
      <p className={`${dark ? 'text-white/60' : 'text-[#5F6978]'} truncate text-[11px] font-black uppercase`}>{label}</p>
      <p className="mt-1 truncate text-lg font-black leading-tight">{value}</p>
      <p className={`${dark ? 'text-white/60' : 'text-[#5F6978]'} mt-0.5 truncate text-[11px] font-bold`}>{detail}</p>
    </div>
  )
}

function SoftProgressLine({ label, value, percent, tone = 'sage', dark = false }) {
  const capped = Math.min(percent, 100)
  const toneClass = tone === 'warm'
    ? 'from-[#D97B5A] to-[#F6D97A]'
    : tone === 'amber'
    ? 'from-[#F6D97A] to-[#D97B5A]'
    : 'from-[#A7C4A0] to-[#6F9D74]'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-black">
        <span className={dark ? 'text-white/70' : 'text-[#5F6978]'}>{label}</span>
        <span className={dark ? 'text-white' : 'text-[#151A22]'}>{value}</span>
      </div>
      <div className={`${dark ? 'bg-white/10' : 'bg-[#ECE7DD]'} h-2.5 overflow-hidden rounded-full`}>
        <div
          className={`h-full rounded-full bg-gradient-to-r ${toneClass} motion-safe:transition-all motion-safe:duration-700`}
          style={{ width: `${capped}%` }}
        />
      </div>
    </div>
  )
}

function EssentialNutrientsCard({ nutritionQuality }) {
  const score = Math.max(0, Math.min(100, Number(nutritionQuality.score || 0)))
  const mealCount = nutritionQuality.context?.mealCount || 0
  const loggedDays = nutritionQuality.context?.loggedDays || 0
  const contextCopy = `Based on ${mealCount} meal${mealCount !== 1 ? 's' : ''} across ${loggedDays} day${loggedDays !== 1 ? 's' : ''}`

  useEffect(() => {
    console.info('[CalCheck] NUTRITION_AURA_RENDERED', {
      state: nutritionQuality.state,
      score,
      likely_low_count: nutritionQuality.likelyLow.length,
      foods_count: nutritionQuality.foodsToAdd.length
    })
    console.info('[CalCheck] NUTRITION_CARD_CONTEXT_RENDERED', {
      state: nutritionQuality.state,
      meal_count: mealCount,
      logged_days: loggedDays,
      confidence: nutritionQuality.context?.confidence || null,
      low_confidence: Boolean(nutritionQuality.context?.lowConfidence)
    })
  }, [nutritionQuality, score, mealCount, loggedDays])

  if (nutritionQuality.state === 'empty') {
    return (
      <section className="rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white p-5 shadow-[0_18px_50px_rgba(21,26,34,0.07)]">
        <NutrientCardHeader />
        <div className="mt-4 rounded-[24px] bg-[#F7F4EE] px-4 py-5">
          <p className="text-base font-black text-[#151A22]">Your nutrition pattern will appear here</p>
          <p className="mt-1 text-sm font-semibold text-[#5F6978]">Log your first meals to unlock weekly insights.</p>
        </div>
      </section>
    )
  }

  if (nutritionQuality.state === 'building') {
    return (
      <section className="rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white p-5 shadow-[0_18px_50px_rgba(21,26,34,0.07)]">
        <NutrientCardHeader />
        <div className="mt-4 flex items-center gap-4 rounded-[24px] bg-[#F7F4EE] px-4 py-5">
          <NutritionAura score={42} building />
          <div className="min-w-0 flex-1">
            <p className="text-base font-black text-[#151A22]">Building your weekly nutrition pattern</p>
            <p className="mt-1 text-sm font-semibold text-[#5F6978]">{nutritionQuality.context?.lowConfidence ? 'Need a little more meal data for sharper nutrition insights.' : 'Add 2-3 more meals for sharper suggestions.'}</p>
            <p className="mt-3 text-[11px] font-bold text-[#8A8175]">Estimated from your logged meals.</p>
          </div>
        </div>
      </section>
    )
  }

  const likelyLow = nutritionQuality.likelyLow.slice(0, 2)
  const foodsToAdd = nutritionQuality.foodsToAdd.slice(0, 3)

  return (
    <section className="rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white p-5 shadow-[0_18px_50px_rgba(21,26,34,0.07)]">
      <NutrientCardHeader />
      <div className="mt-4 flex items-center gap-4">
        <NutritionAura score={score} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase text-[#5F6978]">Nutrition quality</p>
          <p className="mt-1 text-3xl font-black leading-none text-[#151A22]">{score}/100</p>
          <p className="mt-2 text-xs font-bold text-[#5F6978]">{contextCopy}</p>
        </div>
      </div>

      {likelyLow.length > 0 && (
        <ChipGroup title="Likely low" items={likelyLow.map((item) => item.label)} tone="warm" />
      )}

      {foodsToAdd.length > 0 && (
        <ChipGroup title="Foods to add" items={foodsToAdd.map((food) => food.name)} tone="sage" />
      )}

    </section>
  )
}

function NutrientCardHeader() {
  return (
    <div>
      <p className="text-sm font-black text-[#151A22]">Essential nutrients</p>
      <p className="mt-1 text-xs font-semibold text-[#5F6978]">Nutrition Aura</p>
    </div>
  )
}

function NutritionAura({ score, building = false }) {
  const capped = Math.max(0, Math.min(100, score))

  return (
    <div
      className="relative grid h-[104px] w-[104px] shrink-0 place-items-center rounded-full motion-safe:animate-[pulse_2.4s_ease-in-out_infinite]"
      style={{ background: `conic-gradient(#A7C4A0 ${capped}%, #F6D97A ${Math.min(100, capped + 18)}%, #F0ECE4 0)` }}
    >
      <div className="absolute inset-2 rounded-full bg-white/70 blur-[1px]" />
      <div className="relative grid h-[78px] w-[78px] place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(21,26,34,0.08)]">
        <span className="text-xl font-black text-[#151A22]">{building ? '...' : capped}</span>
      </div>
    </div>
  )
}

function ChipGroup({ title, items, tone }) {
  const chipClass = tone === 'warm'
    ? 'border-[#F0D6BD] bg-[#FFF1E8] text-[#8B4B32]'
    : 'border-[#DCE9D8] bg-[#F0F7EE] text-[#365C3B]'

  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] font-black uppercase text-[#5F6978]">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <span
            key={item}
            className={`${chipClass} rounded-full border px-3 py-1.5 text-xs font-black motion-safe:animate-[fadeIn_.35s_ease-out_both]`}
            style={{ animationDelay: `${index * 80}ms` }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function MealPreviewSection({ meals, timezone, showEmpty, isRefreshing, onSelectMeal, sectionRef }) {
  const handleViewMeals = () => {
    sectionRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    console.info('[CalCheck] VIEW_LOGGED_MEALS_SCROLL', { target: 'weekly-meals' })
    logAppEvent('VIEW_LOGGED_MEALS_SCROLL', {
      level: 'info',
      screen: 'progress',
      operation: 'scroll weekly meals',
      metadata: { meal_count: meals.length }
    })
  }
  return (
    <section ref={sectionRef} className="scroll-mt-24 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-[#151A22]">This Week's Meals</h2>
          <p className="text-xs font-semibold text-[#5F6978]">Photos and summaries from your saved meals</p>
        </div>
        <button
          type="button"
          onClick={handleViewMeals}
          className="rounded-full bg-white px-3 py-2 text-xs font-black text-[#365C3B] shadow-[0_10px_24px_rgba(21,26,34,0.06)] transition active:scale-95"
        >
          View meals
        </button>
      </div>

      <div className="space-y-3">
        {showEmpty ? (
          <div className="rounded-[24px] border border-[rgba(21,26,34,0.08)] bg-white px-4 py-5 shadow-[0_14px_36px_rgba(21,26,34,0.06)]">
            <p className="text-sm font-black text-[#151A22]">No meals logged this week</p>
            <p className="mt-1 text-sm font-semibold text-[#5F6978]">Your weekly preview will fill in as you scan meals.</p>
          </div>
        ) : meals.length > 0 ? (
          meals.map((meal) => (
            <MealCard
              key={meal.id}
              meal={meal}
              timezone={timezone}
              compact
              onClick={onSelectMeal}
            />
          ))
        ) : (
          <div className="rounded-[24px] border border-[rgba(21,26,34,0.08)] bg-white px-4 py-5 shadow-[0_14px_36px_rgba(21,26,34,0.06)]">
            <p className="text-sm font-black text-[#151A22]">Keeping your last progress snapshot</p>
            <p className="mt-1 text-sm font-semibold text-[#5F6978]">{isRefreshing ? 'Refresh is still finishing quietly.' : 'Try again when your connection feels better.'}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function ProgressDashboardSkeleton({ slowNotice, onRetry }) {
  return (
    <div className="h-full w-full overflow-y-auto bg-[#FFF9F2] pb-24 text-[#151A22]">
      <ProgressHeader refreshing={false} />
      <main className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5">
        {slowNotice && (
          <RefreshWarning message="This is taking longer than expected. Try again." onRetry={onRetry} />
        )}
        <SkeletonCard className="h-[300px]" />
        <SkeletonCard className="h-[258px]" dark />
        <SkeletonCard className="h-[260px]" />
        <div className="space-y-3">
          <div className="h-6 w-40 animate-pulse rounded-full bg-[#ECE7DD]" />
          <SkeletonCard className="h-[92px]" />
          <SkeletonCard className="h-[92px]" />
          <SkeletonCard className="h-[92px]" />
        </div>
      </main>
    </div>
  )
}

function SkeletonCard({ className = '', dark = false }) {
  return (
    <div className={`${className} animate-pulse rounded-[28px] border border-[rgba(21,26,34,0.08)] ${dark ? 'bg-[#151A22]/90' : 'bg-white'} p-5 shadow-[0_18px_50px_rgba(21,26,34,0.06)]`}>
      <div className={`${dark ? 'bg-white/20' : 'bg-[#ECE7DD]'} h-4 w-24 rounded-full`} />
      <div className={`${dark ? 'bg-white/10' : 'bg-[#F7F4EE]'} mt-5 h-16 rounded-[22px]`} />
      <div className={`${dark ? 'bg-white/10' : 'bg-[#F7F4EE]'} mt-4 h-3 rounded-full`} />
      <div className={`${dark ? 'bg-white/10' : 'bg-[#F7F4EE]'} mt-3 h-3 w-4/5 rounded-full`} />
    </div>
  )
}

function formatNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString('en-US')
}
function hasProgressSnapshot(weeklyMeals, weeklyBreakdown) {
  return weeklyMeals.length > 0 || Object.keys(weeklyBreakdown).length > 0
}

function hasProgressSnapshotRef(snapshot) {
  return (snapshot?.weeklyCount || 0) > 0 || (snapshot?.weeklyDays || 0) > 0
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
