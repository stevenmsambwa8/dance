/**
 * UserBadges — renders the badge row for a user:
 *   [tick.png if admin]
 *   [shiny 💎 SVG if elite/team]
 *   [⚡ SVG if pro]
 *   [flag.png if set]
 *   [fire.png if season winner]
 *
 * Props:
 *   email          – string  – user's email (to detect admin)
 *   plan           – string  – user's plan key ('free' | 'pro' | 'elite' | 'team')
 *   planExpiresAt  – string  – ISO date string of plan expiry (or null)
 *   countryFlag    – string  – 'kenya' | 'tanzania' | 'uganda' | null
 *   isSeasonWinner – bool    – show fire badge
 *   size           – number  – icon size in px (default 14)
 *   gap            – number  – gap between badges in px (default 3)
 */

import { ADMIN_EMAILS } from './AuthProvider'
import { getActivePlan } from '../lib/plans'

/** Shiny animated diamond SVG for Elite / Team */
function DiamondBadge({ size }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      title="Elite"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="dg-face" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#e0f8ff" />
          <stop offset="30%"  stopColor="#7ee8fa" />
          <stop offset="60%"  stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id="dg-top" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#f0fbff" />
          <stop offset="100%" stopColor="#bae6fd" />
        </linearGradient>
        <linearGradient id="dg-left" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#075985" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id="dg-right" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#7dd3fc" />
        </linearGradient>
        <filter id="dg-glow">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* main diamond body */}
      <polygon
        points="8,1 14,5.5 8,15 2,5.5"
        fill="url(#dg-face)"
        filter="url(#dg-glow)"
      />

      {/* top facet (lighter) */}
      <polygon
        points="8,1 14,5.5 8,6.5 2,5.5"
        fill="url(#dg-top)"
        opacity="0.9"
      />

      {/* left lower facet (darker) */}
      <polygon
        points="2,5.5 8,6.5 8,15"
        fill="url(#dg-left)"
        opacity="0.75"
      />

      {/* right lower facet (mid) */}
      <polygon
        points="14,5.5 8,6.5 8,15"
        fill="url(#dg-right)"
        opacity="0.85"
      />

      {/* shine flare top-left */}
      <ellipse cx="5.5" cy="3.8" rx="1.2" ry="0.6"
        fill="white" opacity="0.65"
        transform="rotate(-30 5.5 3.8)"
      />

      {/* tiny shine dot */}
      <circle cx="10.5" cy="4.2" r="0.5" fill="white" opacity="0.5" />
    </svg>
  )
}

/** Lightning bolt SVG for Pro */
function ProBadge({ size }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      title="Pro"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="pro-g" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%"   stopColor="#e9d5ff" />
          <stop offset="40%"  stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <filter id="pro-glow">
          <feGaussianBlur stdDeviation="0.7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* lightning bolt path */}
      <path
        d="M9.5 1.5 L4 9 H7.5 L6.5 14.5 L12 7 H8.5 Z"
        fill="url(#pro-g)"
        filter="url(#pro-glow)"
      />
      {/* inner highlight */}
      <path
        d="M9.2 2.5 L6 8.2 H8.5 L7.8 12 L11 7.5 H8.8 Z"
        fill="white"
        opacity="0.2"
      />
    </svg>
  )
}

export default function UserBadges({
  email,
  plan,
  planExpiresAt,
  countryFlag,
  isSeasonWinner,
  size = 14,
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
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        verticalAlign: 'middle',
        marginLeft: gap,
        flexShrink: 0,
      }}
    >
      {/* Admin — original tick.png */}
      {isAdmin && (
        <img
          src="/tick.png"
          alt="Admin"
          title="Admin"
          style={{ width: size, height: size, display: 'block' }}
        />
      )}

      {/* Elite / Team — shiny diamond */}
      {isElite && <DiamondBadge size={size} />}

      {/* Pro — purple lightning bolt */}
      {isPro && <ProBadge size={size} />}

      {showFlag && (
        <img
          src={`/${countryFlag}.png`}
          alt={countryFlag}
          title={countryFlag.charAt(0).toUpperCase() + countryFlag.slice(1)}
          style={{ width: size, height: size, display: 'block', borderRadius: 2 }}
        />
      )}

      {showFire && (
        <img
          src="/fire.png"
          alt="Season Champion"
          title="Season Champion"
          style={{ width: size, height: size, display: 'block' }}
        />
      )}
    </span>
  )
}
