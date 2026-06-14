'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../../lib/constants'
import { canDo, getActivePlan, PLANS } from '../../../lib/plans'
import UpgradeModal from '../../../components/UpgradeModal'
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
const TEAM_SIZE_OPTIONS = [
  { value: 1, label: '1v1', sub: 'Solo' },
  { value: 2, label: '2v2', sub: 'Team Battle' },
  { value: 4, label: '4v4', sub: 'Team Battle' },
  { value: 8, label: '8v8', sub: 'Team Battle' },
]

export default function CreateTournament() {
  const { user, profile, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  // ── Plan gate ──────────────────────────────────────────
  const [showUpgrade, setShowUpgrade] = useState(false)
  const activePlan   = getActivePlan(profile)
  const canCreate    = isAdmin || canDo(profile, 'create_tournament')

  // Show upgrade wall if not allowed
  if (user && !canCreate) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, background: 'var(--bg)', textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>💎</div>
        <p style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)', margin: 0 }}>Elite Plan Required</p>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, maxWidth: 300, lineHeight: 1.6 }}>
          Creating tournaments is an Elite & Team feature. Upgrade to unlock tournament creation and more.
        </p>
        <button
          onClick={() => setShowUpgrade(true)}
          style={{ padding: '12px 28px', background: '#38bdf8', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <i className="ri-vip-diamond-line" /> Upgrade to Elite
        </button>
        <button onClick={() => router.back()} style={{ fontSize: 13, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}>
          ← Go back
        </button>
        {showUpgrade && <UpgradeModal feature="create_tournament" profile={profile} onClose={() => setShowUpgrade(false)} />}
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, background: 'var(--bg)', textAlign: 'center' }}>
        <p style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', margin: 0 }}>Sign in to create tournaments</p>
        <button onClick={openAuthGate} style={{ padding: '11px 24px', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          Sign In
        </button>
      </div>
    )
  }

  return <CreateForm user={user} profile={profile} isAdmin={isAdmin} router={router} />
}

// ── Actual form — only rendered when user has access ───────
function CreateForm({ user, profile, isAdmin, router }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    name: '', game_slug: GAME_SLUGS[0] || 'pubg',
    format: '', prize: '', slots: 32,
    date: '', description: '',
    entrance_fee: '',
    team_size: 1,
    is_test: false,
    pro_only: false,   // ← NEW
  })
  const [errors, setErrors]     = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress]   = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [done, setDone]         = useState(false)
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
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function next() { if (validateStep(step)) setStep(s => Math.min(s + 1, STEPS.length - 1)) }
  function back() { setStep(s => Math.max(s - 1, 0)) }

  async function submit() {
    if (!user || submitting) return
    setSubmitting(true); setProgress(0); setProgressLabel('Preparing tournament…')

    await tick(15, 'Creating tournament…')
    const fee = form.entrance_fee ? Number(String(form.entrance_fee).replace(/,/g, '')) : 0

    const { data: newT, error } = await supabase.from('tournaments').insert({
      name:             form.name.trim(),
      slug:             slugify(form.name),
      game_slug:        form.game_slug,
      format:           form.format,
      prize:            form.prize,
      slots:            Number(form.slots),
      date:             form.date,
      description:      form.description,
      entrance_fee:     fee,
      team_size:        form.team_size || 1,
      is_test:          form.is_test,
      pro_only:         form.pro_only,    // ← NEW
      status:           'active',
      registered_count: 0,
      created_by:       user.id,
    }).select().single()

    if (error) { setSubmitting(false); setErrors({ _submit: error.message }); setProgress(0); return }

    await tick(50, 'Tournament created!')

    if (form.is_test) {
      setProgressLabel('Test run ready — no notifications sent.')
    } else {
      setProgressLabel('Notifying players…')
      const { data: allProfiles } = await supabase.from('profiles').select('id').neq('id', user.id)
      if (allProfiles?.length) {
        const gameName  = newT.game_slug ? ` ${newT.game_slug.toUpperCase()}` : ''
        const feeNote   = fee > 0 ? ` · Entry fee: TZS ${fee.toLocaleString()}` : ''
        const proNote   = form.pro_only ? ' · Pro & Elite only 👑' : ''
        const notifications = allProfiles.map(p => ({
          user_id: p.id,
          title: `New Tournament — ${newT.name}`,
          body: `A new${gameName} tournament is open for registration${newT.date ? ` on ${newT.date}` : ''}. ${newT.slots} slots available${newT.prize ? ` · Prize: TZS ${newT.prize}` : ''}${feeNote}${proNote}. Register now!`,
          type: 'tournament',
          meta: { tournament_id: newT.id },
          read: false,
        }))
        for (let i = 0; i < notifications.length; i += 100) {
          await supabase.from('notifications').insert(notifications.slice(i, i + 100))
          setProgress(Math.min(50 + Math.round(((i + 100) / notifications.length) * 40), 90))
        }
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
      const start = Date.now(), duration = 420, from = progress
      function frame() {
        const t = Math.min(1, (Date.now() - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        setProgress(Math.round(from + (to - from) * eased))
        if (t < 1) requestAnimationFrame(frame); else res()
      }
      requestAnimationFrame(frame)
    })
  }

  if (done) {
    return (
      <div className={styles.page}>
        <div className={styles.doneWrap}>
          <div className={styles.doneIcon}><i className="ri-trophy-fill" /></div>
          <h2 className={styles.doneTitle}>Tournament Live!</h2>
          <p className={styles.doneSub}><strong>{form.name}</strong> is now open for registration.{form.pro_only && ' 👑 Pro & Elite players only.'}</p>
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
          <div className={styles.uploadIconWrap}><i className="ri-upload-cloud-2-line" /></div>
          <h2 className={styles.uploadTitle}>Launching Tournament</h2>
          <p className={styles.uploadSub}>{progressLabel}</p>
          <div className={styles.uploadTrack}><div className={styles.uploadFill} style={{ width: `${progress}%` }} /></div>
          <span className={styles.uploadPct}>{progress}%</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => step === 0 ? router.back() : back()}><i className="ri-arrow-left-line" /></button>
        <span className={styles.topTitle}>Create Tournament</span>
        <span className={styles.topStep}>{step + 1} / {STEPS.length}</span>
      </div>

      <div className={styles.stepRow}>
        {STEPS.map((s, i) => (
          <div key={s.key} className={`${styles.stepItem} ${i === step ? styles.stepActive : ''} ${i < step ? styles.stepDone : ''}`}>
            <div className={styles.stepDot}>{i < step ? <i className="ri-check-line" /> : <i className={s.icon} />}</div>
            <span className={styles.stepLabel}>{s.label}</span>
            {i < STEPS.length - 1 && <div className={`${styles.stepLine} ${i < step ? styles.stepLineDone : ''}`} />}
          </div>
        ))}
      </div>

      <div className={styles.card}>

        {/* ── Step 0: Details ── */}
        {step === 0 && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepHeading}><i className="ri-file-text-line" /> Basic Details</h2>
            <p className={styles.stepHint}>Give your tournament a name and pick the game.</p>
            <div className={styles.field}>
              <label>Tournament Name <span className={styles.req}>*</span></label>
              <input type="text" value={form.name} placeholder="e.g. Solo Showdown Season 1" onChange={e => set('name', e.target.value)} className={errors.name ? styles.inputError : ''} autoFocus />
              {errors.name && <span className={styles.errMsg}>{errors.name}</span>}
            </div>
            <div className={styles.field}>
              <label>Game <span className={styles.req}>*</span></label>
              <div className={styles.gameGrid}>
                {GAME_SLUGS.map(s => (
                  <button key={s} type="button" className={`${styles.gameChip} ${form.game_slug === s ? styles.gameChipActive : ''}`} onClick={() => set('game_slug', s)}>
                    {GAME_NAMES[s] || s}
                  </button>
                ))}
              </div>
              {errors.game_slug && <span className={styles.errMsg}>{errors.game_slug}</span>}
            </div>
            <div className={styles.field}>
              <label>Description <span className={styles.opt}>(optional)</span></label>
              <textarea rows={3} value={form.description} placeholder="Brief description of the tournament…" onChange={e => set('description', e.target.value)} />
            </div>
          </div>
        )}

        {/* ── Step 1: Format ── */}
        {step === 1 && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepHeading}><i className="ri-gamepad-line" /> Format & Rules</h2>
            <p className={styles.stepHint}>Set structure, prize, schedule, and entry options.</p>

            <div className={styles.field}>
              <label>Format</label>
              <div className={styles.chipRow}>
                {FORMATS.map(f => (
                  <button key={f} type="button" className={`${styles.chip} ${form.format === f ? styles.chipActive : ''}`} onClick={() => set('format', form.format === f ? '' : f)}>{f}</button>
                ))}
              </div>
              <input type="text" value={form.format} placeholder="Or type a custom format…" onChange={e => set('format', e.target.value)} style={{ marginTop: 8 }} />
            </div>

            <div className={styles.field}>
              <label>Max Slots <span className={styles.req}>*</span></label>
              <div className={styles.chipRow}>
                {SLOT_OPTIONS.map(n => (
                  <button key={n} type="button" className={`${styles.chip} ${form.slots === n ? styles.chipActive : ''}`} onClick={() => set('slots', n)}>{n}</button>
                ))}
              </div>
              {errors.slots && <span className={styles.errMsg}>{errors.slots}</span>}
            </div>

            <div className={styles.field}>
              <label>Match Type</label>
              <div className={styles.chipRow}>
                {TEAM_SIZE_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" className={`${styles.chip} ${form.team_size === opt.value ? styles.chipActive : ''}`} onClick={() => set('team_size', opt.value)} style={{ flexDirection: 'column', gap: 2, minWidth: 60, paddingTop: 8, paddingBottom: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{opt.label}</span>
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{opt.sub}</span>
                  </button>
                ))}
              </div>
              {form.team_size > 1 && (
                <span className={styles.feeHint} style={{ marginTop: 6 }}>
                  <i className="ri-team-line" /> Team Battle — players grouped into teams of {form.team_size}.
                </span>
              )}
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label>Prize Pool (TZS)</label>
                <input type="text" value={form.prize} placeholder="e.g. 500,000" onChange={e => set('prize', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Date</label>
                <input type="text" value={form.date} placeholder="e.g. Apr 20" onChange={e => set('date', e.target.value)} />
              </div>
            </div>

            <div className={styles.field}>
              <label><i className="ri-money-dollar-circle-line" style={{ marginRight: 4 }} />Entrance Fee (TZS) <span className={styles.opt}>(optional)</span></label>
              <input type="text" value={form.entrance_fee} placeholder="e.g. 2,000  — leave blank for free entry" onChange={e => set('entrance_fee', e.target.value)} />
              {form.entrance_fee && (
                <span className={styles.feeHint}><i className="ri-information-line" /> Players submit M-Pesa proof — admin approves before registration.</span>
              )}
            </div>

            {/* ── Pro Only toggle (NEW) ── */}
            <button
              type="button"
              className={`${styles.testToggle} ${form.pro_only ? styles.testToggleOn : ''}`}
              onClick={() => set('pro_only', !form.pro_only)}
              style={{ borderColor: form.pro_only ? '#a855f7' : undefined, background: form.pro_only ? '#a855f720' : undefined }}
            >
              <div className={styles.testToggleLeft}>
                <i className={form.pro_only ? 'ri-vip-crown-fill' : 'ri-vip-crown-line'} style={{ color: form.pro_only ? '#a855f7' : undefined }} />
                <div>
                  <span className={styles.testToggleLabel} style={{ color: form.pro_only ? '#a855f7' : undefined }}>Pro & Elite Only</span>
                  <span className={styles.testToggleHint}>
                    {form.pro_only
                      ? 'Only Pro, Elite & Team members can join this tournament.'
                      : 'Restrict this tournament to paid plan members only.'}
                  </span>
                </div>
              </div>
              <div className={`${styles.testToggleSwitch} ${form.pro_only ? styles.testToggleSwitchOn : ''}`} style={{ background: form.pro_only ? '#a855f7' : undefined }}>
                <div className={styles.testToggleKnob} />
              </div>
            </button>

            {/* Test Run toggle */}
            <button
              type="button"
              className={`${styles.testToggle} ${form.is_test ? styles.testToggleOn : ''}`}
              onClick={() => set('is_test', !form.is_test)}
            >
              <div className={styles.testToggleLeft}>
                <i className={form.is_test ? 'ri-flask-fill' : 'ri-flask-line'} />
                <div>
                  <span className={styles.testToggleLabel}>Test Run</span>
                  <span className={styles.testToggleHint}>
                    {form.is_test ? 'Active — no notifications sent. Only you & admin can see this.' : 'Run a silent test — no notifications, hidden from other users.'}
                  </span>
                </div>
              </div>
              <div className={`${styles.testToggleSwitch} ${form.is_test ? styles.testToggleSwitchOn : ''}`}>
                <div className={styles.testToggleKnob} />
              </div>
            </button>
          </div>
        )}

        {/* ── Step 2: Review ── */}
        {step === 2 && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepHeading}><i className="ri-rocket-line" /> Review & Launch</h2>
            <p className={styles.stepHint}>Everything look good? Hit launch to go live.</p>
            <div className={styles.reviewCard}>
              {[
                ['ri-trophy-line',             'Name',       form.name || '—'],
                ['ri-gamepad-line',            'Game',       GAME_NAMES[form.game_slug] || form.game_slug],
                ['ri-layout-grid-line',        'Format',     form.format || '—'],
                ['ri-group-line',              'Slots',      form.slots],
                ['ri-team-line',               'Match Type', form.team_size === 1 ? '1v1 — Solo' : `${form.team_size}v${form.team_size} — Team Battle`],
                ['ri-money-dollar-circle-line','Prize',      form.prize ? `TZS ${form.prize}` : '—'],
                ['ri-ticket-line',             'Entry Fee',  form.entrance_fee ? `TZS ${Number(String(form.entrance_fee).replace(/,/g,'')).toLocaleString()}` : 'Free'],
                ['ri-calendar-event-line',     'Date',       form.date || '—'],
              ].map(([icon, label, val]) => (
                <div key={label} className={styles.reviewRow}>
                  <span className={styles.reviewLabel}><i className={icon} /> {label}</span>
                  <span className={styles.reviewVal}>{val}</span>
                </div>
              ))}
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-vip-crown-line" /> Access</span>
                <span className={styles.reviewVal} style={{ color: form.pro_only ? '#a855f7' : 'var(--text-muted)' }}>
                  {form.pro_only ? '👑 Pro & Elite only' : 'Open to all'}
                </span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-flask-line" /> Mode</span>
                <span className={styles.reviewVal} style={{ color: form.is_test ? '#f59e0b' : 'var(--text-muted)' }}>
                  {form.is_test ? '🧪 Test Run (silent)' : 'Live'}
                </span>
              </div>
              {form.description && (
                <div className={`${styles.reviewRow} ${styles.reviewRowFull}`}>
                  <span className={styles.reviewLabel}><i className="ri-file-text-line" /> Description</span>
                  <span className={styles.reviewVal} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{form.description}</span>
                </div>
              )}
            </div>
            {errors._submit && <div className={styles.submitErr}><i className="ri-error-warning-line" /> {errors._submit}</div>}
          </div>
        )}
      </div>

      <div className={styles.navRow}>
        {step > 0 && <button className={styles.navBack} onClick={back}><i className="ri-arrow-left-line" /> Back</button>}
        {step < STEPS.length - 1 && <button className={styles.navNext} onClick={next}>Next <i className="ri-arrow-right-line" /></button>}
        {step === STEPS.length - 1 && <button className={styles.navLaunch} onClick={submit} disabled={submitting}><i className="ri-rocket-line" /> Launch Tournament</button>}
      </div>
    </div>
  )
}
