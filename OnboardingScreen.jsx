import React from 'react'

export default function OnboardingScreen({ onComplete }) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-green-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-green-600 mb-4">CalCheck</h1>
        <p className="text-lg text-gray-600 mb-8">Snap food. Track calories & protein.</p>
        <button
          onClick={onComplete}
          className="px-8 py-3 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition"
        >
          Get Started
        </button>
      </div>
    </div>
  )
}
