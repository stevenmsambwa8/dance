'use client'
/**
 * BracketBuilder — completely free-form bracket editor
 *
 * NO forced mathematics. Creator decides everything:
 *   - How many rounds
 *   - How many matches per round
 *   - What each round is called
 *   - Who goes in each slot
 *   - Drag any slot to swap with any other slot
 *   - Mark slots as BYE
 *   - Rename any slot or round inline
 *
 * Exports:
 *   default        BracketBuilder   (the editor component)
 *   buildEmptyBracket(rounds, matchesPerRound, teamSize)  — helper to seed initial shape
 */

import { useState, useRef } from 'react'

// ── builder helper ─────────────────────────────────────────────────────────────
// Called externally (create page) to seed a starting shape.
// rounds = array of match counts per round, e.g. [8, 4, 2, 1] = R32, QF, SF, Final
// teamSize = 1 | 2 | 4 | 8
export function buildEmptyBracket(roundMatchCounts = [8, 4, 2, 1], teamSize = 1) {
  const mkOpen = (idx) =>
    teamSize > 1
      ? { teamId: `squad_${idx}`, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
      : { slotId: `slot_${idx}`, userId: null, name: 'Open', avatar: null, status: 'open' }

  const mkPend = () =>
    teamSize > 1
      ? { teamId: null, teamName: null, status: 'pending', members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })) }
      : { slotId: null, userId: null, name: '?', avatar: null, status: 'pending' }

  let slotCounter = 0
  const rounds = roundMatchCounts.map((matchCount, rIdx) => {
    return Array.from({ length: matchCount }, (_, pIdx) => {
      // First round = open slots, rest = pending (TBD)
      if (rIdx === 0) {
        return [mkOpen(slotCounter++), mkOpen(slotCounter++)]
      }
      return [mkPend(), mkPend()]
    })
  })

  return {
    rounds,
    isEmpty: true,
    teamSize,
    isTeamBattle: teamSize > 1,
    // No bracketSize forced — fully custom
  }
}

// Default round name suggestions based on position from end
function defaultRoundName(rIdx, total) {
  const fromEnd = (total - 1) - rIdx
  if (fromEnd === 0) return 'Champion'
  if (fromEnd === 1) return 'Final'
  if (fromEnd === 2) return 'Semi Final'
  if (fromEnd === 3) return 'Quarter Final'
  const slots = Math.pow(2, total - rIdx)
  return `Round of ${slots}`
}

// Derive a display name for a slot
function slotDisplayName(slot, teamSize, globalIdx) {
  if (!slot) return 'BYE'
  if (teamSize > 1) {
    if (slot.teamName) return slot.teamName
    const real = (slot.members || []).filter(m => m?.userId && m.name && !['Open','?','BYE','—'].includes(m.name))
    if (real.length) return real.map(m => m.name.slice(0, 3)).join('').slice(0, 10)
    if (slot.teamId?.match(/\d+$/)) return `Squad ${parseInt(slot.teamId.match(/\d+$/)[0]) + 1}`
    return `Squad ${globalIdx + 1}`
  }
  if (slot.status === 'bye') return 'BYE'
  if (slot.status === 'pending') return '?'
  if (slot.userId) return slot.name || 'Player'
  return 'Open'
}

