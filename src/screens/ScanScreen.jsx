import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Upload } from 'lucide-react'
import CameraModal, { restorePendingMeal } from '../components/CameraModal'
import { getMealLogsToday, calculateDailyTotals, getUserProfile } from '../services/database'
import { signInWithGoogle } from '../services/supabase'
import { formatLocalTime, formatLocalWeekday, getUserTimezone } from '../utils/timezone'

export default function ScanScreen({ user, resumeSignal = 0 }) {
  const cameraInputRef = useRef(null)
  const loadRequestRef = useRef(0)
  const [meals, setMeals] = useState([])
  const [totals, setTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [goals, setGoals] = useState({ calories: 2500, protein: 150 })
  const [cameraOpen, setCameraOpen] = useState(false)
  const [pendingImage, setPendingImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveNotice, setSaveNotice] = useState(null)
  const [recoveryKey, setRecoveryKey] = useState(0)
  const timezone = getUserTimezone()

  const loadTodaysMeals = useCallback(async (reason = 'screen-load') => {
    if (!user?.id) {
      setLoading(false)
      return
    }

    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId

    try {
      console.info('[CalCheck] data refresh started', { screen: 'scan', reason })
      setLoading(true)
      const [mealLogs, profile] = await Promise.all([
        getMealLogsToday(user.id, timezone),
        getUserProfile(user.id).catch(() => null)
      ])

      if (loadRequestRef.current !== requestId) return

      setMeals(mealLogs)
      setTotals(calculateDailyTotals(mealLogs))
      if (profile) {
        setGoals({
          calories: profile.calorie_target || 2500,
          protein: profile.protein_target || 150
        })
      }
      console.info('[CalCheck] data refresh completed', { screen: 'scan', reason })
    } catch (error) {
      console.error('Error loading meals:', error)
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [timezone, user?.id])

  const restorePendingMealAfterLogin = useCallback(async () => {
    const saved = await restorePendingMeal(user, loadTodaysMeals)
    if (saved) {
      setSaveNotice('Your meal was saved after signing in.')
      setTimeout(() => setSaveNotice(null), 4000)
    }
  }, [loadTodaysMeals, user])

  useEffect(() => {
    if (user?.id) {
      loadTodaysMeals('user-change')
      restorePendingMealAfterLogin()
    } else {
      loadRequestRef.current += 1
      setLoading(false)
      setMeals([])
      setTotals({ calories: 0, protein: 0, carbs: 0, fat: 0 })
    }
  }, [loadTodaysMeals, restorePendingMealAfterLogin, user])

  useEffect(() => {
    if (!resumeSignal || !user?.id) return
    loadTodaysMeals('app-resume')
  }, [loadTodaysMeals, resumeSignal, user?.id])

  useEffect(() => {
    if (!loading) return undefined

    const retryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { screen: 'scan', seconds: 5 })
      loadTodaysMeals('loading-timeout-retry')
    }, 5000)

    const recoveryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { screen: 'scan', seconds: 10 })
      loadRequestRef.current += 1
      setLoading(false)
      setRecoveryKey((value) => value + 1)
      window.setTimeout(() => loadTodaysMeals('soft-recovery'), 0)
    }, 10000)

    return () => {
      window.clearTimeout(retryTimer)
      window.clearTimeout(recoveryTimer)
    }
  }, [loadTodaysMeals, loading])

  const handleMealSaved = (savedMeal) => {
    console.info('[CalCheck] ScanScreen meal saved callback', {
      id: savedMeal?.id,
      timezone: savedMeal?.timezone,
      local_date: savedMeal?.local_date,
      meal_type: savedMeal?.meal_type
    })

    if (user?.id) {
      loadTodaysMeals()
    }
  }

  const handleOpenCamera = () => {
    setPendingImage(null)
    if (shouldUseNativeCapture()) {
      cameraInputRef.current?.click()
      return
    }

    setCameraOpen(true)
  }

  const handleImageSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      setPendingImage(event.target.result)
      setCameraOpen(true)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleCloseModal = () => {
    setCameraOpen(false)
    setPendingImage(null)
  }

  const caloriePercent = goals.calories ? Math.round((totals.calories / goals.calories) * 100) : 0
  const proteinPercent = goals.protein ? Math.round((totals.protein / goals.protein) * 100) : 0

  return (
    <div key={recoveryKey} className="h-full w-full bg-white overflow-y-auto pb-24">
      <CameraModal
        isOpen={cameraOpen}
        onClose={handleCloseModal}
        user={user}
        onMealSaved={handleMealSaved}
        pendingImage={pendingImage}
      />

      <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 z-10">
        <h1 className="text-2xl font-bold text-gray-900">Scan Food</h1>
        <p className="text-sm text-gray-500 mt-1">Track your nutrition instantly</p>
      </div>

      <div className="px-6 py-6 space-y-6">
        {saveNotice && (
          <div className="bg-brand-50 border border-brand-300/60 rounded-xl p-3 text-sm text-brand-700">
            {saveNotice}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleOpenCamera}
            className="w-full bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-brand-900 font-semibold py-4 px-6 rounded-2xl shadow-brand hover:shadow-lg transition-all duration-300 flex items-center justify-center gap-3 active:scale-95"
          >
            <Camera size={24} />
            <span>Open Camera</span>
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageSelected}
          />

          <label className="w-full bg-gray-50 hover:bg-gray-100 border-2 border-gray-200 text-gray-900 font-semibold py-4 px-6 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 cursor-pointer active:scale-95">
            <Upload size={24} />
            <span>Upload Image</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageSelected}
            />
          </label>
        </div>

        <div className="bg-gradient-to-br from-brand-50 to-transparent border border-brand-300/50 rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Today's Progress</h2>
            <span className="text-xs font-semibold text-brand-700 bg-brand-50 px-3 py-1 rounded-full">
              {formatLocalWeekday(new Date(), timezone)}
            </span>
          </div>

          {!user && (
  <div className="bg-white rounded-2xl p-4 border border-brand-300/50">
    <p className="font-semibold text-gray-900 mb-1">
      Save meals and track progress
    </p>

    <p className="text-sm text-gray-500 mb-4">
      Sign in to sync your calories, protein, and meal history.
    </p>

   
    <button
  onClick={signInWithGoogle}
  className="w-full bg-white border border-gray-300 hover:bg-gray-50 rounded-xl py-3 font-medium flex items-center justify-center gap-2"
>
  <svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12S17.4 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
  </svg>

  Continue with Google
</button>


    <p className="text-xs text-gray-400 text-center mt-3">
      Save meals • Track progress • Sync across devices
    </p>
  </div>
)}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Calories</span>
              <span className="text-sm font-bold text-gray-900">
                {totals.calories} / {goals.calories}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-brand-400 to-brand-500 h-full transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(caloriePercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {user
                ? goals.calories - totals.calories > 0
                  ? `${goals.calories - totals.calories} kcal remaining`
                  : `${Math.abs(goals.calories - totals.calories)} kcal over`
                : 'Log in to track daily totals'}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Protein</span>
              <span className="text-sm font-bold text-gray-900">
                {totals.protein}g / {goals.protein}g
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(proteinPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {user
                ? goals.protein - totals.protein > 0
                  ? `${goals.protein - totals.protein}g more`
                  : 'Goal met!'
                : 'Log in to track daily totals'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-brand-300/50">
            <div className="space-y-1">
              <p className="text-xs text-gray-600">Carbs</p>
              <p className="text-lg font-bold text-gray-900">{totals.carbs}g</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-600">Fat</p>
              <p className="text-lg font-bold text-gray-900">{totals.fat}g</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500 text-sm">Loading meals...</div>
        ) : meals.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="text-3xl">📷</span>
            </div>
            <p className="text-gray-600 font-medium mb-1">No meals today yet</p>
            <p className="text-sm text-gray-500">Tap "Open Camera" to start tracking</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Today's Meals</h3>
            {meals.map((meal) => (
              <div
                key={meal.id}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between hover:border-brand-300 transition-colors"
              >
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{meal.food_name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {meal.calories} kcal • {meal.protein}g protein • {meal.carbs}g carbs • {meal.fat}g fat
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatLocalTime(meal.timestamp, meal.timezone || timezone)}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">{meal.meal_score}</div>
                  <div className="text-xs text-gray-500">score</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const shouldUseNativeCapture = () => {
  if (typeof navigator === 'undefined') return false

  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
