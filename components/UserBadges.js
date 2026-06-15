/**
 * UserBadges — renders the badge row for a user:
 *   [tick.png if admin OR elite/team subscriber] [flag.png if set] [fire.png if season winner]
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
  const hasVerified = activePlan === 'elite' || activePlan === 'team'

  const showTick = isAdmin || hasVerified
  const showFlag = !!countryFlag
  const showFire = !!isSeasonWinner

  if (!showTick && !showFlag && !showFire) return null

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: gap,
        verticalAlign: 'middle',
        marginLeft: gap,
        flexShrink: 0,
      }}
    >
      {showTick && (
        <img
          src="/tick.png"
          alt={isAdmin ? 'Admin' : 'Verified'}
          title={isAdmin ? 'Admin' : 'Verified'}
          style={{ width: size, height: size, display: 'block' }}
        />
      )}
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