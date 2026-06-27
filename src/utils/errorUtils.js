import { logAppError } from './appDiagnostics'
const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.'
const NETWORK_ERROR_MESSAGE = 'Network issue. Please check your connection and try again.'
const TIMEOUT_ERROR_MESSAGE = 'This is taking longer than expected. Please try again.'

export const normalizeError = (error, fallbackMessage = DEFAULT_ERROR_MESSAGE) => {
  const fallback = safeMessage(fallbackMessage) || DEFAULT_ERROR_MESSAGE
  const message = extractMessage(error)
  const aborted = isAbortError(error)
  const timeout = isTimeoutError(error)
  const network = isNetworkError(error)
  const edgeFunction = isEdgeFunctionError(error)
  const userSafeMessage = safeMessage(message, { allowTechnical: false })

  if (aborted) {
    return {
      message: '',
      userMessage: '',
      code: getErrorCode(error),
      aborted: true,
      timeout: false,
      network: false,
      original: error
    }
  }

  const userMessage = timeout
    ? TIMEOUT_ERROR_MESSAGE
    : network
    ? NETWORK_ERROR_MESSAGE
    : userSafeMessage || fallback

  return {
    message: safeMessage(message, { allowTechnical: true }) || userMessage,
    userMessage,
    code: getErrorCode(error),
    aborted,
    timeout,
    network,
    edgeFunction,
    rawSuppressed: edgeFunction && !userSafeMessage,
    original: error
  }
}

export const getErrorMessage = (error, fallbackMessage = DEFAULT_ERROR_MESSAGE) => {
  const normalized = normalizeError(error, fallbackMessage)
  return normalized.userMessage || fallbackMessage || DEFAULT_ERROR_MESSAGE
}

export const isNetworkError = (error) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true

  const message = extractMessage(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('networkerror') ||
    message.includes('load failed') ||
    message.includes('connection')
  )
}

export const logSafeError = (label, error, extra = {}) => {
  const normalized = normalizeError(error)
  const eventName = normalized.aborted
    ? 'APP_ABORTED_REQUEST_IGNORED'
    : normalized.timeout
    ? 'APP_TIMEOUT_ERROR'
    : normalized.network
    ? 'APP_NETWORK_ERROR'
    : normalized.edgeFunction
    ? 'EDGE_FUNCTION_ERROR_NORMALIZED'
    : 'APP_ERROR_NORMALIZED'

  const payload = {
    label,
    event: eventName,
    message: normalized.message || normalized.userMessage || DEFAULT_ERROR_MESSAGE,
    userMessage: normalized.userMessage || null,
    code: normalized.code || null,
    aborted: normalized.aborted,
    timeout: normalized.timeout,
    network: normalized.network,
    edgeFunction: normalized.edgeFunction,
    rawSuppressed: normalized.rawSuppressed,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    ...extra
  }

  if (normalized.aborted) {
    console.info(`[CalCheck] ${eventName}`, payload)
  } else {
    console.error(`[CalCheck] ${eventName}`, payload)
  }

  logAppError(label || eventName, error, {
    ...extra,
    level: normalized.aborted ? 'info' : normalized.network || normalized.timeout ? 'warn' : 'error',
    message: payload.message,
    normalized_message: payload.userMessage,
    error_code: payload.code,
    metadata: payload
  })

  return normalized
}

const extractMessage = (error) => {
  if (error == null) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || ''

  if (typeof error === 'object') {
    const candidate = error.message || error.error_description || error.details || error.hint || error.error
    if (typeof candidate === 'string') return candidate
    if (candidate && typeof candidate === 'object') return extractMessage(candidate)
  }

  return ''
}

const safeMessage = (message, options = {}) => {
  const value = String(message || '').trim()
  if (!value || value === 'undefined' || value === 'null' || value === '[object Object]') return ''
  if (/fetch error undefined/i.test(value)) return NETWORK_ERROR_MESSAGE
  if (!options.allowTechnical && isRawTechnicalErrorMessage(value)) return ''
  return value
}

const isRawTechnicalErrorMessage = (message) => {
  const value = String(message || '').toLowerCase()
  return (
    value.includes('edge function returned a non-2xx status code') ||
    value.includes('functionshttperror') ||
    value.includes('function returned a non-2xx status code') ||
    value.includes('non-2xx status code')
  )
}

const isEdgeFunctionError = (error) => {
  const message = extractMessage(error)
  const name = typeof error === 'object' && error ? String(error.name || '') : ''
  return isRawTechnicalErrorMessage(message) || /FunctionsHttpError|FunctionsFetchError|FunctionsRelayError/i.test(name)
}

export const isAbortError = (error) => {
  const name = typeof error === 'object' && error ? error.name : ''
  const message = extractMessage(error).toLowerCase()
  return name === 'AbortError' || message.includes('aborted') || message.includes('aborterror')
}

export const isTimeoutError = (error) => {
  const message = extractMessage(error).toLowerCase()
  return message.includes('timeout') || message.includes('timed out') || message.includes('took too long')
}

const getErrorCode = (error) => {
  if (!error || typeof error !== 'object') return null
  return error.code || error.status || error.statusCode || null
}
