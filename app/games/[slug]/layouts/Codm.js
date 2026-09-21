'use client'
import Link from 'next/link'
import SubscribeButton from '../../../../components/SubscribeButton'
import styles from './Codm.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function CodmLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <div className={styles.poster}>
        {game.image && <img src={game.image} alt={game.name} className={styles.posterImg} />}
        <div className={styles.posterScrim} />
        <div className={styles.posterText}>
          <span className={styles.rating}><i className="ri-shield-star-fill" /> {game.genre}</span>
          <h1 className={styles.name}>{game.name}</h1>
          <p className={styles.full}>{game.full}</p>
        </div>
      </div>

      <div className={styles.controlRow}>
        <SubscribeButton subscribed={subscribed} onClick={toggleSubscribe} variant="dark" />
        <Link href={`/games/${slug}/chat`} className={styles.ctrlBtn}><i className="ri-group-line" /> Squad</Link>
        <div className={styles.ctrlStat}><span>{loading ? '—' : subCount.toLocaleString()}</span>players</div>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <div className={styles.section}>
        <div className={styles.sectionHead}><i className="ri-award-fill" /><h2>Multiplayer Lobbies</h2></div>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No lobbies open right now.</p>}
        <div className={styles.lobbyList}>
          {tournaments.map(t => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.lobby} ${st.isFull && !st.isOngoing ? styles.lobbyLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <div className={styles.lobbyRank}><i className={st.isOngoing ? 'ri-play-circle-fill' : 'ri-lock-unlock-line'} /></div>
                <div className={styles.lobbyInfo}>
                  <span className={styles.lobbyName}>{t.name}</span>
                  <div className={styles.lobbyMeta}>
                    {t.format && <span>{t.format}</span>}
                    <span>{t.registered_count || 0}/{t.slots} deployed</span>
                  </div>
                </div>
                <div className={styles.lobbyRight}>
                  {t.prize && <span className={styles.lobbyPrize}>{t.prize}</span>}
                  <span className={`${styles.lobbyBadge} ${st.isOngoing ? styles.badgeLive : st.isJoined ? styles.badgeJoined : st.isFull ? styles.badgeFull : styles.badgeOpen}`}>
                    {st.isOngoing ? 'LIVE' : st.isJoined ? 'Joined' : st.isFull ? 'Full' : st.hasFee ? `TZS ${fmtFee(t.entrance_fee)}` : 'Open'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}><i className="ri-medal-2-fill" /><h2>Season MVP</h2></div>
        {masterLoading && <div className={styles.mvpSkel} />}
        {!masterLoading && !master && <p className={styles.empty}>No MVP crowned this week.</p>}
        {!masterLoading && master && (
          <div className={styles.mvpCard}>
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.mvpAvatar} />
              : <div className={styles.mvpAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.mvpInfo}>
              <span className={styles.mvpName}>{master.username}</span>
              <span className={styles.mvpMeta} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} · {formatMasterDate(master.crowned_at)}</span>
            </div>
            <div className={styles.mvpStats}>
              <span>{master.total_wins}W</span>
              <span>{master.total_points}pt</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
