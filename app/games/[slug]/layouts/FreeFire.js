'use client'
import Link from 'next/link'
import styles from './FreeFire.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function FreeFireLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <Link href="/games" className={styles.back}><i className="ri-arrow-left-line" /> All Games</Link>

      <div className={styles.hero}>
        {game.image && <img src={game.image} alt={game.name} className={styles.heroImg} />}
        <div className={styles.heroShape} />
        <div className={styles.heroText}>
          <span className={styles.tag}><i className="ri-flashlight-fill" /> {game.tag || 'Booyah!'}</span>
          <h1 className={styles.name}>{game.name}</h1>
        </div>
      </div>

      <div className={styles.statPills}>
        <span className={styles.pill}><i className="ri-user-line" /> {loading ? '…' : subCount.toLocaleString()} squad</span>
        <span className={styles.pill}><i className="ri-trophy-line" /> {loading ? '…' : tournaments.filter(t => t.status === 'active').length} open</span>
        <button className={`${styles.pillBtn} ${subscribed ? styles.pillBtnActive : ''}`} onClick={toggleSubscribe}>
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} /> {subscribed ? 'Subscribed' : 'Subscribe'}
        </button>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Join Squad Chat</Link>

      {/* Booyah spotlight first — celebrate the current champ up top */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-fire-fill" /> Booyah of the Week</h2>
        {masterLoading && <div className={styles.spotSkel} />}
        {!masterLoading && !master && (
          <div className={styles.spotEmpty}><i className="ri-trophy-line" /><p>No champion yet — go claim the crown!</p></div>
        )}
        {!masterLoading && master && (
          <div className={styles.spotlight}>
            <div className={styles.spotGlow} />
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.spotAvatar} />
              : <div className={styles.spotAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.spotName}>{master.username}</div>
            <div className={styles.spotTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'}</div>
            <div className={styles.spotStats}>
              <span><strong>{master.total_wins}</strong> wins</span>
              <span><strong>{master.total_points}</strong> pts</span>
            </div>
            <div className={styles.spotDate}>Since {formatMasterDate(master.crowned_at)}</div>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-sword-fill" /> Live Matches</h2>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No active matches yet — check back soon.</p>}
        <div className={styles.cardGrid}>
          {tournaments.map(t => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.mCard} ${st.isFull && !st.isOngoing ? styles.mCardLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                {st.isOngoing && <span className={styles.mLive}>LIVE</span>}
                <span className={styles.mName}>{t.name}</span>
                {t.format && <span className={styles.mFormat}>{t.format}</span>}
                <div className={styles.mFoot}>
                  <span>{t.registered_count || 0}/{t.slots}</span>
                  {st.hasFee ? <span className={styles.mFee}>TZS {fmtFee(t.entrance_fee)}</span> : <span className={styles.mFree}>Free</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
