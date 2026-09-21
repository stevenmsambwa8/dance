'use client'
import Link from 'next/link'
import styles from './Dls.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function DlsLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, pastMasters, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        {game.image && <img src={game.image} alt={game.name} className={styles.crest} />}
        <h1 className={styles.name}>{game.name}</h1>
        <p className={styles.full}>{game.full}</p>
        <div className={styles.subRow}>
          <button className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`} onClick={toggleSubscribe}>
            <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} /> {subscribed ? 'Subscribed' : 'Subscribe'}
          </button>
          <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Club Chat</Link>
        </div>
        <div className={styles.stats}>
          <span><strong>{loading ? '—' : subCount.toLocaleString()}</strong> managers</span>
          <span><strong>{loading ? '—' : tournaments.filter(t => t.status === 'active').length}</strong> open</span>
        </div>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      {/* Trophy cabinet up top */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-trophy-fill" /> Trophy Cabinet</h2>
        {masterLoading && <div className={styles.cabinetSkel} />}
        {!masterLoading && !master && <p className={styles.empty}>The cabinet is empty — win a cup to fill it.</p>}
        {!masterLoading && master && (
          <div className={styles.cabinet}>
            <i className={styles.cabinetTrophy + ' ri-trophy-fill'} />
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.cabinetAvatar} />
              : <div className={styles.cabinetAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.cabinetInfo}>
              <span className={styles.cabinetName}>{master.username}</span>
              <span className={styles.cabinetTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} Manager</span>
              <span className={styles.cabinetDate}>Champion since {formatMasterDate(master.crowned_at)}</span>
            </div>
            <div className={styles.cabinetStats}>
              <div><strong>{master.total_wins}</strong><span>W</span></div>
              <div><strong>{master.total_points}</strong><span>Pts</span></div>
            </div>
          </div>
        )}
        {pastMasters.length > 0 && (
          <div className={styles.pastRow}>
            {pastMasters.map(pm => (
              <div key={pm.id} className={styles.pastChip}>
                <span>{pm.profiles?.username}</span><small>{pm.total_wins}W</small>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-shield-star-fill" /> Leagues &amp; Cups</h2>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No competitions open right now.</p>}
        <div className={styles.compGrid}>
          {tournaments.map(t => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.comp} ${st.isFull && !st.isOngoing ? styles.compLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <div className={styles.compBadge}><i className="ri-shield-line" /></div>
                <span className={styles.compName}>{t.name}</span>
                {t.format && <span className={styles.compFormat}>{t.format}</span>}
                {t.prize && <span className={styles.compPrize}><i className="ri-trophy-line" /> {t.prize}</span>}
                <div className={styles.compFoot}>
                  <span>{t.registered_count || 0}/{t.slots}</span>
                  {st.isOngoing && <span className={styles.compLive}>Live</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
