'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import usePageLoading from '../../components/usePageLoading'
import UserBadges from '../../components/UserBadges'
import {
  EVENT_CATEGORIES, EVENT_CATEGORY_META, EVENT_STATUS_META,
  deriveEventStatus, formatEventDate,
} from '../../lib/eventCategories'
import styles from './page.module.css'

function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonBanner} />
      <div className={styles.skeletonBody}>
        <div className={styles.skeletonBadge} />
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonDesc} />
      </div>
    </div>
  )
}

export default function EventsPage() {
  const { user, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  const [events, setEvents]     = useState([])
  const [creators, setCreators] = useState({})
  const [loading, setLoading]   = useState(true)
  usePageLoading(loading)

  const [category, setCategory] = useState('all')
  const [tab, setTab]           = useState('upcoming') // upcoming | past
  const [myRsvps, setMyRsvps]   = useState({})

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    setLoading(true)
    const { data } = await supabase.from('events').select('*').order('start_at', { ascending: true })
    const all = data || []
    const visible = all.filter(ev => {
      if (!ev.is_test) return true
      if (!user) return false
      return isAdmin || ev.created_by === user.id
    })
    setEvents(visible)

    const creatorIds = [...new Set(visible.map(ev => ev.created_by).filter(Boolean))]
    if (creatorIds.length) {
      const { data: profiles } = await supabase
        .from('profiles').select('id, username, avatar_url, email')
        .in('id', creatorIds)
      const map = {}
      ;(profiles || []).forEach(p => { map[p.id] = p })
      setCreators(map)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!user || events.length === 0) return
    supabase.from('event_rsvps').select('event_id').eq('user_id', user.id)
      .then(({ data }) => {
        const map = {}
        ;(data || []).forEach(r => { map[r.event_id] = true })
        setMyRsvps(map)
      })
  }, [user, events.length])

  async function toggleRsvp(e, ev) {
    e.stopPropagation()
    if (!user) { openAuthGate(); return }
    const already = !!myRsvps[ev.id]
    setMyRsvps(m => ({ ...m, [ev.id]: !already }))
    setEvents(list => list.map(x => x.id === ev.id
      ? { ...x, rsvp_count: Math.max(0, (x.rsvp_count || 0) + (already ? -1 : 1)) }
      : x))
    if (already) {
      await supabase.from('event_rsvps').delete().eq('event_id', ev.id).eq('user_id', user.id)
    } else {
      await supabase.from('event_rsvps').insert({ event_id: ev.id, user_id: user.id })
    }
  }

  const filtered = useMemo(() => {
    return events
      .map(ev => ({ ...ev, _status: deriveEventStatus(ev) }))
      .filter(ev => category === 'all' || ev.category === category)
      .filter(ev => tab === 'upcoming' ? ev._status !== 'ended' : ev._status === 'ended')
  }, [events, category, tab])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Nabogaming</p>
          <h1 className={styles.headline}>Events</h1>
        </div>
        {isAdmin && (
          <button className={styles.createBtn} onClick={() => router.push('/events/create')}>
            <i className="ri-add-line" /><span>New Event</span>
          </button>
        )}
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tabBtn} ${tab === 'upcoming' ? styles.tabActive : ''}`} onClick={() => setTab('upcoming')}>Upcoming &amp; Live</button>
        <button className={`${styles.tabBtn} ${tab === 'past' ? styles.tabActive : ''}`} onClick={() => setTab('past')}>Past</button>
      </div>

      <div className={styles.filters}>
        {['all', ...EVENT_CATEGORIES].map(c => (
          <button key={c} className={`${styles.filterBtn} ${category === c ? styles.filterActive : ''}`} onClick={() => setCategory(c)}>
            {c === 'all' ? 'All' : EVENT_CATEGORY_META[c].label}
          </button>
        ))}
      </div>

      {loading && (
        <div className={styles.list}>{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={styles.empty}>
          <i className="ri-calendar-event-line" />
          <p>No {tab === 'past' ? 'past' : 'upcoming'} events{category !== 'all' ? ` in ${EVENT_CATEGORY_META[category].label}` : ''}.</p>
          <span>Check back later.</span>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={styles.list}>
          {filtered.map(ev => {
            const catMeta = EVENT_CATEGORY_META[ev.category] || EVENT_CATEGORY_META.other
            const statusMeta = EVENT_STATUS_META[ev._status]
            const creator = creators[ev.created_by]
            const isGoing = !!myRsvps[ev.id]

            return (
              <div key={ev.id} className={styles.card} onClick={() => router.push(`/events/${ev.slug || ev.id}`)}>
                <div className={styles.cardBanner}>
                  {ev.banner_url
                    ? <img src={ev.banner_url} alt={ev.title} className={styles.cardBannerImg} />
                    : <div className={styles.cardBannerFallback} style={{ background: `${catMeta.color}22` }}><i className={catMeta.icon} style={{ color: catMeta.color }} /></div>}
                  <div className={styles.cardBannerOverlay}>
                    <span className={styles.statusBadge} style={{ background: statusMeta.color }}>{statusMeta.label}</span>
                    {ev.is_test && <span className={styles.testBadge}><i className="ri-flask-line" /> Test</span>}
                  </div>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.cardTop}>
                    <span className={styles.catTag} style={{ color: catMeta.color, background: `${catMeta.color}18` }}>
                      <i className={catMeta.icon} /> {catMeta.label}
                    </span>
                    {ev.start_at && <span className={styles.datePill}><i className="ri-calendar-line" /> {formatEventDate(ev.start_at)}</span>}
                  </div>

                  <h3 className={styles.cardName}>{ev.title}</h3>
                  {ev.description && <p className={styles.cardDesc}>{ev.description}</p>}

                  {ev.location && (
                    <span className={styles.locationRow}><i className="ri-map-pin-line" /> {ev.location}</span>
                  )}

                  <div className={styles.cardFooter}>
                    <div className={styles.hostRow}>
                      {creator?.avatar_url && <img src={creator.avatar_url} alt="" className={styles.hostAvatar} />}
                      <span className={styles.hostName}>
                        Hosted by {creator?.username || 'Nabogaming Admin'}
                        <UserBadges email={creator?.email} size={13} gap={2} />
                      </span>
                    </div>
                    <button
                      className={`${styles.rsvpBtn} ${isGoing ? styles.rsvpBtnActive : ''}`}
                      onClick={e => toggleRsvp(e, ev)}
                    >
                      <i className={isGoing ? 'ri-checkbox-circle-fill' : 'ri-add-circle-line'} />
                      {isGoing ? 'Going' : 'Interested'}
                      <span className={styles.rsvpCount}>{ev.rsvp_count || 0}</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
