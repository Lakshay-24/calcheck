import React, { useEffect, useState } from 'react'
import {
  getMealLogsToday,
  getMealLogsWeek,
  calculateDailyTotals,
  calculateWeeklyBreakdown,
  getUserProfile
} from '../services/database'

export default function ProgressScreen({ user }) {
  const [todayTotals, setTodayTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [todayMeals, setTodayMeals] = useState([])
  const [weeklyBreakdown, setWeeklyBreakdown] = useState({})
  const [goals, setGoals] = useState({ calories: 2500, protein: 150 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user?.id) {
      loadProgress()
    }
  }, [user])

  const loadProgress = async () => {
    try {
      setLoading(true)
      const [todayLogs, weekLogs, profile] = await Promise.all([
        getMealLogsToday(user.id),
        getMealLogsWeek(user.id),
        getUserProfile(user.id).catch(() => null)
      ])

      setTodayMeals(todayLogs)
      setTodayTotals(calculateDailyTotals(todayLogs))
      setWeeklyBreakdown(calculateWeeklyBreakdown(weekLogs))

      if (profile) {
        setGoals({
          calories: profile.calorie_target || 2500,
          protein: profile.protein_target || 150
        })
      }
    } catch (error) {
      console.error('Error loading progress:', error)
    } finally {
      setLoading(false)
    }
  }

  const weeklyEntries = Object.entries(weeklyBreakdown).sort(
    (a, b) => new Date(a[0]) - new Date(b[0])
  )

  const caloriePercent = goals.calories
    ? Math.round((todayTotals.calories / goals.calories) * 100)
    : 0
  const proteinPercent = goals.protein
    ? Math.round((todayTotals.protein / goals.protein) * 100)
    : 0

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white pb-24">
        <p className="text-gray-500 text-sm">Loading progress...</p>
      </div>
    )
  }

  return (
    <div className="h-full w-full bg-white overflow-y-auto pb-24">
      <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 z-10">
        <h1 className="text-2xl font-bold text-gray-900">Progress</h1>
        <p className="text-sm text-gray-500 mt-1">Daily totals and history</p>
      </div>

      <div className="px-6 py-6 space-y-6">
        <div className="bg-gradient-to-br from-green-50 to-transparent border border-green-100 rounded-3xl p-6 space-y-5">
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
                className="bg-green-500 h-2 rounded-full transition-all"
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

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-green-200">
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
                    {new Date(meal.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-600">{meal.meal_score}</p>
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
