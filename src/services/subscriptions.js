import { supabase } from './supabase'
import { recordError, recordPerformanceMetric, trackApiRequest } from './diagnostics'

const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let razorpayScriptPromise = null

const nowMs = () => {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

const recordCheckoutTiming = (step, details = {}) => {
  recordPerformanceMetric('razorpay checkout timing', {
    step,
    ...details
  })
}

export const createSubscription = async (options = {}) => {
  const flowId = options.flowId || `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const flowStartedAt = options.flowStartedAt || nowMs()
  const invokeStartedAt = nowMs()

  recordCheckoutTiming('EDGE_FUNCTION_INVOKE_START', {
    flowId,
    elapsedMs: Math.round(invokeStartedAt - flowStartedAt)
  })

  const { data, error } = await trackApiRequest('create subscription', () => supabase.functions.invoke('create-subscription', {
    body: { checkout_flow_id: flowId }
  }))

  const responseReceivedAt = nowMs()
  recordCheckoutTiming('EDGE_FUNCTION_RESPONSE_RECEIVED', {
    flowId,
    elapsedMs: Math.round(responseReceivedAt - flowStartedAt),
    durationMs: Math.round(responseReceivedAt - invokeStartedAt),
    serverTimings: data?.timings || null
  })

  if (error) throw new Error(error.message || 'Could not create subscription')
  if (data?.error) {
    const responseError = new Error(data.error)
    recordError('create subscription', responseError)
    throw responseError
  }
  return data
}

export const syncSubscription = async () => {
  const { data, error } = await trackApiRequest('sync subscription', () => supabase.functions.invoke('sync-subscription', {
    body: {}
  }))

  if (error) throw new Error(error.message || 'Could not sync subscription')
  if (data?.error) {
    const responseError = new Error(data.error)
    recordError('sync subscription', responseError)
    throw responseError
  }
  return data
}

export const cancelSubscription = async () => {
  const { data, error } = await trackApiRequest('cancel subscription', () => supabase.functions.invoke('cancel-subscription', {
    body: {}
  }))

  if (error) throw new Error(error.message || 'Could not cancel subscription')
  if (data?.error) {
    const responseError = new Error(data.error)
    recordError('cancel subscription', responseError)
    throw responseError
  }
  return data
}

export const openRazorpaySubscriptionCheckout = async ({
  keyId,
  subscriptionId,
  user,
  onAuthorized,
  onDismiss,
  flowId,
  flowStartedAt = nowMs()
}) => {
  const scriptStartedAt = nowMs()
  recordCheckoutTiming('CHECKOUT_JS_LOAD_START', {
    flowId,
    elapsedMs: Math.round(scriptStartedAt - flowStartedAt),
    alreadyLoaded: Boolean(window.Razorpay)
  })

  await loadRazorpayScript()

  const scriptLoadedAt = nowMs()
  recordCheckoutTiming('CHECKOUT_JS_LOAD_END', {
    flowId,
    elapsedMs: Math.round(scriptLoadedAt - flowStartedAt),
    durationMs: Math.round(scriptLoadedAt - scriptStartedAt),
    alreadyLoaded: Boolean(window.Razorpay)
  })

  if (!window.Razorpay) {
    throw new Error('Razorpay Checkout could not be loaded')
  }

  const checkout = new window.Razorpay({
    key: keyId || import.meta.env.VITE_RAZORPAY_KEY_ID,
    subscription_id: subscriptionId,
    name: 'CalCheck AI',
    description: 'CalCheck Pro Subscription',
    prefill: {
      email: user?.email || '',
      contact: '9999999900'
    },
    theme: {
      color: '#11F5F6'
    },
    handler: (response) => {
      onAuthorized?.(response)
    },
    modal: {
      ondismiss: () => {
        onDismiss?.()
      }
    }
  })

  checkout.open()
  recordCheckoutTiming('CHECKOUT_OPENED', {
    flowId,
    elapsedMs: Math.round(nowMs() - flowStartedAt)
  })
}

export const preloadRazorpayCheckout = (reason = 'idle') => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const preload = () => {
    recordCheckoutTiming('CHECKOUT_JS_IDLE_PRELOAD_START', { reason })
    loadRazorpayScript()
      .then(() => recordCheckoutTiming('CHECKOUT_JS_IDLE_PRELOAD_SUCCESS', { reason }))
      .catch((error) => {
        recordCheckoutTiming('CHECKOUT_JS_IDLE_PRELOAD_FAILED', {
          reason,
          error: error?.message || String(error)
        })
      })
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(preload, { timeout: 4000 })
    return
  }

  window.setTimeout(preload, 2500)
}

const loadRazorpayScript = () => {
  if (window.Razorpay) return Promise.resolve()

  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = RAZORPAY_CHECKOUT_URL
      script.async = true
      script.onload = resolve
      script.onerror = () => {
        razorpayScriptPromise = null
        reject(new Error('Failed to load Razorpay Checkout'))
      }
      document.body.appendChild(script)
    })
  }

  return razorpayScriptPromise
}
