'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../components/AuthProvider'
import { supabase } from '../lib/supabase'
import styles from './page.module.css'
import { getCurrentSeason, getDaysRemaining, TIER_ORDER, TIER_WIN_THRESHOLD, getLevelWinThreshold, MAX_LEVEL } from '../lib/seasons'
import { GAME_META, GAME_SLUGS, RANK_META } from '../lib/constants'
import UserBadges from '../components/UserBadges'
import { useCurrency } from '../lib/useCurrency'

function parsePrize(raw) {
  if (!raw) return null
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}

function fmtTime(iso) {
  if (!iso) return 'TBD'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/* ── Skeleton primitives ── */
function SkeletonRow() {
  return (
    <div className={styles.skelRow}>
      <div className={styles.skelCircle} />
      <div className={styles.skelLines}>
        <div className={styles.skelLine} style={{ width: '60%' }} />
        <div className={styles.skelLine} style={{ width: '40%' }} />
      </div>
    </div>
  )
}
function SkeletonCard() {
  return <div className={styles.skelCard} />
}

/* ── Section wrapper ── */
function Section({ icon, title, href, linkLabel, children, className }) {
  return (
    <section className={`${styles.section} ${className || ''}`}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}><i className={icon} /> {title}</h2>
        {href && <Link href={href} className={styles.sectionLink}>{linkLabel || 'See all'} <i className="ri-arrow-right-s-line" /></Link>}
      </div>
      {children}
    </section>
  )
}

