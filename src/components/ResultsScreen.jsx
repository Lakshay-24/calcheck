import React, { useState } from 'react'
import { ArrowLeft, Heart } from 'lucide-react'

export default function ResultsScreen({ result, image, onSave, onRetake, user, isSaving = false }) {
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave()
    } finally {
      setSaving(false)
    }
  }

  const savingState = isSaving || saving
  const confidence = result?.confidence ?? null
  const isLowConfidence = confidence !== null && confidence < 0.6
  const candidates = (result?.candidates || []).filter(
    (c) => c.name && c.name !== result?.food_name
  )

  const getConfidenceLabel = (value) => {
    if (value >= 0.8) return { text: 'High confidence', className: 'bg-green-100 text-green-800' }
    if (value >= 0.6) return { text: 'Moderate confidence', className: 'bg-yellow-100 text-yellow-800' }
    return { text: 'Low confidence', className: 'bg-orange-100 text-orange-800' }
  }

  const getProteinColor = (level) => {
    switch (level) {
      case 'High':
        return 'bg-blue-100 text-blue-800'
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800'
      case 'Low':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getRecommendationColor = (rec) => {
    switch (rec) {
      case 'Fat Loss':
        return 'bg-green-100 text-green-800'
      case 'Muscle Gain':
        return 'bg-blue-100 text-blue-800'
      case 'Maintenance':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Image Preview */}
      {image && (
        <div className="relative w-full h-64 bg-gray-200 overflow-hidden">
          <img
            src={image}
            alt="Food"
            className="w-full h-full object-cover"
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white"></div>
        </div>
      )}

      {/* Content */}
      <div className="px-6 py-6 space-y-6">
        {/* Food Name */}
        <div>
          <h2 className="text-4xl font-bold text-gray-900 leading-tight">
            {result?.food_name || 'Meal'}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <p className="text-sm text-gray-500">Typical serving</p>
            {confidence !== null && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getConfidenceLabel(confidence).className}`}>
                {getConfidenceLabel(confidence).text} ({Math.round(confidence * 100)}%)
              </span>
            )}
          </div>
          {isLowConfidence && (
            <p className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-3 mt-3">
              This guess may be wrong. Try a clearer photo or check other possibilities below.
            </p>
          )}
          {candidates.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">
                Other possibilities
              </p>
              <div className="flex flex-wrap gap-2">
                {candidates.map((candidate) => (
                  <span
                    key={candidate.name}
                    className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded-full"
                  >
                    {candidate.name} ({Math.round(candidate.confidence * 100)}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Portion Estimate */}
{result?.portion_size && (
  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-4">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold text-indigo-700 uppercase tracking-widest">
          Estimated Portion
        </p>

        <p className="text-2xl font-bold text-indigo-900 mt-1">
          {result.portion_size}
        </p>

        {result.estimated_grams > 0 && (
          <p className="text-sm text-indigo-600 mt-1">
            ~{Math.round(result.estimated_grams)}g
          </p>
        )}
      </div>

      <div className="text-right">
        <p className="text-xs text-indigo-600">
          Quantity Confidence
        </p>

        <p className="text-lg font-semibold text-indigo-900">
          {Math.round(
            (result.portion_confidence ?? 0.5) * 100
          )}%
        </p>
      </div>
    </div>
  </div>
)}
        {/* Main Nutrition Display */}
        <div className="grid grid-cols-2 gap-4">
          {/* Calories */}
          <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 border border-orange-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-widest mb-1">
              Calories
            </p>
            <p className="text-4xl font-bold text-orange-900">
              {result?.calories || 0}
            </p>
            <p className="text-xs text-orange-600 mt-1">kcal</p>
          </div>

          {/* Protein */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-widest mb-1">
              Protein
            </p>
            <p className="text-4xl font-bold text-blue-900">
              {result?.protein || 0}
            </p>
            <p className="text-xs text-blue-600 mt-1">grams</p>
          </div>
        </div>

        {/* Meal Score Card */}
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-green-700">Meal Score</span>
            <Heart size={18} className="text-green-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-bold text-green-900">{result?.meal_score || 0}</span>
            <span className="text-lg text-green-700">/100</span>
          </div>
          <p className="text-xs text-green-600 mt-3">
            {result?.meal_score >= 80
              ? '⭐ Excellent macro balance'
              : result?.meal_score >= 60
              ? '👍 Good choice'
              : '📈 Could be better'}
          </p>
        </div>

        {/* Macros Breakdown */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-widest">
            Macronutrients
          </p>

          {/* Carbs */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🌾</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Carbs</p>
                <p className="text-xs text-gray-500">Energy source</p>
              </div>
            </div>
            <p className="text-lg font-bold text-gray-900">{result?.carbs || 0}g</p>
          </div>

          {/* Fat */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🫒</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Fat</p>
                <p className="text-xs text-gray-500">Essential nutrients</p>
              </div>
            </div>
            <p className="text-lg font-bold text-gray-900">{result?.fat || 0}g</p>
          </div>
        </div>

        {/* Badges */}
        <div className="flex gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getProteinColor(result?.protein_level)}`}>
            {result?.protein_level || 'Unknown'} Protein
          </span>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getRecommendationColor(result?.recommended_for)}`}>
            {result?.recommended_for || 'Maintenance'}
          </span>
        </div>

        {/* Buttons */}
        <div className="space-y-3 pt-4">
          {user ? (
            <button
              onClick={handleSave}
              disabled={savingState}
              className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-4 px-6 rounded-2xl transition-all active:scale-95 disabled:opacity-70"
            >
              {savingState ? 'Saving...' : 'Save Meal'}
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-4 px-6 rounded-2xl transition-all active:scale-95"
            >
              Login to Save
            </button>
          )}

          <button
            onClick={onRetake}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-4 px-6 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <ArrowLeft size={20} />
            Scan Another
          </button>
        </div>

        {/* Info */}
        <p className="text-xs text-gray-500 text-center pb-4">
          Nutritional values are estimated based on typical portions
        </p>
      </div>
    </div>
  )
}
