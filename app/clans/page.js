'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../lib/constants'
import { identityColor } from '../../lib/clanColors'
import usePageLoading from '../../components/usePageLoading'
import styles from './page.module.css'

const CLAN_CAP  = 125
const SQUAD_CAP = 25

function MarqueeName({ text }) {
  const wrapRef = useRef(null)
  const textRef = useRef(null)
  const [distance, setDistance] = useState(0)
  const [duration, setDuration] = useState(6)

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current
      const inner = textRef.current
      if (!wrap || !inner) return
      const overflow = inner.scrollWidth - wrap.clientWidth
      if (overflow > 2) {
        setDistance(overflow)
        setDuration(Math.max(7, overflow / 7))
      } else {
        setDistance(0)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [text])

  return (
    <span className={styles.clanNameWrap} ref={wrapRef}>
      <span
        ref={textRef}
        className={styles.clanName}
        style={distance > 0 ? {
          '--marquee-distance': `-${distance}px`,
          animationDuration: `${duration}s`,
        } : undefined}
      >{text}</span>
    </span>
  )
}

export default function ClansPage() {
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  const [game, setGame]       = useState('all')
  const [clans, setClans]     = useState([])
  const [myClans, setMyClans] = useState([])
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState(false)
  usePageLoading(loading)

  useEffect(() => { loadClans() }, [user])

  async function loadClans() {
    setLoading(true)
    const { data } = await supabase
      .from('clans')
      .select('*')
      .order('member_count', { ascending: false })
      .limit(200)
    setClans(data || [])

    if (user) {
      const { data: memberships } = await supabase
        .from('clan_members')
        .select('clan_id, clans!inner(code, game)')
        .eq('user_id', user.id)
      setMyClans(memberships || [])
    } else {
      setMyClans([])
    }
    setLoading(false)
  }

  const myClanCode = useMemo(() => {
    if (!myClans.length) return null
    if (game === 'all') return myClans[0]?.clans?.code || null
    return myClans.find(m => m.clans?.game === game)?.clans?.code || null
  }, [myClans, game])

  function handleCreate() {
    if (!user) { openAuthGate(); return }
    router.push(`/clans/create?game=${game === 'all' ? GAME_SLUGS[0] : game}`)
  }

  async function handleShare() {
    const url = window.location.href
    if (navigator.share) {
      try { await navigator.share({ title: 'NaboGaming Clans', url }) } catch {}
    } else {
      await handleCopyLink()
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  function goToProfile() {
    if (!user) { openAuthGate(); return }
    router.push(`/profile/${user.id}`)
  }

  const filtered = clans.filter(c =>
    (game === 'all' || c.game === game) &&
    (!search || c.name.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Squad up · Compete together</p>
          <h1 className={styles.headline}>CLANS</h1>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.iconBtn} onClick={handleShare} aria-label="Share">
            <i className="ri-share-forward-line"/>
          </button>
          <button className={styles.iconBtn} onClick={handleCopyLink} aria-label="Copy page link">
            <i className={copied ? 'ri-check-line' : 'ri-link'}/>
          </button>
          <button className={styles.iconBtn} onClick={goToProfile} aria-label="My profile">
            <i className="ri-user-3-line"/>
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <i className="ri-search-line"/>
          <input className={styles.searchInput} placeholder="Search…"
            value={search} onChange={e => setSearch(e.target.value)}/>
        </div>

        <select className={styles.gameSelect} value={game} onChange={e => setGame(e.target.value)}>
          <option value="all">All games</option>
          {GAME_SLUGS.map(g => (
            <option key={g} value={g}>{GAME_META[g]?.name || g}</option>
          ))}
        </select>

        {myClanCode ? (
          <button className={styles.myClanBtn} onClick={() => router.push(`/clans/${myClanCode}`)}>
            <i className="ri-shield-star-line"/> My Clan
          </button>
        ) : (
          <button className={styles.createBtn} onClick={handleCreate}>
            <i className="ri-add-line"/> Create
          </button>
        )}
      </div>

      {loading && (
        <div className={styles.grid}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className={styles.skeletonCard} style={{ opacity: 1 - i * 0.08 }}/>
          ))}
        </div>
      )}

      {!loading && (
        <div className={styles.grid}>
          {filtered.map(clan => {
            const pct = Math.min(100, Math.round((clan.member_count / CLAN_CAP) * 100))
            const isFull = clan.member_count >= CLAN_CAP
            const accentColor = identityColor(clan.name)
            const bgImage = clan.banner_url || clan.logo_url

            return (
              <Link key={clan.code} href={`/clans/${clan.code}`} className={styles.clanCard}
                style={{
                  '--clan-accent': accentColor,
                  backgroundImage: bgImage ? `url(${bgImage})` : 'none',
                  backgroundColor: bgImage ? undefined : accentColor,
                }}>
                <span className={`${styles.clanCardOverlay} ${bgImage ? styles.overlayGradient : styles.overlayFlat}`}/>

                <span className={styles.gameBadge}>
                  <i className={GAME_META[clan.game]?.icon}/> {GAME_META[clan.game]?.name}
                </span>
                {isFull && <span className={styles.fullBadge}>FULL</span>}

                <div className={styles.cardContent}>
                  <div className={styles.clanLogo}>
                    {clan.logo_url ? <img src={clan.logo_url} alt=""/> : <span>{clan.tag_prefix}</span>}
                  </div>
                  <div className={styles.clanInfo}>
                    <div className={styles.clanNameRow}>
                      <MarqueeName text={clan.name}/>
                      <span className={styles.clanTag}>{clan.tag_prefix}</span>
                    </div>
                    <div className={styles.clanStats}>
                      <span><i className="ri-group-line"/> {clan.member_count}/{CLAN_CAP}</span>
                      <span><i className="ri-team-line"/> {clan.squad_count}/{SQUAD_CAP}</span>
                      {clan.total_wins > 0 && <span><i className="ri-trophy-line"/> {clan.total_wins}W</span>}
                    </div>
                    <div className={styles.capBar}>
                      <div className={styles.capFill}
                        style={{ width: `${pct}%`, background: isFull ? '#ef4444' : accentColor }}/>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}

          {filtered.length === 0 && (
            <div className={styles.emptyState}>
              <i className="ri-shield-line"/>
              <p>{game === 'all' ? 'No clans yet.' : `No clans yet for ${GAME_META[game]?.name}.`}</p>
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
