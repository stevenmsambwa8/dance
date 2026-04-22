'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../components/AuthProvider'
import { supabase } from '../lib/supabase'
import styles from './page.module.css'
import { getCurrentSeason, getDaysRemaining, TIER_ORDER, TIER_WIN_THRESHOLD, getLevelWinThreshold, MAX_LEVEL } from '../lib/seasons'
import { GAME_META, GAME_SLUGS } from '../lib/constants'
import UserBadges from '../components/UserBadges'
import usePageLoading from '../components/usePageLoading'

export default function Home() {
  const { user, profile, isAdmin } = useAuth()

  const [tournaments, setTournaments]     = useState([])
  const [topPlayers, setTopPlayers]       = useState([])
  const [liveMatches, setLiveMatches]     = useState([])
  const [shopItems, setShopItems]         = useState([])
  const [shopImages, setShopImages]       = useState({})
  const [recentPosts, setRecentPosts]     = useState([])
  const [publicLoading, setPublicLoading] = useState(true)
  usePageLoading(publicLoading)

  const [upcoming, setUpcoming]       = useState([])
  const [recent, setRecent]           = useState([])
  const [userLoading, setUserLoading] = useState(false)

  useEffect(() => { loadPublic() }, [])

  // Re-fetch tournaments when any participant joins so count stays live
  useEffect(() => {
    const ch = supabase
      .channel('home-tourney-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, async () => {
        const { data } = await supabase
          .from('tournaments')
          .select('id, name, game_slug, status, slots, registered_count, date, prize')
          .in('status', ['active', 'upcoming'])
          .order('created_at', { ascending: false })
          .limit(4)
        if (data) setTournaments(data)
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  useEffect(() => {
    if (!user) return
    setUserLoading(true)
    loadUserData()
  }, [user])

  async function loadPublic() {
    setPublicLoading(true)
    const [{ data: tourns }, { data: players }, { data: matches }, { data: items }, { data: posts }] = await Promise.all([
      supabase
        .from('tournaments')
        .select('id, name, game_slug, status, slots, registered_count, date, prize')
        .in('status', ['active', 'upcoming'])
        .order('created_at', { ascending: false })
        .limit(4),
      supabase
        .from('profiles')
        .select('id, username, level, tier, points, wins, season_wins, avatar_url, country_flag, email, is_season_winner')
        .not('email', 'in', '(nabogamingss1@gmail.com)')
        .order('points', { ascending: false })
        .limit(5),
      supabase
        .from('matches')
        .select('id, slug, game_mode, status, scheduled_at, challenger:profiles!matches_challenger_id_fkey(username, level), challenged:profiles!matches_challenged_id_fkey(username, level)')
        .in('status', ['confirmed', 'pending', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(4),
      supabase
        .from('shop_items')
        .select('id, title, price, category, profiles(username)')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(4),
      supabase
        .from('posts')
        .select('id, content, likes, comment_count, created_at, profiles(id, username, avatar_url, tier)')
        .order('created_at', { ascending: false })
        .limit(4),
    ])
    setTournaments(tourns || [])
    setTopPlayers(players || [])
    setLiveMatches(matches || [])
    setShopItems(items || [])
    setRecentPosts(posts || [])
    setPublicLoading(false)
    // Load shop images
    if (items?.length) {
      const ids = items.map(i => i.id)
      const { data: imgs } = await supabase
        .from('shop_item_images')
        .select('item_id, url, sort_order')
        .in('item_id', ids)
        .order('sort_order', { ascending: true })
      if (imgs) {
        const map = {}
        imgs.forEach(img => { if (!map[img.item_id]) map[img.item_id] = []; map[img.item_id].push(img.url) })
        setShopImages(map)
      }
    }
  }

  async function loadUserData() {
    const [{ data: upData }, { data: recData }] = await Promise.all([
      supabase
        .from('matches')
        .select('id, game_mode, status, scheduled_at, challenger_id, challenged_id, challenger:profiles!matches_challenger_id_fkey(username, level, tier), challenged:profiles!matches_challenged_id_fkey(username, level, tier)')
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .in('status', ['confirmed', 'pending', 'challenged'])
        .order('scheduled_at', { ascending: true })
        .limit(5),
      supabase
        .from('matches')
        .select('id, game_mode, status, score_challenger, score_challenged, winner_id, challenger_id, challenged_id, challenger:profiles!matches_challenger_id_fkey(id, username, level), challenged:profiles!matches_challenged_id_fkey(id, username, level)')
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(5),
    ])
    setUpcoming(upData || [])
    setRecent(recData || [])
    setUserLoading(false)
  }

  function getOpponent(match) {
    if (!user) return null
    return match.challenger_id === user.id ? match.challenged : match.challenger
  }

  function formatTime(iso) {
    if (!iso) return 'TBD'
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function parsePrize(raw) {
    if (!raw) return null
    const n = Number(String(raw).replace(/[^0-9.]/g, ''))
    return isNaN(n) || n <= 0 ? null : n
  }

  function fmtTZS(n) {
    return `TZS ${Number(n).toLocaleString()}`
  }

  const stats = profile ? (() => {
    const sw = profile.season_wins  ?? 0
    const sl = profile.season_losses ?? 0
    const tw = profile.wins   ?? 0
    const tl = profile.losses ?? 0
    return [
      { label: 'Level',        value: `Lv.${profile.level ?? 1}` },
      { label: 'Season Wins',  value: sw },
      { label: 'Win Rate',     value: tw + tl > 0 ? `${Math.round((tw / (tw + tl)) * 100)}%` : '—' },
      { label: 'Points',       value: profile.points?.toLocaleString() ?? '—' },
    ]
  })() : null

  const season = getCurrentSeason()
  const daysLeft = getDaysRemaining()

  return (
    <div className={styles.page}>

      {/* ── Hero ── */}
      <div className={styles.hero}>
        {/* Fading avatar background */}
        {profile?.avatar_url && (
          <div
            className={styles.heroBg}
            style={{ backgroundImage: `url(${profile.avatar_url})` }}
          />
        )}

        <div className={styles.heroInner}>
          <div className={styles.heroLeft}>
            <p className={styles.eyebrow}>Season {season} · {daysLeft}d left</p>
            <h1 className={styles.headline}>
              {profile?.username || 'ARENA'}
              {profile && <UserBadges email={profile.email} countryFlag={profile.country_flag} isSeasonWinner={profile.is_season_winner} size={18} />}
            </h1>
            {!user && <p className={styles.heroSub}>Sign in to track your matches and climb the ranks.</p>}
          </div>

          {profile && (
            <div className={styles.rankBadge}>
              <span className={styles.rankLabel}>LEVEL</span>
              <span className={styles.rankNum}>Lv.{profile.level ?? 1}</span>
              <span className={styles.rankTier}>{profile.tier || '—'}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats or Guest CTA ── */}
      {stats ? (
        <div className={styles.statsGrid}>
          {stats.map(s => (
            <div key={s.label} className={styles.statCard}>
              <span className={styles.statLabel}>{s.label}</span>
              <span className={styles.statValue}>{s.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.guestCTA}>
          <Link href="/login" className={styles.ctaBtn}><i className="ri-login-box-line" /> Sign In</Link>
          <Link href="/tournaments" className={styles.ctaSecondary}><i className="ri-node-tree" /> Browse Tournaments</Link>
        </div>
      )}

      {/* ── Tier Progress (logged-in only) ── */}
      {profile && (() => {
        const tier = profile.tier || 'Gold'
        const tierIdx = TIER_ORDER.indexOf(tier)
        const isMax = tierIdx === TIER_ORDER.length - 1
        const nextTier = isMax ? null : TIER_ORDER[tierIdx + 1]
        const levelThreshold = getLevelWinThreshold(profile.level ?? 1)
        const threshold = TIER_WIN_THRESHOLD[tier] || 50
        const seasonWins = profile.season_wins ?? 0
        const pct = isMax ? 100 : Math.min(100, Math.round((seasonWins / threshold) * 100))
        const winsLeft = isMax ? 0 : Math.max(0, threshold - seasonWins)
        return (
          <div className={styles.tierBar}>
            <div className={styles.tierBarTop}>
              <span className={styles.tierBarLabel}>
                <i className="ri-shield-star-line" /> {tier}
              </span>
              {isMax
                ? <span className={styles.tierBarMax}>Max tier 🏆</span>
                : <span className={styles.tierBarNext}>{winsLeft} win{winsLeft !== 1 ? 's' : ''} to {nextTier}</span>
              }
            </div>
            <div className={styles.tierTrack}>
              <div className={styles.tierFill} style={{ width: `${Math.max(pct, seasonWins > 0 ? 4 : 0)}%` }} />
            </div>
            <div className={styles.tierBarSub}>
              <span>{seasonWins} / {threshold} season wins</span>
              <span>{profile.wins || 0} total wins</span>
            </div>
            <div className={styles.tierBarTop} style={{ marginTop: 12 }}>
              <span className={styles.tierBarLabel} style={{ fontSize: 12 }}>
                <i className="ri-bar-chart-fill" /> Level {profile.level ?? 1}{(profile.level ?? 1) < MAX_LEVEL ? ` → ${(profile.level ?? 1) + 1}` : ''}
              </span>
              {(profile.level ?? 1) >= MAX_LEVEL
                ? <span className={styles.tierBarMax}>Max level 🌟</span>
                : <span className={styles.tierBarNext}>{Math.max(0, levelThreshold - seasonWins)} wins to Lv.{(profile.level ?? 1) + 1}</span>
              }
            </div>
            <div className={styles.tierTrack}>
              <div className={styles.tierFill} style={{
                width: `${(profile.level ?? 1) >= MAX_LEVEL ? 100 : Math.max(Math.min(100, Math.round((seasonWins / levelThreshold) * 100)), seasonWins > 0 ? 4 : 0)}%`,
                background: 'var(--accent)', opacity: 0.5,
              }} />
            </div>
          </div>
        )
      })()}

      {/* ── My Matches (user only) ── */}
      {user && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}><i className="ri-swords-line" /> My Matches</h2>
            <Link href="/matches" className={styles.sectionLink}>All matches <i className="ri-arrow-right-s-line" /></Link>
          </div>
          {userLoading ? (
            <div className={styles.skeletonList}>
              {[1,2,3].map(i => (
                <div key={i} className={styles.skeletonRow}>
                  <div className={styles.skeletonBlock} style={{ width: 44 }} />
                  <div className={styles.skeletonBlock} style={{ flex: 1 }} />
                  <div className={styles.skeletonBlock} style={{ width: 60 }} />
                </div>
              ))}
            </div>
          ) : upcoming.length === 0 && recent.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="ri-swords-line" />
              <p>No matches yet — challenge a player to get started</p>
              <Link href="/players" className={styles.ctaBtn}><i className="ri-user-search-line" /> Find Players</Link>
            </div>
          ) : (
            <div className={styles.matchList}>
              {upcoming.slice(0, 3).map(m => {
                const opp = getOpponent(m)
                return (
                  <Link key={m.id} href={`/matches/${m.slug || m.id}`} className={styles.matchRow}>
                    <div className={styles.matchTime}>{formatTime(m.scheduled_at)}</div>
                    <span className={styles.matchVs}>VS</span>
                    <div className={styles.matchOpponent}>
                      <span className={styles.oppName}>{opp?.username || '—'}</span>
                      <span className={styles.oppRank}>Lv.{opp?.level ?? 1}</span>
                    </div>
                    <div className={styles.matchGame}>{m.game_mode}</div>
                    <div className={`${styles.matchStatus} ${styles[m.status]}`}>{m.status?.toUpperCase()}</div>
                  </Link>
                )
              })}
              {recent.slice(0, 2).map(r => {
                const isChallenger = r.challenger_id === user.id
                const opp = isChallenger ? r.challenged : r.challenger
                const won = r.winner_id === user.id
                const result = r.winner_id ? (won ? 'WIN' : 'LOSS') : 'DRAW'
                const myScore = isChallenger ? r.score_challenger : r.score_challenged
                const oppScore = isChallenger ? r.score_challenged : r.score_challenger
                const score = (myScore != null && oppScore != null) ? `${myScore}–${oppScore}` : '—'
                return (
                  <Link key={r.id} href={`/matches/${r.slug || r.id}`} className={styles.resultRow}>
                    <span className={`${styles.result} ${result === 'WIN' ? styles.win : styles.loss}`}>{result}</span>
                    <span className={styles.resultOpp}>{opp?.username || '—'}</span>
                    <span className={styles.resultScore}>{score}</span>
                    <span className={`${styles.resultPts} ${result === 'WIN' ? styles.winPts : styles.lossPts}`}>
                      {result === 'WIN' ? '+10' : result === 'LOSS' ? '−5' : '0'}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Active Tournaments ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-node-tree" /> Tournaments</h2>
          <Link href="/tournaments" className={styles.sectionLink}>See all <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {publicLoading ? (
          <div className={styles.tournamentList}>
            {[1,2].map(i => <div key={i} className={styles.skeletonTCard} />)}
          </div>
        ) : tournaments.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="ri-node-tree" />
            <p>No active tournaments right now — check back soon</p>
            <Link href="/tournaments" className={styles.ctaBtn}><i className="ri-node-tree" /> Browse All</Link>
          </div>
        ) : (
          <div className={styles.tournamentList}>
            {tournaments.map(t => {
              const game = GAME_META[t.game_slug]
              const prize = parsePrize(t.prize)
              const pct = t.slots ? Math.min(100, Math.round(((t.registered_count || 0) / t.slots) * 100)) : 0
              const isFull = (t.registered_count || 0) >= t.slots
              return (
                <Link key={t.id} href={`/tournaments/${t.id}`} className={styles.tCard}>
                  <div className={styles.tCardTop}>
                    <div className={styles.tCardMeta}>
                      <span className={styles.tGameTag}>
                        <i className={game?.icon || 'ri-gamepad-line'} /> {game?.name || t.game_slug}
                      </span>
                      <span className={`${styles.tStatusBadge} ${t.status === 'active' ? styles.tStatusActive : styles.tStatusUpcoming}`}>
                        <i className={t.status === 'active' ? 'ri-live-line' : 'ri-time-line'} /> {t.status}
                      </span>
                      {isFull && <span className={styles.tFullBadge}><i className="ri-lock-line" /> Full</span>}
                    </div>
                    <h3 className={styles.tCardName}>{t.name}</h3>
                  </div>
                  <div className={styles.tCardStats}>
                    {prize && <span><i className="ri-trophy-line" />TZS {prize.toLocaleString()}</span>}
                    {t.date && <span><i className="ri-calendar-event-line" />{t.date}</span>}
                    {t.format && <span><i className="ri-gamepad-line" />{t.format}</span>}
                  </div>
                  <div className={styles.tSlotBar}>
                    <div className={styles.tSlotLabels}>
                      <span><i className="ri-group-line" /> {t.registered_count || 0} / {t.slots} players</span>
                      <span className={pct >= 80 ? styles.tSlotHot : ''}>{pct}%{pct >= 80 && <> <i className="ri-fire-line" /></>}</span>
                    </div>
                    <div className={styles.tSlotTrack}>
                      <div
                        className={`${styles.tSlotFill} ${isFull ? styles.tSlotFull : pct >= 80 ? styles.tSlotWarm : ''}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className={styles.tCardFooter}>
                    <span>View bracket &amp; details <i className="ri-arrow-right-line" /></span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Top Players ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-bar-chart-line" /> Top Players</h2>
          <Link href="/feed" className={styles.sectionLink}>Community <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {!publicLoading && (
          <div className={styles.playerList}>
            {topPlayers.map((p, i) => {
              const isMe = user?.id === p.id
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              return (
                <Link key={p.id} href={`/profile/${p.id}`} className={`${styles.playerRow} ${isMe ? styles.playerRowMe : ''}`}>
                  <div className={styles.playerRankCol}>
                    {medal
                      ? <span className={styles.playerMedal}>{medal}</span>
                      : <span className={styles.playerPos}>#{i + 1}</span>}
                  </div>
                  <div className={styles.playerAvatar}>
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" className={styles.avatarImg} />
                      : <span className={styles.avatarFallback}>{(p.username || '?').slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <div className={styles.playerInfo}>
                    <span className={styles.playerName}>
                      {p.username || '—'}
                      {isMe && <span className={styles.youBadge}>You</span>}
                      <UserBadges email={p.email} countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} size={11} gap={2} />
                    </span>
                    <span className={styles.playerTier}>{p.tier || 'Gold'} · Lv.{p.level ?? 1} · {p.wins || 0}W</span>
                  </div>
                  <span className={styles.playerPoints}>
                    {(p.points || 0).toLocaleString()} <span className={styles.ptsLabel}>pts</span>
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Scheduled Matches (public) ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-calendar-check-line" /> Scheduled Matches</h2>
          <Link href="/matches" className={styles.sectionLink}>All matches <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {publicLoading ? (
          <div className={styles.skeletonList}>
            {[1,2,3].map(i => (
              <div key={i} className={styles.skeletonRow}>
                <div className={styles.skeletonBlock} style={{ width: 44 }} />
                <div className={styles.skeletonBlock} style={{ flex: 1 }} />
                <div className={styles.skeletonBlock} style={{ width: 60 }} />
              </div>
            ))}
          </div>
        ) : liveMatches.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="ri-calendar-check-line" />
            <p>No scheduled matches right now</p>
            <Link href="/players" className={styles.ctaBtn}><i className="ri-user-search-line" /> Find Players</Link>
          </div>
        ) : (
          <div className={styles.matchList}>
            {liveMatches.map(m => (
              <Link key={m.id} href={`/matches/${m.slug || m.id}`} className={styles.matchRow}>
                <div className={styles.matchTime}>{formatTime(m.scheduled_at)}</div>
                <div className={styles.matchOpponent} style={{ gap: 6 }}>
                  <span className={styles.oppName}>{m.challenger?.username || '—'}</span>
                  <span className={styles.matchVs}>vs</span>
                  <span className={styles.oppName}>{m.challenged?.username || '—'}</span>
                </div>
                <div className={styles.matchGame}>{m.game_mode}</div>
                <div className={`${styles.matchStatus} ${styles[m.status]}`}>{m.status?.toUpperCase()}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Shop Spotlight ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-store-2-line" /> Shop Spotlight</h2>
          <Link href="/shop" className={styles.sectionLink}>Browse all <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {publicLoading ? (
          <div className={styles.shopGrid}>
            {[1,2,3,4].map(i => <div key={i} className={styles.skeletonShopCard} />)}
          </div>
        ) : shopItems.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="ri-store-2-line" />
            <p>No listings yet — be the first to sell something</p>
            <Link href="/shop" className={styles.ctaBtn}><i className="ri-add-line" /> Visit Shop</Link>
          </div>
        ) : (
          <div className={styles.shopGrid}>
            {shopItems.map(item => {
              const price = parsePrize(item.price)
              const imgs = shopImages[item.id] || []
              return (
                <Link key={item.id} href={`/shop/${item.id}`} className={styles.shopCard}>
                  <div className={styles.shopCardImgWrap}>
                    {imgs.length > 0
                      ? <img src={imgs[0]} alt={item.title} className={styles.shopCardImg} />
                      : <div className={styles.shopCardImgEmpty}><i className="ri-image-line" /></div>
                    }
                    <span className={styles.shopCatBadge}>{item.category || 'item'}</span>
                  </div>
                  <div className={styles.shopCardBody}>
                    <span className={styles.shopSeller}><i className="ri-user-line" />{item.profiles?.username || 'Unknown'}</span>
                    <p className={styles.shopTitle}>{item.title}</p>
                    <div className={styles.shopCardFooter}>
                      <span className={styles.shopPrice}>{price ? fmtTZS(price) : 'TZS —'}</span>
                      <span className={styles.shopViewBtn}>View <i className="ri-arrow-right-line" /></span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Community Feed ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-compass-3-line" /> Community</h2>
          <Link href="/feed" className={styles.sectionLink}>View feed <i className="ri-arrow-right-s-line" /></Link>
        </div>
        {publicLoading ? (
          <div className={styles.skeletonList}>
            {[1,2,3].map(i => (
              <div key={i} className={styles.skeletonRow}>
                <div className={styles.skeletonAvatar} />
                <div className={styles.skeletonBlock} style={{ flex: 1 }} />
              </div>
            ))}
          </div>
        ) : recentPosts.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="ri-compass-3-line" />
            <p>No posts yet — be the first to share something</p>
            <Link href="/feed" className={styles.ctaBtn}><i className="ri-quill-pen-line" /> Go to Feed</Link>
          </div>
        ) : (
          <div className={styles.feedList}>
            {recentPosts.map(post => {
              const ago = (() => {
                const s = Math.floor((Date.now() - new Date(post.created_at)) / 1000)
                if (s < 60) return `${s}s`
                if (s < 3600) return `${Math.floor(s / 60)}m`
                if (s < 86400) return `${Math.floor(s / 3600)}h`
                return `${Math.floor(s / 86400)}d`
              })()
              return (
                <Link key={post.id} href="/feed" className={styles.feedPost}>
                  <div className={styles.feedPostHeader}>
                    <Link href="/feed" className={styles.feedAvatarLink} onClick={e => e.stopPropagation()}>
                      <div className={styles.feedAvatar}>
                        {post.profiles?.avatar_url
                          ? <img src={post.profiles.avatar_url} alt="" className={styles.avatarImg} />
                          : <span>{(post.profiles?.username || '?').slice(0, 2).toUpperCase()}</span>}
                      </div>
                    </Link>
                    <div className={styles.feedPostMeta}>
                      <span className={styles.feedUser}>{post.profiles?.username || '—'} <span className={styles.feedTier}>{post.profiles?.tier}</span></span>
                      <span className={styles.feedTime}>{ago}</span>
                    </div>
                  </div>
                  <p className={styles.feedText}>{post.content}</p>
                  <div className={styles.feedPostActions}>
                    <span className={styles.feedAction}><i className="ri-heart-line" /> {post.likes || 0}</span>
                    <span className={styles.feedAction}><i className="ri-chat-1-line" /> {post.comment_count || 0}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Games ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}><i className="ri-gamepad-line" /> Games</h2>
          <Link href="/games" className={styles.sectionLink}>All games <i className="ri-arrow-right-s-line" /></Link>
        </div>
        <div className={styles.gamesGrid}>
          {GAME_SLUGS.map(slug => {
            const game = GAME_META[slug]
            return (
              <Link key={slug} href={`/games/${slug}`} className={styles.gameCard}>
                {game?.image
                  ? <img src={game.image} alt={game.name} className={styles.gameCardImg} />
                  : <i className={game?.icon || 'ri-gamepad-line'} />}
                <span>{game?.name || slug}</span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* ── Season Progress Bar ── */}
      <div className={styles.seasonBar}>
        <div className={styles.seasonBarTop}>
          <span className={styles.seasonBarLabel}><i className="ri-calendar-line" /> Season {season}</span>
          <span className={styles.seasonBarDays}>{daysLeft} days left</span>
        </div>
        <div className={styles.seasonTrack}>
          <div className={styles.seasonFill} style={{ width: `${Math.max(4, 100 - Math.round((daysLeft / 90) * 100))}%` }} />
        </div>
      </div>

      {/* ── Guest quick nav ── */}
      {!user && (
        <section className={styles.quickNav}>
          {[
            { href: '/tournaments', icon: 'ri-node-tree',      label: 'Tournaments' },
            { href: '/games',       icon: 'ri-gamepad-line',   label: 'Games' },
            { href: '/shop',        icon: 'ri-store-2-line',   label: 'Shop' },
            { href: '/feed',        icon: 'ri-compass-3-line', label: 'Feed' },
          ].map(n => (
            <Link key={n.href} href={n.href} className={styles.quickNavItem}>
              <i className={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
        </section>
      )}

    </div>
  )
}
