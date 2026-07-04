import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'
import { interpretStatus } from '../../../../lib/sonicpesa'

/**
 * SonicPesa webhook receiver.
 * Configure this URL in the SonicPesa dashboard (API Settings -> Webhook URL):
 *   https://nabogaming.live/api/sonicpesa/webhook
 *
 * SECURITY NOTE: the docs show signature verification as
 *   hash_hmac('sha256', $payload_raw, $apiSecret)
 * but don't clearly state whether $apiSecret is your API key or a separate
 * webhook secret shown in the dashboard. Confirm with SonicPesa support,
 * then set SONICPESA_WEBHOOK_SECRET accordingly. If you can't get a straight
 * answer, this route still works safely as a *supplement* to the polling
 * flow already in the app — just don't rely on it exclusively until the
 * signature is verified to actually match.
 */
export async function POST(req) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-sonicpesa-signature') || ''

  const secret = process.env.SONICPESA_WEBHOOK_SECRET
  if (secret) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const valid =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const orderId = payload?.order_id
  const status  = interpretStatus(payload?.status)

  if (!orderId) {
    return NextResponse.json({ ok: false, error: 'Missing order_id' }, { status: 400 })
  }

  // Only act on success — pending/failed webhooks are informational for now
  if (status !== 'success') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  try {
    const admin = getSupabaseAdmin()

    // Find the pending subscription we stored payment_ref = order_id for
    const { data: sub } = await admin
      .from('subscriptions')
      .select('id, status')
      .eq('payment_ref', orderId)
      .eq('payment_method', 'sonicpesa')
      .maybeSingle()

    if (sub) {
      // Already activated (e.g. client-side polling beat the webhook) — no-op
      if (sub.status === 'active') {
        return NextResponse.json({ ok: true, already_active: true })
      }
      const { error: rpcErr } = await admin.rpc('activate_subscription', {
        p_subscription_id: sub.id,
        p_months: 1,
      })
      if (rpcErr) throw rpcErr
      return NextResponse.json({ ok: true })
    }

    // Not a subscription — check tournament entry fee payments instead.
    // NOTE: this only backstops the `tournament_payments` row. Actually
    // enrolling the player into `tournament_participants` (bracket
    // placement, group auto-draw, notifications) happens client-side in
    // register() when the poll in the tournament page sees success. If the
    // client closes before that poll fires, this marks the payment
    // approved but the player needs to reopen the tournament page once to
    // finish registering — same client-side-only limitation as the rest
    // of the app until scheduled jobs exist.
    const { data: pmt } = await admin
      .from('tournament_payments')
      .select('id, status')
      .eq('payment_ref', orderId)
      .eq('payment_method', 'sonicpesa')
      .maybeSingle()

    if (!pmt) {
      return NextResponse.json({ ok: false, error: 'No subscription or tournament payment found for order' }, { status: 404 })
    }
    if (pmt.status === 'approved') {
      return NextResponse.json({ ok: true, already_approved: true })
    }

    const { error: updErr } = await admin
      .from('tournament_payments')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', pmt.id)
    if (updErr) throw updErr

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || 'Activation failed' }, { status: 500 })
  }
}
