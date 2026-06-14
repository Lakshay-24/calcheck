import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  getMealLogsToday,
  getMealLogsWeek,
  calculateDailyTotals,
  calculateWeeklyBreakdown,
  getUserProfile
} from '../services/database'
import { trackApiRequest } from '../services/diagnostics'
import { formatLocalTime, getUserTimezone } from '../utils/timezone'

export default function ProgressScreen({ user, resumeSignal = 0 }) {
  const loadRequestRef = useRef(0)
  const [todayTotals, setTodayTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [todayMeals, setTodayMeals] = useState([])
  const [weeklyBreakdown, setWeeklyBreakdown] = useState({})
  const [goals, setGoals] = useState({ calories: 2500, protein: 150 })
  const [loading, setLoading] = useState(true)
  const [recoveryKey, setRecoveryKey] = useState(0)
  const [slowNotice, setSlowNotice] = useState(null)
  const timezone = getUserTimezone()

  const loadProgress = useCallback(async (reason = 'screen-load') => {
    if (!user?.id) {
      setLoading(false)
      return
    }

    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId

    try {
      console.info('[CalCheck] data refresh started', { screen: 'progress', reason })
      setLoading(true)
      setSlowNotice(null)
      const [todayLogs, weekLogs, profile] = await trackApiRequest(
        'history load',
        () => Promise.all([
          getMealLogsToday(user.id, timezone),
          getMealLogsWeek(user.id, timezone),
          getUserProfile(user.id).catch(() => null)
        ]),
        {
          dedupeKey: `progress-history:${user.id}:${timezone}`,
          onLongRequest: (message) => setSlowNotice(message)
        }
      )

      if (loadRequestRef.current !== requestId) return

      setTodayMeals(todayLogs)
      setTodayTotals(calculateDailyTotals(todayLogs))
      setWeeklyBreakdown(calculateWeeklyBreakdown(weekLogs, timezone))

      if (profile) {
        setGoals({
          calories: profile.calorie_target || 2500,
          protein: profile.protein_target || 150
        })
      }
      console.info('[CalCheck] data refresh completed', { screen: 'progress', reason })
    } catch (error) {
      console.error('Error loading progress:', error)
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [timezone, user?.id])

  useEffect(() => {
    if (user?.id) {
      loadProgress('user-change')
    } else {
      loadRequestRef.current += 1
      setLoading(false)
    }
  }, [loadProgress, user?.id])

  useEffect(() => {
    if (!resumeSignal || !user?.id) return
    loadProgress('app-resume')
  }, [loadProgress, resumeSignal, user?.id])

  useEffect(() => {
    if (!loading) return undefined

    const retryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { screen: 'progress', seconds: 5 })
      loadProgress('loading-timeout-retry')
    }, 5000)

    const recoveryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { screen: 'progress', seconds: 10 })
      loadRequestRef.current += 1
      setLoading(false)
      setRecoveryKey((value) => value + 1)
      window.setTimeout(() => loadProgress('soft-recovery'), 0)
    }, 10000)

    return () => {
      window.clearTimeout(retryTimer)
      window.clearTimeout(recoveryTimer)
    }
  }, [loadProgress, loading])

  const weeklyEntries = Object.entries(weeklyBreakdown).sort(
    (a, b) => a[0].localeCompare(b[0])
  )

  const caloriePercent = goals.calories
    ? Math.round((todayTotals.calories / goals.calories) * 100)
    : 0
  const proteinPercent = goals.protein
    ? Math.round((todayTotals.protein / goals.protein) * 100)
    : 0

  if (loading) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-white px-6 pb-24 text-center">
        <p className="text-gray-500 text-sm">Loading progress...</p>
        {slowNotice && (
          <p className="rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm font-semibold text-yellow-800">
            {slowNotice}
          </p>
        )}
      </div>
    )
  }

  return (
    <div key={recoveryKey} className="h-full w-full bg-white overflow-y-auto pb-24">
      <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 z-10">
        <h1 className="text-2xl font-bold text-gray-900">Progress</h1>
        <p className="text-sm text-gray-500 mt-1">Daily totals and history</p>
      </div>

      <div className="px-6 py-6 space-y-6">
        {slowNotice && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm font-semibold text-yellow-800">
            {slowNotice}
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
          <h2 className="text-lg font-bold text-gray-900">Last 7 Days</h2>
          {weeklyEntries.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-4">No meals logged in the last week.</p>
          ) : (
            weeklyEntries.map(([date, stats]) => (
              <div key={date} className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{date}</p>
                  <p className="text-xs text-gray-500">{stats.count} meal{stats.count !== 1 ? 's' : ''}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{stats.calories} kcal</p>
                  <p className="text-xs text-gray-500">{stats.protein}g protein</p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Today's Meal History</h2>
          {todayMeals.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-4">No meals logged today.</p>
          ) : (
            todayMeals.map((meal) => (
              <div
                key={meal.id}
                className="border border-gray-200 rounded-xl p-4 flex items-start justify-between"
              >
                <div>
                  <p className="font-semibold text-gray-900">{meal.food_name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {meal.calories} kcal • {meal.protein}g protein • {meal.carbs}g carbs • {meal.fat}g fat
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatLocalTime(meal.timestamp, meal.timezone || timezone)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-brand-700">{meal.meal_score}</p>
                  <p className="text-xs text-gray-500">score</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
