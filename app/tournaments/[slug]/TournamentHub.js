'use client'
import styles from './Hub.module.css'

// ─── Helpers ────────────────────────────────────────────────────────────────

const slotHasUser = (slot, uid) =>
  !!uid && (slot?.userId === uid || (slot?.members || []).some(m => m?.userId === uid))

const isPlayableSlot = (s) => s && s.status !== 'bye'

// Matches decided / total, plus the label of the round currently being played.
function getProgress(bracketData, getRoundLabel) {
  let total = 0, done = 0, currentLabel = null

  if (bracketData?.rounds?.length) {
    const rounds = bracketData.rounds
    rounds.slice(0, rounds.length - 1).forEach((pairs, rIdx) => {
      let rTotal = 0, rDone = 0
      pairs.forEach(([a, b]) => {
        if (!isPlayableSlot(a) || !isPlayableSlot(b)) return
        rTotal++
        if (a.status === 'winner' || b.status === 'winner') rDone++
      })
      total += rTotal
      done += rDone
      if (!currentLabel && rTotal > rDone) {
        currentLabel = getRoundLabel(rIdx, rounds.length, bracketData.bracketSize, bracketData.round_names)
      }
    })
  }

  if (bracketData?.groups?.length) {
    bracketData.groups.forEach(g => {
      ;(g.fixtures || []).forEach(fx => {
        total++
        if (fx.status === 'played') done++
      })
    })
    if (!currentLabel && total > done && bracketData.stage !== 'knockout') currentLabel = 'Group stage'
  }

  return { total, done, currentLabel }
}

// Where does the signed-in player stand right now?
function getMyStatus({ bracketData, userId, participants, getRoundLabel }) {
  if (!userId) return null
  const nameOf = (slot) =>
    participants.find(p => p.user_id === slot?.userId)?.profiles?.username || slot?.name || 'Opponent'

  if (bracketData?.rounds?.length) {
    const rounds = bracketData.rounds
    const last = rounds.length - 1

    // Champion column
    if ((rounds[last] || []).flat().some(s => slotHasUser(s, userId))) return { kind: 'champion' }

    for (let r = last - 1; r >= 0; r--) {
      for (const pair of rounds[r] || []) {
        const [a, b] = pair
        const mine = slotHasUser(a, userId) ? a : slotHasUser(b, userId) ? b : null
        if (!mine) continue
        const opp = mine === a ? b : a
        const label = getRoundLabel(r, rounds.length, bracketData.bracketSize, bracketData.round_names)
        if (mine.status === 'elim' || mine.status === 'dq') return { kind: 'out', label }
        if (mine.status === 'winner') return { kind: 'through', label }
        if (mine.status === 'bye' || !opp || opp.status === 'bye') return { kind: 'bye', label }
        if (!opp.userId && !(opp.members || []).some(m => m?.userId)) return { kind: 'waiting', label }
        return { kind: 'next', label, opponent: nameOf(opp), opponentAvatar: participants.find(p => p.user_id === opp.userId)?.profiles?.avatar_url || opp.avatar || null }
      }
    }
  }

  if (bracketData?.groups?.length && bracketData.stage !== 'knockout') {
    for (const g of bracketData.groups) {
      const me = (g.members || []).find(m => (m.userId ?? m.id) === userId || (m.players || []).some(p => p.userId === userId))
      if (!me) continue
      const meId = me.id ?? me.userId ?? me.teamId
      const fx = (g.fixtures || []).find(f => f.status !== 'played' && (f.homeId === meId || f.awayId === meId))
      if (!fx) return { kind: 'groupDone', label: g.name || 'Group' }
      const oppId = fx.homeId === meId ? fx.awayId : fx.homeId
      const opp = (g.members || []).find(m => (m.id ?? m.userId ?? m.teamId) === oppId)
      return { kind: 'next', label: g.name || 'Group stage', opponent: opp?.name || 'Opponent', opponentAvatar: opp?.avatar || opp?.players?.[0]?.avatar || null }
    }
  }
  return null
}

