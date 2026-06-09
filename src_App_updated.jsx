// App shell - routes and main layout
import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './services/supabase.js'
import './index.css'

// Screens
import ScanScreen from './screens/ScanScreen'
import OnboardingScreen from './screens/OnboardingScreen'

// Components
import BottomNav from './components/BottomNav'

// Placeholder screens for coming soon
const ProgressScreen = () => (
  <div className="h-full overflow-y-auto pb-24 px-6 py-6">
    <h1 className="text-2xl font-bold mb-4">Progress Screen</h1>
    <p className="text-gray-600">Coming soon in Phase 3...</p>
  </div>
)
const ProfileScreen = () => (
  <div className="h-full overflow-y-auto pb-24 px-6 py-6">
    <h1 className="text-2xl font-bold mb-4">Profile Screen</h1>
    <p className="text-gray-600">Coming soon in Phase 3...</p>
  </div>
)

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(
    localStorage.getItem('calcheck-onboarded') === 'true'
  )

  useEffect(() => {
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
            <Route path="/progress" element={user ? <ProgressScreen /> : <Navigate to="/" />} />
            <Route path="/profile" element={user ? <ProfileScreen /> : <Navigate to="/" />} />
          </Routes>
        </div>

        {user && <BottomNav />}
      </div>
    </Router>
  )
}

export default App
