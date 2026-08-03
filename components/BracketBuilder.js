'use client'
/**
 * BracketBuilder — completely free-form bracket editor
 *
 * Creator controls EVERYTHING:
 *  - Add named rounds in any order (type the name yourself)
 *  - Add/remove matches per round
 *  - Rename any squad/slot inline
 *  - Drag any slot to swap with any other slot
 *  - Assign registered players to slots
 *  - Mark slots as BYE
 *
 * Exports:
 *   default              BracketBuilder
 *   buildEmptyBracket    (roundMatchCounts[], teamSize) → bracketData
 */

import { useState, useRef, useEffect } from 'react'

// ── time helpers ────────────────────────────────────────────────────────────
// Convert an ISO string to the "YYYY-MM-DDTHH:mm" format <input type="datetime-local"> expects.
function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}
function formatDuration(ms) {
  if (ms == null) return ''
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  const pad = n => String(n).padStart(2, '0')
  return days > 0 ? `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}` : `${pad(hours)}:${pad(mins)}:${pad(secs)}`
}

// Each match gets its own random kickoff time between 14:00–23:00 local
// time on the chosen day (not one shared timer for the whole round).
const MATCH_WINDOW_START_HOUR = 14
const MATCH_WINDOW_END_HOUR   = 23
const MATCH_DURATION_MIN      = 30 // minutes a player has, after kickoff, to submit their result

function randomMatchTime(dateStr) {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date()
  base.setHours(0, 0, 0, 0)
  const windowStartMin = MATCH_WINDOW_START_HOUR * 60
  const windowEndMin = Math.max(MATCH_WINDOW_END_HOUR * 60 - MATCH_DURATION_MIN, windowStartMin)
  const span = windowEndMin - windowStartMin
  const offsetMin = windowStartMin + Math.floor(Math.random() * (span + 1))
  const start = new Date(base.getTime() + offsetMin * 60000)
  const end = new Date(start.getTime() + MATCH_DURATION_MIN * 60000)
  return { start: start.toISOString(), end: end.toISOString() }
}

function formatClockTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function todayLocalDate() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

// ── public helper ──────────────────────────────────────────────────────────────
export function buildEmptyBracket(roundMatchCounts = [8, 4, 2, 1], teamSize = 1) {
  const mkOpen = (idx) =>
    teamSize > 1
      ? { teamId: `squad_${idx}`, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
      : { slotId: `slot_${idx}`, userId: null, name: 'Open', avatar: null, status: 'open' }
  const mkPend = () =>
    teamSize > 1
      ? { teamId: null, teamName: null, status: 'pending', members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })) }
      : { slotId: null, userId: null, name: '?', avatar: null, status: 'pending' }

  let counter = 0
  const rounds = roundMatchCounts.map((count, rIdx) =>
    Array.from({ length: count }, () =>
      rIdx === 0 ? [mkOpen(counter++), mkOpen(counter++)] : [mkPend(), mkPend()]
    )
  )
  return { rounds, isEmpty: true, teamSize, isTeamBattle: teamSize > 1 }
}

// ── default round name based on position from end ──────────────────────────────
function defaultRoundName(rIdx, total) {
  const fromEnd = (total - 1) - rIdx
  if (fromEnd === 0) return 'Champion'
  if (fromEnd === 1) return 'Final'
  if (fromEnd === 2) return 'Semi Final'
  if (fromEnd === 3) return 'Quarter Final'
  const slots = (total - rIdx) > 1 ? Math.pow(2, total - rIdx) : ''
  return slots ? `Round of ${slots}` : `Round ${rIdx + 1}`
}

// ── display label for a slot ───────────────────────────────────────────────────
function slotLabel(slot, teamSize, globalIdx) {
  if (!slot) return 'BYE'
  if (teamSize > 1) {
    if (slot.teamName) return slot.teamName
    const real = (slot.members || []).filter(m => m?.userId && !['Open','?','BYE','—'].includes(m.name))
    if (real.length) return real.map(m => m.name.slice(0, 3)).join('').slice(0, 10)
    if (slot.teamId?.match(/\d+$/)) return `Squad ${parseInt(slot.teamId.match(/\d+$/)[0]) + 1}`
    return `Squad ${globalIdx + 1}`
  }
  if (slot.status === 'bye') return 'BYE'
  if (slot.status === 'pending') return '?'
  if (slot.userId) return slot.name || 'Player'
  return 'Open'
}

