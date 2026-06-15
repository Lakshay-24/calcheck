const DIAGNOSTICS_KEY = 'calcheck-diagnostics'
const LONG_REQUEST_MS = 15000
const MAX_REQUESTS = 12
const MAX_STARTUP_STEPS = 20
const MAX_LIFECYCLE_EVENTS = 30
const inFlightRequests = new Map()
const inFlightRequestMeta = new Map()

const emptyDiagnostics = {
  requests: [],
  lastFailedRequest: null,
  lastError: null,
  lastImage: null,
  performance: [],
  startup: [],
  lifecycle: []
}

const safeNow = () => {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

const readDiagnostics = () => {
  if (typeof localStorage === 'undefined') return emptyDiagnostics

  try {
    return {
      ...emptyDiagnostics,
      ...JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) || '{}')
    }
  } catch {
    return emptyDiagnostics
  }
}

const writeDiagnostics = (next) => {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent('calcheck-diagnostics-updated'))
  } catch {
    // Diagnostics must never affect product behavior.
  }
}

const serializeError = (error) => ({
  message: error?.message || String(error || 'Unknown error'),
  name: error?.name || 'Error',
  code: error?.code || error?.status || null,
  timestamp: new Date().toISOString()
})

export const getDiagnosticsSnapshot = () => ({
  ...readDiagnostics(),
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  appVersion: typeof __APP_VERSION__ === 'undefined' ? '0.1.0' : __APP_VERSION__,
  buildTimestamp: typeof __BUILD_TIMESTAMP__ === 'undefined' ? 'development' : __BUILD_TIMESTAMP__
})

export const recordError = (requestName, error) => {
  const serialized = {
    requestName,
    ...serializeError(error)
  }
  const current = readDiagnostics()

  writeDiagnostics({
    ...current,
    lastFailedRequest: serialized,
    lastError: serialized
  })

  console.error('[CalCheck] API error', serialized)
}

export const recordImageDiagnostics = (details) => {
  const nextDetails = {
    ...details,
    timestamp: new Date().toISOString()
  }
  const current = readDiagnostics()

  writeDiagnostics({
    ...current,
    lastImage: nextDetails
  })

  console.info('[CalCheck] image diagnostics', nextDetails)
}

export const recordPerformanceMetric = (name, details = {}) => {
  const current = readDiagnostics()
  const entry = {
    name,
    ...details,
    timestamp: new Date().toISOString()
  }

  writeDiagnostics({
    ...current,
    performance: [entry, ...(current.performance || [])].slice(0, 12)
  })

  console.info('[CalCheck] performance metric', entry)
}

export const recordStartupStep = (entry) => {
  const current = readDiagnostics()
  const nextEntry = {
    ...entry,
    timestamp: entry.timestamp || new Date().toISOString()
  }

  writeDiagnostics({
    ...current,
    startup: [nextEntry, ...(current.startup || [])].slice(0, MAX_STARTUP_STEPS)
  })

  console.info('[CalCheck] startup step', nextEntry)
}

export const getPendingRequestsSnapshot = () =>
  Array.from(inFlightRequestMeta.values()).map((entry) => ({
    ...entry,
    ageMs: Math.max(0, Math.round(safeNow() - entry.startMs)),
    startMs: undefined
  }))

export const recordLifecycleEvent = (name, details = {}) => {
  const current = readDiagnostics()
  const entry = {
    name,
    ...details,
    pendingRequests: getPendingRequestsSnapshot(),
    timestamp: new Date().toISOString()
  }

  writeDiagnostics({
    ...current,
    lifecycle: [entry, ...(current.lifecycle || [])].slice(0, MAX_LIFECYCLE_EVENTS)
  })

  console.info('[CalCheck] lifecycle event', entry)
}

export const trackStartupStep = async (
  name,
  taskFactory,
  {
    blocksRender = false,
    timeoutMs = 5000,
    fallbackValue = null
  } = {}
) => {
  const startMs = safeNow()
  const startTime = new Date().toISOString()
  let timeoutId
  let timedOut = false

  try {
    const taskPromise = Promise.resolve().then(taskFactory)
    const guardedTaskPromise = taskPromise.catch((error) => {
      if (timedOut) {
        console.warn('[CalCheck] startup task rejected after timeout', { name, error })
        return fallbackValue
      }

      throw error
    })
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = window.setTimeout(() => {
        timedOut = true
        resolve(fallbackValue)
      }, timeoutMs)
    })

    const result = await Promise.race([guardedTaskPromise, timeoutPromise])
    const endTime = new Date().toISOString()
    const durationMs = Math.round(safeNow() - startMs)

    recordStartupStep({
      name,
      startTime,
      endTime,
      durationMs,
      success: !timedOut,
      timedOut,
      blocksRender,
      timeoutMs
    })

    return result
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(safeNow() - startMs)

    recordStartupStep({
      name,
      startTime,
      endTime,
      durationMs,
      success: false,
      timedOut,
      blocksRender,
      timeoutMs,
      error: serializeError(error)
    })

    throw error
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId)
  }
}

