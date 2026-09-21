'use client'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import styles from './AdminLogins.module.css'

const PAGE = 50

// email-only / google-only / both / anything else (phone, github, …)
function methodOf(providers) {
  const e = providers.includes('email')
  const g = providers.includes('google')
  if (e && g) return 'both'
  if (g && providers.length === 1) return 'google'
  if (e && providers.length === 1) return 'email'
  if (g) return 'google'
  if (e) return 'email'
  return 'other'
}

function ago(iso) {
  if (!iso) return 'Never'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' })
}

function ProviderPill({ p }) {
  if (p === 'google') return <span className={`${styles.pill} ${styles.pillGoogle}`}><i className="ri-google-fill" /> Google</span>
  if (p === 'email')  return <span className={`${styles.pill} ${styles.pillEmail}`}><i className="ri-mail-line" /> Email</span>
  return <span className={styles.pill}>{p.charAt(0).toUpperCase() + p.slice(1)}</span>
}

export default function AdminLogins() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')
  const [limit, setLimit]     = useState(PAGE)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/login-methods', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load login methods')

      // Attach usernames/avatars (profiles are readable by the app)
      const profiles = {}
      let from = 0
      while (true) {
        const { data } = await supabase.from('profiles').select('id,username,avatar_url')
          .order('id').range(from, from + 999)
        if (!data) break
        data.forEach(p => { profiles[p.id] = p })
        if (data.length < 1000) break
        from += 1000
      }

      const list = (json.users || []).map(u => ({
        ...u,
        method: methodOf(u.providers),
        username: profiles[u.id]?.username || null,
        avatar_url: profiles[u.id]?.avatar_url || null,
      })).sort((a, b) => new Date(b.last_sign_in_at || 0) - new Date(a.last_sign_in_at || 0))
      setRows(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const counts = useMemo(() => {
    const c = { all: rows.length, email: 0, google: 0, both: 0, other: 0 }
    rows.forEach(r => { c[r.method]++ })
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter !== 'all' && r.method !== filter) return false
      if (!q) return true
      return (r.username || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q)
    })
  }, [rows, filter, search])

  const pct = n => counts.all ? Math.round((n / counts.all) * 100) : 0
  const shown = filtered.slice(0, limit)

  const CARDS = [
    { id: 'all',    label: 'All users',    icon: 'ri-group-line' },
    { id: 'email',  label: 'Email only',   icon: 'ri-mail-line' },
    { id: 'google', label: 'Google only',  icon: 'ri-google-fill' },
    { id: 'both',   label: 'Email + Google', icon: 'ri-links-line' },
  ]

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h2 className={styles.title}>Login methods</h2>
        <button className={styles.refresh} onClick={load} disabled={loading}>
          <i className={loading ? 'ri-loader-4-line' : 'ri-refresh-line'} /> Refresh
        </button>
      </div>

      {error && <div className={styles.error}><i className="ri-error-warning-line" /> {error}</div>}

      {loading && !rows.length ? (
        <div className={styles.loading}>Loading…</div>
      ) : (
        <>
          <div className={styles.cards}>
            {CARDS.map(c => (
              <button key={c.id} type="button"
                className={`${styles.card} ${filter === c.id ? styles.cardOn : ''}`}
                onClick={() => { setFilter(c.id); setLimit(PAGE) }}>
                <span className={styles.cardTop}><i className={c.icon} />{c.id !== 'all' && <em>{pct(counts[c.id])}%</em>}</span>
                <span className={styles.cardVal}>{counts[c.id]}</span>
                <span className={styles.cardLabel}>{c.label}</span>
              </button>
            ))}
          </div>

          {counts.all > 0 && (
            <div className={styles.bar} aria-hidden>
              <span style={{ width: `${pct(counts.email)}%`,  background: '#3b82f6' }} />
              <span style={{ width: `${pct(counts.google)}%`, background: '#ea4335' }} />
              <span style={{ width: `${pct(counts.both)}%`,   background: '#8b5cf6' }} />
              <span style={{ width: `${pct(counts.other)}%`,  background: 'var(--border-dark)' }} />
            </div>
          )}

          <input className={styles.search} placeholder="Search username or email…" value={search}
            onChange={e => { setSearch(e.target.value); setLimit(PAGE) }} />

          <div className={styles.list}>
            {shown.map(r => (
              <div key={r.id} className={styles.row}>
                <div className={styles.avatar}>
                  {r.avatar_url ? <img src={r.avatar_url} alt="" /> : <span>{(r.username || r.email || '?')[0].toUpperCase()}</span>}
                </div>
                <div className={styles.who}>
                  <div className={styles.name}>{r.username || 'No username'}</div>
                  <div className={styles.email}>{r.email || '—'}</div>
                  <div className={styles.pills}>
                    {r.providers.length ? r.providers.map(p => <ProviderPill key={p} p={p} />) : <span className={styles.pill}>Unknown</span>}
                  </div>
                </div>
                <div className={styles.when}>
                  <span>{ago(r.last_sign_in_at)}</span>
                  <small>last login</small>
                </div>
              </div>
            ))}
            {!shown.length && <div className={styles.empty}>No users match.</div>}
          </div>

          {filtered.length > shown.length && (
            <button className={styles.more} onClick={() => setLimit(l => l + PAGE)}>
              Show more ({filtered.length - shown.length} left)
            </button>
          )}
        </>
      )}
    </div>
  )
}
