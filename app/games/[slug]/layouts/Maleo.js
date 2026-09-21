'use client'
import Link from 'next/link'
import styles from './Maleo.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function MaleoLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroTop}>
          {game.image && <img src={game.image} alt={game.name} className={styles.logo} />}
          <div>
            <span className={styles.tag}>{game.tag || 'On The Road'}</span>
            <h1 className={styles.name}>{game.name}</h1>
            <p className={styles.full}>{game.full}</p>
          </div>
        </div>
        <div className={styles.road}>
          <div className={styles.roadLine} />
          <div className={styles.roadStats}>
            <span><strong>{loading ? '—' : subCount.toLocaleString()}</strong> drivers</span>
            <span><strong>{loading ? '—' : tournaments.filter(t => t.status === 'active').length}</strong> routes open</span>
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`} onClick={toggleSubscribe}>
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} /> {subscribed ? 'Subscribed' : 'Subscribe'}
        </button>
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Convoy Chat</Link>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-route-line" /> Route Schedule</h2>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No routes scheduled yet.</p>}
        <div className={styles.timeline}>
          {tournaments.map((t, i) => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.stop} ${st.isFull && !st.isOngoing ? styles.stopLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <div className={styles.stopMarker}>
                  <span className={styles.stopDot} />
                  {i !== tournaments.length - 1 && <span className={styles.stopConnector} />}
                </div>
                <div className={styles.stopCard}>
                  <div className={styles.stopHead}>
                    <span className={styles.stopName}>{t.name}</span>
                    {st.isOngoing && <span className={styles.stopLive}>En Route</span>}
                  </div>
                  {t.format && <span className={styles.stopFormat}>{t.format}</span>}
                  <div className={styles.stopFoot}>
                    <span>{t.registered_count || 0}/{t.slots} boarded</span>
                    {st.hasFee ? <span className={styles.stopFee}>TZS {fmtFee(t.entrance_fee)}</span> : <span className={styles.stopFree}>Free ride</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-steering-2-line" /> Top Driver</h2>
        {masterLoading && <div className={styles.driverSkel} />}
        {!masterLoading && !master && <p className={styles.empty}>No driver crowned this week.</p>}
        {!masterLoading && master && (
          <div className={styles.plaque}>
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.plaqueAvatar} />
              : <div className={styles.plaqueAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.plaqueInfo}>
              <span className={styles.plaqueName}>{master.username}</span>
              <span className={styles.plaqueTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} Driver · since {formatMasterDate(master.crowned_at)}</span>
            </div>
            <span className={styles.plaqueWins}>{master.total_wins} wins</span>
          </div>
        )}
      </div>
    </div>
  )
}
