'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Modal from '../../../components/Modal'
import { useAuth } from '../../../components/AuthProvider'
import { supabase } from '../../../lib/supabase'
import { GAME_META } from '../../../lib/constants'
import styles from './page.module.css'
import usePageLoading from '../../../components/usePageLoading'

export default function GameDetail() {
  const { slug } = useParams()
  const { user } = useAuth()
  const game = GAME_META[slug]
  if (!game) notFound()

  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)
  const [subscribed, setSubscribed] = useState(false)
  const [subCount, setSubCount] = useState(0)
  const [selected, setSelected] = useState(null)
  const [registered, setRegistered] = useState({})

  useEffect(() => { loadData() }, [slug, user])

  async function loadData() {
    const [{ data: tourns }, { count: subs }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('game_slug', slug).eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('game_subscriptions').select('*', { count: 'exact', head: true }).eq('game_slug', slug),
    ])
    setTournaments(tourns || [])
    setSubCount(subs || 0)

    if (user) {
      const [{ data: sub }, { data: regs }] = await Promise.all([
        supabase.from('game_subscriptions').select('user_id').eq('user_id', user.id).eq('game_slug', slug).maybeSingle(),
        supabase.from('tournament_participants').select('tournament_id').eq('user_id', user.id),
      ])
      setSubscribed(!!sub)
      if (regs) {
        const map = {}
        regs.forEach(r => { map[r.tournament_id] = true })
        setRegistered(map)
      }
    }
    setLoading(false)
  }

  async function toggleSubscribe() {
    if (!user) { window.location.href = '/login'; return }
    if (subscribed) {
      await supabase.from('game_subscriptions').delete().eq('user_id', user.id).eq('game_slug', slug)
      setSubCount(c => Math.max(0, c - 1))
    } else {
      await supabase.from('game_subscriptions').insert({ user_id: user.id, game_slug: slug })
      setSubCount(c => c + 1)
    }
    setSubscribed(s => !s)
  }

  async function registerTournament() {
    if (!user) { window.location.href = '/login'; return }
    if (!selected) return
    const { error } = await supabase.from('tournament_participants').insert({ tournament_id: selected.id, user_id: user.id })
    if (error) return

    // Sync real count to DB
    const { count } = await supabase.from('tournament_participants')
      .select('*', { count: 'exact', head: true }).eq('tournament_id', selected.id)
    if (count !== null) await supabase.from('tournaments').update({ registered_count: count }).eq('id', selected.id)
    const newCount = count ?? (selected.registered_count || 0) + 1

    setRegistered(r => ({ ...r, [selected.id]: true }))
    setTournaments(ts => ts.map(t => t.id === selected.id ? { ...t, registered_count: newCount } : t))

    // Place user in an open bracket slot if bracket exists
    const { data: tData } = await supabase.from('tournaments').select('bracket_data').eq('id', selected.id).single()
    if (tData?.bracket_data) {
      try {
        const bd = typeof tData.bracket_data === 'string' ? JSON.parse(tData.bracket_data) : tData.bracket_data
        if (bd?.rounds) {
          const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).maybeSingle()
          const playerSlot = { userId: user.id, name: profile?.username || 'Player', avatar: profile?.avatar_url || null, status: 'active' }
          let pick = null
          bd.rounds[0]?.forEach((pair, pi) => {
            pair.forEach((s, si) => {
              if (!pick && !s?.userId && (s?.status === 'open' || s?.status === 'bye')) pick = { pi, si }
            })
          })
          if (pick) {
            const newRounds = bd.rounds.map((r, ri) => ri !== 0 ? r : r.map((pair, pi) => {
              if (pi !== pick.pi) return pair
              return pair.map((s, si) => si === pick.si ? playerSlot : s)
            }))
            const newBd = { ...bd, rounds: newRounds, isEmpty: false }
            await supabase.from('tournaments').update({ bracket_data: newBd }).eq('id', selected.id)
          }
        }
      } catch (e) { /* bracket parse failed, skip */ }
    }

    setSelected(null)
  }

  const isJoined = selected ? !!registered[selected.id] : false
  const isFull = selected ? (selected.registered_count >= selected.slots && !isJoined) : false

  return (
    <div className={styles.page}>

      {/* Hero — full bleed, bg behind back button */}
      <div className={styles.hero}>
        {game.image && <div className={styles.heroBg} style={{ backgroundImage: `url(${game.image})` }} />}

        {/* Back sits on top of bg */}
        <Link href="/games" className={styles.back}>
          <i className="ri-arrow-left-line" /> All Games
        </Link>

        <div className={styles.heroInner}>
          <div className={styles.heroFlex}>
            <div className={styles.heroLeft}>
              <div className={styles.genreRow}>
                <span className={styles.genreChip}>{game.genre}</span>
              </div>
              <h1 className={styles.heroName}>{game.name}</h1>
              {game.full && <p className={styles.heroFull}>{game.full}</p>}
            </div>
            {game.image && (
              <div className={styles.heroLogoWrap}>
                <img src={game.image} alt={game.name} className={styles.heroLogo} />
              </div>
            )}
          </div>

          <div className={styles.statsStrip}>
            <div className={styles.stat}>
              <span className={styles.statVal}>{loading ? '—' : subCount.toLocaleString()}</span>
              <span className={styles.statLabel}>Subscribers</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statVal}>{loading ? '—' : tournaments.length}</span>
              <span className={styles.statLabel}>Active Tournaments</span>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      {game.desc && <p className={styles.desc}>{game.desc}</p>}

      {/* Subscribe + Group Chat */}
      <div className={styles.subRow}>
        <button
          className={`${styles.subBtn} ${subscribed ? styles.subActive : ''}`}
          onClick={toggleSubscribe}
        >
          <i className={subscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'} />
          {subscribed ? 'Subscribed' : 'Subscribe'}
        </button>
        <Link href={`/games/${slug}/chat`} className={styles.chatBtn}>
          <i className="ri-group-line" />
          Group Chat
        </Link>
      </div>

      {/* Tournaments */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Active Tournaments</h2>
          {!loading && tournaments.length > 0 && (
            <span className={styles.sectionMeta}>{tournaments.length} active</span>
          )}
        </div>

        {!loading && tournaments.length === 0 && (
          <p className={styles.empty}>No active tournaments for this game yet.</p>
        )}

        {!loading && tournaments.length > 0 && (
          <div className={styles.list}>
            {tournaments.map(t => {
              const isRowJoined = !!registered[t.id]
              const isRowFull = t.registered_count >= t.slots && !isRowJoined
              const fillPct = Math.min(100, ((t.registered_count || 0) / t.slots) * 100)

              return (
                <div
                  key={t.id}
                  className={`${styles.tRow} ${isRowFull ? styles.tRowFull : ''} ${isRowJoined ? styles.tRowJoined : ''}`}
                  onClick={() => setSelected(t)}
                >
                  <div className={styles.tInfo}>
                    <div className={styles.tName}>{t.name}</div>
                    <div className={styles.tFormat}>{t.format}</div>
                    <div className={styles.slotBar}>
                      <div className={styles.slotTrack}>
                        <div className={styles.slotFill} style={{ width: `${fillPct}%` }} />
                      </div>
                      <span className={styles.slotText}>{t.registered_count || 0}/{t.slots}</span>
                    </div>
                  </div>

                  <div className={styles.tMeta}>
                    {t.prize && (
                      <span className={styles.tPrize}>
                        <i className="ri-trophy-line" />{t.prize}
                      </span>
                    )}
                    {t.date && (
                      <span className={styles.tDate}>
                        <i className="ri-calendar-line" />{t.date}
                      </span>
                    )}
                  </div>

                  <span className={`${styles.badge} ${isRowJoined ? styles.badgeJoined : isRowFull ? styles.badgeFull : styles.badgeOpen}`}>
                    {isRowJoined ? 'Joined' : isRowFull ? 'Full' : 'Open'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tournament modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        size="md"
        footer={
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            {!isJoined && !isFull && (
              <button className={styles.joinBtn} onClick={registerTournament} style={{ flex: 1 }}>
                <i className="ri-trophy-line" /> Register Now
              </button>
            )}
            {selected && (
              <button
                onClick={() => { setSelected(null); window.location.href = `/tournaments/${selected.slug}` }}
                style={{ flex: isJoined || isFull ? 1 : 0, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
              >
                <i className="ri-eye-line" /> View
              </button>
            )}
          </div>
        }
      >
        {selected && (
          <div className={styles.tDetail}>
            {isJoined && (
              <div className={styles.joinedBanner}>
                <i className="ri-checkbox-circle-fill" />
                You're registered for this tournament
              </div>
            )}
            <div className={styles.tGrid}>
              {[
                { label: 'Format', val: selected.format || '—' },
                { label: 'Prize Pool', val: selected.prize || 'None' },
                { label: 'Slots', val: `${selected.registered_count || 0} / ${selected.slots}` },
                { label: 'Date', val: selected.date || 'TBD' },
              ].map(r => (
                <div key={r.label} className={styles.tGridRow}>
                  <span className={styles.tGridLabel}>{r.label}</span>
                  <span className={styles.tGridVal}>{r.val}</span>
                </div>
              ))}
            </div>
            {!isJoined && (
              <p className={styles.tNote}>
                By registering you agree to tournament rules. No-shows result in a loss of entry points.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
