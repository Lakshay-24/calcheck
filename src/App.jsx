// App shell - routes and main layout
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './services/supabase.js'
import { getOrCreateUserProfile } from './services/database'
import './index.css'

import ScanScreen from './screens/ScanScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import ProgressScreen from './screens/ProgressScreen'
import ProfileScreen from './screens/ProfileScreen'
import BottomNav from './components/BottomNav'

async function ensureUserProfile(user) {
  if (!user?.id) return
  try {
    await getOrCreateUserProfile(user.id, user.email)
  } catch (error) {
    console.error('Profile setup error:', error)
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

  const revalidateAuth = useCallback(async (source = 'startup') => {
    const checkId = authCheckRef.current + 1
    authCheckRef.current = checkId

    try {
      console.info('[CalCheck] data refresh started', { source, target: 'auth' })
      const { data: { session } } = await supabase.auth.getSession()
      let activeSession = session

      if (session) {
        const { data, error } = await supabase.auth.refreshSession()
        if (error) {
          console.warn('[CalCheck] session refresh skipped or failed', error)
        } else if (data?.session) {
          activeSession = data.session
        }
      }

      if (authCheckRef.current !== checkId) return

      const sessionUser = activeSession?.user || null
      setUser(sessionUser)
      await ensureUserProfile(sessionUser)
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
        await ensureUserProfile(sessionUser)
      }
    })

    return () => subscription?.unsubscribe()
  }, [revalidateAuth])

  useEffect(() => {
    const handleResume = (source) => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastResumeAtRef.current < 1000) return
      lastResumeAtRef.current = now

      console.info('[CalCheck] app resumed', { source })
      setResumeSignal((value) => value + 1)
      revalidateAuth(source)
    }

    const handleVisibilityChange = () => {
      console.info('[CalCheck] visibility changed', { state: document.visibilityState })
      if (document.visibilityState === 'visible') {
        handleResume('visibilitychange')
      }
    }

    const handleFocus = () => handleResume('focus')
    const handlePageShow = (event) => handleResume(event.persisted ? 'pageshow-bfcache' : 'pageshow')

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [revalidateAuth])

  useEffect(() => {
    if (!loading) return undefined

    const retryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { target: 'app-auth', seconds: 5 })
      revalidateAuth('app-auth-timeout-retry')
    }, 5000)

    const recoveryTimer = window.setTimeout(() => {
      console.warn('[CalCheck] loading timeout triggered', { target: 'app-auth', seconds: 10 })
      setLoading(false)
      setAppRecoveryKey((value) => value + 1)
      revalidateAuth('app-auth-soft-recovery')
    }, 10000)

    return () => {
      window.clearTimeout(retryTimer)
      window.clearTimeout(recoveryTimer)
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

  if (!hasSeenOnboarding && !user) {
    return <OnboardingScreen onComplete={() => setHasSeenOnboarding(true)} />
  }

  return (
    <Router>
      <div className="h-screen w-screen flex flex-col bg-white overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <Routes>
            <Route
              path="/"
              element={<ScanScreen key={`scan-${appRecoveryKey}`} user={user} resumeSignal={resumeSignal} />}
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
