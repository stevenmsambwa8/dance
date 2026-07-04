import { NextResponse } from 'next/server'
import { createOrder, normalizeTzPhone } from '../../../../lib/sonicpesa'
import { getPlanPriceTZS } from '../../../../lib/plans'

export async function POST(req) {
  try {
    const body = await req.json()
    const { plan, phone, name, email } = body || {}

    if (!plan || !phone) {
      return NextResponse.json({ ok: false, error: 'plan and phone are required' }, { status: 400 })
    }

    const amount = getPlanPriceTZS(plan)
    if (!amount) {
      return NextResponse.json({ ok: false, error: 'Invalid plan' }, { status: 400 })
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

    return NextResponse.json({ ok: true, order_id: result.order_id })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 })
  }
}