// ── PRESETS ───────────────────────────────────────────────────────────────────
// Creator picks one of these to seed the shape, then customises freely
const PRESETS = [
  { label: 'Round of 4',   icon: 'ri-node-tree',   counts: [2, 1],          desc: '2 matches → Final' },
  { label: 'Round of 8',   icon: 'ri-node-tree',   counts: [4, 2, 1],       desc: 'QF → SF → Final' },
  { label: 'Round of 16',  icon: 'ri-node-tree',   counts: [8, 4, 2, 1],    desc: 'R16 → QF → SF → Final' },
  { label: 'Round of 32',  icon: 'ri-node-tree',   counts: [16, 8, 4, 2, 1],desc: 'R32 → R16 → QF → SF → Final' },
  { label: 'Round of 64',  icon: 'ri-node-tree',   counts: [32,16, 8, 4, 2, 1], desc: 'R64 → … → Final' },
  { label: 'Custom',       icon: 'ri-settings-3-line', counts: null,         desc: 'You choose every round' },
]

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function BracketBuilder({
  bracketData,        // current bracket (null = empty)
  onChange,           // (bd) => void — called on every change
  onSave,             // (bd) => void — called on Save button (manage mode)
  participants = [],  // registered players for assignment dropdown
  teamSize = 1,
  saving = false,
  manageMode = false,
}) {
  const [bd, setBd]                   = useState(() => bracketData ? JSON.parse(JSON.stringify(bracketData)) : null)
  const [roundNames, setRoundNames]   = useState(() => {
    const total = bracketData?.rounds?.length || 0
    return Array.from({ length: total }, (_, i) => defaultRoundName(i, total))
  })
  const [dirty, setDirty]             = useState(false)
  const [showPresets, setShowPresets] = useState(!bracketData)

  // Custom preset builder
  const [customRounds, setCustomRounds] = useState([8, 4, 2, 1])

  // Drag
  const dragRef = useRef(null)  // { rIdx, pIdx, sIdx }

  // Inline editing
  const [editingSlot,   setEditingSlot]   = useState(null)  // { rIdx, pIdx, sIdx }
  const [editName,      setEditName]      = useState('')
  const [editingRound,  setEditingRound]  = useState(null)  // rIdx
  const [assignOpen,    setAssignOpen]    = useState(null)  // { rIdx, pIdx, sIdx }

  const isTeamBattle = teamSize > 1

  // ── commit helper ────────────────────────────────────────────────────────
  function commit(newBd, newNames) {
    setBd(newBd)
    if (newNames) setRoundNames(newNames)
    setDirty(true)
    onChange?.(newBd)
  }

  // ── init from preset ────────────────────────────────────────────────────
  function initPreset(counts) {
    const fresh = buildEmptyBracket(counts, teamSize)
    const names = Array.from({ length: counts.length }, (_, i) => defaultRoundName(i, counts.length))
    commit(fresh, names)
    setShowPresets(false)
  }

  // ── structure controls ───────────────────────────────────────────────────

  function addRoundAtStart() {
    if (!bd) return
    // New round has 2× the matches of the current first round
    const matchCount = (bd.rounds[0]?.length || 1) * 2
    const newPairs = Array.from({ length: matchCount }, (_, i) => {
      const mkOpen = (idx) => isTeamBattle
        ? { teamId: `squad_new_${Date.now()}_${idx}`, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
        : { slotId: `new_${Date.now()}_${idx}`, userId: null, name: 'Open', avatar: null, status: 'open' }
      return [mkOpen(i * 2), mkOpen(i * 2 + 1)]
    })
    const newRounds = [newPairs, ...bd.rounds]
    const total = newRounds.length
    const names = Array.from({ length: total }, (_, i) => roundNames[i - 1] ?? defaultRoundName(i, total))
    names[0] = defaultRoundName(0, total)
    commit({ ...bd, rounds: newRounds }, names)
  }

  function addRoundAtEnd() {
    if (!bd) return
    // Champion round — 1 match, both slots pending
    const mkPend = () => isTeamBattle
      ? { teamId: null, teamName: null, status: 'pending', members: Array.from({ length: teamSize }, () => ({ userId: null, name: '?', avatar: null, status: 'pending' })) }
      : { userId: null, name: '?', avatar: null, status: 'pending' }
    const newRounds = [...bd.rounds, [[mkPend(), mkPend()]]]
    const total = newRounds.length
    const names = [...roundNames, defaultRoundName(total - 1, total)]
    commit({ ...bd, rounds: newRounds }, names)
  }

  function removeRound(rIdx) {
    if (!bd || bd.rounds.length <= 1) return
    const newRounds = bd.rounds.filter((_, i) => i !== rIdx)
    const newNames  = roundNames.filter((_, i) => i !== rIdx)
    commit({ ...bd, rounds: newRounds }, newNames)
  }

  function addMatchToRound(rIdx) {
    if (!bd) return
    const mkOpen = (idx) => isTeamBattle
      ? { teamId: `squad_add_${Date.now()}_${idx}`, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
      : { slotId: `add_${Date.now()}_${idx}`, userId: null, name: 'Open', avatar: null, status: 'open' }
    const newRounds = bd.rounds.map((r, i) => i !== rIdx ? r : [...r, [mkOpen(0), mkOpen(1)]])
    commit({ ...bd, rounds: newRounds })
  }

  function removeMatch(rIdx, pIdx) {
    if (!bd) return
    const newRounds = bd.rounds.map((r, i) => i !== rIdx ? r : r.filter((_, pi) => pi !== pIdx))
    commit({ ...bd, rounds: newRounds })
  }

  // ── slot rename ──────────────────────────────────────────────────────────
  function startSlotRename(rIdx, pIdx, sIdx) {
    const slot = bd?.rounds[rIdx]?.[pIdx]?.[sIdx]
    if (!slot) return
    const cur = isTeamBattle
      ? (slot.teamName || slotDisplayName(slot, teamSize, pIdx * 2 + sIdx))
      : (slot.name || '')
    setEditingSlot({ rIdx, pIdx, sIdx })
    setEditName(cur)
  }

  function commitSlotRename() {
    if (!editingSlot || !bd) return
    const { rIdx, pIdx, sIdx } = editingSlot
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx || !slot) return slot
      return isTeamBattle
        ? { ...slot, teamName: editName.trim() || null }
        : { ...slot, name: editName.trim() || 'Open' }
    })))
    commit({ ...bd, rounds: newRounds })
    setEditingSlot(null); setEditName('')
  }

  // ── drag & drop ──────────────────────────────────────────────────────────
  function onDragStart(e, rIdx, pIdx, sIdx) {
    dragRef.current = { rIdx, pIdx, sIdx }
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }

  function onDrop(e, rIdx, pIdx, sIdx) {
    e.preventDefault()
    const from = dragRef.current
    dragRef.current = null
    if (!from || !bd) return
    if (from.rIdx === rIdx && from.pIdx === pIdx && from.sIdx === sIdx) return

    const fromSlot = bd.rounds[from.rIdx]?.[from.pIdx]?.[from.sIdx]
    const toSlot   = bd.rounds[rIdx]?.[pIdx]?.[sIdx]

    const newRounds = bd.rounds.map((r, ri) => r.map((pair, pi) => pair.map((slot, si) => {
      if (ri === from.rIdx && pi === from.pIdx && si === from.sIdx) return toSlot ?? slot
      if (ri === rIdx      && pi === pIdx      && si === sIdx)      return fromSlot ?? slot
      return slot
    })))
    commit({ ...bd, rounds: newRounds })
  }

  // ── assign player ────────────────────────────────────────────────────────
  function assignPlayer(p) {
    if (!assignOpen || !bd) return
    const { rIdx, pIdx, sIdx } = assignOpen
    const ps = { userId: p.user_id, name: p.profiles?.username || 'Player', avatar: p.profiles?.avatar_url || null, status: 'active' }
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx) return slot
      if (isTeamBattle) {
        const nm = [...(slot?.members || [])]
        const mi = nm.findIndex(m => !m?.userId || m.status === 'open')
        if (mi !== -1) nm[mi] = { ...ps }
        return { ...slot, members: nm, status: nm.every(m => m?.userId) ? 'active' : 'open' }
      }
      return ps
    })))
    commit({ ...bd, rounds: newRounds })
    setAssignOpen(null)
  }

  function clearSlot(rIdx, pIdx, sIdx) {
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx) return slot
      return isTeamBattle
        ? { ...slot, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
        : { ...slot, userId: null, name: 'Open', avatar: null, status: 'open' }
    })))
    commit({ ...bd, rounds: newRounds })
  }

  function toggleBye(rIdx, pIdx, sIdx) {
    const slot = bd?.rounds[rIdx]?.[pIdx]?.[sIdx]
    const isBye = slot?.status === 'bye'
    const newRounds = bd.rounds.map((r, ri) => ri !== rIdx ? r : r.map((pair, pi) => pi !== pIdx ? pair : pair.map((slot, si) => {
      if (si !== sIdx) return slot
      if (isBye) return isTeamBattle
        ? { ...slot, teamName: null, status: 'open', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'Open', avatar: null, status: 'open' })) }
        : { ...slot, userId: null, name: 'Open', avatar: null, status: 'open' }
      return isTeamBattle
        ? { ...slot, teamName: 'BYE', status: 'bye', members: Array.from({ length: teamSize }, () => ({ userId: null, name: 'BYE', avatar: null, status: 'bye' })) }
        : { userId: null, name: 'BYE', avatar: null, status: 'bye' }
    })))
    commit({ ...bd, rounds: newRounds })
  }

  // ── colours ──────────────────────────────────────────────────────────────
  const ACC   = '#6366f1'
  const GRN   = '#22c55e'
  const MUT   = 'var(--text-muted, #9ca3af)'
  const SURF  = 'var(--surface, #f8f9fa)'
  const BRD   = 'var(--border, #e5e7eb)'
  const TXT   = 'var(--text, #111)'
  const BG    = 'var(--bg, #fff)'

  // ── total slot count ─────────────────────────────────────────────────────
  const totalSlots = bd ? bd.rounds[0]?.reduce((acc, pair) => acc + pair.filter(s => s && s.status !== 'bye').length, 0) : 0

  // ── already-placed set ───────────────────────────────────────────────────
  const placedIds = new Set()
  bd?.rounds?.forEach(r => r.forEach(pair => pair.forEach(slot => {
    if (!slot) return
    if (isTeamBattle) (slot.members || []).forEach(m => { if (m?.userId) placedIds.add(m.userId) })
    else if (slot.userId) placedIds.add(slot.userId)
  })))
  const availablePlayers = participants.filter(p => !placedIds.has(p.user_id))

  // ══════════════════════════════════════════════════════════════════════════
  // PRESET PICKER (shown when no bracket yet)
  // ══════════════════════════════════════════════════════════════════════════
  if (showPresets) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: MUT, fontWeight: 500 }}>
          Choose a starting shape — you can freely edit rounds and matches after.
        </p>

        {PRESETS.filter(p => p.counts).map(p => (
          <button key={p.label} onClick={() => initPreset(p.counts)} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '13px 16px', borderRadius: 12,
            border: `1.5px solid ${BRD}`, background: SURF,
            cursor: 'pointer', textAlign: 'left', width: '100%',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: ACC + '18', border: `1.5px solid ${ACC}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: ACC, flexShrink: 0 }}>
              <i className={p.icon} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: TXT, marginBottom: 2 }}>{p.label}</div>
              <div style={{ fontSize: 11, color: MUT }}>
                {p.counts.join(' → ')} matches &nbsp;·&nbsp; {p.desc}
              </div>
            </div>
            <i className="ri-arrow-right-s-line" style={{ color: MUT, fontSize: 18, flexShrink: 0 }} />
          </button>
        ))}

        {/* Custom builder */}
        <div style={{ padding: '14px 16px', borderRadius: 12, border: `1.5px dashed ${BRD}`, background: SURF }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: TXT, marginBottom: 10 }}>
            <i className="ri-settings-3-line" style={{ marginRight: 6, color: ACC }} />Custom rounds
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: MUT }}>
            Enter match counts per round separated by commas.<br />
            e.g. <strong>16, 8, 4, 2, 1</strong> = Round of 32 → QF → SF → Final → Champion
          </p>
          <input
            type="text"
            value={customRounds.join(', ')}
            onChange={e => {
              const vals = e.target.value.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n > 0)
              if (vals.length) setCustomRounds(vals)
            }}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${BRD}`, fontSize: 13, fontWeight: 600, color: TXT, background: BG, boxSizing: 'border-box', marginBottom: 10, outline: 'none' }}
            placeholder="16, 8, 4, 2, 1"
          />
          <div style={{ fontSize: 11, color: MUT, marginBottom: 10 }}>
            → {customRounds.length} rounds · {customRounds[0] * 2} slots in round 1
          </div>
          <button onClick={() => initPreset(customRounds)} style={{ padding: '9px 18px', borderRadius: 8, background: ACC, color: '#fff', border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            Build This Bracket
          </button>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BRACKET EDITOR
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 14px', flexWrap: 'wrap' }}>

        {/* Structure buttons */}
        <button onClick={addRoundAtStart} title="Add a new round at the start" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: `1.5px solid ${BRD}`, background: SURF, fontSize: 12, fontWeight: 700, color: ACC, cursor: 'pointer' }}>
          <i className="ri-skip-back-line" /> + Earlier Round
        </button>
        <button onClick={addRoundAtEnd} title="Add a new round at the end" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: `1.5px solid ${BRD}`, background: SURF, fontSize: 12, fontWeight: 700, color: ACC, cursor: 'pointer' }}>
          + Later Round <i className="ri-skip-forward-line" />
        </button>

        {/* Reset to presets */}
        <button onClick={() => { setShowPresets(true) }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: `1.5px dashed ${BRD}`, background: 'transparent', fontSize: 12, fontWeight: 700, color: MUT, cursor: 'pointer' }}>
          <i className="ri-refresh-line" /> Change Shape
        </button>

        {/* Stats */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: MUT, fontWeight: 600 }}>
          <i className="ri-node-tree" style={{ fontSize: 13 }} />
          {bd?.rounds?.length} rounds · {totalSlots} slots
        </div>

        {/* Save (manage mode) */}
        {manageMode && onSave && (
          <button onClick={() => { onSave(bd); setDirty(false) }} disabled={saving || !dirty} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 15px', borderRadius: 8, background: dirty ? ACC : BRD, color: dirty ? '#fff' : MUT, border: 'none', fontSize: 13, fontWeight: 800, cursor: dirty ? 'pointer' : 'default', transition: 'all 0.15s' }}>
            {saving ? <><i className="ri-loader-4-line" /> Saving…</> : <><i className="ri-save-line" /> {dirty ? 'Save Bracket' : 'Saved'}</>}
          </button>
        )}
      </div>

      {/* ── Rounds (horizontal scroll) ── */}
      <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 'max-content' }}>

          {bd?.rounds.map((pairs, rIdx) => (
            <div key={rIdx} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 158 }}>

              {/* Round header — fully editable */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {editingRound === rIdx ? (
                  <input
                    autoFocus
                    value={roundNames[rIdx]}
                    onChange={e => setRoundNames(prev => prev.map((n, i) => i === rIdx ? e.target.value : n))}
                    onBlur={() => setEditingRound(null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingRound(null) }}
                    style={{ flex: 1, fontSize: 11, fontWeight: 800, color: ACC, background: 'transparent', border: 'none', outline: `1px solid ${ACC}`, borderRadius: 4, padding: '2px 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}
                  />
                ) : (
                  <span
                    onClick={() => setEditingRound(rIdx)}
                    title="Tap to rename"
                    style={{ flex: 1, fontSize: 11, fontWeight: 800, color: ACC, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'text', padding: '2px 0' }}
                  >
                    {roundNames[rIdx] || `Round ${rIdx + 1}`}
                  </span>
                )}

                {/* Add match to this round */}
                <button onClick={() => addMatchToRound(rIdx)} title="Add match" style={{ background: 'none', border: 'none', color: GRN, cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1 }}>
                  <i className="ri-add-circle-line" />
                </button>

                {/* Remove entire round */}
                <button onClick={() => removeRound(rIdx)} title="Remove round" style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, opacity: 0.5 }}>
                  <i className="ri-close-circle-line" />
                </button>
              </div>

              {/* Match pairs */}
              {pairs.map((pair, pIdx) => (
                <div key={pIdx} style={{ background: SURF, borderRadius: 10, border: `1.5px solid ${BRD}`, overflow: 'visible', position: 'relative' }}>

                  {/* Remove match (if >1 match in round) */}
                  {pairs.length > 1 && (
                    <button onClick={() => removeMatch(rIdx, pIdx)} title="Remove match" style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', background: '#dc2626', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
                      <i className="ri-close-line" />
                    </button>
                  )}

                  {pair.map((slot, sIdx) => {
                    if (slot === null) return null
                    const isPend   = slot?.status === 'pending'
                    const isBye    = slot?.status === 'bye'
                    const hasData  = isTeamBattle ? slot?.members?.some(m => m?.userId) : !!slot?.userId
                    const isOpen   = !hasData && !isBye && !isPend
                    const label    = slotDisplayName(slot, teamSize, pIdx * 2 + sIdx)
                    const isRenaming = editingSlot?.rIdx === rIdx && editingSlot?.pIdx === pIdx && editingSlot?.sIdx === sIdx
                    const isAssigning = assignOpen?.rIdx === rIdx && assignOpen?.pIdx === pIdx && assignOpen?.sIdx === sIdx

                    const dotColor = isBye ? MUT : isPend ? BRD : hasData ? ACC : GRN

                    return (
                      <div key={sIdx}>
                        <div
                          draggable={!isPend}
                          onDragStart={e => onDragStart(e, rIdx, pIdx, sIdx)}
                          onDragOver={onDragOver}
                          onDrop={e => onDrop(e, rIdx, pIdx, sIdx)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '8px 10px',
                            borderTop: sIdx > 0 ? `1px solid ${BRD}` : undefined,
                            background: isBye ? '#00000006' : 'transparent',
                            cursor: isPend ? 'default' : 'grab',
                            minHeight: 38,
                          }}
                        >
                          {/* Colour dot */}
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />

                          {/* Inline rename OR label */}
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              onBlur={commitSlotRename}
                              onKeyDown={e => { if (e.key === 'Enter') commitSlotRename(); if (e.key === 'Escape') { setEditingSlot(null); setEditName('') } }}
                              style={{ flex: 1, fontSize: 12, fontWeight: 700, border: 'none', outline: 'none', background: 'transparent', color: TXT }}
                            />
                          ) : (
                            <span
                              onClick={() => !isPend && startSlotRename(rIdx, pIdx, sIdx)}
                              title={isPend ? '' : 'Tap to rename'}
                              style={{ flex: 1, fontSize: 12, fontWeight: isPend || isBye ? 400 : 700, color: isPend || isBye ? MUT : TXT, cursor: isPend ? 'default' : 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              {label}
                            </span>
                          )}

                          {/* Actions */}
                          {!isPend && (
                            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                              {/* Assign player */}
                              {participants.length > 0 && !isBye && (
                                <button onClick={() => setAssignOpen(isAssigning ? null : { rIdx, pIdx, sIdx })} title="Assign player"
                                  style={{ background: isAssigning ? ACC : 'none', border: 'none', color: isAssigning ? '#fff' : ACC, cursor: 'pointer', fontSize: 13, padding: '2px 3px', borderRadius: 4, lineHeight: 1 }}>
                                  <i className="ri-user-add-line" />
                                </button>
                              )}
                              {/* Clear */}
                              {hasData && (
                                <button onClick={() => clearSlot(rIdx, pIdx, sIdx)} title="Clear slot"
                                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13, padding: '2px 3px', borderRadius: 4, lineHeight: 1 }}>
                                  <i className="ri-eraser-line" />
                                </button>
                              )}
                              {/* BYE toggle */}
                              <button onClick={() => toggleBye(rIdx, pIdx, sIdx)} title={isBye ? 'Unmark BYE' : 'Mark as BYE'}
                                style={{ background: isBye ? MUT + '30' : 'none', border: 'none', color: MUT, cursor: 'pointer', fontSize: 10, padding: '2px 4px', borderRadius: 4, lineHeight: 1, fontWeight: 800 }}>
                                BYE
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Assign dropdown */}
                        {isAssigning && (
                          <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 50, background: BG, border: `1.5px solid ${BRD}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.13)', maxHeight: 180, overflowY: 'auto' }}>
                            <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 800, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              {availablePlayers.length ? 'Assign player' : 'All placed'}
                            </div>
                            {availablePlayers.length === 0
                              ? <div style={{ padding: '4px 12px 10px', fontSize: 12, color: MUT }}>No available players</div>
                              : availablePlayers.map(p => (
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

      {/* ── Legend / hint ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '10px 0 0', borderTop: `1px solid ${BRD}`, marginTop: 4 }}>
        {[
          { color: GRN, label: 'Open' },
          { color: ACC, label: 'Filled' },
          { color: MUT, label: '? / BYE' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUT }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }} />
            {l.label}
          </div>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: MUT }}>
          <i className="ri-drag-move-2-line" /> Drag to swap &nbsp;·&nbsp; Tap name to rename
        </span>
      </div>
    </div>
  )
}
