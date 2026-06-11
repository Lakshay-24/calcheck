import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'

export default function OnboardingScreen({ onComplete }) {
  const [isLoading, setIsLoading] = useState(false)

  const handleGetStarted = async () => {
    setIsLoading(true)
    // Simulate permission check
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      })
      stream.getTracks().forEach(track => track.stop())
      localStorage.setItem('calcheck-onboarded', 'true')
      onComplete?.()
    } catch (error) {
      console.error('Camera permission needed:', error)
      // Still complete onboarding even if permission denied
      localStorage.setItem('calcheck-onboarded', 'true')
      onComplete?.()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Background gradient accent */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-b from-green-50 to-transparent opacity-60 -z-10"></div>
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-gradient-to-t from-green-50 to-transparent opacity-40 -z-10"></div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        {/* Icon/Logo */}
        <div className="mb-8">
          <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-600 rounded-3xl flex items-center justify-center shadow-lg">
            <div className="text-5xl">📸</div>
          </div>
        </div>

        {/* Headline */}
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-4 leading-tight">
          Snap Food
        </h1>

        {/* Subheading */}
        <p className="text-xl md:text-2xl text-gray-600 mb-6 leading-relaxed max-w-md">
          Track calories & protein in seconds
        </p>

        {/* Description */}
        <div className="max-w-md space-y-3 mb-12">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-1">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
            <p className="text-gray-600 text-left">
              Take a photo of any meal
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-1">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
            <p className="text-gray-600 text-left">
              AI analyzes nutrition instantly
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-1">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
            <p className="text-gray-600 text-left">
              Track your daily progress
            </p>
          </div>
        </div>

        {/* Trust indicators */}
        <div className="mb-12 space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">
            Powered by
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
            <span className="font-semibold">OpenAI</span>
            <span className="text-gray-400">•</span>
            <span className="font-semibold">Instant Results</span>
          </div>
        </div>

        {/* CTA Button */}
        <button
          onClick={handleGetStarted}
          disabled={isLoading}
          className="w-full max-w-sm bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-4 px-8 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed active:scale-95"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Requesting Permission...</span>
            </>
          ) : (
            <>
              <span>Get Started</span>
              <ChevronRight size={20} className="transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>

        {/* Privacy note */}
        <p className="text-xs text-gray-500 mt-6">
          We never store your photos. Your data is private.
        </p>
      </div>

      {/* Bottom decorative element */}
      <div className="h-1 bg-gradient-to-r from-transparent via-green-200 to-transparent"></div>
    </div>
  )
}
