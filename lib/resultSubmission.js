// ── Inline result submission engine ─────────────────────────────────────
// Lets a player record their score (and optional proof screenshot)
// straight from a "Result Needed" nudge card, without navigating to the
// tournament page. The confirm/agree/points logic here mirrors
// app/tournaments/[slug]/page.js exactly:
//   - group/league fixtures  -> submitFixtureResult
//   - knockout matches       -> submitKnockoutResult + the solo "winner"
//                                branch of adminSetSlotStatus
// so a match resolved from the card behaves identically to one resolved
// from the tournament page itself.

import { supabase } from './supabase'
import { isGroupStageComplete, getQualifiers, computeStandings } from './groupStage'
import { parseBracketData, resolveMemberUserIds, myFixtureSide } from './pendingSubmissions'
import { isTimeUp } from './roundTimers'

// ── pure helpers (mirrored from tournaments/[slug]/page.js) ─────────────
function nextPow2(n) { let s = 1; while (s < n) s *= 2; return s }

function getRoundLabelSimple(rIdx, totalRounds, bracketSize, customNames) {
  if (customNames?.[rIdx]) return customNames[rIdx]
  const fromEnd = (totalRounds - 2) - rIdx
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semi Final'
  if (fromEnd === 2) return 'Quarter Final'
  if (bracketSize >= 16 && fromEnd === 3) return 'Round of 16'
  if (bracketSize >= 32 && fromEnd === 4) return 'Round of 32'
  if (bracketSize >= 64 && fromEnd === 5) return 'Round of 64'
  return `Round ${rIdx + 1}`
}

function getRoundPts() {
  return { winnerPts: 3, loserPts: 1 }
}

function buildBracket(parts, teamSize = 1) {
  if (!parts || parts.length < 2) return null

  if (teamSize > 1) {
    const shuffled = [...parts].sort(() => Math.random() - 0.5)
    const teams = []
    for (let i = 0; i < shuffled.length; i += teamSize) {
      const members = shuffled.slice(i, i + teamSize).map(p => ({
        userId: p.user_id, name: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null, status: 'active',
      }))
      while (members.length < teamSize) members.push({ userId: null, name: '—', avatar: null, status: 'empty' })
      teams.push({ members, status: 'active', teamId: `team_${i}` })
    }
    if (teams.length < 2) return null
    const size = nextPow2(teams.length)
    const byeCount = size - teams.length
    for (let i = 0; i < byeCount; i++) {
      teams.push({
        members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'BYE', avatar: null, status: 'bye' })),
        status: 'bye', teamId: `bye_${i}`,
      })
    }
    const rounds = []
    let current = teams
    while (current.length > 1) {
      const pairs = []
      for (let i = 0; i < current.length; i += 2) pairs.push([{ ...current[i] }, { ...current[i + 1] }])
      rounds.push(pairs)
      current = pairs.map(() => ({
        members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })),
        status: 'pending', teamId: null,
      }))
    }
    rounds.push([[{ members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'TBD', avatar: null, status: 'pending' })), status: 'pending', teamId: null }, null]])
    return { rounds, bracketSize: size, byeCount, teamSize, isTeamBattle: true }
  }

  const size = nextPow2(parts.length)
  const byeCount = size - parts.length
  const shuffled = [...parts].sort(() => Math.random() - 0.5)
  const playerSlots = shuffled.map(p => ({
    userId: p.user_id, name: p.profiles?.username || '?', avatar: p.profiles?.avatar_url || null, status: 'active',
  }))
  for (let i = 0; i < byeCount; i++) playerSlots.push({ userId: null, name: 'BYE', avatar: null, status: 'bye' })

  const rounds = []
  let current = playerSlots
  while (current.length > 1) {
    const pairs = []
    for (let i = 0; i < current.length; i += 2) pairs.push([{ ...current[i] }, { ...current[i + 1] }])
    rounds.push(pairs)
    current = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }))
  }
  rounds.push([[{ userId: null, name: 'TBD', avatar: null, status: 'pending' }, null]])
  return { rounds, bracketSize: size, byeCount }
}

// ── supabase-backed helpers ──────────────────────────────────────────────
async function uploadMatchProof(tournamentId, file, tag) {
  if (!file) return null
  const path = `match-proofs/${tournamentId}/${tag}_${Date.now()}.${file.name.split('.').pop() || 'jpg'}`
  const { error: upErr } = await supabase.storage.from('public').upload(path, file)
  if (upErr) return null
  const { data: pub } = supabase.storage.from('public').getPublicUrl(path)
  return pub.publicUrl
}

