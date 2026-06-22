import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, Upload, X } from 'lucide-react'
import CameraModal, { restorePendingMeal } from '../Components/CameraModal'
import { InstallButton, SmartInstallPrompt } from '../Components/InstallApp'
import { MealCard, MealDetailSheet } from '../Components/MealCard'
import {
  calculateDailyTotals,
  getLifetimeScanCount,
  getMealLogsToday,
  getUserProfile,
  incrementScanCount,
  isUserPro
} from '../services/database'
import {
  createSubscription,
  openRazorpaySubscriptionCheckout,
  syncSubscription
} from '../services/subscriptions'
import { signInWithGoogle } from '../services/supabase'
import { recordPerformanceMetric, trackApiRequest, trackStartupStep } from '../services/diagnostics'
import { formatLocalWeekday, getLocalDate, getUserTimezone, parseDatabaseTimestamp } from '../utils/timezone'
import { onMealSaved } from '../utils/mealEvents'
import { INSTALL_PROMPT_SEEN_KEY } from '../hooks/usePwaInstall'

const FREE_SCAN_LIMIT = 2
const POST_LOGIN_SCAN_INTENT_KEY = 'calcheck-post-login-scan-intent'
const ACCESS_CHECK_TIMEOUT_MS = 8000

export default function ScanScreen({ user, resumeSignal = 0 }) {
  const cameraInputRef = useRef(null)
  const uploadInputRef = useRef(null)
  const loadRequestRef = useRef(0)
  const scanGateInFlightRef = useRef(false)
  const mealsCountRef = useRef(0)
  const [meals, setMeals] = useState([])
  const [totals, setTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [goals, setGoals] = useState({ calories: 2500, protein: 150 })
  const [profile, setProfile] = useState(null)
  const [lifetimeScans, setLifetimeScans] = useState(0)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [pendingImage, setPendingImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveNotice, setSaveNotice] = useState(null)
  const [recoveryKey, setRecoveryKey] = useState(0)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [paywallOpen, setPaywallOpen] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [scanGateLoading, setScanGateLoading] = useState(false)
  const [selectedMeal, setSelectedMeal] = useState(null)
  const [showSmartInstallPrompt, setShowSmartInstallPrompt] = useState(false)
  const [pendingPaywallScanSource, setPendingPaywallScanSource] = useState(null)
  const [proSuccessVisible, setProSuccessVisible] = useState(false)
  const [upgradeError, setUpgradeError] = useState(null)
  const [upgradeStatus, setUpgradeStatus] = useState(null)
  const timezone = getUserTimezone()
  const pro = isUserPro(profile)

  useEffect(() => {
    mealsCountRef.current = meals.length
  }, [meals.length])

  const loadTodaysMeals = useCallback(async (reason = 'screen-load', options = {}) => {
    if (!user?.id) {
      setLoading(false)
      setProfile(null)
      setLifetimeScans(0)
      return
    }

    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId

    try {
      console.info('[CalCheck] data refresh started', { screen: 'scan', reason })
      if (mealsCountRef.current === 0) {
        recordPerformanceMetric('SCREEN_SKELETON_SHOWN', {
          screen: 'history',
          reason
        })
      }
      setLoading(true)
      const [mealLogs, profileResult, scanCount] = await trackApiRequest(
        'history load',
        () => Promise.all([
          trackStartupStep('history load', () => getMealLogsToday(user.id, timezone), {
            blocksRender: false,
            timeoutMs: 5000,
            fallbackValue: []
          }),
          trackStartupStep('profile fetch', () => getUserProfile(user.id).catch(() => null), {
            blocksRender: false,
            timeoutMs: 5000,
            fallbackValue: null
          }),
          trackStartupStep('scan counter fetch', () => getLifetimeScanCount(user.id).catch(() => 0), {
            blocksRender: false,
            timeoutMs: 5000,
            fallbackValue: 0
          })
        ]),
        {
          dedupeKey: options.force ? null : `scan-history:${user.id}:${timezone}`,
          profileFetchBlockedByDedupe: true,
          onLongRequest: (message) => setSaveNotice(message)
        }
      )

      if (loadRequestRef.current !== requestId) return

      const nextTotals = calculateDailyTotals(mealLogs)
      console.info('[CalCheck] SCAN_TODAY_LOGS_COUNT', {
        count: Array.isArray(mealLogs) ? mealLogs.length : 0,
        timezone
      })
      console.info('[CalCheck] SCAN_TODAY_TOTALS', nextTotals)
      storeScanTodayTotals(nextTotals, getLocalDate(new Date(), timezone))

      setMeals(mealLogs)
      setTotals(nextTotals)
      setProfile(profileResult)
      setLifetimeScans(scanCount)
      if (profileResult) {
        setGoals({
          calories: profileResult.calorie_target || 2500,
          protein: profileResult.protein_target || 150
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

  const mergeSavedMealIntoToday = useCallback((savedMeal) => {
    if (!savedMeal || savedMeal.user_id !== user?.id) return

    const mealLocalDate = savedMeal.local_date || getLocalDate(parseDatabaseTimestamp(savedMeal.timestamp), savedMeal.timezone || timezone)
    const todayLocalDate = getLocalDate(new Date(), timezone)
    if (mealLocalDate !== todayLocalDate) return

    setMeals((currentMeals) => {
      const nextMeals = mergeMeal(currentMeals, savedMeal)
      const nextTotals = calculateDailyTotals(nextMeals)
      setTotals(nextTotals)
      storeScanTodayTotals(nextTotals, todayLocalDate)
      return nextMeals
    })
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
      setProfile(null)
      setLifetimeScans(0)
    }
  }, [loadTodaysMeals, restorePendingMealAfterLogin, user])

  useEffect(() => {
    if (!user?.id) return

    const intent = sessionStorage.getItem(POST_LOGIN_SCAN_INTENT_KEY)
    if (!intent) return

    sessionStorage.removeItem(POST_LOGIN_SCAN_INTENT_KEY)
    setAuthModalOpen(false)
    window.setTimeout(() => handleScanRequest(intent), 250)
  }, [user?.id])

  useEffect(() => {
    if (!resumeSignal || !user?.id) return
    loadTodaysMeals('app-resume')
  }, [loadTodaysMeals, resumeSignal, user?.id])

  useEffect(() => {
    if (!user?.id) return undefined

    return onMealSaved((savedMeal) => {
      mergeSavedMealIntoToday(savedMeal)
      loadTodaysMeals('meal-saved', { force: true })
    })
  }, [loadTodaysMeals, mergeSavedMealIntoToday, user?.id])

  useEffect(() => {
    if (!loading) return undefined

    const retryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { screen: 'scan', seconds: 5 })
      loadRequestRef.current += 1
      setLoading(false)
      setRecoveryKey((value) => value + 1)
    }, 5000)

    return () => {
      window.clearTimeout(retryTimer)
    }
  }, [loadTodaysMeals, loading])

  const handleMealSaved = (savedMeal) => {
    console.info('[CalCheck] ScanScreen meal saved callback', {
      id: savedMeal?.id,
      timezone: savedMeal?.timezone,
      local_date: savedMeal?.local_date,
      meal_type: savedMeal?.meal_type
    })

    mergeSavedMealIntoToday(savedMeal)
  }

  const startScanFlow = (source = 'camera') => {
    setPendingImage(null)

    if (source === 'upload') {
      uploadInputRef.current?.click()
      return
    }

    if (shouldUseNativeCapture()) {
      cameraInputRef.current?.click()
      return
    }

    setCameraOpen(true)
  }

  const handleScanRequest = async (source = 'camera') => {
    if (scanGateInFlightRef.current) {
      console.warn('[CalCheck] CAMERA_OK_NOOP_PREVENTED', {
        source,
        reason: 'access-check-already-running'
      })
      recordPerformanceMetric('CAMERA_OK_NOOP_PREVENTED', {
        source,
        reason: 'access-check-already-running'
      })
      return
    }

    if (!user?.id) {
      sessionStorage.setItem(POST_LOGIN_SCAN_INTENT_KEY, source)
      setAuthModalOpen(true)
      return
    }

    try {
      scanGateInFlightRef.current = true
      setScanGateLoading(true)
      console.info('[CalCheck] ACCESS_CHECK_START', { source, user_id: user.id })
      recordPerformanceMetric('ACCESS_CHECK_START', { source })
      let [latestProfile, latestScanCount] = await withTimeout(
        trackApiRequest(
          'access check',
          () => Promise.all([
            trackStartupStep('access check profile fetch', () => getUserProfile(user.id), {
              blocksRender: false,
              timeoutMs: ACCESS_CHECK_TIMEOUT_MS,
              fallbackValue: profile
            }),
            trackStartupStep('access check scan counter fetch', () => getLifetimeScanCount(user.id), {
              blocksRender: false,
              timeoutMs: ACCESS_CHECK_TIMEOUT_MS,
              fallbackValue: lifetimeScans
            })
          ]),
          {
            dedupeKey: `access-check:${user.id}`,
            profileFetchBlockedByDedupe: true,
            onLongRequest: (message) => setSaveNotice(message)
          }
        ),
        ACCESS_CHECK_TIMEOUT_MS,
        'Access check timed out. Please try again.'
      )

      if (shouldRepairSubscriptionBeforeScan(latestProfile)) {
        const syncResult = await trackStartupStep('subscription sync', () => syncSubscription().catch(() => null), {
          blocksRender: false,
          timeoutMs: 5000,
          fallbackValue: null
        })
        latestProfile = syncResult?.profile || latestProfile
      }

      setProfile(latestProfile)
      setLifetimeScans(latestScanCount)

      if (!isUserPro(latestProfile) && latestScanCount >= FREE_SCAN_LIMIT) {
        console.info('[CalCheck] ACCESS_CHECK_SUCCESS', {
          source,
          allowed: false,
          reason: 'free-limit-reached',
          scan_count: latestScanCount
        })
        setPendingPaywallScanSource(source)
        setUpgradeError(null)
        setPaywallOpen(true)
        return
      }

      console.info('[CalCheck] ACCESS_CHECK_SUCCESS', {
        source,
        allowed: true,
        scan_count: latestScanCount,
        is_pro: Boolean(latestProfile?.is_pro)
      })
      recordPerformanceMetric('ACCESS_CHECK_SUCCESS', {
        source,
        allowed: true,
        scan_count: latestScanCount,
        is_pro: Boolean(latestProfile?.is_pro)
      })
      startScanFlow(source)
    } catch (error) {
      console.error('[CalCheck] ANALYSIS_FLOW_ABORTED', {
        source,
        stage: 'access-check',
        error
      })
      recordPerformanceMetric('ANALYSIS_FLOW_ABORTED', {
        source,
        stage: 'access-check',
        error: error?.message || String(error)
      })
      if (error?.message?.includes('timed out')) {
        recordPerformanceMetric('ANALYSIS_FLOW_TIMEOUT', {
          source,
          stage: 'access-check',
          timeoutMs: ACCESS_CHECK_TIMEOUT_MS
        })
      }
      console.error('Failed to check scan access:', error)
      setSaveNotice('Could not check scan access. Please try again.')
      setTimeout(() => setSaveNotice(null), 4000)
    } finally {
      scanGateInFlightRef.current = false
      setScanGateLoading(false)
    }
  }

  const handleImageSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) {
      console.warn('[CalCheck] CAMERA_OK_NOOP_PREVENTED', {
        reason: 'file-input-empty'
      })
      recordPerformanceMetric('CAMERA_OK_NOOP_PREVENTED', {
        reason: 'file-input-empty'
      })
      return
    }

    console.info('[CalCheck] PHOTO_HANDOFF_TO_SCAN', {
      source: 'native-file-input',
      file_name: file.name,
      file_size: file.size,
      file_type: file.type
    })
    recordPerformanceMetric('PHOTO_HANDOFF_TO_SCAN', {
      source: 'native-file-input',
      file_size: file.size,
      file_type: file.type
    })
    setPendingImage(file)
    setCameraOpen(true)
    e.target.value = ''
  }

  const handleCloseModal = () => {
    setCameraOpen(false)
    setPendingImage(null)
  }

  const handleAnalysisComplete = async () => {
    if (localStorage.getItem(INSTALL_PROMPT_SEEN_KEY) !== 'true') {
      localStorage.setItem(INSTALL_PROMPT_SEEN_KEY, 'true')
      setShowSmartInstallPrompt(true)
    }

    if (!user?.id || pro) return

    try {
      await incrementScanCount(user.id)
      const count = await getLifetimeScanCount(user.id)
      setLifetimeScans(count)
    } catch (error) {
      console.error('Failed to update scan count:', error)
    }
  }

  const handleSignIn = async () => {
    try {
      setAuthLoading(true)
      await signInWithGoogle()
    } catch (error) {
      console.error('Sign in error:', error)
      setAuthLoading(false)
    }
  }

  const handleUpgrade = async () => {
    if (!user?.id) {
      setPaywallOpen(false)
      setAuthModalOpen(true)
      return
    }

    const previousProfile = profile

    try {
      setUpgradeLoading(true)
      setUpgradeError(null)
      setUpgradeStatus('Preparing secure checkout...')
      const flowStartedAt = performance.now()
      const flowId = `paywall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      recordPerformanceMetric('razorpay checkout timing', {
        step: 'UPGRADE_BUTTON_PRESSED',
        flowId,
        elapsedMs: 0
      })
      const checkoutPayload = await createSubscription({ flowId, flowStartedAt })

      if (checkoutPayload?.already_pro) {
        setProfile(checkoutPayload.profile)
        setPaywallOpen(false)
        setUpgradeStatus(null)
        setProSuccessVisible(true)
        setTimeout(() => setProSuccessVisible(false), 5000)
        continuePendingScan()
        return
      }

      await openRazorpaySubscriptionCheckout({
        keyId: checkoutPayload.key_id,
        subscriptionId: checkoutPayload.subscription_id,
        user,
        flowId,
        flowStartedAt,
        onAuthorized: async () => {
          setUpgradeError(null)
          setUpgradeLoading(true)
          setUpgradeStatus('Confirming subscription...')

          try {
            const synced = await waitForProConfirmation()
            setProfile(synced)
            setPaywallOpen(false)
            setUpgradeStatus(null)
            setProSuccessVisible(true)
            setTimeout(() => setProSuccessVisible(false), 5000)
            continuePendingScan()
          } catch (error) {
            setUpgradeError(error?.message || 'Payment authorized. Waiting for subscription confirmation.')
          } finally {
            setUpgradeLoading(false)
          }
        },
        onDismiss: () => {
          setUpgradeStatus(null)
          setUpgradeLoading(false)
        }
      })
    } catch (error) {
      console.error('Upgrade error:', error)
      setProfile(previousProfile)
      setUpgradeError(error?.message || 'Could not activate Pro. Please try again.')
      setUpgradeStatus(null)
    } finally {
      setUpgradeLoading(false)
    }
  }

  const waitForProConfirmation = async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const syncResult = await syncSubscription().catch(() => null)
      const latestProfile = syncResult?.profile || await getUserProfile(user.id).catch(() => null)

      if (latestProfile?.is_pro) return latestProfile
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
    }

    throw new Error('Payment authorized. Pro access will unlock after Razorpay confirms the subscription.')
  }

  const continuePendingScan = () => {
    if (!pendingPaywallScanSource) return

    const scanSource = pendingPaywallScanSource
    setPendingPaywallScanSource(null)
    window.setTimeout(() => startScanFlow(scanSource), 350)
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
        onAnalysisComplete={handleAnalysisComplete}
      />

      <AuthModal
        isOpen={authModalOpen}
        isLoading={authLoading}
        onClose={() => setAuthModalOpen(false)}
        onSignIn={handleSignIn}
      />

      <PaywallModal
        isOpen={paywallOpen}
        isLoading={upgradeLoading}
        error={upgradeError}
        status={upgradeStatus}
        onClose={() => setPaywallOpen(false)}
        onUpgrade={handleUpgrade}
      />

      <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 z-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Scan Food</h1>
            <p className="text-sm text-gray-500 mt-1">Track your nutrition instantly</p>
          </div>
          <InstallButton compact className="shrink-0 mt-0.5" />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {saveNotice && (
          <div className="bg-brand-50 border border-brand-300/60 rounded-xl p-3 text-sm text-brand-700">
            {saveNotice}
          </div>
        )}

        {proSuccessVisible && (
          <div className="bg-gradient-to-r from-brand-50 to-white border border-brand-300/70 rounded-2xl p-4 shadow-[0_14px_34px_rgba(17,245,246,0.12)]">
            <p className="text-base font-bold text-gray-900">🎉 Welcome to CalCheck Pro</p>
            <p className="text-sm text-gray-600 mt-1">Unlimited scans unlocked.</p>
          </div>
        )}

        <SmartInstallPrompt
          isOpen={showSmartInstallPrompt}
          onDismiss={() => setShowSmartInstallPrompt(false)}
        />

        <div className="space-y-3">
          <button
            onClick={() => handleScanRequest('camera')}
            disabled={scanGateLoading}
            className="w-full bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-70 disabled:cursor-not-allowed text-brand-900 font-semibold py-4 px-6 rounded-2xl shadow-brand hover:shadow-lg transition-all duration-300 flex items-center justify-center gap-3 active:scale-95"
          >
            {scanGateLoading ? <Loader2 size={24} className="animate-spin" /> : <Camera size={24} />}
            <span>{scanGateLoading ? 'Checking access...' : 'Open Camera'}</span>
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageSelected}
          />

          <button
            type="button"
            onClick={() => handleScanRequest('upload')}
            disabled={scanGateLoading}
            className="w-full bg-gray-50 hover:bg-gray-100 border-2 border-gray-200 disabled:opacity-70 disabled:cursor-not-allowed text-gray-900 font-semibold py-4 px-6 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 active:scale-95"
          >
            <Upload size={24} />
            <span>Upload Image</span>
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelected}
          />
        </div>

        {user && !pro && (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Free scans</p>
              <p className="text-xs text-gray-500">{Math.min(lifetimeScans, FREE_SCAN_LIMIT)} of {FREE_SCAN_LIMIT} used</p>
            </div>
            <button
              type="button"
              onClick={() => setPaywallOpen(true)}
              className="text-sm font-semibold text-brand-900 bg-brand-50 border border-brand-300/60 rounded-xl px-3 py-2"
            >
              Go Pro
            </button>
          </div>
        )}

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
  onClick={handleSignIn}
  disabled={authLoading}
  className="w-full bg-white border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-xl py-3 font-medium flex items-center justify-center gap-2"
>
  {authLoading ? <Loader2 size={18} className="animate-spin" /> : <GoogleGlyph />}

  {authLoading ? 'Signing in...' : 'Continue with Google'}
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

        {loading && meals.length === 0 ? (
          <MealHistorySkeleton />
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
              <MealCard
                key={meal.id}
                meal={meal}
                timezone={timezone}
                onClick={setSelectedMeal}
              />
            ))}
          </div>
        )}
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

const withTimeout = (promise, ms, message) => {
  let timeoutId

  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId)
  })
}

function mergeMeal(mealLogs, savedMeal) {
  const existing = Array.isArray(mealLogs) ? mealLogs : []
  const withoutSavedMeal = existing.filter((meal) => meal.id !== savedMeal.id)
  return [savedMeal, ...withoutSavedMeal].sort((a, b) =>
    parseDatabaseTimestamp(b.timestamp).getTime() - parseDatabaseTimestamp(a.timestamp).getTime()
  )
}

function storeScanTodayTotals(totals, localDate) {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem('calcheck-scan-today-totals', JSON.stringify({
      localDate,
      totals
    }))
  } catch {
    // Diagnostics-only snapshot.
  }
}

function MealHistorySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-5 w-28 rounded bg-gray-100" />
      {[0, 1, 2].map((item) => (
        <div key={item} className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="h-4 w-40 rounded bg-gray-100" />
          <div className="mt-3 h-3 w-56 rounded bg-gray-100" />
          <div className="mt-2 h-3 w-24 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )
}

const shouldUseNativeCapture = () => {
  if (typeof navigator === 'undefined') return false

  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

const shouldRepairSubscriptionBeforeScan = (profile) => {
  return Boolean(
    profile?.razorpay_subscription_id &&
    ['pending', 'grace', 'halted', 'cancelled'].includes(profile?.subscription_status)
  )
}

function AuthModal({ isOpen, isLoading, onClose, onSignIn }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center sm:justify-center px-0 sm:px-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 relative">
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 disabled:opacity-50"
          aria-label="Close"
        >
          <X size={20} className="text-gray-700" />
        </button>

        <div className="pr-8">
          <h2 className="text-2xl font-bold text-gray-900">Track calories with calcheck</h2>
          <div className="mt-5 space-y-3">
            {['2 free AI scans', 'Save meal history', 'Track progress'].map((benefit) => (
              <div key={benefit} className="flex items-center gap-3 text-gray-700">
                <Check size={18} className="text-brand-700" />
                <span className="font-medium">{benefit}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onSignIn}
          disabled={isLoading}
          className="mt-8 w-full bg-white border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-xl py-3 font-semibold flex items-center justify-center gap-3 text-gray-900"
        >
          {isLoading ? <Loader2 size={20} className="animate-spin" /> : <GoogleGlyph />}
          <span>{isLoading ? 'Signing in...' : 'Continue with Google'}</span>
        </button>
      </div>
    </div>
  )
}

function PaywallModal({ isOpen, isLoading, error, status, onClose, onUpgrade }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center sm:justify-center px-0 sm:px-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 relative">
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 disabled:opacity-50"
          aria-label="Close"
        >
          <X size={20} className="text-gray-700" />
        </button>

        <div className="pr-8">
          <h2 className="text-2xl font-bold text-gray-900">You've used your free scans</h2>
          <p className="text-gray-600 mt-3">
            Upgrade to CalCheck Pro for unlimited AI calorie scans.
          </p>

          <div className="mt-5 space-y-3">
            {['Unlimited scans', 'Meal history', 'Progress tracking'].map((benefit) => (
              <div key={benefit} className="flex items-center gap-3 text-gray-700">
                <Check size={18} className="text-brand-700" />
                <span className="font-medium">{benefit}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl bg-brand-50 border border-brand-300/60 p-4">
            <p className="text-sm text-gray-600">CalCheck Pro</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">₹69/month</p>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 p-3">
              <p className="text-sm font-semibold text-red-800">{error}</p>
            </div>
          )}

          {status && !error && (
            <div className="mt-4 rounded-2xl bg-brand-50 border border-brand-300/60 p-3">
              <p className="text-sm font-semibold text-brand-700">{status}</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onUpgrade}
          disabled={isLoading}
          className="mt-6 w-full bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-70 disabled:cursor-not-allowed text-brand-900 rounded-xl py-3 font-bold flex items-center justify-center gap-2"
        >
          {isLoading && <Loader2 size={20} className="animate-spin" />}
          <span>{isLoading ? 'Preparing secure checkout...' : 'Upgrade to Pro'}</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="mt-3 w-full text-gray-600 hover:text-gray-900 disabled:opacity-50 rounded-xl py-3 font-semibold"
        >
          Maybe Later
        </button>
      </div>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12S17.4 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.2 4 9.5 8.4 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.4 39.5 16.1 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C40.9 35.5 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}
