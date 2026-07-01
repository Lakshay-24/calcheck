const OPENAI_API_URL = 'https://api.openai.com/v1/responses'
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_TEXT_MEAL_MODEL = Deno.env.get('OPENAI_TEXT_MEAL_MODEL') || Deno.env.get('OPENAI_FOOD_MODEL') || Deno.env.get('OPENAI_VISION_MODEL') || 'gpt-4o-mini'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const TEXT_MEAL_PROMPT = `You classify and estimate meals for CalCheck.

First classify the input. Only create nutrition if the text clearly describes food or drink.

input_type must be one of: meal, beverage, unclear_food, non_food, unsafe_or_medical.

Rules:
- meal or beverage: loggable true and nutrition estimates compatible with CalCheck.
- unclear_food: loggable false with message "I need a little more detail. For example: 2 rotis, dal, rice, curd."
- non_food: loggable false with message "I couldn't detect a meal. Try describing what you ate."
- unsafe_or_medical: loggable false with message "I can help log meals, but I can't answer medical advice here."
- Never invent food from unrelated text.
- Never answer medical advice.
- Do not create calories/macros unless input clearly describes food or drink.
- If quantity is vague but food is clear, return low confidence and conservative assumptions.
- Treat normal food shorthand as loggable. Examples: "roti dal chawal", "2 rotis dal rice curd", "rajma chawal", "poha", "paneer sandwich", "chicken biryani", "protein shake banana".
- Treat clear drinks as beverage. Examples: "black coffee", "chai", "lassi", "protein shake".
- Reject non-food text. Example: "I went to gym today" is non_food.
- Use Indian food knowledge where relevant.
- Do not include iodine/salt suggestions or medical claims.
- Nutrients are rough AI estimates only; use null where uncertain.`

const nutrientProperties = {
  fiber_g: { type: ['number', 'null'] },
  calcium_mg: { type: ['number', 'null'] },
  iron_mg: { type: ['number', 'null'] },
  vitamin_d_ug: { type: ['number', 'null'] },
  vitamin_b12_ug: { type: ['number', 'null'] },
  potassium_mg: { type: ['number', 'null'] },
  magnesium_mg: { type: ['number', 'null'] },
  omega3_mg: { type: ['number', 'null'] },
  vitamin_c_mg: { type: ['number', 'null'] },
  sodium_mg: { type: ['number', 'null'] },
  folate_ug: { type: ['number', 'null'] },
  zinc_mg: { type: ['number', 'null'] },
  iodine_ug: { type: ['number', 'null'] },
  selenium_ug: { type: ['number', 'null'] },
  vitamin_a_ug: { type: ['number', 'null'] },
  vitamin_e_mg: { type: ['number', 'null'] },
  vitamin_k_ug: { type: ['number', 'null'] }
}
const nutrientKeys = Object.keys(nutrientProperties)

const FOOD_TERMS = [
  'roti', 'rotis', 'chapati', 'dal', 'dhal', 'rice', 'chawal', 'curd', 'dahi', 'rajma', 'poha',
  'paneer', 'sandwich', 'chicken', 'biryani', 'banana', 'shake', 'paratha', 'idli', 'dosa',
  'upma', 'khichdi', 'sabzi', 'sabji', 'chole', 'bhature', 'egg', 'eggs', 'oats', 'salad',
  'soup', 'pasta', 'maggi', 'noodles', 'fish', 'mutton', 'tofu', 'sprouts', 'protein'
]
const BEVERAGE_TERMS = ['coffee', 'tea', 'chai', 'lassi', 'juice', 'milk', 'smoothie', 'shake', 'water']

const getFoodHint = (description: string) => {
  const normalized = description.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const hasFood = tokens.some((token) => FOOD_TERMS.includes(token))
  const hasBeverage = tokens.some((token) => BEVERAGE_TERMS.includes(token))
  if (hasBeverage && !hasFood) return 'likely_beverage'
  if (hasFood || hasBeverage) return 'likely_food_or_drink'
  return 'unknown'
}

const textMealSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'loggable', 'input_type', 'message', 'food_name', 'calories', 'protein', 'carbs', 'fat',
    'meal_score', 'protein_level', 'recommended_for', 'portion_size', 'estimated_grams',
    'portion_confidence', 'confidence', 'candidates', 'nutrients_json', 'nutrient_confidence', 'nutrient_source'
  ],
  properties: {
    loggable: { type: 'boolean' },
    input_type: { type: 'string', enum: ['meal', 'beverage', 'unclear_food', 'non_food', 'unsafe_or_medical'] },
    message: { type: ['string', 'null'] },
    food_name: { type: ['string', 'null'] },
    calories: { type: ['number', 'null'] },
    protein: { type: ['number', 'null'] },
    carbs: { type: ['number', 'null'] },
    fat: { type: ['number', 'null'] },
    meal_score: { type: ['number', 'null'], minimum: 0, maximum: 100 },
    protein_level: { type: ['string', 'null'], enum: ['High', 'Medium', 'Low', null] },
    recommended_for: { type: ['string', 'null'], enum: ['Fat Loss', 'Muscle Gain', 'Maintenance', null] },
    portion_size: { type: ['string', 'null'], enum: ['Small', 'Medium', 'Large', null] },
    estimated_grams: { type: ['number', 'null'] },
    portion_confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    candidates: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'confidence'],
        properties: {
          name: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    },
    nutrients_json: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: nutrientKeys,
      properties: nutrientProperties
    },
    nutrient_confidence: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
    nutrient_source: { type: ['string', 'null'], enum: ['ai_estimate', null] }
  }
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
})

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const toFiniteNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}
const toNullableNumber = (value: unknown) => {
  if (value == null) return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}
const getRejectMessage = (inputType: string, fallback?: unknown) => {
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim()
  if (inputType === 'unsafe_or_medical') return "I can help log meals, but I can't answer medical advice here."
  if (inputType === 'unclear_food') return 'I need a little more detail. For example: 2 rotis, dal, rice, curd.'
  return "I couldn't detect a meal. Try describing what you ate."
}

const normalizeNutrients = (analysis: Record<string, unknown>) => {
  const rawNutrients = analysis.nutrients_json
  if (!rawNutrients || typeof rawNutrients !== 'object') return { nutrients_json: null, nutrient_confidence: null, nutrient_source: null }
  const nutrients = nutrientKeys.reduce<Record<string, number | null>>((values, key) => {
    values[key] = toNullableNumber((rawNutrients as Record<string, unknown>)[key])
    return values
  }, {})
  const confidence = ['low', 'medium', 'high'].includes(String(analysis.nutrient_confidence)) ? String(analysis.nutrient_confidence) : 'low'
  return { nutrients_json: nutrients, nutrient_confidence: confidence, nutrient_source: 'ai_estimate' }
}

const normalizeTextMeal = (analysis: Record<string, unknown>, source: string) => {
  const inputType = ['meal', 'beverage', 'unclear_food', 'non_food', 'unsafe_or_medical'].includes(String(analysis.input_type)) ? String(analysis.input_type) : 'unclear_food'
  const loggable = analysis.loggable === true && (inputType === 'meal' || inputType === 'beverage')
  if (!loggable) return { loggable: false, input_type: inputType, message: getRejectMessage(inputType, analysis.message) }

  const confidence = clamp(toFiniteNumber(analysis.confidence, 0.55), 0, 1)
  const foodName = String(analysis.food_name || (inputType === 'beverage' ? 'Logged beverage' : 'Logged meal'))
  const candidates = Array.isArray(analysis.candidates)
    ? analysis.candidates.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === 'object')).slice(0, 3).map((candidate) => ({
        name: String(candidate.name || foodName),
        confidence: clamp(toFiniteNumber(candidate.confidence, confidence), 0, 1)
      }))
    : []

  return {
    loggable: true,
    input_type: inputType,
    food_name: foodName,
    calories: Math.max(0, Math.round(toFiniteNumber(analysis.calories))),
    protein: Math.max(0, Math.round(toFiniteNumber(analysis.protein))),
    carbs: Math.max(0, Math.round(toFiniteNumber(analysis.carbs))),
    fat: Math.max(0, Math.round(toFiniteNumber(analysis.fat))),
    meal_score: clamp(Math.round(toFiniteNumber(analysis.meal_score, 55)), 0, 100),
    protein_level: ['High', 'Medium', 'Low'].includes(String(analysis.protein_level)) ? String(analysis.protein_level) : 'Low',
    recommended_for: ['Fat Loss', 'Muscle Gain', 'Maintenance'].includes(String(analysis.recommended_for)) ? String(analysis.recommended_for) : 'Maintenance',
    portion_size: ['Small', 'Medium', 'Large'].includes(String(analysis.portion_size)) ? String(analysis.portion_size) : 'Medium',
    estimated_grams: Math.max(0, Math.round(toFiniteNumber(analysis.estimated_grams))),
    portion_confidence: clamp(toFiniteNumber(analysis.portion_confidence, confidence), 0, 1),
    confidence,
    ...normalizeNutrients(analysis),
    candidates: candidates.length > 0 ? candidates : [{ name: foodName, confidence }],
    source
  }
}

