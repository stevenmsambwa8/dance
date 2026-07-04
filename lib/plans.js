/**
 * lib/plans.js
 * Single source of truth for Nabogaming subscription plans.
 * All prices stored/compared in TZS. Display conversion via useCurrency.
 */

export const PLANS = {
  free: {
    key:       'free',
    label:     'Free',
    price_tzs: 0,
    icon:      'ri-user-line',
    color:     '#8e8e93',
    features: [
      'Join up to 3 free tournaments at a time',
      'Up to 10 DM conversations',
      '1 game tag on profile',
      '20 match history entries',
      'Full feed, leaderboard & players',
    ],
    limits: {
      free_tournaments:  3,
      dm_conversations:  10,
      game_tags:         1,
      match_history:     20,
      create_tournament: false,
      shop_sell:         false,
      partner_page:      false,
      pro_tournaments:   false,
      profile_banner:    false,
      verified_badge:    false,
      analytics:         false,
    },
  },

  pro: {
    key:       'pro',
    label:     'Pro',
    price_tzs: 200,
    icon:      'ri-vip-crown-line',
    color:     '#a855f7',
    badge:     '👑',
    popular:   false,
    features: [
      'Unlimited free tournament entries',
      'Unlimited DMs',
      'Up to 5 game tags',
      'Full match history',
      'Join Pro-only tournaments',
      'Pro badge + crown on profile',
      'Custom profile accent color',
    ],
    limits: {
      free_tournaments:  Infinity,
      dm_conversations:  Infinity,
      game_tags:         5,
      match_history:     Infinity,
      create_tournament: false,
      shop_sell:         false,
      partner_page:      false,
      pro_tournaments:   true,
      profile_banner:    false,
      verified_badge:    false,
      analytics:         false,
    },
  },

  elite: {
    key:       'elite',
    label:     'Elite',
    price_tzs: 35000,
    icon:      'ri-vip-diamond-line',
    color:     '#38bdf8',
    badge:     '💎',
    popular:   true,
    features: [
      'Everything in Pro',
      'Create & manage tournaments',
      'Pro-only toggle when creating tournaments',
      'Sell in the Shop',
      'Partner dashboard access',
      'Custom profile banner',
      'Verified checkmark badge',
      'Analytics & performance charts',
      'Priority help desk queue',
    ],
    limits: {
      free_tournaments:  Infinity,
      dm_conversations:  Infinity,
      game_tags:         Infinity,
      match_history:     Infinity,
      create_tournament: true,
      shop_sell:         true,
      partner_page:      true,
      pro_tournaments:   true,
      profile_banner:    true,
      verified_badge:    true,
      analytics:         true,
    },
  },

  team: {
    key:       'team',
    label:     'Team',
    price_tzs: 55000,
    icon:      'ri-team-line',
    color:     '#22c55e',
    badge:     '🛡️',
    popular:   false,
    features: [
      'Everything in Elite (for owner)',
      'All team members get Pro perks',
      'Create & manage a team roster',
      'Team profile page + logo',
      'Team-only tournaments',
      'Team chat room',
      'Team leaderboard & stats',
      'Team invite links',
    ],
    limits: {
      free_tournaments:  Infinity,
      dm_conversations:  Infinity,
      game_tags:         Infinity,
      match_history:     Infinity,
      create_tournament: true,
      shop_sell:         true,
      partner_page:      true,
      pro_tournaments:   true,
      profile_banner:    true,
      verified_badge:    true,
      analytics:         true,
      team_features:     true,
    },
  },
}

// ── Prices by country flag ─────────────────────────────────
export const PLAN_PRICES = {
  tanzania:      { currency: 'TZS', symbol: 'TZS', pro: 12000,  elite: 35000,  team: 55000  },
  kenya:         { currency: 'KES', symbol: 'KES', pro: 600,    elite: 1700,   team: 2500   },
  uganda:        { currency: 'UGX', symbol: 'UGX', pro: 45000,  elite: 130000, team: 200000 },
  'south-africa':{ currency: 'ZAR', symbol: 'ZAR', pro: 120,    elite: 350,    team: 550    },
  nigeria:       { currency: 'NGN', symbol: '₦',   pro: 2000,   elite: 5500,   team: 9000   },
}

export const DEFAULT_PRICES = PLAN_PRICES['tanzania']

export function getPlanPrice(planKey, countryFlag) {
  if (planKey === 'free') return 'Free'
  const prices = PLAN_PRICES[countryFlag] || DEFAULT_PRICES
  const amount  = prices[planKey]
  if (!amount) return 'Free'
  return `${prices.symbol} ${Number(amount).toLocaleString()}`
}

export function getPlanPriceTZS(planKey) {
  return PLANS[planKey]?.price_tzs || 0
}

// ── Permission helpers ─────────────────────────────────────

export function canDo(profile, feature) {
  const plan = getPlan(profile)
  return !!plan.limits[feature]
}

export function underLimit(profile, feature, currentCount) {
  const plan  = getPlan(profile)
  const limit = plan.limits[feature]
  if (limit === undefined) return true
  if (limit === Infinity)  return true
  return currentCount < limit
}

export function getPlan(profile) {
  const key = getActivePlan(profile)
  return PLANS[key] || PLANS.free
}

export function getActivePlan(profile) {
  if (!profile) return 'free'
  const plan    = profile.plan || 'free'
  const expires = profile.plan_expires_at
  if (plan === 'free') return 'free'
  if (expires && new Date(expires) < new Date()) return 'free'
  return plan
}

export function isPaid(profile) {
  return getActivePlan(profile) !== 'free'
}

export const FEATURE_PLAN = {
  free_tournaments:  'pro',
  dm_conversations:  'pro',
  game_tags:         'pro',
  match_history:     'pro',
  pro_tournaments:   'pro',
  create_tournament: 'elite',
  shop_sell:         'elite',
  partner_page:      'elite',
  profile_banner:    'elite',
  verified_badge:    'elite',
  analytics:         'elite',
  team_features:     'team',
}
