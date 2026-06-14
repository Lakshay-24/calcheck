import React from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export default function OnboardingScreen({ onComplete }) {
  const handleGetStarted = () => {
    localStorage.setItem('calcheck-onboarded', 'true')
    onComplete?.()
  }

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-b from-brand-50 to-transparent opacity-80 -z-10" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-gradient-to-t from-brand-50 to-transparent opacity-60 -z-10" />

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="mb-8">
          <div className="w-24 h-24 rounded-3xl overflow-hidden shadow-brand">
            <img
              src="/logo.png"
              alt="calcheck"
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        <h1 className="text-5xl md:text-6xl font-bold text-ink mb-4 leading-tight">
          CalCheck AI
        </h1>

        <p className="text-xl md:text-2xl text-muted mb-6 leading-relaxed max-w-md">
          Track calories & protein in seconds
        </p>

        <div className="max-w-md space-y-3 mb-12">
          {[
            'Take a photo of any meal',
            'AI analyzes nutrition instantly',
            'Track your daily progress'
          ].map((item) => (
            <div key={item} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0 mt-1">
                <div className="w-2 h-2 bg-brand-500 rounded-full" />
              </div>
              <p className="text-muted text-left">{item}</p>
            </div>
          ))}
        </div>

        <div className="mb-12 space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">
            Powered by
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted">
            <span className="font-semibold">OpenAI</span>
            <span className="text-gray-400">-</span>
            <span className="font-semibold">Instant Results</span>
          </div>
        </div>

        <button
          onClick={handleGetStarted}
          className="w-full max-w-sm bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-brand-900 font-semibold py-4 px-8 rounded-2xl shadow-brand hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
        >
          <span>Get Started</span>
          <ChevronRight size={20} />
        </button>

        <p className="text-xs text-gray-500 mt-6 max-w-sm leading-5">
          Food photos are processed for AI nutrition estimates. CalCheck AI is not a medical app.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-semibold text-gray-500">
          <Link to="/info/terms" className="hover:text-gray-800">Terms</Link>
          <Link to="/info/privacy" className="hover:text-gray-800">Privacy</Link>
          <Link to="/info/about" className="hover:text-gray-800">About</Link>
        </div>
      </div>

      <div className="h-1 bg-gradient-to-r from-transparent via-brand-300 to-transparent" />
    </div>
  )
}
