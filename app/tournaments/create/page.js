'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { supabase } from '../../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../../lib/constants'
import styles from './page.module.css'

const GAME_NAMES = Object.fromEntries(GAME_SLUGS.map(s => [s, GAME_META[s].name]))

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

const STEPS = [
  { key: 'details',  label: 'Details',  icon: 'ri-file-text-line' },
  { key: 'format',   label: 'Format',   icon: 'ri-gamepad-line' },
  { key: 'review',   label: 'Launch',   icon: 'ri-rocket-line' },
]

const SLOT_OPTIONS = [4, 8, 16, 32, 64]
const FORMATS = ['Solo', 'Duo', 'Squad', 'Bo3', 'Bo5', 'Round Robin', 'Double Elim']

export default function CreateTournament() {
  const { user } = useAuth()
  const router = useRouter()

  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    name: '', game_slug: GAME_SLUGS[0] || 'pubg',
    format: '', prize: '', slots: 32,
    date: '', description: '',
    entrance_fee: '',          // NEW
  })
  const [errors, setErrors] = useState({})

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [done, setDone] = useState(false)
  const [createdSlug, setCreatedSlug] = useState(null)

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setErrors(e => ({ ...e, [key]: null })) }

  function validateStep(idx) {
    const e = {}
    if (idx === 0) {
      if (!form.name.trim()) e.name = 'Tournament name is required'
      if (!form.game_slug)   e.game_slug = 'Pick a game'
    }
    if (idx === 1) {
      if (!form.slots || form.slots < 2) e.slots = 'Need at least 2 slots'
      if (form.entrance_fee && isNaN(Number(String(form.entrance_fee).replace(/,/g, '')))) {
        e.entrance_fee = 'Enter a valid number'
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function next() { if (validateStep(step)) setStep(s => Math.min(s + 1, STEPS.length - 1)) }
  function back() { setStep(s => Math.max(s - 1, 0)) }

  async function submit() {
    if (!user || submitting) return
    setSubmitting(true)
    setProgress(0)
    setProgressLabel('Preparing tournament…')

    const fee = form.entrance_fee
      ? Number(String(form.entrance_fee).replace(/,/g, ''))
      : 0

    await tick(15, 'Creating tournament…')
    const { data: newT, error } = await supabase.from('tournaments').insert({
      name: form.name.trim(),
      slug: slugify(form.name),
      game_slug: form.game_slug,
      format: form.format,
      prize: form.prize,
      slots: Number(form.slots),
      date: form.date,
      description: form.description,
      entrance_fee: fee,
      status: 'active',
      registered_count: 0,
      created_by: user.id,
    }).select().single()

    if (error) {
      setSubmitting(false)
      setErrors({ _submit: error.message })
      setProgress(0)
      return
    }

    await tick(50, 'Tournament created!')

    setProgressLabel('Notifying players…')
    const { data: allProfiles } = await supabase
      .from('profiles').select('id').neq('id', user.id)

    if (allProfiles?.length) {
      const gameName = newT.game_slug ? ` ${newT.game_slug.toUpperCase()}` : ''
      const feeNote  = fee > 0 ? ` · Entry fee: TZS ${fee.toLocaleString()}` : ''
      const notifications = allProfiles.map(p => ({
        user_id: p.id,
        title: `New Tournament — ${newT.name}`,
        body: `A new${gameName} tournament is open for registration${newT.date ? ` on ${newT.date}` : ''}. ${newT.slots} slots available${newT.prize ? ` · Prize: TZS ${newT.prize}` : ''}${feeNote}. Register now!`,
        type: 'tournament',
        meta: { tournament_id: newT.id },
        read: false,
      }))
      for (let i = 0; i < notifications.length; i += 100) {
        await supabase.from('notifications').insert(notifications.slice(i, i + 100))
        const pct = 50 + Math.round(((i + 100) / notifications.length) * 40)
        setProgress(Math.min(pct, 90))
      }
    }

    await tick(100, 'Ready to go! 🎉')
    setCreatedSlug(newT.slug || newT.id)
    setDone(true)
    setSubmitting(false)
  }

  function tick(to, label) {
    return new Promise(res => {
      setProgressLabel(label)
      const start = Date.now()
      const duration = 420
      const from = progress
      function step() {
        const t = Math.min(1, (Date.now() - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        setProgress(Math.round(from + (to - from) * eased))
        if (t < 1) requestAnimationFrame(step)
        else res()
      }
      requestAnimationFrame(step)
    })
  }

  if (done) {
    return (
      <div className={styles.page}>
        <div className={styles.doneWrap}>
          <div className={styles.doneIcon}><i className="ri-trophy-fill" /></div>
          <h2 className={styles.doneTitle}>Tournament Live!</h2>
          <p className={styles.doneSub}>
            <strong>{form.name}</strong> is now open for registration.
          </p>
          <div className={styles.doneBtns}>
            <button className={styles.donePrimary} onClick={() => router.push(`/tournaments/${createdSlug}`)}>
              <i className="ri-arrow-right-circle-fill" /> Go to Tournament
            </button>
            <button className={styles.doneSecondary} onClick={() => router.push('/tournaments')}>
              <i className="ri-list-check" /> All Tournaments
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (submitting) {
    return (
      <div className={styles.page}>
        <div className={styles.uploadWrap}>
          <div className={styles.uploadIconWrap}>
            <i className="ri-upload-cloud-2-line" />
          </div>
          <h2 className={styles.uploadTitle}>Launching Tournament</h2>
          <p className={styles.uploadSub}>{progressLabel}</p>
          <div className={styles.uploadTrack}>
            <div className={styles.uploadFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.uploadPct}>{progress}%</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>

      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => step === 0 ? router.back() : back()}>
          <i className="ri-arrow-left-line" />
        </button>
        <span className={styles.topTitle}>Create Tournament</span>
        <span className={styles.topStep}>{step + 1} / {STEPS.length}</span>
      </div>

      {/* Step indicators */}
      <div className={styles.stepRow}>
        {STEPS.map((s, i) => (
          <div key={s.key} className={`${styles.stepItem} ${i === step ? styles.stepActive : ''} ${i < step ? styles.stepDone : ''}`}>
            <div className={styles.stepDot}>
              {i < step ? <i className="ri-check-line" /> : <i className={s.icon} />}
            </div>
            <span className={styles.stepLabel}>{s.label}</span>
            {i < STEPS.length - 1 && <div className={`${styles.stepLine} ${i < step ? styles.stepLineDone : ''}`} />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className={styles.card}>

        {/* ── Step 0: Details ── */}
        {step === 0 && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepHeading}><i className="ri-file-text-line" /> Basic Details</h2>
            <p className={styles.stepHint}>Give your tournament a name and pick the game.</p>

            <div className={styles.field}>
              <label>Tournament Name <span className={styles.req}>*</span></label>
              <input
                type="text" value={form.name} placeholder="e.g. Solo Showdown Season 1"
                onChange={e => set('name', e.target.value)}
                className={errors.name ? styles.inputError : ''}
                autoFocus
              />
              {errors.name && <span className={styles.errMsg}>{errors.name}</span>}
            </div>

            <div className={styles.field}>
              <label>Game <span className={styles.req}>*</span></label>
              <div className={styles.gameGrid}>
                {GAME_SLUGS.map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.gameChip} ${form.game_slug === s ? styles.gameChipActive : ''}`}
                    onClick={() => set('game_slug', s)}
                  >
                    {GAME_NAMES[s] || s}
                  </button>
                ))}
              </div>
              {errors.game_slug && <span className={styles.errMsg}>{errors.game_slug}</span>}
            </div>

            <div className={styles.field}>
              <label>Description <span className={styles.opt}>(optional)</span></label>
              <textarea
                rows={3} value={form.description} placeholder="Brief description of the tournament…"
                onChange={e => set('description', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Step 1: Format & Rules ── */}
        {step === 1 && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepHeading}><i className="ri-gamepad-line" /> Format & Rules</h2>
            <p className={styles.stepHint}>Set the structure, prize, schedule, and entry fee.</p>

            <div className={styles.field}>
              <label>Format</label>
              <div className={styles.chipRow}>
                {FORMATS.map(f => (
                  <button key={f} type="button"
                    className={`${styles.chip} ${form.format === f ? styles.chipActive : ''}`}
                    onClick={() => set('format', form.format === f ? '' : f)}
                  >{f}</button>
                ))}
              </div>
              <input
                type="text" value={form.format}
                placeholder="Or type a custom format…"
                onChange={e => set('format', e.target.value)}
                style={{ marginTop: 8 }}
              />
            </div>

            <div className={styles.field}>
              <label>Max Slots <span className={styles.req}>*</span></label>
              <div className={styles.chipRow}>
                {SLOT_OPTIONS.map(n => (
                  <button key={n} type="button"
                    className={`${styles.chip} ${form.slots === n ? styles.chipActive : ''}`}
                    onClick={() => set('slots', n)}
                  >{n}</button>
                ))}
              </div>
              {errors.slots && <span className={styles.errMsg}>{errors.slots}</span>}
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label>Prize Pool (TZS)</label>
                <input type="text" value={form.prize} placeholder="e.g. 500,000"
                  onChange={e => set('prize', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Date</label>
                <input type="text" value={form.date} placeholder="e.g. Apr 20"
                  onChange={e => set('date', e.target.value)} />
              </div>
            </div>

            {/* ── Entrance Fee (NEW) ── */}
            <div className={styles.field}>
              <label>
                <i className="ri-money-dollar-circle-line" style={{ marginRight: 4 }} />
                Entrance Fee (TZS) <span className={styles.opt}>(optional — leave blank for free)</span>
              </label>
              <input
                type="text"
                value={form.entrance_fee}
                placeholder="e.g. 2,000  — leave blank for free entry"
                onChange={e => set('entrance_fee', e.target.value)}
                className={errors.entrance_fee ? styles.inputError : ''}
              />
              {errors.entrance_fee && <span className={styles.errMsg}>{errors.entrance_fee}</span>}
              {form.entrance_fee && !errors.entrance_fee && (
                <span className={styles.feeHint}>
                  <i className="ri-information-line" /> Players must submit payment proof. Admin approves before they are registered.
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Review ── */}
        {step === 2 && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepHeading}><i className="ri-rocket-line" /> Review & Launch</h2>
            <p className={styles.stepHint}>Everything look good? Hit launch to go live.</p>

            <div className={styles.reviewCard}>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-trophy-line" /> Name</span>
                <span className={styles.reviewVal}>{form.name || '—'}</span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-gamepad-line" /> Game</span>
                <span className={styles.reviewVal}>{GAME_NAMES[form.game_slug] || form.game_slug}</span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-layout-grid-line" /> Format</span>
                <span className={styles.reviewVal}>{form.format || '—'}</span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-group-line" /> Slots</span>
                <span className={styles.reviewVal}>{form.slots}</span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-money-dollar-circle-line" /> Prize</span>
                <span className={styles.reviewVal}>{form.prize ? `TZS ${form.prize}` : '—'}</span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-ticket-line" /> Entry Fee</span>
                <span className={styles.reviewVal} style={{ color: form.entrance_fee ? 'var(--text)' : 'var(--text-muted)' }}>
                  {form.entrance_fee ? `TZS ${Number(String(form.entrance_fee).replace(/,/g,'')).toLocaleString()}` : 'Free'}
                </span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-calendar-event-line" /> Date</span>
                <span className={styles.reviewVal}>{form.date || '—'}</span>
              </div>
              {form.description && (
                <div className={`${styles.reviewRow} ${styles.reviewRowFull}`}>
                  <span className={styles.reviewLabel}><i className="ri-file-text-line" /> Description</span>
                  <span className={styles.reviewVal} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{form.description}</span>
                </div>
              )}
            </div>

            {form.entrance_fee && (
              <div className={styles.feeNote}>
                <i className="ri-information-line" />
                <span>Players registering must submit M-Pesa payment proof. Admin will approve each payment before they are added to the bracket.</span>
              </div>
            )}

            {errors._submit && (
              <div className={styles.submitErr}>
                <i className="ri-error-warning-line" /> {errors._submit}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className={styles.navRow}>
        {step > 0 && (
          <button className={styles.navBack} onClick={back}>
            <i className="ri-arrow-left-line" /> Back
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button className={styles.navNext} onClick={next}>
            Next <i className="ri-arrow-right-line" />
          </button>
        )}
        {step === STEPS.length - 1 && (
          <button className={styles.navLaunch} onClick={submit} disabled={submitting}>
            <i className="ri-rocket-line" /> Launch Tournament
          </button>
        )}
      </div>

    </div>
  )
}
