import {
  corsHeaders,
  createServiceClient,
  extractPayment,
  extractSubscription,
  jsonResponse,
  toIsoFromUnix,
  upsertSubscriptionState
} from '../_shared/subscriptions.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-razorpay-signature') || ''

    if (!await verifyRazorpaySignature(rawBody, signature)) {
      return jsonResponse({ error: 'Invalid webhook signature' }, 401)
    }

    const payload = JSON.parse(rawBody)
    const eventType = String(payload.event || '')
    const eventId = request.headers.get('x-razorpay-event-id') || String(payload.id || `${eventType}:${Date.now()}`)
    const subscription = extractSubscription(payload)
    const payment = extractPayment(payload)
    const providerSubscriptionId = subscription?.id ? String(subscription.id) : null
    const providerPaymentId = payment?.id ? String(payment.id) : null
    const supabase = createServiceClient()

    const { error: eventInsertError } = await supabase
      .from('razorpay_webhook_events')
      .insert({
        event_id: eventId,
        event_type: eventType,
        provider_subscription_id: providerSubscriptionId,
        provider_payment_id: providerPaymentId,
        payload
      })

    if (eventInsertError) {
      if (eventInsertError.code === '23505') {
        return jsonResponse({ received: true, duplicate: true })
      }

      throw eventInsertError
    }

    if (!subscription || !providerSubscriptionId) {
      return jsonResponse({ received: true, ignored: true })
    }

    const notes = typeof subscription.notes === 'object' && subscription.notes
      ? subscription.notes as Record<string, unknown>
      : {}
    const userId = String(notes.user_id || '')

    if (!userId) {
      console.error('Razorpay webhook missing user_id note', { eventType, providerSubscriptionId })
      return jsonResponse({ received: true, missing_user_id: true })
    }

    const currency = String(payment?.currency || subscription.currency || '').toUpperCase() || null
    const amountMinor = Number(payment?.amount || subscription.amount || 0)
    const billingCountry = String(notes.billing_country || '').toUpperCase() || null
    const lastPaymentAt = eventType === 'subscription.charged'
      ? toIsoFromUnix(payment?.created_at) || new Date().toISOString()
      : null

    await upsertSubscriptionState(supabase, userId, subscription, eventType, {
      currency,
      amountMinor,
      billingCountry,
      lastPaymentAt
    })

    return jsonResponse({ received: true })
  } catch (error) {
    console.error('razorpay-webhook failed', error)
    return jsonResponse({ error: 'Webhook processing failed' }, 400)
  }
})

async function verifyRazorpaySignature(rawBody: string, signature: string) {
  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!webhookSecret || !signature) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return timingSafeEqual(expected, signature)
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return result === 0
}
