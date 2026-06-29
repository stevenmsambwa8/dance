/**
 * UserBadges — badge row for a user:
 *   [tick.png if admin] [💎 SVG if elite/team] [⚡ SVG if pro]
 *   [flag.png if set] [fire.png if season winner]
 */

'use client'

import { ADMIN_EMAILS } from './AuthProvider'
import { getActivePlan } from '../lib/plans'

/** Shared shimmer keyframes — injected once */
const SHIMMER_CSS = `
@keyframes nb-diamond-shine {
  0%   { opacity: 0.55; transform: rotate(-30deg) translateX(-3px); }
  50%  { opacity: 0.9;  transform: rotate(-30deg) translateX(2px); }
  100% { opacity: 0.55; transform: rotate(-30deg) translateX(-3px); }
}
@keyframes nb-bolt-pulse {
  0%,100% { filter: drop-shadow(0 0 1.5px #a855f7aa); }
  50%      { filter: drop-shadow(0 0 4px #c084fccc); }
}
`

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('nb-badge-styles')) return
  const el = document.createElement('style')
  el.id = 'nb-badge-styles'
  el.textContent = SHIMMER_CSS
  document.head.appendChild(el)
}

/** Shiny animated diamond for Elite / Team */
export function DiamondBadge({ size = 16 }) {
  if (typeof window !== 'undefined') injectStyles()
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Elite"
      style={{ display: 'block', flexShrink: 0 }}
    >
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

      {/* body */}
      <polygon points="8,1 14,5.5 8,15 2,5.5" fill="url(#nb-dg-face)" filter="url(#nb-dg-glow)" />
      {/* top facet */}
      <polygon points="8,1 14,5.5 8,6.5 2,5.5" fill="url(#nb-dg-top)" opacity="0.92" />
      {/* left facet */}
      <polygon points="2,5.5 8,6.5 8,15" fill="url(#nb-dg-left)" opacity="0.72" />
      {/* right facet */}
      <polygon points="14,5.5 8,6.5 8,15" fill="url(#nb-dg-right)" opacity="0.82" />

      {/* animated shine flare */}
      <ellipse
        cx="5.8" cy="3.6" rx="1.4" ry="0.55"
        fill="white"
        style={{ animation: 'nb-diamond-shine 2.4s ease-in-out infinite', transformOrigin: '5.8px 3.6px' }}
      />
      {/* static small dot */}
      <circle cx="10.8" cy="4.0" r="0.5" fill="white" opacity="0.55" />
    </svg>
  )
}

/** Animated purple lightning bolt for Pro */
export function ProBadge({ size = 16 }) {
  if (typeof window !== 'undefined') injectStyles()
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Pro"
      style={{ display: 'block', flexShrink: 0, animation: 'nb-bolt-pulse 2.2s ease-in-out infinite' }}
    >
      <defs>
        <linearGradient id="nb-pro-g" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%"   stopColor="#f3e8ff" />
          <stop offset="45%"  stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      {/* bolt */}
      <path d="M9.5 1.5 L4 9 H7.5 L6.5 14.5 L12 7 H8.5 Z" fill="url(#nb-pro-g)" />
      {/* inner highlight */}
      <path d="M9.2 2.8 L6.2 8.5 H8.6 L7.9 12 L10.8 7.6 H8.7 Z" fill="white" opacity="0.18" />
    </svg>
  )
}

export default function UserBadges({
  email,
  plan,
  planExpiresAt,
  countryFlag,
  isSeasonWinner,
  size = 16,
  gap = 3,
}) {
  const isAdmin    = ADMIN_EMAILS.includes(email)
  const activePlan = getActivePlan({ plan, plan_expires_at: planExpiresAt })
  const isElite    = activePlan === 'elite' || activePlan === 'team'
  const isPro      = activePlan === 'pro'

  const showFlag = !!countryFlag
  const showFire = !!isSeasonWinner

  if (!isAdmin && !isElite && !isPro && !showFlag && !showFire) return null

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, verticalAlign: 'middle', marginLeft: gap, flexShrink: 0 }}>
      {isAdmin && (
        <img src="/tick.png" alt="Admin" title="Admin"
          style={{ width: size, height: size, display: 'block' }} />
      )}
      {isElite && <DiamondBadge size={size} />}
      {isPro    && <ProBadge size={size} />}
      {showFlag && (
        <img src={`/${countryFlag}.png`} alt={countryFlag}
          title={countryFlag.charAt(0).toUpperCase() + countryFlag.slice(1)}
          style={{ width: size, height: size, display: 'block', borderRadius: 2 }} />
      )}
      {showFire && (
        <img src="/fire.png" alt="Season Champion" title="Season Champion"
          style={{ width: size, height: size, display: 'block' }} />
      )}
    </span>
  )
}
