'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext()
export const useTheme = () => useContext(ThemeContext)

export const THEMES = {
light: {
label: 'Light',
icon: 'ri-sun-line',
color: '#ffffff',
swatch: '#f5f5f7',
dark: false,
},
dark: {
label: 'Dark',
icon: 'ri-moon-line',
color: '#18181a',
swatch: '#18181a',
dark: true,
},
snow: {
label: 'Snow',
icon: 'ri-snowy-line',
color: '#f0f8ff',
swatch: '#daeef9',
dark: false,
},
neon: {
label: 'Neon',
icon: 'ri-flashlight-line',
color: '#060610',
swatch: '#12122a',
dark: true,
accent: '#bf00ff',
},
sunset: {
label: 'Sunset',
icon: 'ri-sun-foggy-line',
color: '#130800',
swatch: '#2a1200',
dark: true,
accent: '#ff6b00',
},
forest: {
label: 'Forest',
icon: 'ri-plant-line',
color: '#060e08',
swatch: '#0f1e14',
dark: true,
accent: '#00e676',
},
gold: {
label: 'Gold',
icon: 'ri-trophy-line',
color: '#080600',
swatch: '#1a1500',
dark: true,
accent: '#ffd700',
},
ocean: {
label: 'Ocean',
icon: 'ri-water-flash-line',
color: '#010a14',
swatch: '#081c2e',
dark: true,
accent: '#00d4ff',
},
}

function applyTheme(theme) {
document.documentElement.setAttribute('data-theme', theme)

let meta = document.querySelector('meta[name="theme-color"]')

if (!meta) {
meta = document.createElement('meta')
meta.setAttribute('name', 'theme-color')
document.head.appendChild(meta)
}

meta.setAttribute('content', THEMES[theme]?.color || '#ffffff')
}

export default function ThemeProvider({ children }) {
const [theme, setTheme] = useState('light')

useEffect(() => {
const savedTheme = localStorage.getItem('theme') || 'light'

setTheme(savedTheme)
applyTheme(savedTheme)

}, [])

const setThemeManual = useCallback((newTheme) => {
setTheme(newTheme)
localStorage.setItem('theme', newTheme)
applyTheme(newTheme)
}, [])

const toggle = useCallback(() => {
const nextTheme = theme === 'light' ? 'dark' : 'light'
setThemeManual(nextTheme)
}, [theme, setThemeManual])

return (
<ThemeContext.Provider
value={{
theme,
toggle,
setTheme: setThemeManual,
themes: THEMES,
}}
>
{children}
</ThemeContext.Provider>
)
}