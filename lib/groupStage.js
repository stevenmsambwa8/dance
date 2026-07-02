/**
 * groupStage.js — Group-stage engine for Nabogaming tournaments.
 *
 * Design goal: this is a self-contained module. It does NOT touch
 * bracket_data.rounds directly — it only produces a `groups` block and,
 * once the stage is complete, a flat ordered qualifier list that gets
 * handed to the EXISTING buildBracket(parts, teamSize) from page.js
 * unchanged. Nothing about the knockout engine needs to change.
 *
 * Shape this module owns (lives at bracket_data.groups):
 * {
 *   groups: [
 *     {
 *       id: 'group_0', name: 'Group A',
 *       members: [{ userId, name, avatar }],       // solo mode
 *       // OR members: [{ teamId, name, players:[...] }]   // team mode
 *       fixtures: [
 *         { id, homeId, awayId, scoreHome: null, scoreAway: null, status: 'pending'|'played' }
 *       ]
 *     }
 *   ],
 *   advancePerGroup: 2,
 * }
 */

// ─── Grouping ────────────────────────────────────────────────────────────

/**
 * Split participants into `groupCount` groups as evenly as possible,
 * using a snake draft (1,2,3,4 | 4,3,2,1 | 1,2,3,4 ...) so seeding is
 * spread fairly rather than just chunked in order.
 */
export function buildGroups(participants, groupCount, teamSize = 1) {
  if (!participants?.length || groupCount < 1) return []

  // Team mode: group raw participants into teams first, then distribute teams.
  const units = teamSize > 1 ? unitizeIntoTeams(participants, teamSize) : participants.map(p => ({
    id: p.user_id,
    name: p.profiles?.username || '?',
    avatar: p.profiles?.avatar_url || null,
  }))

  const shuffled = [...units].sort(() => Math.random() - 0.5)
  const groups = Array.from({ length: groupCount }, (_, i) => ({
    id: `group_${i}`,
    name: `Group ${String.fromCharCode(65 + i)}`, // A, B, C...
    members: [],
  }))

  // Snake draft distribution for fairness.
  let dir = 1, g = 0
  for (const unit of shuffled) {
    groups[g].members.push(unit)
    g += dir
    if (g === groupCount) { g = groupCount - 1; dir = -1 }
    else if (g < 0) { g = 0; dir = 1 }
  }

  return groups.map(gr => ({
    ...gr,
    fixtures: generateRoundRobinFixtures(gr.members),
  }))
}

function unitizeIntoTeams(participants, teamSize) {
  const shuffled = [...participants].sort(() => Math.random() - 0.5)
  const teams = []
  for (let i = 0; i < shuffled.length; i += teamSize) {
    const players = shuffled.slice(i, i + teamSize).map(p => ({
      userId: p.user_id, name: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null,
    }))
    teams.push({ id: `team_${i}`, name: players[0]?.name ? `${players[0].name}'s Squad` : `Team ${i / teamSize + 1}`, players })
  }
  return teams
}

// ─── Round-robin fixture generation ───────────────────────────────────────

/**
 * Standard circle method for round-robin scheduling.
 * Handles odd counts by giving one member a "bye" fixture per round
 * (bye fixtures are informational only — they never affect standings).
 */
export function generateRoundRobinFixtures(members) {
  const n = members.length
  if (n < 2) return []

  const ids = members.map(m => m.id ?? m.userId ?? m.teamId)
  const hasBye = n % 2 !== 0
  const list = hasBye ? [...ids, null] : [...ids]
  const size = list.length
  const rounds = size - 1
  const half = size / 2

  const fixtures = []
  let arr = [...list]
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const home = arr[i]
      const away = arr[size - 1 - i]
      if (home != null && away != null) {
        fixtures.push({
          id: `${home}_vs_${away}_r${r}`,
          round: r,
          homeId: home,
          awayId: away,
          scoreHome: null,
          scoreAway: null,
          status: 'pending',
        })
      }
    }
    // rotate all but the first element
    arr = [arr[0], arr[size - 1], ...arr.slice(1, size - 1)]
  }
  return fixtures
}

// ─── Standings ─────────────────────────────────────────────────────────────

/**
 * Computes a sorted standings table for one group.
 * Tiebreak order: points → wins → head-to-head result → random (stable, seeded by id).
 */
