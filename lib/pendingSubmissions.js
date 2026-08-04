// ── Pending match-result submissions ────────────────────────────────────
// Scans every tournament a user is registered in for a fixture/match
// they're part of that's still unplayed and where THEY haven't yet
// submitted a score (group/league fixtures use `submissions.home` /
// `submissions.away`; knockout slots use `pendingSubmission`, set up by
// the self-submission flow in tournaments/[slug]/page.js).
//
// Each item also carries its own scheduleStart/scheduleEnd (if the
// organiser has assigned this specific match a time slot) so the nudge
// card can show a personal countdown and lock once it's passed.
//
// Read-only — this never writes anything, so it's safe to call from any
// page just to decide whether to show a nudge card.

import { knockoutKey, fixtureKey } from './matchScheduler'

export function parseBracketData(raw) {
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return null }
}

export function resolveMemberUserIds(member) {
  if (!member) return []
  if (member.players?.length) return member.players.map(p => p.userId).filter(Boolean)
  return member.id ? [member.id] : []
}

export function myFixtureSide(group, fx, uid) {
  const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
  const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
  const inSide = m => m && resolveMemberUserIds(m).includes(uid)
  if (inSide(home)) return 'home'
  if (inSide(away)) return 'away'
  return null
}

/**
 * Returns up to `limit` pending-submission items for a user, newest
 * tournament first. Each item has enough info to render a nudge card and
 * deep-link straight back to the right tournament.
 */
export async function fetchPendingSubmissions(supabase, userId, limit = 5) {
  if (!userId) return []

  const { data: parts } = await supabase
    .from('tournament_participants')
    .select('tournament_id')
    .eq('user_id', userId)
  const ids = [...new Set((parts || []).map(p => p.tournament_id))]
  if (!ids.length) return []

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, slug, name, status, stage_format, bracket_data')
    .in('id', ids)
    .in('status', ['ongoing', 'active'])
  if (!tournaments?.length) return []

  const results = []

  for (const t of tournaments) {
    const bd = parseBracketData(t.bracket_data)
    if (!bd) continue

    // ── Group stage / league fixtures ──
    if (bd.groups) {
      for (const group of bd.groups) {
        for (const fx of group.fixtures || []) {
          if (fx.status === 'played') continue
          const side = myFixtureSide(group, fx, userId)
          if (!side) continue
          if (fx.submissions?.[side]) continue // already submitted my side
          const myMember = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === (side === 'home' ? fx.homeId : fx.awayId))
          const oppMember = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === (side === 'home' ? fx.awayId : fx.homeId))
          const sched = bd.match_schedule?.[fixtureKey(fx.id)] || null
          results.push({
            tournamentId: t.id, tournamentSlug: t.slug, tournamentName: t.name,
            kind: 'group', groupId: group.id, fixtureId: fx.id,
            myName: myMember?.name || 'You',
            opponentName: oppMember?.name || 'Opponent', opponentAvatar: oppMember?.avatar || null,
            scheduleStart: sched?.start || null, scheduleEnd: sched?.end || null,
          })
        }
      }
    }

    // ── Knockout matches ──
    if (bd.rounds) {
      bd.rounds.slice(0, bd.rounds.length - 1).forEach((pairs, rIdx) => {
        pairs.forEach((pair, pIdx) => {
          const [a, b] = pair || []
          if (!a || !b || a.status === 'bye' || b.status === 'bye') return
          if (a.status === 'winner' || b.status === 'winner') return
          const mySlotIdx = a?.userId === userId ? 0 : b?.userId === userId ? 1 : null
          if (mySlotIdx == null) return
          const mySlot = mySlotIdx === 0 ? a : b
          const oppSlot = mySlotIdx === 0 ? b : a
          if (mySlot?.pendingSubmission) return // already submitted my side
          const sched = bd.match_schedule?.[knockoutKey(rIdx, pIdx)] || null
          results.push({
            tournamentId: t.id, tournamentSlug: t.slug, tournamentName: t.name,
            kind: 'knockout', rIdx, pIdx, mySlotIdx,
            myName: mySlot?.name || 'You',
            opponentName: oppSlot?.name || 'Opponent', opponentAvatar: oppSlot?.avatar || null,
            scheduleStart: sched?.start || null, scheduleEnd: sched?.end || null,
          })
        })
      })
    }
  }

  return results.slice(0, limit)
}
