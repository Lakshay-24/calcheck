import React from 'react'

export default function AnalysisScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-green-50 to-white">
      {/* Animated Loading Circle */}
      <div className="mb-8">
        <div className="relative w-24 h-24">
          {/* Outer rotating circle */}
          <div className="absolute inset-0 rounded-full border-4 border-green-200 animate-spin"></div>

          {/* Inner pulsing circle */}
          <div className="absolute inset-3 rounded-full bg-gradient-to-r from-green-400 to-green-600 opacity-80 animate-pulse"></div>

          {/* Center dot */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 bg-white rounded-full"></div>
          </div>
        </div>
      </div>

      {/* Loading Text */}
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Analyzing your meal...</h2>
      <p className="text-gray-500 text-center max-w-xs">
        Using AI to detect food and extract nutritional information
      </p>

      {/* Progress indicators */}
      <div className="mt-8 space-y-2 w-full max-w-xs">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm text-gray-600">Detecting food</span>
        </div>
        <div className="flex items-center gap-3 opacity-50">
          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
          <span className="text-sm text-gray-600">Calculating nutrition</span>
        </div>
        <div className="flex items-center gap-3 opacity-30">
          <div className="w-2 h-2 bg-green-300 rounded-full"></div>
          <span className="text-sm text-gray-600">Scoring meal</span>
        </div>
      </div>

      {/* Estimated time */}
      <p className="text-xs text-gray-400 mt-8">Takes 2-3 seconds</p>
    </div>
  )
}
