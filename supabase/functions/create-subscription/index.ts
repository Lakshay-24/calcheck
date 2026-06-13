import {
  corsHeaders,
  createServiceClient,
  getAuthenticatedUser,
  jsonResponse,
  razorpayRequest
} from '../_shared/subscriptions.ts'

const INR_PLAN_ID = Deno.env.get('RAZORPAY_PLAN_ID_INR_MONTHLY') || 'plan_T0xf4EGXgLZ24b'
const USD_PLAN_ID = Deno.env.get('RAZORPAY_PLAN_ID_USD_MONTHLY') || 'plan_T0xfxE81gmOfCY'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const user = await getAuthenticatedUser(request)
    const supabase = createServiceClient()
    const country = detectCountry(request)
    const isIndia = country === 'IN'
    const planId = isIndia ? INR_PLAN_ID : USD_PLAN_ID
    const currency = isIndia ? 'INR' : 'USD'
    const amountMinor = isIndia ? 6900 : 199

    let { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile) {
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
        .select()
        .single()

      if (createError) throw createError
      profile = created
    }

    if (profile?.is_pro && profile?.subscription_status === 'active') {
      return jsonResponse({ already_pro: true, profile })
    }

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

    const now = new Date().toISOString()

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
      .select()
      .single()

    if (userError) throw userError

    return jsonResponse({
      key_id: Deno.env.get('RAZORPAY_KEY_ID'),
      subscription_id: subscription.id,
      plan_id: planId,
      currency,
      amount_minor: amountMinor,
      billing_country: country,
      name: 'CalCheck AI',
      description: 'CalCheck Pro Subscription',
      profile: updatedProfile
    })
  } catch (error) {
    console.error('create-subscription failed', error)
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Could not create subscription'
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
