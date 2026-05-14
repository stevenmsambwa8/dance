/**
 * currency.js
 * East Africa currency system for Nabogaming.
 * Base currency: TZS (Tanzania Shilling) — all prices stored in DB as TZS.
 * Supported: TZS, KES, UGX
 *
 * Exchange rates are fetched live from open.er-api.com (free, no key needed).
 * Falls back to hardcoded rates if fetch fails.
 */

export const CURRENCIES = {
  TZS: { code: 'TZS', label: 'Tanzanian Shilling', symbol: 'TZS', flag: 'tanzania', locale: 'en-TZ' },
  KES: { code: 'KES', label: 'Kenyan Shilling',    symbol: 'KES', flag: 'kenya',    locale: 'en-KE' },
  UGX: { code: 'UGX', label: 'Ugandan Shilling',   symbol: 'UGX', flag: 'uganda',   locale: 'en-UG' },
}

// Fallback rates (TZS → other) — updated periodically
const FALLBACK_RATES = {
  TZS: 1,
  KES: 0.041,   // ~1 TZS = 0.041 KES
  UGX: 1.54,    // ~1 TZS = 1.54 UGX
}

// Module-level cache so rates are fetched at most once per session
let _ratesCache = null
let _fetchPromise = null

/**
 * Returns live rates from TZS → { TZS, KES, UGX }.
 * Caches in memory for the session. Falls back to FALLBACK_RATES on error.
 */
export async function getLiveRates() {
  if (_ratesCache) return _ratesCache
  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async () => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/TZS', { cache: 'no-store' })
      if (!res.ok) throw new Error('rate fetch failed')
      const json = await res.json()
      const rates = {
        TZS: 1,
        KES: json.rates?.KES ?? FALLBACK_RATES.KES,
        UGX: json.rates?.UGX ?? FALLBACK_RATES.UGX,
      }
      _ratesCache = rates
      return rates
    } catch {
      _ratesCache = { ...FALLBACK_RATES }
      return _ratesCache
    }
  })()

  return _fetchPromise
}

/**
 * Convert an amount from TZS to the target currency.
 * @param {number} tzs      — amount in TZS
 * @param {string} toCurrency — 'TZS' | 'KES' | 'UGX'
 * @param {object} rates    — rates object from getLiveRates()
 */
export function convertFromTZS(tzs, toCurrency, rates) {
  if (!tzs || isNaN(Number(tzs))) return 0
  const rate = rates?.[toCurrency] ?? FALLBACK_RATES[toCurrency] ?? 1
  return Math.round(Number(tzs) * rate)
}

/**
 * Format a TZS amount in the user's chosen currency.
 * @param {number} tzs
 * @param {string} currency — 'TZS' | 'KES' | 'UGX'
 * @param {object} rates
 */
export function fmtCurrency(tzs, currency, rates) {
  const amount = convertFromTZS(tzs, currency, rates)
  const meta = CURRENCIES[currency] || CURRENCIES.TZS
  return `${meta.symbol} ${amount.toLocaleString(meta.locale)}`
}

/**
 * Detect currency from user's country_flag.
 * tanzania → TZS, kenya → KES, uganda → UGX, default TZS
 */
export function currencyFromFlag(flag) {
  if (flag === 'kenya')    return 'KES'
  if (flag === 'uganda')   return 'UGX'
  return 'TZS'
}

/**
 * React hook: returns { currency, rates, fmtAmt }
 * currency is derived from the user's country_flag.
 * fmtAmt(tzs) formats a TZS amount in the user's currency.
 */
import { useState, useEffect } from 'react'

export function useCurrency(countryFlag) {
  const currency = currencyFromFlag(countryFlag)
  const [rates, setRates] = useState(FALLBACK_RATES)

  useEffect(() => {
    getLiveRates().then(setRates)
  }, [])

  function fmtAmt(tzs) {
    return fmtCurrency(tzs, currency, rates)
  }

  function fmtAmtRaw(tzs) {
    return convertFromTZS(tzs, currency, rates)
  }

  return { currency, rates, fmtAmt, fmtAmtRaw, currencyMeta: CURRENCIES[currency] }
}
