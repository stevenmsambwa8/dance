'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import usePageLoading from '../../components/usePageLoading'
import styles from './page.module.css'

const CLAN_CAP  = 125
const SQUAD_CAP = 25

export default function ClansPage() {
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  const [game, setGame]       = useState(GAME_SLUGS[0])
  const [clans, setClans]     = useState([])
  const [myClanCode, setMyClanCode] = useState(null)
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)

  useEffect(() => { loadClans(game) }, [game, user])

  async function loadClans(g) {
    setLoading(true)
    const { data } = await supabase
      .from('clans')
      .select('*')
      .eq('game', g)
      .order('member_count', { ascending: false })
      .limit(60)
    setClans(data || [])

    if (user) {
      const { data: membership } = await supabase
        .from('clan_members')
        .select('clan_id, clans!inner(code, game)')
        .eq('user_id', user.id)
        .eq('clans.game', g)
        .maybeSingle()
      setMyClanCode(membership?.clans?.code || null)
    } else {
      setMyClanCode(null)
    }
    setLoading(false)
  }

  function handleCreate() {
    if (!user) { openAuthGate(); return }
    router.push(`/clans/create?game=${game}`)
  }

  const filtered = clans.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Squad up · Compete together</p>
          <h1 className={styles.headline}>CLANS</h1>
        </div>
        {myClanCode ? (
          <button className={styles.myClanBtn} onClick={() => router.push(`/clans/${myClanCode}`)}>
            <i className="ri-shield-star-line"/> My Clan
          </button>
        ) : (
          <button className={styles.createBtn} onClick={handleCreate}>
            <i className="ri-add-line"/> Create Clan
          </button>
        )}
      </div>

      <div className={styles.gameTabs}>
        {GAME_SLUGS.map(g => (
          <button key={g}
            className={`${styles.gameTab} ${game === g ? styles.gameTabActive : ''}`}
            onClick={() => setGame(g)}>
            <i className={GAME_META[g]?.icon}/> {GAME_META[g]?.name || g}
          </button>
        ))}
      </div>

      <div className={styles.searchWrap}>
        <i className="ri-search-line"/>
        <input className={styles.searchInput} placeholder="Search clans…"
          value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      <div className={styles.infoStrip}>
        <span><i className="ri-group-line"/> {CLAN_CAP} max members</span>
        <span>·</span>
        <span><i className="ri-team-line"/> {SQUAD_CAP} squads · 5 per squad</span>
      </div>

      {loading && (
        <div className={styles.grid}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className={styles.skeletonCard} style={{ opacity: 1 - i * 0.12 }}/>
          ))}
        </div>
      )}

      {!loading && (
        <div className={styles.grid}>
          {filtered.map(clan => {
            const pct = Math.min(100, Math.round((clan.member_count / CLAN_CAP) * 100))
            const isFull = clan.member_count >= CLAN_CAP
            return (
              <Link key={clan.code} href={`/clans/${clan.code}`} className={styles.clanCard}>
                <div className={styles.clanLogo}>
                  {clan.logo_url
                    ? <img src={clan.logo_url} alt=""/>
                    : <span>{clan.tag_prefix}</span>
                  }
                </div>
                <div className={styles.clanInfo}>
                  <div className={styles.clanNameRow}>
                    <span className={styles.clanName}>{clan.name}</span>
                    <span className={styles.clanTag}>{clan.tag_prefix}</span>
                  </div>
                  <div className={styles.clanStats}>
                    <span><i className="ri-group-line"/> {clan.member_count}/{CLAN_CAP}</span>
                    <span><i className="ri-team-line"/> {clan.squad_count}/{SQUAD_CAP}</span>
                    {clan.total_wins > 0 && <span><i className="ri-trophy-line"/> {clan.total_wins}W</span>}
                  </div>
                  <div className={styles.capBar}>
                    <div className={styles.capFill}
                      style={{ width: `${pct}%`, background: isFull ? '#ef4444' : 'var(--accent)' }}/>
                  </div>
                </div>
                {isFull && <span className={styles.fullBadge}>FULL</span>}
              </Link>
            )
          })}

          {filtered.length === 0 && (
            <div className={styles.emptyState}>
              <i className="ri-shield-line"/>
              <p>No clans yet for {GAME_META[game]?.name}.</p>
              <button className={styles.createBtn} onClick={handleCreate}>
                <i className="ri-add-line"/> Be the first to create one
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
