'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import { getCurrentSeason } from '../../lib/seasons'

const GAME_NAMES = Object.fromEntries(GAME_SLUGS.map(s => [s, GAME_META[s].name]))

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonTop}>
        <div className={styles.skeletonBadge} />
        <div className={styles.skeletonBadge} style={{ width: 60 }} />
      </div>
      <div className={styles.skeletonTitle} />
      <div className={styles.skeletonDesc} />
      <div className={styles.skeletonStats}>
        <div className={styles.skeletonStat} />
        <div className={styles.skeletonStat} />
        <div className={styles.skeletonStat} />
      </div>
    </div>
  )
}

export default function Tournaments() {
  const { user, isAdmin } = useAuth()
  const router = useRouter()
  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)
  const [filter, setFilter] = useState('all')
  const [registered, setRegistered] = useState({})


  useEffect(() => { loadTournaments() }, [filter])

  // Keep registered_count live for all tournaments
  useEffect(() => {
    const ch = supabase
      .channel('tourney-list-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, () => {
        loadTournaments()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  useEffect(() => {
    if (!user || tournaments.length === 0) return
    supabase.from('tournament_participants').select('tournament_id').eq('user_id', user.id)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(r => { map[r.tournament_id] = true })
        setRegistered(map)
      })
  }, [user, tournaments.length])

  async function loadTournaments() {
    setLoading(true)
    let q = supabase.from('tournaments').select('*').order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('game_slug', filter)
    const { data } = await q
    const all = data || []
    // Hide test tournaments from users who aren't the creator or admin
    const visible = all.filter(t => {
      if (!t.is_test) return true
      if (!user) return false
      return isAdmin || t.created_by === user.id
    })
    setTournaments(visible)
    setLoading(false)
  }



  function fillPct(t) {
    const count = t.registered_count || 0
    const slots = t.slots || 1
    return Math.min(100, Math.round((count / slots) * 100))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Season {getCurrentSeason()}</p>
          <h1 className={styles.headline}>TOURNAMENTS</h1>
        </div>
        {user && (
          <button className={styles.createBtn} onClick={() => router.push('/tournaments/create')} title="Create Tournament" aria-label="Create Tournament">
            <i className="ri-add-line" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        {['all', ...GAME_SLUGS].map(f => (
          <button
            key={f}
            className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
            onClick={() => setFilter(f)}
          >{f === 'all' ? 'All Games' : GAME_NAMES[f] || f}</button>
        ))}
      </div>

      {/* List */}
      {!loading && tournaments.length === 0 && (
        <div className={styles.empty}>
          <i className="ri-tournament-line" />
          <p>No tournaments found</p>
          <span>Check back later or try a different filter</span>
        </div>
      )}
      {!loading && tournaments.length > 0 && (
        <div className={styles.list}>
          {tournaments.map(t => {
            const pct = fillPct(t)
            const isFull = (t.registered_count || 0) >= t.slots
            const isReg = registered[t.id]
            return (
              <div key={t.id} className={styles.card} onClick={() => router.push(`/tournaments/${t.slug || t.id}`)}>
                {/* Top row */}
                <div className={styles.cardTop}>
                  <div className={styles.cardMeta}>
                    <Link href={`/games/${t.game_slug}`} className={styles.gameTag} onClick={e => e.stopPropagation()}>
                      {GAME_NAMES[t.game_slug] || t.game_slug}
                    </Link>
                    <span className={`${styles.statusBadge} ${styles[t.status]}`}>{t.status}</span>
                    {t.is_test && (
                      <span className={styles.testBadge}><i className="ri-flask-line" /> Test</span>
                    )}
                    {isReg && (
                      <span className={styles.regBadge}>
                        <i className="ri-checkbox-circle-fill" /> Registered
                      </span>
                    )}
                    {isFull && !isReg && <span className={styles.fullBadge}><i className="ri-lock-line" /> Full</span>}
                  </div>
                  <h3 className={styles.cardName}>{t.name}</h3>
                  {t.description && <p className={styles.cardDesc}>{t.description}</p>}
                </div>

                {/* Stats row */}
                <div className={styles.cardStats}>
                  {t.format && <span><i className="ri-gamepad-line" />{t.format}</span>}
                  <span><i className="ri-trophy-line" />TZS {t.prize || 'N/A'}</span>
                  {t.date && <span><i className="ri-calendar-event-line" />{t.date}</span>}
                </div>

                {/* Slot progress bar */}
                <div className={styles.slotBar}>
                  <div className={styles.slotBarLabels}>
                    <span className={styles.slotBarLeft}>
                      <i className="ri-group-line" /> {t.registered_count || 0} / {t.slots} players
                    </span>
                    <span className={`${styles.slotBarPct} ${pct >= 80 ? styles.slotHot : ''}`}>
                      {pct}%{pct >= 80 && <> <i className="ri-fire-line" /></>}
                    </span>
                  </div>
                  <div className={styles.slotTrack}>
                    <div
                      className={`${styles.slotFill} ${isFull ? styles.slotFull : pct >= 80 ? styles.slotWarm : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className={styles.cardFooter}>
                  <span className={styles.viewLink}>
                    View bracket &amp; details <i className="ri-arrow-right-line" />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}


    </div>
  )
}
