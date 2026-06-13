import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-razorpay-event-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  })

export const createServiceClient = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service credentials are not configured')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

export const getAuthenticatedUser = async (request: Request) => {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('Missing authorization token')

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) throw new Error('Supabase auth credentials are not configured')

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid authorization token')
  return data.user
}

export const razorpayRequest = async (path: string, init: RequestInit = {}) => {
  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) throw new Error('Razorpay credentials are not configured')

  const auth = btoa(`${keyId}:${keySecret}`)
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    console.error('Razorpay request failed', { path, status: response.status, data })
    throw new Error(data?.error?.description || data?.error?.reason || 'Razorpay request failed')
  }

  return data
}

export const toIsoFromUnix = (value: unknown) => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

export const addDaysIso = (isoValue: string | null, days: number) => {
  const base = isoValue ? new Date(isoValue) : new Date()
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString()
}

export const extractSubscription = (payload: Record<string, unknown>) => {
  const nested = payload?.payload as Record<string, unknown> | undefined
  const subscriptionPayload = nested?.subscription as Record<string, unknown> | undefined
  const entity = subscriptionPayload?.entity as Record<string, unknown> | undefined
  return entity || null
}

export const extractPayment = (payload: Record<string, unknown>) => {
  const nested = payload?.payload as Record<string, unknown> | undefined
  const paymentPayload = nested?.payment as Record<string, unknown> | undefined
  const entity = paymentPayload?.entity as Record<string, unknown> | undefined
  return entity || null
}

export const normalizeSubscriptionState = (subscription: Record<string, unknown>, eventType = '') => {
  const providerSubscriptionId = String(subscription.id || '')
  const providerCustomerId = subscription.customer_id ? String(subscription.customer_id) : null
  const providerPlanId = String(subscription.plan_id || '')
  const status = String(subscription.status || 'pending')
  const currentPeriodStart = toIsoFromUnix(subscription.current_start)
  const currentPeriodEnd = toIsoFromUnix(subscription.current_end)
  const cancelledAt = toIsoFromUnix(subscription.ended_at) || toIsoFromUnix(subscription.cancelled_at)
  const chargeAt = toIsoFromUnix(subscription.charge_at)
  const now = new Date()

  let appStatus = mapRazorpayStatus(status)
  let isPro = appStatus === 'active'
  let gracePeriodUntil: string | null = null

  if (eventType === 'subscription.pending' || status === 'pending' || status === 'halted') {
    gracePeriodUntil = addDaysIso(currentPeriodEnd || chargeAt, 4)
    const inGrace = new Date(gracePeriodUntil).getTime() > now.getTime()
    appStatus = inGrace ? 'grace' : 'expired'
    isPro = inGrace
  }

  if (status === 'cancelled') {
    const periodEnd = currentPeriodEnd ? new Date(currentPeriodEnd) : null
    const keepUntilPeriodEnd = Boolean(periodEnd && periodEnd.getTime() > now.getTime())
    appStatus = keepUntilPeriodEnd ? 'cancelled' : 'expired'
    isPro = keepUntilPeriodEnd
  }

  if (status === 'completed' || status === 'expired') {
    appStatus = status
    isPro = false
  }

  return {
    providerSubscriptionId,
    providerCustomerId,
    providerPlanId,
    appStatus,
    razorpayStatus: status,
    isPro,
    currentPeriodStart,
    currentPeriodEnd,
    gracePeriodUntil,
    cancelledAt
  }
}

const mapRazorpayStatus = (status: string) => {
  if (status === 'active' || status === 'authenticated') return 'active'
  if (status === 'created') return 'pending'
  if (status === 'pending') return 'grace'
  if (status === 'halted') return 'halted'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'completed') return 'completed'
  if (status === 'expired') return 'expired'
  return 'pending'
}

export const upsertSubscriptionState = async (
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  subscription: Record<string, unknown>,
  eventType = '',
  extras: {
    currency?: string | null
    amountMinor?: number | null
    billingCountry?: string | null
    lastPaymentAt?: string | null
  } = {}
) => {
  const state = normalizeSubscriptionState(subscription, eventType)
  const fallbackCurrency = state.providerPlanId === Deno.env.get('RAZORPAY_PLAN_ID_USD_MONTHLY')
    ? 'USD'
    : 'INR'
  const currency = extras.currency || String(subscription.currency || '').toUpperCase() || fallbackCurrency
  const fallbackAmountMinor = currency === 'USD' ? 199 : 6900
  const amountMinor = extras.amountMinor ?? (Number(subscription.amount || 0) || fallbackAmountMinor)

  const subscriptionPayload = {
    user_id: userId,
    provider: 'razorpay',
    provider_subscription_id: state.providerSubscriptionId,
    provider_customer_id: state.providerCustomerId,
    provider_plan_id: state.providerPlanId,
    status: state.appStatus,
    currency,
    amount_minor: amountMinor,
    billing_country: extras.billingCountry || null,
    current_period_start: state.currentPeriodStart,
    current_period_end: state.currentPeriodEnd,
    grace_period_until: state.gracePeriodUntil,
    last_payment_at: extras.lastPaymentAt || null,
    cancel_at_period_end: state.appStatus === 'cancelled' && state.isPro,
    cancelled_at: state.cancelledAt,
    raw_subscription: subscription,
    updated_at: new Date().toISOString()
  }

  const { error: subscriptionError } = await supabase
    .from('subscriptions')
    .upsert(subscriptionPayload, { onConflict: 'provider_subscription_id' })

  if (subscriptionError) throw subscriptionError

  const userPayload = {
    is_pro: state.isPro,
    subscription_status: state.appStatus,
    razorpay_customer_id: state.providerCustomerId,
    razorpay_subscription_id: state.providerSubscriptionId,
    razorpay_plan_id: state.providerPlanId,
    subscription_currency: currency,
    billing_country: extras.billingCountry || undefined,
    current_period_start: state.currentPeriodStart,
    current_period_end: state.currentPeriodEnd,
    grace_period_until: state.gracePeriodUntil,
    last_payment_at: extras.lastPaymentAt || undefined,
    subscription_cancel_at_period_end: state.appStatus === 'cancelled' && state.isPro,
    subscription_cancelled_at: state.cancelledAt,
    subscription_updated_at: new Date().toISOString()
  }

  const { data: profile, error: userError } = await supabase
    .from('users')
    .update(userPayload)
    .eq('id', userId)
    .select()
    .single()

  if (userError) throw userError
  return profile
}
