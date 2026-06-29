const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_TRANSCRIBE_MODEL = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-mini-transcribe'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  if (!OPENAI_API_KEY) return jsonResponse({ error: 'Voice transcription is not configured. Please type your meal.' })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: 'Invalid audio upload.' }, 400)
  }

  const audio = formData.get('audio')
  if (!(audio instanceof File) || audio.size < 1000) {
    return jsonResponse({ error: "Couldn't understand that. Please try again or type your meal." }, 400)
  }

  const startedAt = Date.now()
  console.info('[CalCheck] TRANSCRIBE_MEAL_VOICE_MODEL_SELECTED', { model: OPENAI_TRANSCRIBE_MODEL, audio_size_bytes: audio.size, audio_type: audio.type || null })

  const openAIForm = new FormData()
  openAIForm.append('model', OPENAI_TRANSCRIBE_MODEL)
  openAIForm.append('file', audio, audio.name || 'meal-audio.webm')
  openAIForm.append('response_format', 'json')

  const openAIResponse = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: openAIForm
  })

  if (!openAIResponse.ok) {
    console.error('[CalCheck] TRANSCRIBE_MEAL_VOICE_FAILED', { status: openAIResponse.status, statusText: openAIResponse.statusText, duration_ms: Date.now() - startedAt, model: OPENAI_TRANSCRIBE_MODEL })
    return jsonResponse({ error: "Couldn't understand that. Please try again or type your meal." })
  }

  const data = await openAIResponse.json().catch(() => ({}))
  const transcript = typeof data.text === 'string' ? data.text.trim() : ''
  if (transcript.length < 2) {
    return jsonResponse({ error: "Couldn't understand that. Please try again or type your meal." })
  }

  console.info('[CalCheck] TRANSCRIBE_MEAL_VOICE_DURATION_MS', { duration_ms: Date.now() - startedAt, model: OPENAI_TRANSCRIBE_MODEL, transcript_length: transcript.length })
  return jsonResponse({ transcript })
})