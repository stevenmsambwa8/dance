/**
 * UserBadges — badge row for a user.
 * Tooltip uses globals.css tokens (var(--bg), var(--surface), var(--border),
 * var(--text), var(--text-muted), var(--font)).
 * Exports: default UserBadges, DiamondBadge, ProBadge
 */
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ADMIN_EMAILS } from './AuthProvider'
import { getActivePlan } from '../lib/plans'

/* ── Inject once ─────────────────────────────────────────── */
const BADGE_CSS = `
@keyframes nb-diamond-shine {
  0%,100% { opacity:.5; transform:rotate(-30deg) translateX(-2px); }
  50%      { opacity:.9; transform:rotate(-30deg) translateX(2px);  }
}
@keyframes nb-bolt-pulse {
  0%,100% { filter:drop-shadow(0 0 1.5px #a855f7aa); }
  50%      { filter:drop-shadow(0 0 4px #c084fccc);   }
}
@keyframes nb-tip-in {
  from { opacity:0; transform:translateY(5px) scale(.96); }
  to   { opacity:1; transform:translateY(0)   scale(1);   }
}
.nb-tip {
  position: fixed;
  z-index: 9999;
  background: var(--surface);
  border: 1px solid var(--border-dark);
  border-radius: 14px;
  padding: 12px 13px 11px;
  width: min(200px, calc(100vw - 24px));
  box-shadow: 0 12px 40px rgba(0,0,0,0.4);
  animation: nb-tip-in .15s ease;
  box-sizing: border-box;
  font-family: var(--font);
}
.nb-tip-title {
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 5px;
  line-height: 1.3;
}
.nb-tip-desc {
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-muted);
  margin: 0 0 10px;
  line-height: 1.55;
  overflow-wrap: break-word;
  word-break: break-word;
  white-space: normal;
}
.nb-tip-ctas {
  display: flex;
  gap: 6px;
}
.nb-tip-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font);
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  border: none;
  display: block;
  letter-spacing: .01em;
}
.nb-tip-secondary {
  background: var(--bg);
  color: var(--text-dim);
  border: 1px solid var(--border-dark) !important;
}
`
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nb-bs')) return
  const s = document.createElement('style')
  s.id = 'nb-bs'
  s.textContent = BADGE_CSS
  document.head.appendChild(s)
}

/* ── Tooltip ─────────────────────────────────────────────── */
function Tooltip({ anchorEl, title, desc, color, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: -999, left: -999, opacity: 0 })

  useEffect(() => {
    if (!anchorEl || !ref.current) return
    const a  = anchorEl.getBoundingClientRect()
    const tw = ref.current.offsetWidth  || 200
    const th = ref.current.offsetHeight || 110
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = a.left + a.width / 2 - tw / 2
    let top  = a.bottom + 8
    if (left < 10)          left = 10
    if (left + tw > vw - 10) left = vw - tw - 10
    if (top + th > vh - 10)  top  = a.top - th - 8
    setPos({ top, left, opacity: 1 })
  }, [anchorEl])

  const dismiss = useCallback((e) => {
    if (ref.current && !ref.current.contains(e.target) &&
        anchorEl && !anchorEl.contains(e.target)) onClose()
  }, [anchorEl, onClose])

  useEffect(() => {
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('touchstart', dismiss)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('touchstart', dismiss)
    }
  }, [dismiss])

  return (
    <div ref={ref} className="nb-tip"
      style={{ top: pos.top, left: pos.left, opacity: pos.opacity }}
      onClick={e => e.stopPropagation()}>
      <p className="nb-tip-title" style={{ color }}>{title}</p>
      <p className="nb-tip-desc">{desc}</p>
      <div className="nb-tip-ctas">
        <a href="/upgrade" className="nb-tip-btn"
          style={{ background: color, color: '#000' }}
          onClick={onClose}>Upgrade</a>
        <a href="/help-desk" className="nb-tip-btn nb-tip-secondary"
          onClick={onClose}>Help</a>
      </div>
    </div>
  )
}

