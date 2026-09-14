// ── Supported Games ──
export const GAME_SLUGS = ['pubg', 'freefire', 'codm', 'maleo_bussid', 'efootball', 'dls', 'ufl', 'cpm2']

export const GAME_META = {
  pubg:         { name: 'PUBGM',         full: "PlayerUnknown's Battlegrounds",   genre: 'Battle Royale',       icon: 'ri-gamepad-line',  image: '/games/pubg.png',       desc: 'Drop in, loot up, and be the last one standing. 100-player battle royale on massive maps.', color: '#f4b400', tag: 'Winner Winner' },
  freefire:     { name: 'Free Fire',    full: 'Garena Free Fire',                genre: 'Battle Royale',       icon: 'ri-fire-line',     image: '/games/freefire.png',   desc: 'Fast-paced 50-player survival on a shrinking island. 10-minute matches, maximum chaos.', color: '#ff5722', tag: 'Booyah!' },
  codm:         { name: 'Call of Duty', full: 'Call of Duty: Mobile',            genre: 'FPS / Battle Royale', icon: 'ri-award-line',    image: '/games/callofduty.png', desc: 'Iconic multiplayer maps, modes, and weapons from the COD franchise — now on mobile.', color: '#7c9c3f', tag: 'Confirmed Kill' },
  maleo_bussid: { name: 'Maleo BUSSID', full: 'Bus Simulator Indonesia — Maleo', genre: 'Simulation / Racing', icon: 'ri-truck-line',    image: '/games/maleo.png',      desc: 'Authentic Indonesian bus driving simulation. Compete in routes, time trials, and championships.', color: '#2196f3', tag: 'On The Road' },
  efootball:    { name: 'eFootball',    full: 'eFootball 2025',                  genre: 'Sports',              icon: 'ri-football-line', image: '/games/efootball.png',  desc: "The world's most realistic football simulation. Compete in leagues and knockout cups.", color: '#00c853', tag: 'Full Time' },
  dls:          { name: 'DLS26',          full: 'Dream League Soccer',             genre: 'Football / Sports',   icon: 'ri-ball-pen-line', image: '/games/dls.png',        desc: 'Best game so far! Build your dream team and compete in leagues, cups, and online tournaments.', color: '#e53935', tag: 'Dream Team' },
    ufl:          { name: 'UFL',          full: 'UFL mobile',             genre: 'Football / Sports',   icon: 'ri-football-line', image: '/games/ufl.png',        desc: 'New game, unlimited football tournaments inside.', color: '#00bcd4', tag: 'Kickoff' },
    cpm2:         { name: 'CPM 2',        full: 'Car Parking Multiplayer 2',       genre: 'Simulation / Racing', icon: 'ri-car-line',      image: '/games/cpm2.png',       desc: 'Open-world parking and driving simulator with 170+ cars, tuning, racing, police and taxi modes, and live multiplayer.', color: '#ffc107', tag: 'Start Your Engine' },
}

// ── Country Flags (default: Tanzania for anyone unset) ──
export const FLAG_OPTIONS = [
  { value: 'kenya',        label: 'Kenya',        code: '254', flag: '/kenya.png'        },
  { value: 'tanzania',     label: 'Tanzania',     code: '255', flag: '/tanzania.png'     },
  { value: 'uganda',       label: 'Uganda',       code: '256', flag: '/uganda.png'       },
  { value: 'south-africa', label: 'South Africa', code: '27',  flag: '/south-africa.png' },
  { value: 'nigeria',      label: 'Nigeria',      code: '234', flag: '/nigeria.png'      },
]
export const DEFAULT_FLAG = 'tanzania'

// ── Player Ranking Tiers ──
export const RANK_TIERS = ['Gold', 'Platinum', 'Diamond', 'Ace', 'Conquer', 'Partner']

export const RANK_META = {
  Gold:     { color: '#f59e0b', icon: 'ri-medal-line',       label: 'Gold',     winsNeeded: 50,   lossDropAt: 30 },
  Platinum: { color: '#94a3b8', icon: 'ri-medal-2-line',     label: 'Platinum', winsNeeded: 50,   lossDropAt: 30 },
  Diamond:  { color: '#60a5fa', icon: 'ri-gem-line',         label: 'Diamond',  winsNeeded: 50,   lossDropAt: 30 },
  Ace:      { color: '#a78bfa', icon: 'ri-sword-line',       label: 'Ace',      winsNeeded: 100,  lossDropAt: 30 },
  Conquer:  { color: '#ef4444', icon: 'ri-fire-line',        label: 'Conquer',  winsNeeded: 100,  lossDropAt: 20 },
  Partner:  { color: '#22c55e', icon: 'ri-shield-star-line', label: 'Partner',  winsNeeded: null, lossDropAt: 10 },
}
