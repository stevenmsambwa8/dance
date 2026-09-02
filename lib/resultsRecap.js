// lib/resultsRecap.js
//
// Shared "what just happened" logic for decided tournament matches — used
// by the full Results Rail on the tournament page (app/tournaments/[slug])
// and the lightweight Quick View sidebar on the homepage (app/page.js), so
// the phrase pools and match-picking logic live in one place instead of
// being duplicated (and drifting) across pages.
//
// Usage:
//   import { getLatestDecidedMatch, buildRecapTitle, buildRecapDesc } from '@/lib/resultsRecap'
//   const match = getLatestDecidedMatch(bracketData, participants)
//   if (match) {
//     const title = buildRecapTitle(match, t)
//     const desc  = buildRecapDesc(match, t)
//   }
//
// Phrase pools live in translations as tournaments.resultsRecap*Titles /
// *DescVariants — arrays of `{placeholder}` templates. Add more variants
// there any time; nothing here needs to change to pick them up.

// Local copy of the tournament page's round-label logic — kept separate
// (rather than imported) so this file has no dependency on the tournament
// page, and can be safely used from the homepage too.
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

function autoTeamNameFallback(entry, idx) {
  return entry?.teamName || entry?.name || `Team ${idx + 1}`
}

// Latest of two ISO timestamps (either side may be missing).
function latestAt(a, b) {
  if (!a) return b || null
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

// Deterministic pick from an array using a string seed — the same match
// always gets the same phrase (no flicker on re-render), while different
// matches spread across the whole pool instead of all saying the same thing.
function pickVariant(list, seed) {
  if (!Array.isArray(list) || !list.length) return null
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return list[h % list.length]
}

function fillTemplate(tmpl, vars) {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v ?? ''), tmpl)
}

// Collects every decided match (knockout + league/group) into flat cards.
// `participants` is optional — needed only to resolve solo-knockout
// usernames/avatars from profiles; without it, falls back to whatever name
// is stored on the bracket slot itself (fine for a lightweight teaser).
export function collectDecidedMatches(bracketData, participants = []) {
  const cards = []

  if (bracketData?.rounds) {
    const isTeam = !!bracketData.isTeamBattle
    const totalRounds = bracketData.rounds.length

    bracketData.rounds.slice(0, totalRounds - 1).forEach((pairs, rIdx) => {
      const roundLabel = getRoundLabelSimple(rIdx, totalRounds, bracketData.bracketSize, bracketData?.round_names)
      pairs.forEach((pair, pIdx) => {
        const [a, b] = pair || []
        if (!a || !b) return
        const aWon = a.status === 'winner'
        const bWon = b.status === 'winner'
        if (!aWon && !bWon) return
        const winner = aWon ? a : b
        const loser = aWon ? b : a
        if (winner?.status === 'bye' || loser?.status === 'bye') return

        if (isTeam) {
          const wReal = (winner.members || []).find(m => m?.userId && m.avatar)
          const lReal = (loser.members || []).find(m => m?.userId && m.avatar)
          if (!(winner.members || []).some(m => m?.userId) || !(loser.members || []).some(m => m?.userId)) return
          cards.push({
            key: `ko-${rIdx}-${pIdx}`, roundLabel,
            leftName: autoTeamNameFallback(winner, pIdx * 2 + (aWon ? 0 : 1)), leftAvatar: wReal?.avatar || null, leftWon: true,
            rightName: autoTeamNameFallback(loser, pIdx * 2 + (aWon ? 1 : 0)), rightAvatar: lReal?.avatar || null, rightWon: false,
            score: null, draw: false, submittedAt: null,
          })
        } else {
          if (!winner?.userId || !loser?.userId) return
          const wProfile = participants.find(x => x.user_id === winner.userId)?.profiles
          const lProfile = participants.find(x => x.user_id === loser.userId)?.profiles
          const sub = winner.pendingSubmission
          const score = sub && typeof sub.a === 'number' && typeof sub.b === 'number' && sub.a !== sub.b
            ? `${aWon ? sub.a : sub.b}–${aWon ? sub.b : sub.a}`
            : null
          cards.push({
            key: `ko-${rIdx}-${pIdx}`, roundLabel,
            leftName: wProfile?.username || winner.name || 'Player', leftAvatar: wProfile?.avatar_url || winner.avatar || null, leftWon: true,
            rightName: lProfile?.username || loser.name || 'Player', rightAvatar: lProfile?.avatar_url || loser.avatar || null, rightWon: false,
            score, draw: false, submittedAt: latestAt(winner.pendingSubmission?.at, loser.pendingSubmission?.at),
          })
        }
      })
    })
  }

  if (bracketData?.groups) {
    bracketData.groups.forEach(group => {
      (group.fixtures || []).forEach(fx => {
        if (fx.status !== 'played' || fx.scoreHome == null || fx.scoreAway == null) return
        const home = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.homeId)
        const away = group.members.find(m => (m.id ?? m.userId ?? m.teamId) === fx.awayId)
        if (!home || !away) return
        const draw = fx.scoreHome === fx.scoreAway
        cards.push({
          key: `fx-${fx.id}`, roundLabel: group.name || 'League',
          leftName: home.name || 'Player', leftAvatar: home.avatar || home.players?.[0]?.avatar || null,
          leftWon: !draw && fx.scoreHome > fx.scoreAway,
          rightName: away.name || 'Player', rightAvatar: away.avatar || away.players?.[0]?.avatar || null,
          rightWon: !draw && fx.scoreAway > fx.scoreHome,
          score: `${fx.scoreHome}–${fx.scoreAway}`, draw,
          submittedAt: latestAt(fx.submissions?.home?.at, fx.submissions?.away?.at),
        })
      })
    })
  }

  return cards
}

