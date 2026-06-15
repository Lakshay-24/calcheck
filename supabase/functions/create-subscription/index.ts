import {
  corsHeaders,
  createServiceClient,
  getAuthenticatedUser,
  jsonResponse,
  razorpayRequest
} from '../_shared/subscriptions.ts'

const INR_PLAN_ID = Deno.env.get('RAZORPAY_PLAN_ID_INR_MONTHLY') || 'plan_T0xf4EGXgLZ24b'
const USD_PLAN_ID = Deno.env.get('RAZORPAY_PLAN_ID_USD_MONTHLY') || 'plan_T0xfxE81gmOfCY'
const PROFILE_COLUMNS = [
  'id',
  'email',
  'subscription_status',
  'is_pro',
  'razorpay_subscription_id',
  'subscription_currency',
  'billing_country',
  'current_period_end',
  'subscription_cancel_at_period_end'
].join(',')

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const functionStartedAt = performance.now()
  const timings: Record<string, number> = {}
  let checkoutFlowId = 'unknown'
  const markTiming = (name: string, startedAt: number) => {
    timings[name] = Math.round(performance.now() - startedAt)
  }

  try {
    const requestBody = await request.json().catch(() => ({})) as Record<string, unknown>
    checkoutFlowId = typeof requestBody.checkout_flow_id === 'string'
      ? requestBody.checkout_flow_id
      : checkoutFlowId

    const authStartedAt = performance.now()
    const user = await getAuthenticatedUser(request)
    markTiming('auth_user_lookup_ms', authStartedAt)

    const clientStartedAt = performance.now()
    const supabase = createServiceClient()
    markTiming('service_client_create_ms', clientStartedAt)
    const country = detectCountry(request)
    const isIndia = country === 'IN'
    const planId = isIndia ? INR_PLAN_ID : USD_PLAN_ID
    const currency = isIndia ? 'INR' : 'USD'
    const amountMinor = isIndia ? 6900 : 199

    const profileLookupStartedAt = performance.now()
    let { data: profile } = await supabase
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', user.id)
      .maybeSingle()
    markTiming('profile_lookup_ms', profileLookupStartedAt)

    if (!profile) {
      const profileCreateStartedAt = performance.now()
      const { data: created, error: createError } = await supabase
        .from('users')
        .insert({
          id: user.id,
          email: user.email,
          goal: 'muscle_gain',
          calorie_target: 2500,
          protein_target: 150,
          subscription_status: 'free',
          is_pro: false,
          scans_used_today: 0,
          billing_country: country,
          subscription_currency: currency,
          subscription_updated_at: new Date().toISOString()
        })
        .select(PROFILE_COLUMNS)
        .single()

      if (createError) throw createError
      profile = created
      markTiming('profile_create_ms', profileCreateStartedAt)
    }

    if (profile?.is_pro && profile?.subscription_status === 'active') {
      timings.total_ms = Math.round(performance.now() - functionStartedAt)
      console.info('create-subscription timing', { checkoutFlowId, alreadyPro: true, timings })
      return jsonResponse({ already_pro: true, profile, timings })
    }

    const razorpayStartedAt = performance.now()
    const subscription = await razorpayRequest('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
        total_count: 359,
        quantity: 1,
        customer_notify: 1,
        notes: {
          user_id: user.id,
          email: user.email || '',
          billing_country: country,
          app: 'calcheck'
        }
      })
    })
    markTiming('razorpay_subscription_create_ms', razorpayStartedAt)

    const now = new Date().toISOString()

    const subscriptionWriteStartedAt = performance.now()
    const { error: subscriptionError } = await supabase
      .from('subscriptions')
      .upsert({
        user_id: user.id,
        provider: 'razorpay',
        provider_subscription_id: subscription.id,
        provider_customer_id: subscription.customer_id || null,
        provider_plan_id: planId,
        status: 'pending',
        currency,
        amount_minor: amountMinor,
        billing_country: country,
        raw_subscription: subscription,
        updated_at: now
      }, { onConflict: 'provider_subscription_id' })

    if (subscriptionError) throw subscriptionError
    markTiming('subscription_db_write_ms', subscriptionWriteStartedAt)

    const profileUpdateStartedAt = performance.now()
    const { data: updatedProfile, error: userError } = await supabase
      .from('users')
      .update({
        subscription_status: 'pending',
        razorpay_customer_id: subscription.customer_id || null,
        razorpay_subscription_id: subscription.id,
        razorpay_plan_id: planId,
        subscription_currency: currency,
        billing_country: country,
        subscription_cancel_at_period_end: false,
        subscription_cancelled_at: null,
        subscription_updated_at: now
      })
      .eq('id', user.id)
      .select(PROFILE_COLUMNS)
      .single()

    if (userError) throw userError
    markTiming('profile_db_update_ms', profileUpdateStartedAt)
    timings.total_ms = Math.round(performance.now() - functionStartedAt)
    console.info('create-subscription timing', { checkoutFlowId, timings })

    return jsonResponse({
      key_id: Deno.env.get('RAZORPAY_KEY_ID'),
      subscription_id: subscription.id,
      plan_id: planId,
      currency,
      amount_minor: amountMinor,
      billing_country: country,
      name: 'CalCheck AI',
      description: 'CalCheck Pro Subscription',
      profile: updatedProfile,
      timings
    })
  } catch (error) {
    timings.total_ms = Math.round(performance.now() - functionStartedAt)
    console.error('create-subscription failed', { checkoutFlowId, timings, error })
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Could not create subscription',
      timings
    }, 400)
  }
})

function detectCountry(request: Request) {
  const country = (
    request.headers.get('x-vercel-ip-country') ||
    request.headers.get('cf-ipcountry') ||
    'IN'
  ).toUpperCase()

  return /^[A-Z]{2}$/.test(country) ? country : 'IN'
}