const STEPS = [
  { key: 'active',    label: 'Open',     icon: 'ri-door-open-line' },
  { key: 'ongoing',   label: 'Live',     icon: 'ri-play-circle-line' },
  { key: 'completed', label: 'Finished', icon: 'ri-flag-2-line' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function TournamentHub({
  tournament, participants, leaderboard, bracketData, userId, registered,
  sections, onOpen, loading, realCount, getRoundLabel,
}) {
  const progress = getProgress(bracketData, getRoundLabel)
  const my = registered ? getMyStatus({ bracketData, userId, participants, getRoundLabel }) : null
  const stepIdx = Math.max(0, STEPS.findIndex(s => s.key === tournament.status))
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const topEntries = [...(leaderboard || [])].sort((a, b) => (b.points || 0) - (a.points || 0))

  // Live preview line for each section card
  function preview(key) {
    if (loading) return { text: '…' }
    switch (key) {
      case 'bracket':
      case 'groups':
        if (!progress.total) return { text: 'Not started yet' }
        return { text: progress.currentLabel ? `${progress.currentLabel} · ${progress.done}/${progress.total}` : `Complete · ${progress.done}/${progress.total}` }
      case 'standings':
      case 'leaderboard': {
        const top = topEntries[0]
        if (!top) return { text: 'No points yet' }
        return { text: `#1 ${top.profiles?.username || 'Player'} · ${top.points || 0} pts` }
      }
      case 'matches': {
        const left = Math.max(0, progress.total - progress.done)
        if (!progress.total) return { text: 'No matches yet' }
        return { text: left ? `${left} to play · ${progress.done} played` : 'All matches played' }
      }
      case 'players':
        return {
          text: tournament.slots ? `${realCount}/${tournament.slots} joined` : `${realCount} joined`,
          avatars: participants.slice(0, 4).map(p => p.profiles?.avatar_url || null),
        }
      default:
        return { text: '' }
    }
  }

  return (
    <div className={styles.hub}>
      {/* ── Stage stepper ── */}
      <div className={styles.card}>
        <div className={styles.stepper}>
          {STEPS.map((s, i) => (
            <div key={s.key} className={`${styles.step} ${i < stepIdx ? styles.stepDone : ''} ${i === stepIdx ? styles.stepNow : ''}`}>
              <span className={styles.stepDot}><i className={i < stepIdx ? 'ri-check-line' : s.icon} /></span>
              <span className={styles.stepLabel}>{s.label}</span>
            </div>
          ))}
        </div>
        {progress.total > 0 && (
          <div className={styles.progressWrap}>
            <div className={styles.progressTop}>
              <span>{progress.currentLabel || 'All rounds complete'}</span>
              <span>{progress.done}/{progress.total} matches</span>
            </div>
            <div className={styles.track}><div className={styles.fill} style={{ width: `${pct}%` }} /></div>
          </div>
        )}
      </div>

      {/* ── Your status ── */}
      {my && (
        <div className={`${styles.card} ${styles.myCard} ${my.kind === 'champion' ? styles.myGold : ''} ${my.kind === 'out' ? styles.myOut : ''}`}>
          <span className={styles.myKicker}>Your path</span>
          {my.kind === 'next' && (
            <>
              <div className={styles.myTitle}>Next match · {my.label}</div>
              <div className={styles.vsRow}>
                <span className={styles.vsYou}>You</span>
                <span className={styles.vsTag}>VS</span>
                <span className={styles.vsOpp}>
                  {my.opponentAvatar && <img src={my.opponentAvatar} alt="" />}
                  {my.opponent}
                </span>
              </div>
              <button className={styles.myBtn} onClick={() => onOpen('matches')}>
                Open match <i className="ri-arrow-right-s-line" />
              </button>
            </>
          )}
          {my.kind === 'through' && <div className={styles.myTitle}>You won in {my.label} — waiting for the next round</div>}
          {my.kind === 'waiting' && <div className={styles.myTitle}>{my.label} · waiting for your opponent to be decided</div>}
          {my.kind === 'bye' && <div className={styles.myTitle}>{my.label} · you have a bye — you advance automatically</div>}
          {my.kind === 'groupDone' && <div className={styles.myTitle}>{my.label} · you've played all your fixtures</div>}
          {my.kind === 'out' && <div className={styles.myTitle}>You were knocked out in {my.label}. Good run!</div>}
          {my.kind === 'champion' && <div className={styles.myTitle}>🏆 You're the champion!</div>}
        </div>
      )}

      {/* ── Section cards ── */}
      <div className={styles.grid}>
        {sections.map(sec => {
          const pv = preview(sec.key)
          return (
            <button key={sec.key} className={styles.tile} onClick={() => onOpen(sec.key)}>
              <span className={styles.tileIcon}><i className={sec.icon} /></span>
              <span className={styles.tileTitle}>{sec.title}</span>
              <span className={styles.tilePreview}>{pv.text}</span>
              {pv.avatars?.length > 0 && (
                <span className={styles.avatars}>
                  {pv.avatars.map((a, i) => (
                    <span key={i} className={styles.avatar} style={{ zIndex: 5 - i }}>
                      {a ? <img src={a} alt="" /> : <i className="ri-user-3-line" />}
                    </span>
                  ))}
                </span>
              )}
              <i className={`ri-arrow-right-up-line ${styles.tileArrow}`} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
