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
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-green-50 to-white">

      {/* Loader */}
      <div className="relative mb-10">
        <div className="w-28 h-28 rounded-full border-4 border-green-200 animate-spin"></div>

        <div className="absolute inset-3 rounded-full bg-gradient-to-r from-green-400 to-green-600 animate-pulse"></div>

        <div className="absolute inset-0 flex items-center justify-center text-3xl">
          🍽️
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Analyzing your meal
      </h2>

      <p className="text-gray-500 text-center mb-8">
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
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                  <Check size={14} className="text-white" />
                </div>
              ) : active ? (
                <div className="w-6 h-6 rounded-full border-2 border-green-500 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-ping"></div>
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-gray-200"></div>
              )}

              <span
                className={`text-sm ${
                  active
                    ? 'font-semibold text-gray-900'
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

      {/* Loading dots */}
      <div className="flex gap-2 mt-10">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce"></div>
        <div
          className="w-2 h-2 bg-green-500 rounded-full animate-bounce"
          style={{ animationDelay: '0.15s' }}
        />
        <div
          className="w-2 h-2 bg-green-500 rounded-full animate-bounce"
          style={{ animationDelay: '0.3s' }}
        />
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Analysis usually takes 5–10 seconds
      </p>

    </div>
  )
}