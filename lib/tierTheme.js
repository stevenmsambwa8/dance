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
  Ace: {
    primary:    '#a78bfa',
    glow:       'rgba(167,139,250,0.22)',
    gradient:   'linear-gradient(135deg, rgba(167,139,250,0.16) 0%, rgba(139,92,246,0.08) 100%)',
    border:     'rgba(167,139,250,0.45)',
    avatarRing: '#a78bfa',
    icon:       'ri-sword-line',
    label:      'Ace',
    shimmer:    true,
  },
  Conquer: {
    primary:    '#ef4444',
    glow:       'rgba(239,68,68,0.22)',
    gradient:   'linear-gradient(135deg, rgba(239,68,68,0.16) 0%, rgba(249,115,22,0.08) 100%)',
    border:     'rgba(239,68,68,0.45)',
    avatarRing: 'linear-gradient(135deg, #ef4444, #f97316)',
    icon:       'ri-fire-line',
    label:      'Conquer',
    shimmer:    true,
  },
  Partner: {
    primary:    '#22c55e',
    glow:       'rgba(34,197,94,0.30)',
    gradient:   'linear-gradient(135deg, rgba(34,197,94,0.22) 0%, rgba(16,185,129,0.12) 50%, rgba(6,182,212,0.08) 100%)',
    border:     'rgba(34,197,94,0.60)',
    avatarRing: 'linear-gradient(135deg, #22c55e, #10b981, #06b6d4, #22c55e)',
    icon:       'ri-shield-star-fill',
    label:      'Partner',
    shimmer:    true,
    exclusive:  true,
  },
  // Legacy — kept for backward compat if any old data has 'Legend'
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
