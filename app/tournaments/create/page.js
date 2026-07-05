'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../../lib/constants'
import { getActivePlan } from '../../../lib/plans'
import BracketBuilder, { buildEmptyBracket } from '../../../components/BracketBuilder'
import { buildEmptyBRBracket, PLACEMENT_TABLE_PRESETS, DEFAULT_KILL_POINT_VALUE } from '../../../lib/brPoints'
import styles from './page.module.css'

const GAME_NAMES = Object.fromEntries(GAME_SLUGS.map(s => [s, GAME_META[s].name]))

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

const STEPS = [
  { key: 'details', label: 'Details', icon: 'ri-file-text-line' },
  { key: 'format',  label: 'Format',  icon: 'ri-gamepad-line'   },
  { key: 'bracket', label: 'Bracket', icon: 'ri-node-tree'       },
  { key: 'launch',  label: 'Launch',  icon: 'ri-rocket-line'     },
]

const SLOT_OPTIONS    = [4, 8, 16, 32, 64]
const FORMATS         = ['Solo', 'Duo', 'Squad', 'Bo3', 'Bo5', 'Round Robin', 'Double Elim']
const TEAM_SIZE_OPTIONS = [
  { value: 1, label: '1v1',  sub: 'Solo'        },
  { value: 2, label: '2v2',  sub: 'Team Battle' },
  { value: 4, label: '4v4',  sub: 'Team Battle' },
  { value: 8, label: '8v8',  sub: 'Team Battle' },
]

const FREE_LIMIT_FREE_TOURNEYS = 2
const FREE_LIMIT_PAID_TOURNEYS = 1

// Small helper so <img> failures don't leave broken-image icons —
// falls back to the game's Remix icon glyph instead.
function GameThumb({ slug, className }) {
  const meta = GAME_META[slug]
  const [broken, setBroken] = useState(false)
  return (
    <span className={className}>
      {meta?.image && !broken ? (
        <img src={meta.image} alt="" onError={() => setBroken(true)} />
      ) : (
        <i className={meta?.icon || 'ri-gamepad-line'} />
      )}
    </span>
  )
}

export default function CreateTournament() {
  const { user, profile, isAdmin } = useAuth()
  const { openAuthGate } = useAuthGate()
  const router = useRouter()

  if (!user) {
    return (
      <div className={styles.gateWrap}>
        <p className={styles.gateTitle}>Sign in to create tournaments</p>
        <button onClick={openAuthGate} className={styles.gateBtn}>Sign In</button>
      </div>
    )
  }

  return (
    <Suspense fallback={null}>
      <CreateForm user={user} profile={profile} isAdmin={isAdmin} router={router} />
    </Suspense>
  )
}

