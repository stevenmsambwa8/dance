/**
 * UserBadges — renders the badge row for a user:
 *   [tick.png if admin] [flag.png if set] [fire.png if season winner]
 *
 * Props:
 *   email          – string  – user's email (to detect admin)
 *   countryFlag    – string  – 'kenya' | 'tanzania' | 'uganda' | null
 *   isSeasonWinner – bool    – show fire badge
 *   size           – number  – icon size in px (default 14)
 *   gap            – number  – gap between badges in px (default 3)
 */

import { ADMIN_EMAILS } from './AuthProvider'

export default function UserBadges({
  email,
  countryFlag,
  isSeasonWinner,
  size = 14,
  gap = 3,
}) {
  const showTick    = ADMIN_EMAILS.includes(email)
  const showFlag    = !!countryFlag
  const showFire    = !!isSeasonWinner

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
          alt="Admin"
          title="Admin"
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
