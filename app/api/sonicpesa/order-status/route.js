import { NextResponse } from 'next/server'
import { getOrderStatus, interpretStatus } from '../../../../lib/sonicpesa'

export async function POST(req) {
  try {
    const { order_id } = await req.json()
    if (!order_id) {
      return NextResponse.json({ ok: false, error: 'order_id is required' }, { status: 400 })
    }

    const result = await getOrderStatus(order_id)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      status: interpretStatus(result.payment_status),
      raw_status: result.payment_status,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || 'Server error' }, { status: 500 })
  }
}
