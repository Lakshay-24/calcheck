// App shell - routes and main layout
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './services/supabase.js'
import { getOrCreateUserProfile } from './services/database'
import { recordStartupStep, trackApiRequest, trackStartupStep } from './services/diagnostics'
import { abortLifecycleRequests, recordAppLifecycleEvent } from './services/lifecycle'
import './index.css'

import ScanScreen from './screens/ScanScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import ProgressScreen from './screens/ProgressScreen'
import ProfileScreen from './screens/ProfileScreen'
import InfoPage from './screens/InfoPage'
import BottomNav from './components/BottomNav'

const profileSetupInFlight = new Set()

async function ensureUserProfile(user, source = 'unknown') {
  if (!user?.id) return
  if (profileSetupInFlight.has(user.id)) {
    console.info('[CalCheck] profile setup deduped', { source, user_id: user.id })
    return
  }

  try {
    profileSetupInFlight.add(user.id)
    await trackStartupStep(
      'profile fetch',
      () => getOrCreateUserProfile(user.id, user.email),
      {
        blocksRender: false,
        timeoutMs: 5000,
        fallbackValue: null
      }
    )
  } catch (error) {
    console.error('Profile setup error:', { source, error })
  } finally {
    profileSetupInFlight.delete(user.id)
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resumeSignal, setResumeSignal] = useState(0)
  const [appRecoveryKey, setAppRecoveryKey] = useState(0)
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(
    localStorage.getItem('calcheck-onboarded') === 'true'
  )
  const authCheckRef = useRef(0)
  const lastResumeAtRef = useRef(0)
  const loadingRef = useRef(loading)
  const startupStartedAtRef = useRef(Date.now())
  const appReadyLoggedRef = useRef(false)

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
    }
  }, [loading])

  const revalidateAuth = useCallback(async (source = 'startup') => {
    const checkId = authCheckRef.current + 1
    authCheckRef.current = checkId

    try {
      console.info('[CalCheck] data refresh started', { source, target: 'auth' })
      const sessionResult = await trackStartupStep(
        'session restore',
        () => trackApiRequest(
          'auth session load',
          () => supabase.auth.getSession(),
          { dedupeKey: 'auth-session-load' }
        ),
        {
          blocksRender: source === 'startup',
          timeoutMs: 5000,
          fallbackValue: { data: { session: null }, error: null }
        }
      )
      const session = sessionResult?.data?.session || null
      let activeSession = session

      if (session) {
        const refreshResult = await trackStartupStep(
          'session refresh',
          () => trackApiRequest(
            'auth session refresh',
            () => supabase.auth.refreshSession(),
            { dedupeKey: 'auth-session-refresh' }
          ),
          {
            blocksRender: source === 'startup',
            timeoutMs: 5000,
            fallbackValue: { data: { session: null }, error: null }
          }
        )
        const { data, error } = refreshResult || {}
        if (error) {
          console.warn('[CalCheck] session refresh skipped or failed', error)
        } else if (data?.session) {
          activeSession = data.session
        }
      }

      if (authCheckRef.current !== checkId) return

      const sessionUser = activeSession?.user || null
      setUser(sessionUser)
      setLoading(false)
      ensureUserProfile(sessionUser, source)
      console.info('[CalCheck] data refresh completed', { source, target: 'auth' })
    } catch (error) {
      console.error('[CalCheck] Auth check error:', error)
    } finally {
      if (authCheckRef.current === checkId) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    revalidateAuth('startup')

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.info('[CalCheck] auth state changed', { event })
      const sessionUser = session?.user || null
      setUser(sessionUser)
      if (sessionUser) {
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
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <Router>
      <div className="h-screen w-screen flex flex-col bg-white overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/info/:slug" element={<InfoPage />} />
            <Route
              path="/"
              element={
                !hasSeenOnboarding && !user
                  ? <OnboardingScreen onComplete={() => setHasSeenOnboarding(true)} />
                  : <ScanScreen key={`scan-${appRecoveryKey}`} user={user} resumeSignal={resumeSignal} />
              }
            />
            <Route
              path="/progress"
              element={
                user
                  ? <ProgressScreen key={`progress-${appRecoveryKey}`} user={user} resumeSignal={resumeSignal} />
                  : <Navigate to="/" />
              }
            />
            <Route path="/profile" element={user ? <ProfileScreen user={user} /> : <Navigate to="/" />} />
          </Routes>
        </div>

        {user && <BottomNav />}
      </div>
    </Router>
  )
}

export default App
