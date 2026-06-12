import React, { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

const STEPS = [
  'Processing image',
  'Identifying food',
  'Calculating nutrition',
  'Finalizing analysis'
]

export default function AnalysisScreen() {
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    const timers = [
      setTimeout(() => setActiveStep(1), 1000),
      setTimeout(() => setActiveStep(2), 3000),
      setTimeout(() => setActiveStep(3), 6000)
    ]

    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-brand-50 to-white">
      <div className="relative mb-10">
        <div className="w-28 h-28 rounded-full border-4 border-brand-300 animate-spin" />
        <div className="absolute inset-3 rounded-full bg-gradient-to-r from-brand-400 to-brand-500 animate-pulse" />
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/logo.png"
            alt=""
            className="w-16 h-16 rounded-2xl object-cover shadow-brand"
          />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-ink mb-2">
        Analyzing your meal
      </h2>

      <p className="text-muted text-center mb-8">
        AI is estimating calories and nutrition
      </p>

      <div className="w-full max-w-sm space-y-4">
        {STEPS.map((step, index) => {
          const completed = index < activeStep
          const active = index === activeStep

          return (
            <div
              key={step}
              className={`flex items-center gap-3 transition-all duration-300 ${
                active ? 'scale-[1.02]' : ''
              }`}
            >
              {completed ? (
                <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center">
                  <Check size={14} className="text-brand-900" />
                </div>
              ) : active ? (
                <div className="w-6 h-6 rounded-full border-2 border-brand-500 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-brand-500 animate-ping" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-gray-200" />
              )}

              <span
                className={`text-sm ${
                  active
                    ? 'font-semibold text-ink'
                    : completed
                    ? 'text-gray-700'
                    : 'text-gray-400'
                }`}
              >
                {step}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 mt-10">
        <div className="w-2 h-2 bg-brand-500 rounded-full animate-bounce" />
        <div
          className="w-2 h-2 bg-brand-500 rounded-full animate-bounce"
          style={{ animationDelay: '0.15s' }}
        />
        <div
          className="w-2 h-2 bg-brand-500 rounded-full animate-bounce"
          style={{ animationDelay: '0.3s' }}
        />
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Analysis usually takes 5-10 seconds
      </p>
    </div>
  )
}