// All decided matches, most recent first (real submission timestamp where
// available; older data with no timestamp keeps its structural order,
// tacked on after the timestamped ones).
export function orderDecidedMatches(bracketData, participants = []) {
  const cards = collectDecidedMatches(bracketData, participants)
  return cards
    .map((card, i) => ({ card, sortKey: card.submittedAt ? new Date(card.submittedAt).getTime() : -i }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(x => x.card)
}

// Just the most recent one — what a compact teaser (e.g. the homepage
// sidebar) wants instead of a whole rail.
export function getLatestDecidedMatch(bracketData, participants = []) {
  return orderDecidedMatches(bracketData, participants)[0] || null
}

// Builds the street-tone title for a decided match, picking from the
// translated phrase pool (tournaments.resultsRecapWinTitles /
// resultsRecapDrawTitles) so each language has its own idioms rather than
// a literal translation of the English slang.
export function buildRecapTitle(card, t) {
  const seed = card.key || `${card.leftName}-${card.rightName}`
  if (card.draw) {
    const tmpl = pickVariant(t('tournaments.resultsRecapDrawTitles'), seed) || '{left} & {right} split it'
    return fillTemplate(tmpl, { left: card.leftName, right: card.rightName })
  }
  const winner = card.leftWon ? card.leftName : card.rightName
  const tmpl = pickVariant(t('tournaments.resultsRecapWinTitles'), seed) || '{winner} takes the dub'
  return fillTemplate(tmpl, { winner })
}

// Builds the street-tone description for a decided match, same phrase-pool
// approach as buildRecapTitle.
export function buildRecapDesc(card, t) {
  const seed = card.key || `${card.leftName}-${card.rightName}`
  const winner = card.leftWon ? card.leftName : card.rightName
  const loser = card.leftWon ? card.rightName : card.leftName
  const round = card.roundLabel || ''

  if (card.draw) {
    const tmpl = pickVariant(t('tournaments.resultsRecapDrawDescVariants'), seed)
      || "{left} and {right} went blow for blow in {round} and couldn't be split — {score}, nobody blinked."
    return fillTemplate(tmpl, { left: card.leftName, right: card.rightName, round, score: card.score || 'level' })
  }
  if (card.score) {
    const tmpl = pickVariant(t('tournaments.resultsRecapWinDescScoreVariants'), seed)
      || "{winner} came through and dropped {loser} {score} in {round}. No cap, that's a statement — table's heating up."
    return fillTemplate(tmpl, { winner, loser, score: card.score, round })
  }
  const tmpl = pickVariant(t('tournaments.resultsRecapWinDescNoScoreVariants'), seed)
    || '{winner} got the job done against {loser} in {round} — straight business, no drama.'
  return fillTemplate(tmpl, { winner, loser, round })
}
