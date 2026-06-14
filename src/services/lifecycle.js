import { recordLifecycleEvent } from './diagnostics'

const activeControllers = new Map()
let lifecycleGeneration = 0

export const getLifecycleGeneration = () => lifecycleGeneration

export const recordAppLifecycleEvent = (name, details = {}) => {
  recordLifecycleEvent(name, {
    generation: lifecycleGeneration,
    ...details
  })
}

export const createLifecycleAbortController = (label) => {
  const controller = new AbortController()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  activeControllers.set(id, {
    id,
    label,
    controller,
    startedAt: new Date().toISOString()
  })

  recordAppLifecycleEvent('request controller registered', {
    id,
    label,
    activeControllers: activeControllers.size
  })

  return {
    id,
    signal: controller.signal,
    abort: (reason = 'manual abort') => abortLifecycleRequest(id, reason),
    release: () => releaseLifecycleRequest(id)
  }
}

export const abortLifecycleRequests = (reason = 'app backgrounded') => {
  lifecycleGeneration += 1

  const controllers = Array.from(activeControllers.values())
  controllers.forEach((entry) => {
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(reason)
    }
  })

  activeControllers.clear()
  recordAppLifecycleEvent('background requests aborted', {
    reason,
    abortedCount: controllers.length,
    abortedLabels: controllers.map((entry) => entry.label)
  })
}

const abortLifecycleRequest = (id, reason) => {
  const entry = activeControllers.get(id)
  if (!entry) return

  if (!entry.controller.signal.aborted) {
    entry.controller.abort(reason)
  }

  activeControllers.delete(id)
  recordAppLifecycleEvent('request controller aborted', {
    id,
    label: entry.label,
    reason,
    activeControllers: activeControllers.size
  })
}

const releaseLifecycleRequest = (id) => {
  const entry = activeControllers.get(id)
  if (!entry) return

  activeControllers.delete(id)
  recordAppLifecycleEvent('request controller released', {
    id,
    label: entry.label,
    activeControllers: activeControllers.size
  })
}
