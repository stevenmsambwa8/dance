/**
 * UserBadges — badge row for a user.
 * Each badge is clickable → shows a tooltip with description + CTA links.
 *
 * Exports: default UserBadges, DiamondBadge, ProBadge (used by Nav, PlanBadge)
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { ADMIN_EMAILS } from './AuthProvider'
import { getActivePlan } from '../lib/plans'

/* ── Shared styles injected once ─────────────────────────── */
const BADGE_CSS = `
@keyframes nb-diamond-shine {
  0%,100% { opacity: 0.55; transform: rotate(-30deg) translateX(-2px); }
  50%      { opacity: 0.92; transform: rotate(-30deg) translateX(2px);  }
}
@keyframes nb-bolt-pulse {
  0%,100% { filter: drop-shadow(0 0 1.5px #a855f7aa); }
  50%      { filter: drop-shadow(0 0 4px #c084fccc);   }
}
@keyframes nb-tooltip-in {
  from { opacity:0; transform:translateY(4px) scale(0.97); }
  to   { opacity:1; transform:translateY(0)   scale(1);    }
}
.nb-tooltip {
  position: fixed;
  z-index: 9999;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 14px;
  padding: 14px 16px 12px;
  width: 220px;
  box-shadow: 0 8px 32px #000a;
  animation: nb-tooltip-in 0.18s ease;
}
.nb-tooltip-title {
  font-size: 13px;
  font-weight: 800;
  color: #fff;
  margin: 0 0 4px;
}
.nb-tooltip-desc {
  font-size: 11.5px;
  color: #a1a1aa;
  margin: 0 0 12px;
  line-height: 1.5;
}
.nb-tooltip-ctas {
  display: flex;
  gap: 7px;
}
.nb-tooltip-cta {
  flex: 1;
  padding: 6px 0;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  border: none;
  display: block;
}
.nb-tooltip-cta-primary {
  background: #38bdf8;
  color: #000;
}
.nb-tooltip-cta-secondary {
  background: #27272a;
  color: #d4d4d8;
  border: 1px solid #3f3f46;
}
`

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('nb-badge-styles')) return
  const el = document.createElement('style')
  el.id = 'nb-badge-styles'
  el.textContent = BADGE_CSS
  document.head.appendChild(el)
}

/* ── Tooltip component ───────────────────────────────────── */
function BadgeTooltip({ anchorRef, title, desc, accentColor, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!anchorRef?.current || !ref.current) return
    const a = anchorRef.current.getBoundingClientRect()
    const t = ref.current
    const tw = t.offsetWidth || 220
    const th = t.offsetHeight || 130
    let left = a.left + a.width / 2 - tw / 2
    let top  = a.bottom + 8
    // keep on screen
    if (left < 8) left = 8
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8
    if (top + th > window.innerHeight - 8) top = a.top - th - 8
    setPos({ top, left })
  }, [anchorRef])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) &&
          anchorRef.current && !anchorRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [onClose, anchorRef])

  return (
    <div
      ref={ref}
      className="nb-tooltip"
      style={{ top: pos.top, left: pos.left }}
      onClick={e => e.stopPropagation()}
    >
      <p className="nb-tooltip-title" style={{ color: accentColor }}>{title}</p>
      <p className="nb-tooltip-desc">{desc}</p>
      <div className="nb-tooltip-ctas">
        <a href="/upgrade" className="nb-tooltip-cta nb-tooltip-cta-primary"
          style={{ background: accentColor, color: accentColor === '#fff' ? '#000' : '#000' }}
          onClick={onClose}>
          Upgrade
        </a>
        <a href="/help-desk" className="nb-tooltip-cta nb-tooltip-cta-secondary"
          onClick={onClose}>
          Help
        </a>
      </div>
    </div>
  )
}

