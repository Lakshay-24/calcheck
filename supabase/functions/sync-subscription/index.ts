import {
  corsHeaders,
  createServiceClient,
  getAuthenticatedUser,
  jsonResponse,
  razorpayRequest,
  upsertSubscriptionState
} from '../_shared/subscriptions.ts'

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

  try {
    const user = await getAuthenticatedUser(request)
    const supabase = createServiceClient()

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select(PROFILE_COLUMNS)
      .eq('id', user.id)
      .single()

    if (profileError) throw profileError
    if (!profile?.razorpay_subscription_id) {
      return jsonResponse({ profile, subscription: null })
    }

    const subscription = await razorpayRequest(`/subscriptions/${profile.razorpay_subscription_id}`)

    const updatedProfile = await upsertSubscriptionState(
      supabase,
      user.id,
      subscription,
      'sync',
      {
        currency: profile.subscription_currency,
        amountMinor: profile.subscription_currency === 'USD' ? 199 : 6900,
        billingCountry: profile.billing_country
      }
    )

    return jsonResponse({ profile: updatedProfile, subscription })
  } catch (error) {
    console.error('sync-subscription failed', error)
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Could not sync subscription'
    }, 400)
  }
})