async function awardBracketPoints(tournamentId, userId, points) {
  if (!userId || !points) return
  const { data: ex } = await supabase.from('tournament_leaderboard').select('id, points').eq('tournament_id', tournamentId).eq('user_id', userId).maybeSingle()
  if (ex) {
    await supabase.from('tournament_leaderboard').update({ points: (ex.points || 0) + points }).eq('id', ex.id)
  } else {
    await supabase.from('tournament_leaderboard').insert({ tournament_id: tournamentId, user_id: userId, points, position: 99 })
  }
  const { error: rpcErr } = await supabase.rpc('increment_points', { uid: userId, amount: points })
  if (rpcErr) {
    const { data: p } = await supabase.from('profiles').select('points').eq('id', userId).maybeSingle()
    if (p) await supabase.from('profiles').update({ points: Math.max(0, (p.points || 0) + points) }).eq('id', userId)
  }
}

async function recalcPositions(tournamentId) {
  const { error } = await supabase.rpc('recalc_tournament_positions', { p_tournament_id: tournamentId })
  if (error) {
    const { data: entries } = await supabase.from('tournament_leaderboard').select('id, points').eq('tournament_id', tournamentId).order('points', { ascending: false })
    if (!entries) return
    let pos = 1
    await Promise.all(entries.map((entry, i) => {
      if (i > 0 && entries[i].points < entries[i - 1].points) pos = i + 1
      return supabase.from('tournament_leaderboard').update({ position: pos }).eq('id', entry.id)
    }))
  }
}

async function awardAchievement(userId, icon, label, description) {
  if (!userId) return
  const { data: existing } = await supabase.from('achievements').select('id').eq('user_id', userId).eq('label', label).maybeSingle()
  if (existing) return
  await supabase.from('achievements').insert({ user_id: userId, icon, label, description, unlocked_at: new Date().toISOString() })
}

// ── group stage progression (mirrors page.js finalizeLeague / autoBuildKnockout) ──
async function finalizeLeague(t, freshBd) {
  if (!freshBd?.groups?.[0]) return null
  if (!isGroupStageComplete(freshBd.groups)) return null
  if (freshBd.stage === 'complete') return null

  const table = freshBd.groups[0]
  const podium = freshBd.advancePerGroup || t.advance_per_group || 3
  const standings = computeStandings(table)
  const winners = standings.slice(0, podium).map(row => ({ id: row.id, name: row.name, points: row.points, position: row.position }))
  if (!winners.length) return null

  const merged = { ...freshBd, stage: 'complete', winners, podium }
  const { error } = await supabase.from('tournaments').update({ bracket_data: merged, status: 'completed' }).eq('id', t.id)
  if (error) return null

  const BONUS_BY_POSITION = { 1: 30, 2: 20, 3: 10 }
  await Promise.all(winners.flatMap(w => {
    const member = table.members.find(m => (m.id ?? m.userId ?? m.teamId) === w.id)
    const bonus = BONUS_BY_POSITION[w.position] || 5
    return resolveMemberUserIds(member).map(uid => awardBracketPoints(t.id, uid, bonus))
  }))
  const champion = winners.find(w => w.position === 1)
  if (champion) {
    const champMember = table.members.find(m => (m.id ?? m.userId ?? m.teamId) === champion.id)
    await Promise.all(resolveMemberUserIds(champMember).map(uid => supabase.from('profiles').update({ is_season_winner: true }).eq('id', uid)))
  }

  const winnerIds = new Set(winners.flatMap(w => resolveMemberUserIds(table.members.find(m => (m.id ?? m.userId ?? m.teamId) === w.id))))
  const { data: parts } = await supabase.from('tournament_participants').select('user_id').eq('tournament_id', t.id)
  const notifs = (parts || []).filter(p => p.user_id).map(p => {
    const isWinner = winnerIds.has(p.user_id)
    const rank = winners.find(w => resolveMemberUserIds(table.members.find(m => (m.id ?? m.userId ?? m.teamId) === w.id)).includes(p.user_id))?.position
    return {
      user_id: p.user_id,
      title: isWinner ? `You finished #${rank} — ${t.name}` : `League complete — ${t.name}`,
      body: isWinner ? `Congrats — you finished #${rank} on the table! Check your wallet for bonus pts.` : 'All fixtures are played. Check the final table!',
      type: isWinner ? 'tournament_champion' : 'tournament', meta: { tournament_id: t.id }, read: false,
    }
  })
  if (notifs.length) await supabase.from('notifications').insert(notifs)
  return merged
}

