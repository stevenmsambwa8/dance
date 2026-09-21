'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/Modal'
import styles from './page.module.css'
import { GAME_META, GAME_SLUGS, RANK_META } from '../../lib/constants'
import { useGames } from '../../components/GameSettingsProvider'
import UserBadges from '../../components/UserBadges'
import useTranslation from '../../lib/useTranslation'
import usePageLoading from '../../components/usePageLoading'
import { getCurrentSeason, getDaysRemaining } from '../../lib/seasons'

const RANK_COLORS = ['#ffd54a', '#c9d3e0', '#e0a262']

function SkeletonRow() {
  return (
    <div className={styles.row}>
      <div className={styles.skelLine} style={{ width: 22, height: 14, flexShrink: 0 }} />
      <div className={styles.skelCircle} />
      <div className={styles.rowInfo}>
        <div className={styles.skelLine} style={{ width: '50%', height: 10, marginBottom: 4 }} />
        <div className={styles.skelLine} style={{ width: '65%', height: 8 }} />
      </div>
      <div className={styles.skelLine} style={{ width: 42, height: 12 }} />
    </div>
  )
}

export default function LeaderboardPage() {
  const { user, profile } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()
  const { t } = useTranslation()
  const { visibleSlugs } = useGames()

  const [selectedGame, setSelectedGame] = useState('all')
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)

  usePageLoading(loading)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      if (selectedGame === 'all') {
        const { data } = await supabase
          .from('profiles')
          .select('id,username,level,tier,points,wins,avatar_url,country_flag,email,is_season_winner,custom_badges, temp_admin_until,plan,plan_expires_at')
          .not('email', 'in', '(nabogamingss1@gmail.com)')
          .order('points', { ascending: false })
          .limit(50)
        if (!cancelled) { setList(data || []); setLoading(false) }
      } else {
        const { data, error } = await supabase
          .rpc('get_game_leaderboard', { p_game_slug: selectedGame, p_limit: 50 })
        if (!cancelled) { setList(error ? [] : (data || [])); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedGame])

  // Check follow status whenever the preview modal opens for someone new
  useEffect(() => {
    if (!selectedPlayer || !user || selectedPlayer.id === user.id) { setIsFollowing(false); return }
    let cancelled = false
    supabase
      .from('follows')
      .select('follower_id')
      .eq('follower_id', user.id)
      .eq('following_id', selectedPlayer.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsFollowing(!!data) })
    return () => { cancelled = true }
  }, [selectedPlayer, user])

  async function toggleFollow() {
    if (!user) { openAuthGate(); return }
    if (!selectedPlayer) return
    setFollowBusy(true)
    if (isFollowing) {
      await supabase.from('follows').delete()
        .eq('follower_id', user.id).eq('following_id', selectedPlayer.id)
      setIsFollowing(false)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: selectedPlayer.id })
      setIsFollowing(true)
    }
    setFollowBusy(false)
  }

  function viewFullProfile() {
    if (!selectedPlayer) return
    router.push(`/profile/${selectedPlayer.id}`)
    setSelectedPlayer(null)
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(p => p.username?.toLowerCase().includes(q))
  }, [list, search])

  const isAll = selectedGame === 'all'
  const gameMeta = GAME_META[selectedGame]
  const podium = filtered.slice(0, 3)
  const rest = filtered.slice(3)
  const podiumOrder = podium.length === 3 ? [1, 0, 2] : podium.map((_, i) => i)

  const myRankIdx = user ? list.findIndex(p => p.id === user.id) : -1

  const selPts = selectedPlayer ? (isAll ? (selectedPlayer.points || 0) : (selectedPlayer.game_points || 0)) : 0
  const selTm = selectedPlayer ? (RANK_META[selectedPlayer.tier] || RANK_META.Gold) : RANK_META.Gold
  const isSelfSelected = selectedPlayer && user?.id === selectedPlayer.id

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t('season.season') || 'Season'} {getCurrentSeason()} · {getDaysRemaining()}d left</p>
          <h1 className={styles.headline}>
            <i className="ri-trophy-fill" /> {t('players.leaderboard') || 'Leaderboard'}
          </h1>
        </div>
      </div>

      {/* Game tabs */}
      <div className={styles.gameTabRow}>
        <button
          className={`${styles.gameTab} ${isAll ? styles.gameTabActive : ''}`}
          onClick={() => setSelectedGame('all')}
        >
          <span className={styles.gameTabImgWrap}><i className="ri-global-line" /></span>
          <span className={styles.gameTabLabel}>{t('common.all') || 'All'}</span>
        </button>
        {visibleSlugs.map(slug => {
          const g = GAME_META[slug]
          return (
            <button
              key={slug}
              className={`${styles.gameTab} ${selectedGame === slug ? styles.gameTabActive : ''}`}
              onClick={() => setSelectedGame(slug)}
            >
              <span className={styles.gameTabImgWrap}>
                {g?.image
                  ? <img src={g.image} alt="" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} />
                  : null
                }
                <i className={g?.icon || 'ri-gamepad-line'} style={{ display: g?.image ? 'none' : 'flex' }} />
              </span>
              <span className={styles.gameTabLabel}>{g?.name || slug}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <i className="ri-search-line" />
        <input
          className={styles.searchInput}
          placeholder={t('players.searchPlayers') || 'Search players…'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className={styles.searchClear} onClick={() => setSearch('')}>
            <i className="ri-close-line" />
          </button>
        )}
      </div>

      {/* Your position */}
      {user && myRankIdx > -1 && !search && (
        <button className={styles.myRankCard} onClick={() => setSelectedPlayer(list[myRankIdx])}>
          <span className={styles.myRankLabel}>{t('players.yourPosition') || 'Your Position'}</span>
          <div className={styles.myRankBody}>
            <span className={styles.myRankNum}>#{myRankIdx + 1}</span>
            <div className={styles.myRankAvatar}>
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" />
                : <span>{(profile?.username || '?').slice(0, 2).toUpperCase()}</span>
              }
            </div>
            <span className={styles.myRankName}>{profile?.username}</span>
            <span className={styles.myRankPts}>
              {(isAll ? (list[myRankIdx]?.points || 0) : (list[myRankIdx]?.game_points || 0)).toLocaleString()}
              <span className={styles.ptsLabel}> {(t('home.pts') || 'pts').toLowerCase()}</span>
            </span>
          </div>
        </button>
      )}

      {loading ? (
        <div className={styles.list}>{[1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)}</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {gameMeta?.image
            ? <img src={gameMeta.image} alt="" className={styles.emptyImg} />
            : <i className={gameMeta?.icon || 'ri-bar-chart-line'} />
          }
          <p>{search ? (t('players.noPlayersFound') || 'No players found') : (t('home.noLeaderboardYet') || `No ${gameMeta?.name || ''} tournaments scored yet`)}</p>
        </div>
      ) : (
        <>
          {podium.length > 0 && (
            <div className={styles.podium}>
              {podiumOrder.map(i => {
                const p = podium[i]
                if (!p) return null
                const isMe = user?.id === p.id
                const tm = RANK_META[p.tier] || RANK_META.Gold
                const pts = isAll ? (p.points || 0) : (p.game_points || 0)
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlayer(p)}
                    className={`${styles.podiumCard} ${styles['podiumRank' + (i + 1)]} ${isMe ? styles.rowMe : ''}`}
                  >
                    {i === 0 && <i className={`ri-vip-crown-fill ${styles.crown}`} />}
                    <div className={styles.podiumCardInner}>
                      <div className={styles.podiumAvatar} style={{ '--ring': RANK_COLORS[i] }}>
                        <div className={styles.podiumAvatarInner}>
                          {p.avatar_url
                            ? <img src={p.avatar_url} alt="" loading="lazy" decoding="async" />
                            : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>
                          }
                        </div>
                        <span className={styles.podiumRankBadge} style={{ background: RANK_COLORS[i] }}>{i + 1}</span>
                      </div>
                      <span className={styles.podiumName}>
                        {p.username}
                        {isMe && <span className={styles.youPill}>{t('home.you') || 'You'}</span>}
                      </span>
                      <span className={styles.podiumTier} style={{ color: tm.color }}>
                        <i className={tm.icon} /> {p.tier}
                      </span>
                      <span className={styles.podiumPts}>{pts.toLocaleString()}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {rest.length > 0 && (
            <div className={styles.list}>
              {rest.map((p, idx) => {
                const i = idx + 3
                const isMe = user?.id === p.id
                const tm = RANK_META[p.tier] || RANK_META.Gold
                const pts = isAll ? (p.points || 0) : (p.game_points || 0)
                return (
                  <button key={p.id} onClick={() => setSelectedPlayer(p)} className={`${styles.row} ${isMe ? styles.rowMe : ''}`}>
                    <span className={styles.rowPos}>#{i + 1}</span>
                    <div className={styles.rowAvatar}>
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" loading="lazy" decoding="async" />
                        : <span>{(p.username || '?').slice(0, 2).toUpperCase()}</span>
                      }
                    </div>
                    <div className={styles.rowInfo}>
                      <span className={styles.rowName}>
                        {p.username}
                        {isMe && <span className={styles.youPill}>{t('home.you') || 'You'}</span>}
                        <UserBadges email={p.email} plan={p.plan} planExpiresAt={p.plan_expires_at} countryFlag={p.country_flag} isSeasonWinner={p.is_season_winner} customBadges={p.custom_badges} tempAdminUntil={p.temp_admin_until} size={11} gap={2} />
                      </span>
                      <span className={styles.rowSub} style={{ color: tm.color }}>
                        <i className={tm.icon} /> {p.tier} · Lv.{p.level ?? 1} · {p.wins || 0}W
                      </span>
                    </div>
                    <span className={styles.rowPts}>
                      {pts.toLocaleString()}
                      <span className={styles.ptsLabel}> {(t('home.pts') || 'pts').toLowerCase()}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Player preview modal */}
      <Modal
        open={!!selectedPlayer}
        onClose={() => setSelectedPlayer(null)}
        title={selectedPlayer?.username || t('players.players') || 'Player'}
        size="sm"
        footer={selectedPlayer && (
          <>
            {!isSelfSelected && (
              <button
                className={`${styles.modalFollowBtn} ${isFollowing ? styles.modalFollowBtnActive : ''}`}
                onClick={toggleFollow}
                disabled={followBusy}
              >
                <i className={isFollowing ? 'ri-user-check-line' : 'ri-user-add-line'} />
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
            <button className={styles.modalViewBtn} onClick={viewFullProfile}>
              <i className="ri-user-3-line" /> View Profile
            </button>
          </>
        )}
      >
        {selectedPlayer && (
          <div className={styles.modalBody}>
            <div className={styles.modalAvatarWrap} style={{ '--ring': selTm.color }}>
              <div className={styles.modalAvatarInner}>
                {selectedPlayer.avatar_url
                  ? <img src={selectedPlayer.avatar_url} alt="" />
                  : <span>{(selectedPlayer.username || '?').slice(0, 2).toUpperCase()}</span>
                }
              </div>
            </div>
            <div className={styles.modalNameRow}>
              <span className={styles.modalName}>{selectedPlayer.username}</span>
              {isSelfSelected && <span className={styles.youPill}>{t('home.you') || 'You'}</span>}
            </div>
            <div className={styles.modalBadgesRow}>
              <UserBadges email={selectedPlayer.email} plan={selectedPlayer.plan} planExpiresAt={selectedPlayer.plan_expires_at} countryFlag={selectedPlayer.country_flag} isSeasonWinner={selectedPlayer.is_season_winner} customBadges={selectedPlayer.custom_badges} tempAdminUntil={selectedPlayer.temp_admin_until} size={13} gap={4} />
            </div>
            <div className={styles.modalTier} style={{ color: selTm.color }}>
              <i className={selTm.icon} /> {selectedPlayer.tier}
            </div>

            <div className={styles.modalStatsGrid}>
              <div className={styles.modalStat}>
                <span className={styles.modalStatVal}>{selPts.toLocaleString()}</span>
                <span className={styles.modalStatLabel}>{t('players.points') || 'Points'}</span>
              </div>
              <div className={styles.modalStat}>
                <span className={styles.modalStatVal}>{selectedPlayer.wins || 0}</span>
                <span className={styles.modalStatLabel}>{t('players.wins') || 'Wins'}</span>
              </div>
              <div className={styles.modalStat}>
                <span className={styles.modalStatVal}>{selectedPlayer.level ?? 1}</span>
                <span className={styles.modalStatLabel}>Lv.</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