export function computeStandings(group) {
  const table = {}
  group.members.forEach(m => {
    const id = m.id ?? m.userId ?? m.teamId
    table[id] = {
      id, name: m.name,
      played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0,
      points: 0,
    }
  })

  const h2h = {} // h2h[a][b] = result from a's perspective: 'W'|'D'|'L'

  for (const fx of group.fixtures) {
    if (fx.status !== 'played' || fx.scoreHome == null || fx.scoreAway == null) continue
    const home = table[fx.homeId], away = table[fx.awayId]
    if (!home || !away) continue
    home.played++; away.played++
    home.goalsFor += fx.scoreHome; home.goalsAgainst += fx.scoreAway
    away.goalsFor += fx.scoreAway; away.goalsAgainst += fx.scoreHome
    if (fx.scoreHome > fx.scoreAway) {
      home.won++; home.points += 3; away.lost++
      setH2H(h2h, fx.homeId, fx.awayId, 'W')
    } else if (fx.scoreHome < fx.scoreAway) {
      away.won++; away.points += 3; home.lost++
      setH2H(h2h, fx.homeId, fx.awayId, 'L')
    } else {
      home.drawn++; away.drawn++; home.points += 1; away.points += 1
      setH2H(h2h, fx.homeId, fx.awayId, 'D')
    }
  }

  const rows = Object.values(table).map(r => ({ ...r, goalDiff: r.goalsFor - r.goalsAgainst }))

  // Real-world football tiebreak order: points → goal difference → goals scored → head-to-head → id.
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
    const h = h2h[a.id]?.[b.id]
    if (h === 'W') return -1
    if (h === 'L') return 1
    // stable fallback — keep deterministic order by id
    return String(a.id).localeCompare(String(b.id))
  })

  return rows.map((row, i) => ({ ...row, position: i + 1 }))
}

function setH2H(h2h, a, b, result) {
  h2h[a] = h2h[a] || {}
  h2h[b] = h2h[b] || {}
  h2h[a][b] = result
  h2h[b][a] = result === 'W' ? 'L' : result === 'L' ? 'W' : 'D'
}

export function isGroupComplete(group) {
  return group.fixtures.every(fx => fx.status === 'played')
}

export function isGroupStageComplete(groups) {
  return groups.every(isGroupComplete)
}

/**
 * Adds a single new member into an already-drawn group, generating fresh
 * fixtures between the newcomer and every existing member. Existing
 * fixtures (and any scores already recorded) are left untouched.
 * Used when a player registers mid-draw for a live groups_knockout
 * tournament, so the table updates itself instead of needing a manual redraw.
 */
export function addMemberToGroup(group, member) {
  const memberId = member.id ?? member.userId ?? member.teamId
  const newFixtures = group.members.map(m => {
    const existingId = m.id ?? m.userId ?? m.teamId
    return {
      id: `${existingId}_vs_${memberId}_join${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      round: 0,
      homeId: existingId,
      awayId: memberId,
      scoreHome: null,
      scoreAway: null,
      status: 'pending',
    }
  })
  return {
    ...group,
    members: [...group.members, member],
    fixtures: [...group.fixtures, ...newFixtures],
  }
}

// ─── Promotion into knockout ────────────────────────────────────────────

/**
 * Takes finished groups + how many advance per group, and returns a flat,
 * cross-seeded participant list ready to hand to buildBracket(list, teamSize).
 *
 * Cross-seeding: all group winners are placed first (in group order),
 * then all runners-up, etc. — so a knockout draw pairs group-winners
 * against runners-up from OTHER groups rather than immediate rematches.
 * The existing buildBracket() shuffle + bye logic in page.js is reused
 * unchanged; this function only decides WHO gets in and in what seed order.
 */
export function getQualifiers(groups, advancePerGroup) {
  const byRank = Array.from({ length: advancePerGroup }, () => [])

  groups.forEach(group => {
    const standings = computeStandings(group)
    standings.slice(0, advancePerGroup).forEach((row, rankIdx) => {
      const member = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === row.id)
      byRank[rankIdx].push({
        user_id: member?.userId ?? member?.id,      // solo shape, matches buildBracket's expected `user_id`
        profiles: { username: member?.name, avatar_url: member?.avatar },
        _teamMembers: member?.players || null,        // present only in team mode
        _fromGroup: group.name,
        _groupRank: row.position,
      })
    })
  })

  // Flatten rank-by-rank: all 1st places, then all 2nd places, etc.
  return byRank.flat()
}