async function autoBuildKnockout(t, freshBd) {
  if (!freshBd?.groups) return null
  if (!isGroupStageComplete(freshBd.groups)) return null
  if (freshBd.stage === 'knockout') return null

  const teamSize = t.team_size || 1
  const advancePerGroup = freshBd.advancePerGroup || t.advance_per_group || 2
  const qualifiers = getQualifiers(freshBd.groups, advancePerGroup)
  if (qualifiers.length < 2) return null

  const knockout = buildBracket(qualifiers, teamSize)
  const merged = { ...freshBd, stage: 'knockout', ...knockout }
  const { error } = await supabase.from('tournaments').update({ bracket_data: merged }).eq('id', t.id)
  if (error) return null

  const { data: parts } = await supabase.from('tournament_participants').select('user_id').eq('tournament_id', t.id)
  const notifs = (parts || []).filter(p => p.user_id).map(p => ({
    user_id: p.user_id, title: `Knockout stage begins — ${t.name}`,
    body: 'Groups are done — check the bracket to see if you advanced!',
    type: 'tournament', meta: { tournament_id: t.id }, read: false,
  }))
  if (notifs.length) await supabase.from('notifications').insert(notifs)
  return merged
}

// ── knockout winner advancement (mirrors solo branch of adminSetSlotStatus) ──
async function applyKnockoutWinner(t, freshBd, rIdx, pIdx, slotIdx) {
  const loserIdx = slotIdx === 0 ? 1 : 0
  const currentSlot = freshBd.rounds[rIdx]?.[pIdx]?.[slotIdx]
  if (!currentSlot?.userId || currentSlot.status === 'winner') return

  const totalRounds = freshBd.rounds.length
  const isFinalRound = rIdx === totalRounds - 2
  const tName = t.name || 'the tournament'
  const actedSlot = currentSlot
  const oppositeSlot = freshBd.rounds[rIdx]?.[pIdx]?.[loserIdx]
  const hasOpp = !!(oppositeSlot?.userId && oppositeSlot.status !== 'bye' && oppositeSlot.status !== 'eliminated' && oppositeSlot.status !== 'disqualified')

  let newRounds = freshBd.rounds.map((r, ri) => {
    if (ri !== rIdx) return r
    return r.map((pair, pi) => {
      if (pi !== pIdx) return pair
      return pair.map((s, si) => {
        if (si === slotIdx) return { ...s, status: 'winner' }
        if (s?.userId && s.status !== 'bye') return { ...s, status: 'eliminated' }
        return s
      })
    })
  })

  const advanced = { ...newRounds[rIdx][pIdx][slotIdx], status: 'active' }
  const destRound = isFinalRound ? totalRounds - 1 : rIdx + 1
  const destPair  = Math.floor(pIdx / 2)
  const destSlot  = pIdx % 2
  newRounds = newRounds.map((r, ri) => {
    if (ri !== destRound) return r
    return r.map((pair, pi) => {
      if (pi !== destPair) return pair
      return pair.map((s, si) => si === destSlot ? advanced : s)
    })
  })

  const newBd = { ...freshBd, rounds: newRounds }
  const { error } = await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', t.id)
  if (error) return

  const roundName = getRoundLabelSimple(rIdx, totalRounds, freshBd.bracketSize, freshBd?.round_names)
  const { winnerPts, loserPts } = getRoundPts(rIdx, totalRounds)
  const notifRows = []
  notifRows.push({
    user_id: actedSlot.userId,
    title: isFinalRound ? `Final won — ${tName}` : `Advanced from ${roundName} — ${tName}`,
    body: isFinalRound
      ? `You defeated ${oppositeSlot?.name || 'your opponent'} in the Final! +${winnerPts} pts. Check your wallet for prize & pts details.`
      : `You beat ${oppositeSlot?.name || 'your opponent'} and advance! +${winnerPts} pts.`,
    type: isFinalRound ? 'tournament_win' : 'tournament_advance',
    meta: { tournament_id: t.id }, read: false,
  })
  if (hasOpp) {
    notifRows.push({
      user_id: oppositeSlot.userId,
      title: `Eliminated in ${roundName} — ${tName}`,
      body: `You were knocked out by ${actedSlot.name}. +${loserPts} pts for reaching this stage.`,
      type: 'tournament_eliminate', meta: { tournament_id: t.id }, read: false,
    })
  }
  if (notifRows.length) await supabase.from('notifications').insert(notifRows)

  await awardAchievement(actedSlot.userId, 'ri-sword-fill', 'First Win', 'Won your first tournament match')
  if (isFinalRound) await awardAchievement(actedSlot.userId, 'ri-trophy-fill', 'Finalist', 'Reached the Final of a tournament')

  await awardBracketPoints(t.id, actedSlot.userId, winnerPts)
  if (oppositeSlot?.userId && oppositeSlot.status !== 'bye' && oppositeSlot.userId !== actedSlot.userId) {
    await awardBracketPoints(t.id, oppositeSlot.userId, loserPts)
  }
  await Promise.all([
    supabase.rpc('log_earning', { p_user_id: actedSlot.userId, p_type: isFinalRound ? 'tournament_win' : 'tournament_advance', p_points: winnerPts, p_description: `${isFinalRound ? 'Won Final' : `Advanced from ${roundName}`} — ${tName}`, p_ref_id: t.id }),
    ...(oppositeSlot?.userId && oppositeSlot.status !== 'bye' && oppositeSlot.userId !== actedSlot.userId
      ? [supabase.rpc('log_earning', { p_user_id: oppositeSlot.userId, p_type: 'tournament_eliminate', p_points: loserPts, p_description: `Eliminated in ${roundName} — ${tName}`, p_ref_id: t.id })]
      : []),
  ])
  await recalcPositions(t.id)
}

