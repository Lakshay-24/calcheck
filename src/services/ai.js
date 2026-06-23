import { supabase } from './supabase'
import { recordError, recordPerformanceMetric, trackApiRequest } from './diagnostics'
import { formatBytes, getDataUrlByteSize } from '../utils/imagePerformance'
import { getErrorMessage, logSafeError } from '../utils/errorUtils'
import { logAppError } from '../utils/appDiagnostics'

const USE_MOCK = import.meta.env.VITE_USE_MOCK_AI === 'true'
const NUTRIENT_KEYS = [
  'fiber_g',
  'calcium_mg',
  'iron_mg',
  'vitamin_d_ug',
  'vitamin_b12_ug',
  'potassium_mg',
  'magnesium_mg',
  'omega3_mg',
  'vitamin_c_mg',
  'sodium_mg',
  'folate_ug',
  'zinc_mg',
  'iodine_ug',
  'selenium_ug',
  'vitamin_a_ug',
  'vitamin_e_mg',
  'vitamin_k_ug'
]

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
  nutrients_json: {
    fiber_g: 12,
    calcium_mg: 160,
    iron_mg: 5,
    vitamin_d_ug: null,
    vitamin_b12_ug: null,
    potassium_mg: 820,
    magnesium_mg: 105,
    omega3_mg: 90,
    vitamin_c_mg: 12,
    sodium_mg: 920,
    folate_ug: 180,
    zinc_mg: 2.5,
    iodine_ug: null,
    selenium_ug: 8,
    vitamin_a_ug: 120,
    vitamin_e_mg: 2,
    vitamin_k_ug: 18
  },
  nutrient_confidence: 'medium',
  nutrient_source: 'ai_estimate',
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

const toNullableNumber = (value) => {
  if (value == null) return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

const normalizeNutrients = (analysis) => {
  if (!analysis?.nutrients_json || typeof analysis.nutrients_json !== 'object') {
    console.info('[CalCheck] NUTRIENT_JSON_MISSING', {
      food_name: analysis?.food_name || null
    })
    return {
      nutrients_json: null,
      nutrient_confidence: null,
      nutrient_source: null
    }
  }

  const nutrients = NUTRIENT_KEYS.reduce((values, key) => {
    values[key] = toNullableNumber(analysis.nutrients_json[key])
    return values
  }, {})
  const confidence = ['low', 'medium', 'high'].includes(analysis.nutrient_confidence)
    ? analysis.nutrient_confidence
    : 'low'

  console.info('[CalCheck] NUTRIENT_JSON_RECEIVED', {
    food_name: analysis.food_name || null,
    nutrient_confidence: confidence,
    populated_count: Object.values(nutrients).filter((value) => value != null).length
  })

  return {
    nutrients_json: nutrients,
    nutrient_confidence: confidence,
    nutrient_source: 'ai_estimate'
  }
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

  const nutrientFields = normalizeNutrients(analysis)

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
    ...nutrientFields,
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
    logSafeError('EDGE_FUNCTION_FAILED', error, { operation: 'analyze-food' })
    logAppError('EDGE_FUNCTION_FAILED', error, {
      screen: 'scan',
      operation: 'analyze-food'
    })
    throw new Error(getErrorMessage(error, 'Failed to analyze food image. Please try again.'))
  }

  if (data?.error) {
    const analysisError = new Error(data.error)
    recordError('analyze-food', analysisError)
    throw analysisError
  }

  return normalizeFoodAnalysis(data)
}
