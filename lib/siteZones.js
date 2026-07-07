// lib/siteZones.js
// Single source of truth for the "Lobby Map" feature.
// Zone labels use the SAME translation keys your Nav.js / BottomNav.js already
// use (lib/translations/en.js + sw.js under "navigation"), so a zone is always
// called exactly what that section is called everywhere else in the app.
//
// labelKey is resolved with useTranslation()'s t() in the page component —
// this file just defines ids, routing, icons, and map position.

export const ZONES = [
  { id: 'home',        labelKey: 'navigation.home',          icon: 'ri-stack-fill',        x: 50, y: 52, color: '#22c55e' },
  { id: 'tournaments', labelKey: 'navigation.tournaments',    icon: 'ri-trophy-fill',       x: 22, y: 18, color: '#f59e0b' },
  { id: 'games',       labelKey: 'navigation.games',          icon: 'ri-gamepad-fill',      x: 78, y: 18, color: '#8b5cf6' },
  { id: 'feed',        labelKey: 'navigation.feed',           icon: 'ri-compass-3-fill',    x: 50, y: 10, color: '#06b6d4' },
  { id: 'matches',     labelKey: 'navigation.matches',        icon: 'ri-sword-fill',        x: 14, y: 38, color: '#f97316' },
  { id: 'players',     labelKey: 'navigation.players',        icon: 'ri-group-fill',        x: 86, y: 38, color: '#84cc16' },
  { id: 'clans',       labelKey: 'home.clans',                icon: 'ri-shield-star-fill',  x: 12, y: 64, color: '#ef4444' },
  { id: 'shop',        labelKey: 'navigation.shop',           icon: 'ri-store-2-fill',      x: 88, y: 64, color: '#ec4899' },
  { id: 'wallet',      labelKey: 'navigation.wallet',         icon: 'ri-wallet-3-fill',     x: 30, y: 86, color: '#eab308' },
  { id: 'season',      labelKey: 'navigation.season',         icon: 'ri-dashboard-fill',    x: 70, y: 86, color: '#14b8a6' },
  { id: 'dm',          labelKey: 'navigation.directMessages', icon: 'ri-chat-private-fill', x: 50, y: 92, color: '#3b82f6' },
  { id: 'music',       labelKey: 'navigation.music',          icon: 'ri-music-2-fill',      x: 8,  y: 88, color: '#a855f7' },
  { id: 'account',     labelKey: 'navigation.account',        icon: 'ri-user-4-fill',       x: 8,  y: 12, color: '#9a9aa0' },
  { id: 'partner',     labelKey: 'navigation.partner',        icon: 'ri-shield-star-fill',  x: 92, y: 12, color: '#facc15' },
  { id: 'other',       labelKey: 'navigation.more',           icon: 'ri-map-pin-fill',      x: 92, y: 88, color: '#9a9aa0' },
]

const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]))

// Order matters — first match wins. Keep more specific prefixes above generic ones.
// Every prefix here is a real route that exists in /app.
const PATH_RULES = [
  { prefix: '/',              zone: 'home', exact: true },
  { prefix: '/tournaments',   zone: 'tournaments' },
  { prefix: '/fifa26',        zone: 'tournaments' },
  { prefix: '/games',         zone: 'games' },
  { prefix: '/feed',          zone: 'feed' },
  { prefix: '/matches',       zone: 'matches' },
  { prefix: '/players',       zone: 'players' },
  { prefix: '/clans',         zone: 'clans' },
  { prefix: '/shop',          zone: 'shop' },
  { prefix: '/upgrade',       zone: 'shop' },
  { prefix: '/wallet',        zone: 'wallet' },
  { prefix: '/season',        zone: 'season' },
  { prefix: '/dm',            zone: 'dm' },
  { prefix: '/music',         zone: 'music' },
  { prefix: '/account',       zone: 'account' },
  { prefix: '/settings',      zone: 'account' },
  { prefix: '/notifications', zone: 'account' },
  { prefix: '/creators-hub',  zone: 'account' },
  { prefix: '/my-requests',   zone: 'account' },
  { prefix: '/help-desk',     zone: 'account' },
  { prefix: '/partner',       zone: 'partner' },
  // '/dashboard' (admin panel) is intentionally NOT mapped to its own zone —
  // it falls through to 'other' so admin location isn't broadcast as a
  // labeled public zone on the map.
]

export function getZoneIdForPath(pathname) {
  if (!pathname) return 'other'
  for (const rule of PATH_RULES) {
    if (rule.exact) {
      if (pathname === rule.prefix) return rule.zone
    } else if (pathname.startsWith(rule.prefix)) {
      return rule.zone
    }
  }
  return 'other'
}

export function getZone(zoneId) {
  return ZONE_BY_ID[zoneId] || ZONE_BY_ID.other
}
