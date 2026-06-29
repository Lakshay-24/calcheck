// App shell - routes and main layout
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './services/supabase.js'
import { getOrCreateUserProfile } from './services/database'
import { recordStartupStep, trackApiRequest, trackStartupStep } from './services/diagnostics'
import { abortLifecycleRequests, recordAppLifecycleEvent } from './services/lifecycle'
import { preloadRazorpayCheckout } from './services/subscriptions'
import { logSafeError } from './utils/errorUtils'
import { logAppEvent, setDiagnosticsUser } from './utils/appDiagnostics'
import { preloadLazyModuleWhenIdle } from './utils/lazyPreload'
import ErrorBoundary from './Components/ErrorBoundary'
import { ProgressSkeleton, ProfileSkeleton, ScreenSkeleton } from './Components/Skeletons'
import { MealDataProvider } from './data/MealDataProvider'
import './index.css'

import ScanScreen from './screens/ScanScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import BottomNav from './Components/BottomNav'

const preloadProgressScreen = () => import('./screens/ProgressScreen')
const preloadProfileScreen = () => import('./screens/ProfileScreen')
const preloadInfoPage = () => import('./screens/InfoPage')
const ProgressScreen = lazy(preloadProgressScreen)
const ProfileScreen = lazy(preloadProfileScreen)
const InfoPage = lazy(preloadInfoPage)

const profileSetupInFlight = new Set()
const timedOutSessionFallback = { data: { session: null }, error: null, __calcheckTimedOut: true }
const IOS_BOOT_SESSION_KEY = 'calcheck-ios-boot-session'
const IOS_LAST_BOOT_KEY = 'calcheck-ios-last-boot'
const STARTUP_SESSION_RESTORE_TIMEOUT_MS = 900
const RESUME_SESSION_RESTORE_TIMEOUT_MS = 5000

const isExplicitSignedOutEvent = (event) => event === 'SIGNED_OUT'

const logAuthOutcome = (type, details = {}) => {
  console.info(`[CalCheck] ${type}`, details)
}

const getAuthDiagnosticMetadata = (details = {}) => ({
  duration_ms: details.duration_ms ?? null,
  has_session: Boolean(details.hasSession ?? details.has_session),
  auth_status: details.auth_status || null,
  is_pwa: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true),
  is_online: typeof navigator === 'undefined' ? true : navigator.onLine,
  event_source: details.source || details.event_source || null
})

const logAuthDiagnostic = (eventName, details = {}, level = 'info') => {
  logAppEvent(eventName, {
    level,
    screen: 'app',
    operation: 'auth restore',
    duration_ms: details.duration_ms ?? null,
    metadata: getAuthDiagnosticMetadata(details)
  })
}

const isIosStandalonePwa = () => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false

  const userAgent = navigator.userAgent || ''
  const isIos = /iPad|iPhone|iPod/.test(userAgent) || (
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  )

  return isIos && (
    window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches
  )
}

const detectIosWebviewRestart = () => {
  if (!isIosStandalonePwa()) return false
  if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') return false

  try {
    const hadPreviousBoot = Boolean(localStorage.getItem(IOS_LAST_BOOT_KEY))
    const hasCurrentSession = Boolean(sessionStorage.getItem(IOS_BOOT_SESSION_KEY))
    const bootId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    sessionStorage.setItem(IOS_BOOT_SESSION_KEY, bootId)
    localStorage.setItem(IOS_LAST_BOOT_KEY, bootId)

    return hadPreviousBoot && !hasCurrentSession
  } catch {
    return false
  }
}

