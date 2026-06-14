'use client'
import { useState, useRef, useEffect } from 'react'
import { useTheme, THEMES } from './ThemeProvider'

const SEASONAL_LABELS = {
  snow:   'Dec–Jan',
  forest: 'Mar–May',
  ocean:  'Jun–Aug',
}

export default function ThemePicker({ align = 'right' }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen]     = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler) }
  }, [open])

  const current  = THEMES[theme] || THEMES.light
  const month    = new Date().getMonth() + 1
  const base     = Object.entries(THEMES).filter(([, d]) => !d.seasonal)
  const seasonal = Object.entries(THEMES).filter(([, d]) =>  d.seasonal)

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>

      {/* Trigger */}
      <button onClick={() => setOpen(o => !o)} title="Change theme" style={{
        width: 36, height: 36, borderRadius: '50%',
        border: '1.5px solid var(--border-dark)',
        background: 'var(--bg-2)', color: 'var(--text)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, cursor: 'pointer', position: 'relative',
      }}>
        <i className={current.icon} />
        {current.seasonal && (
          <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg)' }} />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'absolute',
          [align === 'right' ? 'right' : 'left']: 0,
          top: 'calc(100% + 10px)',
          background: 'var(--bg)',
          border: '1px solid var(--border-dark)',
          borderRadius: 16,
          padding: '16px',
          width: 220,
          zIndex: 9990,
          boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
          animation: 'tpIn 0.15s cubic-bezier(0.22,1,0.36,1)',
        }}>
          <style>{`@keyframes tpIn { from{opacity:0;transform:translateY(-6px) scale(0.96)} to{opacity:1;transform:none} }`}</style>

          <Row themes={base} active={theme} month={month} onPick={(k) => { setTheme(k); setOpen(false) }} />

          <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />

          <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>Seasonal</p>

          <Row themes={seasonal} active={theme} month={month} onPick={(k) => { setTheme(k); setOpen(false) }} seasonal />
        </div>
      )}
    </div>
  )
}

function Row({ themes, active, month, onPick, seasonal }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {themes.map(([key, def]) => {
        const isActive = active === key
        const isLive   = seasonal && def.months?.includes(month)
        return (
          <Dot key={key} themeKey={key} def={def} active={isActive} isLive={isLive} onPick={() => onPick(key)} />
        )
      })}
    </div>
  )
}

function Dot({ themeKey, def, active, isLive, onPick }) {
  const [hovered, setHovered] = useState(false)
  const accentColor = def.accent || (def.dark ? '#ffffff' : '#000000')

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <button
        onClick={onPick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={def.label}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: def.swatch,
          border: active
            ? `2.5px solid ${accentColor}`
            : hovered
              ? '2px solid var(--border-dark)'
              : '2px solid transparent',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.12s, border 0.12s',
          transform: hovered && !active ? 'scale(1.1)' : active ? 'scale(1.05)' : 'scale(1)',
          position: 'relative',
          boxShadow: active ? `0 0 0 1px var(--bg), 0 0 0 3px ${accentColor}40` : 'none',
        }}
      >
        <i className={def.icon} style={{ fontSize: 14, color: def.dark ? '#fff' : '#111', opacity: active ? 1 : 0.8 }} />
        {isLive && (
          <span style={{ position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: accentColor, border: '2px solid var(--bg)' }} />
        )}
      </button>
      {/* Label only shows on active or hover */}
      <span style={{
        fontSize: 9, fontWeight: 700, color: active ? 'var(--text)' : 'var(--text-muted)',
        fontFamily: 'var(--font)', letterSpacing: '0.02em',
        opacity: active || hovered ? 1 : 0,
        transition: 'opacity 0.12s',
        whiteSpace: 'nowrap',
      }}>
        {def.label}
      </span>
    </div>
  )
}
