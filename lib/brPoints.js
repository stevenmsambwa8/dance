/**
 * brPoints.js — Battle Royale points engine for Nabogaming tournaments.
 *
 * Design goal: self-contained module, same spirit as groupStage.js.
 * It does NOT touch bracket_data.rounds or bracket_data.groups — it owns
 * its own shape at bracket_data when stage_format === 'br_points':
 *
 * {
 *   format: 'br_points',
 *   config: {
 *     matchCount: 6,               // planned number of matches/lobbies
 *     killPointValue: 1,           // points awarded per kill
 *     placementTable: { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 },
 *   },
 *   matches: [
 *     {
 *       id, name: 'Match 1', lobbyCode: '', playedAt: ISOString,
 *       results: [
 *         { unitId, name, placement, kills }   // solo: unitId = user_id
 *         // OR { unitId: teamId, name, players:[...], placement, kills }
 *       ],
 *     }
 *   ],
 * }
 *
 * Standings are always derived (never stored) via computeBRStandings().
 */

// ── Defaults ────────────────────────────────────────────────────────────

// A common scaled placement table for squad/BR esports formats (top 8 paid,
// rest score 0 from placement — kills still count for everyone).
export const DEFAULT_PLACEMENT_TABLE = { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 }

export const DEFAULT_KILL_POINT_VALUE = 1

export const PLACEMENT_TABLE_PRESETS = {
  standard: { label: 'Standard (Top 8 paid)',  table: { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 } },
  top4:     { label: 'Top 4 only',              table: { 1: 12, 2: 8, 3: 5, 4: 3 } },
  wta:      { label: 'Winner takes all',        table: { 1: 15 } },
  flat10:   { label: 'Flat Top 10',             table: { 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 } },
}

// ── Config builders ───────────────────────────────────────────────────────

export function buildDefaultBRConfig(overrides = {}) {
  return {
    matchCount: 6,
    killPointValue: DEFAULT_KILL_POINT_VALUE,
    placementTable: { ...DEFAULT_PLACEMENT_TABLE },
    ...overrides,
  }
}

export function buildEmptyBRBracket(config) {
  return { format: 'br_points', config: buildDefaultBRConfig(config), matches: [] }
}

export function parseBRData(raw) {
  if (!raw) return null
  const bd = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (bd?.format !== 'br_points') return null
  return { format: 'br_points', config: buildDefaultBRConfig(bd.config), matches: Array.isArray(bd.matches) ? bd.matches : [] }
}

export function getPlacementPoints(placement, placementTable) {
  if (!placement || placement < 1) return 0
  return placementTable?.[placement] ?? 0
}

// ── Team unitization (mirrors groupStage.js's private helper) ────────────

export function unitizeParticipants(participants, teamSize = 1) {
  if (teamSize <= 1) {
    return (participants || []).map(p => ({
      unitId: p.user_id,
      name: p.profiles?.username || '?',
      avatar: p.profiles?.avatar_url || null,
      players: [p.user_id],
    }))
  }
  const bySquad = new Map()
  for (const p of participants || []) {
    const squadId = p.squad_id || p.clan_squads?.id || `solo_${p.user_id}`
    if (!bySquad.has(squadId)) {
      bySquad.set(squadId, {
        unitId: squadId,
        name: p.clan_squads?.name || p.squad_name || 'Squad',
        avatar: p.clan_squads?.image_url || null,
        players: [],
      })
    }
    bySquad.get(squadId).players.push(p.user_id)
  }
  return Array.from(bySquad.values())
}

// ── Match management ──────────────────────────────────────────────────────

function nextMatchId(matches) {
  return `match_${(matches?.length || 0) + 1}_${Date.now()}`
}

export function addOrUpdateMatch(bd, match) {
  const matches = bd.matches || []
  const idx = matches.findIndex(m => m.id === match.id)
  const withId = { ...match, id: match.id || nextMatchId(matches) }
  const newMatches = idx >= 0
    ? matches.map((m, i) => i === idx ? withId : m)
    : [...matches, withId]
  return { ...bd, matches: newMatches }
}

export function removeMatch(bd, matchId) {
  return { ...bd, matches: (bd.matches || []).filter(m => m.id !== matchId) }
}

// ── Standings ─────────────────────────────────────────────────────────────

/**
 * Aggregates all logged matches into a sorted standings table.
 * Sort priority: total points desc → total kills desc → best (lowest) placement.
 */
export function computeBRStandings(bd, units) {
  const { config, matches } = bd
  const rows = new Map()

  for (const u of units || []) {
    rows.set(u.unitId, {
      unitId: u.unitId,
      name: u.name,
      avatar: u.avatar,
      players: u.players || [],
      matchesPlayed: 0,
      totalKills: 0,
      placementPoints: 0,
      totalPoints: 0,
      bestPlacement: null,
      wins: 0, // #1 finishes
    })
  }

  for (const match of matches || []) {
    for (const r of match.results || []) {
      if (!rows.has(r.unitId)) {
        rows.set(r.unitId, {
          unitId: r.unitId, name: r.name || '?', avatar: null, players: r.players || [],
          matchesPlayed: 0, totalKills: 0, placementPoints: 0, totalPoints: 0, bestPlacement: null, wins: 0,
        })
      }
      const row = rows.get(r.unitId)
      const kills = Number(r.kills) || 0
      const placement = Number(r.placement) || null
      const pPoints = getPlacementPoints(placement, config.placementTable)
      row.matchesPlayed += 1
      row.totalKills += kills
      row.placementPoints += pPoints
      row.totalPoints += pPoints + kills * (config.killPointValue ?? DEFAULT_KILL_POINT_VALUE)
      if (placement === 1) row.wins += 1
      if (placement && (row.bestPlacement === null || placement < row.bestPlacement)) row.bestPlacement = placement
    }
  }

  return Array.from(rows.values())
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
      if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills
      const ap = a.bestPlacement ?? Infinity
      const bp = b.bestPlacement ?? Infinity
      return ap - bp
    })
    .map((row, i) => ({ ...row, position: i + 1 }))
}

export function isBRComplete(bd) {
  if (!bd?.config?.matchCount) return false
  return (bd.matches || []).length >= bd.config.matchCount
}
