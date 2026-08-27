'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import usePageLoading from '../../../components/usePageLoading'
import UserBadges from '../../../components/UserBadges'
import {
  EVENT_CATEGORY_META, EVENT_STATUS_META, deriveEventStatus, formatEventDate,
} from '../../../lib/eventCategories'
import styles from './page.module.css'

export default function EventViewPage() {
  const { slug } = useParams()
  const { user, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  const [event, setEvent]       = useState(null)
  const [creator, setCreator]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [going, setGoing]       = useState(false)
  const [rsvpBusy, setRsvpBusy] = useState(false)
  const [attendees, setAttendees] = useState([])
  usePageLoading(loading)

  useEffect(() => { load() }, [slug])

  async function load() {
    setLoading(true)
    let { data: ev } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle()
    if (!ev) ({ data: ev } = await supabase.from('events').select('*').eq('id', slug).maybeSingle())
    if (!ev) { setNotFound(true); setLoading(false); return }
    setEvent(ev)

    const [{ data: cr }, { data: rsvps }] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url, email, country_flag, plan, plan_expires_at, custom_badges, is_season_winner').eq('id', ev.created_by).single(),
      supabase.from('event_rsvps').select('user_id, profiles(username, avatar_url)').eq('event_id', ev.id).order('created_at', { ascending: false }).limit(24),
    ])
    setCreator(cr || null)
    setAttendees(rsvps || [])
    if (user) {
      const { data: mine } = await supabase.from('event_rsvps').select('id').eq('event_id', ev.id).eq('user_id', user.id).maybeSingle()
      setGoing(!!mine)
    }
    setLoading(false)
  }

  async function toggleRsvp() {
    if (!user) { openAuthGate(); return }
    if (rsvpBusy) return
    setRsvpBusy(true)
    if (going) {
      await supabase.from('event_rsvps').delete().eq('event_id', event.id).eq('user_id', user.id)
      setGoing(false)
      setEvent(e => ({ ...e, rsvp_count: Math.max(0, (e.rsvp_count || 0) - 1) }))
      setAttendees(list => list.filter(a => a.user_id !== user.id))
    } else {
      await supabase.from('event_rsvps').insert({ event_id: event.id, user_id: user.id })
      setGoing(true)
      setEvent(e => ({ ...e, rsvp_count: (e.rsvp_count || 0) + 1 }))
      load()
    }
    setRsvpBusy(false)
  }

  if (loading) {
    return <div className={styles.page}><div className={styles.loadingWrap}><i className="ri-loader-4-line" /></div></div>
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyWrap}>
          <i className="ri-calendar-close-line" />
          <p>Event not found</p>
          <button className={styles.emptyBtn} onClick={() => router.push('/events')}>Back to Events</button>
        </div>
      </div>
    )
  }

  const catMeta = EVENT_CATEGORY_META[event.category] || EVENT_CATEGORY_META.other
  const status = deriveEventStatus(event)
  const statusMeta = EVENT_STATUS_META[status]
  const canManage = isAdmin || (user && user.id === event.created_by)

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => router.back()}><i className="ri-arrow-left-line" /></button>
        {canManage && (
          <button className={styles.manageBtn} onClick={() => router.push(`/events/${event.slug || event.id}/manage`)}>
            <i className="ri-settings-4-line" /> Manage
          </button>
        )}
      </div>

      <div className={styles.banner}>
        {event.banner_url
          ? <img src={event.banner_url} alt={event.title} className={styles.bannerImg} />
          : <div className={styles.bannerFallback} style={{ background: `${catMeta.color}22` }}><i className={catMeta.icon} style={{ color: catMeta.color, fontSize: 40 }} /></div>}
        <div className={styles.bannerOverlay}>
          <span className={styles.statusBadge} style={{ background: statusMeta.color }}>{statusMeta.label}</span>
          {event.is_test && <span className={styles.testBadge}><i className="ri-flask-line" /> Test</span>}
        </div>
      </div>

      <div className={styles.officialTag}><i className="ri-verified-badge-fill" /> Official Nabogaming Event</div>

      <span className={styles.catTag} style={{ color: catMeta.color, background: `${catMeta.color}18` }}>
        <i className={catMeta.icon} /> {catMeta.label}
      </span>

      <h1 className={styles.title}>{event.title}</h1>

      <div className={styles.hostRow}>
        {creator?.avatar_url && <img src={creator.avatar_url} alt="" className={styles.hostAvatar} />}
        <span className={styles.hostName}>
          Hosted by {creator?.username || 'Nabogaming Admin'}
          <UserBadges email={creator?.email} plan={creator?.plan} planExpiresAt={creator?.plan_expires_at} countryFlag={creator?.country_flag} isSeasonWinner={creator?.is_season_winner} customBadges={creator?.custom_badges} size={15} gap={3} />
        </span>
      </div>

      <div className={styles.infoGrid}>
        <div className={styles.infoRow}>
          <i className="ri-calendar-event-line" />
          <div>
            <span className={styles.infoLabel}>When</span>
            <span className={styles.infoVal}>{formatEventDate(event.start_at)}{event.end_at ? ` – ${formatEventDate(event.end_at)}` : ''}</span>
          </div>
        </div>
        {event.location && (
          <div className={styles.infoRow}>
            <i className="ri-map-pin-line" />
            <div>
              <span className={styles.infoLabel}>Where</span>
              <span className={styles.infoVal}>
                {event.location_link ? <a href={event.location_link} target="_blank" rel="noopener noreferrer">{event.location}</a> : event.location}
              </span>
            </div>
          </div>
        )}
        <div className={styles.infoRow}>
          <i className="ri-group-line" />
          <div>
            <span className={styles.infoLabel}>Interested</span>
            <span className={styles.infoVal}>{event.rsvp_count || 0} {event.rsvp_count === 1 ? 'person' : 'people'}</span>
          </div>
        </div>
      </div>

      {event.description && (
        <div className={styles.descBlock}>
          <h3 className={styles.sectionTitle}>About this event</h3>
          <p className={styles.descText}>{event.description}</p>
        </div>
      )}

      {attendees.length > 0 && (
        <div className={styles.attendeesBlock}>
          <h3 className={styles.sectionTitle}>Who's going</h3>
          <div className={styles.attendeeStack}>
            {attendees.slice(0, 12).map(a => (
              <div key={a.user_id} className={styles.attendeeAvatar} title={a.profiles?.username || ''}>
                {a.profiles?.avatar_url ? <img src={a.profiles.avatar_url} alt="" /> : <i className="ri-user-fill" />}
              </div>
            ))}
            {event.rsvp_count > 12 && <div className={styles.attendeeMore}>+{event.rsvp_count - 12}</div>}
          </div>
        </div>
      )}

      <div className={styles.stickyBar}>
        <button
          className={`${styles.rsvpBtn} ${going ? styles.rsvpBtnActive : ''}`}
          onClick={toggleRsvp}
          disabled={rsvpBusy || status === 'cancelled' || status === 'ended'}
        >
          <i className={going ? 'ri-checkbox-circle-fill' : 'ri-add-circle-line'} />
          {status === 'ended' ? 'Event ended' : status === 'cancelled' ? 'Cancelled' : going ? "You're going" : "I'm interested"}
        </button>
      </div>
    </div>
  )
}