// ── PRESET shapes ─────────────────────────────────────────────────────────────
const PRESETS = [
  { label: 'Round of 4',  counts: [2, 1],              desc: '2 matches → Final' },
  { label: 'Round of 8',  counts: [4, 2, 1],           desc: 'QF → SF → Final' },
  { label: 'Round of 16', counts: [8, 4, 2, 1],        desc: 'R16 → QF → SF → Final' },
  { label: 'Round of 32', counts: [16, 8, 4, 2, 1],    desc: 'R32 → QF → SF → Final' },
  { label: 'Round of 64', counts: [32, 16, 8, 4, 2, 1],desc: 'R64 → … → Final' },
]

// ─────────────────────────────────────────────────────────────────────────────
export default function BracketBuilder({
  bracketData,
  onChange,
  onSave,
  participants = [],
  teamSize = 1,
  saving = false,
  manageMode = false,
}) {
  const isTeam = teamSize > 1

  // local working copy
  const [bd, setBd]               = useState(() => bracketData ? JSON.parse(JSON.stringify(bracketData)) : null)
  const [names, setNames]         = useState(() => {
    const n = bracketData?.rounds?.length || 0
    return Array.from({ length: n }, (_, i) => defaultRoundName(i, n))
  })
  const [dirty, setDirty]         = useState(false)
  const [phase, setPhase]         = useState(bracketData ? 'edit' : 'shape')  // 'shape' | 'edit'

  // per-match kickoff deadlines — { [`${rIdx}-${pIdx}`]: { start: isoString, end: isoString } }
  // Each match is randomly assigned its own time between 14:00–23:00 on a
  // chosen matchday date — not one shared timer for the whole round.
  const [deadlines, setDeadlines] = useState(() => bracketData?.match_deadlines || {})
  const [editTimer, setEditTimer] = useState(null)   // rIdx whose timer panel is open
  const [matchDate, setMatchDate] = useState({})     // { [rIdx]: "YYYY-MM-DD" } — date picked before randomizing
  const [now, setNow]             = useState(() => Date.now())

  // tick every second so countdowns stay live
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  // custom round builder (shape picker)
  const [customRounds, setCustomRounds]   = useState([])        // array of { name, matches }
  const [newRoundName, setNewRoundName]   = useState('')
  const [newRoundMatches, setNewRoundMatches] = useState(8)

  // inline editing
  const [editSlot,  setEditSlot]  = useState(null)   // {rIdx,pIdx,sIdx}
  const [editVal,   setEditVal]   = useState('')
  const [editRound, setEditRound] = useState(null)   // rIdx
  const [assignAt,  setAssignAt]  = useState(null)   // {rIdx,pIdx,sIdx}

  // drag
  const drag = useRef(null)

  // colours
  const ACC  = '#6366f1'
  const GRN  = '#22c55e'
  const RED  = '#ef4444'
  const MUT  = 'var(--text-muted, #9ca3af)'
  const SURF = 'var(--surface, #f8f9fa)'
  const BRD  = 'var(--border, #e5e7eb)'
  const TXT  = 'var(--text, #111)'
  const BG   = 'var(--bg, #fff)'

  // ── commit ───────────────────────────────────────────────────────────────
  // Always embeds round_names and slot_count into bracketData so they persist
  // to the DB with the bracket and don't need a separate column read path.
  function commit(newBd, newNames, newDeadlines) {
    const resolvedNames = newNames ?? names
    const resolvedDeadlines = newDeadlines ?? deadlines
    setBd(newBd)
    if (newNames) setNames(newNames)
    if (newDeadlines) setDeadlines(newDeadlines)
    setDirty(true)
    // Count real open slots from round 0 (non-BYE, non-pending)
    const slotCount = (() => {
      const r0 = newBd?.rounds?.[0] ?? []
      if (teamSize > 1) {
        // Each open team counts as teamSize slots
        return r0.reduce((acc, pair) => {
          return acc + pair.filter(t => t && t.status !== 'bye' && t.status !== 'inactive').length * teamSize
        }, 0)
      }
      return r0.reduce((acc, pair) => {
        return acc + pair.filter(s => s && s.status !== 'bye').length
      }, 0)
    })()
    const enriched = { ...newBd, round_names: resolvedNames, match_deadlines: resolvedDeadlines, slot_count: slotCount }
    onChange?.(enriched)
  }

  // ── per-match kickoff times ─────────────────────────────────────────────
  // Real (non-BYE, non-champion) match pairs in a round — the ones that
  // actually need an assigned kickoff time.
  function realMatchPairIdxs(rIdx) {
    const roundPairs = bd?.rounds?.[rIdx] || []
    return roundPairs
      .map((pair, pIdx) => ({ pair, pIdx }))
      .filter(({ pair }) => pair.length === 2 && pair[0] && pair[1] && pair[0].status !== 'bye' && pair[1].status !== 'bye')
      .map(({ pIdx }) => pIdx)
  }

  function randomizeRoundTimes(rIdx) {
    if (!bd) return
    const isChampionRound = rIdx === bd.rounds.length - 1
    if (isChampionRound) return
    const pIdxs = realMatchPairIdxs(rIdx)
    if (!pIdxs.length) return
    const dateStr = matchDate[rIdx] || todayLocalDate()
    const next = { ...deadlines }
    pIdxs.forEach(pIdx => { next[`${rIdx}-${pIdx}`] = randomMatchTime(dateStr) })
    commit(bd, names, next)
  }

  function clearRoundTimes(rIdx) {
    if (!bd) return
    const roundPairs = bd.rounds[rIdx] || []
    const next = { ...deadlines }
    roundPairs.forEach((_, pIdx) => delete next[`${rIdx}-${pIdx}`])
    commit(bd, names, next)
  }

  // Returns null (no timer set) or { phase: 'upcoming'|'live'|'live-noend'|'over', ms }
  function getMatchTimeStatus(rIdx, pIdx) {
    const rt = deadlines[`${rIdx}-${pIdx}`]
    if (!rt || (!rt.start && !rt.end)) return null
    const startMs = rt.start ? new Date(rt.start).getTime() : null
    const endMs   = rt.end   ? new Date(rt.end).getTime()   : null
    if (startMs && now < startMs) return { phase: 'upcoming', ms: startMs - now }
    if (endMs && now < endMs)     return { phase: 'live', ms: endMs - now }
    if (endMs && now >= endMs)    return { phase: 'over', ms: 0 }
    if (startMs && now >= startMs && !endMs) return { phase: 'live-noend', ms: null }
    return null
  }

  // ── shape picker helpers ──────────────────────────────────────────────────
  function applyPreset(counts) {
    const n = counts.length
    const fresh = buildEmptyBracket(counts, teamSize)
    const ns = Array.from({ length: n }, (_, i) => defaultRoundName(i, n))
    commit(fresh, ns, {})
    setPhase('edit')
  }

  function addCustomRound() {
    const name = newRoundName.trim() || `Round ${customRounds.length + 1}`
    setCustomRounds(prev => [...prev, { name, matches: newRoundMatches }])
    setNewRoundName('')
    setNewRoundMatches(Math.max(1, Math.floor(newRoundMatches / 2)))
  }

  function removeCustomRound(i) {
    setCustomRounds(prev => prev.filter((_, idx) => idx !== i))
  }

  function applyCustom() {
    if (customRounds.length === 0) return
    const counts = customRounds.map(r => r.matches)
    const fresh = buildEmptyBracket(counts, teamSize)
    const ns = customRounds.map(r => r.name)
    commit(fresh, ns, {})
    setPhase('edit')
  }

  // ── structure controls ────────────────────────────────────────────────────
  function addRoundAtStart() {
    if (!bd) return
    const count = (bd.rounds[0]?.length || 1) * 2
    const mkOpen = (idx) => isTeam
      ? { teamId: `squad_new_${Date.now()}_${idx}`, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
      : { slotId: `new_${Date.now()}_${idx}`, userId: null, name: 'Open', avatar: null, status: 'open' }
    const pairs = Array.from({ length: count }, (_, i) => [mkOpen(i * 2), mkOpen(i * 2 + 1)])
    const newRounds = [pairs, ...bd.rounds]
    const total = newRounds.length
    const newNames = [defaultRoundName(0, total), ...names]
    // shift every existing match's deadline round-index up by one to match the new round order
    const newDeadlines = {}
    Object.entries(deadlines).forEach(([k, v]) => {
      const [ri, pi] = k.split('-')
      newDeadlines[`${Number(ri) + 1}-${pi}`] = v
    })
    commit({ ...bd, rounds: newRounds }, newNames, newDeadlines)
  }

  function addRoundAtEnd() {
    if (!bd) return
    const mkPend = () => isTeam
      ? { teamId: null, teamName: null, status: 'pending', members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })) }
      : { userId: null, name: '?', avatar: null, status: 'pending' }
    const newRounds = [...bd.rounds, [[mkPend(), mkPend()]]]
    const newNames  = [...names, defaultRoundName(newRounds.length - 1, newRounds.length)]
    commit({ ...bd, rounds: newRounds }, newNames)
  }

  function removeRound(rIdx) {
    if (!bd || bd.rounds.length <= 1) return
    const newRounds = bd.rounds.filter((_, i) => i !== rIdx)
    const newNames  = names.filter((_, i) => i !== rIdx)
    const newDeadlines = {}
    Object.entries(deadlines).forEach(([k, v]) => {
      const [ri, pi] = k.split('-')
      const kri = Number(ri)
      if (kri === rIdx) return
      newDeadlines[`${kri > rIdx ? kri - 1 : kri}-${pi}`] = v
    })
    commit({ ...bd, rounds: newRounds }, newNames, newDeadlines)
  }

  function addMatch(rIdx) {
    if (!bd) return
    const mkOpen = (idx) => isTeam
      ? { teamId: `squad_add_${Date.now()}_${idx}`, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
      : { slotId: `add_${Date.now()}_${idx}`, userId: null, name: 'Open', avatar: null, status: 'open' }
    const newRounds = bd.rounds.map((r, i) => i !== rIdx ? r : [...r, [mkOpen(0), mkOpen(1)]])
    commit({ ...bd, rounds: newRounds })
  }

  function removeMatch(rIdx, pIdx) {
    if (!bd) return
    const newRounds = bd.rounds.map((r, i) => i !== rIdx ? r : r.filter((_, pi) => pi !== pIdx))
    const newDeadlines = {}
    Object.entries(deadlines).forEach(([k, v]) => {
      const [ri, pi] = k.split('-')
      const kri = Number(ri), kpi = Number(pi)
      if (kri !== rIdx) { newDeadlines[k] = v; return }
      if (kpi === pIdx) return
      newDeadlines[`${kri}-${kpi > pIdx ? kpi - 1 : kpi}`] = v
    })
    commit({ ...bd, rounds: newRounds }, names, newDeadlines)
  }

  // ── slot rename ───────────────────────────────────────────────────────────
  function startRename(rIdx, pIdx, sIdx) {
    const slot = bd?.rounds[rIdx]?.[pIdx]?.[sIdx]
    if (!slot) return
    const cur = isTeam ? (slot.teamName || slotLabel(slot, teamSize, pIdx * 2 + sIdx)) : (slot.name || '')
    setEditSlot({ rIdx, pIdx, sIdx }); setEditVal(cur)
  }

  function commitRename() {
    if (!editSlot || !bd) return
    const { rIdx, pIdx, sIdx } = editSlot
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx || !slot) return slot
      return isTeam ? { ...slot, teamName: editVal.trim() || null } : { ...slot, name: editVal.trim() || 'Open' }
    })))
    commit({ ...bd, rounds: newRounds })
    setEditSlot(null); setEditVal('')
  }

  // ── drag & drop ───────────────────────────────────────────────────────────
  function onDragStart(e, rIdx, pIdx, sIdx) { drag.current = { rIdx, pIdx, sIdx }; e.dataTransfer.effectAllowed = 'move' }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  function onDrop(e, rIdx, pIdx, sIdx) {
    e.preventDefault()
    const from = drag.current; drag.current = null
    if (!from || !bd) return
    if (from.rIdx === rIdx && from.pIdx === pIdx && from.sIdx === sIdx) return
    const A = bd.rounds[from.rIdx]?.[from.pIdx]?.[from.sIdx]
    const B = bd.rounds[rIdx]?.[pIdx]?.[sIdx]
    const newRounds = bd.rounds.map((r, ri) => r.map((pair, pi) => pair.map((slot, si) => {
      if (ri === from.rIdx && pi === from.pIdx && si === from.sIdx) return B ?? slot
      if (ri === rIdx      && pi === pIdx      && si === sIdx)      return A ?? slot
      return slot
    })))
    commit({ ...bd, rounds: newRounds })
  }

  // ── assign & clear ────────────────────────────────────────────────────────
  const placedIds = new Set()
  bd?.rounds?.forEach(r => r.forEach(pair => pair.forEach(slot => {
    if (!slot) return
    if (isTeam) (slot.members || []).forEach(m => { if (m?.userId) placedIds.add(m.userId) })
    else if (slot.userId) placedIds.add(slot.userId)
  })))
  const available = participants.filter(p => !placedIds.has(p.user_id))

  function assignPlayer(p) {
    if (!assignAt || !bd) return
    const { rIdx, pIdx, sIdx } = assignAt
    const ps = { userId: p.user_id, name: p.profiles?.username || 'Player', avatar: p.profiles?.avatar_url || null, status: 'active' }
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx) return slot
      if (isTeam) {
        const nm = [...(slot?.members || [])]
        const mi = nm.findIndex(m => !m?.userId || m.status === 'open')
        if (mi !== -1) nm[mi] = { ...ps }
        return { ...slot, members: nm, status: nm.every(m => m?.userId) ? 'active' : 'open' }
      }
      return ps
    })))
    commit({ ...bd, rounds: newRounds })
    setAssignAt(null)
  }

  function clearSlot(rIdx, pIdx, sIdx) {
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx) return slot
      return isTeam
        ? { ...slot, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
        : { ...slot, userId: null, name: 'Open', avatar: null, status: 'open' }
    })))
    commit({ ...bd, rounds: newRounds })
  }

  function toggleBye(rIdx, pIdx, sIdx) {
    const slot = bd?.rounds[rIdx]?.[pIdx]?.[sIdx]
    const was = slot?.status === 'bye'
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx) return slot
      if (was) return isTeam
        ? { ...slot, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
        : { ...slot, userId: null, name: 'Open', avatar: null, status: 'open' }
      return isTeam
        ? { ...slot, teamName: 'BYE', status: 'bye', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'BYE', avatar: null, status: 'bye' })) }
        : { userId: null, name: 'BYE', avatar: null, status: 'bye' }
    })))
    commit({ ...bd, rounds: newRounds })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE: shape picker
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'shape') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: MUT, fontWeight: 500 }}>
          Pick a starting shape — or build your own round by round below.
        </p>

        {/* Quick presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => applyPreset(p.counts)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 11, border: `1.5px solid ${BRD}`, background: SURF, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
              <i className="ri-node-tree" style={{ color: ACC, fontSize: 18, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: TXT }}>{p.label}</div>
                <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{p.counts.join(' → ')} matches &nbsp;·&nbsp; {p.desc}</div>
              </div>
              <i className="ri-arrow-right-s-line" style={{ color: MUT, fontSize: 16 }} />
            </button>
          ))}
        </div>

        {/* Custom round-by-round builder */}
        <div style={{ padding: '14px', borderRadius: 12, border: `1.5px dashed ${BRD}`, background: SURF, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: TXT }}>
            <i className="ri-settings-3-line" style={{ color: ACC, marginRight: 6 }} />Build round by round
          </div>
          <p style={{ margin: 0, fontSize: 12, color: MUT }}>
            Add each round with a custom name and match count. Order goes from first round to last.
          </p>

          {/* Added rounds list */}
          {customRounds.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {customRounds.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: BG, border: `1px solid ${BRD}` }}>
                  <i className="ri-node-tree" style={{ color: ACC, fontSize: 13, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: TXT }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: MUT, background: ACC + '15', borderRadius: 5, padding: '2px 7px', fontWeight: 700 }}>{r.matches} matches</span>
                  <button onClick={() => removeCustomRound(i)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>
                    <i className="ri-close-line" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add a round */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 0.4 }}>Round name</span>
              <input
                type="text" value={newRoundName} placeholder={`e.g. ${customRounds.length === 0 ? 'Round of 32' : customRounds.length === 1 ? 'Quarter Final' : customRounds.length === 2 ? 'Semi Final' : 'Final'}`}
                onChange={e => setNewRoundName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomRound()}
                style={{ padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${BRD}`, fontSize: 12, fontWeight: 600, color: TXT, background: BG, outline: 'none' }}
              />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 0.4 }}>Matches</span>
              <input
                type="number" min="1" max="64" value={newRoundMatches}
                onChange={e => setNewRoundMatches(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${BRD}`, fontSize: 13, fontWeight: 800, color: ACC, background: BG, outline: 'none', width: '100%' }}
              />
            </div>
            <button onClick={addCustomRound} style={{ padding: '8px 14px', borderRadius: 8, background: ACC, color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer', flexShrink: 0, height: 36 }}>
              + Add
            </button>
          </div>

          {customRounds.length > 0 && (
            <button onClick={applyCustom} style={{ padding: '10px', borderRadius: 8, background: GRN, color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              <i className="ri-check-line" /> Build This Bracket ({customRounds.length} rounds · {customRounds[0]?.matches * 2} slots)
            </button>
          )}
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE: editor
  // ══════════════════════════════════════════════════════════════════════════
  const totalSlots = bd?.rounds?.[0]?.reduce((a, pair) => a + pair.filter(s => s && s.status !== 'bye').length, 0) ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <style>{`@keyframes bbTimeUpPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } } .bb-timeup { animation: bbTimeUpPulse 1.3s ease-in-out infinite; }`}</style>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 12px', flexWrap: 'wrap' }}>
        <button onClick={addRoundAtStart} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 11px', borderRadius: 8, border: `1.5px solid ${BRD}`, background: SURF, fontSize: 12, fontWeight: 700, color: ACC, cursor: 'pointer' }}>
          <i className="ri-skip-back-line" /> + Earlier Round
        </button>
        <button onClick={addRoundAtEnd} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 11px', borderRadius: 8, border: `1.5px solid ${BRD}`, background: SURF, fontSize: 12, fontWeight: 700, color: ACC, cursor: 'pointer' }}>
          + Later Round <i className="ri-skip-forward-line" />
        </button>
        <button onClick={() => setPhase('shape')} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 11px', borderRadius: 8, border: `1.5px dashed ${BRD}`, background: 'transparent', fontSize: 12, fontWeight: 700, color: MUT, cursor: 'pointer' }}>
          <i className="ri-refresh-line" /> Change Shape
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: MUT, fontWeight: 600 }}>
          <i className="ri-node-tree" style={{ marginRight: 4 }} />{bd?.rounds?.length} rounds · {totalSlots} slots
        </div>
        {manageMode && onSave && (
          <button onClick={() => { onSave(bd); setDirty(false) }} disabled={saving || !dirty} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: dirty ? ACC : BRD, color: dirty ? '#fff' : MUT, border: 'none', fontSize: 13, fontWeight: 800, cursor: dirty ? 'pointer' : 'default', transition: 'all 0.15s' }}>
            {saving ? <><i className="ri-loader-4-line" /> Saving…</> : <><i className="ri-save-line" /> {dirty ? 'Save Bracket' : 'Saved'}</>}
          </button>
        )}
      </div>

      {/* Rounds */}
      <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 'max-content' }}>
          {bd?.rounds.map((pairs, rIdx) => (
            <div key={rIdx} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>

              {/* Round header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {editRound === rIdx ? (
                  <input autoFocus value={names[rIdx] || ''} onChange={e => setNames(n => n.map((v, i) => i === rIdx ? e.target.value : v))}
                    onBlur={() => { setEditRound(null); if (bd) commit(bd, names) }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { setEditRound(null); if (bd) commit(bd, names) } }}
                    style={{ flex: 1, fontSize: 11, fontWeight: 800, color: ACC, background: 'transparent', border: 'none', outline: `1px solid ${ACC}`, borderRadius: 4, padding: '2px 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}
                  />
                ) : (
                  <span onClick={() => setEditRound(rIdx)} title="Tap to rename" style={{ flex: 1, fontSize: 11, fontWeight: 800, color: ACC, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'text', padding: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {names[rIdx] || `Round ${rIdx + 1}`}
                  </span>
                )}
                <button onClick={() => setEditTimer(editTimer === rIdx ? null : rIdx)} title="Assign per-player kickoff times"
                  style={{ background: 'none', border: 'none', color: realMatchPairIdxs(rIdx).some(pIdx => deadlines[`${rIdx}-${pIdx}`]) ? ACC : MUT, cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>
                  <i className="ri-time-line" />
                </button>
                <button onClick={() => addMatch(rIdx)} title="Add match" style={{ background: 'none', border: 'none', color: GRN, cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1 }}><i className="ri-add-circle-line" /></button>
                <button onClick={() => removeRound(rIdx)} title="Remove round" style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, opacity: 0.5 }}><i className="ri-close-circle-line" /></button>
              </div>

              {/* Kickoff-time summary badge */}
              {(() => {
                if (rIdx === bd?.rounds?.length - 1) return null // champion round has no match to time
                const pIdxs = realMatchPairIdxs(rIdx)
                if (!pIdxs.length) return null
                const assigned = pIdxs.filter(pIdx => deadlines[`${rIdx}-${pIdx}`]).length
                if (assigned === 0) return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 7, background: SURF, border: `1px dashed ${BRD}`, fontSize: 10, fontWeight: 800, color: MUT }}>
                    <i className="ri-time-line" /> No kickoff times set
                  </div>
                )
                const anyOver = pIdxs.some(pIdx => getMatchTimeStatus(rIdx, pIdx)?.phase === 'over')
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 7, background: (anyOver ? RED : ACC) + '15', border: `1px solid ${(anyOver ? RED : ACC)}40`, fontSize: 10, fontWeight: 800, color: anyOver ? RED : ACC }}>
                    <i className={anyOver ? 'ri-alarm-warning-fill' : 'ri-timer-flash-line'} /> {assigned}/{pIdxs.length} kickoff times set{anyOver ? ' · some expired' : ''}
                  </div>
                )
              })()}

              {/* Timer editor panel */}
              {editTimer === rIdx && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 8, border: `1.5px dashed ${BRD}`, background: SURF }}>
                  <div style={{ fontSize: 10, color: MUT, lineHeight: 1.4 }}>
                    Each match gets its own random kickoff time between 14:00–23:00 on the day below — not one shared timer for the round.
                  </div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: MUT }}>
                    Matchday date
                    <input type="date" value={matchDate[rIdx] || todayLocalDate()} onChange={e => setMatchDate(m => ({ ...m, [rIdx]: e.target.value }))}
                      style={{ display: 'block', width: '100%', marginTop: 3, padding: '6px 8px', borderRadius: 6, border: `1px solid ${BRD}`, fontSize: 11, background: BG, color: TXT }} />
                  </label>
                  <div style={{ display: 'flex', gap: 10, marginTop: 2, alignItems: 'center' }}>
                    <button onClick={() => randomizeRoundTimes(rIdx)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7, border: 'none', background: ACC, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                      <i className="ri-shuffle-line" /> Randomize kickoff times
                    </button>
                    {realMatchPairIdxs(rIdx).some(pIdx => deadlines[`${rIdx}-${pIdx}`]) && (
                      <button onClick={() => clearRoundTimes(rIdx)} style={{ background: 'none', border: 'none', color: RED, fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                        <i className="ri-close-circle-line" /> Clear
                      </button>
                    )}
                    <button onClick={() => setEditTimer(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: ACC, fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                      Done
                    </button>
                  </div>
                  {/* Assigned times, one per match */}
                  {realMatchPairIdxs(rIdx).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {realMatchPairIdxs(rIdx).map(pIdx => {
                        const rt = deadlines[`${rIdx}-${pIdx}`]
                        return (
                          <div key={pIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: rt ? TXT : MUT }}>
                            <span>Match {pIdx + 1}</span>
                            <span style={{ fontWeight: 700 }}>{rt ? `Kicks off ${formatClockTime(rt.start)}` : 'Not set'}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Match pairs */}
              {pairs.map((pair, pIdx) => (
                <div key={pIdx} style={{ background: SURF, borderRadius: 10, border: `1.5px solid ${BRD}`, overflow: 'visible', position: 'relative' }}>
                  {pairs.length > 1 && (
                    <button onClick={() => removeMatch(rIdx, pIdx)} style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', background: RED, border: 'none', color: '#fff', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
                      <i className="ri-close-line" />
                    </button>
                  )}

                  {deadlines[`${rIdx}-${pIdx}`] && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 9.5, fontWeight: 800, color: getMatchTimeStatus(rIdx, pIdx)?.phase === 'over' ? RED : ACC, borderBottom: `1px solid ${BRD}` }}>
                      <i className="ri-time-line" /> Kicks off {formatClockTime(deadlines[`${rIdx}-${pIdx}`].start)}
                    </div>
                  )}

                  {pair.map((slot, sIdx) => {
                    if (slot === null) return null
                    const isPend  = slot?.status === 'pending'
                    const isBye   = slot?.status === 'bye'
                    const hasData = isTeam ? slot?.members?.some(m => m?.userId) : !!slot?.userId
                    const label   = slotLabel(slot, teamSize, pIdx * 2 + sIdx)
                    const isRen   = editSlot?.rIdx === rIdx && editSlot?.pIdx === pIdx && editSlot?.sIdx === sIdx
                    const isAsgn  = assignAt?.rIdx === rIdx && assignAt?.pIdx === pIdx && assignAt?.sIdx === sIdx
                    const dot     = isBye ? MUT : isPend ? BRD : hasData ? ACC : GRN

                    return (
                      <div key={sIdx}>
                        <div
                          draggable={!isPend}
                          onDragStart={e => onDragStart(e, rIdx, pIdx, sIdx)}
                          onDragOver={onDragOver}
                          onDrop={e => onDrop(e, rIdx, pIdx, sIdx)}
                          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', borderTop: sIdx > 0 ? `1px solid ${BRD}` : undefined, background: isBye ? '#00000006' : 'transparent', cursor: isPend ? 'default' : 'grab', minHeight: 38 }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />

                          {isRen ? (
                            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
                              onBlur={commitRename} onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditSlot(null); setEditVal('') } }}
                              style={{ flex: 1, fontSize: 12, fontWeight: 700, border: 'none', outline: 'none', background: 'transparent', color: TXT }}
                            />
                          ) : (
                            <span onClick={() => !isPend && startRename(rIdx, pIdx, sIdx)} title={isPend ? '' : 'Tap to rename'}
                              style={{ flex: 1, fontSize: 12, fontWeight: isPend || isBye ? 400 : 700, color: isPend || isBye ? MUT : TXT, cursor: isPend ? 'default' : 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {label}
                            </span>
                          )}

                          {!isPend && (
                            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                              {participants.length > 0 && !isBye && (
                                <button onClick={() => setAssignAt(isAsgn ? null : { rIdx, pIdx, sIdx })} style={{ background: isAsgn ? ACC : 'none', border: 'none', color: isAsgn ? '#fff' : ACC, cursor: 'pointer', fontSize: 13, padding: '2px 3px', borderRadius: 4, lineHeight: 1 }}>
                                  <i className="ri-user-add-line" />
                                </button>
                              )}
                              {hasData && (
                                <button onClick={() => clearSlot(rIdx, pIdx, sIdx)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 13, padding: '2px 3px', borderRadius: 4, lineHeight: 1 }}>
                                  <i className="ri-eraser-line" />
                                </button>
                              )}
                              <button onClick={() => toggleBye(rIdx, pIdx, sIdx)} style={{ background: isBye ? MUT + '30' : 'none', border: 'none', color: MUT, cursor: 'pointer', fontSize: 10, padding: '2px 4px', borderRadius: 4, lineHeight: 1, fontWeight: 800 }}>
                                BYE
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Assign dropdown */}
                        {isAsgn && (
                          <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 50, background: BG, border: `1.5px solid ${BRD}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.13)', maxHeight: 180, overflowY: 'auto' }}>
                            <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 800, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              {available.length ? 'Assign player' : 'All placed'}
                            </div>
                            {available.length === 0
                              ? <div style={{ padding: '4px 12px 10px', fontSize: 12, color: MUT }}>No available players</div>
                              : available.map(p => (
                                  <button key={p.user_id} onClick={() => assignPlayer(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, fontWeight: 600, color: TXT }}>
                                    <div style={{ width: 22, height: 22, borderRadius: 6, background: ACC + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: ACC, flexShrink: 0 }}>
                                      {(p.profiles?.username || '?')[0].toUpperCase()}
                                    </div>
                                    {p.profiles?.username || 'Player'}
                                  </button>
                                ))
                            }
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '10px 0 0', borderTop: `1px solid ${BRD}`, marginTop: 4 }}>
        {[{ c: GRN, l: 'Open' }, { c: ACC, l: 'Filled' }, { c: MUT, l: '? / BYE' }].map(x => (
          <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUT }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: x.c }} />{x.l}
          </div>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: MUT }}><i className="ri-drag-move-2-line" /> Drag to swap · Tap name to rename</span>
      </div>
    </div>
  )
}
