import { getErrorMessage, normalizeError } from './errorUtils'

const QUEUE_KEY = 'calcheck-app-diagnostics-queue'
const SESSION_KEY = 'calcheck-diagnostics-session-id'
const MAX_QUEUE = 20
const MAX_METADATA_CHARS = 3000
const DUPLICATE_WINDOW_MS = 30000
const recentEvents = new Map()
let diagnosticsUserId = null
let flushing = false

export const getSessionId = () => {
  if (typeof localStorage === 'undefined') return 'server-session'

  try {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const next = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(SESSION_KEY, next)
    return next
  } catch {
    return `diag-${Date.now()}`
  }
}

export const setDiagnosticsUser = (user) => {
  diagnosticsUserId = user?.id || null
  flushDiagnosticsQueue()
}

export const logAppError = (eventName, error, context = {}) => {
  const normalized = normalizeError(error)
  return logAppEvent(eventName, {
    ...context,
    level: context.level || (normalized.aborted ? 'info' : 'error'),
    message: context.message || normalized.message,
    normalized_message: normalized.userMessage || getErrorMessage(error),
    error_code: normalized.code || context.error_code || null,
    metadata: {
      ...(context.metadata || {}),
      aborted: normalized.aborted,
      timeout: normalized.timeout,
      network: normalized.network
    }
  })
}

export const logAppEvent = (eventName, payload = {}) => {
  if (!eventName || typeof window === 'undefined') return

  const event = buildEvent(eventName, payload)
  if (isDuplicate(event)) return

  if (navigator.onLine === false) {
    enqueueEvent(event)
    return
  }

  sendEvent(event).catch(() => enqueueEvent(event))
}

const buildEvent = (eventName, payload) => {
  const metadata = sanitizeMetadata(payload.metadata || payload)

  return {
    user_id: payload.user_id || diagnosticsUserId || null,
    session_id: getSessionId(),
    event_name: String(eventName).slice(0, 120),
    level: normalizeLevel(payload.level),
    screen: payload.screen ? String(payload.screen).slice(0, 80) : null,
    operation: payload.operation ? String(payload.operation).slice(0, 120) : null,
    message: safeText(payload.message),
    normalized_message: safeText(payload.normalized_message || payload.userMessage),
    error_code: payload.error_code ? String(payload.error_code).slice(0, 80) : null,
    http_status: toIntegerOrNull(payload.http_status || payload.status),
    duration_ms: toIntegerOrNull(payload.duration_ms || payload.durationMs),
    app_version: typeof __APP_VERSION__ === 'undefined' ? '0.1.0' : __APP_VERSION__,
    platform: getPlatform(),
    is_pwa: isPwa(),
    is_online: typeof navigator === 'undefined' ? true : navigator.onLine,
    metadata
  }
}

const sendEvent = async (event) => {
  const { supabase } = await import('../services/supabase')
  const { error } = await supabase.from('app_diagnostics').insert(event)
  if (error) throw error
}

const flushDiagnosticsQueue = async () => {
  if (flushing || typeof localStorage === 'undefined' || navigator.onLine === false) return
  flushing = true

  try {
    const queued = readQueue()
    if (queued.length === 0) return

    const remaining = []
    for (const event of queued) {
      try {
        await sendEvent({ ...event, user_id: event.user_id || diagnosticsUserId || null })
      } catch {
        remaining.push(event)
      }
    }
    writeQueue(remaining.slice(-MAX_QUEUE))
  } finally {
    flushing = false
  }
}

const enqueueEvent = (event) => {
  if (typeof localStorage === 'undefined') return
  const queued = [...readQueue(), event].slice(-MAX_QUEUE)
  writeQueue(queued)
}

const readQueue = () => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

const writeQueue = (queue) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)))
  } catch {
    // Diagnostics must never affect app behavior.
  }
}

const isDuplicate = (event) => {
  const key = `${event.event_name}:${event.screen || ''}:${event.operation || ''}:${event.normalized_message || event.message || ''}`
  const now = Date.now()
  const previous = recentEvents.get(key) || 0
  recentEvents.set(key, now)
  return now - previous < DUPLICATE_WINDOW_MS
}

const sanitizeMetadata = (value) => {
  const seen = new WeakSet()
  const sanitize = (input, depth = 0) => {
    if (depth > 4) return '[depth-limit]'
    if (input == null) return input
    if (typeof input === 'string') return sanitizeString(input)
    if (typeof input === 'number' || typeof input === 'boolean') return input
    if (input instanceof Blob || input instanceof File) return '[file]'
    if (Array.isArray(input)) return input.slice(0, 20).map((item) => sanitize(item, depth + 1))
    if (typeof input === 'object') {
      if (seen.has(input)) return '[circular]'
      seen.add(input)
      return Object.entries(input).slice(0, 40).reduce((result, [key, item]) => {
        if (isSensitiveKey(key)) return result
        result[key] = sanitize(item, depth + 1)
        return result
      }, {})
    }
    return String(input)
  }

  const sanitized = sanitize(value)
  const serialized = JSON.stringify(sanitized || {})
  if (serialized.length <= MAX_METADATA_CHARS) return sanitized
  return { truncated: true, preview: serialized.slice(0, MAX_METADATA_CHARS) }
}

const isSensitiveKey = (key) => /token|secret|apikey|api_key|authorization|password|base64|blob|image|photo|prompt/i.test(key)
const sanitizeString = (value) => value.length > 500 ? `${value.slice(0, 500)}...` : value
const safeText = (value) => {
  const text = String(value || '').trim()
  if (!text || text === 'undefined' || text === 'null' || text === '[object Object]') return null
  return text.slice(0, 500)
}
const normalizeLevel = (value) => ['info', 'warn', 'error'].includes(value) ? value : 'info'
const toIntegerOrNull = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}
const getPlatform = () => typeof navigator === 'undefined' ? null : `${navigator.platform || 'unknown'} ${navigator.userAgent || ''}`.slice(0, 500)
const isPwa = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true)

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushDiagnosticsQueue())
}