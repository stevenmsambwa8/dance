import { NextResponse } from 'next/server'
import { createOrder, normalizeTzPhone } from '../../../../lib/sonicpesa'
import { getPlanPriceTZS } from '../../../../lib/plans'
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin'

// Telcos (M-Pesa/Tigo Pesa/Airtel Money/Halopesa) reject USSD push amounts
// below this — SonicPesa forwards that rejection as a generic "bad amount"
// error *after* the user enters their PIN. Guard against it here instead.
const MIN_AMOUNT_TZS = 500

export async function POST(req) {
  try {
    const body = await req.json()
    const { plan, tournament_id, phone, name, email } = body || {}

    if (!plan && !tournament_id) {
      return NextResponse.json({ ok: false, error: 'plan or tournament_id is required' }, { status: 400 })
    }
    if (!phone) {
      return NextResponse.json({ ok: false, error: 'phone is required' }, { status: 400 })
    }

    let amount

    if (tournament_id) {
      // Look up the fee ourselves — never trust an amount from the client.
      const admin = getSupabaseAdmin()
      const { data: tourney, error: tErr } = await admin
        .from('tournaments')
        .select('entrance_fee, status')
        .eq('id', tournament_id)
        .single()

      if (tErr || !tourney) {
        return NextResponse.json({ ok: false, error: 'Tournament not found' }, { status: 404 })
      }
      amount = Number(tourney.entrance_fee || 0)
      if (!amount) {
        return NextResponse.json({ ok: false, error: 'This tournament has no entry fee' }, { status: 400 })
      }
    } else {
      amount = getPlanPriceTZS(plan)
      if (!amount) {
        return NextResponse.json({ ok: false, error: 'Invalid plan' }, { status: 400 })
      }
    }

    if (amount < MIN_AMOUNT_TZS) {
      return NextResponse.json({ ok: false, error: `Amount must be at least TZS ${MIN_AMOUNT_TZS}` }, { status: 400 })
    }

    const buyer_phone = normalizeTzPhone(phone)
    if (buyer_phone.length !== 12) {
      return NextResponse.json({ ok: false, error: 'Enter a valid Tanzanian phone number' }, { status: 400 })
    }

    const result = await createOrder({
      buyer_name:  name  || '',
      buyer_email: email || '',
      buyer_phone,
      amount,
      currency: 'TZS',
    })

    if (!result.ok || !result.order_id) {
      return NextResponse.json({ ok: false, error: result.error || 'SonicPesa did not return an order_id' }, { status: 502 })
    }

    return NextResponse.json({ ok: true, order_id: result.order_id, amount })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 })
  }
}
