'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const LanguageContext = createContext()
export const useLanguage = () => useContext(LanguageContext)

export const LANGUAGES = {
  sw: { label: 'Kiswahili', short: 'SW', flag: '🇹🇿' },
  en: { label: 'English', short: 'EN', flag: '🇬🇧' },
}

export default function LanguageProvider({ children }) {
  const [lang, setLang] = useState('sw')

  useEffect(() => {
    const saved = localStorage.getItem('lang') || 'sw'
    setLang(saved)
  }, [])

  const setLangManual = useCallback((newLang) => {
    setLang(newLang)
    localStorage.setItem('lang', newLang)
  }, [])

  const toggle = useCallback(() => {
    setLangManual(lang === 'sw' ? 'en' : 'sw')
  }, [lang, setLangManual])

  return (
    <LanguageContext.Provider
      value={{
        lang,
        toggle,
        setLang: setLangManual,
        languages: LANGUAGES,
      }}
    >
      {children}
    </LanguageContext.Provider>
  )
}
