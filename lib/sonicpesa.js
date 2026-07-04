/**
 * lib/sonicpesa.js
 * Server-only helper for the SonicPesa payment API.
 *
 * NEVER import this from a 'use client' component — it reads a secret
 * env var that must not reach the browser bundle.
 *
 * Confirmed from official docs (api.sonicpesa.com/docs):
 *   Base URL : https://api.sonicpesa.com/api/v1
 *   Auth     : X-API-KEY header only
 *   POST /payment/create_order   { buyer_email, buyer_name, buyer_phone, amount, currency }
 *              -> { status, message, data: { order_id, payment_status, ... } }
 *   POST /payment/order_status   { order_id }
 *              -> { status, message, data: { order_id, payment_status, ... } }
 *
 * payment_status values: SUCCESS | PENDING | CANCELLED | USERCANCELLED | REJECTED | INPROGRESS
 *
 * Docs only show TZS in every example, so this integration is TZS-only for now.
 */

const BASE_URL = process.env.SONICPESA_BASE_URL || 'https://api.sonicpesa.com/api/v1'

function getHeaders() {
  const apiKey    = process.env.SONICPESA_API_KEY
  const secretKey = process.env.SONICPESA_SECRET_KEY

  if (!apiKey) {
    throw new Error('SonicPesa is not configured: set SONICPESA_API_KEY')
  }

  const headers = {
    'X-API-KEY':    apiKey,
    'Accept':       'application/json',
    'Content-Type': 'application/json',
  }
  // The SonicPesa dashboard issues both an Access Key and a Secret Key —
  // send both if the secret is configured (docs only mentioned X-API-KEY,
  // but the dashboard's key pair suggests the secret may also be required).
  if (secretKey) headers['X-SECRET-KEY'] = secretKey

  return headers
}

/**
 * Normalizes a Tanzanian phone number to 255XXXXXXXXX (no +, no leading 0).
 */
export function normalizeTzPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('255')) return digits
  if (digits.startsWith('0'))   return '255' + digits.slice(1)
  if (digits.length === 9)      return '255' + digits
  return digits
}

async function callSonicPesa(path, body) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)

    if (!res.ok || json?.status === 'error') {
      return { ok: false, error: json?.message || `SonicPesa error (${res.status})`, raw: json }
    }
    return { ok: true, order_id: json?.data?.order_id, payment_status: json?.data?.payment_status, raw: json }
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to reach SonicPesa' }
  }
}

/** Creates a SonicPesa order. Triggers the USSD push to buyer_phone. */
export function createOrder({ buyer_name, buyer_email, buyer_phone, amount, currency = 'TZS' }) {
  return callSonicPesa('/payment/create_order', {
    buyer_name:  buyer_name  || '',
    buyer_email: buyer_email || '',
    buyer_phone,
    amount,
    currency,
  })
}

/** Checks the status of a SonicPesa order. */
export function getOrderStatus(order_id) {
  return callSonicPesa('/payment/order_status', { order_id })
}

/**
 * Maps SonicPesa's payment_status to one of: 'pending' | 'success' | 'failed'
 */
export function interpretStatus(payment_status) {
  const raw = String(payment_status || '').toUpperCase()
  if (raw === 'SUCCESS') return 'success'
  if (['CANCELLED', 'USERCANCELLED', 'REJECTED'].includes(raw)) return 'failed'
  return 'pending' // PENDING, INPROGRESS, or unknown
}