async function ensureUserProfile(user, source = 'unknown') {
  if (!user?.id) return
  if (profileSetupInFlight.has(user.id)) {
    console.info('[CalCheck] PROFILE_FETCH_BLOCKED_BY_DEDUPE', {
      source,
      user_id: user.id,
      layer: 'profileSetupInFlight'
    })
    console.info('[CalCheck] profile setup deduped', { source, user_id: user.id })
    return
  }

  try {
    profileSetupInFlight.add(user.id)
    console.info('[CalCheck] PROFILE_FETCH_START', {
      source,
      user_id: user.id,
      email: user.email,
      mode: 'ensure-user-profile'
    })
    await trackStartupStep(
      'profile fetch',
      () => getOrCreateUserProfile(user.id, user.email),
      {
        blocksRender: false,
        timeoutMs: 5000,
        fallbackValue: null
      }
    )
    console.info('[CalCheck] PROFILE_FETCH_SUCCESS', {
      source,
      user_id: user.id,
      mode: 'ensure-user-profile'
    })
  } catch (error) {
    logSafeError('SUPABASE_OPERATION_FAILED', error, {
      source,
      user_id: user.id,
      mode: 'ensure-user-profile'
    })
  } finally {
    profileSetupInFlight.delete(user.id)
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authStatus, setAuthStatus] = useState('restoring')
  const [resumeSignal, setResumeSignal] = useState(0)
  const [appRecoveryKey, setAppRecoveryKey] = useState(0)
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(
    localStorage.getItem('calcheck-onboarded') === 'true'
  )
  const authCheckRef = useRef(0)
  const lastResumeAtRef = useRef(0)
  const loadingRef = useRef(loading)
  const userRef = useRef(user)
  const startupStartedAtRef = useRef(Date.now())
  const appReadyLoggedRef = useRef(false)

  useEffect(() => {
    const displayMode = window.matchMedia?.('(display-mode: standalone)')?.matches
      ? 'standalone'
      : 'browser'
    const buildDetails = {
      app_version: typeof __APP_VERSION__ === 'undefined' ? '0.1.0' : __APP_VERSION__,
      build_timestamp: typeof __BUILD_TIMESTAMP__ === 'undefined' ? null : __BUILD_TIMESTAMP__,
      display_mode: displayMode,
      user_agent: (navigator.userAgent || 'unknown').slice(0, 180)
    }

    console.info('[CalCheck] APP_BUILD_LOADED', buildDetails)
    logAppEvent('APP_BUILD_LOADED', {
      level: 'info',
      screen: 'app',
      operation: 'app build loaded',
      metadata: buildDetails
    })
  }, [])

  useEffect(() => {
    userRef.current = user
    setDiagnosticsUser(user)
  }, [user])

  useEffect(() => {
    loadingRef.current = loading

    if (!loading && !appReadyLoggedRef.current) {
      appReadyLoggedRef.current = true
      recordStartupStep({
        name: 'app ready',
        startTime: new Date(startupStartedAtRef.current).toISOString(),
        endTime: new Date().toISOString(),
        durationMs: Date.now() - startupStartedAtRef.current,
        success: true,
        timedOut: false,
        blocksRender: true,
        timeoutMs: 5000
      })

      window.setTimeout(() => {
        preloadRazorpayCheckout('app-ready-idle')
      }, 1500)
      preloadLazyModuleWhenIdle('ProgressScreen', preloadProgressScreen, { screen: 'app', reason: 'app-ready' })
      preloadLazyModuleWhenIdle('ProfileScreen', preloadProfileScreen, { screen: 'app', reason: 'app-ready' })
      preloadLazyModuleWhenIdle('InfoPage', preloadInfoPage, { screen: 'app', reason: 'app-ready' })
    }
  }, [loading])

  const revalidateAuth = useCallback(async (source = 'startup') => {
    const checkId = authCheckRef.current + 1
    authCheckRef.current = checkId
    const isStartup = source === 'startup'
    const restoreTimeoutMs = isStartup
      ? STARTUP_SESSION_RESTORE_TIMEOUT_MS
      : RESUME_SESSION_RESTORE_TIMEOUT_MS

    const commitSessionResult = async (sessionResult, commitSource, { allowRefresh = true } = {}) => {
      if (authCheckRef.current !== checkId) {
        console.warn('[CalCheck] USER_FETCH_FAILED', {
          source: commitSource,
          checkId,
          stage: 'auth commit',
          reason: 'stale-auth-check',
          currentCheckId: authCheckRef.current
        })
        return
      }

      if (sessionResult?.error) {
        logAuthOutcome('SESSION_RESTORE_FAILED', {
          source: commitSource,
          checkId,
          preservedUserId: userRef.current?.id || null,
          error: sessionResult.error
        })
        logAuthOutcome('AUTH_NETWORK_ERROR', {
          source: commitSource,
          checkId,
          stage: 'session restore',
          preservedUserId: userRef.current?.id || null,
          error: sessionResult.error
        })
        logAuthDiagnostic('AUTH_RESTORE_FAILED', {
          source: commitSource,
          auth_status: userRef.current?.id ? 'authenticated' : 'restoring'
        }, 'warn')
        setAuthStatus(userRef.current?.id ? 'authenticated' : 'restoring')
        setLoading(false)
        return
      }

      const session = sessionResult?.data?.session || null
      let activeSession = session

      if (session && allowRefresh) {
        const refreshResult = await trackStartupStep(
          'session refresh',
          () => trackApiRequest(
            'auth session refresh',
            () => supabase.auth.refreshSession(),
            { dedupeKey: 'auth-session-refresh' }
          ),
          {
            blocksRender: false,
            timeoutMs: RESUME_SESSION_RESTORE_TIMEOUT_MS,
            fallbackValue: timedOutSessionFallback
          }
        )
        const { data, error } = refreshResult || {}
        if (refreshResult?.__calcheckTimedOut) {
          logAuthOutcome('AUTH_TIMEOUT', {
            source: commitSource,
            checkId,
            stage: 'session refresh',
            preservedUserId: session.user?.id || userRef.current?.id || null
          })
          activeSession = session
        }
        if (error) {
          logAuthOutcome('AUTH_NETWORK_ERROR', {
            source: commitSource,
            checkId,
            stage: 'session refresh',
            preservedUserId: session.user?.id || userRef.current?.id || null,
            error
          })
          console.warn('[CalCheck] session refresh skipped or failed', error)
        } else if (data?.session) {
          activeSession = data.session
        }
      }

      if (authCheckRef.current !== checkId) return

      const sessionUser = activeSession?.user || null
      setAuthStatus(sessionUser ? 'authenticated' : 'signed_out')
      if (!sessionUser) {
        logAuthOutcome('AUTH_SIGNED_OUT', {
          source: commitSource,
          checkId,
          stage: 'session restore',
          previousUserId: userRef.current?.id || null,
          reason: 'confirmed-missing-session'
        })
      }
      console.info('[CalCheck] USER_FETCH_SUCCESS', {
        source: commitSource,
        checkId,
        hasSession: Boolean(activeSession),
        hasUser: Boolean(sessionUser),
        user_id: sessionUser?.id || null,
        expires_at: activeSession?.expires_at || null
      })
      logAuthOutcome('SESSION_RESTORE_SUCCESS', {
        source: commitSource,
        checkId,
        hasSession: Boolean(activeSession),
        user_id: sessionUser?.id || null
      })
      logAuthDiagnostic(sessionUser ? 'AUTH_RESTORE_SUCCESS' : 'AUTH_RESTORE_SIGNED_OUT', {
        source: commitSource,
        hasSession: Boolean(activeSession),
        auth_status: sessionUser ? 'authenticated' : 'signed_out'
      })
      setUser(sessionUser)
      setLoading(false)
      ensureUserProfile(sessionUser, commitSource)
      console.info('[CalCheck] data refresh completed', { source: commitSource, target: 'auth' })
    }

    try {
      console.info('[CalCheck] data refresh started', { source, target: 'auth' })
      logAuthOutcome('SESSION_RESTORE_START', { source, checkId, timeoutMs: restoreTimeoutMs })
      logAuthDiagnostic('AUTH_RESTORE_STARTED', { source, auth_status: userRef.current?.id ? 'authenticated' : 'restoring' })
      console.info('[CalCheck] USER_FETCH_START', {
        source,
        checkId,
        visibilityState: document.visibilityState,
        online: navigator.onLine
      })
      const restorePromise = trackApiRequest(
        'auth session load',
        () => supabase.auth.getSession(),
        { dedupeKey: 'auth-session-load' }
      )
      const sessionResult = await trackStartupStep(
        'session restore',
        () => restorePromise,
        {
          blocksRender: isStartup,
          timeoutMs: restoreTimeoutMs,
          fallbackValue: timedOutSessionFallback
        }
      )
      if (sessionResult?.__calcheckTimedOut) {
        logAuthOutcome('SESSION_RESTORE_TIMEOUT', {
          source,
          checkId,
          stage: 'session restore',
          preservedUserId: userRef.current?.id || null
        })
        logAuthDiagnostic('AUTH_RESTORE_TIMEOUT', {
          source,
          auth_status: userRef.current?.id ? 'authenticated' : 'restoring'
        }, 'warn')
        logAuthOutcome('AUTH_TIMEOUT', {
          source,
          checkId,
          stage: 'session restore',
          preservedUserId: userRef.current?.id || null
        })
        console.error('[CalCheck] USER_FETCH_FAILED', {
          source,
          checkId,
          stage: 'session restore',
          reason: 'timeout-fallback'
        })
        restorePromise
          .then((lateResult) => commitSessionResult(lateResult, `${source}-late-session`, {
            allowRefresh: !isStartup
          }))
          .catch((error) => {
            logAuthOutcome('SESSION_RESTORE_FAILED', {
              source: `${source}-late-session`,
              checkId,
              preservedUserId: userRef.current?.id || null,
              error
            })
            logAuthDiagnostic('AUTH_RESTORE_FAILED', {
              source: `${source}-late-session`,
              auth_status: userRef.current?.id ? 'authenticated' : 'restoring'
            }, 'warn')
          })
        if (userRef.current?.id) {
          setAuthStatus('authenticated')
          setLoading(false)
          console.info('[CalCheck] data refresh completed', {
            source,
            target: 'auth',
            preservedUser: true,
            reason: 'session-restore-timeout'
          })
          return
        }
        setAuthStatus('restoring')
        setLoading(false)
        return
      }
      await commitSessionResult(sessionResult, source, { allowRefresh: !isStartup })
    } catch (error) {
      logAuthOutcome('SESSION_RESTORE_FAILED', {
        source,
        checkId,
        preservedUserId: userRef.current?.id || null,
        error
      })
      logAuthDiagnostic('AUTH_RESTORE_FAILED', {
        source,
        auth_status: userRef.current?.id ? 'authenticated' : 'restoring'
      }, 'warn')
      logAuthOutcome('AUTH_NETWORK_ERROR', {
        source,
        checkId,
        stage: 'auth check',
        preservedUserId: userRef.current?.id || null,
        error
      })
      logSafeError('SUPABASE_OPERATION_FAILED', error, {
        source,
        checkId,
        operation: 'auth check'
      })
      if (!userRef.current?.id) {
        setAuthStatus('restoring')
      }
    } finally {
      if (authCheckRef.current === checkId) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (detectIosWebviewRestart()) {
      logAuthOutcome('IOS_WEBVIEW_RESTART_DETECTED', {
        source: 'startup',
        visibilityState: document.visibilityState
      })
      recordAppLifecycleEvent('IOS_WEBVIEW_RESTART_DETECTED', {
        source: 'startup',
        visibilityState: document.visibilityState
      })
    }

    revalidateAuth('startup')

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.info('[CalCheck] auth state changed', { event })
      const sessionUser = session?.user || null
      if (!sessionUser && !isExplicitSignedOutEvent(event)) {
        logAuthOutcome('AUTH_NETWORK_ERROR', {
          source: `auth-${event}`,
          stage: 'auth listener',
          reason: 'null-session-without-signed-out-event',
          preservedUserId: userRef.current?.id || null
        })
        return
      }
      if (!sessionUser && isExplicitSignedOutEvent(event)) {
        logAuthOutcome('AUTH_SIGNED_OUT', {
          source: `auth-${event}`,
          stage: 'auth listener',
          previousUserId: userRef.current?.id || null
        })
        logAuthDiagnostic('AUTH_RESTORE_SIGNED_OUT', { source: `auth-${event}`, auth_status: 'signed_out' })
        setAuthStatus('signed_out')
      }
      setUser(sessionUser)
      if (sessionUser) {
        setAuthStatus('authenticated')
        ensureUserProfile(sessionUser, `auth-${event}`)
      }
    })

    return () => subscription?.unsubscribe()
  }, [revalidateAuth])

  useEffect(() => {
    const handleResume = (source) => {
      recordAppLifecycleEvent('resume event received', {
        source,
        visibilityState: document.visibilityState,
        loading: loadingRef.current
      })

      if (document.visibilityState === 'hidden') {
        recordAppLifecycleEvent('resume ignored hidden', { source })
        return
      }
      if (loadingRef.current) {
        console.info('[CalCheck] resume ignored during startup', { source })
        recordAppLifecycleEvent('resume ignored during startup', { source })
        return
      }
      const now = Date.now()
      const msSinceLastResume = now - lastResumeAtRef.current
      if (msSinceLastResume < 1000) {
        recordAppLifecycleEvent('duplicate resume ignored', { source, msSinceLastResume })
        return
      }
      lastResumeAtRef.current = now

      console.info('[CalCheck] app resumed', { source })
      recordAppLifecycleEvent('resume accepted', { source })
      setResumeSignal((value) => value + 1)
      revalidateAuth(source)
    }

    const handleVisibilityChange = () => {
      console.info('[CalCheck] visibility changed', { state: document.visibilityState })
      recordAppLifecycleEvent('visibilitychange', { state: document.visibilityState })
      if (document.visibilityState === 'hidden') {
        authCheckRef.current += 1
        abortLifecycleRequests('visibility hidden')
        return
      }

      if (document.visibilityState === 'visible') {
        handleResume('visibilitychange')
      }
    }

    const handleFocus = () => handleResume('focus')
    const handlePageShow = (event) => {
      recordAppLifecycleEvent('pageshow', { persisted: Boolean(event.persisted) })
      handleResume(event.persisted ? 'pageshow-bfcache' : 'pageshow')
    }
    const handlePageHide = (event) => {
      recordAppLifecycleEvent('pagehide', { persisted: Boolean(event.persisted) })
      authCheckRef.current += 1
      abortLifecycleRequests(event.persisted ? 'pagehide bfcache' : 'pagehide')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [revalidateAuth])

  useEffect(() => {
    if (!loading) return undefined

    const retryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { target: 'app-auth', seconds: 5 })
      authCheckRef.current += 1
      setLoading(false)
      setAppRecoveryKey((value) => value + 1)
      revalidateAuth('app-auth-background-recovery')
    }, 5000)

    return () => {
      window.clearTimeout(retryTimer)
    }
  }, [loading, revalidateAuth])

  if (loading) {
    return <AuthRecoveryScreen authStatus={authStatus} source="initial-loading" />
  }

  const isAuthRestoring = authStatus === 'restoring' && !user

  return (
    <ErrorBoundary>
      <MealDataProvider>
      <Router>
      <div className="h-screen w-screen flex flex-col bg-white overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/info/:slug" element={<LazyRouteFallback screen="info"><InfoPage /></LazyRouteFallback>} />
            <Route
              path="/"
              element={
                isAuthRestoring
                  ? <AuthRecoveryScreen authStatus={authStatus} source="root-route" />
                  : !hasSeenOnboarding && !user
                  ? <OnboardingScreen onComplete={() => setHasSeenOnboarding(true)} />
                  : <ScanScreen key={`scan-${appRecoveryKey}`} user={user} resumeSignal={resumeSignal} authStatus={authStatus} />
              }
            />
            <Route
              path="/progress"
              element={
                user
                  ? <LazyRouteFallback screen="progress" fallback={<ProgressSkeleton />}><ProgressScreen key={`progress-${appRecoveryKey}`} user={user} resumeSignal={resumeSignal} /></LazyRouteFallback>
                  : isAuthRestoring
                    ? <AuthRecoveryScreen authStatus={authStatus} source="auth-route" />
                    : <Navigate to="/" />
              }
            />
            <Route
              path="/profile"
              element={
                user
                  ? <LazyRouteFallback screen="profile" fallback={<ProfileSkeleton />}><ProfileScreen user={user} /></LazyRouteFallback>
                  : isAuthRestoring
                    ? <AuthRecoveryScreen authStatus={authStatus} source="auth-route" />
                    : <Navigate to="/" />
              }
            />
          </Routes>
        </div>

        {user && <BottomNav />}
      </div>
      </Router>
      </MealDataProvider>
    </ErrorBoundary>
  )
}

