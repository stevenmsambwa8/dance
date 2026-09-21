'use client'
import Link from 'next/link'
import styles from './Cpm2.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function Cpm2Layout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <div className={styles.showroom}>
        {game.image && <div className={styles.showroomBg} style={{ backgroundImage: `url(${game.image})` }} />}
        <div className={styles.showroomFloor} />
        <div className={styles.showroomText}>
          <span className={styles.plate}>{game.tag || 'Start Your Engine'}</span>
          <h1 className={styles.name}>{game.name}</h1>
          <p className={styles.full}>{game.full}</p>
        </div>
      </div>

      <div className={styles.dash}>
        <div className={styles.gauge}><span>{loading ? '—' : subCount.toLocaleString()}</span><label>Drivers</label></div>
        <div className={styles.gauge}><span>{loading ? '—' : tournaments.filter(t => t.status === 'active').length}</span><label>Events</label></div>
        <div className={styles.gauge}><span className={styles.gaugeHot}>{loading ? '—' : tournaments.filter(t => t.status === 'ongoing').length}</span><label>Racing Now</label></div>
      </div>

      <div className={styles.actions}>
        <button className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`} onClick={toggleSubscribe}>
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} /> {subscribed ? 'Subscribed' : 'Subscribe'}
        </button>
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Garage Chat</Link>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-flag-2-line" /> Upcoming Events</h2>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No events on the calendar yet.</p>}
        <div className={styles.eventGrid}>
          {tournaments.map(t => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.event} ${st.isFull && !st.isOngoing ? styles.eventLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <div className={styles.eventTop}>
                  <i className="ri-speed-up-line" />
                  {st.isOngoing && <span className={styles.eventLive}>Racing</span>}
                </div>
                <span className={styles.eventName}>{t.name}</span>
                {t.format && <span className={styles.eventFormat}>{t.format}</span>}
                <div className={styles.eventFoot}>
                  <span>{t.registered_count || 0}/{t.slots} cars</span>
                  {st.hasFee ? <span className={styles.eventFee}>TZS {fmtFee(t.entrance_fee)}</span> : <span className={styles.eventFree}>Free entry</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-steering-2-fill" /> Top Driver</h2>
        {masterLoading && <div className={styles.driverSkel} />}
        {!masterLoading && !master && <p className={styles.empty}>No top driver crowned this week.</p>}
        {!masterLoading && master && (
          <div className={styles.driverCard}>
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.driverAvatar} />
              : <div className={styles.driverAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.driverInfo}>
              <span className={styles.driverName}>{master.username}</span>
              <span className={styles.driverTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} · since {formatMasterDate(master.crowned_at)}</span>
            </div>
            <div className={styles.driverStats}><span>{master.total_wins}W</span><span>{master.total_points}pt</span></div>
          </div>
        )}
      </div>
    </div>
  )
}
