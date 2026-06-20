'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../../lib/constants'
import { getActivePlan } from '../../../lib/plans'
import styles from './page.module.css'

const GAME_NAMES = Object.fromEntries(GAME_SLUGS.map(s => [s, GAME_META[s].name]))

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

function parseFee(raw) {
  if (!raw) return null
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? null : n
}

const FREE_LIMIT_FREE_TOURNEYS = 2
const FREE_LIMIT_PAID_TOURNEYS = 1

// ── Mode definitions ──────────────────────────────────────────────────────────
// Each mode is a complete preset: team_size, squads_needed, slots, label, icon, description
// Creator picks a MODE then just fills name/game/prize — nothing else to configure

const BATTLE_MODES = [
  {
    id: 'solo_16',
    label: '1v1 Solo',
    icon: 'ri-user-line',
    team_size: 1,
    squads_needed: null,
    defaultSlots: 16,
    slotOptions: [8, 16, 32, 64],
    desc: 'Every player for themselves. 1 champion.',
    color: '#6366f1',
  },
  {
    id: 'duo_8',
    label: '2v2 Duos',
    icon: 'ri-user-2-line',
    team_size: 2,
    squads_needed: 8,
    defaultSlots: 16,
    slotOptions: [8, 16, 32],
    desc: '2-player teams. 8 duos fight to the last.',
    color: '#22c55e',
  },
  {
    id: 'squad_4v4',
    label: '4v4 Squad',
    icon: 'ri-group-line',
    team_size: 4,
    squads_needed: 8,
    defaultSlots: 32,
    slotOptions: [16, 32, 64],
    desc: '4-player squads. 8 squads enter, 1 wins.',
    color: '#f59e0b',
  },
  {
    id: 'squad_8v8',
    label: '8-Player Squad',
    icon: 'ri-team-line',
    team_size: 8,
    squads_needed: 8,
    defaultSlots: 64,
    slotOptions: [32, 64, 128],
    desc: 'PUBG style — 8 squads of 8. Last squad standing wins.',
    color: '#ef4444',
  },
]

