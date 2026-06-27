import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logAppEvent } from '../utils/appDiagnostics'
import {
  getFirstMealLog,
  calculateWeeklyBreakdown,
  getUserProfile
} from '../services/database'
import { trackApiRequest } from '../services/diagnostics'
import { getUserTimezone, getUserWeekRange } from '../utils/timezone'
import { getErrorMessage, logSafeError } from '../utils/errorUtils'
import { getNutritionQuality } from '../utils/nutritionQuality'
import { MealCard, MealDetailSheet } from '../Components/MealCard'
import { useWeekMeals } from '../data/MealDataProvider'

const DEFAULT_GOALS = { calories: 2500, protein: 150 }
const REFRESH_WARNING_MESSAGE = 'Check your connection and try again.'

export default function ProgressScreen({ user, resumeSignal = 0 }) {
  const [weekRange, setWeekRange] = useState(null)
  const [goals, setGoals] = useState(DEFAULT_GOALS)
  const [anchorLoading, setAnchorLoading] = useState(true)
  const [anchorError, setAnchorError] = useState(null)
  const [retryWarning, setRetryWarning] = useState(null)
  const [selectedMeal, setSelectedMeal] = useState(null)
  const weeklyMealsSectionRef = useRef(null)
  const weekRangeRef = useRef(null)
  const timezone = getUserTimezone()

  useEffect(() => {
    weekRangeRef.current = weekRange
  }, [weekRange])

  const resolveWeekAnchor = useCallback(async (reason = 'screen-load') => {
    if (!user?.id) {
      setAnchorLoading(false)
      return
    }

    try {
      setAnchorLoading(true)
      setAnchorError(null)
      console.info('[CalCheck] data refresh started', { screen: 'progress', reason, target: 'week-anchor' })
      const [profile, firstMeal] = await trackApiRequest(
        'progress week anchor load',
        () => Promise.all([
          getUserProfile(user.id).catch(() => null),
          getFirstMealLog(user.id, timezone).catch(() => null)
        ]),
        {
          dedupeKey: `progress-week-anchor:${user.id}:${timezone}`,
          profileFetchBlockedByDedupe: true
        }
      )

      const accountCreatedAt = profile?.created_at || user?.created_at || null
      const firstMealAnchor = firstMeal?.fallback_anchor_date || firstMeal?.timestamp || null
      const weekAnchor = accountCreatedAt || firstMealAnchor

      if (!weekAnchor) {
        console.info('[CalCheck] USER_WEEK_ANCHOR_PENDING', {
          user_id: user.id,
          reason,
          has_profile: Boolean(profile),
          has_first_meal: Boolean(firstMeal)
        })
        setAnchorLoading(false)
        return
      }

      const nextWeekRange = getUserWeekRange(weekAnchor, new Date(), timezone)
      console.info('[CalCheck] USER_WEEK_ANCHOR_RESOLVED', {
        user_created_at: user?.created_at || null,
        profile_created_at: profile?.created_at || null,
        fallback_first_meal_at: firstMealAnchor,
        anchor_used: weekAnchor,
        week_start: nextWeekRange.startLocalDate,
        week_end: nextWeekRange.endLocalDate,
        timezone
      })
      setWeekRange(nextWeekRange)
      if (profile) {
        setGoals({
          calories: normalizeGoal(profile.calorie_target, DEFAULT_GOALS.calories),
          protein: normalizeGoal(profile.protein_target, DEFAULT_GOALS.protein)
        })
      }
      setRetryWarning(null)
      console.info('[CalCheck] data refresh completed', { screen: 'progress', reason, target: 'week-anchor' })
    } catch (error) {
      const normalizedMessage = getErrorMessage(error, REFRESH_WARNING_MESSAGE)
      logSafeError('PROGRESS_ERROR_NORMALIZED', error, { screen: 'progress', operation: 'resolve week anchor' })
      setAnchorError(normalizedMessage)
      console.info('[CalCheck] USER_WEEK_ANCHOR_PENDING', {
        user_id: user?.id || null,
        reason,
        error: normalizedMessage,
        kept_previous_week: Boolean(weekRangeRef.current)
      })
    } finally {
      setAnchorLoading(false)
    }
  }, [timezone, user?.created_at, user?.id])

  useEffect(() => {
    if (!user?.id) {
      setWeekRange(null)
      setAnchorLoading(false)
      return
    }
    resolveWeekAnchor('user-change')
  }, [resolveWeekAnchor, user?.id])

  useEffect(() => {
    if (!resumeSignal || !user?.id) return
    resolveWeekAnchor('app-resume')
  }, [resolveWeekAnchor, resumeSignal, user?.id])

  const weekMealState = useWeekMeals(user?.id, weekRange, { timezone, resumeSignal })
  const weeklyMeals = weekMealState.meals
  const weeklyBreakdown = useMemo(() => calculateWeeklyBreakdown(weeklyMeals, timezone), [weeklyMeals, timezone])
  const weeklyTotals = useMemo(() => calculateWeeklyTotals(weeklyMeals), [weeklyMeals])
  const recentWeeklyMeals = weeklyMeals.slice(0, 5)
  const nutritionQuality = useMemo(
    () => getNutritionQuality(weeklyMeals, timezone),
    [weeklyMeals, timezone]
  )

  const weeklyCalorieTarget = goals.calories * 7
  const weeklyProteinTarget = goals.protein * 7
  const weeklyCaloriePercent = getPercent(weeklyTotals.calories, weeklyCalorieTarget)
  const weeklyProteinPercent = getPercent(weeklyTotals.protein, weeklyProteinTarget)
  const hasProgressData = hasProgressSnapshot(weeklyMeals, weeklyBreakdown)
  const showSkeleton = !hasProgressData && (anchorLoading || (!weekRange && !anchorError) || weekMealState.isInitialLoading)
  const showRefreshing = weekMealState.isRefreshing || weekMealState.isRetrying
  const visibleError = retryWarning || (!hasProgressData && (weekMealState.error || anchorError) ? REFRESH_WARNING_MESSAGE : null)
  const showWeeklyEmpty = !showSkeleton && !visibleError && weeklyTotals.count === 0

  const handleRetry = async () => {
    setRetryWarning(null)
    if (!weekRange) {
      await resolveWeekAnchor('manual-retry')
    }
    const result = await weekMealState.refresh({ reason: 'manual-retry', retry: true, force: true })
    if (result?.status === 'error' || result?.status === 'stale') {
      setRetryWarning(REFRESH_WARNING_MESSAGE)
    }
  }

  useEffect(() => {
    if (!showWeeklyEmpty) return
    console.info('[CalCheck] PROGRESS_EMPTY_STATE_RENDERED', {
      scope: 'current-user-week',
      week_start: weekRange?.startLocalDate || null,
      week_end: weekRange?.endLocalDate || null,
      query_key: weekMealState.key
    })
  }, [showWeeklyEmpty, weekMealState.key, weekRange?.endLocalDate, weekRange?.startLocalDate])

  useEffect(() => {
    console.info('[CalCheck] PROGRESS_UI_REDESIGN_RENDERED', {
      weekly_meals: weeklyTotals.count,
      refreshing: showRefreshing,
      stale: weekMealState.isStale
    })
  }, [showRefreshing, weekMealState.isStale, weeklyTotals.count])

  useEffect(() => {
    if (!visibleError) return
    console.info('[CalCheck] PROGRESS_VISIBLE_REFRESH_ERROR_SHOWN', {
      kept_previous_data: hasProgressData,
      message: REFRESH_WARNING_MESSAGE
    })
  }, [hasProgressData, visibleError])

  if (showSkeleton) {
    return <ProgressDashboardSkeleton slowNotice={null} onRetry={handleRetry} />
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-[#FFF9F2] pb-24 text-[#151A22]">
      <ProgressHeader refreshing={showRefreshing} />

      <main className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5">
        {visibleError && (
          <RefreshWarning
            message={visibleError || 'This is taking longer than expected. Try again.'}
            onRetry={handleRetry}
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
        <div className="mt-4 overflow-hidden rounded-[24px] bg-[#F7F4EE] px-4 py-5">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <BuildingNutritionAura />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-base font-black text-[#151A22]">Building your weekly nutrition pattern</p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-[#5F6978]">Log a few more meals to unlock nutrient quality, likely gaps, and foods to add.</p>
              <p className="mt-3 text-[11px] font-bold text-[#8A8175]">Estimated from your logged meals.</p>
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (nutritionQuality.state === 'building') {
    return (
      <section className="rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white p-5 shadow-[0_18px_50px_rgba(21,26,34,0.07)]">
        <NutrientCardHeader />
        <div className="mt-4 overflow-hidden rounded-[24px] bg-[#F7F4EE] px-4 py-5">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <BuildingNutritionAura />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-base font-black text-[#151A22]">Building your weekly nutrition pattern</p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-[#5F6978]">Log a few more meals to unlock nutrient quality, likely gaps, and foods to add.</p>
              <p className="mt-3 text-[11px] font-bold text-[#8A8175]">Estimated from your logged meals.</p>
            </div>
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

function BuildingNutritionAura() {
  const nutrients = [
    { label: 'Fibre', className: 'left-1 top-7' },
    { label: 'Omega-3', className: 'right-0 top-10' },
    { label: 'Calcium', className: 'bottom-7 right-2' },
    { label: 'Iron', className: 'bottom-5 left-3' },
    { label: 'Vitamin B12', className: 'left-1/2 top-0 -translate-x-1/2' }
  ]

  return (
    <div className="nutrition-aura-build relative h-[168px] w-full max-w-[260px] shrink-0 sm:w-[210px]" aria-hidden="true">
      <div className="nutrition-aura-orbit absolute left-1/2 top-1/2 h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <div className="nutrition-aura-ring absolute left-1/2 top-1/2 grid h-[96px] w-[96px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full">
        <div className="h-[68px] w-[68px] rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(21,26,34,0.08)]" />
      </div>
      {nutrients.map((nutrient, index) => (
        <span
          key={nutrient.label}
          className={`nutrition-aura-label absolute ${nutrient.className} rounded-full border border-white/70 bg-white/75 px-2.5 py-1 text-[11px] font-black text-[#5F6978] shadow-[0_8px_22px_rgba(21,26,34,0.08)] backdrop-blur`}
          style={{ animationDelay: `${index * 850}ms` }}
        >
          {nutrient.label}
        </span>
      ))}
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

function calculateWeeklyTotals(mealLogs) {
  return mealLogs.reduce((totals, meal) => ({
    calories: totals.calories + (meal.calories || 0),
    protein: totals.protein + (meal.protein || 0),
    carbs: totals.carbs + (meal.carbs || 0),
    fat: totals.fat + (meal.fat || 0),
    count: totals.count + 1
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 })
}

function normalizeGoal(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getPercent(value, target) {
  if (!target || target <= 0) return 0
  return Math.max(0, Math.round((value / target) * 100))
}
