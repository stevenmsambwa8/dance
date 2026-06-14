'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext()
export const useTheme = () => useContext(ThemeContext)

/* ── Theme definitions ── */
export const THEMES = {
  light: {
    label:  'Light',
    icon:   'ri-sun-line',
    color:  '#ffffff',       // nav bg color for meta theme-color
    swatch: '#f5f5f7',       // preview swatch
    dark:   false,
    seasonal: false,
  },
  dark: {
    label:  'Dark',
    icon:   'ri-moon-line',
    color:  '#18181a',
    swatch: '#18181a',
    dark:   true,
    seasonal: false,
  },
  snow: {
    label:  'Snow',
    icon:   'ri-snowy-line',
    color:  '#f0f8ff',       // light icy blue-white
    swatch: '#daeef9',
    dark:   false,           // LIGHT theme — uses logo-black
    seasonal: true,
    months: [12, 1],
  },
  neon: {
    label:  'Neon',
    icon:   'ri-flashlight-line',
    color:  '#060610',
    swatch: '#12122a',
    dark:   true,
    accent: '#bf00ff',
    seasonal: false,
  },
  sunset: {
    label:  'Sunset',
    icon:   'ri-sun-foggy-line',
    color:  '#130800',
    swatch: '#2a1200',
    dark:   true,
    accent: '#ff6b00',
    seasonal: false,
  },
  forest: {
    label:  'Forest',
    icon:   'ri-plant-line',
    color:  '#060e08',
    swatch: '#0f1e14',
    dark:   true,
    accent: '#00e676',
    seasonal: true,
    months: [3, 4, 5],
  },
  gold: {
    label:  'Gold',
    icon:   'ri-trophy-line',
    color:  '#080600',
    swatch: '#1a1500',
    dark:   true,
    accent: '#ffd700',
    seasonal: false,
  },
  ocean: {
    label:  'Ocean',
    icon:   'ri-water-flash-line',
    color:  '#010a14',
    swatch: '#081c2e',
    dark:   true,
    accent: '#00d4ff',
    seasonal: true,
    months: [6, 7, 8],
  },
}

/* Return the seasonal theme for today, or null */
function getSeasonalTheme() {
  const month = new Date().getMonth() + 1
  for (const [key, def] of Object.entries(THEMES)) {
    if (def.seasonal && def.months?.includes(month)) return key
  }
  return null
}

const BASE_THEMES = ['light', 'dark']

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', THEMES[t]?.color || '#ffffff')
}

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    const saved    = localStorage.getItem('theme')
    const seasonal = getSeasonalTheme()
    const manual   = localStorage.getItem('theme_manual') === '1'

    let active = saved || 'light'

    // Auto-apply seasonal only if user hasn't manually chosen a theme
    if (seasonal && !manual) {
      active = seasonal
      localStorage.setItem('theme', seasonal)
    }

    setTheme(active)
    applyTheme(active)
  }, [])

  const setThemeManual = useCallback((t) => {
    setTheme(t)
    localStorage.setItem('theme', t)
    localStorage.setItem('theme_manual', '1')
    applyTheme(t)
  }, [])

  // Legacy toggle — keeps existing nav button working (light ↔ dark)
  const toggle = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    setThemeManual(next)
  }, [theme, setThemeManual])

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme: setThemeManual, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}
