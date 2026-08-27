'use client'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useAuth } from '../components/AuthProvider'
import { useAuthGate } from '../components/AuthGateModal'
import { supabase } from '../lib/supabase'
import styles from './page.module.css'
import { getCurrentSeason, getDaysRemaining, TIER_ORDER, TIER_WIN_THRESHOLD, getLevelWinThreshold, MAX_LEVEL } from '../lib/seasons'
import { GAME_META, GAME_SLUGS, RANK_META } from '../lib/constants'
import UserBadges from '../components/UserBadges'
import { useCurrency } from '../lib/useCurrency'
import useTranslation from '../lib/useTranslation'
import { identityColor } from '../lib/clanColors'
import { EVENT_CATEGORY_META, deriveEventStatus, formatEventDate } from '../lib/eventCategories'

const CLAN_CAP = 125

function parsePrize(raw) {
  if (!raw) return null
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/* ── Game Master Modal ── */
function MasterModal({ gameMasters, onClose }) {
  const { t } = useTranslation()
  const [idx, setIdx] = useState(0)
  const total = gameMasters.length

  const trackRef   = useRef(null)
  const dragStart  = useRef(null)
  const dragOffset = useRef(0)
  const [dragging, setDragging]     = useState(false)
  const [liveOffset, setLiveOffset] = useState(0)
  const [sliding,  setSliding]      = useState(false)

  const cardWidth = () => trackRef.current?.offsetWidth ?? 320

  function goTo(next) {
    next = ((next % total) + total) % total
    setSliding(true)
    setLiveOffset(0)
    setIdx(next)
    setTimeout(() => setSliding(false), 300)
  }

  function onDragStart(clientX) {
    dragStart.current = { x: clientX }
    dragOffset.current = 0
    setDragging(true)
    setSliding(false)
  }
  function onDragMove(clientX) {
    if (!dragStart.current) return
    const dx = clientX - dragStart.current.x
    dragOffset.current = dx
    setLiveOffset(dx)
  }
  function onDragEnd(clientX) {
    if (!dragStart.current) return
    const dx = clientX - dragStart.current.x
    dragStart.current = null
    setDragging(false)
    const threshold = cardWidth() * 0.25
    if (dx < -threshold)     goTo(idx + 1)
    else if (dx > threshold) goTo(idx - 1)
    else                     goTo(idx)
  }

  const trackStyle = {
    transform: `translateX(calc(${-idx * 100}% + ${liveOffset}px))`,
    transition: (dragging || !sliding) ? 'none' : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
    willChange: 'transform',
  }

  const suppress = () => {
    try { localStorage.setItem('master_modal_suppress', String(Date.now() + 7*24*60*60*1000)) } catch {}
    onClose()
  }

  return (
    <div className={styles.mmBackdrop} onClick={onClose}>
      <div
        className={styles.mmClip}
        onClick={e => e.stopPropagation()}
        onMouseDown={e  => onDragStart(e.clientX)}
        onMouseMove={e  => dragging && onDragMove(e.clientX)}
        onMouseUp={e    => dragging && onDragEnd(e.clientX)}
        onMouseLeave={e => dragging && onDragEnd(e.clientX)}
        onTouchStart={e => onDragStart(e.touches[0].clientX)}
        onTouchMove={e  => onDragMove(e.touches[0].clientX)}
        onTouchEnd={e   => onDragEnd(e.changedTouches[0].clientX)}
      >
        <div className={styles.mmTrack} style={trackStyle} ref={trackRef}>
          {gameMasters.map((m, i) => {
            const game = GAME_META[m?.game_slug]
            return (
              <div className={styles.mmCard} key={i}>
                {game?.image && (
                  <div className={styles.mmBg} style={{ backgroundImage: `url(${game.image})` }} />
                )}
                <div className={styles.mmBgOverlay} />
                <div className={styles.mmTopBar}>
                  <div className={styles.mmGameChip}>
                    {game?.image && <img src={game.image} alt={game?.name} className={styles.mmGameChipImg} />}
                    <span>{game?.name || m?.game_slug}</span>
                  </div>
                  <button className={styles.mmClose} onClick={onClose}>
                    <i className="ri-close-line" />
                  </button>
                </div>
                <div className={styles.mmBody}>
                  <p className={styles.mmLabel}><i className="ri-crown-fill" /> {t('home.weeklyMaster')}</p>
                  <div className={styles.mmAvatarWrap}>
                    {m?.avatar_url
                      ? <img src={m.avatar_url} alt={m.username} className={styles.mmAvatarImg} />
                      : <span className={styles.mmAvatarFallback}>{m?.username?.[0]?.toUpperCase()}</span>
                    }
                  </div>
                  <h2 className={styles.mmName}>{m?.username}</h2>
                  <div className={styles.mmMeta}>
                    <span className={styles.mmTier}>
                      <i className="ri-shield-star-fill" />{m?.tier || 'Gold'}
                    </span>
                    {m?.country_flag && (
                      <span className={styles.mmFrom}>
                        <span className={styles.mmFromLabel}>{t('home.from')}</span>
                        <img src={`/${m.country_flag}.png`} alt={m.country_flag} className={styles.mmFromFlag} />
                      </span>
                    )}
                  </div>
                  <div className={styles.mmStats}>
                    <div className={styles.mmStat}>
                      <i className="ri-sword-fill" />
                      <span className={styles.mmStatVal}>{m?.total_wins ?? 0}</span>
                      <span className={styles.mmStatLabel}>{t('home.wins')}</span>
                    </div>
                    <div className={styles.mmStatDiv} />
                    <div className={styles.mmStat}>
                      <i className="ri-star-fill" />
                      <span className={styles.mmStatVal}>{m?.total_points ?? 0}</span>
                      <span className={styles.mmStatLabel}>{t('home.pts')}</span>
                    </div>
                    <div className={styles.mmStatDiv} />
                    <div className={styles.mmStat}>
                      <i className="ri-node-tree" />
                      <span className={styles.mmStatVal}>{m?.tournaments_played ?? 0}</span>
                      <span className={styles.mmStatLabel}>{t('home.played')}</span>
                    </div>
                  </div>
                  <a href={`/profile/${m?.user_id}`} className={styles.mmViewBtn} onClick={suppress}>
                    <i className="ri-user-3-line" /> {t('home.viewProfile')} <i className="ri-arrow-right-line" />
                  </a>
                  <button className={styles.mmAwesome} onClick={suppress}>
                    <i className="ri-fire-fill" /> {t('home.awesome')}
                  </button>
                  <button className={styles.mmDontShow} onClick={suppress}>{t('home.dontShow7Days')}</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {total > 1 && (
        <div className={styles.mmDots} onClick={e => e.stopPropagation()}>
          {gameMasters.map((_, i) => (
            <button
              key={i}
              className={`${styles.mmDot} ${i === idx ? styles.mmDotActive : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Tournament Quick View sidebar ──
   Opened from a tap on a homepage tournament card instead of jumping
   straight to the full tournament page. Lets the player register in one
   tap (deep-links into the tournament page's own registration flow via
   ?quickRegister=1, so payment/squad-picker logic stays in one place) or
   go look at the full page first. */
function TournamentSidebar({ tour, onClose, t, fmtAmt }) {
  const game  = GAME_META[tour.game_slug]
  const prize = parsePrize(tour.prize)
  const fee   = parsePrize(tour.entrance_fee)
  const pct   = tour.slots ? Math.min(100, Math.round(((tour.registered_count || 0) / tour.slots) * 100)) : 0
  const full  = (tour.registered_count || 0) >= tour.slots
  const href  = `/tournaments/${tour.slug || tour.id}`

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.tSidebarOverlay} onClick={onClose}>
      <div className={styles.tSidebar} onClick={(e) => e.stopPropagation()}>
        <button className={styles.tSidebarClose} onClick={onClose} aria-label="Close"><i className="ri-close-line" /></button>

        <div className={styles.tSidebarImg}>
          {game?.image
            ? <img src={game.image} alt={game.name} className={styles.tCardImgEl} />
            : <div className={styles.tCardImgFallback}><i className={game?.icon || 'ri-gamepad-line'} /></div>
          }
          <div className={styles.tCardImgBadges}>
            <span className={styles.tStatusBadge}>
              <i className="ri-circle-fill" style={{ fontSize: 6 }} /> {tour.status}
            </span>
            {full && <span className={styles.tFullBadge}><i className="ri-lock-line" /> {t('home.full')}</span>}
          </div>
        </div>

        <div className={styles.tSidebarBody}>
          <div className={styles.tGameChip}><i className={game?.icon || 'ri-gamepad-line'} /> {game?.name || tour.game_slug}</div>
          <h2 className={styles.tSidebarName}>{tour.name}</h2>

          <div className={styles.tStatRow}>
            <span><i className="ri-money-dollar-circle-line" /> {fee ? fmtAmt(fee) : t('common.free')}</span>
            <span style={{ color: prize ? '#22c55e' : 'var(--text-muted)' }}><i className="ri-trophy-line" /> {prize ? fmtAmt(prize) : t('home.noPrize')}</span>
            {tour.date && <span><i className="ri-calendar-line" /> {tour.date}</span>}
          </div>

          <div className={styles.tSlotBar}>
            <div className={styles.tSlotTrack}>
              <div className={`${styles.tSlotFill} ${full ? styles.tSlotFull : pct >= 80 ? styles.tSlotWarm : ''}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.tSlotLabel}>{tour.registered_count || 0}/{tour.slots}</span>
          </div>

          <div className={styles.tSidebarActions}>
            {full ? (
              <span className={styles.tSidebarQuickBtnDisabled}><i className="ri-lock-line" /> {t('home.full')}</span>
            ) : (
              <Link href={`${href}?quickRegister=1`} className={styles.tSidebarQuickBtn} onClick={onClose}>
                <i className="ri-flashlight-line" /> {t('home.quickRegister')}
              </Link>
            )}
            <Link href={href} className={styles.tSidebarViewBtn} onClick={onClose}>
              <i className="ri-eye-line" /> {t('home.viewTournament')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
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

/* Shape-matched skeletons — mirror the real card/row markup below so each
   section's loading state actually looks like what's about to appear,
   instead of one generic block/row reused everywhere. */
function SkeletonEventCard() {
  return (
    <div className={styles.eCard} style={{ animation: 'none' }}>
      <div className={styles.eCardImg}><div className={styles.skelBlock} style={{ position: 'absolute', inset: 0, borderRadius: 0 }} /></div>
      <div className={styles.eCardBody}>
        <div className={styles.skelLine} style={{ width: '32%', height: 8, marginBottom: 8 }} />
        <div className={styles.skelLine} style={{ width: '72%', height: 12, marginBottom: 10 }} />
        <div className={styles.skelLine} style={{ width: '50%', height: 8 }} />
      </div>
    </div>
  )
}

function SkeletonTournamentCard() {
  return (
    <div className={styles.tCard} style={{ animation: 'none' }}>
      <div className={styles.tCardImg}><div className={styles.skelBlock} style={{ position: 'absolute', inset: 0, borderRadius: 0 }} /></div>
      <div className={styles.tCardBody}>
        <div className={styles.skelLine} style={{ width: '32%', height: 8, marginBottom: 8 }} />
        <div className={styles.skelLine} style={{ width: '72%', height: 12, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div className={styles.skelLine} style={{ width: 46, height: 8 }} />
          <div className={styles.skelLine} style={{ width: 46, height: 8 }} />
          <div className={styles.skelLine} style={{ width: 46, height: 8 }} />
        </div>
        <div className={styles.skelLine} style={{ width: '100%', height: 7, borderRadius: 99 }} />
      </div>
    </div>
  )
}
function SkeletonLeaderRow() {
  return (
    <div className={styles.leaderRow}>
      <div className={styles.skelLine} style={{ width: 18, height: 14, flexShrink: 0 }} />
      <div className={styles.skelCircle} />
      <div className={styles.leaderInfo}>
        <div className={styles.skelLine} style={{ width: '50%', height: 10, marginBottom: 4 }} />
        <div className={styles.skelLine} style={{ width: '65%', height: 8 }} />
      </div>
      <div className={styles.skelLine} style={{ width: 42, height: 12 }} />
    </div>
  )
}
function SkeletonClanCard() {
  return (
    <div className={styles.clanCard} style={{ background: 'var(--bg-2)' }}>
      <div className={styles.clanCardBody}>
        <div className={styles.clanCardTop}>
          <div className={styles.skelBlock} style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
            <div className={styles.skelLine} style={{ width: '70%', height: 10 }} />
            <div className={styles.skelLine} style={{ width: '40%', height: 8 }} />
          </div>
        </div>
        <div className={styles.skelLine} style={{ width: '55%', height: 8, marginTop: 4 }} />
        <div className={styles.skelLine} style={{ width: '100%', height: 3, borderRadius: 2 }} />
      </div>
    </div>
  )
}
function SkeletonShopCard() {
  return (
    <div className={styles.shopCard}>
      <div className={styles.shopImgWrap}><div className={styles.skelBlock} style={{ position: 'absolute', inset: 0, borderRadius: 0 }} /></div>
      <div className={styles.shopBody}>
        <div className={styles.skelLine} style={{ width: '80%', height: 10, marginBottom: 4 }} />
        <div className={styles.skelLine} style={{ width: '40%', height: 10 }} />
      </div>
    </div>
  )
}
function SkeletonHeroBody() {
  return (
    <div className={styles.heroBody}>
      <div className={styles.skelLine} style={{ width: '48%', height: 22, marginBottom: 10, borderRadius: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div className={styles.skelLine} style={{ width: 70, height: 22, borderRadius: 99 }} />
        <div className={styles.skelLine} style={{ width: 56, height: 22, borderRadius: 99 }} />
        <div className={styles.skelLine} style={{ width: 60, height: 22, borderRadius: 99 }} />
      </div>
      <div className={styles.heroStats}>
        {[1,2,3,4].map(i => (
          <div key={i} className={styles.heroStat} style={{ background: 'var(--bg-2)', border: 'none' }}>
            <div className={styles.skelLine} style={{ width: 26, height: 16, marginBottom: 5 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div className={styles.skelLine} style={{ width: 8, height: 8, borderRadius: '50%' }} />
              <div className={styles.skelLine} style={{ width: 30, height: 8 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
function SkeletonFeedPost() {
  return (
    <div className={styles.feedPost}>
      <div className={styles.skelCircle} style={{ width: 36, height: 36 }} />
      <div className={styles.feedBody}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <div className={styles.skelLine} style={{ width: 68, height: 9 }} />
          <div className={styles.skelLine} style={{ width: 38, height: 9 }} />
        </div>
        <div className={styles.skelLine} style={{ width: '95%', height: 9, marginBottom: 4 }} />
        <div className={styles.skelLine} style={{ width: '70%', height: 9, marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 12 }}>
          <div className={styles.skelLine} style={{ width: 22, height: 8 }} />
          <div className={styles.skelLine} style={{ width: 22, height: 8 }} />
        </div>
      </div>
    </div>
  )
}

/* ── Section wrapper ── */
function Section({ title, href, linkLabel, children, className }) {
  const { t } = useTranslation()
  return (
    <section className={`${styles.section} ${className || ''}`}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {href && <Link href={href} className={styles.sectionLink}>{linkLabel || t('home.seeAll')}</Link>}
      </div>
      {children}
    </section>
  )
}

export default function Home() {
  const { user, profile, isAdmin, loading: authLoading } = useAuth()
  const { openAuthGate } = useAuthGate()
  const { fmtAmt, currencyMeta } = useCurrency(profile?.country_flag)
  const { t } = useTranslation()

  const [tournaments,  setTournaments]  = useState([])
  const [events,       setEvents]       = useState([])
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [topPlayers,   setTopPlayers]   = useState([])
  const [selectedGame,      setSelectedGame]      = useState('all')
  const [gamePlayers,       setGamePlayers]       = useState([])
  const [loadingGamePlayers, setLoadingGamePlayers] = useState(false)
  const [shopItems,    setShopItems]    = useState([])
  const [shopImages,   setShopImages]   = useState({})
  const [recentPosts,  setRecentPosts]  = useState([])

  const [loadingTourns,  setLoadingTourns]  = useState(true)
  const [loadingPlayers, setLoadingPlayers] = useState(true)
  const [loadingShop,    setLoadingShop]    = useState(true)
  const [loadingFeed,    setLoadingFeed]    = useState(true)

  const [gameMasters,     setGameMasters]     = useState([])
  const [showMasterModal, setShowMasterModal] = useState(false)

  const [sidebarTournament, setSidebarTournament] = useState(null)

  const [availableClans, setAvailableClans] = useState([])
  const [clanSquads,     setClanSquads]     = useState({})
  const [loadingClans,   setLoadingClans]   = useState(true)

  const tGridRef = useRef(null)
  const eGridRef = useRef(null)

  useEffect(() => {
    async function loadGameMasters() {
      let masters = null
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_all_current_game_masters')
      if (!rpcErr && rpcData?.length) {
        masters = rpcData
      } else {
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
      try {
        const suppress = localStorage.getItem('master_modal_suppress')
        if (!suppress || Date.now() >= Number(suppress)) setShowMasterModal(true)
      } catch {
        setShowMasterModal(true)
      }
    }
    loadGameMasters()
  }, [])

  useEffect(() => {
    supabase
      .from('tournaments')
      .select('id,name,slug,game_slug,status,slots,registered_count,date,prize,entrance_fee,is_test,created_by,created_at')
      .in('status', ['active', 'ongoing'])
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => { setTournaments(filterTest(data)); setLoadingTourns(false) })
  }, [])

  useEffect(() => {
    supabase
      .from('events')
      .select('id,title,slug,category,banner_url,location,start_at,end_at,status,rsvp_count,is_test,created_by')
      .order('start_at', { ascending: true })
      .limit(10)
      .then(({ data }) => {
        const upcoming = (data || []).filter(ev => deriveEventStatus(ev) !== 'ended')
        setEvents(filterTest(upcoming))
        setLoadingEvents(false)
      })
  }, [])

  useEffect(() => {
    if (selectedGame === 'all') return
    setLoadingGamePlayers(true)
    supabase
      .rpc('get_game_leaderboard', { p_game_slug: selectedGame, p_limit: 5 })
      .then(({ data, error }) => {
        setGamePlayers(error ? [] : (data || []))
        setLoadingGamePlayers(false)
      })
  }, [selectedGame])

  useEffect(() => {

    supabase
      .from('profiles')
      .select('id,username,level,tier,points,wins,season_wins,avatar_url,country_flag,email,is_season_winner,custom_badges,plan,plan_expires_at')
      .not('email', 'in', '(nabogamingss1@gmail.com)')
      .order('points', { ascending: false })
      .limit(5)
      .then(({ data }) => { setTopPlayers(data || []); setLoadingPlayers(false) })

    supabase
      .from('shop_items')
      .select('id,title,price,category,profiles(username)')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => {
        setShopItems(data || [])
        setLoadingShop(false)
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

    supabase
      .from('posts')
      .select('id,content,likes,comment_count,created_at,profiles(id,username,avatar_url,tier)')
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => { setRecentPosts(data || []); setLoadingFeed(false) })

    supabase
      .from('clans')
      .select('id,code,name,game,logo_url,banner_url,tag_prefix,member_count,squad_count')
      .lt('member_count', CLAN_CAP)
      .order('member_count', { ascending: false })
      .limit(6)
      .then(({ data: clanData }) => {
        setAvailableClans(clanData || [])
        setLoadingClans(false)
        const withSquads = (clanData || []).filter(c => c.squad_count > 0).map(c => c.id)
        if (withSquads.length) {
          supabase
            .from('clan_squads')
            .select('id,code,clan_id,name,image_url,member_count')
            .in('clan_id', withSquads)
            .order('member_count', { ascending: false })
            .then(({ data: squadRows }) => {
              const grouped = {}
              ;(squadRows || []).forEach(sq => {
                if (!grouped[sq.clan_id]) grouped[sq.clan_id] = []
                if (grouped[sq.clan_id].length < 3) grouped[sq.clan_id].push(sq)
              })
              setClanSquads(grouped)
            })
        }
      })
  }, [])

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

  const allSquads = availableClans.flatMap(clan =>
    (clanSquads[clan.id] || []).map(squad => ({ squad, clan }))
  )

  /* ── Derived profile values ── */
  const season     = getCurrentSeason()
  const daysLeft   = getDaysRemaining()
  const tier       = profile?.tier || 'Gold'
  const tierMeta   = RANK_META[tier] || RANK_META.Gold
  const tierIdx    = TIER_ORDER.indexOf(tier)
  const isMaxTier  = tierIdx === TIER_ORDER.length - 1
  const nextTier   = isMaxTier ? null : TIER_ORDER[tierIdx + 1]
  const threshold  = TIER_WIN_THRESHOLD[tier] || 50
  const seasonWins = profile?.season_wins ?? 0
  const tierPct    = isMaxTier ? 100 : Math.min(100, Math.round((seasonWins / threshold) * 100))
  const winsToTier = isMaxTier ? 0 : Math.max(0, threshold - seasonWins)
  const lvl        = profile?.level ?? 1
  const lvlThreshold = getLevelWinThreshold(lvl)
  const lvlPct     = lvl >= MAX_LEVEL ? 100 : Math.min(100, Math.round((seasonWins / lvlThreshold) * 100))
  const winsToLvl  = lvl >= MAX_LEVEL ? 0 : Math.max(0, lvlThreshold - seasonWins)

  return (
    <div className={styles.page}>

      {/* ── Game Master Modal ── */}
      {showMasterModal && gameMasters.length > 0 && (
        <MasterModal gameMasters={gameMasters} onClose={() => setShowMasterModal(false)} />
      )}

      {/* ── Tournament Quick View sidebar ── */}
      {sidebarTournament && (
        <TournamentSidebar
          tour={sidebarTournament}
          onClose={() => setSidebarTournament(null)}
          t={t}
          fmtAmt={fmtAmt}
        />
      )}

      {/* ══════════ HERO ══════════ */}
      <div className={styles.hero}>
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <div className={styles.heroTop}>
            <div className={styles.heroSeason}>
              <i className="ri-calendar-line" /> {t('season.season')} {season} · {daysLeft}d {t('home.daysLeft')}
            </div>
            {authLoading ? (
              <div className={styles.skelCircle} style={{ width: 40, height: 40 }} />
            ) : profile && (
              <Link href="/account" className={styles.heroAvatarBtn}>
                {profile.avatar_url
                  ? <img src={profile.avatar_url} className={styles.heroAvatarImg} alt="" />
                  : <span className={styles.heroAvatarInit}>{(profile.username || 'P').slice(0,2).toUpperCase()}</span>
                }
              </Link>
            )}
          </div>

          {authLoading ? (
            <SkeletonHeroBody />
          ) : profile ? (
            <div className={styles.heroBody}>
              <div className={styles.heroName}>
                {profile.username}
                <UserBadges email={profile.email} plan={profile.plan} planExpiresAt={profile.plan_expires_at} countryFlag={profile.country_flag} isSeasonWinner={profile.is_season_winner} customBadges={profile.custom_badges} size={16} />
              </div>
              <div className={styles.heroBadgeRow}>
                <span className={styles.heroBadge} style={{ color: tierMeta.color, borderColor: tierMeta.color + '55', background: tierMeta.color + '18' }}>
                  <i className={tierMeta.icon} /> {tier}
                </span>
                <span className={styles.heroLvlBadge}>
                  <i className="ri-bar-chart-fill" /> Lv.{lvl}
                </span>
                <span className={styles.heroPlayStyle}>{profile.play_style || 'Player'}</span>
              </div>
              <div className={styles.heroStats}>
                {[
                  { icon: 'ri-trophy-fill',  val: profile.season_wins ?? 0, label: t('home.seasonWins') },
                  { icon: 'ri-sword-fill',   val: profile.wins ?? 0,        label: t('home.total')  },
                  { icon: 'ri-percent-line', val: (() => { const w = profile.wins ?? 0; const l = profile.losses ?? 0; return w+l > 0 ? `${Math.round(w/(w+l)*100)}%` : '—' })(), label: t('home.winRateShort') },
                  { icon: 'ri-star-fill',    val: (profile.points ?? 0).toLocaleString(), label: t('home.pts') },
                ].map(s => (
                  <div key={s.label} className={styles.heroStat}>
                    <span className={styles.heroStatVal}>{s.val}</span>
                    <span className={styles.heroStatLabel}><i className={s.icon} /> {s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : !user ? (
            <div className={styles.heroGuest}>
              <div className={styles.heroGuestTitle}>NABOGAMING</div>
              <div className={styles.heroGuestSub}>{t('home.competeWinRise')}</div>
              <div className={styles.heroGuestBtns}>
                <button onClick={openAuthGate} className={styles.heroPrimaryBtn}><i className="ri-login-box-line" /> {t('home.signIn')}</button>
                <button onClick={openAuthGate} className={styles.heroSecondaryBtn}><i className="ri-user-add-line" /> {t('home.joinFree')}</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Daily Login Rewards now lives in the Nav header (gift icon,
          between the plan icon and the sidebar toggle) — see Nav.js. */}

      {/* ══════════ TOURNAMENTS ══════════ */}
      <Section title={t('tournaments.tournaments')} href="/tournaments" linkLabel={t('common.all')}>
        {loadingTourns ? (
          <div className={styles.tGrid}><SkeletonTournamentCard /><SkeletonTournamentCard /></div>
        ) : tournaments.length === 0 ? (
          <div className={styles.empty}>
            <i className="ri-node-tree" />
            <p>{t('home.noActiveTournaments')}</p>
            <Link href="/tournaments" className={styles.emptyBtn}>{t('home.browseAll')}</Link>
          </div>
        ) : (
          <div className={styles.tGrid} ref={tGridRef}>
            {tournaments.map((tour, i) => {
              const game  = GAME_META[tour.game_slug]
              const prize = parsePrize(tour.prize)
              const fee   = parsePrize(tour.entrance_fee)
              const pct   = tour.slots ? Math.min(100, Math.round(((tour.registered_count || 0) / tour.slots) * 100)) : 0
              const full  = (tour.registered_count || 0) >= tour.slots
              const statusColors = { active: '#22c55e', ongoing: '#6366f1', upcoming: '#f59e0b' }
              const sc = statusColors[tour.status] || '#6b7280'
              return (
                <button key={`${tour.id}-${i}`} onClick={() => setSidebarTournament(tour)} className={styles.tCard}>
                  <div className={styles.tCardImg}>
                    {game?.image
                      ? <img src={game.image} alt={game.name} className={styles.tCardImgEl} loading="lazy" decoding="async" />
                      : <div className={styles.tCardImgFallback}><i className={game?.icon || 'ri-gamepad-line'} /></div>
                    }
                    <div className={styles.tCardImgBadges}>
                      <span className={styles.tStatusBadge}>
                        <i className="ri-circle-fill" style={{ fontSize: 6 }} /> {tour.status}
                      </span>
                      {full && <span className={styles.tFullBadge}><i className="ri-lock-line" /> {t('home.full')}</span>}
                    </div>
                  </div>
                  <div className={styles.tCardBody}>
                    <div className={styles.tGameChip}><i className={game?.icon || 'ri-gamepad-line'} /> {game?.name || tour.game_slug}</div>
                    <div className={styles.tCardName}>{tour.name}</div>
                    <div className={styles.tStatRow}>
                      <span><i className="ri-money-dollar-circle-line" /> {fee ? fmtAmt(fee) : t('common.free')}</span>
                      <span style={{ color: prize ? '#22c55e' : 'var(--text-muted)' }}><i className="ri-trophy-line" /> {prize ? fmtAmt(prize) : t('home.noPrize')}</span>
                      {tour.date && <span><i className="ri-calendar-line" /> {tour.date}</span>}
                    </div>
                    <div className={styles.tSlotBar}>
                      <div className={styles.tSlotTrack}>
                        <div className={`${styles.tSlotFill} ${full ? styles.tSlotFull : pct >= 80 ? styles.tSlotWarm : ''}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={styles.tSlotLabel}>{tour.registered_count || 0}/{tour.slots}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ EVENTS ══════════ */}
      <Section title={t('events.events') || 'Events'} href="/events" linkLabel={t('common.all')}>
        {loadingEvents ? (
          <div className={styles.eGrid}><SkeletonEventCard /><SkeletonEventCard /></div>
        ) : events.length === 0 ? (
          <div className={styles.empty}>
            <i className="ri-calendar-event-line" />
            <p>{t('home.noUpcomingEvents') || 'No upcoming events'}</p>
            <Link href="/events" className={styles.emptyBtn}>{t('home.browseAll')}</Link>
          </div>
        ) : (
          <div className={styles.eGrid} ref={eGridRef}>
            {events.map(ev => {
              const catMeta = EVENT_CATEGORY_META[ev.category] || EVENT_CATEGORY_META.other
              const evStatus = deriveEventStatus(ev)
              return (
                <Link key={ev.id} href={`/events/${ev.slug || ev.id}`} className={styles.eCard}>
                  <div className={styles.eCardImg}>
                    {ev.banner_url
                      ? <img src={ev.banner_url} alt={ev.title} className={styles.eCardImgEl} loading="lazy" decoding="async" />
                      : <div className={styles.eCardImgFallback} style={{ background: `${catMeta.color}22` }}><i className={catMeta.icon} style={{ color: catMeta.color }} /></div>
                    }
                    <div className={styles.eCardImgBadges}>
                      <span className={styles.eStatusBadge} style={{ background: evStatus === 'live' ? '#22c55e' : 'rgba(0,0,0,0.55)' }}>
                        <i className="ri-circle-fill" style={{ fontSize: 6 }} /> {evStatus === 'live' ? (t('home.liveNow') || 'Live') : formatEventDate(ev.start_at)}
                      </span>
                    </div>
                  </div>
                  <div className={styles.eCardBody}>
                    <div className={styles.eCatChip} style={{ color: catMeta.color, background: `${catMeta.color}18` }}><i className={catMeta.icon} /> {catMeta.label}</div>
                    <div className={styles.eCardName}>{ev.title}</div>
                    <div className={styles.eStatRow}>
                      {ev.location && <span><i className="ri-map-pin-line" /> {ev.location}</span>}
                      <span><i className="ri-group-line" /> {ev.rsvp_count || 0}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ LEADERBOARD ══════════ */}
      <Section title={t('players.leaderboard')} href="/players" linkLabel={t('home.allPlayers')}>
        <div className={styles.gameFilterRow}>
          <button
            className={`${styles.gameFilterChip} ${selectedGame === 'all' ? styles.gameFilterChipActive : ''}`}
            onClick={() => setSelectedGame('all')}
          >
            <i className="ri-global-line" /> {t('common.all')}
          </button>
          {GAME_SLUGS.map(slug => {
            const g = GAME_META[slug]
            return (
              <button
                key={slug}
                className={`${styles.gameFilterChip} ${selectedGame === slug ? styles.gameFilterChipActive : ''}`}
                onClick={() => setSelectedGame(slug)}
              >
                <i className={g?.icon || 'ri-gamepad-line'} /> {g?.name || slug}
              </button>
            )
          })}
        </div>

        {(() => {
          const isAll   = selectedGame === 'all'
          const loading = isAll ? loadingPlayers : loadingGamePlayers
          const list    = isAll ? topPlayers : gamePlayers
          const gameMeta = GAME_META[selectedGame]

          if (loading) return [1,2,3].map(i => <SkeletonLeaderRow key={i} />)

          if (list.length === 0) {
            return (
              <div className={styles.empty}>
                <i className={gameMeta?.icon || 'ri-bar-chart-line'} />
                <p>{t('home.noLeaderboardYet') || `No ${gameMeta?.name || ''} tournaments scored yet`}</p>
              </div>
            )
          }

          return (
            <div className={styles.leaderList}>
              {list.map((p, i) => {
                const isMe   = user?.id === p.id
                const medals = ['🥇', '🥈', '🥉']
                const tm     = RANK_META[p.tier] || RANK_META.Gold
                const pts    = isAll ? (p.points || 0) : (p.game_points || 0)
                return (
                  <Link key={p.id} href={`/profile/${p.id}`} className={`${styles.leaderRow} ${isMe ? styles.leaderRowMe : ''}`}>
                    <span className={styles.leaderPos}>{medals[i] || `#${i+1}`}</span>
                    <div className={styles.leaderAvatar}>
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" loading="lazy" decoding="async" />
                        : <span>{(p.username || '?').slice(0,2).toUpperCase()}</span>
                      }
                    </div>
                    <div className={styles.leaderInfo}>
                      <span className={styles.leaderName}>
                        {p.username}
                        {isMe && <span className={styles.youPill}>{t('home.you')}</span>}
                        <UserBadges email={p.email} plan={p.plan} planExpiresAt={p.plan_expires_at} countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} customBadges={p.custom_badges} size={11} gap={2} />
                      </span>
                      <span className={styles.leaderSub} style={{ color: tm.color }}>
                        <i className={tm.icon} /> {p.tier} · Lv.{p.level ?? 1} · {p.wins || 0}W
                      </span>
                    </div>
                    <span className={styles.leaderPts}>{pts.toLocaleString()}<span className={styles.ptsLabel}> {t('home.pts').toLowerCase()}</span></span>
                  </Link>
                )
              })}
            </div>
          )
        })()}
      </Section>

      {/* ══════════ GAMES GRID ══════════ */}
      <Section title={t('navigation.games')} href="/games" linkLabel={t('common.all')}>
        <div className={styles.gamesGrid}>
          {GAME_SLUGS.map(slug => {
            const game = GAME_META[slug]
            return (
              <Link key={slug} href={`/games/${slug}`} className={styles.gameCard}>
                {game?.image
                  ? <img src={game.image} alt={game.name} className={styles.gameCardImg} loading="lazy" decoding="async" />
                  : <i className={game?.icon || 'ri-gamepad-line'} className={styles.gameCardIcon} />
                }
                <div className={styles.gameCardOverlay}>{game?.name || slug}</div>
              </Link>
            )
          })}
        </div>
      </Section>

      {/* ══════════ CLANS ══════════ */}
      <Section title={t('home.clans')} href="/clans" linkLabel={t('home.allClans')}>
        {loadingClans ? (
          <div className={styles.clanGrid}><SkeletonClanCard /><SkeletonClanCard /><SkeletonClanCard /></div>
        ) : availableClans.length === 0 ? (
          <div className={styles.empty}>
            <i className="ri-shield-star-line" />
            <p>{t('home.noClansYet')}</p>
            <Link href="/clans/create" className={styles.emptyBtn}><i className="ri-add-line" /> {t('home.createClan')}</Link>
          </div>
        ) : (
          <div className={styles.clanScroll}>
            {availableClans.map(clan => {
              const accentColor = identityColor(clan.name)
              const bgImage = clan.banner_url || clan.logo_url
              const pct = Math.min(100, Math.round((clan.member_count / CLAN_CAP) * 100))
              return (
                <Link key={clan.code} href={`/clans/${clan.code}`} className={styles.clanCard}
                  style={{
                    '--clan-accent': accentColor,
                    backgroundImage: bgImage ? `url(${bgImage})` : 'none',
                    backgroundColor: bgImage ? undefined : accentColor,
                  }}>
                  <span className={`${styles.clanCardOverlay} ${bgImage ? styles.overlayGradient : styles.overlayFlat}`} />
                  <span className={styles.clanGameBadge}>
                    {GAME_META[clan.game]?.image
                      ? <img src={GAME_META[clan.game].image} alt="" className={styles.clanGameBadgeImg} loading="lazy" decoding="async" />
                      : <i className={GAME_META[clan.game]?.icon} />}
                  </span>
                  <div className={styles.clanCardBody}>
                    <div className={styles.clanCardTop}>
                      <div className={styles.clanCardLogo}>
                        {clan.logo_url ? <img src={clan.logo_url} alt="" loading="lazy" decoding="async" /> : <span>{clan.tag_prefix}</span>}
                      </div>
                      <div className={styles.clanCardNameWrap}>
                        <span className={styles.clanCardName}>{clan.name}</span>
                        <span className={styles.clanCardTag}>{clan.tag_prefix}</span>
                      </div>
                    </div>
                    <div className={styles.clanCardStats}>
                      <span><i className="ri-group-line" /> {clan.member_count}/{CLAN_CAP}</span>
                      <span><i className="ri-team-line" /> {clan.squad_count}</span>
                    </div>
                    <div className={styles.clanCapBar}>
                      <div className={styles.clanCapFill} style={{ width: `${pct}%`, background: accentColor }} />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Section>

      {/* ══════════ SQUADS ══════════ */}
      {allSquads.length > 0 && (
        <Section title={t('home.squads')} href="/clans" linkLabel={t('home.allClans')}>
          <div className={styles.squadScroll}>
            {allSquads.map(({ squad, clan }) => (
              <Link key={squad.id} href={`/clans/${clan.code}/squads/${squad.code}`} className={styles.squadCard}>
                <div className={styles.squadCardImg}>
                  {squad.image_url
                    ? <img src={squad.image_url} alt="" loading="lazy" decoding="async" />
                    : <span style={{ background: identityColor(squad.name) }}>{squad.name?.[0]?.toUpperCase()}</span>
                  }
                </div>
                <div className={styles.squadCardBody}>
                  <span className={styles.squadCardName}>{squad.name}</span>
                  <span className={styles.squadCardFrom}><i className="ri-shield-star-line" /> {t('home.from')} {clan.name}</span>
                  <span className={styles.squadCardMembers}><i className="ri-group-line" /> {squad.member_count}/5</span>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* ══════════ SHOP SPOTLIGHT ══════════ */}
      <Section title={t('shop.shop')} href="/shop" linkLabel={t('home.browseAll')}>
        {loadingShop ? (
          <div className={styles.shopGrid}><SkeletonShopCard /><SkeletonShopCard /><SkeletonShopCard /><SkeletonShopCard /></div>
        ) : shopItems.length === 0 ? (
          <div className={styles.empty}><i className="ri-store-2-line" /><p>{t('home.noListingsYet')}</p></div>
        ) : (
          <div className={styles.shopGrid}>
            {shopItems.map(item => {
              const imgs  = shopImages[item.id] || []
              const price = parsePrize(item.price)
              return (
                <Link key={item.id} href={`/shop/${item.id}`} className={styles.shopCard}>
                  <div className={styles.shopImgWrap}>
                    {imgs[0]
                      ? <img src={imgs[0]} alt={item.title} className={styles.shopImg} loading="lazy" decoding="async" />
                      : <div className={styles.shopImgFallback}><i className="ri-image-line" /></div>
                    }
                    <span className={styles.shopCat}>{item.category || t('home.item')}</span>
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

      {/* ══════════ COMMUNITY FEED ══════════ */}
      <Section title={t('navigation.community')} href="/feed" linkLabel={t('navigation.feed')}>
        {loadingFeed ? (
          [1,2].map(i => <SkeletonFeedPost key={i} />)
        ) : recentPosts.length === 0 ? (
          <div className={styles.empty}><i className="ri-compass-3-line" /><p>{t('home.noPostsYet')}</p></div>
        ) : (
          <div className={styles.feedList}>
            {recentPosts.map(post => (
              <Link key={post.id} href="/feed" className={styles.feedPost}>
                <div className={styles.feedAvatar}>
                  {post.profiles?.avatar_url
                    ? <img src={post.profiles.avatar_url} alt="" loading="lazy" decoding="async" />
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
          <span><i className="ri-calendar-line" /> {t('season.season')} {season}</span>
          <span className={styles.seasonDays}>{daysLeft} {t('home.daysLeft')}</span>
        </div>
        <div className={styles.seasonTrack}>
          <div className={styles.seasonFill} style={{ width: `${Math.max(4, 100 - Math.round((daysLeft / 90) * 100))}%` }} />
        </div>
      </div>

    </div>
  )
}