// ── PUBLIC: submit a group/league fixture result ─────────────────────────
// `mine`/`opp` are the player's own score and their opponent's score —
// the function figures out which side (home/away) that maps to.
export async function submitGroupFixtureResult({ tournamentId, groupId, fixtureId, userId, mine, opp, file }) {
  if (!userId) return { status: 'error', message: 'Please sign in first.' }
  if (mine === '' || opp === '' || mine == null || opp == null) return { status: 'error', message: 'Enter both scores.' }

  const proofUrl = await uploadMatchProof(tournamentId, file, `${fixtureId}_${userId}`)

  const { data: t } = await supabase.from('tournaments')
    .select('id, name, slug, team_size, advance_per_group, stage_format, bracket_data')
    .eq('id', tournamentId).single()
  if (!t) return { status: 'error', message: 'Tournament not found.' }
  const freshBd = parseBracketData(t.bracket_data)
  const group = freshBd?.groups?.find(g => g.id === groupId)
  const fixture = group?.fixtures?.find(fx => fx.id === fixtureId)
  if (!group || !fixture) return { status: 'error', message: 'This fixture no longer exists.' }

  const side = myFixtureSide(group, fixture, userId)
  if (!side) return { status: 'error', message: 'You are not in this fixture.' }
  if (fixture.status === 'played') return { status: 'error', message: 'This fixture is already scored.' }
  if (isTimeUp(freshBd?.match_deadlines, fixture.id)) return { status: 'error', message: 'Time is up for your match — submissions are closed.' }

  const home = side === 'home' ? Number(mine) : Number(opp)
  const away = side === 'home' ? Number(opp) : Number(mine)
  const mineSub = { home, away, by: userId, at: new Date().toISOString(), proofUrl }
  const otherSide = side === 'home' ? 'away' : 'home'
  const existingSubs = fixture.submissions || {}
  const other = existingSubs[otherSide]
  const newSubs = { ...existingSubs, [side]: mineSub }

  const agree = other && other.home === mineSub.home && other.away === mineSub.away
  const updatedFixture = agree
    ? { ...fixture, scoreHome: mineSub.home, scoreAway: mineSub.away, status: 'played', submissions: newSubs, disputed: false }
    : { ...fixture, submissions: newSubs, disputed: !!other }

  const newGroups = freshBd.groups.map(g => g.id !== groupId ? g : { ...g, fixtures: g.fixtures.map(fx => fx.id !== fixtureId ? fx : updatedFixture) })
  let newBd = { ...freshBd, groups: newGroups }
  const { error } = await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', tournamentId)
  if (error) return { status: 'error', message: 'Could not save your result — try again.' }

  if (agree) {
    const homeMember = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fixture.homeId)
    const awayMember = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fixture.awayId)
    const homePts = mineSub.home > mineSub.away ? 3 : mineSub.home === mineSub.away ? 1 : 0
    const awayPts = mineSub.away > mineSub.home ? 3 : mineSub.away === mineSub.home ? 1 : 0
    await Promise.all([
      ...resolveMemberUserIds(homeMember).map(uid => awardBracketPoints(tournamentId, uid, homePts)),
      ...resolveMemberUserIds(awayMember).map(uid => awardBracketPoints(tournamentId, uid, awayPts)),
    ])
    if (isGroupStageComplete(newGroups)) {
      if (t.stage_format === 'league') await finalizeLeague(t, newBd)
      else await autoBuildKnockout(t, newBd)
    }
    return { status: 'confirmed', message: 'Result confirmed — both sides matched! 🎉' }
  } else if (other) {
    return { status: 'disputed', message: "Scores don't match your opponent's submission — flagged for the organiser to review." }
  }
  return { status: 'submitted', message: 'Result submitted — waiting for your opponent to confirm.' }
}

