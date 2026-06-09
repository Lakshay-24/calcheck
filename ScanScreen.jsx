import React from 'react'

export default function ScanScreen({ user }) {
  return (
    <div className="h-full w-full p-4 flex flex-col items-center justify-center bg-white">
      <div className="text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">📸</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Scan Food</h1>
        <p className="text-gray-500">Take a photo of your meal to analyze nutrition</p>
      </div>
    </div>
  )
}
