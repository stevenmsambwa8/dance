'use client'
import { useState, useEffect } from 'react'
import {
  CURRENCIES,
  FALLBACK_RATES,
  getLiveRates,
  fmtCurrency,
  convertFromTZS,
  currencyFromFlag,
} from './currency'

/**
 * useCurrency(countryFlag)
 * React hook — client-side only.
 * Returns { currency, rates, fmtAmt, fmtAmtRaw, currencyMeta }
 */
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