export const trackApiRequest = async (requestName, requestFactory, options = {}) => {
  const dedupeKey = options.dedupeKey || null
  if (dedupeKey && inFlightRequests.has(dedupeKey)) {
    if (options.profileFetchBlockedByDedupe) {
      console.info('[CalCheck] PROFILE_FETCH_BLOCKED_BY_DEDUPE', {
        requestName,
        dedupeKey,
        reason: 'enclosing-request-deduped'
      })
    }
    console.info('[CalCheck] API request deduped', { requestName, dedupeKey })
    recordLifecycleEvent('duplicate request deduped', { requestName, dedupeKey })
    return inFlightRequests.get(dedupeKey)
  }

  const startMs = safeNow()
  const startTime = new Date().toISOString()
  const requestKey = dedupeKey || `${requestName}:${startTime}:${Math.random().toString(36).slice(2, 8)}`
  let longRequestTimer
  let longRequestLogged = false

  if (typeof window !== 'undefined') {
    longRequestTimer = window.setTimeout(() => {
      longRequestLogged = true
      const message = 'This request is taking longer than expected.'
      console.warn('[CalCheck] API request slow', {
        requestName,
        duration_ms: LONG_REQUEST_MS,
        message
      })
      options.onLongRequest?.(message)
    }, LONG_REQUEST_MS)
  }

  console.info('[CalCheck] API request started', { requestName, startTime })
  inFlightRequestMeta.set(requestKey, {
    requestName,
    dedupeKey,
    startTime,
    startMs
  })

  const requestPromise = (async () => {
    const result = await requestFactory()
    const endMs = safeNow()
    const endTime = new Date().toISOString()
    const durationMs = Math.round(endMs - startMs)

    if (result?.error) {
      const serialized = serializeError(result.error)

      recordRequest({
        requestName,
        startTime,
        endTime,
        durationMs,
        success: false,
        longRequestLogged,
        error: serialized
      })
      recordError(requestName, result.error)
      console.info('[CalCheck] API request completed', {
        requestName,
        startTime,
        endTime,
        duration_ms: durationMs,
        success: false,
        error: serialized
      })
      return result
    }

    recordRequest({
      requestName,
      startTime,
      endTime,
      durationMs,
      success: true,
      longRequestLogged
    })
    console.info('[CalCheck] API request completed', {
      requestName,
      startTime,
      endTime,
      duration_ms: durationMs,
      success: true
    })
    return result
  })()

  if (dedupeKey) inFlightRequests.set(dedupeKey, requestPromise)

  try {
    return await requestPromise
  } catch (error) {
    const endMs = safeNow()
    const endTime = new Date().toISOString()
    const durationMs = Math.round(endMs - startMs)
    const serialized = serializeError(error)

    recordRequest({
      requestName,
      startTime,
      endTime,
      durationMs,
      success: false,
      longRequestLogged,
      error: serialized
    })
    recordError(requestName, error)
    console.info('[CalCheck] API request completed', {
      requestName,
      startTime,
      endTime,
      duration_ms: durationMs,
      success: false,
      error: serialized
    })
    throw error
  } finally {
    if (longRequestTimer) window.clearTimeout(longRequestTimer)
    if (dedupeKey) inFlightRequests.delete(dedupeKey)
    inFlightRequestMeta.delete(requestKey)
  }
}

const recordRequest = (entry) => {
  const current = readDiagnostics()
  const nextRequests = [
    {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    },
    ...(current.requests || [])
  ].slice(0, MAX_REQUESTS)

  writeDiagnostics({
    ...current,
    requests: nextRequests,
    lastFailedRequest: entry.success ? current.lastFailedRequest : {
      requestName: entry.requestName,
      ...(entry.error || {}),
      timestamp: entry.endTime
    },
    lastError: entry.success ? current.lastError : {
      requestName: entry.requestName,
      ...(entry.error || {}),
      timestamp: entry.endTime
    }
  })
}
