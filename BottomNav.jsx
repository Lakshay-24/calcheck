import React from 'react'

export default function BottomNav() {
  return (
    <nav className="bg-white border-t border-gray-200 flex justify-around py-3">
      <button className="flex flex-col items-center text-green-500">
        <span className="text-2xl mb-1">📸</span>
        <span className="text-xs font-semibold">Scan</span>
      </button>
      <button className="flex flex-col items-center text-gray-400">
        <span className="text-2xl mb-1">📊</span>
        <span className="text-xs font-semibold">Progress</span>
      </button>
      <button className="flex flex-col items-center text-gray-400">
        <span className="text-2xl mb-1">👤</span>
        <span className="text-xs font-semibold">Profile</span>
      </button>
    </nav>
  )
}
