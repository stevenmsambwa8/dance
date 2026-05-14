'use client'
import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()
export const useTheme = () => useContext(ThemeContext)

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light')

  // Match these to your actual background colors in globals.css
  const THEME_COLORS = {
    light: '#ffffff',
    dark:  '#18181a',
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t)
    // Update meta theme-color — controls Chrome tab bar + WebView status bar
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', THEME_COLORS[t])
  }

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'light'
    setTheme(saved)
    applyTheme(saved)
  }, [])

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    applyTheme(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
