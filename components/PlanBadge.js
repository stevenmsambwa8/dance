'use client'
/**
 * PlanBadge — pill badge shown next to usernames / in lists
 * Replaces emoji with the same SVG icons as UserBadges for consistency.
 *
 * Usage:
 *   <PlanBadge plan={profile.plan} planExpiresAt={profile.plan_expires_at} size="sm" />
 *
 * Sizes: 'sm' | 'md' | 'lg'
 */
import { getActivePlan, PLANS } from '../lib/plans'
import { DiamondBadge, ProBadge } from './UserBadges'

export default function PlanBadge({ plan, planExpiresAt, size = 'sm', showLabel = false }) {
  const activePlan = getActivePlan({ plan, plan_expires_at: planExpiresAt })
  if (activePlan === 'free') return null

  const def = PLANS[activePlan]
  if (!def) return null

  const sizes = {
    sm: { fontSize: 11, padding: '1px 5px', borderRadius: 4, iconSize: 13 },
    md: { fontSize: 12, padding: '3px 7px', borderRadius: 5, iconSize: 15 },
    lg: { fontSize: 14, padding: '5px 10px', borderRadius: 7, iconSize: 18 },
  }
  const s = sizes[size] || sizes.sm

  const Icon = activePlan === 'elite' || activePlan === 'team'
    ? <DiamondBadge size={s.iconSize} />
    : activePlan === 'pro'
    ? <ProBadge size={s.iconSize} />
    : null

  if (!Icon && !showLabel) return null

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: s.padding, borderRadius: s.borderRadius,
      background: def.color + '18',
      border: `1px solid ${def.color}44`,
      color: def.color,
      fontSize: s.fontSize,
      fontWeight: 800,
      letterSpacing: '0.02em',
      verticalAlign: 'middle',
      lineHeight: 1,
      userSelect: 'none',
      marginLeft: 4,
    }}>
      {Icon}
      {showLabel && <span>{def.label}</span>}
    </span>
  )
}