/* ── Badge wrapper ───────────────────────────────────────── */
function BadgeBtn({ children, tip }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  return (
    <>
      <span ref={ref}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ display:'inline-flex', alignItems:'center', cursor:'pointer',
                 WebkitTapHighlightColor:'transparent' }}>
        {children}
      </span>
      {open && (
        <Tooltip anchorEl={ref.current} {...tip} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/* ── Diamond SVG ─────────────────────────────────────────── */
export function DiamondBadge({ size = 16 }) {
  useEffect(injectStyles, [])
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      style={{ display:'block', flexShrink:0 }}>
      <defs>
        <linearGradient id="nb-df" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#e0f8ff"/>
          <stop offset="30%"  stopColor="#7ee8fa"/>
          <stop offset="60%"  stopColor="#38bdf8"/>
          <stop offset="100%" stopColor="#0284c7"/>
        </linearGradient>
        <linearGradient id="nb-dt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#f0fbff"/>
          <stop offset="100%" stopColor="#bae6fd"/>
        </linearGradient>
        <linearGradient id="nb-dl" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#075985"/>
          <stop offset="100%" stopColor="#0ea5e9"/>
        </linearGradient>
        <linearGradient id="nb-dr" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#38bdf8"/>
          <stop offset="100%" stopColor="#93c5fd"/>
        </linearGradient>
        <filter id="nb-dg" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation=".9" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <polygon points="8,1 14,5.5 8,15 2,5.5" fill="url(#nb-df)" filter="url(#nb-dg)"/>
      <polygon points="8,1 14,5.5 8,6.5 2,5.5" fill="url(#nb-dt)" opacity=".92"/>
      <polygon points="2,5.5 8,6.5 8,15"       fill="url(#nb-dl)" opacity=".72"/>
      <polygon points="14,5.5 8,6.5 8,15"      fill="url(#nb-dr)" opacity=".82"/>
      <ellipse cx="5.8" cy="3.6" rx="1.4" ry=".55" fill="white"
        style={{ animation:'nb-diamond-shine 2.4s ease-in-out infinite',
                 transformOrigin:'5.8px 3.6px' }}/>
      <circle cx="10.8" cy="4" r=".5" fill="white" opacity=".55"/>
    </svg>
  )
}

/* ── Bolt SVG ────────────────────────────────────────────── */
export function ProBadge({ size = 16 }) {
  useEffect(injectStyles, [])
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      style={{ display:'block', flexShrink:0,
               animation:'nb-bolt-pulse 2.2s ease-in-out infinite' }}>
      <defs>
        <linearGradient id="nb-pg" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%"   stopColor="#f3e8ff"/>
          <stop offset="45%"  stopColor="#c084fc"/>
          <stop offset="100%" stopColor="#7c3aed"/>
        </linearGradient>
      </defs>
      <path d="M9.5 1.5 L4 9 H7.5 L6.5 14.5 L12 7 H8.5 Z" fill="url(#nb-pg)"/>
      <path d="M9.2 2.8 L6.2 8.5 H8.6 L7.9 12 L10.8 7.6 H8.7 Z" fill="white" opacity=".18"/>
    </svg>
  )
}

/* ── Main export ─────────────────────────────────────────── */
export default function UserBadges({
  email, plan, planExpiresAt, countryFlag, isSeasonWinner, size = 16, gap = 3, hideAdmin = false
}) {
  useEffect(injectStyles, [])
  const isAdmin  = !hideAdmin && ADMIN_EMAILS.includes(email)
  const ap       = getActivePlan({ plan, plan_expires_at: planExpiresAt })
  const isElite  = ap === 'elite' || ap === 'team'
  const isPro    = ap === 'pro'
  const showFlag = !!countryFlag
  const showFire = !!isSeasonWinner
  if (!isAdmin && !isElite && !isPro && !showFlag && !showFire) return null

  const flagLabel = countryFlag
    ? countryFlag.charAt(0).toUpperCase() + countryFlag.slice(1) : ''

  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap,
                   verticalAlign:'middle', marginLeft:gap, flexShrink:0 }}>
      {isAdmin && (
        <BadgeBtn tip={{ title:'Admin', color:'#22c55e',
          desc:'This user is a Nabogaming platform administrator.' }}>
          <img src="/tick.png" alt="Admin"
            style={{ width:size, height:size, display:'block' }}/>
        </BadgeBtn>
      )}
      {isElite && (
        <BadgeBtn tip={{ title:'Elite', color:'#38bdf8',
          desc: ap === 'team'
            ? 'Team plan member. Includes Elite perks and full team features.'
            : 'Elite subscriber. Can create tournaments, sell in the shop, and more.' }}>
          <DiamondBadge size={size}/>
        </BadgeBtn>
      )}
      {isPro && (
        <BadgeBtn tip={{ title:'Pro', color:'#a855f7',
          desc:'Pro subscriber. Unlimited tournament entries, DMs, and Pro-only events.' }}>
          <ProBadge size={size}/>
        </BadgeBtn>
      )}
      {showFlag && (
        <BadgeBtn tip={{ title: flagLabel, color:'#f59e0b',
          desc:`This player is based in ${flagLabel}.` }}>
          <img src={`/${countryFlag}.png`} alt={countryFlag}
            style={{ width:size, height:size, display:'block', borderRadius:2 }}/>
        </BadgeBtn>
      )}
      {showFire && (
        <BadgeBtn tip={{ title:'Season Champion', color:'#f97316',
          desc:'This player has won a past season championship.' }}>
          <img src="/fire.png" alt="Season Champion"
            style={{ width:size, height:size, display:'block' }}/>
        </BadgeBtn>
      )}
    </span>
  )
}
