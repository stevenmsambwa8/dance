// lib/siteZones.js
// Single source of truth for the "Lobby Map" feature.
// Maps a pathname to a zone, and defines where each zone sits on the map.

export const ZONES = [
  { id: 'dashboard',  label: 'Home Base',    icon: 'ri-stack-fill',      x: 50, y: 50, color: '#22c55e' },
  { id: 'tournaments',label: 'Arena',        icon: 'ri-trophy-fill',     x: 22, y: 24, color: '#f59e0b' },
  { id: 'games',      label: 'Game Hub',     icon: 'ri-gamepad-fill',    x: 78, y: 22, color: '#8b5cf6' },
  { id: 'clans',      label: 'Clan Grounds', icon: 'ri-group-3-fill',    x: 14, y: 62, color: '#ef4444' },
  { id: 'feed',       label: 'Town Square',  icon: 'ri-compass-3-fill', x: 50, y: 14, color: '#06b6d4' },
  { id: 'shop',       label: 'Marketplace',  icon: 'ri-store-2-fill',   x: 86, y: 60, color: '#ec4899' },
  { id: 'wallet',     label: "Vault",        icon: 'ri-wallet-3-fill',  x: 50, y: 86, color: '#eab308' },
  { id: 'dm',         label: 'Signal Tower', icon: 'ri-chat-3-fill',    x: 74, y: 78, color: '#3b82f6' },
  { id: 'season',     label: 'Rank Peak',    icon: 'ri-medal-fill',     x: 26, y: 82, color: '#14b8a6' },
  { id: 'account',    label: 'Camp',         icon: 'ri-user-fill',      x: 8,  y: 40, color: '#9a9aa0' },
  { id: 'other',      label: 'Wandering',    icon: 'ri-map-pin-fill',   x: 92, y: 40, color: '#9a9aa0' },
]

const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]))

// Order matters — first match wins. Keep more specific prefixes above generic ones.
const PATH_RULES = [
  { prefix: '/dashboard',    zone: 'dashboard' },
  { prefix: '/',             zone: 'dashboard', exact: true },
  { prefix: '/tournaments',  zone: 'tournaments' },
  { prefix: '/fifa26',       zone: 'tournaments' },
  { prefix: '/games',        zone: 'games' },
  { prefix: '/players',      zone: 'games' },
  { prefix: '/clans',        zone: 'clans' },
  { prefix: '/feed',         zone: 'feed' },
  { prefix: '/notifications',zone: 'feed' },
  { prefix: '/shop',         zone: 'shop' },
  { prefix: '/upgrade',      zone: 'shop' },
  { prefix: '/wallet',       zone: 'wallet' },
  { prefix: '/dm',           zone: 'dm' },
  { prefix: '/help-desk',    zone: 'dm' },
  { prefix: '/season',       zone: 'season' },
  { prefix: '/account',      zone: 'account' },
  { prefix: '/profile',      zone: 'account' },
  { prefix: '/settings',     zone: 'account' },
  { prefix: '/creators-hub', zone: 'account' },
  { prefix: '/my-requests',  zone: 'account' },
  { prefix: '/partner',      zone: 'account' },
  { prefix: '/music',        zone: 'other' },
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
