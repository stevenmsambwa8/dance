/**
 * UserBadges — renders the badge row for a user:
 *   [tick.png if admin OR elite/team plan] [flag.png if set] [fire.png if season winner]
 *
 * Props:
 *   email          – string  – user's email (to detect admin)
 *   plan           – string  – user's plan key ('elite' | 'team' also get tick)
 *   planExpiresAt  – string  – ISO date, to check if plan is still active
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
  const isVerified = isAdmin || activePlan === 'elite' || activePlan === 'team'
  const showFlag   = !!countryFlag
  const showFire   = !!isSeasonWinner

  if (!isVerified && !showFlag && !showFire) return null

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
      {isVerified && (
        <img
          src="/tick.png"
          alt={isAdmin ? 'Admin' : 'Verified'}
          title={isAdmin ? 'Admin' : 'Verified Member'}
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
