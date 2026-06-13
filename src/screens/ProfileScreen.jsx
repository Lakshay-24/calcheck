import React, { useState } from 'react'
import { LogOut } from 'lucide-react'
import { InstallProfileCard } from '../components/InstallApp'
import { signOut } from '../services/supabase'

export default function ProfileScreen({ user }) {
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    try {
      setSigningOut(true)
      await signOut()
    } catch (error) {
      console.error('Sign out error:', error)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="h-full w-full bg-white overflow-y-auto pb-24">
      <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Your account</p>
      </div>

      <div className="px-6 py-6 space-y-6">
        <div className="bg-gradient-to-br from-brand-50 to-white border border-brand-300/50 rounded-2xl p-6">
          <div className="w-16 h-16 bg-gradient-to-br from-brand-400 to-brand-500 rounded-full flex items-center justify-center text-brand-900 text-2xl font-bold mb-4 shadow-brand">
            {user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <p className="text-sm text-gray-500">Signed in as</p>
          <p className="text-lg font-semibold text-gray-900 break-all">{user?.email}</p>
        </div>

        <InstallProfileCard />

        <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Account</p>
          <p className="text-sm text-gray-500">
            Meals are saved to your account and synced across sessions.
          </p>
        </div>

        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-4 px-6 rounded-2xl transition-all active:scale-95 disabled:opacity-70"
        >
          <LogOut size={20} />
          {signingOut ? 'Signing out...' : 'Sign Out'}
        </button>
      </div>
    </div>
  )
}