function AuthRecoveryScreen({ authStatus = 'restoring', source = 'unknown' }) {
  useEffect(() => {
    logAuthDiagnostic('APP_AUTH_SHELL_RENDERED', { source, auth_status: authStatus })
    logAuthDiagnostic('AUTH_SIGNIN_UI_SUPPRESSED_DURING_RESTORE', { source, auth_status: authStatus })
  }, [authStatus, source])

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#FFF9F2] px-6">
      <div className="w-full max-w-sm rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white/90 p-6 text-center shadow-[0_18px_50px_rgba(21,26,34,0.08)]">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full border-4 border-[#E7D9C2] border-t-[#151A22] motion-safe:animate-spin" />
        <p className="text-sm font-black text-[#151A22]">Restoring session...</p>
        <p className="mt-1 text-xs font-semibold text-[#6B7280]">Keeping your latest app state ready.</p>
      </div>
    </div>
  )
}

function LazyRouteFallback({ children, fallback = <ScreenSkeleton />, screen = 'screen' }) {
  return (
    <Suspense fallback={<LoggedSuspenseFallback screen={screen} fallback={fallback} />}>
      <LazyReadyMarker screen={screen} />
      {children}
    </Suspense>
  )
}

function LoggedSuspenseFallback({ screen, fallback }) {
  useEffect(() => {
    logAppEvent('LAZY_ROUTE_FALLBACK_RENDERED', {
      level: 'info',
      screen,
      operation: 'lazy route fallback'
    })
  }, [screen])

  return fallback
}

function LazyReadyMarker({ screen }) {
  useEffect(() => {
    logAppEvent('LAZY_MODULE_LOADED', {
      level: 'info',
      screen,
      operation: 'lazy route rendered',
      metadata: { route: screen }
    })
  }, [screen])

  return null
}

export default App
