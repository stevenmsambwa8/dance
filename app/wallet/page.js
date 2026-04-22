'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import usePageLoading from '../../components/usePageLoading'
import styles from './page.module.css'

const TYPE_META = {
  match_win:           { label: 'Match Win',        icon: 'ri-sword-line',               color: '#22c55e' },
  match_loss:          { label: 'Match Loss',        icon: 'ri-sword-line',               color: '#94a3b8' },
  tournament_win:      { label: 'Round Win',         icon: 'ri-trophy-line',              color: '#60a5fa' },
  tournament_advance:  { label: 'Round Advance',     icon: 'ri-arrow-right-up-line',      color: '#60a5fa' },
  tournament_eliminate:{ label: 'Eliminated',        icon: 'ri-close-circle-line',        color: '#94a3b8' },
  tournament_champion: { label: 'Champion Bonus',    icon: 'ri-vip-crown-fill',           color: '#f59e0b' },
  tournament_podium:   { label: 'Podium Finish',     icon: 'ri-medal-line',               color: '#a78bfa' },
  prize:               { label: 'Prize Awarded',     icon: 'ri-money-dollar-circle-line', color: '#f59e0b' },
  shop_payout:         { label: 'Shop Sale',         icon: 'ri-store-2-line',             color: '#34d399' },
}

function typeMeta(type) {
  return TYPE_META[type] || { label: type || 'Activity', icon: 'ri-history-line', color: 'var(--text-muted)' }
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTZS(n) {
  return `TZS ${Number(n).toLocaleString('en-TZ')}`
}

export default function WalletPage() {
  const { user, profile } = useAuth()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  usePageLoading(loading)

  useEffect(() => { if (user) loadLogs() }, [user])

  async function loadLogs() {
    setLoading(true)
    const { data } = await supabase
      .from('earnings_log')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200)
    setLogs(data || [])
    setLoading(false)
  }

  const filtered = filter === 'all'
    ? logs
    : logs.filter(l => {
        if (filter === 'shop') return l.type === 'shop_payout'
        if (filter === 'prize') return l.type === 'prize'
        return l.type?.startsWith(filter)
      })

  const totalPts   = logs.filter(l => l.type !== 'prize').reduce((s, l) => s + (l.points ?? 0), 0)
  const matchPts   = logs.filter(l => l.type?.startsWith('match')).reduce((s, l) => s + (l.points ?? 0), 0)
  const tourneyPts = logs.filter(l => l.type?.startsWith('tournament')).reduce((s, l) => s + (l.points ?? 0), 0)
  const prizeTZS   = logs.filter(l => l.type === 'prize').reduce((s, l) => s + (l.points ?? 0), 0)
  const shopCount  = logs.filter(l => l.type === 'shop_payout').length

  if (!user) return (
    <div className={styles.page}>
      <p className={styles.empty}>Sign in to view your earnings.</p>
    </div>
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h1 className={styles.title}><i className="ri-wallet-3-line" /> Wallet</h1>
          <span className={styles.totalBadge}>{profile?.points ?? 0} pts total</span>
        </div>
        <p className={styles.sub}>Your full earnings history</p>
      </div>

      {/* Stats */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statVal} style={{ color: '#22c55e' }}>{matchPts}</span>
          <span className={styles.statLabel}>Match pts</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statVal} style={{ color: '#60a5fa' }}>{tourneyPts}</span>
          <span className={styles.statLabel}>Tournament pts</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statVal} style={{ color: '#f59e0b', fontSize: prizeTZS >= 10000 ? 11 : undefined }}>
            {prizeTZS > 0 ? fmtTZS(prizeTZS) : '—'}
          </span>
          <span className={styles.statLabel}>Prize money</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statVal} style={{ color: '#34d399' }}>{shopCount}</span>
          <span className={styles.statLabel}>Shop sales</span>
        </div>
      </div>

      {/* Filter */}
      <div className={styles.filters}>
        {[
          { key: 'all',        label: 'All' },
          { key: 'match',      label: 'Matches' },
          { key: 'tournament', label: 'Tournaments' },
          { key: 'prize',      label: 'Prizes' },
          { key: 'shop',       label: 'Shop' },
        ].map(f => (
          <button
            key={f.key}
            className={`${styles.filterBtn} ${filter === f.key ? styles.filterActive : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Log */}
      {loading ? (
        <div className={styles.skeletonList}>
          {[...Array(6)].map((_, i) => <div key={i} className={styles.skeletonRow} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <i className="ri-inbox-2-line" />
          <p>No earnings yet</p>
        </div>
      ) : (
        <div className={styles.logList}>
          {filtered.map((log, i) => {
            const meta = typeMeta(log.type)
            const pts  = log.points ?? 0
            const isShop  = log.type === 'shop_payout'
            const isPrize = log.type === 'prize'
            return (
              <div key={log.id || i} className={styles.logRow}>
                <div className={styles.logIcon} style={{ color: meta.color, background: meta.color + '18' }}>
                  <i className={meta.icon} />
                </div>
                <div className={styles.logInfo}>
                  <span className={styles.logLabel}>{meta.label}</span>
                  {log.description && <span className={styles.logDesc}>{log.description}</span>}
                  <span className={styles.logDate}>{formatDate(log.created_at)}</span>
                </div>
                {isShop ? (
                  <span className={styles.logPts} style={{ color: '#34d399', fontSize: 11, textAlign: 'right', maxWidth: 80 }}>
                    Paid out
                  </span>
                ) : isPrize ? (
                  <span className={styles.logPts} style={{ color: '#f59e0b', fontSize: pts >= 10000 ? 10 : 12, textAlign: 'right', maxWidth: 90, fontWeight: 800 }}>
                    {pts > 0 ? fmtTZS(pts) : '—'}
                  </span>
                ) : (
                  <span className={`${styles.logPts} ${pts > 0 ? styles.logPtsPos : styles.logPtsNeg}`}>
                    {pts > 0 ? `+${pts}` : pts} pts
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
