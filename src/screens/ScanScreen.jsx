import React, { useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, Upload, X } from 'lucide-react'
import CameraModal, { restorePendingMeal } from '../Components/CameraModal'
import { InstallButton, SmartInstallPrompt } from '../Components/InstallApp'
import { MealCard, MealDetailSheet } from '../Components/MealCard'
import {
  getLifetimeScanCount,
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
import { formatLocalWeekday, getUserTimezone } from '../utils/timezone'
import { getErrorMessage, logSafeError } from '../utils/errorUtils'
import { INSTALL_PROMPT_SEEN_KEY } from '../hooks/usePwaInstall'
import { useTodayMeals } from '../data/MealDataProvider'

const FREE_SCAN_LIMIT = 2
const POST_LOGIN_SCAN_INTENT_KEY = 'calcheck-post-login-scan-intent'
const ACCESS_CHECK_TIMEOUT_MS = 8000

export default function ScanScreen({ user, resumeSignal = 0 }) {
  const cameraInputRef = useRef(null)
  const uploadInputRef = useRef(null)
  const scanGateInFlightRef = useRef(false)
  const [goals, setGoals] = useState({ calories: 2500, protein: 150 })
  const [profile, setProfile] = useState(null)
  const [lifetimeScans, setLifetimeScans] = useState(0)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [pendingImage, setPendingImage] = useState(null)
  const [saveNotice, setSaveNotice] = useState(null)
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
  const todayMealState = useTodayMeals(user?.id, { timezone, resumeSignal })
  const meals = todayMealState.meals
  const totals = todayMealState.totals
  const loading = todayMealState.isInitialLoading
  const refreshing = todayMealState.isRefreshing
  const pro = isUserPro(profile)


  useEffect(() => {
    if (!user?.id) {
      setProfile(null)
      setLifetimeScans(0)
      return
    }

    let cancelled = false

    const loadScanMetadata = async () => {
      try {
        console.info('[CalCheck] data refresh started', { screen: 'scan', reason: 'metadata-load' })
        const [profileResult, scanCount] = await trackApiRequest(
          'scan metadata load',
          () => Promise.all([
            getUserProfile(user.id).catch(() => null),
            getLifetimeScanCount(user.id).catch(() => 0)
          ]),
          {
            dedupeKey: `scan-metadata:${user.id}`,
            profileFetchBlockedByDedupe: true,
            onLongRequest: (message) => setSaveNotice(message)
          }
        )

        if (cancelled) return
        setProfile(profileResult)
        setLifetimeScans(scanCount)
        if (profileResult) {
          setGoals({
            calories: profileResult.calorie_target || 2500,
            protein: profileResult.protein_target || 150
          })
        }
        console.info('[CalCheck] data refresh completed', { screen: 'scan', reason: 'metadata-load' })
      } catch (error) {
        logSafeError('SUPABASE_OPERATION_FAILED', error, { screen: 'scan', operation: 'load scan metadata' })
      }
    }

    loadScanMetadata()

    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return

    restorePendingMeal(user)
      .then((saved) => {
        if (saved) {
          setSaveNotice('Your meal was saved after signing in.')
          setTimeout(() => setSaveNotice(null), 4000)
        }
      })
      .catch((error) => {
        logSafeError('SUPABASE_OPERATION_FAILED', error, { screen: 'scan', operation: 'restore pending meal' })
      })
  }, [user])

  useEffect(() => {
    if (!user?.id) return

    const intent = sessionStorage.getItem(POST_LOGIN_SCAN_INTENT_KEY)
    if (!intent) return

    sessionStorage.removeItem(POST_LOGIN_SCAN_INTENT_KEY)
    setAuthModalOpen(false)
    window.setTimeout(() => handleScanRequest(intent), 250)
  }, [user?.id])
  const handleMealSaved = (savedMeal) => {
    console.info('[CalCheck] ScanScreen meal saved callback', {
      id: savedMeal?.id,
      timezone: savedMeal?.timezone,
      local_date: savedMeal?.local_date,
      meal_type: savedMeal?.meal_type
    })
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
        error: getErrorMessage(error)
      })
      if (error?.message?.includes('timed out')) {
        recordPerformanceMetric('ANALYSIS_FLOW_TIMEOUT', {
          source,
          stage: 'access-check',
          timeoutMs: ACCESS_CHECK_TIMEOUT_MS
        })
      }
      logSafeError('SUPABASE_OPERATION_FAILED', error, { screen: 'scan', operation: 'check scan access' })
      setSaveNotice(getErrorMessage(error, 'Could not check scan access. Please try again.'))
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
      logSafeError('SUPABASE_OPERATION_FAILED', error, { screen: 'scan', operation: 'update scan count' })
    }
  }

  const handleSignIn = async () => {
    try {
      setAuthLoading(true)
      await signInWithGoogle()
    } catch (error) {
      logSafeError('SUPABASE_OPERATION_FAILED', error, { screen: 'scan', operation: 'sign in' })
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
            setUpgradeError(getErrorMessage(error, 'Payment authorized. Waiting for subscription confirmation.'))
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
      logSafeError('APP_ERROR_NORMALIZED', error, { screen: 'scan', operation: 'upgrade' })
      setProfile(previousProfile)
      setUpgradeError(getErrorMessage(error, 'Could not activate Pro. Please try again.'))
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
    <div className="h-full w-full overflow-y-auto bg-[#FFF9F2] pb-24 text-[#151A22]">
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

      <div className="sticky top-0 z-10 border-b border-[rgba(21,26,34,0.08)] bg-[#FFF9F2]/95 px-5 py-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-black leading-tight tracking-normal text-[#151A22]">Scan Food</h1>
            <p className="mt-0.5 text-sm font-semibold text-[#5F6978]">Track your nutrition instantly</p>
          </div>
          <InstallButton compact className="shrink-0 mt-0.5" />
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5">
        {refreshing && (
          <div className="rounded-[22px] border border-[rgba(21,26,34,0.08)] bg-white/80 px-4 py-2 text-xs font-bold text-[#5F6978] shadow-[0_10px_26px_rgba(21,26,34,0.06)]">
            Refreshing today quietly...
          </div>
        )}

        {saveNotice && (
          <div className="rounded-[22px] border border-[#F1D79B] bg-[#FFF4D8] px-4 py-3 text-sm font-bold text-[#7A6849] shadow-[0_14px_36px_rgba(144,98,36,0.08)]">
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
            className="w-full rounded-[24px] bg-[#151A22] px-6 py-4 font-black text-white shadow-[0_18px_42px_rgba(21,26,34,0.16)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-3"
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
            className="w-full rounded-[24px] border border-[rgba(21,26,34,0.08)] bg-white px-6 py-4 font-black text-[#151A22] shadow-[0_14px_34px_rgba(21,26,34,0.06)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 flex items-center justify-center gap-3"
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
          <div className="rounded-[24px] border border-[rgba(21,26,34,0.08)] bg-white px-4 py-3 shadow-[0_14px_34px_rgba(21,26,34,0.06)] flex items-center justify-between gap-3">
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

        <div className="rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white p-5 shadow-[0_18px_50px_rgba(21,26,34,0.08)] space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-[#151A22]">Today</h2>
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
              <span className="text-sm font-black text-[#5F6978]">Calories</span>
              <span className="text-sm font-bold text-gray-900">
                {totals.calories} / {goals.calories}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#ECE7DD]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#A7C4A0] to-[#6F9D74] transition-all duration-500"
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
                className="h-full rounded-full bg-gradient-to-r from-[#D97B5A] to-[#F6D97A] transition-all duration-500"
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
          <div className="rounded-[24px] border border-[rgba(21,26,34,0.08)] bg-white px-4 py-8 text-center shadow-[0_14px_36px_rgba(21,26,34,0.06)]">
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