// ── PUBLIC: submit a knockout match result ────────────────────────────────
export async function submitKnockoutResult({ tournamentId, rIdx, pIdx, mySlotIdx, userId, mine, opp, file }) {
  if (!userId) return { status: 'error', message: 'Please sign in first.' }
  if (mine === '' || opp === '' || mine == null || opp == null) return { status: 'error', message: 'Enter both scores.' }

  const key = `${rIdx}-${pIdx}`
  const proofUrl = await uploadMatchProof(tournamentId, file, `${key}_${userId}`)

  const { data: t } = await supabase.from('tournaments').select('id, name, slug, bracket_data').eq('id', tournamentId).single()
  if (!t) return { status: 'error', message: 'Tournament not found.' }
  const freshBd = parseBracketData(t.bracket_data)
  const pair = freshBd?.rounds?.[rIdx]?.[pIdx]
  if (!pair) return { status: 'error', message: 'This match no longer exists.' }
  const mySlot = pair[mySlotIdx]
  const oppSlotIdx = mySlotIdx === 0 ? 1 : 0
  const oppSlot = pair[oppSlotIdx]
  if (mySlot?.userId !== userId) return { status: 'error', message: 'You are not in this match.' }
  if (mySlot?.status === 'winner' || oppSlot?.status === 'winner') return { status: 'error', message: 'This match is already decided.' }
  if (isTimeUp(freshBd?.match_deadlines, key)) return { status: 'error', message: 'Time is up for your match — submissions are closed.' }

  const a = mySlotIdx === 0 ? Number(mine) : Number(opp)
  const b = mySlotIdx === 0 ? Number(opp) : Number(mine)
  const submission = { a, b, by: userId, at: new Date().toISOString(), proofUrl }
  const oppSubmission = oppSlot?.pendingSubmission

  const newPair = pair.map((s, si) => si === mySlotIdx ? { ...s, pendingSubmission: submission } : s)
  const agree = oppSubmission && oppSubmission.a === submission.a && oppSubmission.b === submission.b
  const disputed = !!oppSubmission && !agree

  const newRounds = freshBd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((p, pi) => pi !== pIdx ? p : newPair.map(s => ({ ...s, disputed }))))
  const newBd = { ...freshBd, rounds: newRounds }
  const { error } = await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', tournamentId)
  if (error) return { status: 'error', message: 'Could not save your result — try again.' }

  if (agree) {
    if (a === b) return { status: 'tied', message: 'Scores are tied — the organiser needs to resolve this one.' }
    const winnerSlotIdx = a > b ? 0 : 1
    await applyKnockoutWinner(t, newBd, rIdx, pIdx, winnerSlotIdx)
    return { status: 'confirmed', message: 'Result confirmed — both sides matched! 🎉' }
  } else if (oppSubmission) {
    return { status: 'disputed', message: "Scores don't match your opponent's submission — flagged for the organiser to review." }
  }
  return { status: 'submitted', message: 'Result submitted — waiting for your opponent to confirm.' }
}
