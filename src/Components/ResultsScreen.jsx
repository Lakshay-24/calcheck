import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Heart } from 'lucide-react'

const PORTION_OPTIONS = [
  { label: 'Small', multiplier: 0.75 },
  { label: 'Medium', multiplier: 1 },
  { label: 'Large', multiplier: 1.5 }
]

export default function ResultsScreen({ result, image, onSave, onRetake, user, isSaving = false }) {
  const [saving, setSaving] = useState(false)
  const [selectedPredictionId, setSelectedPredictionId] = useState('primary')
  const [selectedPortion, setSelectedPortion] = useState('Medium')

  useEffect(() => {
    setSelectedPredictionId('primary')
  }, [result])

  const predictionOptions = useMemo(
    () => buildPredictionOptions(result),
    [result]
  )

  const selectedOption =
    predictionOptions.find((option) => option.id === selectedPredictionId) ||
    predictionOptions[0]

  const selectedResult = selectedOption?.result || result
  const adjustedResult = useMemo(
    () => applyPortionAdjustment(selectedResult, selectedPortion),
    [selectedPortion, selectedResult]
  )

  useEffect(() => {
    setSelectedPortion(normalizePortionSize(selectedResult?.portion_size))
  }, [selectedPredictionId, selectedResult?.portion_size])

  const handleSave = async () => {
    console.info('[CalCheck] ResultsScreen save selected', {
      food_name: adjustedResult?.food_name,
      timezone: adjustedResult?.timezone,
      local_date: adjustedResult?.local_date,
      meal_type: adjustedResult?.meal_type,
      portion_size: adjustedResult?.portion_size,
      portion_multiplier: adjustedResult?.portion_multiplier
    })

    setSaving(true)
    try {
      await onSave(adjustedResult)
    } finally {
      setSaving(false)
    }
  }

  const savingState = isSaving || saving
  const confidence = adjustedResult?.confidence ?? null
  const isLowConfidence = confidence !== null && confidence < 0.6

  const getConfidenceLabel = (value) => {
    if (value >= 0.8) return { text: 'High confidence', className: 'bg-brand-50 text-brand-700' }
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
        return 'bg-brand-50 text-brand-700'
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
      {image && (
        <div className="relative w-full h-64 bg-gray-200 overflow-hidden">
          <img
            src={image}
            alt="Food"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white"></div>
        </div>
      )}

      <div className="px-6 py-6 space-y-6">
        <div>
          <h2 className="text-4xl font-bold text-gray-900 leading-tight">
            {adjustedResult?.food_name || 'Meal'}
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
              This guess may be wrong. Tap another prediction below if it looks closer.
            </p>
          )}
          {predictionOptions.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">
                Predictions
              </p>
              <div className="flex flex-wrap gap-2">
                {predictionOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => setSelectedPredictionId(option.id)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${
                      option.id === selectedOption?.id
                        ? 'bg-brand-50 text-brand-700 border-brand-300'
                        : option.disabled
                        ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-700 border-transparent hover:bg-gray-200'
                    }`}
                    title={option.disabled ? 'This prediction cannot be selected' : undefined}
                  >
                    {option.id === selectedOption?.id && '✓ '}
                    {option.label} ({Math.round((option.confidence ?? 0) * 100)}%)
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {adjustedResult?.portion_size && (
          <div className="bg-gradient-to-r from-brand-50 to-white border border-brand-300/60 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-widest">
                  Estimated Portion
                </p>

                <p className="text-2xl font-bold text-brand-900 mt-1">
                  {adjustedResult.portion_size}
                </p>

                {adjustedResult.estimated_grams > 0 && (
                  <p className="text-sm text-brand-700 mt-1">
                    ~{Math.round(adjustedResult.estimated_grams)}g
                  </p>
                )}
              </div>

              <div className="text-right">
                <p className="text-xs text-brand-700">
                  Quantity Confidence
                </p>

                <p className="text-lg font-semibold text-brand-900">
                  {Math.round((adjustedResult.portion_confidence ?? 0.5) * 100)}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4">
              {PORTION_OPTIONS.map((portion) => (
                <button
                  key={portion.label}
                  type="button"
                  onClick={() => setSelectedPortion(portion.label)}
                  className={`text-sm font-semibold py-2 rounded-xl border transition-all ${
                    selectedPortion === portion.label
                      ? 'bg-brand-500 text-brand-900 border-brand-500'
                      : 'bg-white text-brand-700 border-brand-300 hover:border-brand-500'
                  }`}
                >
                  {portion.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 border border-orange-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-widest mb-1">
              Calories
            </p>
            <p className="text-4xl font-bold text-orange-900">
              {adjustedResult?.calories || 0}
            </p>
            <p className="text-xs text-orange-600 mt-1">kcal</p>
          </div>

          <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-widest mb-1">
              Protein
            </p>
            <p className="text-4xl font-bold text-blue-900">
              {adjustedResult?.protein || 0}
            </p>
            <p className="text-xs text-blue-600 mt-1">grams</p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-brand-50 to-white border border-brand-300/60 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-brand-700">Meal Score</span>
            <Heart size={18} className="text-brand-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-bold text-brand-900">{adjustedResult?.meal_score || 0}</span>
            <span className="text-lg text-brand-700">/100</span>
          </div>
          <p className="text-xs text-brand-700 mt-3">
            {adjustedResult?.meal_score >= 80
              ? 'Excellent macro balance'
              : adjustedResult?.meal_score >= 60
              ? 'Good choice'
              : 'Could be better'}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-widest">
            Macronutrients
          </p>

          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">C</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Carbs</p>
                <p className="text-xs text-gray-500">Energy source</p>
              </div>
            </div>
            <p className="text-lg font-bold text-gray-900">{adjustedResult?.carbs || 0}g</p>
          </div>

          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">F</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Fat</p>
                <p className="text-xs text-gray-500">Supports satiety</p>
              </div>
            </div>
            <p className="text-lg font-bold text-gray-900">{adjustedResult?.fat || 0}g</p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getProteinColor(adjustedResult?.protein_level)}`}>
            {adjustedResult?.protein_level || 'Unknown'} Protein
          </span>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getRecommendationColor(adjustedResult?.recommended_for)}`}>
            {adjustedResult?.recommended_for || 'Maintenance'}
          </span>
        </div>

        <div className="space-y-3 pt-4">
          {user ? (
            <button
              onClick={handleSave}
              disabled={savingState}
              className="w-full bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-brand-900 font-semibold py-4 px-6 rounded-2xl shadow-brand transition-all active:scale-95 disabled:opacity-70"
            >
              {savingState ? 'Saving...' : 'Save Meal'}
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="w-full bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-brand-900 font-semibold py-4 px-6 rounded-2xl shadow-brand transition-all active:scale-95"
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

        <p className="text-xs text-gray-500 text-center pb-4">
          Nutritional values are estimated based on typical portions
        </p>
      </div>
    </div>
  )
}

const buildPredictionOptions = (result) => {
  if (!result) return []

  const options = []
  const usedNames = new Set()

  const addOption = (candidate, index, isPrimary = false) => {
    const name = isPrimary ? result.food_name : candidate?.name
    const normalizedName = String(name || '').trim()

    if (!normalizedName) {
      options.push({
        id: `candidate-${index}`,
        label: 'Unavailable prediction',
        confidence: 0,
        disabled: true,
        result
      })
      return
    }

    const dedupeKey = normalizedName.toLowerCase()
    if (usedNames.has(dedupeKey)) return
    usedNames.add(dedupeKey)

    const confidence = isPrimary
      ? result.confidence ?? candidate?.confidence ?? 0.5
      : candidate?.confidence ?? 0

    options.push({
      id: isPrimary ? 'primary' : `candidate-${index}`,
      label: normalizedName,
      confidence,
      disabled: false,
      result: mapCandidateToResult(result, candidate, normalizedName, confidence, isPrimary)
    })
  }

  addOption(result, 'primary', true)

  if (Array.isArray(result.candidates)) {
    result.candidates.forEach((candidate, index) => {
      addOption(candidate, index)
    })
  }

  return options
}

const mapCandidateToResult = (baseResult, candidate, foodName, confidence, isPrimary) => {
  if (isPrimary) {
    return { ...baseResult }
  }

  return {
    ...baseResult,
    ...pickCandidateNutrition(candidate),
    food_name: foodName,
    confidence,
    candidates: baseResult.candidates
  }
}

const pickCandidateNutrition = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return {}

  const fields = [
    'calories',
    'protein',
    'carbs',
    'fat',
    'meal_score',
    'protein_level',
    'recommended_for',
    'portion_size',
    'estimated_grams',
    'portion_confidence'
  ]

  return fields.reduce((values, field) => {
    if (candidate[field] !== undefined && candidate[field] !== null) {
      values[field] = candidate[field]
    }

    return values
  }, {})
}

const normalizePortionSize = (value) =>
  PORTION_OPTIONS.some((portion) => portion.label === value) ? value : 'Medium'

const getPortionMultiplier = (portionSize) =>
  PORTION_OPTIONS.find((portion) => portion.label === portionSize)?.multiplier || 1

const scaleNutritionValue = (value, multiplier) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return value || 0

  return Math.round(numberValue * multiplier)
}

const scaleNutrientsJson = (nutrientsJson, multiplier) => {
  if (!nutrientsJson || typeof nutrientsJson !== 'object') return nutrientsJson || null

  return Object.entries(nutrientsJson).reduce((values, [key, value]) => {
    values[key] = value == null ? null : scaleNutrientValue(value, multiplier)
    return values
  }, {})
}

const scaleNutrientValue = (value, multiplier) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return null

  const scaled = numberValue * multiplier
  return scaled < 10 ? Number(scaled.toFixed(1)) : Math.round(scaled)
}

const applyPortionAdjustment = (result, portionSize) => {
  if (!result) return result

  const normalizedPortionSize = normalizePortionSize(portionSize)
  const portionMultiplier = getPortionMultiplier(normalizedPortionSize)

  return {
    ...result,
    calories: scaleNutritionValue(result.calories, portionMultiplier),
    protein: scaleNutritionValue(result.protein, portionMultiplier),
    carbs: scaleNutritionValue(result.carbs, portionMultiplier),
    fat: scaleNutritionValue(result.fat, portionMultiplier),
    nutrients_json: scaleNutrientsJson(result.nutrients_json, portionMultiplier),
    estimated_grams: scaleNutritionValue(result.estimated_grams, portionMultiplier),
    portion_size: normalizedPortionSize,
    portion_multiplier: portionMultiplier
  }
}
