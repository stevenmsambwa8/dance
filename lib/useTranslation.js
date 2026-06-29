// lib/useTranslation.js
// Hook version — reacts to the language toggle in the sidebar.
// Usage inside any 'use client' component:
//
//   import useTranslation from '@/lib/useTranslation'
//   const { t } = useTranslation()
//   <button>{t('common.save')}</button>

import { useLanguage } from '../components/LanguageProvider'
import sw from './translations/sw'
import en from './translations/en'

const DICTS = { sw, en }

export default function useTranslation() {
  const { lang } = useLanguage()
  const dict = DICTS[lang] || sw

  function t(key) {
    const result = key.split('.').reduce((obj, part) => obj?.[part], dict)
    return result ?? key
  }

  return { t, lang }
}