function CreateForm({ user, profile, isAdmin, router }) {
  const searchParams = useSearchParams()
  const prefillClanId   = searchParams.get('clan') || null
  const prefillGameSlug = searchParams.get('game')
  const prefillTeamSize = Number(searchParams.get('team_size'))

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState('forward')

  const [form, setForm] = useState({
    name: '', game_slug: (prefillGameSlug && GAME_SLUGS.includes(prefillGameSlug)) ? prefillGameSlug : (GAME_SLUGS[0] || 'pubg'),
    format: '', prize: '', slots: 32,
    date: '', description: '',
    entrance_fee: '',
    team_size: TEAM_SIZE_OPTIONS.some(o => o.value === prefillTeamSize) ? prefillTeamSize : 1,
    stage_format: 'knockout',
    group_count: 4,
    advance_per_group: 2,
    br_match_count: 6,
    br_kill_point_value: DEFAULT_KILL_POINT_VALUE,
    br_placement_preset: 'standard',
    br_placement_table: { ...PLACEMENT_TABLE_PRESETS.standard.table },
    is_test: false,
    pro_only: false,
    clan_id: prefillClanId,
  })

  const [clans, setClans] = useState([])
  const [clansLoading, setClansLoading] = useState(false)
  const [clanSearch, setClanSearch] = useState('')

  const [bracketDraft, setBracketDraft] = useState(null)

  const [errors,        setErrors]        = useState({})
  const [submitting,    setSubmitting]     = useState(false)
  const [progress,      setProgress]       = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [done,          setDone]           = useState(false)
  const [createdSlug,   setCreatedSlug]    = useState(null)
  const [myCreated,     setMyCreated]      = useState(null)

  useEffect(() => {
    supabase.from('tournaments').select('id, entrance_fee').eq('created_by', user.id)
      .then(({ data }) => setMyCreated(data || []))
  }, [user.id])

  useEffect(() => {
    setClansLoading(true)
    supabase
      .from('clans')
      .select('id,code,name,logo_url,tag_prefix,member_count')
      .eq('game', form.game_slug)
      .order('member_count', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setClans(data || [])
        setClansLoading(false)
        if (form.clan_id && !(data || []).some(c => c.id === form.clan_id)) {
          set('clan_id', null)
        }
      })
  }, [form.game_slug])

  const isBRGame     = (GAME_META[form.game_slug]?.genre || '').includes('Battle Royale')
  const activePlan   = getActivePlan(profile)
  const isPaidPlan   = isAdmin || activePlan === 'pro' || activePlan === 'elite' || activePlan === 'team'
  const myFreeCount  = (myCreated || []).filter(t => !parseFee(t.entrance_fee)).length
  const myPaidCount  = (myCreated || []).filter(t =>  parseFee(t.entrance_fee)).length
  const freeQuotaLeft = Math.max(0, FREE_LIMIT_FREE_TOURNEYS - myFreeCount)
  const paidQuotaLeft = Math.max(0, FREE_LIMIT_PAID_TOURNEYS - myPaidCount)
  const hasAnyQuota   = freeQuotaLeft > 0 || paidQuotaLeft > 0

  function parseFee(raw) {
    if (!raw) return null
    const n = Number(String(raw).replace(/[^0-9.]/g, ''))
    return isNaN(n) || n <= 0 ? null : n
  }

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); setErrors(e => ({ ...e, [key]: null })) }

  useEffect(() => {
    if (form.stage_format === 'br_points' && !isBRGame) set('stage_format', 'knockout')
  }, [form.game_slug])

  function rebuildBracket(slots, teamSize) {
    const effectiveSlots = teamSize > 1 ? Math.ceil(slots / teamSize) : slots
    const roundCounts = []
    let cur = Math.ceil(effectiveSlots / 2)
    while (cur >= 1) { roundCounts.push(cur); if (cur === 1) break; cur = Math.ceil(cur / 2) }
    const fresh = buildEmptyBracket(roundCounts, teamSize)
    setBracketDraft(fresh)
  }

  function validateStep(idx) {
    const e = {}
    if (idx === 0) {
      if (!form.name.trim()) e.name = 'Tournament name is required'
      if (!form.game_slug)   e.game_slug = 'Pick a game'
    }
    if (idx === 1) {
      if (!form.slots || form.slots < 2) e.slots = 'Need at least 2 slots'
      if (form.stage_format === 'br_points' && (!form.br_match_count || form.br_match_count < 1)) e._br = 'Need at least 1 match'
      if (form.clan_id !== null && !form.clan_id) e._clan = 'Pick a clan or turn off the clan restriction'
      if (!isPaidPlan && myCreated !== null) {
        const thisFee = parseFee(form.entrance_fee)
        const isPaidT = !!thisFee
        if (isPaidT  && myPaidCount >= FREE_LIMIT_PAID_TOURNEYS) e._quota = `Free plan allows only ${FREE_LIMIT_PAID_TOURNEYS} paid tournament. Upgrade to Elite for unlimited.`
        if (!isPaidT && myFreeCount >= FREE_LIMIT_FREE_TOURNEYS) e._quota = `Free plan allows only ${FREE_LIMIT_FREE_TOURNEYS} free tournaments. Upgrade to Elite for unlimited.`
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function next() {
    if (!validateStep(step)) return
    setDirection('forward')
    if (step === 1 && (form.stage_format === 'groups_knockout' || form.stage_format === 'br_points')) {
      setStep(STEPS.length - 1)
      return
    }
    if (step === 1 && !bracketDraft) {
      rebuildBracket(form.slots, form.team_size)
    }
    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }
  function back() {
    setDirection('back')
    if (step === STEPS.length - 1 && (form.stage_format === 'groups_knockout' || form.stage_format === 'br_points')) {
      setStep(1)
      return
    }
    setStep(s => Math.max(s - 1, 0))
  }

  async function seedTestPlayers(tournamentId, count) {
    const need = Math.max(0, Number(count) || 0)
    if (!need) return
    const { data: bots, error: botsErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('is_bot', true)
      .order('username')
      .limit(need)
    if (botsErr || !bots?.length) {
      console.error('seedTestPlayers: no bot profiles found — run the bot-seed SQL first.', botsErr)
      return
    }
    const rows = bots.map(b => ({ tournament_id: tournamentId, user_id: b.id }))
    const { error: insertErr } = await supabase.from('tournament_participants').insert(rows)
    if (insertErr) { console.error('seedTestPlayers: insert failed', insertErr); return }
    await supabase.from('tournaments').update({ registered_count: rows.length }).eq('id', tournamentId)
  }

  async function submit() {
    if (!user || submitting) return
    if (!isPaidPlan && myCreated !== null) {
      const thisFee = parseFee(form.entrance_fee)
      const isPaidT = !!thisFee
      if (isPaidT  && myPaidCount >= FREE_LIMIT_PAID_TOURNEYS) { setErrors({ _submit: `Free plan: max ${FREE_LIMIT_PAID_TOURNEYS} paid tournament.` }); return }
      if (!isPaidT && myFreeCount >= FREE_LIMIT_FREE_TOURNEYS) { setErrors({ _submit: `Free plan: max ${FREE_LIMIT_FREE_TOURNEYS} free tournaments.` }); return }
    }

    setSubmitting(true); setProgress(0); setProgressLabel('Preparing tournament…')
    await tick(15, 'Creating tournament…')

    const fee = form.entrance_fee ? Number(String(form.entrance_fee).replace(/,/g, '')) : 0

    const { data: newT, error } = await supabase.from('tournaments').insert({
      name:             form.name.trim(),
      slug:             slugify(form.name),
      game_slug:        form.game_slug,
      format:           form.format,
      prize:            form.prize,
      slots:            (form.stage_format === 'groups_knockout' || form.stage_format === 'br_points') ? Number(form.slots) : (bracketDraft?.slot_count ?? Number(form.slots)),
      date:             form.date,
      description:      form.description,
      entrance_fee:     fee,
      team_size:        form.team_size || 1,
      stage_format:     form.stage_format || 'knockout',
      group_count:      form.stage_format === 'groups_knockout' ? Number(form.group_count) : null,
      advance_per_group: form.stage_format === 'groups_knockout' ? Number(form.advance_per_group) : null,
      bracket_data:     form.stage_format === 'br_points'
        ? buildEmptyBRBracket({ matchCount: Number(form.br_match_count), killPointValue: Number(form.br_kill_point_value), placementTable: form.br_placement_table })
        : (form.stage_format === 'groups_knockout' ? null : (bracketDraft || null)),
      round_names:      (form.stage_format === 'groups_knockout' || form.stage_format === 'br_points') ? null : (bracketDraft?.round_names ?? null),
      is_test:          form.is_test,
      pro_only:         form.pro_only,
      clan_id:          form.clan_id || null,
      status:           'active',
      registered_count: 0,
      created_by:       user.id,
    }).select().single()

    if (error) { setSubmitting(false); setErrors({ _submit: error.message }); setProgress(0); return }

    await tick(50, 'Tournament created!')

    if (form.is_test) {
      setProgressLabel('Seeding test players…')
      await seedTestPlayers(newT.id, newT.slots)
      setProgressLabel('Test run ready — no notifications sent.')
    } else {
      setProgressLabel('Notifying players…')
      const { data: allProfiles } = form.clan_id
        ? await supabase.from('clan_members').select('user_id').eq('clan_id', form.clan_id).neq('user_id', user.id)
            .then(({ data }) => ({ data: (data || []).map(m => ({ id: m.user_id })) }))
        : await supabase.from('profiles').select('id').neq('id', user.id)
      if (allProfiles?.length) {
        const gameName = newT.game_slug ? ` ${newT.game_slug.toUpperCase()}` : ''
        const feeNote  = fee > 0 ? ` · Entry fee: TZS ${fee.toLocaleString()}` : ''
        const proNote  = form.pro_only ? ' · Pro & Elite only 👑' : ''
        const clanNote = form.clan_id ? ` · ${clans.find(c => c.id === form.clan_id)?.name || 'Clan'} members only 🛡️` : ''
        const notifications = allProfiles.map(p => ({
          user_id: p.id,
          title:   `New Tournament — ${newT.name}`,
          body:    `A new${gameName} tournament is open${newT.date ? ` on ${newT.date}` : ''}. ${newT.slots} slots${newT.prize ? ` · Prize: TZS ${newT.prize}` : ''}${feeNote}${proNote}${clanNote}. Register now!`,
          type:    'tournament',
          meta:    { tournament_id: newT.id },
          read:    false,
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

  // ── Done ──────────────────────────────────────────────────────────────────
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

  const slideClass = direction === 'forward' ? styles.slideFromRight : styles.slideFromLeft
  const pct = Math.round((step / (STEPS.length - 1)) * 100)
  const filteredClans = clans.filter(c => !clanSearch || c.name.toLowerCase().includes(clanSearch.toLowerCase()))

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => step === 0 ? router.back() : back()}><i className="ri-arrow-left-line" /></button>
        <span className={styles.topTitle}>Create Tournament</span>
      </div>

      {!isPaidPlan && myCreated !== null && (
        <div className={styles.quotaNotice}>
          <i className="ri-information-line" />
          <span>
            Free plan: <strong>{myFreeCount}/{FREE_LIMIT_FREE_TOURNEYS}</strong> free &amp; <strong>{myPaidCount}/{FREE_LIMIT_PAID_TOURNEYS}</strong> paid used.
            {!hasAnyQuota && <> All slots used — <button className={styles.quotaLink} onClick={() => router.push('/upgrade')}>upgrade to continue</button>.</>}
          </span>
        </div>
      )}

      {/* ── Segmented progress bar ── */}
      <div className={styles.progressWrap}>
        <div className={styles.progressTop}>
          <span className={styles.progressStepText}><i className={STEPS[step].icon} /> {STEPS[step].label}</span>
          <span className={styles.progressPct}>{pct}%</span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          <div className={styles.progressKnob} style={{ left: `${pct}%` }}><i className={STEPS[step].icon} /></div>
        </div>
        <div className={styles.progressLabels}>
          {STEPS.map((s, i) => (
            <span key={s.key} className={`${styles.progressLabel} ${i === step ? styles.progressLabelActive : ''} ${i < step ? styles.progressLabelDone : ''}`}>
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <div key={step} className={`${styles.stepContent} ${slideClass}`}>

        {/* ── Step 0: Details ── */}
        {step === 0 && (
          <>
            <h2 className={styles.stepHeading}><i className="ri-file-text-line" /> Basic Details</h2>
            <p className={styles.stepHint}>Give your tournament a name and pick the game.</p>

            <div className={`${styles.field} ${styles.nameField}`} style={{ marginBottom: 14 }}>
              <label>Tournament Name <span className={styles.req}>*</span></label>
              <input type="text" value={form.name} placeholder="e.g. Solo Showdown Season 1" onChange={e => set('name', e.target.value)} className={errors.name ? styles.inputError : ''} autoFocus />
              {errors.name && <span className={styles.errMsg}>{errors.name}</span>}
            </div>

            <div className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}><i className="ri-gamepad-line" /></span>
                <div>
                  <h3 className={styles.sectionTitle}>Game</h3>
                  <p className={styles.sectionSub}>What players will be competing in</p>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.gameTileGrid}>
                  {GAME_SLUGS.map(s => {
                    const active = form.game_slug === s
                    return (
                      <button key={s} type="button" className={`${styles.gameTile} ${active ? styles.gameTileActive : ''}`} onClick={() => set('game_slug', s)}>
                        <GameThumb slug={s} className={styles.gameTileThumb} />
                        <span className={styles.gameTileName}>{GAME_NAMES[s] || s}</span>
                        {active && <span className={styles.gameTileCheck}><i className="ri-check-line" /></span>}
                      </button>
                    )
                  })}
                </div>
                {errors.game_slug && <span className={styles.errMsg}>{errors.game_slug}</span>}
              </div>
            </div>

            <div className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}><i className="ri-align-left" /></span>
                <div>
                  <h3 className={styles.sectionTitle}>Description</h3>
                  <p className={styles.sectionSub}>Optional — shown on the tournament page</p>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <textarea rows={3} value={form.description} placeholder="Brief description of the tournament…" onChange={e => set('description', e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* ── Step 1: Format ── */}
        {step === 1 && (
          <>
            <h2 className={styles.stepHeading}><i className="ri-gamepad-line" /> Format & Rules</h2>
            <p className={styles.stepHint}>Set structure, prize, and entry options. Bracket is built next.</p>

            {/* Format */}
            <div className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}><i className="ri-layout-grid-line" /></span>
                <div>
                  <h3 className={styles.sectionTitle}>Format</h3>
                  <p className={styles.sectionSub}>Match style for this tournament</p>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.chipRow}>
                  {FORMATS.map(f => (
                    <button key={f} type="button" className={`${styles.chip} ${form.format === f ? styles.chipActive : ''}`} onClick={() => set('format', form.format === f ? '' : f)}>{f}</button>
                  ))}
                </div>
                <input type="text" value={form.format} placeholder="Or type a custom format…" onChange={e => set('format', e.target.value)} />
              </div>
            </div>

            {/* Bracket size */}
            <div className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}><i className="ri-group-line" /></span>
                <div>
                  <h3 className={styles.sectionTitle}>Bracket Size</h3>
                  <p className={styles.sectionSub}>Slots &amp; team composition</p>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.field}>
                  <label>Total Slots <span className={styles.req}>*</span></label>
                  <div className={styles.chipRow}>
                    {SLOT_OPTIONS.map(n => (
                      <button key={n} type="button" className={`${styles.chip} ${form.slots === n ? styles.chipActive : ''}`}
                        onClick={() => { set('slots', n); setBracketDraft(null) }}>{n}</button>
                    ))}
                  </div>
                  {errors.slots && <span className={styles.errMsg}>{errors.slots}</span>}
                </div>
                <div className={styles.field}>
                  <label>Match Type</label>
                  <div className={styles.chipRow}>
                    {TEAM_SIZE_OPTIONS.map(opt => (
                      <button key={opt.value} type="button"
                        className={`${styles.chip} ${styles.teamSizeChip} ${form.team_size === opt.value ? styles.chipActive : ''}`}
                        onClick={() => { set('team_size', opt.value); setBracketDraft(null) }}
                      >
                        <span className={styles.teamSizeChipLabel}>{opt.label}</span>
                        <span className={styles.teamSizeChipSub}>{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                  {form.team_size > 1 && (
                    <span className={styles.feeHint}><i className="ri-team-line" /> Team Battle — players grouped into teams of {form.team_size}.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Stage structure */}
            <div className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}><i className="ri-node-tree" /></span>
                <div>
                  <h3 className={styles.sectionTitle}>Stage Structure</h3>
                  <p className={styles.sectionSub}>How players progress to a winner</p>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.chipRow}>
                  <button type="button" className={`${styles.chip} ${form.stage_format === 'knockout' ? styles.chipActive : ''}`}
                    onClick={() => set('stage_format', 'knockout')}>Knockout</button>
                  <button type="button" className={`${styles.chip} ${form.stage_format === 'groups_knockout' ? styles.chipActive : ''}`}
                    onClick={() => set('stage_format', 'groups_knockout')}>Groups + Knockout</button>
                  {isBRGame && (
                    <button type="button" className={`${styles.chip} ${form.stage_format === 'br_points' ? styles.chipActive : ''}`}
                      onClick={() => set('stage_format', 'br_points')}>Battle Royale Points</button>
                  )}
                </div>

                {form.stage_format === 'br_points' && (
                  <>
                    <span className={styles.feeHint}><i className="ri-skull-line" /> No bracket — players/squads play a series of matches. Each match is scored by placement + kills, summed across all matches for a final standings table.</span>
                    <div className={styles.subRow}>
                      <div className={styles.subCol}>
                        <label className={styles.subColLabel}>Number of matches</label>
                        <div className={styles.chipRow}>
                          {[3, 4, 6, 8].map(n => (
                            <button key={n} type="button" className={`${styles.chip} ${form.br_match_count === n ? styles.chipActive : ''}`}
                              onClick={() => set('br_match_count', n)}>{n}</button>
                          ))}
                        </div>
                      </div>
                      <div className={styles.subCol}>
                        <label className={styles.subColLabel}>Points per kill</label>
                        <div className={styles.chipRow}>
                          {[0.5, 1, 1.5, 2].map(n => (
                            <button key={n} type="button" className={`${styles.chip} ${form.br_kill_point_value === n ? styles.chipActive : ''}`}
                              onClick={() => set('br_kill_point_value', n)}>{n}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.subColLabel} style={{ textTransform: 'none', letterSpacing: 0 }}>Placement points table</label>
                      <div className={styles.chipRow}>
                        {Object.entries(PLACEMENT_TABLE_PRESETS).map(([key, preset]) => (
                          <button key={key} type="button" className={`${styles.chip} ${form.br_placement_preset === key ? styles.chipActive : ''}`}
                            onClick={() => { set('br_placement_preset', key); set('br_placement_table', { ...preset.table }) }}>
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className={styles.placementGrid}>
                        {Object.entries(form.br_placement_table).sort((a, b) => Number(a[0]) - Number(b[0])).map(([place, pts]) => (
                          <div key={place} className={styles.placementPill}>
                            <span className={styles.placementRank}>#{place}</span>
                            <input
                              type="number" value={pts} min={0} className={styles.placementInput}
                              onChange={e => set('br_placement_table', { ...form.br_placement_table, [place]: Number(e.target.value) || 0 })}
                            />
                          </div>
                        ))}
                      </div>
                      <span className={styles.feeHint}><i className="ri-information-line" /> Placements not listed above score 0 placement points — kills still count for everyone.</span>
                    </div>
                    {errors._br && <span className={styles.errMsg}>{errors._br}</span>}
                  </>
                )}

                {form.stage_format === 'groups_knockout' && (
                  <>
                    <span className={styles.feeHint}><i className="ri-node-tree" /> Players are split into groups for round-robin play. Top finishers move into a knockout bracket.</span>
                    <div className={styles.subRow}>
                      <div className={styles.subCol}>
                        <label className={styles.subColLabel}>Number of groups</label>
                        <div className={styles.chipRow}>
                          {[2, 4, 8].map(n => (
                            <button key={n} type="button" className={`${styles.chip} ${form.group_count === n ? styles.chipActive : ''}`}
                              onClick={() => set('group_count', n)}>{n}</button>
                          ))}
                        </div>
                      </div>
                      <div className={styles.subCol}>
                        <label className={styles.subColLabel}>Advance per group</label>
                        <div className={styles.chipRow}>
                          {[1, 2, 4].map(n => (
                            <button key={n} type="button" className={`${styles.chip} ${form.advance_per_group === n ? styles.chipActive : ''}`}
                              onClick={() => set('advance_per_group', n)}>{n}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Access */}
            <div className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}><i className="ri-shield-star-line" /></span>
                <div>
                  <h3 className={styles.sectionTitle}>Access</h3>
                  <p className={styles.sectionSub}>Who's allowed to join</p>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <button type="button" className={`${styles.toggleRow} ${styles.toneClan} ${form.clan_id !== null ? styles.toggleOn : ''}`}
                  onClick={() => set('clan_id', form.clan_id !== null ? null : '')}>
                  <div className={styles.toggleLeft}>
                    <i className={form.clan_id !== null ? 'ri-shield-star-fill' : 'ri-shield-star-line'} />
                    <div>
                      <span className={styles.toggleLabel}>Restrict to a Clan</span>
                      <span className={styles.toggleHint}>{form.clan_id !== null ? 'Only members of the selected clan can join.' : 'Open to a single clan\u2019s squads instead of everyone.'}</span>
                    </div>
                  </div>
                  <div className={`${styles.toggleSwitch} ${form.clan_id !== null ? styles.toggleSwitchOn : ''}`}><div className={styles.toggleKnob} /></div>
                </button>

                {form.clan_id !== null && (
                  <div className={styles.field}>
                    <input type="text" value={clanSearch} placeholder="Search clans…" onChange={e => setClanSearch(e.target.value)} />
                    <div className={styles.chipRow}>
                      {clansLoading ? (
                        <span className={styles.toggleHint}>Loading clans…</span>
                      ) : filteredClans.length === 0 ? (
                        <span className={styles.toggleHint}>No clans found for {GAME_NAMES[form.game_slug] || form.game_slug}.</span>
                      ) : (
                        filteredClans.map(c => (
                          <button key={c.id} type="button" className={`${styles.chip} ${form.clan_id === c.id ? styles.chipActive : ''}`} onClick={() => set('clan_id', c.id)}>
                            {c.logo_url && <img src={c.logo_url} alt="" className={styles.clanLogo} />}
                            {c.name} <span style={{ opacity: 0.6 }}>· {c.member_count}</span>
                          </button>
                        ))
                      )}
                    </div>
                    {form.team_size > 1 && (
                      <span className={styles.feeHint}><i className="ri-team-line" /> Squads from this clan claim team slots — squadmates fill the open spots first-come, first-served.</span>
                    )}
                  </div>
                )}

                {errors._clan && (
                  <div className={styles.quotaErr}><i className="ri-shield-star-line" /><span>{errors._clan}</span></div>
                )}

                <div className={styles.toggleDivider} />

                <button type="button" className={`${styles.toggleRow} ${styles.tonePro} ${form.pro_only ? styles.toggleOn : ''}`}
                  onClick={() => set('pro_only', !form.pro_only)}>
                  <div className={styles.toggleLeft}>
                    <i className={form.pro_only ? 'ri-vip-crown-fill' : 'ri-vip-crown-line'} />
                    <div>
                      <span className={styles.toggleLabel}>Pro & Elite Only</span>
                      <span className={styles.toggleHint}>{form.pro_only ? 'Only Pro, Elite & Team members can join.' : 'Restrict to paid plan members only.'}</span>
                    </div>
                  </div>
                  <div className={`${styles.toggleSwitch} ${form.pro_only ? styles.toggleSwitchOn : ''}`}><div className={styles.toggleKnob} /></div>
                </button>
              </div>
            </div>

            {/* Pricing & schedule */}
            <div className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionIcon}><i className="ri-money-dollar-circle-line" /></span>
                <div>
                  <h3 className={styles.sectionTitle}>Pricing & Schedule</h3>
                  <p className={styles.sectionSub}>Prize, date, and entry cost</p>
                </div>
              </div>
              <div className={styles.sectionBody}>
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
                  <label><i className="ri-ticket-line" style={{ marginRight: 4 }} />Entrance Fee (TZS) <span className={styles.opt}>(optional)</span></label>
                  <input type="text" value={form.entrance_fee} placeholder="e.g. 2,000 — leave blank for free entry" onChange={e => set('entrance_fee', e.target.value)} />
                  {form.entrance_fee && <span className={styles.feeHint}><i className="ri-information-line" /> Players submit M-Pesa proof — admin approves before registration.</span>}
                </div>
              </div>
            </div>

            {/* Test run — caution-tinted, kept standalone */}
            <div className={`${styles.sectionCard} ${styles.testCard} ${form.is_test ? styles.testCardOn : ''}`}>
              <div className={styles.sectionBody} style={{ padding: 12 }}>
                <button type="button" className={`${styles.toggleRow} ${styles.toneTest} ${form.is_test ? styles.toggleOn : ''}`} onClick={() => set('is_test', !form.is_test)}>
                  <div className={styles.toggleLeft}>
                    <i className={form.is_test ? 'ri-flask-fill' : 'ri-flask-line'} />
                    <div>
                      <span className={styles.toggleLabel}>Test Run</span>
                      <span className={styles.toggleHint}>{form.is_test ? 'Active — no notifications sent.' : 'Run a silent test — no notifications, hidden from other users.'}</span>
                    </div>
                  </div>
                  <div className={`${styles.toggleSwitch} ${form.is_test ? styles.toggleSwitchOn : ''}`}><div className={styles.toggleKnob} /></div>
                </button>
              </div>
            </div>

            {errors._quota && (
              <div className={styles.quotaErr}>
                <i className="ri-shield-star-line" /><span>{errors._quota}</span>
                <button className={styles.quotaErrBtn} onClick={() => router.push('/upgrade')}>Upgrade →</button>
              </div>
            )}
          </>
        )}

        {/* ── Step 2: Bracket Builder ── */}
        {step === 2 && (
          <>
            <h2 className={styles.stepHeading}><i className="ri-node-tree" /> Build Your Bracket</h2>
            <p className={styles.stepHint}>
              Pick a starting shape then customise freely — add/remove rounds, drag slots to swap,
              tap any name to rename, mark BYEs.{' '}
              {bracketDraft?.slot_count > 0 && (
                <strong style={{ color: 'var(--tone-clan)' }}>{bracketDraft.slot_count} player slots</strong>
              )} will be the tournament capacity. Edit more after launch from Manage.
            </p>
            <BracketBuilder
              bracketData={bracketDraft}
              onChange={bd => setBracketDraft(bd)}
              participants={[]}
              teamSize={form.team_size}
            />
          </>
        )}

        {/* ── Step 3: Review & Launch ── */}
        {step === 3 && (
          <>
            <h2 className={styles.stepHeading}><i className="ri-rocket-line" /> Review & Launch</h2>
            <p className={styles.stepHint}>Everything look good? Hit launch to go live.</p>

            <div className={styles.heroSummary}>
              <GameThumb slug={form.game_slug} className={styles.heroThumb} />
              <div className={styles.heroInfo}>
                <span className={styles.heroGame}>{GAME_NAMES[form.game_slug] || form.game_slug}</span>
                <h3 className={styles.heroName}>{form.name || 'Untitled Tournament'}</h3>
                <div className={styles.heroStats}>
                  <span><i className="ri-group-line" /> {bracketDraft?.slot_count ?? form.slots} slots</span>
                  <span><i className="ri-ticket-line" /> {form.entrance_fee ? `TZS ${Number(String(form.entrance_fee).replace(/,/g,'')).toLocaleString()}` : 'Free entry'}</span>
                </div>
              </div>
            </div>

            <div className={styles.reviewCard}>
              {[
                ['ri-layout-grid-line', 'Format',     form.format || '—'],
                ['ri-team-line',        'Match Type', form.team_size === 1 ? '1v1 — Solo' : `${form.team_size}v${form.team_size} — Team Battle`],
                ...(form.stage_format === 'br_points'
                  ? [
                      ['ri-skull-line',       'Matches',          `${form.br_match_count}`],
                      ['ri-crosshair-2-line', 'Points per kill',  `${form.br_kill_point_value}`],
                    ]
                  : [['ri-node-tree', 'Bracket', bracketDraft ? `${bracketDraft.rounds?.length} rounds · ${bracketDraft.rounds?.[0]?.length * 2} slots` : 'Auto-generated on launch']]
                ),
                ['ri-money-dollar-circle-line', 'Prize', form.prize ? `TZS ${form.prize}` : '—'],
                ['ri-calendar-event-line',      'Date',  form.date || '—'],
              ].map(([icon, label, val]) => (
                <div key={label} className={styles.reviewRow}>
                  <span className={styles.reviewLabel}><i className={icon} /> {label}</span>
                  <span className={styles.reviewVal}>{val}</span>
                </div>
              ))}
            </div>

            <div className={styles.reviewCard}>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-shield-star-line" /> Clan</span>
                <span className={`${styles.reviewVal} ${form.clan_id ? styles.reviewValClan : styles.reviewValMuted}`}>
                  {form.clan_id ? (clans.find(c => c.id === form.clan_id)?.name || 'Selected clan') : 'Open to everyone'}
                </span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-vip-crown-line" /> Access</span>
                <span className={`${styles.reviewVal} ${form.pro_only ? styles.reviewValPro : styles.reviewValMuted}`}>
                  {form.pro_only ? '👑 Pro & Elite only' : 'Open to all'}
                </span>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}><i className="ri-flask-line" /> Mode</span>
                <span className={`${styles.reviewVal} ${form.is_test ? styles.reviewValTest : styles.reviewValMuted}`}>
                  {form.is_test ? '🧪 Test Run (silent)' : 'Live'}
                </span>
              </div>
            </div>

            {errors._submit && <div className={styles.submitErr}><i className="ri-error-warning-line" /> {errors._submit}</div>}
          </>
        )}
        </div>
      </div>

      <div className={styles.navRow}>
        {step > 0 && <button className={styles.navBack} onClick={back}><i className="ri-arrow-left-line" /> Back</button>}
        {step < STEPS.length - 1 && <button className={styles.navNext} onClick={next}>Next <i className="ri-arrow-right-line" /></button>}
        {step === STEPS.length - 1 && (
          <button className={styles.navLaunch} onClick={submit} disabled={submitting}>
            <i className="ri-rocket-line" /> Launch Tournament
          </button>
        )}
      </div>
    </div>
  )
}
