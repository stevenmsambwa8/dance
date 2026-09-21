'use client'
import Link from 'next/link'
import SubscribeButton from '../../../../components/SubscribeButton'
import styles from './Ufl.module.css'
import { tournamentStatus, onRowClick, fmtFee } from './helpers'
import { getTierColor } from '../useGameData'

export default function UflLayout({ data }) {
  const { game, slug, subCount, subscribed, toggleSubscribe, tournaments, loading,
    master, masterLoading, formatMasterDate } = data

  return (
    <div className={styles.page}>
      <div className={styles.vsHero}>
        <div className={styles.vsRow}>
          <div className={styles.vsSide}>
            {game.image && <img src={game.image} alt={game.name} className={styles.vsImg} />}
          </div>
          <span className={styles.vsBadge}>VS</span>
          <div className={styles.vsSide}>
            <div className={styles.vsPlaceholder}><i className="ri-user-3-line" /></div>
          </div>
        </div>
        <h1 className={styles.name}>{game.name}</h1>
        <p className={styles.full}>{game.full}</p>
      </div>

      <div className={styles.actions}>
        <SubscribeButton subscribed={subscribed} onClick={toggleSubscribe} className={styles.subBtn} />
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}><i className="ri-group-line" /> Chat</Link>
      </div>

      <div className={styles.statBar}>
        <span><strong>{loading ? '—' : subCount.toLocaleString()}</strong> players</span>
        <span><strong>{loading ? '—' : tournaments.filter(t => t.status === 'active').length}</strong> open</span>
        <span><strong>{loading ? '—' : tournaments.filter(t => t.status === 'ongoing').length}</strong> live</span>
      </div>

      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-git-branch-line" /> Brackets</h2>
        {!loading && tournaments.length === 0 && <p className={styles.empty}>No brackets open yet.</p>}
        <div className={styles.bracketList}>
          {tournaments.map(t => {
            const st = tournamentStatus(t, data)
            return (
              <div key={t.id} className={`${styles.bracket} ${st.isFull && !st.isOngoing ? styles.bracketLocked : ''}`}
                onClick={() => onRowClick(t, data, st)}>
                <div className={styles.bracketVs}>
                  <span className={styles.bracketDot} /><span className={styles.bracketDot} />
                </div>
                <div className={styles.bracketInfo}>
                  <span className={styles.bracketName}>{t.name}</span>
                  {t.format && <span className={styles.bracketFormat}>{t.format}</span>}
                </div>
                <div className={styles.bracketRight}>
                  {st.isOngoing && <span className={styles.bracketLive}>Live</span>}
                  <span className={styles.bracketSlots}>{t.registered_count || 0}/{t.slots}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}><i className="ri-vip-crown-2-fill" /> Reigning Champion</h2>
        {masterLoading && <div className={styles.champSkel} />}
        {!masterLoading && !master && <p className={styles.empty}>No champion crowned this week.</p>}
        {!masterLoading && master && (
          <div className={styles.champ}>
            {master.avatar_url
              ? <img src={master.avatar_url} alt={master.username} className={styles.champAvatar} />
              : <div className={styles.champAvatarFallback}>{master.username?.[0]?.toUpperCase()}</div>}
            <div className={styles.champInfo}>
              <span className={styles.champName}>{master.username}</span>
              <span className={styles.champTier} style={{ color: getTierColor(master.tier) }}>{master.tier || 'Gold'} · {formatMasterDate(master.crowned_at)}</span>
            </div>
            <span className={styles.champWins}>{master.total_wins}W</span>
          </div>
        )}
      </div>
    </div>
  )
}
