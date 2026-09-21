'use client'
import { useState } from 'react'
import { useAuth, ADMIN_EMAILS } from './AuthProvider'
import { useGames } from './GameSettingsProvider'
import { supabase } from '../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../lib/constants'
import styles from './AdminGames.module.css'

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR
const DURATIONS = [
  { label: '1 hour',  ms: HOUR },
  { label: '6 hours', ms: 6 * HOUR },
  { label: '1 day',   ms: DAY },
  { label: '3 days',  ms: 3 * DAY },
  { label: '7 days',  ms: 7 * DAY },
  { label: '30 days', ms: 30 * DAY },
]

function fmtWhen(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
function fmtLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'ending now'
  const h = Math.ceil(ms / HOUR)
  if (h < 48) return `${h}h left`
  return `${Math.ceil(ms / DAY)}d left`
}

export default function AdminGames() {
  const { user } = useAuth()
  const { getGameStatus, refresh } = useGames()
  const canDelete = ADMIN_EMAILS.includes(user?.email)

  const [modal, setModal]   = useState(null)   // { type: 'hide'|'disable'|'delete', slug }
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')
  const [toast, setToast]   = useState('')

  // disable form
  const [durMs, setDurMs]       = useState(DAY)
  const [customUntil, setCustom] = useState('')
  const [note, setNote]         = useState('')
  // delete form
  const [confirmText, setConfirmText] = useState('')

  function openModal(type, slug) {
    setError(''); setBusy(false)
    setDurMs(DAY); setCustomUntil(''); setNote(''); setConfirmText('')
    setModal({ type, slug })
  }
  function setCustomUntil(v) { setCustom(v); if (v) setDurMs(null) }

  async function callApi(payload) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Request failed')
    return json
  }

  async function run(payload, doneMsg, closeModal = true) {
    setBusy(true); setError('')
    try {
      await callApi(payload)
      await refresh()
      setToast(doneMsg)
      setTimeout(() => setToast(''), 3000)
      if (closeModal) setModal(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function submitDisable() {
    const until = durMs ? new Date(Date.now() + durMs).toISOString()
                        : (customUntil ? new Date(customUntil).toISOString() : null)
    if (!until) { setError('Choose how long to disable it.'); return }
    run({ slug: modal.slug, action: 'disable', until, note }, `${GAME_META[modal.slug].name} disabled`)
  }

  const live    = GAME_SLUGS.filter(s => getGameStatus(s).state !== 'deleted')
  const deleted = GAME_SLUGS.filter(s => getGameStatus(s).state === 'deleted')
  const counts  = live.reduce((a, s) => { const k = getGameStatus(s).state; a[k] = (a[k] || 0) + 1; return a }, {})

  const modalGame = modal ? GAME_META[modal.slug] : null

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h2 className={styles.title}>Games</h2>
        <div className={styles.summary}>
          <span className={styles.sumLive}>{counts.active || 0} live</span>
          {!!counts.disabled && <span className={styles.sumDis}>{counts.disabled} disabled</span>}
          {!!counts.hidden && <span className={styles.sumHid}>{counts.hidden} hidden</span>}
        </div>
      </div>

      <p className={styles.help}>
        <b>Hide</b> removes a game from the whole website until you show it again.{' '}
        <b>Disable</b> keeps it listed but unavailable, and it turns back on by itself when the time is up.{' '}
        <b>Delete</b> removes it forever.
      </p>

      {toast && <div className={styles.toast}><i className="ri-check-line" /> {toast}</div>}
      {error && !modal && <div className={styles.errorBox}><i className="ri-error-warning-line" /> {error}</div>}

      <div className={styles.list}>
        {live.map(slug => {
          const meta = GAME_META[slug]
          const st   = getGameStatus(slug)
          return (
            <div key={slug} className={`${styles.card} ${st.state !== 'active' ? styles.cardOff : ''}`}>
              <div className={styles.cardMain}>
                <div className={styles.thumb}>
                  {meta.image ? <img src={meta.image} alt="" /> : <i className={meta.icon} />}
                </div>
                <div className={styles.info}>
                  <div className={styles.name}>{meta.name}</div>
                  <div className={styles.status}>
                    {st.state === 'active'   && <span className={styles.pillLive}><i className="ri-checkbox-circle-fill" /> Live</span>}
                    {st.state === 'hidden'   && <span className={styles.pillHidden}><i className="ri-eye-off-line" /> Hidden</span>}
                    {st.state === 'disabled' && <span className={styles.pillDisabled}><i className="ri-pause-circle-line" /> Disabled</span>}
                    {st.state === 'disabled' && (
                      <span className={styles.detail}>until {fmtWhen(st.until)} · {fmtLeft(st.until)}</span>
                    )}
                  </div>
                  {st.state === 'disabled' && st.note && <div className={styles.note}>“{st.note}”</div>}
                </div>
              </div>

              <div className={styles.actions}>
                {st.state === 'hidden'
                  ? <button className={styles.btn} disabled={busy} onClick={() => run({ slug, action: 'show' }, `${meta.name} is visible again`, false)}><i className="ri-eye-line" /> Show</button>
                  : <button className={styles.btn} disabled={busy} onClick={() => openModal('hide', slug)}><i className="ri-eye-off-line" /> Hide</button>}

                {st.state === 'disabled'
                  ? <>
                      <button className={styles.btn} disabled={busy} onClick={() => run({ slug, action: 'show' }, `${meta.name} enabled`, false)}><i className="ri-play-circle-line" /> Enable now</button>
                      <button className={styles.btn} disabled={busy} onClick={() => openModal('disable', slug)}><i className="ri-time-line" /> Change</button>
                    </>
                  : <button className={styles.btn} disabled={busy} onClick={() => openModal('disable', slug)}><i className="ri-pause-circle-line" /> Disable</button>}

                <button className={`${styles.btn} ${styles.btnDanger}`} disabled={busy || !canDelete}
                  title={canDelete ? '' : 'Only a permanent admin can delete a game'}
                  onClick={() => openModal('delete', slug)}>
                  <i className="ri-delete-bin-line" /> Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {deleted.length > 0 && (
        <div className={styles.deletedBox}>
          <div className={styles.deletedTitle}><i className="ri-delete-bin-2-line" /> Deleted forever</div>
          {deleted.map(slug => (
            <div key={slug} className={styles.deletedRow}>{GAME_META[slug].name}</div>
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {modal && (
        <div className={styles.overlay} onClick={() => !busy && setModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              {modal.type === 'hide'    && <>Hide {modalGame.name}?</>}
              {modal.type === 'disable' && <>Disable {modalGame.name}</>}
              {modal.type === 'delete'  && <>Delete {modalGame.name} forever?</>}
            </div>

            {modal.type === 'hide' && (
              <p className={styles.modalText}>
                It disappears from the whole website: game lists, filters, pickers, search and its page.
                You can show it again any time.
              </p>
            )}

            {modal.type === 'disable' && (
              <>
                <p className={styles.modalText}>
                  It stays listed but can’t be opened or used (no new tournaments) until the time is up, then it turns back on automatically.
                </p>
                <div className={styles.chips}>
                  {DURATIONS.map(d => (
                    <button key={d.ms} type="button"
                      className={`${styles.chip} ${durMs === d.ms ? styles.chipOn : ''}`}
                      onClick={() => { setDurMs(d.ms); setCustom('') }}>{d.label}</button>
                  ))}
                </div>
                <label className={styles.label}>Or pick an exact end time</label>
                <input type="datetime-local" className={styles.input} value={customUntil}
                  onChange={e => setCustomUntil(e.target.value)} />
                <label className={styles.label}>Message for players (optional)</label>
                <input className={styles.input} maxLength={200} value={note}
                  placeholder="e.g. Server maintenance" onChange={e => setNote(e.target.value)} />
              </>
            )}

            {modal.type === 'delete' && (
              <>
                <p className={styles.modalText}>
                  This is permanent. The game is removed from the whole website and its subscriptions are wiped.
                  It <b>cannot be restored</b> from the dashboard. Existing tournaments and match history are kept.
                </p>
                <label className={styles.label}>Type <b>{modalGame.name}</b> to confirm</label>
                <input className={styles.input} value={confirmText} placeholder={modalGame.name}
                  onChange={e => setConfirmText(e.target.value)} />
              </>
            )}

            {error && <div className={styles.errorBox}><i className="ri-error-warning-line" /> {error}</div>}

            <div className={styles.modalActions}>
              <button className={styles.btn} disabled={busy} onClick={() => setModal(null)}>Cancel</button>
              {modal.type === 'hide' && (
                <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}
                  onClick={() => run({ slug: modal.slug, action: 'hide' }, `${modalGame.name} hidden`)}>
                  {busy ? 'Hiding…' : 'Hide game'}
                </button>
              )}
              {modal.type === 'disable' && (
                <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={submitDisable}>
                  {busy ? 'Saving…' : 'Disable'}
                </button>
              )}
              {modal.type === 'delete' && (
                <button className={`${styles.btn} ${styles.btnDangerSolid}`}
                  disabled={busy || confirmText.trim().toLowerCase() !== modalGame.name.toLowerCase()}
                  onClick={() => run({ slug: modal.slug, action: 'delete' }, `${modalGame.name} deleted`)}>
                  {busy ? 'Deleting…' : 'Delete forever'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
