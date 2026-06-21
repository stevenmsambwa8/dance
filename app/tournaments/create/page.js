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

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT CATEGORIES
// Two types of tournaments:
//
// 1. BATTLE ROYALE (tournament_type = 'royale')
//    → No bracket. All squads drop on the same map each match.
//    → Points per match = placement points + kill points.
//    → Admin records each match result. Standings auto-update.
//    → Champion = squad with most total points after N matches.
//    → This is how PUBG Mobile, eFootball group stages, etc. work.
//
// 2. BRACKET / 1v1 (tournament_type = 'bracket')  ← existing system
//    → Single elimination bracket. Players pick slots. Admin sets winners.
//    → Works for 1v1, 2v2, or any head-to-head matchup.
// ─────────────────────────────────────────────────────────────────────────────

const FORMAT_TYPES = [
  {
    id: 'royale',
    label: 'Battle Royale',
    icon: 'ri-sword-line',
    color: '#ef4444',
    headline: 'Points-based — all squads play at once',
    desc: 'PUBG Mobile style. Squads earn points each match from placement + kills. Most points after all matches = Champion. No bracket needed.',
    examples: 'PUBG Mobile · eFootball Group Stage · Free Fire · COD Mobile BR',
  },
  {
    id: 'bracket',
    label: '1v1 / Team Bracket',
    icon: 'ri-tournament-line',
    color: '#6366f1',
    headline: 'Elimination bracket — head to head',
    desc: 'Classic single-elimination. Players or teams claim slots and face off directly. Winner advances each round until champion.',
    examples: 'FIFA 1v1 · 2v2 Duos · 4v4 Squads · Boxing · Fighting games',
  },
]

// Royale squad presets
const ROYALE_PRESETS = [
  {
    id: 'solo_royale',
    label: 'Solo',
    icon: 'ri-user-line',
    team_size: 1,
    defaultSquads: 16,
    squadOptions: [8, 16, 32],
    desc: 'Every player for themselves',
    color: '#6366f1',
  },
  {
    id: 'duo_royale',
    label: 'Duos',
    icon: 'ri-user-2-line',
    team_size: 2,
    defaultSquads: 12,
    squadOptions: [8, 12, 16],
    desc: '2-player teams per squad',
    color: '#22c55e',
  },
  {
    id: 'squad_royale',
    label: 'Squads (4)',
    icon: 'ri-group-line',
    team_size: 4,
    defaultSquads: 12,
    squadOptions: [8, 12, 16, 20],
    desc: '4 players per squad — PUBG Mobile standard',
    color: '#f59e0b',
  },
  {
    id: 'squad8_royale',
    label: 'Large Squad (8)',
    icon: 'ri-team-line',
    team_size: 8,
    defaultSquads: 8,
    squadOptions: [4, 8, 12, 16],
    desc: '8 players per squad',
    color: '#ec4899',
  },
]