export default function Home() {
  const { user, profile, isAdmin } = useAuth()
  const { fmtAmt, currencyMeta } = useCurrency(profile?.country_flag)

  /* ── Public data — loaded in priority order ── */
  const [tournaments,  setTournaments]  = useState([])
  const [topPlayers,   setTopPlayers]   = useState([])
  const [liveMatches,  setLiveMatches]  = useState([])
  const [shopItems,    setShopItems]    = useState([])
  const [shopImages,   setShopImages]   = useState({})
  const [recentPosts,  setRecentPosts]  = useState([])

  /* ── Loading states — independent per section ── */
  const [loadingTourns,   setLoadingTourns]   = useState(true)
  const [loadingPlayers,  setLoadingPlayers]  = useState(true)
  const [loadingMatches,  setLoadingMatches]  = useState(true)
  const [loadingShop,     setLoadingShop]     = useState(true)
  const [loadingFeed,     setLoadingFeed]     = useState(true)

  /* ── User-specific data ── */
  const [upcoming,     setUpcoming]     = useState([])
  const [recent,       setRecent]       = useState([])
  const [loadingUser,  setLoadingUser]  = useState(false)

  /* ── Game Master Modal ── */
  const [gameMasters,      setGameMasters]      = useState([])
  const [masterModalIdx,   setMasterModalIdx]   = useState(0)
  const [showMasterModal,  setShowMasterModal]  = useState(false)

  /* ── Load game masters — separate effect, runs on every mount ── */
  useEffect(() => {
    async function loadGameMasters() {
      // Try RPC first
      let masters = null
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_all_current_game_masters')
      if (!rpcErr && rpcData?.length) {
        masters = rpcData
      } else {
        // Fallback: direct table query for current week window
        const monday = (() => {
          const d = new Date()
          const day = d.getDay()
          d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
          d.setHours(0,0,0,0)
          return d.toISOString().split('T')[0]
        })()
        const nextMonday = (() => {
          const d = new Date(monday)
          d.setDate(d.getDate() + 7)
          return d.toISOString().split('T')[0]
        })()
        const { data: fallback } = await supabase
          .from('game_masters')
          .select('*, profiles(username, avatar_url, tier, country_flag)')
          .gte('week_start', monday)
          .lt('week_start', nextMonday)
          .order('crowned_at', { ascending: false })
        if (fallback?.length) {
          masters = fallback.map(r => ({
            game_slug: r.game_slug,
            master_id: r.id,
            user_id: r.user_id,
            username: r.profiles?.username,
            avatar_url: r.profiles?.avatar_url,
            tier: r.profiles?.tier,
            country_flag: r.profiles?.country_flag,
            total_wins: r.total_wins,
            total_points: r.total_points,
            tournaments_played: r.tournaments_played,
            crowned_at: r.crowned_at,
          }))
        }
      }
      if (!masters?.length) return
      setGameMasters(masters)
      // Always show — user must explicitly dismiss (Awesome! or Don't show 7d)
      try {
        const suppress = localStorage.getItem('master_modal_suppress')
        if (!suppress || Date.now() >= Number(suppress)) {
          setShowMasterModal(true)
        }
      } catch {
        setShowMasterModal(true)
      }
    }
    loadGameMasters()
  }, [])

  /* ── Load each section independently so they appear as they arrive ── */
  useEffect(() => {
    supabase
      .from('tournaments')
      .select('id,name,slug,game_slug,status,slots,registered_count,date,prize,entrance_fee,is_test,created_by,created_at')
      .in('status', ['active', 'ongoing'])
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => {
        setTournaments(filterTest(data))
        setLoadingTourns(false)
      })

    // 2. Top players
    supabase
      .from('profiles')
      .select('id,username,level,tier,points,wins,season_wins,avatar_url,country_flag,email,is_season_winner')
      .not('email', 'in', '(nabogamingss1@gmail.com)')
      .order('points', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        setTopPlayers(data || [])
        setLoadingPlayers(false)
      })

    // 3. Matches
    supabase
      .from('matches')
      .select('id,slug,game_mode,status,scheduled_at,challenger:profiles!matches_challenger_id_fkey(username,level),challenged:profiles!matches_challenged_id_fkey(username,level)')
      .in('status', ['confirmed', 'pending', 'live'])
      .order('scheduled_at', { ascending: true })
      .limit(4)
      .then(({ data }) => {
        setLiveMatches(data || [])
        setLoadingMatches(false)
      })

    // 4. Shop items
    supabase
      .from('shop_items')
      .select('id,title,price,category,profiles(username)')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => {
        setShopItems(data || [])
        setLoadingShop(false)
        // 4b. Shop images load after items arrive
        if (data?.length) {
          const ids = data.map(i => i.id)
          supabase
            .from('shop_item_images')
            .select('item_id,url,sort_order')
            .in('item_id', ids)
            .order('sort_order', { ascending: true })
            .then(({ data: imgs }) => {
              if (!imgs) return
              const map = {}
              imgs.forEach(img => { if (!map[img.item_id]) map[img.item_id] = []; map[img.item_id].push(img.url) })
              setShopImages(map)
            })
        }
      })

    // 5. Feed — least critical, load last
    supabase
      .from('posts')
      .select('id,content,likes,comment_count,created_at,profiles(id,username,avatar_url,tier)')
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        setRecentPosts(data || [])
        setLoadingFeed(false)
      })
  }, [])

  // User-specific data — only when logged in
  useEffect(() => {
    if (!user) return
    setLoadingUser(true)
    Promise.all([
      supabase
        .from('matches')
        .select('id,game_mode,status,scheduled_at,challenger_id,challenged_id,challenger:profiles!matches_challenger_id_fkey(username,level,tier),challenged:profiles!matches_challenged_id_fkey(username,level,tier)')
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .in('status', ['confirmed', 'pending', 'challenged'])
        .order('scheduled_at', { ascending: true })
        .limit(3),
      supabase
        .from('matches')
        .select('id,game_mode,status,score_challenger,score_challenged,winner_id,challenger_id,challenged_id,challenger:profiles!matches_challenger_id_fkey(id,username,level),challenged:profiles!matches_challenged_id_fkey(id,username,level)')
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(3),
    ]).then(([{ data: up }, { data: rec }]) => {
      setUpcoming(up || [])
      setRecent(rec || [])
      setLoadingUser(false)
    })
  }, [user])

  // Realtime slot counts
  useEffect(() => {
    const ch = supabase
      .channel('home-tourney-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, async () => {
        const { data } = await supabase
          .from('tournaments')
          .select('id,name,slug,game_slug,status,slots,registered_count,date,prize,entrance_fee,is_test,created_by,created_at')
          .in('status', ['active', 'ongoing'])
          .order('created_at', { ascending: false })
          .limit(4)
        if (data) setTournaments(filterTest(data))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [user, isAdmin])

  function filterTest(list) {
    return (list || []).filter(t => {
      if (!t.is_test) return true
      if (!user) return false
      return isAdmin || t.created_by === user?.id
    })
  }

  function getOpponent(m) {
    return m.challenger_id === user?.id ? m.challenged : m.challenger
  }

  /* ── Derived profile values ── */
  const season   = getCurrentSeason()
  const daysLeft = getDaysRemaining()
  const tier     = profile?.tier || 'Gold'
  const tierMeta = RANK_META[tier] || RANK_META.Gold
  const tierIdx  = TIER_ORDER.indexOf(tier)
  const isMaxTier = tierIdx === TIER_ORDER.length - 1
  const nextTier  = isMaxTier ? null : TIER_ORDER[tierIdx + 1]
  const threshold = TIER_WIN_THRESHOLD[tier] || 50
  const seasonWins = profile?.season_wins ?? 0
  const tierPct = isMaxTier ? 100 : Math.min(100, Math.round((seasonWins / threshold) * 100))
  const winsToTier = isMaxTier ? 0 : Math.max(0, threshold - seasonWins)
  const lvl = profile?.level ?? 1
  const lvlThreshold = getLevelWinThreshold(lvl)
  const lvlPct = lvl >= MAX_LEVEL ? 100 : Math.min(100, Math.round((seasonWins / lvlThreshold) * 100))
  const winsToLvl = lvl >= MAX_LEVEL ? 0 : Math.max(0, lvlThreshold - seasonWins)

  return (
    <div className={styles.page}>

      {/* ── Game Master Modal ── */}
      {showMasterModal && gameMasters.length > 0 && (() => {
        const m = gameMasters[masterModalIdx]
        const game = GAME_META[m?.game_slug]
        return (
          <div className={styles.mmBackdrop} onClick={() => setShowMasterModal(false)}>
            <div className={styles.mmCard} onClick={e => e.stopPropagation()}>

              {/* Dual background: game image + avatar blended */}
              <div className={styles.mmBgGame}
                style={{ backgroundImage: game?.image ? `url(${game.image})` : 'none' }} />
              {m?.avatar_url && (
                <div className={styles.mmBgAvatar}
                  style={{ backgroundImage: `url(${m.avatar_url})` }} />
              )}
              <div className={styles.mmBgOverlay} />

              {/* Top row: close + game badge */}
              <div className={styles.mmTopRow}>
                <div className={styles.mmGameChip}>
                  {game?.image && <img src={game.image} className={styles.mmGameChipImg} />}
                  <span>{game?.name || m?.game_slug}</span>
                </div>
                <button className={styles.mmClose} onClick={() => setShowMasterModal(false)}>
                  <i className="ri-close-line" />
                </button>
              </div>

              {/* Banner body */}
              <div className={styles.mmBody}>
                {/* Avatar + info side by side */}
                <div className={styles.mmRow}>
                  <div className={styles.mmAvatar}>
                    {m?.avatar_url
                      ? <img src={m.avatar_url} alt={m.username} />
                      : <span>{m?.username?.[0]?.toUpperCase()}</span>
                    }
                    <div className={styles.mmCrownPin}><i className="ri-crown-fill" /></div>
                  </div>
                  <div className={styles.mmInfo}>
                    <span className={styles.mmLabel}>WEEKLY MASTER</span>
                    <h2 className={styles.mmName}>{m?.username}</h2>
                    <div className={styles.mmTier}>
                      <i className="ri-shield-star-fill" />
                      <span>{m?.tier || 'Gold'}</span>
                      {m?.country_flag && <span className={styles.mmFlag}>{m.country_flag}</span>}
                    </div>
                  </div>
                </div>

                {/* Stats strip */}
                <div className={styles.mmStats}>
                  {[
                    { icon: 'ri-sword-fill',  val: m?.total_wins ?? 0,         label: 'Wins'   },
                    { icon: 'ri-star-fill',    val: m?.total_points ?? 0,       label: 'Points' },
                    { icon: 'ri-node-tree',    val: m?.tournaments_played ?? 0, label: 'Played' },
                  ].map((s, i) => (
                    <div key={i} className={styles.mmStat}>
                      <i className={s.icon} />
                      <strong>{s.val}</strong>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>

                {/* Multi-game dots */}
                {gameMasters.length > 1 && (
                  <div className={styles.mmDots}>
                    {gameMasters.map((_, i) => (
                      <button key={i}
                        className={`${styles.mmDot} ${i === masterModalIdx ? styles.mmDotActive : ''}`}
                        onClick={() => setMasterModalIdx(i)} />
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className={styles.mmActions}>
                  <a href={`/profile/${m?.user_id}`} className={styles.mmViewBtn}
                    onClick={() => {
                      try { localStorage.setItem('master_modal_suppress', String(Date.now() + 7*24*60*60*1000)) } catch {}
                      setShowMasterModal(false)
                    }}>
                    <i className="ri-user-3-line" /> View Profile
                  </a>
                  <button className={styles.mmAwesomeBtn} onClick={() => {
                    try { localStorage.setItem('master_modal_suppress', String(Date.now() + 7*24*60*60*1000)) } catch {}
                    setShowMasterModal(false)
                  }}>
                    <i className="ri-fire-fill" /> Awesome!
                  </button>
                </div>

                <button className={styles.mmDontShow} onClick={() => {
                  try { localStorage.setItem('master_modal_suppress', String(Date.now() + 7*24*60*60*1000)) } catch {}
                  setShowMasterModal(false)
                }}>Don't show for 7 days</button>
              </div>
            </div>
          </div>
        )
      })()} client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../components/AuthProvider'
import { supabase } from '../lib/supabase'
import styles from './page.module.css'
import { getCurrentSeason, getDaysRemaining, TIER_ORDER, TIER_WIN_THRESHOLD, getLevelWinThreshold, MAX_LEVEL } from '../lib/seasons'
import { GAME_META, GAME_SLUGS, RANK_META } from '../lib/constants'
import UserBadges from '../components/UserBadges'
import { useCurrency } from '../lib/useCurrency'

function parsePrize(raw) {
  if (!raw) return null
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}

function fmtTime(iso) {
  if (!iso) return 'TBD'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/* ── Skeleton primitives ── */
function SkeletonRow() {
  return (
    <div className={styles.skelRow}>
      <div className={styles.skelCircle} />
      <div className={styles.skelLines}>
        <div className={styles.skelLine} style={{ width: '60%' }} />
        <div className={styles.skelLine} style={{ width: '40%' }} />
      </div>
    </div>
  )
}
function SkeletonCard() {
  return <div className={styles.skelCard} />
}

/* ── Section wrapper ── */
function Section({ icon, title, href, linkLabel, children, className }) {
  return (
    <section className={`${styles.section} ${className || ''}`}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}><i className={icon} /> {title}</h2>
        {href && <Link href={href} className={styles.sectionLink}>{linkLabel || 'See all'} <i className="ri-arrow-right-s-line" /></Link>}
      </div>
      {children}
    </section>
  )
}

export default function Home() {
  const { user, profile, isAdmin } = useAuth()
  const { fmtAmt, currencyMeta } = useCurrency(profile?.country_flag)

  /* ── Public data — loaded in priority order ── */
  const [tournaments,  setTournaments]  = useState([])
  const [topPlayers,   setTopPlayers]   = useState([])
  const [liveMatches,  setLiveMatches]  = useState([])
  const [shopItems,    setShopItems]    = useState([])
  const [shopImages,   setShopImages]   = useState({})
  const [recentPosts,  setRecentPosts]  = useState([])

  /* ── Loading states — independent per section ── */
  const [loadingTourns,   setLoadingTourns]   = useState(true)
  const [loadingPlayers,  setLoadingPlayers]  = useState(true)
  const [loadingMatches,  setLoadingMatches]  = useState(true)
  const [loadingShop,     setLoadingShop]     = useState(true)
  const [loadingFeed,     setLoadingFeed]     = useState(true)

  /* ── User-specific data ── */
  const [upcoming,     setUpcoming]     = useState([])
  const [recent,       setRecent]       = useState([])
  const [loadingUser,  setLoadingUser]  = useState(false)

  /* ── Game Master Modal ── */
  const [gameMasters,      setGameMasters]      = useState([])
  const [masterModalIdx,   setMasterModalIdx]   = useState(0)
  const [showMasterModal,  setShowMasterModal]  = useState(false)

  /* ── Load game masters — separate effect, runs on every mount ── */
  useEffect(() => {
    async function loadGameMasters() {
      // Try RPC first
      let masters = null
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_all_current_game_masters')
      if (!rpcErr && rpcData?.length) {
        masters = rpcData
      } else {
        // Fallback: direct table query for current week window
        const monday = (() => {
          const d = new Date()
          const day = d.getDay()
          d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
          d.setHours(0,0,0,0)
          return d.toISOString().split('T')[0]
        })()
        const nextMonday = (() => {
          const d = new Date(monday)
          d.setDate(d.getDate() + 7)
          return d.toISOString().split('T')[0]
        })()
        const { data: fallback } = await supabase
          .from('game_masters')
          .select('*, profiles(username, avatar_url, tier, country_flag)')
          .gte('week_start', monday)
          .lt('week_start', nextMonday)
          .order('crowned_at', { ascending: false })
        if (fallback?.length) {
          masters = fallback.map(r => ({
            game_slug: r.game_slug,
            master_id: r.id,
            user_id: r.user_id,
            username: r.profiles?.username,
            avatar_url: r.profiles?.avatar_url,
            tier: r.profiles?.tier,
            country_flag: r.profiles?.country_flag,
            total_wins: r.total_wins,
            total_points: r.total_points,
            tournaments_played: r.tournaments_played,
            crowned_at: r.crowned_at,
          }))
        }
      }
      if (!masters?.length) return
      setGameMasters(masters)
      // Always show — user must explicitly dismiss (Awesome! or Don't show 7d)
      try {
        const suppress = localStorage.getItem('master_modal_suppress')
        if (!suppress || Date.now() >= Number(suppress)) {
          setShowMasterModal(true)
        }
      } catch {
        setShowMasterModal(true)
      }
    }
    loadGameMasters()
  }, [])

  /* ── Load each section independently so they appear as they arrive ── */
  useEffect(() => {
    supabase
      .from('tournaments')
      .select('id,name,slug,game_slug,status,slots,registered_count,date,prize,entrance_fee,is_test,created_by,created_at')
      .in('status', ['active', 'ongoing'])
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => {
        setTournaments(filterTest(data))
        setLoadingTourns(false)
      })

    // 2. Top players
    supabase
      .from('profiles')
      .select('id,username,level,tier,points,wins,season_wins,avatar_url,country_flag,email,is_season_winner')
      .not('email', 'in', '(nabogamingss1@gmail.com)')
      .order('points', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        setTopPlayers(data || [])
        setLoadingPlayers(false)
      })

    // 3. Matches
    supabase
      .from('matches')
      .select('id,slug,game_mode,status,scheduled_at,challenger:profiles!matches_challenger_id_fkey(username,level),challenged:profiles!matches_challenged_id_fkey(username,level)')
      .in('status', ['confirmed', 'pending', 'live'])
      .order('scheduled_at', { ascending: true })
      .limit(4)
      .then(({ data }) => {
        setLiveMatches(data || [])
        setLoadingMatches(false)
      })

    // 4. Shop items
    supabase
      .from('shop_items')
      .select('id,title,price,category,profiles(username)')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => {
        setShopItems(data || [])
        setLoadingShop(false)
        // 4b. Shop images load after items arrive
        if (data?.length) {
          const ids = data.map(i => i.id)
          supabase
            .from('shop_item_images')
            .select('item_id,url,sort_order')
            .in('item_id', ids)
            .order('sort_order', { ascending: true })
            .then(({ data: imgs }) => {
              if (!imgs) return
              const map = {}
              imgs.forEach(img => { if (!map[img.item_id]) map[img.item_id] = []; map[img.item_id].push(img.url) })
              setShopImages(map)
            })
        }
      })

    // 5. Feed — least critical, load last
    supabase
      .from('posts')
      .select('id,content,likes,comment_count,created_at,profiles(id,username,avatar_url,tier)')
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        setRecentPosts(data || [])
        setLoadingFeed(false)
      })
  }, [])

  // User-specific data — only when logged in
  useEffect(() => {
    if (!user) return
    setLoadingUser(true)
    Promise.all([
      supabase
        .from('matches')
        .select('id,game_mode,status,scheduled_at,challenger_id,challenged_id,challenger:profiles!matches_challenger_id_fkey(username,level,tier),challenged:profiles!matches_challenged_id_fkey(username,level,tier)')
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .in('status', ['confirmed', 'pending', 'challenged'])
        .order('scheduled_at', { ascending: true })
        .limit(3),
      supabase
        .from('matches')
        .select('id,game_mode,status,score_challenger,score_challenged,winner_id,challenger_id,challenged_id,challenger:profiles!matches_challenger_id_fkey(id,username,level),challenged:profiles!matches_challenged_id_fkey(id,username,level)')
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(3),
    ]).then(([{ data: up }, { data: rec }]) => {
      setUpcoming(up || [])
      setRecent(rec || [])
      setLoadingUser(false)
    })
  }, [user])

  // Realtime slot counts
  useEffect(() => {
    const ch = supabase
      .channel('home-tourney-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, async () => {
        const { data } = await supabase
          .from('tournaments')
          .select('id,name,slug,game_slug,status,slots,registered_count,date,prize,entrance_fee,is_test,created_by,created_at')
          .in('status', ['active', 'ongoing'])
          .order('created_at', { ascending: false })
          .limit(4)
        if (data) setTournaments(filterTest(data))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [user, isAdmin])

  function filterTest(list) {
    return (list || []).filter(t => {
      if (!t.is_test) return true
      if (!user) return false
      return isAdmin || t.created_by === user?.id
    })
  }

  function getOpponent(m) {
    return m.challenger_id === user?.id ? m.challenged : m.challenger
  }

  /* ── Derived profile values ── */
  const season   = getCurrentSeason()
  const daysLeft = getDaysRemaining()
  const tier     = profile?.tier || 'Gold'
  const tierMeta = RANK_META[tier] || RANK_META.Gold
  const tierIdx  = TIER_ORDER.indexOf(tier)
  const isMaxTier = tierIdx === TIER_ORDER.length - 1
  const nextTier  = isMaxTier ? null : TIER_ORDER[tierIdx + 1]
  const threshold = TIER_WIN_THRESHOLD[tier] || 50
  const seasonWins = profile?.season_wins ?? 0
  const tierPct = isMaxTier ? 100 : Math.min(100, Math.round((seasonWins / threshold) * 100))
  const winsToTier = isMaxTier ? 0 : Math.max(0, threshold - seasonWins)
  const lvl = profile?.level ?? 1
  const lvlThreshold = getLevelWinThreshold(lvl)
  const lvlPct = lvl >= MAX_LEVEL ? 100 : Math.min(100, Math.round((seasonWins / lvlThreshold) * 100))
  const winsToLvl = lvl >= MAX_LEVEL ? 0 : Math.max(0, lvlThreshold - seasonWins)

  return (
    <div className={styles.page}>

      {/* ── Game Master Modal ── */}
      {showMasterModal && gameMasters.length > 0 && (() => {
        const m = gameMasters[masterModalIdx]
        const game = GAME_META[m?.game_slug]
        return (
          <div className={styles.mmBackdrop} onClick={() => setShowMasterModal(false)}>
            <div className={styles.mmCard} onClick={e => e.stopPropagation()}>

              {/* Full blurred avatar background */}
              <div className={styles.mmBg}
                style={{ backgroundImage: `url(${m?.avatar_url || game?.image || ''})` }} />
              <div className={styles.mmBgOverlay} />

              {/* Scanline texture */}
              <div className={styles.mmScanlines} />

              {/* Close */}
              <button className={styles.mmClose} onClick={() => setShowMasterModal(false)}>
                <i className="ri-close-line" />
              </button>

              {/* Game badge top-left */}
              <div className={styles.mmGameBadge}>
                {game?.image && <img src={game.image} alt={game?.name} className={styles.mmGameImg} />}
                <span>{game?.name || m?.game_slug}</span>
              </div>

              <div className={styles.mmBody}>
                {/* Crown + label */}
                <div className={styles.mmCrownRow}>
                  <div className={styles.mmCrownIcon}><i className="ri-crown-fill" /></div>
                  <div className={styles.mmCrownLabel}>
                    <span className={styles.mmWeeklyText}>WEEKLY MASTER</span>
                  </div>
                </div>

                {/* Avatar — no border, just glow */}
                <div className={styles.mmAvatarWrap}>
                  <div className={styles.mmAvatarRing} />
                  <div className={styles.mmAvatar}>
                    {m?.avatar_url
                      ? <img src={m.avatar_url} alt={m.username} />
                      : <span>{m?.username?.[0]?.toUpperCase()}</span>
                    }
                  </div>
                  {/* Tier badge */}
                  <div className={styles.mmTierBadge}>
                    <i className="ri-shield-star-fill" />
                    <span>{m?.tier || 'Gold'}</span>
                  </div>
                </div>

                {/* Name */}
                <h2 className={styles.mmName}>{m?.username}</h2>
                {m?.country_flag && <p className={styles.mmFlag}>{m.country_flag}</p>}

                {/* Stats row — gamified cards */}
                <div className={styles.mmStats}>
                  <div className={styles.mmStat}>
                    <i className="ri-sword-fill" />
                    <span className={styles.mmStatVal}>{m?.total_wins ?? 0}</span>
                    <span className={styles.mmStatLabel}>WINS</span>
                  </div>
                  <div className={styles.mmStatDiv} />
                  <div className={styles.mmStat}>
                    <i className="ri-star-fill" />
                    <span className={styles.mmStatVal}>{m?.total_points ?? 0}</span>
                    <span className={styles.mmStatLabel}>PTS</span>
                  </div>
                  <div className={styles.mmStatDiv} />
                  <div className={styles.mmStat}>
                    <i className="ri-node-tree" />
                    <span className={styles.mmStatVal}>{m?.tournaments_played ?? 0}</span>
                    <span className={styles.mmStatLabel}>PLAYED</span>
                  </div>
                </div>

                {/* Multi-game dots */}
                {gameMasters.length > 1 && (
                  <div className={styles.mmDots}>
                    {gameMasters.map((_, i) => (
                      <button key={i}
                        className={`${styles.mmDot} ${i === masterModalIdx ? styles.mmDotActive : ''}`}
                        onClick={() => setMasterModalIdx(i)} />
                    ))}
                  </div>
                )}

                {/* View profile CTA */}
                <a href={`/profile/${m?.user_id}`} className={styles.mmViewProfile}
                  onClick={() => {
                    try { localStorage.setItem('master_modal_suppress', String(Date.now() + 7*24*60*60*1000)) } catch {}
                    setShowMasterModal(false)
                  }}>
                  <i className="ri-user-3-line" /> View Profile
                  <i className="ri-arrow-right-line" style={{ marginLeft: 'auto' }} />
                </a>

                <button className={styles.mmAwesome} onClick={() => {
                  try { localStorage.setItem('master_modal_suppress', String(Date.now() + 7*24*60*60*1000)) } catch {}
                  setShowMasterModal(false)
                }}>
                  <i className="ri-fire-fill" /> Awesome!
                </button>

                <button className={styles.mmDontShow} onClick={() => {
                  try { localStorage.setItem('master_modal_suppress', String(Date.now() + 7*24*60*60*1000)) } catch {}
                  setShowMasterModal(false)
                }}>Don't show for 7 days</button>
              </div>
            </div>
          </div>
        )
      })()}
      <div className={styles.hero}>
        {profile?.avatar_url && (
          <div className={styles.heroBg} style={{ backgroundImage: `url(${profile.avatar_url})` }} />
        )}
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <div className={styles.heroTop}>
            <div className={styles.heroSeason}>
              <i className="ri-calendar-line" /> Season {season} · {daysLeft}d left
            </div>
            {profile && (
              <Link href="/account" className={styles.heroAvatarBtn}>
                {profile.avatar_url
                  ? <img src={profile.avatar_url} className={styles.heroAvatarImg} alt="" />
                  : <span className={styles.heroAvatarInit}>{(profile.username || 'P').slice(0,2).toUpperCase()}</span>
                }
              </Link>
            )}
          </div>

          {/* While auth hasn't settled yet, show a centered spinner — no flash */}
          {!profile && user ? (
            <div className={styles.heroSpinner}><div className="loader" /></div>
          ) : profile ? (
            <div className={styles.heroBody}>
              <div className={styles.heroName}>
                {profile.username}
                <UserBadges email={profile.email} countryFlag={profile.country_flag} isSeasonWinner={profile.is_season_winner} size={16} />
              </div>

              {/* Tier + level badge row */}
              <div className={styles.heroBadgeRow}>
                <span className={styles.heroBadge} style={{ color: tierMeta.color, borderColor: tierMeta.color + '55', background: tierMeta.color + '18' }}>
                  <i className={tierMeta.icon} /> {tier}
                </span>
                <span className={styles.heroLvlBadge}>
                  <i className="ri-bar-chart-fill" /> Lv.{lvl}
                </span>
                <span className={styles.heroPlayStyle}>{profile.play_style || 'Player'}</span>
              </div>

              {/* Compact stat pills */}
              <div className={styles.heroStats}>
                {[
                  { icon: 'ri-trophy-fill',    val: profile.season_wins  ?? 0, label: 'S.Wins' },
                  { icon: 'ri-sword-fill',      val: profile.wins         ?? 0, label: 'Total'  },
                  { icon: 'ri-percent-line',    val: (() => { const w = profile.wins ?? 0; const l = profile.losses ?? 0; return w+l > 0 ? `${Math.round(w/(w+l)*100)}%` : '—' })(), label: 'WR' },
                  { icon: 'ri-star-fill',       val: (profile.points ?? 0).toLocaleString(), label: 'PTS' },
                ].map(s => (
                  <div key={s.label} className={styles.heroStat}>
                    <span className={styles.heroStatVal}>{s.val}</span>
                    <span className={styles.heroStatLabel}><i className={s.icon} /> {s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.heroGuest}>
              <div className={styles.heroGuestTitle}>NABOGAMING</div>
              <div className={styles.heroGuestSub}>Compete. Win. Rise.</div>
              <div className={styles.heroGuestBtns}>
                <Link href="/login"   className={styles.heroPrimaryBtn}><i className="ri-login-box-line" /> Sign In</Link>
                <Link href="/signup"  className={styles.heroSecondaryBtn}><i className="ri-user-add-line" /> Join Free</Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══════════ TIER + LEVEL PROGRESS ══════════ */}
      {profile && (
        <div className={styles.progressBlock}>
          {/* Tier bar */}
          <div className={styles.progressRow}>
            <div className={styles.progressMeta}>
              <span className={styles.progressLabel} style={{ color: tierMeta.color }}>
                <i className={tierMeta.icon} /> {tier}
              </span>
              {isMaxTier
                ? <span className={styles.progressMax}>MAX TIER 🏆</span>
                : <span className={styles.progressNext}>{winsToTier}W → {nextTier}</span>
              }
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${Math.max(tierPct, seasonWins > 0 ? 3 : 0)}%`, background: tierMeta.color }} />
            </div>
            <div className={styles.progressSub}>{seasonWins}/{threshold} season wins</div>
          </div>
          {/* Level bar */}
          <div className={styles.progressRow}>
            <div className={styles.progressMeta}>
              <span className={styles.progressLabel}>
                <i className="ri-bar-chart-fill" /> Level {lvl}{lvl < MAX_LEVEL ? ` → ${lvl+1}` : ''}
              </span>
              {lvl >= MAX_LEVEL
                ? <span className={styles.progressMax}>MAX LEVEL 🌟</span>
                : <span className={styles.progressNext}>{winsToLvl}W to level up</span>
              }
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${Math.max(lvlPct, seasonWins > 0 ? 3 : 0)}%`, background: 'var(--accent)' }} />
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MY MATCHES ══════════ */}
      {user && (
        <Section icon="ri-swords-line" title="My Matches" href="/matches" linkLabel="All">
          {loadingUser ? (
            [1,2,3].map(i => <SkeletonRow key={i} />)
          ) : upcoming.length === 0 && recent.length === 0 ? (
            <div className={styles.empty}>
              <i className="ri-swords-line" />
              <p>No matches yet</p>
              <Link href="/players" className={styles.emptyBtn}><i className="ri-user-search-line" /> Find Players</Link>
            </div>
          ) : (
            <div className={styles.matchList}>
              {upcoming.map(m => {
                const opp = getOpponent(m)
                return (
                  <Link key={m.id} href={`/matches/${m.slug || m.id}`} className={styles.matchRow}>
                    <div className={`${styles.matchStatusDot} ${styles['dot_' + m.status]}`} />
                    <div className={styles.matchInfo}>
                      <span className={styles.matchOpp}>vs {opp?.username || '—'}</span>
                      <span className={styles.matchSub}>{m.game_mode} · {fmtTime(m.scheduled_at)}</span>
                    </div>
                    <span className={`${styles.matchBadge} ${styles['badge_' + m.status]}`}>{m.status?.toUpperCase()}</span>
                  </Link>
                )
              })}
              {recent.map(r => {
                const isMe = r.challenger_id === user.id
                const opp  = isMe ? r.challenged : r.challenger
                const won  = r.winner_id === user.id
                const result = r.winner_id ? (won ? 'WIN' : 'LOSS') : 'DRAW'
                const ms   = isMe ? r.score_challenger : r.score_challenged
                const os   = isMe ? r.score_challenged : r.score_challenger
                return (
                  <Link key={r.id} href={`/matches/${r.slug || r.id}`} className={styles.matchRow}>
                    <span className={`${styles.resultPill} ${result === 'WIN' ? styles.pillWin : result === 'LOSS' ? styles.pillLoss : styles.pillDraw}`}>{result}</span>
                    <div className={styles.matchInfo}>
                      <span className={styles.matchOpp}>{opp?.username || '—'}</span>
                      <span className={styles.matchSub}>{r.game_mode} · {ms ?? '—'}–{os ?? '—'}</span>
                    </div>
                    <span className={`${styles.ptsDelta} ${result === 'WIN' ? styles.ptsPos : styles.ptsNeg}`}>
                      {result === 'WIN' ? '+10' : result === 'LOSS' ? '−5' : '0'}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </Section>
      )}

      {/* ══════════ TOURNAMENTS ══════════ */}
      <Section icon="ri-node-tree" title="Tournaments" href="/tournaments" linkLabel="All">
        {loadingTourns ? (
          <div className={styles.tGrid}><SkeletonCard /><SkeletonCard /></div>
        ) : tournaments.length === 0 ? (
          <div className={styles.empty}>
            <i className="ri-node-tree" />
            <p>No active tournaments</p>
            <Link href="/tournaments" className={styles.emptyBtn}>Browse All</Link>
          </div>
        ) : (
          <div className={styles.tGrid}>
            {tournaments.map(t => {
              const game  = GAME_META[t.game_slug]
              const prize = parsePrize(t.prize)
              const fee   = parsePrize(t.entrance_fee)
              const pct   = t.slots ? Math.min(100, Math.round(((t.registered_count || 0) / t.slots) * 100)) : 0
              const full  = (t.registered_count || 0) >= t.slots
              const statusColors = { active: '#22c55e', ongoing: '#6366f1', upcoming: '#f59e0b' }
              const sc = statusColors[t.status] || '#6b7280'
              return (
                <Link key={t.id} href={`/tournaments/${t.slug || t.id}`} className={styles.tCard}>
                  {/* Game image banner */}
                  <div className={styles.tCardImg}>
                    {game?.image
                      ? <img src={game.image} alt={game.name} className={styles.tCardImgEl} />
                      : <div className={styles.tCardImgFallback}><i className={game?.icon || 'ri-gamepad-line'} /></div>
                    }
                    <div className={styles.tCardImgBadges}>
                      <span className={styles.tStatusBadge} style={{ color: sc, background: sc + '22', borderColor: sc + '55' }}>
                        <i className="ri-circle-fill" style={{ fontSize: 6 }} /> {t.status}
                      </span>
                      {full && <span className={styles.tFullBadge}><i className="ri-lock-line" /> Full</span>}
                    </div>
                  </div>
                  <div className={styles.tCardBody}>
                    <div className={styles.tGameChip}><i className={game?.icon || 'ri-gamepad-line'} /> {game?.name || t.game_slug}</div>
                    <div className={styles.tCardName}>{t.name}</div>
                    <div className={styles.tStatRow}>
                      <span><i className="ri-money-dollar-circle-line" /> {fee ? fmtAmt(fee) : 'Free'}</span>
                      <span style={{ color: prize ? '#22c55e' : 'var(--text-muted)' }}><i className="ri-trophy-line" /> {prize ? fmtAmt(prize) : 'No prize'}</span>
                      {t.date && <span><i className="ri-calendar-line" /> {t.date}</span>}
                    </div>
                    <div className={styles.tSlotBar}>
                      <div className={styles.tSlotTrack}>
                        <div className={`${styles.tSlotFill} ${full ? styles.tSlotFull : pct >= 80 ? styles.tSlotWarm : ''}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={styles.tSlotLabel}>{t.registered_count || 0}/{t.slots}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ TOP PLAYERS ══════════ */}
      <Section icon="ri-bar-chart-line" title="Leaderboard" href="/players" linkLabel="All Players">
        {loadingPlayers ? (
          [1,2,3].map(i => <SkeletonRow key={i} />)
        ) : (
          <div className={styles.leaderList}>
            {topPlayers.map((p, i) => {
              const isMe   = user?.id === p.id
              const medals = ['🥇', '🥈', '🥉']
              const tm     = RANK_META[p.tier] || RANK_META.Gold
              return (
                <Link key={p.id} href={`/profile/${p.id}`} className={`${styles.leaderRow} ${isMe ? styles.leaderRowMe : ''}`}>
                  <span className={styles.leaderPos}>{medals[i] || `#${i+1}`}</span>
                  <div className={styles.leaderAvatar} style={{ borderColor: tm.color + '88' }}>
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" />
                      : <span>{(p.username || '?').slice(0,2).toUpperCase()}</span>
                    }
                  </div>
                  <div className={styles.leaderInfo}>
                    <span className={styles.leaderName}>
                      {p.username}
                      {isMe && <span className={styles.youPill}>YOU</span>}
                      <UserBadges email={p.email} countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} size={11} gap={2} />
                    </span>
                    <span className={styles.leaderSub} style={{ color: tm.color }}>
                      <i className={tm.icon} /> {p.tier} · Lv.{p.level ?? 1} · {p.wins || 0}W
                    </span>
                  </div>
                  <span className={styles.leaderPts}>{(p.points || 0).toLocaleString()}<span className={styles.ptsLabel}> pts</span></span>
                </Link>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ GAMES GRID ══════════ */}
      <Section icon="ri-gamepad-line" title="Games" href="/games" linkLabel="All">
        <div className={styles.gamesGrid}>
          {GAME_SLUGS.map(slug => {
            const game = GAME_META[slug]
            return (
              <Link key={slug} href={`/games/${slug}`} className={styles.gameCard}>
                {game?.image
                  ? <img src={game.image} alt={game.name} className={styles.gameCardImg} />
                  : <i className={game?.icon || 'ri-gamepad-line'} className={styles.gameCardIcon} />
                }
                <div className={styles.gameCardOverlay}>{game?.name || slug}</div>
              </Link>
            )
          })}
        </div>
      </Section>

      {/* ══════════ SCHEDULED MATCHES ══════════ */}
      <Section icon="ri-calendar-check-line" title="Scheduled" href="/matches" linkLabel="All Matches">
        {loadingMatches ? (
          [1,2,3].map(i => <SkeletonRow key={i} />)
        ) : liveMatches.length === 0 ? (
          <div className={styles.empty}>
            <i className="ri-calendar-check-line" />
            <p>No scheduled matches</p>
            <Link href="/players" className={styles.emptyBtn}><i className="ri-user-search-line" /> Find Players</Link>
          </div>
        ) : (
          <div className={styles.matchList}>
            {liveMatches.map(m => (
              <Link key={m.id} href={`/matches/${m.slug || m.id}`} className={styles.matchRow}>
                <div className={`${styles.matchStatusDot} ${styles['dot_' + m.status]}`} />
                <div className={styles.matchInfo}>
                  <span className={styles.matchOpp}>{m.challenger?.username || '—'} <span style={{ opacity: 0.5 }}>vs</span> {m.challenged?.username || '—'}</span>
                  <span className={styles.matchSub}>{m.game_mode} · {fmtTime(m.scheduled_at)}</span>
                </div>
                <span className={`${styles.matchBadge} ${styles['badge_' + m.status]}`}>{m.status?.toUpperCase()}</span>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* ══════════ SHOP SPOTLIGHT ══════════ */}
      <Section icon="ri-store-2-line" title="Shop" href="/shop" linkLabel="Browse All">
        {loadingShop ? (
          <div className={styles.shopGrid}><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        ) : shopItems.length === 0 ? (
          <div className={styles.empty}><i className="ri-store-2-line" /><p>No listings yet</p></div>
        ) : (
          <div className={styles.shopGrid}>
            {shopItems.map(item => {
              const imgs  = shopImages[item.id] || []
              const price = parsePrize(item.price)
              return (
                <Link key={item.id} href={`/shop/${item.id}`} className={styles.shopCard}>
                  <div className={styles.shopImgWrap}>
                    {imgs[0]
                      ? <img src={imgs[0]} alt={item.title} className={styles.shopImg} />
                      : <div className={styles.shopImgFallback}><i className="ri-image-line" /></div>
                    }
                    <span className={styles.shopCat}>{item.category || 'Item'}</span>
                  </div>
                  <div className={styles.shopBody}>
                    <span className={styles.shopTitle}>{item.title}</span>
                    <span className={styles.shopPrice}>{price ? fmtAmt(price) : '—'}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ FEED ══════════ */}
      <Section icon="ri-compass-3-line" title="Community" href="/feed" linkLabel="Feed">
        {loadingFeed ? (
          [1,2].map(i => <SkeletonRow key={i} />)
        ) : recentPosts.length === 0 ? (
          <div className={styles.empty}><i className="ri-compass-3-line" /><p>No posts yet</p></div>
        ) : (
          <div className={styles.feedList}>
            {recentPosts.map(post => (
              <Link key={post.id} href="/feed" className={styles.feedPost}>
                <div className={styles.feedAvatar}>
                  {post.profiles?.avatar_url
                    ? <img src={post.profiles.avatar_url} alt="" />
                    : <span>{(post.profiles?.username || '?').slice(0,2).toUpperCase()}</span>
                  }
                </div>
                <div className={styles.feedBody}>
                  <div className={styles.feedMeta}>
                    <span className={styles.feedUser}>{post.profiles?.username}</span>
                    <span className={styles.feedTier}>{post.profiles?.tier}</span>
                    <span className={styles.feedTime}>{timeAgo(post.created_at)}</span>
                  </div>
                  <p className={styles.feedText}>{post.content}</p>
                  <div className={styles.feedActions}>
                    <span><i className="ri-heart-line" /> {post.likes || 0}</span>
                    <span><i className="ri-chat-1-line" /> {post.comment_count || 0}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* ══════════ SEASON BAR ══════════ */}
      <div className={styles.seasonBar}>
        <div className={styles.seasonBarRow}>
          <span><i className="ri-calendar-line" /> Season {season}</span>
          <span className={styles.seasonDays}>{daysLeft} days left</span>
        </div>
        <div className={styles.seasonTrack}>
          <div className={styles.seasonFill} style={{ width: `${Math.max(4, 100 - Math.round((daysLeft / 90) * 100))}%` }} />
        </div>
      </div>

    </div>
  )
}