const extractOutputText = (data: Record<string, unknown>) => {
  if (typeof data.output_text === 'string') return data.output_text
  const output = Array.isArray(data.output) ? data.output : []
  for (const item of output) {
    const content = item && typeof item === 'object' && 'content' in item ? (item as { content?: unknown }).content : null
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  }
  return null
}

const parseOpenAIResponse = (data: Record<string, unknown>, source: string) => {
  const outputText = extractOutputText(data)
  if (!outputText) throw new Error('No analysis returned. Please try again.')
  try {
    return normalizeTextMeal(JSON.parse(outputText), source)
  } catch {
    throw new Error('Invalid analysis response. Please try again.')
  }
}

const errorMessageForStatus = (status: number) => {
  if (status === 429) return 'Food analysis service is currently busy. Please try again shortly.'
  if ([500, 502, 503, 504].includes(status)) return 'Food analysis is temporarily unavailable. Please try again later.'
  if (status === 400 || status === 401 || status === 403) return 'Food analysis is not configured correctly. Please try again later.'
  return 'Could not analyze this meal. Please try again.'
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  if (!OPENAI_API_KEY) return jsonResponse({ error: 'Food analysis is not configured correctly. Please try again later.' })

  let payload: { description?: unknown; source?: unknown }
  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid request payload.' }, 400)
  }

  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const source = payload.source === 'voice_transcript' ? 'voice_transcript' : 'text'
  const foodHint = getFoodHint(description)
  if (description.length < 3) {
    return jsonResponse({ loggable: false, input_type: 'unclear_food', message: 'I need a little more detail. For example: 2 rotis, dal, rice, curd.' })
  }

  const startedAt = Date.now()
  console.info('[CalCheck] ANALYZE_MEAL_TEXT_MODEL_SELECTED', { model: OPENAI_TEXT_MEAL_MODEL, source })
  const openAIResponse = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_TEXT_MEAL_MODEL,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: TEXT_MEAL_PROMPT },
        { type: 'input_text', text: `Source: ${source}\nFood hint: ${foodHint}\nMeal description: ${description}` }
      ] }],
      text: { format: { type: 'json_schema', name: 'text_meal_analysis', strict: true, schema: textMealSchema } }
    })
  })

  if (!openAIResponse.ok) {
    console.error('[CalCheck] ANALYZE_MEAL_TEXT_FAILED', { status: openAIResponse.status, duration_ms: Date.now() - startedAt, model: OPENAI_TEXT_MEAL_MODEL })
    return jsonResponse({ error: errorMessageForStatus(openAIResponse.status) })
  }

  try {
    const data = await openAIResponse.json()
    const parsed = parseOpenAIResponse(data, source)
    console.info('[CalCheck] ANALYZE_MEAL_TEXT_DURATION_MS', { duration_ms: Date.now() - startedAt, model: OPENAI_TEXT_MEAL_MODEL, input_type: parsed.input_type, loggable: parsed.loggable, food_hint: foodHint })
    return jsonResponse(parsed)
  } catch (error) {
    console.error('[CalCheck] ANALYZE_MEAL_TEXT_FAILED', { message: error instanceof Error ? error.message : 'Unknown parse error', duration_ms: Date.now() - startedAt, model: OPENAI_TEXT_MEAL_MODEL })
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid analysis response. Please try again.' })
  }
})