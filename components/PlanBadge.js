'use client'
/**
 * components/PlanBadge.js
 *
 * Usage:
 *   <PlanBadge plan={profile.plan} planExpiresAt={profile.plan_expires_at} size="sm" />
 *
 * Sizes: 'sm' | 'md' | 'lg'
 */
import { getActivePlan, PLANS } from '../lib/plans'

export default function PlanBadge({ plan, planExpiresAt, size = 'sm', showLabel = false }) {
  const activePlan = getActivePlan({ plan, plan_expires_at: planExpiresAt })
  if (activePlan === 'free') return null

  const def = PLANS[activePlan]
  if (!def) return null

  const sizes = {
    sm: { fontSize: 11, padding: '1px 5px', borderRadius: 4, iconSize: 11 },
    md: { fontSize: 12, padding: '3px 7px', borderRadius: 5, iconSize: 13 },
    lg: { fontSize: 14, padding: '5px 10px', borderRadius: 7, iconSize: 15 },
  }
  const s = sizes[size] || sizes.sm

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
      <span style={{ fontSize: s.iconSize }}>{def.badge}</span>
      {showLabel && <span>{def.label}</span>}
    </span>
  )
}
