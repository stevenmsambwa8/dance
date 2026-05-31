'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import usePageLoading from '../../../../components/usePageLoading'
import styles from './page.module.css'

const GAME_SLUGS = ['pubgm','freefire','codm','bussid','efootball','dls']
const GAME_NAMES = { pubgm:'PUBGM', freefire:'Free Fire', codm:'Call of Duty', bussid:'Maleo BUSSID', efootball:'eFootball', dls:'DLS26' }
const FORMATS    = ['Solo','Duo','Squad','Team','League','Round Robin']
const STATUSES   = ['active','ongoing','upcoming','completed']

// Team size options — only upgrade is allowed (solo → team), never downgrade.
// Downgrading would corrupt existing bracket_data member slots.
const TEAM_SIZE_OPTIONS = [
  { value: 1, label: '1v1', sub: 'Solo' },
  { value: 2, label: '2v2', sub: 'Team Battle' },
  { value: 4, label: '4v4', sub: 'Team Battle' },
  { value: 8, label: '8v8', sub: 'Team Battle' },
]

function Field({ label, hint, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      {hint && <p className={styles.fieldHint}>{hint}</p>}
      {children}
    </div>
  )
}

export default function TournamentEditPage() {
  const { slug }  = useParams()
  const router    = useRouter()
  const { user, isAdmin } = useAuth()

  const [tournament, setTournament] = useState(null)
  const [loading,    setLoading]    = useState(true)
  usePageLoading(loading)

  const [form, setForm] = useState({
    name: '', description: '', game_slug: 'pubgm', format: 'Solo',
    slots: '', entrance_fee: '', date: '', status: 'active',
    team_size: 1,
  })
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState('')
  const [deleting,  setDeleting]  = useState(false)
  const [showDel,   setShowDel]   = useState(false)
  const [delInput,  setDelInput]  = useState('')

  useEffect(() => {
    async function load() {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
      const { data } = await (isUUID
        ? supabase.from('tournaments').select('*').eq('id', slug).single()
        : supabase.from('tournaments').select('*').eq('slug', slug).single()
      )
      if (!data) { setLoading(false); return }

      const canEdit = isAdmin || (user && data.created_by === user.id)
      if (!canEdit) { router.replace(`/tournaments/${slug}`); return }

      setTournament(data)
      setForm({
        name:         data.name         || '',
        description:  data.description  || '',
        game_slug:    data.game_slug     || 'pubgm',
        format:       data.format        || 'Solo',
        slots:        data.slots         ?? '',
        entrance_fee: data.entrance_fee  ?? '',
        date:         data.date          || '',
        status:       data.status        || 'active',
        team_size:    data.team_size      || 1,
      })
      setLoading(false)
    }
    load()
  }, [slug, user, isAdmin])

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setSaved(false)
    setError('')
  }

  async function save() {
    if (!form.name.trim()) { setError('Tournament name is required.'); return }
    setSaving(true); setError(''); setSaved(false)
    const { error: err } = await supabase
      .from('tournaments')
      .update({
        name:         form.name.trim(),
        description:  form.description.trim() || null,
        game_slug:    form.game_slug,
        format:       form.format,
        slots:        Number(form.slots) || tournament.slots,
        entrance_fee: form.entrance_fee !== '' ? String(form.entrance_fee) : null,
        date:         form.date || null,
        status:       form.status,
        team_size:    form.team_size || 1,
      })
      .eq('id', tournament.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => router.push(`/tournaments/${slug}`), 800)
  }

  async function deleteTournament() {
    setDeleting(true)
    await supabase.from('tournament_leaderboard').delete().eq('tournament_id', tournament.id)
    await supabase.from('tournament_participants').delete().eq('tournament_id', tournament.id)
    await supabase.from('tournament_payments').delete().eq('tournament_id', tournament.id)
    await supabase.from('tournaments').delete().eq('id', tournament.id)
    router.replace('/tournaments')
  }

  if (loading) return null
  if (!tournament) return (
    <div className={styles.page}>
      <p style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Tournament not found.
      </p>
    </div>
  )

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => router.back()}>
          <i className="ri-arrow-left-line" />
        </button>
        <h1 className={styles.title}>Edit Tournament</h1>
        <button
          className={`${styles.saveBtn} ${saved ? styles.saveBtnDone : ''}`}
          onClick={save}
          disabled={saving}
        >
          {saving ? <i className="ri-loader-4-line" style={{ animation: 'spin .7s linear infinite' }} />
           : saved  ? <><i className="ri-check-line" /> Saved</>
           : 'Save'}
        </button>
      </div>

      {error && <div className={styles.errorBanner}><i className="ri-error-warning-line" /> {error}</div>}

      {/* Tournament name chip */}
      <div className={styles.tournamentChip}>
        <i className="ri-node-tree" />
        <span>{tournament.name}</span>
        <span className={`${styles.statusPill} ${styles['status_' + tournament.status]}`}>{tournament.status}</span>
      </div>

      {/* Fields */}
      <div className={styles.form}>

        <Field label="Tournament Name">
          <input
            className={styles.input}
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Nabogaming SS2 PUBGM"
          />
        </Field>

        <Field label="Description" hint="Describe rules, format, and important info for participants.">
          <textarea
            className={styles.textarea}
            rows={4}
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Optional description..."
          />
        </Field>

        <div className={styles.row}>
          <Field label="Game">
            <select className={styles.select} value={form.game_slug} onChange={e => set('game_slug', e.target.value)}>
              {GAME_SLUGS.map(s => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <select className={styles.select} value={form.format} onChange={e => set('format', e.target.value)}>
              {FORMATS.map(f => <option key={f}>{f}</option>)}
            </select>
          </Field>
        </div>

        <div className={styles.row}>
          <Field label="Max Players">
            <input
              className={styles.input}
              type="number"
              min="2"
              value={form.slots}
              onChange={e => set('slots', e.target.value)}
              placeholder={String(tournament.slots)}
            />
          </Field>
          <Field label="Status">
            <select className={styles.select} value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Entry Fee (TZS)" hint="Leave blank for free">
          <input
            className={styles.input}
            type="text"
            value={form.entrance_fee}
            onChange={e => set('entrance_fee', e.target.value)}
            placeholder="e.g. 1000"
          />
        </Field>

        {/* ── Match Type — always visible, all 4 options, reset available ── */}
        <Field
          label="Match Type"
          hint="Select the match format. Use Reset to 1v1 to start over."
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TEAM_SIZE_OPTIONS.map(opt => {
              const isActive = form.team_size === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('team_size', opt.value)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 2, padding: '8px 14px', borderRadius: 10, border: 'none',
                    background: isActive ? 'var(--accent)' : 'var(--surface-raised)',
                    color: isActive ? '#fff' : 'var(--text)',
                    cursor: 'pointer', minWidth: 60, fontFamily: 'inherit',
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: 14 }}>{opt.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.75 }}>{opt.sub}</span>
                </button>
              )
            })}
          </div>
          {form.team_size !== (tournament.team_size || 1) && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 5 }}>
              <i className="ri-information-line" />
              {form.team_size === 1
                ? 'Resetting to 1v1 — next generated bracket will be solo.'
                : `Changing to ${form.team_size}v${form.team_size} — next generated bracket will use teams of ${form.team_size}.`}
            </p>
          )}
          {(tournament.team_size || 1) > 1 && (
            <button
              type="button"
              onClick={() => set('team_size', 1)}
              style={{
                marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.3)',
                background: 'rgba(220,38,38,0.06)', color: '#dc2626',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <i className="ri-refresh-line" /> Reset to 1v1
            </button>
          )}
        </Field>

        <Field label="Date" hint="Shown on the tournament card">
          <input
            className={styles.input}
            type="text"
            value={form.date}
            onChange={e => set('date', e.target.value)}
            placeholder="e.g. May 25 2026"
          />
        </Field>

      </div>

      {/* Divider */}
      <div className={styles.divider} />

      {/* Danger zone */}
      <div className={styles.dangerZone}>
        <div className={styles.dangerHeader}>
          <i className="ri-error-warning-line" />
          <span>Danger Zone</span>
        </div>
        <p className={styles.dangerDesc}>
          Deleting this tournament permanently removes all bracket data, participants, payments, and leaderboard entries. This cannot be undone.
        </p>
        {!showDel ? (
          <button className={styles.dangerBtn} onClick={() => setShowDel(true)}>
            <i className="ri-delete-bin-line" /> Delete Tournament
          </button>
        ) : (
          <div className={styles.delConfirm}>
            <p>Type <strong>DELETE</strong> to confirm:</p>
            <input
              className={styles.input}
              value={delInput}
              onChange={e => setDelInput(e.target.value)}
              placeholder="DELETE"
              autoCapitalize="characters"
            />
            <div className={styles.delActions}>
              <button className={styles.delCancel} onClick={() => { setShowDel(false); setDelInput('') }}>
                Cancel
              </button>
              <button
                className={styles.delConfirmBtn}
                disabled={delInput !== 'DELETE' || deleting}
                onClick={deleteTournament}
              >
                {deleting ? 'Deleting…' : <><i className="ri-delete-bin-2-fill" /> Delete Forever</>}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
