import { supabase } from './supabase'

const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let razorpayScriptPromise = null

export const createSubscription = async () => {
  const { data, error } = await supabase.functions.invoke('create-subscription', {
    body: {}
  })

  if (error) throw new Error(error.message || 'Could not create subscription')
  if (data?.error) throw new Error(data.error)
  return data
}

export const syncSubscription = async () => {
  const { data, error } = await supabase.functions.invoke('sync-subscription', {
    body: {}
  })

  if (error) throw new Error(error.message || 'Could not sync subscription')
  if (data?.error) throw new Error(data.error)
  return data
}

export const cancelSubscription = async () => {
  const { data, error } = await supabase.functions.invoke('cancel-subscription', {
    body: {}
  })

  if (error) throw new Error(error.message || 'Could not cancel subscription')
  if (data?.error) throw new Error(data.error)
  return data
}

export const openRazorpaySubscriptionCheckout = async ({
  keyId,
  subscriptionId,
  user,
  onAuthorized,
  onDismiss
}) => {
  await loadRazorpayScript()

  if (!window.Razorpay) {
    throw new Error('Razorpay Checkout could not be loaded')
  }

  const checkout = new window.Razorpay({
    key: keyId || import.meta.env.VITE_RAZORPAY_KEY_ID,
    subscription_id: subscriptionId,
    name: 'CalCheck AI',
    description: 'CalCheck Pro Subscription',
    prefill: {
      email: user?.email || ''
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
}

const loadRazorpayScript = () => {
  if (window.Razorpay) return Promise.resolve()

  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = RAZORPAY_CHECKOUT_URL
      script.async = true
      script.onload = resolve
      script.onerror = () => reject(new Error('Failed to load Razorpay Checkout'))
      document.body.appendChild(script)
    })
  }

  return razorpayScriptPromise
}
