'use client'
import Link from 'next/link'
import styles from './Pubg.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function PubgLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, pastMasters, formatMasterDate } = data

  const active  = tournaments.filter(t => t.status === 'active').length
  const ongoing = tournaments.filter(t => t.status === 'ongoing').length

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        {game.image && <div className={styles.heroBg} style={{ backgroundImage: `url(${game.image})` }} />}
        <div className={styles.heroScrim} />
        <div className={styles.grid} />
        <Link href="/games" className={styles.back}><i className="ri-arrow-left-line" /> All Games</Link>
        <div className={styles.heroInner}>
          <span className={styles.dropTag}>{game.tag || 'Winner Winner'}</span>
          <h1 className={styles.name}>{game.name}</h1>
          <p className={styles.full}>{game.full}</p>
          <div className={styles.hud}>
            <div className={styles.hudCell}><span>{loading ? '—' : subCount.toLocaleString()}</span><label>Squad</label></div>
            <div className={styles.hudDiv} />
            <div className={styles.hudCell}><span>{loading ? '—' : active}</span><label>Active</label></div>
            <div className={styles.hudDiv} />
            <div className={styles.hudCell}><span className={ongoing ? styles.hot : ''}>{loading ? '—' : ongoing}</span><label>Live Now</label></div>
          </div>
        </div>
      </div>

      <div className={styles.actionRow}>
        <button className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`} onClick={toggleSubscribe}>
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} /> {subscribed ? 'Enlisted' : 'Enlist'}
        </button>
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Squad Chat</Link>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2><i className="ri-crosshair-2-line" /> Active Drops</h2>
          {!loading && <span>{tournaments.length} open</span>}
        </div>

        {!loading && tournaments.length === 0 && <p className={styles.empty}>No active drops for this game yet.</p>}

        <div className={styles.missionList}>
          {tournaments.map((t, i) => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.mission} ${st.isFull && !st.isOngoing ? styles.missionLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <span className={styles.missionNum}>{String(i + 1).padStart(2, '0')}</span>
                <div className={styles.missionBody}>
                  <div className={styles.missionTop}>
                    <span className={styles.missionName}>{t.name}</span>
                    {st.isOngoing && <span className={styles.tagLive}><i className="ri-broadcast-line" /> LIVE</span>}
                  </div>
                  {t.format && <span className={styles.missionFormat}>{t.format}</span>}
                  <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${st.fillPct}%` }} /></div>
                </div>
                <div className={styles.missionRight}>
                  {t.prize && <span className={styles.missionPrize}>{t.prize}</span>}
                  <span className={styles.missionSlots}>{t.registered_count || 0}/{t.slots}</span>
                  {st.hasFee && <span className={styles.missionFee}>TZS {fmtFee(t.entrance_fee)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}><h2><i className="ri-medal-line" /> Top Operator This Week</h2></div>
        {masterLoading && <div className={styles.opSkel} />}
        {!masterLoading && !master && (
          <div className={styles.opEmpty}><i className="ri-sword-line" /> No operator crowned yet — drop in and claim it.</div>
        )}
        {!masterLoading && master && (
          <div className={styles.opCard}>
            <div className={styles.opAvatarWrap}>
              {master.avatar_url ? <img src={master.avatar_url} alt={master.username} className={styles.opAvatar} />
                : <div className={styles.opAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            </div>
            <div className={styles.opInfo}>
              <span className={styles.opName}>{master.username}</span>
              <span className={styles.opTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} Operator</span>
              <span className={styles.opDate}>Crowned {formatMasterDate(master.crowned_at)}</span>
            </div>
            <div className={styles.opStats}>
              <div><strong>{master.total_wins}</strong><span>Wins</span></div>
              <div><strong>{master.total_points}</strong><span>Pts</span></div>
            </div>
          </div>
        )}
        {pastMasters.length > 0 && (
          <div className={styles.pastList}>
            {pastMasters.map(pm => (
              <div key={pm.id} className={styles.pastRow}>
                <span className={styles.pastName}>{pm.profiles?.username}</span>
                <span className={styles.pastWins}>{pm.total_wins}W</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
