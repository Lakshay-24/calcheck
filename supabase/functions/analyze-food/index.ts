const OPENAI_API_URL = 'https://api.openai.com/v1/responses'
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_VISION_MODEL = Deno.env.get('OPENAI_VISION_MODEL') || 'gpt-5.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const ANALYSIS_PROMPT = `You are a nutrition expert specializing in Indian cuisine. Analyze this food photo carefully.

Identify what is ACTUALLY visible in the image. Do NOT guess Western defaults (e.g. grilled chicken, rice bowl) unless those foods are clearly present.

Rules:
- Look at colors, textures, and plate composition before naming the dish
- For Indian food, account for typical oil, ghee, and visible serving size
- Estimate portion_size as Small, Medium, or Large
- Estimate estimated_grams
- Estimate portion_confidence from 0.0 to 1.0
- Use plate size, bowl size, food coverage, and visible quantity
- If uncertain, lower portion_confidence
- List 2-3 candidates ranked by confidence; food_name must match the top candidate
- If the image is unclear or not food, set confidence below 0.4 and use food_name "Unidentified food"
- Never invent foods not supported by visual evidence`

const foodAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'food_name',
    'calories',
    'protein',
    'carbs',
    'fat',
    'meal_score',
    'protein_level',
    'recommended_for',
    'portion_size',
    'estimated_grams',
    'portion_confidence',
    'confidence',
    'candidates'
  ],
  properties: {
    food_name: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    meal_score: { type: 'number', minimum: 0, maximum: 100 },
    protein_level: { type: 'string', enum: ['High', 'Medium', 'Low'] },
    recommended_for: { type: 'string', enum: ['Fat Loss', 'Muscle Gain', 'Maintenance'] },
    portion_size: { type: 'string', enum: ['Small', 'Medium', 'Large'] },
    estimated_grams: { type: 'number' },
    portion_confidence: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    candidates: {
      type: 'array',
      minItems: 1,
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
    }
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  })

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

const normalizeAnalysis = (analysis: Record<string, unknown>) => {
  const confidence = clamp(toFiniteNumber(analysis.confidence, 0.5), 0, 1)
  const foodName = String(analysis.food_name || 'Unidentified food')

  const candidates = Array.isArray(analysis.candidates)
    ? analysis.candidates
        .filter((candidate): candidate is Record<string, unknown> =>
          Boolean(candidate && typeof candidate === 'object' && 'name' in candidate)
        )
        .slice(0, 3)
        .map((candidate) => ({
          name: String(candidate.name || foodName),
          confidence: clamp(toFiniteNumber(candidate.confidence, 0), 0, 1)
        }))
    : []

  return {
    food_name: foodName,
    calories: Math.max(0, toFiniteNumber(analysis.calories)),
    protein: Math.max(0, toFiniteNumber(analysis.protein)),
    carbs: Math.max(0, toFiniteNumber(analysis.carbs)),
    fat: Math.max(0, toFiniteNumber(analysis.fat)),
    meal_score: clamp(toFiniteNumber(analysis.meal_score, 0), 0, 100),
    protein_level: ['High', 'Medium', 'Low'].includes(String(analysis.protein_level))
      ? String(analysis.protein_level)
      : 'Low',
    recommended_for: ['Fat Loss', 'Muscle Gain', 'Maintenance'].includes(
      String(analysis.recommended_for)
    )
      ? String(analysis.recommended_for)
      : 'Maintenance',
    portion_size: ['Small', 'Medium', 'Large'].includes(String(analysis.portion_size))
      ? String(analysis.portion_size)
      : 'Medium',
    estimated_grams: Math.max(0, toFiniteNumber(analysis.estimated_grams)),
    portion_confidence: clamp(toFiniteNumber(analysis.portion_confidence, 0.5), 0, 1),
    confidence,
    candidates: candidates.length > 0 ? candidates : [{ name: foodName, confidence }]
  }
}

const extractOutputText = (data: Record<string, unknown>) => {
  if (typeof data.output_text === 'string') {
    return data.output_text
  }

  const output = Array.isArray(data.output) ? data.output : []

  for (const item of output) {
    const content =
      item && typeof item === 'object' && 'content' in item
        ? (item as { content?: unknown }).content
        : null

    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  }

  return null
}

const parseOpenAIResponse = (data: Record<string, unknown>) => {
  const outputText = extractOutputText(data)

  if (!outputText) {
    throw new Error('No analysis returned. Please try a clearer photo.')
  }

  try {
    return normalizeAnalysis(JSON.parse(outputText))
  } catch {
    throw new Error('Invalid analysis response. Please try again.')
  }
}

const isRetryableStatus = (status: number) =>
  [429, 500, 502, 503, 504].includes(status)

const errorMessageForStatus = (status: number) => {
  if (status === 429) {
    return 'Food analysis service is currently busy. Please try again shortly.'
  }

  if ([500, 502, 503, 504].includes(status)) {
    return 'Food analysis is temporarily unavailable. Please try again later.'
  }

  if (status === 400 || status === 401 || status === 403) {
    return 'Food analysis is not configured correctly. Please try again later.'
  }

  return `Analysis failed (${status}). Please try again.`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not configured')
    return jsonResponse(
      { error: 'Food analysis is not configured correctly. Please try again later.' }
    )
  }

  let payload: { image?: unknown; imageData?: unknown }

  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid request payload.' }, 400)
  }

  const image = typeof payload.image === 'string' ? payload.image : payload.imageData
  const imageData = typeof image === 'string' ? image : ''
  const base64Image = imageData.replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '')

  if (!base64Image || base64Image.length < 100) {
    return jsonResponse({ error: 'A valid image is required.' }, 400)
  }

  const imageUrl = `data:image/jpeg;base64,${base64Image}`
  let openAIResponse: Response | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    openAIResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: ANALYSIS_PROMPT },
              { type: 'input_image', image_url: imageUrl, detail: 'low' }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'food_analysis',
            strict: true,
            schema: foodAnalysisSchema
          }
        }
      })
    })

    if (openAIResponse.ok || !isRetryableStatus(openAIResponse.status)) {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
  }

  if (!openAIResponse?.ok) {
    const status = openAIResponse?.status || 500

    console.error('OpenAI analysis request failed', {
      status,
      statusText: openAIResponse?.statusText
    })

    return jsonResponse({ error: errorMessageForStatus(status) })
  }

  const data = await openAIResponse.json()

  try {
    return jsonResponse(parseOpenAIResponse(data))
  } catch (error) {
    console.error('OpenAI analysis response could not be parsed', {
      message: error instanceof Error ? error.message : 'Unknown parse error'
    })

    return jsonResponse({
      error:
        error instanceof Error
          ? error.message
          : 'Invalid analysis response. Please try again.'
    })
  }
})
