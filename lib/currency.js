/**
 * currency.js
 * East Africa currency utilities for Nabogaming.
 * Base currency: TZS — all prices stored in DB as TZS.
 * Supported display currencies: TZS, KES, UGX
 *
 * Pure utility functions only — no React imports here.
 * For the React hook, import useCurrency from lib/useCurrency.js
 */

export const CURRENCIES = {
  TZS: { code: 'TZS', label: 'Tanzanian Shilling', symbol: 'TZS', flag: 'tanzania', locale: 'en-TZ' },
  KES: { code: 'KES', label: 'Kenyan Shilling',    symbol: 'KES', flag: 'kenya',    locale: 'en-KE' },
  UGX: { code: 'UGX', label: 'Ugandan Shilling',   symbol: 'UGX', flag: 'uganda',   locale: 'en-UG' },
}

// Fallback rates (TZS → other)
export const FALLBACK_RATES = {
  TZS: 1,
  KES: 0.041,
  UGX: 1.54,
}

// Session-level cache — module singleton
let _ratesCache = null
let _fetchPromise = null

export async function getLiveRates() {
  if (_ratesCache) return _ratesCache
  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async () => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/TZS')
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      _ratesCache = {
        TZS: 1,
        KES: json.rates?.KES ?? FALLBACK_RATES.KES,
        UGX: json.rates?.UGX ?? FALLBACK_RATES.UGX,
      }
      return _ratesCache
    } catch {
      _ratesCache = { ...FALLBACK_RATES }
      return _ratesCache
    }
  })()

  return _fetchPromise
}

export function convertFromTZS(tzs, toCurrency, rates) {
  if (!tzs || isNaN(Number(tzs))) return 0
  const rate = (rates ?? FALLBACK_RATES)[toCurrency] ?? 1
  return Math.round(Number(tzs) * rate)
}

export function fmtCurrency(tzs, currency, rates) {
  const amount = convertFromTZS(tzs, currency, rates)
  const meta = CURRENCIES[currency] || CURRENCIES.TZS
  return `${meta.symbol} ${amount.toLocaleString(meta.locale)}`
}

export function currencyFromFlag(flag) {
  if (flag === 'kenya')  return 'KES'
  if (flag === 'uganda') return 'UGX'
  return 'TZS'
}
