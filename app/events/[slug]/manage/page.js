'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import usePageLoading from '../../../../components/usePageLoading'
import { EVENT_CATEGORIES, EVENT_CATEGORY_META } from '../../../../lib/eventCategories'
import styles from './page.module.css'

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ManageEventPage() {
  const { slug } = useParams()
  const { user, isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const fileRef = useRef()

  const [event, setEvent]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  usePageLoading(loading)

  const [form, setForm] = useState(null)
  const [bannerFile, setBannerFile] = useState(null)
  const [bannerPreview, setBannerPreview] = useState(null)
  const [attendees, setAttendees] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push('/events'); return }
    load()
  }, [slug, authLoading, user])

  async function load() {
    setLoading(true)
    let { data: ev } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle()
    if (!ev) ({ data: ev } = await supabase.from('events').select('*').eq('id', slug).maybeSingle())
    if (!ev) { setLoading(false); return }
    if (!(isAdmin || ev.created_by === user.id)) { setForbidden(true); setLoading(false); return }
    setEvent(ev)
    setForm({
      title: ev.title, category: ev.category, description: ev.description || '',
      location: ev.location || '', location_link: ev.location_link || '',
      start_at: toLocalInput(ev.start_at), end_at: toLocalInput(ev.end_at),
      status: ev.status, is_test: ev.is_test,
    })
    setBannerPreview(ev.banner_url)
    const { data: rsvps } = await supabase.from('event_rsvps')
      .select('user_id, created_at, profiles(username, avatar_url, email)')
      .eq('event_id', ev.id).order('created_at', { ascending: false })
    setAttendees(rsvps || [])
    setLoading(false)
  }

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function handleBannerPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBannerFile(file)
    setBannerPreview(URL.createObjectURL(file))
  }

  async function save() {
    if (!form.title.trim()) { setError('Title is required'); return }
    if (!form.start_at) { setError('Start date & time is required'); return }
    setSaving(true); setError('')

    let banner_url = event.banner_url
    if (bannerFile) {
      const ext = bannerFile.name.split('.').pop()
      const path = `event-banners/${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('public').upload(path, bannerFile)
      if (!upErr) {
        const { data: pub } = supabase.storage.from('public').getPublicUrl(path)
        banner_url = pub.publicUrl
      }
    }

    const { error: updErr } = await supabase.from('events').update({
      title: form.title.trim(),
      category: form.category,
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      location_link: form.location_link.trim() || null,
      banner_url,
      start_at: new Date(form.start_at).toISOString(),
      end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
      status: form.status,
      is_test: form.is_test,
      updated_at: new Date().toISOString(),
    }).eq('id', event.id)

    if (updErr) { setError(updErr.message); setSaving(false); return }
    setSaving(false)
    router.push(`/events/${event.slug || event.id}`)
  }

  async function deleteEvent() {
    setSaving(true)
    await supabase.from('events').delete().eq('id', event.id)
    router.push('/events')
  }

  if (loading) return <div className={styles.page}><div className={styles.loadingWrap}><i className="ri-loader-4-line" /></div></div>

  if (forbidden) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyWrap}>
          <i className="ri-shield-star-line" />
          <p>You can't manage this event</p>
          <button className={styles.emptyBtn} onClick={() => router.push('/events')}>Back to Events</button>
        </div>
      </div>
    )
  }

  if (!event) {
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

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => router.push(`/events/${event.slug || event.id}`)}><i className="ri-arrow-left-line" /></button>
        <span className={styles.topTitle}>Manage Event</span>
      </div>

      <div className={styles.card}>
        <div className={styles.field}>
          <label>Title</label>
          <input type="text" value={form.title} onChange={e => set('title', e.target.value)} />
        </div>

        <div className={styles.field}>
          <label>Category</label>
          <div className={styles.chipRow}>
            {EVENT_CATEGORIES.map(c => (
              <button key={c} type="button" className={`${styles.chip} ${form.category === c ? styles.chipActive : ''}`} onClick={() => set('category', c)}>
                <i className={EVENT_CATEGORY_META[c].icon} /> {EVENT_CATEGORY_META[c].label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label>Banner</label>
          <div className={styles.bannerPicker} onClick={() => fileRef.current?.click()}>
            {bannerPreview ? <img src={bannerPreview} alt="" className={styles.bannerPreviewImg} /> : (
              <><i className="ri-upload-cloud-2-line" /><span>Tap to upload</span></>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleBannerPick} />
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label>Starts</label>
            <input type="datetime-local" value={form.start_at} onChange={e => set('start_at', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Ends</label>
            <input type="datetime-local" value={form.end_at} onChange={e => set('end_at', e.target.value)} />
          </div>
        </div>

        <div className={styles.field}>
          <label>Location</label>
          <input type="text" value={form.location} onChange={e => set('location', e.target.value)} />
        </div>
        <div className={styles.field}>
          <label>Location Link</label>
          <input type="text" value={form.location_link} onChange={e => set('location_link', e.target.value)} />
        </div>

        <div className={styles.field}>
          <label>Description</label>
          <textarea rows={4} value={form.description} onChange={e => set('description', e.target.value)} />
        </div>

        <div className={styles.field}>
          <label>Status</label>
          <div className={styles.chipRow}>
            {['upcoming', 'live', 'ended', 'cancelled'].map(s => (
              <button key={s} type="button" className={`${styles.chip} ${form.status === s ? styles.chipActive : ''}`} onClick={() => set('status', s)}>
                {s === 'upcoming' ? 'Auto (upcoming/live/ended)' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <span className={styles.hint}><i className="ri-information-line" /> Leave "Auto" unless you need to force-cancel or force-end this event.</span>
        </div>

        <button type="button" className={`${styles.toggleRow} ${form.is_test ? styles.toggleOn : ''}`} onClick={() => set('is_test', !form.is_test)}>
          <div className={styles.toggleLeft}>
            <i className={form.is_test ? 'ri-flask-fill' : 'ri-flask-line'} />
            <span>Test Run (hidden from other users)</span>
          </div>
          <div className={`${styles.toggleSwitch} ${form.is_test ? styles.toggleSwitchOn : ''}`}><div className={styles.toggleKnob} /></div>
        </button>

        {error && <div className={styles.errBanner}><i className="ri-error-warning-line" /> {error}</div>}

        <button className={styles.saveBtn} onClick={save} disabled={saving}>
          {saving ? <><i className="ri-loader-4-line" /> Saving…</> : <><i className="ri-save-line" /> Save Changes</>}
        </button>
      </div>

      <div className={styles.card}>
        <h3 className={styles.blockTitle}><i className="ri-group-line" /> RSVPs ({attendees.length})</h3>
        {attendees.length === 0 ? (
          <p className={styles.emptyHint}>No one has RSVP'd yet.</p>
        ) : (
          <div className={styles.attendeeList}>
            {attendees.map(a => (
              <div key={a.user_id} className={styles.attendeeRow}>
                {a.profiles?.avatar_url ? <img src={a.profiles.avatar_url} alt="" className={styles.attendeeAvatar} /> : <div className={styles.attendeeAvatarFallback}><i className="ri-user-fill" /></div>}
                <div className={styles.attendeeInfo}>
                  <span className={styles.attendeeName}>{a.profiles?.username || 'Unknown'}</span>
                  <span className={styles.attendeeDate}>RSVP'd {new Date(a.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.dangerCard}>
        <h3 className={styles.blockTitle} style={{ color: '#ef4444' }}><i className="ri-delete-bin-line" /> Delete Event</h3>
        <p className={styles.emptyHint}>This permanently removes the event and all RSVPs. This can't be undone.</p>
        {!confirmDelete ? (
          <button className={styles.dangerBtn} onClick={() => setConfirmDelete(true)}>Delete Event</button>
        ) : (
          <div className={styles.confirmRow}>
            <button className={styles.dangerBtnConfirm} onClick={deleteEvent} disabled={saving}>Yes, delete permanently</button>
            <button className={styles.cancelBtn} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}
