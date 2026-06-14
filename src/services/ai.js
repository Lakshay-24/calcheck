import { supabase } from './supabase'
import { recordError, recordPerformanceMetric, trackApiRequest } from './diagnostics'
import { formatBytes, getDataUrlByteSize } from '../utils/imagePerformance'

const USE_MOCK = import.meta.env.VITE_USE_MOCK_AI === 'true'

export const MOCK_FOOD_ANALYSIS = {
  food_name: 'Chole Bhature (mock)',
  calories: 620,
  protein: 18,
  carbs: 78,
  fat: 28,
  meal_score: 55,
  protein_level: 'Medium',
  portion_size: 'Medium',
  estimated_grams: 350,
  portion_confidence: 0.7,
  recommended_for: 'Maintenance',
  confidence: 0.5,
  candidates: [
    { name: 'Chole Bhature', confidence: 0.5 },
    { name: 'Chana Masala with Fried Bread', confidence: 0.35 }
  ]
}

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value))

const toFiniteNumber = (value, fallback = 0) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

export const normalizeFoodAnalysis = (analysis) => {
  if (!analysis || typeof analysis !== 'object') {
    throw new Error('Invalid analysis response. Please try again.')
  }

  const confidence = clamp(toFiniteNumber(analysis.confidence, 0.5), 0, 1)
  const foodName = String(analysis.food_name || 'Unidentified food')

  const candidates = Array.isArray(analysis.candidates)
    ? analysis.candidates
        .filter((candidate) => candidate?.name)
        .slice(0, 3)
        .map((candidate) => ({
          name: String(candidate.name),
          confidence: clamp(toFiniteNumber(candidate.confidence, 0), 0, 1)
        }))
    : []

  return {
    food_name: foodName,
    calories: Math.max(0, toFiniteNumber(analysis.calories)),
    protein: Math.max(0, toFiniteNumber(analysis.protein)),
    carbs: Math.max(0, toFiniteNumber(analysis.carbs)),
    fat: Math.max(0, toFiniteNumber(analysis.fat)),
    meal_score: clamp(toFiniteNumber(analysis.meal_score), 0, 100),
    protein_level: ['High', 'Medium', 'Low'].includes(analysis.protein_level)
      ? analysis.protein_level
      : 'Low',
    recommended_for: ['Fat Loss', 'Muscle Gain', 'Maintenance'].includes(
      analysis.recommended_for
    )
      ? analysis.recommended_for
      : 'Maintenance',
    portion_size: ['Small', 'Medium', 'Large'].includes(analysis.portion_size)
      ? analysis.portion_size
      : 'Medium',
    estimated_grams: Math.max(0, toFiniteNumber(analysis.estimated_grams)),
    portion_confidence: clamp(toFiniteNumber(analysis.portion_confidence, 0.5), 0, 1),
    confidence,
    candidates: candidates.length > 0 ? candidates : [{ name: foodName, confidence }]
  }
}

export const analyzeFood = async (imageData) => {
  if (USE_MOCK) {
    console.warn('Using mock AI response (VITE_USE_MOCK_AI=true)')

    await new Promise((resolve) => setTimeout(resolve, 1500))

    return { ...MOCK_FOOD_ANALYSIS }
  }

  const base64Image = String(imageData || '').split(',').pop() || ''
  const uploadBytes = getDataUrlByteSize(base64Image)

  recordPerformanceMetric('analyze-food upload payload', {
    upload_size_bytes: uploadBytes,
    upload_size_display: formatBytes(uploadBytes)
  })

  const { data, error } = await trackApiRequest('analyze-food', () => supabase.functions.invoke('analyze-food', {
    body: { image: base64Image }
  }))

  if (error) {
    throw new Error(error.message || 'Failed to analyze food image. Please try again.')
  }

  if (data?.error) {
    const analysisError = new Error(data.error)
    recordError('analyze-food', analysisError)
    throw analysisError
  }

  return normalizeFoodAnalysis(data)
}