// Bracket presets
const BRACKET_PRESETS = [
  {
    id: 'solo_bracket',
    label: '1v1 Solo',
    icon: 'ri-user-line',
    team_size: 1,
    defaultSlots: 16,
    slotOptions: [8, 16, 32, 64],
    desc: 'Single player head-to-head',
    color: '#6366f1',
  },
  {
    id: 'duo_bracket',
    label: '2v2 Duos',
    icon: 'ri-user-2-line',
    team_size: 2,
    defaultSlots: 16,
    slotOptions: [8, 16, 32],
    desc: '2-player teams face off',
    color: '#22c55e',
  },
  {
    id: 'squad4_bracket',
    label: '4v4 Squads',
    icon: 'ri-group-line',
    team_size: 4,
    defaultSlots: 32,
    slotOptions: [16, 32, 64],
    desc: '4v4 team elimination',
    color: '#f59e0b',
  },
  {
    id: 'squad8_bracket',
    label: '8v8 Squads',
    icon: 'ri-team-line',
    team_size: 8,
    defaultSlots: 64,
    slotOptions: [32, 64],
    desc: '8v8 team elimination',
    color: '#ec4899',
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
        <button onClick={openAuthGate} style={{ padding: '11px 24px', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>Sign In</button>
      </div>
    )
  }

  return <CreateForm user={user} profile={profile} isAdmin={isAdmin} router={router} />
}

function CreateForm({ user, profile, isAdmin, router }) {
  // step: 0=type, 1=preset, 2=details
  const [step, setStep] = useState(0)
  const [formatType, setFormatType] = useState(null)  // 'royale' | 'bracket'
  const [preset, setPreset] = useState(null)           // one of ROYALE_PRESETS or BRACKET_PRESETS

  const [form, setForm] = useState({
    name: '',
    game_slug: GAME_SLUGS[0] || 'pubg',
    slots: 64,          // total player slots (team_size × squads)
    squads_needed: 12,  // for royale: number of squads
    matches_count: 4,   // for royale: how many matches to play
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

  const activePlan   = getActivePlan(profile)
  const isPaidPlan   = isAdmin || activePlan === 'pro' || activePlan === 'elite' || activePlan === 'team'
  const myFreeCount  = (myCreated || []).filter(t => !parseFee(t.entrance_fee)).length
  const myPaidCount  = (myCreated || []).filter(t =>  parseFee(t.entrance_fee)).length

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setErrors(e => ({ ...e, [key]: null })) }

  function pickType(type) {
    setFormatType(type.id)
    setStep(1)
  }

  function pickPreset(p) {
    setPreset(p)
    if (formatType === 'royale') {
      setForm(f => ({
        ...f,
        squads_needed: p.defaultSquads,
        slots: p.defaultSquads * p.team_size,
      }))
    } else {
      setForm(f => ({ ...f, slots: p.defaultSlots, squads_needed: null }))
    }
    setStep(2)
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
    if (!user || submitting || !preset) return
    if (!validate()) return

    setSubmitting(true); setProgress(0); setProgressLabel('Creating tournament…')
    await tick(20, 'Setting up…')

    const fee      = form.entrance_fee ? Number(String(form.entrance_fee).replace(/,/g, '')) : 0
    const teamSize = preset.team_size
    const isRoyale = formatType === 'royale'

    // For royale: slots = squads × team_size
    const totalSlots = isRoyale
      ? form.squads_needed * teamSize
      : Number(form.slots)

    const { data: newT, error } = await supabase.from('tournaments').insert({
      name:              form.name.trim(),
      slug:              slugify(form.name),
      game_slug:         form.game_slug,
      format:            preset.label,
      tournament_type:   isRoyale ? 'royale' : 'bracket',
      prize:             form.prize,
      slots:             totalSlots,
      date:              form.date,
      description:       form.description,
      entrance_fee:      fee,
      team_size:         teamSize,
      squads_needed:     isRoyale ? form.squads_needed : null,
      matches_count:     isRoyale ? Number(form.matches_count) : null,
      is_test:           form.is_test,
      pro_only:          form.pro_only,
      status:            'active',
      registered_count:  0,
      created_by:        user.id,
    }).select().single()

    if (error) { setSubmitting(false); setErrors({ _submit: error.message }); setProgress(0); return }

    await tick(55, 'Tournament created!')

    if (!form.is_test) {
      setProgressLabel('Notifying players…')
      const { data: allProfiles } = await supabase.from('profiles').select('id').neq('id', user.id)
      if (allProfiles?.length) {
        const feeNote  = fee > 0 ? ` · Entry: TZS ${fee.toLocaleString()}` : ''
        const proNote  = form.pro_only ? ' · Pro & Elite only 👑' : ''
        const typeNote = isRoyale ? ` · ${form.squads_needed} squads · ${form.matches_count} matches` : ''
        const notifications = allProfiles.map(p => ({
          user_id: p.id,
          title:   `New Tournament — ${newT.name}`,
          body:    `${preset.label} tournament open${newT.date ? ` on ${newT.date}` : ''}. ${totalSlots} slots${typeNote}${newT.prize ? ` · Prize: TZS ${newT.prize}` : ''}${feeNote}${proNote}. Join now!`,
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

  // ── Done ────────────────────────────────────────────────────────────────────
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

  // ── Submitting ──────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 0 — Pick tournament type
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => router.back()}><i className="ri-arrow-left-line" /></button>
          <span className={styles.topTitle}>Create Tournament</span>
          <span />
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            What kind of tournament is this?
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
          {FORMAT_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => pickType(t)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                padding: '18px 18px', borderRadius: 16,
                border: `1.5px solid ${t.color}30`,
                background: `${t.color}08`,
                cursor: 'pointer', textAlign: 'left', width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: `${t.color}18`, border: `1.5px solid ${t.color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, color: t.color,
                }}>
                  <i className={t.icon} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>{t.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.color }}>{t.headline}</div>
                </div>
                <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', fontSize: 18, flexShrink: 0 }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.desc}</div>
              <div style={{ fontSize: 11, color: t.color, background: `${t.color}12`, borderRadius: 6, padding: '4px 8px', alignSelf: 'flex-start', fontWeight: 600 }}>
                <i className="ri-gamepad-line" style={{ marginRight: 4 }} />{t.examples}
              </div>
            </button>
          ))}
        </div>

        {!isPaidPlan && myCreated !== null && (
          <div style={{ margin: '20px 16px 0', padding: '10px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
            <i className="ri-information-line" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Free plan: <strong>{myFreeCount}/{FREE_LIMIT_FREE_TOURNEYS}</strong> free &amp; <strong>{myPaidCount}/{FREE_LIMIT_PAID_TOURNEYS}</strong> paid used.</span>
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1 — Pick squad size preset
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 1) {
    const presets = formatType === 'royale' ? ROYALE_PRESETS : BRACKET_PRESETS
    const typeObj = FORMAT_TYPES.find(f => f.id === formatType)

    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => setStep(0)}><i className="ri-arrow-left-line" /></button>
          <span className={styles.topTitle}>{typeObj?.label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Step 2 of 3</span>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            {formatType === 'royale'
              ? 'How many players per squad?'
              : 'What is the team size?'}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px' }}>
          {presets.map(p => (
            <button
              key={p.id}
              onClick={() => pickPreset(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 14,
                border: '1.5px solid var(--border)',
                background: 'var(--surface)',
                cursor: 'pointer', textAlign: 'left', width: '100%',
              }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: `${p.color}18`, border: `1.5px solid ${p.color}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, color: p.color,
              }}>
                <i className={p.icon} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.desc}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: p.color, lineHeight: 1 }}>{p.team_size}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>PLAYERS</div>
              </div>
              <i className="ri-arrow-right-s-line" style={{ color: 'var(--text-muted)', fontSize: 18, flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2 — Details
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 2) {
    const isRoyale     = formatType === 'royale'
    const totalPlayers = isRoyale
      ? form.squads_needed * (preset?.team_size || 1)
      : Number(form.slots)
    const squadOpts    = isRoyale ? (preset?.squadOptions || [8, 12, 16]) : []
    const slotOpts     = !isRoyale ? (preset?.slotOptions || [16, 32, 64]) : []
    const matchOpts    = [3, 4, 5, 6, 8]

    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => setStep(1)}><i className="ri-arrow-left-line" /></button>
          <span className={styles.topTitle}>{preset?.label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Step 3 of 3</span>
        </div>

        {/* Mode summary */}
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            background: `${preset?.color}10`, borderRadius: 10,
            border: `1px solid ${preset?.color}25`,
          }}>
            <i className={preset?.icon} style={{ color: preset?.color, fontSize: 20, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: preset?.color }}>{preset?.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                {isRoyale
                  ? `${form.squads_needed} squads × ${preset?.team_size} players = ${totalPlayers} total`
                  : `${totalPlayers} player slots · single elimination`}
              </div>
            </div>
            {isRoyale && (
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: preset?.color, lineHeight: 1 }}>{totalPlayers}</div>
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
                type="text" value={form.name} autoFocus
                placeholder={isRoyale ? 'e.g. PUBG Mobile Season 3' : 'e.g. FIFA 1v1 Showdown'}
                onChange={e => set('name', e.target.value)}
                className={errors.name ? styles.inputError : ''}
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

            {/* Royale: number of squads */}
            {isRoyale && (
              <div className={styles.field}>
                <label>Number of Squads</label>
                <div className={styles.chipRow}>
                  {squadOpts.map(n => (
                    <button key={n} type="button"
                      className={`${styles.chip} ${form.squads_needed === n ? styles.chipActive : ''}`}
                      onClick={() => { set('squads_needed', n); set('slots', n * (preset?.team_size || 1)) }}
                    >{n} squads</button>
                  ))}
                </div>
                <span className={styles.feeHint} style={{ marginTop: 6 }}>
                  <i className="ri-information-line" /> {form.squads_needed} squads × {preset?.team_size} = <strong>{totalPlayers} players</strong>
                </span>
              </div>
            )}

            {/* Royale: number of matches */}
            {isRoyale && (
              <div className={styles.field}>
                <label>Number of Matches</label>
                <div className={styles.chipRow}>
                  {matchOpts.map(n => (
                    <button key={n} type="button"
                      className={`${styles.chip} ${form.matches_count === n ? styles.chipActive : ''}`}
                      onClick={() => set('matches_count', n)}
                    >{n}</button>
                  ))}
                </div>
                <span className={styles.feeHint} style={{ marginTop: 6 }}>
                  <i className="ri-information-line" /> All {form.squads_needed} squads play <strong>{form.matches_count} matches</strong>. Admin records results after each. Most points wins.
                </span>
              </div>
            )}

            {/* Bracket: max slots */}
            {!isRoyale && (
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

            {/* Prize + Date */}
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label>Prize (TZS) <span className={styles.opt}>(optional)</span></label>
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
              <input type="text" value={form.entrance_fee} placeholder="Leave blank for free" onChange={e => set('entrance_fee', e.target.value)} />
              {form.entrance_fee && <span className={styles.feeHint}><i className="ri-information-line" /> Players submit M-Pesa proof — admin approves.</span>}
            </div>

            {/* Description */}
            <div className={styles.field}>
              <label>Description <span className={styles.opt}>(optional)</span></label>
              <textarea rows={2} value={form.description} placeholder="Rules, map, server info…" onChange={e => set('description', e.target.value)} />
            </div>

            {/* Pro Only */}
            <button type="button"
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

            {/* Test Run */}
            <button type="button"
              className={`${styles.testToggle} ${form.is_test ? styles.testToggleOn : ''}`}
              onClick={() => set('is_test', !form.is_test)}
            >
              <div className={styles.testToggleLeft}>
                <i className={form.is_test ? 'ri-flask-fill' : 'ri-flask-line'} />
                <div>
                  <span className={styles.testToggleLabel}>Test Run</span>
                  <span className={styles.testToggleHint}>{form.is_test ? 'Silent test — no notifications.' : 'Hidden test, no notifications sent.'}</span>
                </div>
              </div>
              <div className={`${styles.testToggleSwitch} ${form.is_test ? styles.testToggleSwitchOn : ''}`}>
                <div className={styles.testToggleKnob} />
              </div>
            </button>

            {errors._quota  && <div className={styles.quotaErr}><i className="ri-shield-star-line" /><span>{errors._quota}</span><button className={styles.quotaErrBtn} onClick={() => router.push('/upgrade')}>Upgrade →</button></div>}
            {errors._submit && <div className={styles.submitErr}><i className="ri-error-warning-line" /> {errors._submit}</div>}
          </div>
        </div>

        <div className={styles.navRow}>
          <button className={styles.navBack} onClick={() => setStep(1)}><i className="ri-arrow-left-line" /> Back</button>
          <button className={styles.navLaunch} onClick={submit} disabled={submitting}>
            <i className="ri-rocket-line" /> Launch
          </button>
        </div>
      </div>
    )
  }

  return null
}
