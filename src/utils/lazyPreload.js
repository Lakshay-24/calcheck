import { logAppEvent } from './appDiagnostics'

const DEFAULT_IDLE_TIMEOUT_MS = 2500
const DEFAULT_FALLBACK_DELAY_MS = 1200

export const runWhenIdle = (task, options = {}) => {
  if (typeof window === 'undefined' || typeof task !== 'function') return null

  const timeout = options.timeout ?? DEFAULT_IDLE_TIMEOUT_MS
  const fallbackDelay = options.fallbackDelay ?? DEFAULT_FALLBACK_DELAY_MS

  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(task, { timeout })
    return () => window.cancelIdleCallback?.(id)
  }

  const id = window.setTimeout(task, fallbackDelay)
  return () => window.clearTimeout(id)
}

export const shouldSkipIdlePreload = () => {
  if (typeof navigator === 'undefined') return true

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (connection?.saveData) return true
  if (Number(navigator.deviceMemory) > 0 && Number(navigator.deviceMemory) <= 2) return true

  return false
}

export const preloadLazyModule = async (moduleName, loader, context = {}) => {
  if (!moduleName || typeof loader !== 'function') return null

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  logAppEvent('APP_IDLE_PRELOAD_STARTED', {
    level: 'info',
    screen: context.screen || 'app',
    operation: 'lazy module preload',
    metadata: {
      module: moduleName,
      reason: context.reason || 'idle'
    }
  })

  try {
    const loadedModule = await loader()
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const durationMs = Math.max(0, Math.round(endedAt - startedAt))

    logAppEvent('APP_IDLE_PRELOAD_COMPLETED', {
      level: 'info',
      screen: context.screen || 'app',
      operation: 'lazy module preload',
      duration_ms: durationMs,
      metadata: {
        module: moduleName,
        reason: context.reason || 'idle'
      }
    })
    logAppEvent('LAZY_MODULE_LOADED', {
      level: 'info',
      screen: context.screen || 'app',
      operation: 'lazy module loaded',
      duration_ms: durationMs,
      metadata: {
        module: moduleName
      }
    })

    return loadedModule
  } catch (error) {
    logAppEvent('APP_IDLE_PRELOAD_FAILED', {
      level: 'warn',
      screen: context.screen || 'app',
      operation: 'lazy module preload',
      normalized_message: 'Module preload failed.',
      metadata: {
        module: moduleName,
        reason: context.reason || 'idle',
        error_name: error?.name || 'Error'
      }
    })
    return null
  }
}

export const preloadLazyModuleWhenIdle = (moduleName, loader, context = {}) => {
  if (shouldSkipIdlePreload()) return null
  return runWhenIdle(() => preloadLazyModule(moduleName, loader, context), context)
}
