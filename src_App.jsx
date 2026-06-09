// Main App component with routing
import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './src_services_supabase'
import './src_index.css'

// Screens
import ScanScreen from './ScanScreen'
import ProgressScreen from './ProgressScreen'
import ProfileScreen from './ProfileScreen'
import OnboardingScreen from './OnboardingScreen'

// Components
import BottomNav from './BottomNav'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(localStorage.getItem('calcheck-onboarded') === 'true')

  useEffect(() => {
    // Check for existing session
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setUser(session?.user || null)
      } catch (error) {
        console.error('Auth check error:', error)
      } finally {
        setLoading(false)
      }
    }

    checkAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null)
    })

    return () => subscription?.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
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
            <Route path="/" element={<ScanScreen user={user} />} />
            <Route path="/progress" element={user ? <ProgressScreen user={user} /> : <Navigate to="/" />} />
            <Route path="/profile" element={user ? <ProfileScreen user={user} /> : <Navigate to="/" />} />
          </Routes>
        </div>

        {user && <BottomNav />}
      </div>
    </Router>
  )
}

export default App
