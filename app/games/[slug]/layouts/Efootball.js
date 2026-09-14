'use client'
import Link from 'next/link'
import styles from './Efootball.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function EfootballLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <Link href="/games" className={styles.back}><i className="ri-arrow-left-line" /> All Games</Link>

      <div className={styles.scoreboard}>
        <div className={styles.sbTop}>
          {game.image && <img src={game.image} alt={game.name} className={styles.sbLogo} />}
          <div>
            <span className={styles.sbLeague}>{game.genre}</span>
            <h1 className={styles.sbName}>{game.name}</h1>
          </div>
        </div>
        <div className={styles.sbTicker}>
          <div className={styles.sbCell}><span>{loading ? '—' : subCount.toLocaleString()}</span><label>Fans</label></div>
          <div className={styles.sbCell}><span>{loading ? '—' : tournaments.filter(t => t.status === 'active').length}</span><label>Open</label></div>
          <div className={styles.sbCell}><span className={styles.sbLive}>{loading ? '—' : tournaments.filter(t => t.status === 'ongoing').length}</span><label>Live</label></div>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`} onClick={toggleSubscribe}>
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} /> {subscribed ? 'Following' : 'Follow Club'}
        </button>
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Fan Chat</Link>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-calendar-event-line" /> Fixtures</h2>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No fixtures scheduled.</p>}
        <div className={styles.fixtureList}>
          {tournaments.map(t => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.fixture} ${st.isFull && !st.isOngoing ? styles.fixtureLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <div className={styles.fixtureMain}>
                  <span className={styles.fixtureName}>{t.name}</span>
                  {t.format && <span className={styles.fixtureFormat}>{t.format}</span>}
                </div>
                <div className={styles.fixtureScore}>
                  {st.isOngoing ? <span className={styles.fixtureLiveTag}>● LIVE</span> : <span className={styles.fixtureSlots}>{t.registered_count || 0}/{t.slots}</span>}
                  <span className={st.hasFee ? styles.fixtureFee : styles.fixtureFree}>{st.hasFee ? `TZS ${fmtFee(t.entrance_fee)}` : 'Free'}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-star-fill" /> Player of the Week</h2>
        {masterLoading && <div className={styles.potmSkel} />}
        {!masterLoading && !master && <p className={styles.empty}>No player of the week yet.</p>}
        {!masterLoading && master && (
          <div className={styles.potm}>
            <span className={styles.potmRating}>{Math.min(99, 70 + Math.floor((master.total_wins || 0) / 2))}</span>
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.potmAvatar} />
              : <div className={styles.potmAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.potmInfo}>
              <span className={styles.potmName}>{master.username}</span>
              <span className={styles.potmTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} · {formatMasterDate(master.crowned_at)}</span>
            </div>
            <div className={styles.potmStats}><span>{master.total_wins}W</span><span>{master.total_points}pt</span></div>
          </div>
        )}
      </div>
    </div>
  )
}
