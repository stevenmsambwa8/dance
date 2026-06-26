'use client'
import React, { useState, useEffect } from 'react'

/**
 * MatchupPlanner — lets an admin/creator swap who-vs-who in any bracket
 * round that hasn't had results yet. A round is "editable" if NONE of its
 * matches have a winner/eliminated/DQ slot; once any result exists in a
 * round, that round locks.
 *
 * Moved here (previously lived inline inside the tournament slug page's
 * now-removed in-page "Manage" tab) so it can be used from the
 * consolidated /manage command center instead.
 */
export default function MatchupPlanner({ participants, bracketData, onApply }) {
  const [editRound, setEditRound] = useState(0)
  const [localRounds, setLocalRounds] = useState(null)
  const [applying, setApplying] = useState(false)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (!bracketData?.rounds) return
    setLocalRounds(bracketData.rounds.map(round => round.map(pair => [...pair])))
    setChanged(false)
  }, [bracketData])

  if (!bracketData?.rounds || participants.length < 2) return (
    <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
      <i className="ri-node-tree" /> Generate the bracket first to plan matchups.
    </div>
  )

  const totalRounds = bracketData.rounds.length
  // Only show rounds that are actual match rounds (exclude champion slot)
  const matchRounds = totalRounds - 1

  // Check if a round is locked — has any decisive result
  function isRoundLocked(rIdx) {
    return bracketData.rounds[rIdx]?.some(pair =>
      pair.some(s => s?.status === 'winner' || s?.status === 'eliminated' || s?.status === 'disqualified')
    )
  }

  // Get players eligible for a round — those who are 'active' or 'winner' advancing into it
  function getEligibleForRound(rIdx) {
    if (rIdx === 0) return participants
    // Players who advanced from previous round (status === 'winner' in rIdx-1, now active in rIdx)
    const ids = new Set()
    bracketData.rounds[rIdx]?.forEach(pair =>
      pair.forEach(s => { if (s?.userId && s.status !== 'bye' && s.status !== 'pending') ids.add(s.userId) })
    )
    // Also include pending slots — they're placeholders for winners not yet determined
    return participants.filter(p => ids.has(p.user_id))
  }

  function getProfile(userId) {
    return participants.find(p => p.user_id === userId)?.profiles
  }

  function swapSlots(rIdx, p1, s1, p2, s2) {
    setLocalRounds(prev => {
      const next = prev.map(r => r.map(pair => [...pair]))
      const tmp = { ...next[rIdx][p1][s1] }
      next[rIdx][p1][s1] = { ...next[rIdx][p2][s2] }
      next[rIdx][p2][s2] = tmp
      return next
    })
    setChanged(true)
  }

  function setSlotPlayer(rIdx, pairIdx, slotIdx, userId) {
    setLocalRounds(prev => {
      const next = prev.map(r => r.map(pair => [...pair]))
      // Clear this userId from anywhere else in this round
      next[rIdx].forEach((pair, pi) => pair.forEach((s, si) => {
        if (s?.userId === userId && !(pi === pairIdx && si === slotIdx)) {
          next[rIdx][pi][si] = { userId: null, name: 'Open', avatar: null, status: 'open' }
        }
      }))
      const prof = getProfile(userId)
      next[rIdx][pairIdx][slotIdx] = userId
        ? { userId, name: prof?.username || '?', avatar: prof?.avatar_url || null, status: 'active' }
        : { userId: null, name: 'Open', avatar: null, status: 'open' }
      return next
    })
    setChanged(true)
  }

  async function applyChanges() {
    if (!localRounds) return
    setApplying(true)
    await onApply(localRounds)
    setChanged(false)
    setApplying(false)
  }

  function resetChanges() {
    if (!bracketData?.rounds) return
    setLocalRounds(bracketData.rounds.map(round => round.map(pair => [...pair])))
    setChanged(false)
  }

  // Build round label
  function roundLabel(rIdx) {
    // Use creator's custom round names first (stored in bracketData.round_names)
    const customNames = bracketData?.round_names
    if (customNames?.[rIdx]) return customNames[rIdx]
    const fromEnd = (matchRounds - 1) - rIdx
    if (fromEnd === 0) return 'Final'
    if (fromEnd === 1) return 'Semi Final'
    if (fromEnd === 2) return 'Quarter Final'
    return `Round ${rIdx + 1}`
  }

  const currentRound = localRounds?.[editRound] || []
  const locked = isRoundLocked(editRound)

  // Players placed in current round
  const placedInRound = new Set()
  currentRound.forEach(pair => pair.forEach(s => { if (s?.userId) placedInRound.add(s.userId) }))

  // For round 0 show all participants; for later rounds show only active players in that round
  const eligiblePlayers = editRound === 0
    ? participants
    : participants.filter(p => {
        // Show players who appear in current round slots
        return currentRound.some(pair => pair.some(s => s?.userId === p.user_id))
          // Or who won previous round
          || bracketData.rounds[editRound - 1]?.some(pair => pair.some(s => s?.userId === p.user_id && s.status === 'winner'))
      })

  return (
    <div style={{ marginTop: 8 }}>
      {/* Header */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="ri-shuffle-line" style={{ fontSize: 14 }} /> Matchup Planner
      </div>

      {/* Round selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {Array.from({ length: matchRounds }, (_, rIdx) => {
          const isLocked = isRoundLocked(rIdx)
          return (
            <button
              key={rIdx}
              onClick={() => { setEditRound(rIdx); resetChanges() }}
              style={{
                padding: '6px 12px', borderRadius: 20, border: `1.5px solid ${editRound === rIdx ? 'var(--accent)' : 'var(--border)'}`,
                background: editRound === rIdx ? 'color-mix(in srgb, var(--accent) 10%, var(--bg))' : 'var(--surface)',
                color: editRound === rIdx ? 'var(--accent)' : isLocked ? 'var(--text-muted)' : 'var(--text)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {isLocked && <i className="ri-lock-line" style={{ fontSize: 11 }} />}
              {roundLabel(rIdx)}
            </button>
          )
        })}
      </div>

      {/* Locked notice */}
      {locked ? (
        <div style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
          <i className="ri-lock-line" style={{ fontSize: 16, flexShrink: 0 }} />
          <span>This round has match results — matchups are locked and cannot be changed.</span>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Drag players between matches to plan {roundLabel(editRound)}. Tap a dropdown to reassign.
          </p>

          {/* Match pairs */}
          {currentRound.map((pair, pairIdx) => {
            const isByeInPair = pair.some(s => s?.status === 'bye')
            return (
              <div key={pairIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', width: 22, textAlign: 'center', flexShrink: 0 }}>M{pairIdx + 1}</span>
                {[0, 1].map(slotIdx => {
                  const slot = pair[slotIdx]
                  const isByeSlot = slot?.status === 'bye'
                  const hasPlayer = !!slot?.userId
                  return (
                    <React.Fragment key={slotIdx}>
                      {slotIdx === 1 && <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', flexShrink: 0 }}>VS</span>}
                      <div style={{ flex: 1 }}>
                        {isByeSlot ? (
                          <div style={{ padding: '7px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>BYE</div>
                        ) : (
                          <select
                            value={slot?.userId || ''}
                            onChange={e => setSlotPlayer(editRound, pairIdx, slotIdx, e.target.value || null)}
                            style={{
                              width: '100%', padding: '7px 10px', borderRadius: 8,
                              border: `1.5px solid ${hasPlayer ? 'var(--accent)' : 'var(--border)'}`,
                              background: hasPlayer ? 'color-mix(in srgb, var(--accent) 6%, var(--surface))' : 'var(--surface)',
                              color: hasPlayer ? 'var(--text)' : 'var(--text-muted)',
                              fontSize: 12, fontWeight: 600, outline: 'none', cursor: 'pointer',
                            }}
                          >
                            <option value="">— Empty —</option>
                            {eligiblePlayers.map(p => (
                              <option
                                key={p.user_id}
                                value={p.user_id}
                                disabled={placedInRound.has(p.user_id) && slot?.userId !== p.user_id}
                              >
                                {p.profiles?.username || 'Player'}
                                {placedInRound.has(p.user_id) && slot?.userId !== p.user_id ? ' ✓' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </React.Fragment>
                  )
                })}
                {/* Quick swap button within same match */}
                {pair[0]?.userId && pair[1]?.userId && (
                  <button
                    title="Swap these two"
                    onClick={() => swapSlots(editRound, pairIdx, 0, pairIdx, 1)}
                    style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, flexShrink: 0 }}
                  >
                    <i className="ri-arrow-left-right-line" />
                  </button>
                )}
              </div>
            )
          })}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {changed && (
              <button onClick={resetChanges} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                <i className="ri-refresh-line" /> Reset
              </button>
            )}
            <button
              onClick={applyChanges}
              disabled={applying || !changed}
              style={{
                flex: 2, padding: '10px', borderRadius: 10, border: 'none',
                background: changed ? 'var(--accent)' : 'var(--border)',
                color: changed ? '#fff' : 'var(--text-muted)',
                fontWeight: 700, fontSize: 13, cursor: changed ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {applying ? <><i className="ri-loader-4-line" /> Saving…</> : <><i className="ri-check-double-line" /> Apply to Bracket</>}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
            Changes only affect {roundLabel(editRound)} slots. No points are changed.
          </p>
        </>
      )}
    </div>
  )
}
