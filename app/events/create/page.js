'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { EVENT_CATEGORIES, EVENT_CATEGORY_META, slugifyEvent } from '../../../lib/eventCategories'
import styles from './page.module.css'

export default function CreateEventPage() {
  const { user, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  if (!user) {
    return (
      <div className={styles.gateWrap}>
        <p className={styles.gateTitle}>Sign in to continue</p>
        <button onClick={openAuthGate} className={styles.gateBtn}>Sign In</button>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className={styles.gateWrap}>
        <i className="ri-shield-star-line" style={{ fontSize: 32, opacity: 0.5, marginBottom: 10 }} />
        <p className={styles.gateTitle}>Admins only</p>
        <p className={styles.gateSub}>Only Nabogaming admins can create official events.</p>
        <button onClick={() => router.push('/events')} className={styles.gateBtn}>Back to Events</button>
      </div>
    )
  }

  return <CreateForm user={user} router={router} />
}

function CreateForm({ user, router }) {
  const fileRef = useRef()

  const [title, setTitle]             = useState('')
  const [category, setCategory]       = useState('community')
  const [description, setDescription] = useState('')
  const [location, setLocation]       = useState('')
  const [locationLink, setLocationLink] = useState('')
  const [startAt, setStartAt]         = useState('')
  const [endAt, setEndAt]             = useState('')
  const [bannerFile, setBannerFile]   = useState(null)
  const [bannerPreview, setBannerPreview] = useState(null)
  const [isTest, setIsTest]           = useState(false)

  const [errors, setErrors]     = useState({})
  const [saving, setSaving]     = useState(false)
  const [done, setDone]         = useState(null) // created event

  function handleBannerPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBannerFile(file)
    setBannerPreview(URL.createObjectURL(file))
  }

  function validate() {
    const e = {}
    if (!title.trim()) e.title = 'Event title is required'
    if (!startAt) e.startAt = 'Start date & time is required'
    if (endAt && startAt && new Date(endAt) < new Date(startAt)) e.endAt = 'End time must be after the start time'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    let banner_url = null
    if (bannerFile) {
      const ext = bannerFile.name.split('.').pop()
      const path = `event-banners/${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('public').upload(path, bannerFile)
      if (!upErr) {
        const { data: pub } = supabase.storage.from('public').getPublicUrl(path)
        banner_url = pub.publicUrl
      }
    }

    const slugBase = slugifyEvent(title) || 'event'
    let slug = slugBase
    const { data: clash } = await supabase.from('events').select('id').eq('slug', slug).maybeSingle()
    if (clash) slug = `${slugBase}-${Date.now().toString(36)}`

    const { data: newEv, error } = await supabase.from('events').insert({
      title: title.trim(),
      slug,
      category,
      description: description.trim() || null,
      location: location.trim() || null,
      location_link: locationLink.trim() || null,
      banner_url,
      start_at: new Date(startAt).toISOString(),
      end_at: endAt ? new Date(endAt).toISOString() : null,
      status: 'upcoming',
      rsvp_count: 0,
      is_test: isTest,
      created_by: user.id,
    }).select().single()

    if (error) { setErrors({ _submit: error.message }); setSaving(false); return }

    if (!isTest) {
      const { data: allProfiles } = await supabase.from('profiles').select('id').neq('id', user.id)
      if (allProfiles?.length) {
        const catLabel = EVENT_CATEGORY_META[category]?.label || 'Event'
        const notifications = allProfiles.map(p => ({
          user_id: p.id,
          title: `New ${catLabel} — ${newEv.title}`,
          body: `A new official Nabogaming event is live${location ? ` at ${location}` : ''}. Tap to view details and RSVP.`,
          type: 'event',
          meta: { event_id: newEv.id },
          read: false,
        }))
        for (let i = 0; i < notifications.length; i += 100) {
          await supabase.from('notifications').insert(notifications.slice(i, i + 100))
        }
      }
    }

    setDone(newEv)
    setSaving(false)
  }

  if (done) {
    return (
      <div className={styles.page}>
        <div className={styles.doneWrap}>
          <div className={styles.doneIcon}><i className="ri-calendar-check-fill" /></div>
          <h2 className={styles.doneTitle}>Event Published!</h2>
          <p className={styles.doneSub}><strong>{done.title}</strong> is now live on the Events page.</p>
          <div className={styles.doneBtns}>
            <button className={styles.donePrimary} onClick={() => router.push(`/events/${done.slug}`)}>
              <i className="ri-arrow-right-circle-fill" /> View Event
            </button>
            <button className={styles.doneSecondary} onClick={() => router.push('/events')}>
              <i className="ri-list-check" /> All Events
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => router.back()}><i className="ri-arrow-left-line" /></button>
        <span className={styles.topTitle}>Create Event</span>
      </div>

      <div className={styles.adminNote}>
        <i className="ri-shield-star-fill" />
        <span>Published as an official Nabogaming event, credited to your admin account.</span>
      </div>

      <div className={styles.card}>
        <div className={`${styles.field} ${styles.nameField}`}>
          <label>Event Title <span className={styles.req}>*</span></label>
          <input type="text" value={title} placeholder="e.g. Ramadhan Community Night" onChange={e => setTitle(e.target.value)} className={errors.title ? styles.inputError : ''} autoFocus />
          {errors.title && <span className={styles.errMsg}>{errors.title}</span>}
        </div>

        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}><i className="ri-price-tag-3-line" /></span>
            <div><h3 className={styles.sectionTitle}>Category</h3></div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.chipRow}>
              {EVENT_CATEGORIES.map(c => (
                <button key={c} type="button" className={`${styles.chip} ${category === c ? styles.chipActive : ''}`} onClick={() => setCategory(c)}>
                  <i className={EVENT_CATEGORY_META[c].icon} /> {EVENT_CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}><i className="ri-image-line" /></span>
            <div><h3 className={styles.sectionTitle}>Banner Image</h3><p className={styles.sectionSub}>Optional — shown on the event card</p></div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.bannerPicker} onClick={() => fileRef.current?.click()}>
              {bannerPreview ? <img src={bannerPreview} alt="" className={styles.bannerPreviewImg} /> : (
                <><i className="ri-upload-cloud-2-line" /><span>Tap to upload a banner</span></>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleBannerPick} />
          </div>
        </div>

        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}><i className="ri-calendar-event-line" /></span>
            <div><h3 className={styles.sectionTitle}>Date &amp; Time</h3></div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label>Starts <span className={styles.req}>*</span></label>
                <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} className={errors.startAt ? styles.inputError : ''} />
                {errors.startAt && <span className={styles.errMsg}>{errors.startAt}</span>}
              </div>
              <div className={styles.field}>
                <label>Ends <span className={styles.opt}>(optional)</span></label>
                <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)} className={errors.endAt ? styles.inputError : ''} />
                {errors.endAt && <span className={styles.errMsg}>{errors.endAt}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}><i className="ri-map-pin-line" /></span>
            <div><h3 className={styles.sectionTitle}>Location</h3><p className={styles.sectionSub}>Venue, or "Online"</p></div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.field}>
              <input type="text" value={location} placeholder="e.g. Online — Discord, or Mlimani City Mall" onChange={e => setLocation(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Link <span className={styles.opt}>(optional)</span></label>
              <input type="text" value={locationLink} placeholder="Discord / stream / map link" onChange={e => setLocationLink(e.target.value)} />
            </div>
          </div>
        </div>

        <div className={styles.sectionCard}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionIcon}><i className="ri-align-left" /></span>
            <div><h3 className={styles.sectionTitle}>Description</h3></div>
          </div>
          <div className={styles.sectionBody}>
            <textarea rows={4} value={description} placeholder="What's happening at this event…" onChange={e => setDescription(e.target.value)} />
          </div>
        </div>

        <div className={`${styles.sectionCard} ${styles.testCard} ${isTest ? styles.testCardOn : ''}`}>
          <div className={styles.sectionBody} style={{ padding: 12 }}>
            <button type="button" className={`${styles.toggleRow} ${isTest ? styles.toggleOn : ''}`} onClick={() => setIsTest(!isTest)}>
              <div className={styles.toggleLeft}>
                <i className={isTest ? 'ri-flask-fill' : 'ri-flask-line'} />
                <div>
                  <span className={styles.toggleLabel}>Test Run</span>
                  <span className={styles.toggleHint}>{isTest ? 'Active — no notifications sent, hidden from other users.' : 'Preview silently before publishing to everyone.'}</span>
                </div>
              </div>
              <div className={`${styles.toggleSwitch} ${isTest ? styles.toggleSwitchOn : ''}`}><div className={styles.toggleKnob} /></div>
            </button>
          </div>
        </div>

        {errors._submit && <div className={styles.submitErr}><i className="ri-error-warning-line" /> {errors._submit}</div>}
      </div>

      <div className={styles.navRow}>
        <button className={styles.navLaunch} onClick={submit} disabled={saving}>
          {saving ? <><i className="ri-loader-4-line" /> Publishing…</> : <><i className="ri-rocket-line" /> Publish Event</>}
        </button>
      </div>
    </div>
  )
}
