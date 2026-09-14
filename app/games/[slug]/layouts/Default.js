'use client'
import Link from 'next/link'
import styles from './Default.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

// Generic fallback layout — used only if a game slug doesn't have a
// dedicated custom layout registered in layouts/index.js yet.
export default function DefaultLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <div className={styles.hero} style={{ '--gc': game.color || 'var(--accent)' }}>
        {game.image && <div className={styles.heroBg} style={{ backgroundImage: `url(${game.image})` }} />}
        <Link href="/games" className={styles.back}><i className="ri-arrow-left-line" /> All Games</Link>
        <div className={styles.heroInner}>
          <span className={styles.genreChip}>{game.genre}</span>
          <h1 className={styles.name}>{game.name}</h1>
          {game.full && <p className={styles.full}>{game.full}</p>}
          <div className={styles.stats}>
            <div><span>{loading ? '—' : subCount.toLocaleString()}</span><label>Subscribers</label></div>
            <div><span>{loading ? '—' : tournaments.filter(t => t.status === 'active').length}</span><label>Active</label></div>
            <div><span>{loading ? '—' : tournaments.filter(t => t.status === 'ongoing').length}</span><label>Ongoing</label></div>
          </div>
        </div>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <div className={styles.actions}>
        <button className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`} onClick={toggleSubscribe}>
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} /> {subscribed ? 'Subscribed' : 'Subscribe'}
        </button>
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Group Chat</Link>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-crown-line" /> Weekly Master</h2>
        {masterLoading && <div className={styles.skel} />}
        {!masterLoading && !master && <p className={styles.empty}>No master crowned yet this week.</p>}
        {!masterLoading && master && (
          <div className={styles.master}>
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.masterAvatar} />
              : <div className={styles.masterAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.masterInfo}>
              <span className={styles.masterName}>{master.username}</span>
              <span className={styles.masterTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} · {formatMasterDate(master.crowned_at)}</span>
            </div>
            <div className={styles.masterStats}><span>{master.total_wins}W</span><span>{master.total_points}pt</span></div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-trophy-line" /> Tournaments</h2>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No active tournaments for this game yet.</p>}
        <div className={styles.list}>
          {tournaments.map(t => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.row} ${st.isFull && !st.isOngoing ? styles.rowLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <div className={styles.rowInfo}>
                  <span className={styles.rowName}>{t.name}</span>
                  {t.format && <span className={styles.rowFormat}>{t.format}</span>}
                </div>
                <span className={styles.rowBadge}>{st.isOngoing ? 'Live' : st.isJoined ? 'Joined' : st.isFull ? 'Full' : st.hasFee ? `TZS ${fmtFee(t.entrance_fee)}` : 'Open'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
