import {
  corsHeaders,
  createServiceClient,
  getAuthenticatedUser,
  jsonResponse,
  razorpayRequest
} from '../_shared/subscriptions.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const user = await getAuthenticatedUser(request)
    const supabase = createServiceClient()

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profileError) throw profileError
    if (!profile?.razorpay_subscription_id) {
      return jsonResponse({ error: 'No active subscription found' }, 404)
    }

    const subscription = await razorpayRequest(
      `/subscriptions/${profile.razorpay_subscription_id}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ cancel_at_cycle_end: 1 })
      }
    )

    const now = new Date().toISOString()
    const { data: updatedProfile, error: updateError } = await supabase
      .from('users')
      .update({
        subscription_status: 'cancelled',
        subscription_cancel_at_period_end: true,
        subscription_cancelled_at: now,
        subscription_updated_at: now
      })
      .eq('id', user.id)
      .select()
      .single()

    if (updateError) throw updateError

    await supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancel_at_period_end: true,
        cancelled_at: now,
        raw_subscription: subscription,
        updated_at: now
      })
      .eq('provider_subscription_id', profile.razorpay_subscription_id)

    return jsonResponse({ profile: updatedProfile, subscription })
  } catch (error) {
    console.error('cancel-subscription failed', error)
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Could not cancel subscription'
    }, 400)
  }
})