export default function CreateTournament() {
  const { user, profile, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

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

function CreateForm({ user, profile, isAdmin, router }) {
  const [step, setStep] = useState(0)  // 0=mode, 1=details, 2=review

  // Selected mode
  const [mode, setMode] = useState(null) // one of BATTLE_MODES

  // Details form
  const [form, setForm] = useState({
    name: '',
    game_slug: GAME_SLUGS[0] || 'pubg',
    slots: 32,
    prize: '',
    date: '',
    description: '',
    entrance_fee: '',
    is_test: false,
    pro_only: false,
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [done, setDone] = useState(false)
  const [createdSlug, setCreatedSlug] = useState(null)
  const [myCreated, setMyCreated] = useState(null)

  useEffect(() => {
    supabase.from('tournaments').select('id, entrance_fee').eq('created_by', user.id)
      .then(({ data }) => setMyCreated(data || []))
  }, [user.id])

  const activePlan = getActivePlan(profile)
  const isPaidPlan = isAdmin || activePlan === 'pro' || activePlan === 'elite' || activePlan === 'team'
  const myFreeCount = (myCreated || []).filter(t => !parseFee(t.entrance_fee)).length
  const myPaidCount = (myCreated || []).filter(t =>  parseFee(t.entrance_fee)).length

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setErrors(e => ({ ...e, [key]: null })) }

  function pickMode(m) {
    setMode(m)
    setForm(f => ({ ...f, slots: m.defaultSlots }))
    setStep(1)
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Tournament name is required'
    if (!form.game_slug)   e.game_slug = 'Pick a game'
    if (!isPaidPlan && myCreated !== null) {
      const isPaidT = !!parseFee(form.entrance_fee)
      if (isPaidT  && myPaidCount >= FREE_LIMIT_PAID_TOURNEYS) e._quota = `Free plan: max ${FREE_LIMIT_PAID_TOURNEYS} paid tournament.`
      if (!isPaidT && myFreeCount >= FREE_LIMIT_FREE_TOURNEYS) e._quota = `Free plan: max ${FREE_LIMIT_FREE_TOURNEYS} free tournaments.`
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit() {
    if (!user || submitting || !mode) return
    if (!validate()) return

    setSubmitting(true); setProgress(0); setProgressLabel('Creating tournament…')
    await tick(20, 'Setting up bracket…')

    const fee = form.entrance_fee ? Number(String(form.entrance_fee).replace(/,/g, '')) : 0
    const teamSize = mode.team_size
    const squadsNeeded = mode.squads_needed

    const { data: newT, error } = await supabase.from('tournaments').insert({
      name:             form.name.trim(),
      slug:             slugify(form.name),
      game_slug:        form.game_slug,
      format:           mode.label,
      prize:            form.prize,
      slots:            Number(form.slots),
      date:             form.date,
      description:      form.description,
      entrance_fee:     fee,
      team_size:        teamSize,
      squads_needed:    teamSize > 1 ? squadsNeeded : null,
      is_test:          form.is_test,
      pro_only:         form.pro_only,
      status:           'active',
      registered_count: 0,
      created_by:       user.id,
    }).select().single()

    if (error) { setSubmitting(false); setErrors({ _submit: error.message }); setProgress(0); return }

    await tick(55, 'Tournament created!')

    if (!form.is_test) {
      setProgressLabel('Notifying players…')
      const { data: allProfiles } = await supabase.from('profiles').select('id').neq('id', user.id)
      if (allProfiles?.length) {
        const feeNote = fee > 0 ? ` · Entry fee: TZS ${fee.toLocaleString()}` : ''
        const proNote = form.pro_only ? ' · Pro & Elite only 👑' : ''
        const notifications = allProfiles.map(p => ({
          user_id: p.id,
          title:   `New Tournament — ${newT.name}`,
          body:    `${mode.label} tournament is open${newT.date ? ` on ${newT.date}` : ''}. ${newT.slots} slots${newT.prize ? ` · Prize: TZS ${newT.prize}` : ''}${feeNote}${proNote}. Join now!`,
          type:    'tournament',
          meta:    { tournament_id: newT.id },
          read:    false,
        }))
        for (let i = 0; i < notifications.length; i += 100) {
          await supabase.from('notifications').insert(notifications.slice(i, i + 100))
          setProgress(Math.min(55 + Math.round(((i + 100) / notifications.length) * 35), 90))
        }
      }
    }

    await tick(100, 'Ready! 🎉')
    setCreatedSlug(newT.slug || newT.id)
    setDone(true)
    setSubmitting(false)
  }

  function tick(to, label) {
    return new Promise(res => {
      setProgressLabel(label)
      const start = Date.now(), duration = 400, from = progress
      function frame() {
        const t = Math.min(1, (Date.now() - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        setProgress(Math.round(from + (to - from) * eased))
        if (t < 1) requestAnimationFrame(frame); else res()
      }
      requestAnimationFrame(frame)
    })
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className={styles.page}>
        <div className={styles.doneWrap}>
          <div className={styles.doneIcon}><i className="ri-trophy-fill" /></div>
          <h2 className={styles.doneTitle}>Tournament Live!</h2>
          <p className={styles.doneSub}><strong>{form.name}</strong> is now open.</p>
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

  // ── Submitting ────────────────────────────────────────────────────────────
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

  // ── Step 0: Pick battle mode ──────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => router.back()}><i className="ri-arrow-left-line" /></button>
          <span className={styles.topTitle}>Create Tournament</span>
          <span />
        </div>

        <div style={{ padding: '4px 16px 12px' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            Pick a battle format to get started
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
          {BATTLE_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => pickMode(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 18px', borderRadius: 14,
                border: '1.5px solid var(--border)',
                background: 'var(--surface)',
                cursor: 'pointer', textAlign: 'left', width: '100%',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <div style={{
                width: 46, height: 46, borderRadius: 12, flexShrink: 0,
                background: `${m.color}18`, border: `1.5px solid ${m.color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, color: m.color,
              }}>
                <i className={m.icon} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{m.label}</span>
                  {m.squads_needed && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: m.color, background: `${m.color}18`, padding: '2px 7px', borderRadius: 5 }}>
                      {m.squads_needed} squads
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{m.desc}</span>
              </div>
              <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', fontSize: 18, flexShrink: 0 }} />
            </button>
          ))}
        </div>

        {!isPaidPlan && myCreated !== null && (
          <div style={{ margin: '20px 16px 0', padding: '10px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ri-information-line" style={{ flexShrink: 0 }} />
            <span>Free plan: <strong>{myFreeCount}/{FREE_LIMIT_FREE_TOURNEYS}</strong> free &amp; <strong>{myPaidCount}/{FREE_LIMIT_PAID_TOURNEYS}</strong> paid used.</span>
          </div>
        )}
      </div>
    )
  }

  // ── Step 1: Details ───────────────────────────────────────────────────────
  if (step === 1) {
    const slotOpts = mode?.slotOptions || [16, 32, 64]
    const totalPlayers = mode?.squads_needed
      ? mode.squads_needed * mode.team_size
      : form.slots

    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => setStep(0)}><i className="ri-arrow-left-line" /></button>
          <span className={styles.topTitle}>{mode?.label}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>2 / 2</span>
        </div>

        {/* Mode summary pill */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            background: `${mode?.color}12`, borderRadius: 10, border: `1px solid ${mode?.color}25`,
          }}>
            <i className={mode?.icon} style={{ color: mode?.color, fontSize: 18, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: mode?.color }}>{mode?.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{mode?.desc}</div>
            </div>
            {mode?.squads_needed && (
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: mode?.color, lineHeight: 1 }}>{totalPlayers}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>PLAYERS</div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.stepContent}>

            {/* Name */}
            <div className={styles.field}>
              <label>Tournament Name <span className={styles.req}>*</span></label>
              <input
                type="text" value={form.name}
                placeholder={`e.g. PUBG ${mode?.label} Season 1`}
                onChange={e => set('name', e.target.value)}
                className={errors.name ? styles.inputError : ''}
                autoFocus
              />
              {errors.name && <span className={styles.errMsg}>{errors.name}</span>}
            </div>

            {/* Game */}
            <div className={styles.field}>
              <label>Game <span className={styles.req}>*</span></label>
              <div className={styles.gameGrid}>
                {GAME_SLUGS.map(s => (
                  <button key={s} type="button"
                    className={`${styles.gameChip} ${form.game_slug === s ? styles.gameChipActive : ''}`}
                    onClick={() => set('game_slug', s)}
                  >
                    {GAME_NAMES[s] || s}
                  </button>
                ))}
              </div>
            </div>

            {/* Slots (only shown for solo where squads_needed is null) */}
            {!mode?.squads_needed && (
              <div className={styles.field}>
                <label>Max Players</label>
                <div className={styles.chipRow}>
                  {slotOpts.map(n => (
                    <button key={n} type="button"
                      className={`${styles.chip} ${form.slots === n ? styles.chipActive : ''}`}
                      onClick={() => set('slots', n)}
                    >{n}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Prize + Date side by side */}
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label>Prize Pool (TZS) <span className={styles.opt}>(optional)</span></label>
                <input type="text" value={form.prize} placeholder="e.g. 500,000" onChange={e => set('prize', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Date <span className={styles.opt}>(optional)</span></label>
                <input type="text" value={form.date} placeholder="e.g. Jun 28" onChange={e => set('date', e.target.value)} />
              </div>
            </div>

            {/* Entry fee */}
            <div className={styles.field}>
              <label><i className="ri-money-dollar-circle-line" style={{ marginRight: 4 }} />Entry Fee (TZS) <span className={styles.opt}>(optional)</span></label>
              <input
                type="text" value={form.entrance_fee}
                placeholder="Leave blank for free entry"
                onChange={e => set('entrance_fee', e.target.value)}
              />
              {form.entrance_fee && (
                <span className={styles.feeHint}><i className="ri-information-line" /> Players submit M-Pesa proof — admin approves.</span>
              )}
            </div>

            {/* Description */}
            <div className={styles.field}>
              <label>Description <span className={styles.opt}>(optional)</span></label>
              <textarea rows={2} value={form.description} placeholder="Any rules or notes…" onChange={e => set('description', e.target.value)} />
            </div>

            {/* Pro Only toggle */}
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
                  <span className={styles.testToggleHint}>{form.pro_only ? 'Only Pro & Elite members can join.' : 'Restrict to paid plan members only.'}</span>
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
                  <span className={styles.testToggleHint}>{form.is_test ? 'Silent test — no notifications sent.' : 'Run a silent test, hidden from others.'}</span>
                </div>
              </div>
              <div className={`${styles.testToggleSwitch} ${form.is_test ? styles.testToggleSwitchOn : ''}`}>
                <div className={styles.testToggleKnob} />
              </div>
            </button>

            {errors._quota && (
              <div className={styles.quotaErr}>
                <i className="ri-shield-star-line" />
                <span>{errors._quota}</span>
                <button className={styles.quotaErrBtn} onClick={() => router.push('/upgrade')}>Upgrade →</button>
              </div>
            )}
            {errors._submit && <div className={styles.submitErr}><i className="ri-error-warning-line" /> {errors._submit}</div>}
          </div>
        </div>

        <div className={styles.navRow}>
          <button className={styles.navBack} onClick={() => setStep(0)}><i className="ri-arrow-left-line" /> Back</button>
          <button className={styles.navLaunch} onClick={submit} disabled={submitting}>
            <i className="ri-rocket-line" /> Launch
          </button>
        </div>
      </div>
    )
  }

  return null
}