/* ── Wrapper that handles click + tooltip ────────────────── */
function BadgeButton({ children, tooltipProps, size }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  return (
    <>
      <span
        ref={ref}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                 borderRadius: 4, WebkitTapHighlightColor: 'transparent' }}
      >
        {children}
      </span>
      {open && (
        <BadgeTooltip
          anchorRef={ref}
          {...tooltipProps}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/* ── Diamond SVG (Elite / Team) ─────────────────────────── */
export function DiamondBadge({ size = 16 }) {
  useEffect(() => { injectStyles() }, [])
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="Elite"
      style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id="nb-dg-face" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#e0f8ff" />
          <stop offset="30%"  stopColor="#7ee8fa" />
          <stop offset="60%"  stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
        <linearGradient id="nb-dg-top" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#f0fbff" />
          <stop offset="100%" stopColor="#bae6fd" />
        </linearGradient>
        <linearGradient id="nb-dg-left" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#075985" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id="nb-dg-right" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#93c5fd" />
        </linearGradient>
        <filter id="nb-dg-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.9" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <polygon points="8,1 14,5.5 8,15 2,5.5" fill="url(#nb-dg-face)" filter="url(#nb-dg-glow)" />
      <polygon points="8,1 14,5.5 8,6.5 2,5.5" fill="url(#nb-dg-top)" opacity="0.92" />
      <polygon points="2,5.5 8,6.5 8,15"        fill="url(#nb-dg-left)"  opacity="0.72" />
      <polygon points="14,5.5 8,6.5 8,15"       fill="url(#nb-dg-right)" opacity="0.82" />
      <ellipse cx="5.8" cy="3.6" rx="1.4" ry="0.55" fill="white"
        style={{ animation: 'nb-diamond-shine 2.4s ease-in-out infinite',
                 transformOrigin: '5.8px 3.6px' }} />
      <circle cx="10.8" cy="4.0" r="0.5" fill="white" opacity="0.55" />
    </svg>
  )
}

/* ── Bolt SVG (Pro) ─────────────────────────────────────── */
export function ProBadge({ size = 16 }) {
  useEffect(() => { injectStyles() }, [])
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-label="Pro"
      style={{ display: 'block', flexShrink: 0,
               animation: 'nb-bolt-pulse 2.2s ease-in-out infinite' }}>
      <defs>
        <linearGradient id="nb-pro-g" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%"   stopColor="#f3e8ff" />
          <stop offset="45%"  stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <path d="M9.5 1.5 L4 9 H7.5 L6.5 14.5 L12 7 H8.5 Z" fill="url(#nb-pro-g)" />
      <path d="M9.2 2.8 L6.2 8.5 H8.6 L7.9 12 L10.8 7.6 H8.7 Z" fill="white" opacity="0.18" />
    </svg>
  )
}

/* ── Main UserBadges ─────────────────────────────────────── */
export default function UserBadges({
  email,
  plan,
  planExpiresAt,
  countryFlag,
  isSeasonWinner,
  size = 16,
  gap = 3,
}) {
  useEffect(() => { injectStyles() }, [])

  const isAdmin    = ADMIN_EMAILS.includes(email)
  const activePlan = getActivePlan({ plan, plan_expires_at: planExpiresAt })
  const isElite    = activePlan === 'elite' || activePlan === 'team'
  const isPro      = activePlan === 'pro'
  const showFlag   = !!countryFlag
  const showFire   = !!isSeasonWinner

  if (!isAdmin && !isElite && !isPro && !showFlag && !showFire) return null

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap,
                   verticalAlign: 'middle', marginLeft: gap, flexShrink: 0 }}>

      {/* Admin tick */}
      {isAdmin && (
        <BadgeButton tooltipProps={{
          title: '✅ Admin',
          desc: 'This user is a Nabogaming platform administrator.',
          accentColor: '#22c55e',
        }}>
          <img src="/tick.png" alt="Admin"
            style={{ width: size, height: size, display: 'block' }} />
        </BadgeButton>
      )}

      {/* Elite / Team — shiny diamond */}
      {isElite && (
        <BadgeButton tooltipProps={{
          title: '💎 Elite',
          desc: activePlan === 'team'
            ? 'Team plan member. Includes Elite perks + team features.'
            : 'Elite subscriber. Can create tournaments, sell in shop, and more.',
          accentColor: '#38bdf8',
        }}>
          <DiamondBadge size={size} />
        </BadgeButton>
      )}

      {/* Pro — bolt */}
      {isPro && (
        <BadgeButton tooltipProps={{
          title: '⚡ Pro',
          desc: 'Pro subscriber. Unlimited tournaments, DMs, and Pro-only events.',
          accentColor: '#a855f7',
        }}>
          <ProBadge size={size} />
        </BadgeButton>
      )}

      {/* Country flag */}
      {showFlag && (
        <BadgeButton tooltipProps={{
          title: countryFlag.charAt(0).toUpperCase() + countryFlag.slice(1),
          desc: `This player is based in ${countryFlag.charAt(0).toUpperCase() + countryFlag.slice(1)}.`,
          accentColor: '#f59e0b',
        }}>
          <img src={`/${countryFlag}.png`} alt={countryFlag}
            style={{ width: size, height: size, display: 'block', borderRadius: 2 }} />
        </BadgeButton>
      )}

      {/* Season fire */}
      {showFire && (
        <BadgeButton tooltipProps={{
          title: '🔥 Season Champion',
          desc: 'This player has won a previous season championship.',
          accentColor: '#f97316',
        }}>
          <img src="/fire.png" alt="Season Champion"
            style={{ width: size, height: size, display: 'block' }} />
        </BadgeButton>
      )}
    </span>
  )
}
