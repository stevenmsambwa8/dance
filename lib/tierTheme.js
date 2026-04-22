/**
 * tierTheme.js
 * Returns visual theme config for each competitive tier.
 * Used on profile cards to give each tier a distinct look.
 */

export const TIER_THEMES = {
  Gold: {
    primary:    '#f59e0b',
    glow:       'rgba(245,158,11,0.18)',
    gradient:   'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%)',
    border:     'rgba(245,158,11,0.35)',
    avatarRing: '#f59e0b',
    icon:       'ri-shield-star-line',
    label:      'Gold',
    shimmer:    false,
  },
  Platinum: {
    primary:    '#94a3b8',
    glow:       'rgba(148,163,184,0.18)',
    gradient:   'linear-gradient(135deg, rgba(148,163,184,0.14) 0%, rgba(148,163,184,0.04) 100%)',
    border:     'rgba(148,163,184,0.40)',
    avatarRing: '#94a3b8',
    icon:       'ri-shield-flash-line',
    label:      'Platinum',
    shimmer:    false,
  },
  Diamond: {
    primary:    '#38bdf8',
    glow:       'rgba(56,189,248,0.20)',
    gradient:   'linear-gradient(135deg, rgba(56,189,248,0.14) 0%, rgba(99,102,241,0.08) 100%)',
    border:     'rgba(56,189,248,0.40)',
    avatarRing: '#38bdf8',
    icon:       'ri-vip-diamond-line',
    label:      'Diamond',
    shimmer:    true,
  },
  Legend: {
    primary:    '#a855f7',
    glow:       'rgba(168,85,247,0.22)',
    gradient:   'linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(236,72,153,0.10) 100%)',
    border:     'rgba(168,85,247,0.45)',
    avatarRing: 'linear-gradient(135deg, #a855f7, #ec4899)',
    icon:       'ri-vip-crown-line',
    label:      'Legend',
    shimmer:    true,
  },
}

export function getTierTheme(tier) {
  return TIER_THEMES[tier] || TIER_THEMES.Gold
}
