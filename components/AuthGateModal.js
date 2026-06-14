'use client'
import { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'

/* ── Context — any component can call openAuthGate() ── */
const AuthGateContext = createContext({ openAuthGate: () => {}, closeAuthGate: () => {} })
export const useAuthGate = () => useContext(AuthGateContext)

const FLAG_OPTIONS = [
  { value: 'kenya',        label: 'Kenya' },
  { value: 'tanzania',     label: 'Tanzania' },
  { value: 'uganda',       label: 'Uganda' },
  { value: 'south-africa', label: 'South Africa' },
  { value: 'nigeria',      label: 'Nigeria' },
]

const STORAGE_KEY = 'arena_saved_accounts'
function getSavedAccounts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveAccount(account) {
  try {
    const existing = getSavedAccounts().filter(a => a.email !== account.email)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([account, ...existing].slice(0, 5)))
  } catch {}
}
function removeAccount(email) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getSavedAccounts().filter(a => a.email !== email)))
  } catch {}
}

/* ── Modal UI ── */
function AuthGateModal({ isOpen, onClose }) {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const passwordRef = useRef(null)

  const [tab, setTab]                         = useState('login')
  const [savedAccounts, setSavedAccounts]     = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [showManual, setShowManual]           = useState(false)
  const [username, setUsername]               = useState('')
  const [email, setEmail]                     = useState('')
  const [password, setPassword]               = useState('')
  const [countryFlag, setCountryFlag]         = useState('')
  const [error, setError]                     = useState('')
  const [loading, setLoading]                 = useState(false)
  const [success, setSuccess]                 = useState('')

  const [findQuery, setFindQuery]     = useState('')
  const [findLoading, setFindLoading] = useState(false)
  const [findResult, setFindResult]   = useState(null)
  const [findError, setFindError]     = useState('')

  // Reset + seed saved accounts every time modal opens
  useEffect(() => {
    if (!isOpen) return
    const accounts = getSavedAccounts()
    setSavedAccounts(accounts)
    setShowManual(accounts.length === 0)
    setTab('login')
    setError(''); setSuccess('')
    setUsername(''); setEmail(''); setPassword(''); setCountryFlag('')
    setSelectedAccount(null)
    setFindQuery(''); setFindResult(null); setFindError('')
  }, [isOpen])

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  function pickAccount(acc) {
    setSelectedAccount(acc); setEmail(acc.email); setPassword(''); setError(''); setTab('login')
    setTimeout(() => passwordRef.current?.focus(), 100)
  }
  function clearSelection() { setSelectedAccount(null); setEmail(''); setPassword(''); setError('') }

  function handleRemoveAccount(e, emailAddr) {
    e.stopPropagation()
    removeAccount(emailAddr)
    const updated = getSavedAccounts()
    setSavedAccounts(updated)
    if (selectedAccount?.email === emailAddr) clearSelection()
    if (updated.length === 0) setShowManual(true)
  }

  async function handleFindAccount(e) {
    e.preventDefault()
    if (!findQuery.trim()) return
    setFindLoading(true); setFindError(''); setFindResult(null)
    try {
      const { data, error } = await supabase
        .from('profiles').select('username, avatar_url, email')
        .or(`username.ilike.${findQuery.trim()},email.ilike.${findQuery.trim()}`)
        .limit(1).single()
      if (error || !data) { setFindError('No account found. Try a different username or email.') }
      else { setFindResult({ email: data.email, username: data.username, avatar_url: data.avatar_url || null, initial: data.username?.[0]?.toUpperCase() || '?' }) }
    } catch { setFindError('No account found.') }
    finally { setFindLoading(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      if (tab === 'login') {
        await signIn(email, password)
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: prof } = await supabase.from('profiles').select('username, avatar_url').eq('id', user.id).single()
          saveAccount({ email, username: prof?.username || email.split('@')[0], avatar_url: prof?.avatar_url || null, initial: (prof?.username || email)[0].toUpperCase() })
        }
        onClose() // ← stay on same page
      } else {
        if (!username.trim()) { setError('Username is required'); setLoading(false); return }
        await signUp(email, password, username.trim(), countryFlag || null)
        setSuccess('Account created! Now log in below.')
        setTab('login'); setPassword(''); setUsername('')
      }
    } catch (err) { setError(err.message || 'Something went wrong') }
    finally { setLoading(false) }
  }

  async function handleGoogle() {
    setError('')
    try { await signInWithGoogle() } catch (err) { setError(err.message) }
  }

  function switchTab(t) {
    setTab(t); setError(''); setSuccess('')
    setFindQuery(''); setFindResult(null); setFindError('')
    if (t === 'login') {
      const accounts = getSavedAccounts(); setSavedAccounts(accounts)
      setShowManual(accounts.length === 0); setSelectedAccount(null)
    } else { setShowManual(true) }
  }

  const hasSaved = savedAccounts.length > 0
  if (!isOpen) return null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, animation: 'agFadeIn 0.18s ease',
      }}
    >
      <style>{`
        @keyframes agFadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes agSlideUp { from { opacity:0; transform:translateY(20px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        .ag-logo-dark  { display:none }
        .ag-logo-light { display:block }
        [data-theme="dark"]   .ag-logo-light,
        [data-theme="neon"]   .ag-logo-light,
        [data-theme="sunset"] .ag-logo-light,
        [data-theme="forest"] .ag-logo-light,
        [data-theme="gold"]   .ag-logo-light,
        [data-theme="ocean"]  .ag-logo-light { display:none }
        [data-theme="dark"]   .ag-logo-dark,
        [data-theme="neon"]   .ag-logo-dark,
        [data-theme="sunset"] .ag-logo-dark,
        [data-theme="forest"] .ag-logo-dark,
        [data-theme="gold"]   .ag-logo-dark,
        [data-theme="ocean"]  .ag-logo-dark  { display:block }
        [data-theme="snow"]   .ag-logo-light { display:block }
        [data-theme="snow"]   .ag-logo-dark  { display:none }
        .ag-input { flex:1; min-width:0; border:none; background:none; outline:none; font-family:var(--font); font-size:13px; color:var(--text) }
        .ag-input::placeholder { color:var(--text-muted) }
        .ag-saved-row:hover { border-color:var(--border-dark) !important; background:var(--surface) !important }
        .ag-google-btn:hover { background:var(--surface) !important }
        .ag-close-btn:hover { color:var(--text) !important; border-color:var(--border-dark) !important }
        .ag-another-btn:hover { color:var(--text) !important; border-color:var(--text) !important }
        .ag-flag-btn:hover { border-color:var(--text) !important; color:var(--text) !important }
      `}</style>

      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border-dark)', borderRadius: 14,
        width: '100%', maxWidth: 400, maxHeight: 'calc(100dvh - 32px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
        animation: 'agSlideUp 0.22s cubic-bezier(0.22,1,0.36,1)', position: 'relative',
      }}>

        {/* Close btn */}
        <button className="ag-close-btn" onClick={onClose} style={{
          position: 'absolute', top: 12, right: 12, zIndex: 1,
          width: 30, height: 30, borderRadius: '50%',
          border: '1px solid var(--border)', background: 'var(--bg-2)',
          color: 'var(--text-muted)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, transition: 'all 0.15s',
        }}>
          <i className="ri-close-line" />
        </button>

        {/* Header */}
        <div style={{ flexShrink: 0, padding: '20px 20px 0', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
            <img src="/logo.png"       alt="Nabogaming" className="ag-logo-light" style={{ height: 34, width: 'auto', objectFit: 'contain' }} />
            <img src="/logo-black.png" alt="Nabogaming" className="ag-logo-dark"  style={{ height: 34, width: 'auto', objectFit: 'contain' }} />
          </div>
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Sign in to continue
          </p>

          {/* Tabs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid var(--border)' }}>
            {[['login','Log In'],['signup','Sign Up'],['find','Find']].map(([t, label]) => (
              <button key={t} onClick={() => switchTab(t)} style={{
                padding: '10px 8px', background: 'none', border: 'none',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', position: 'relative',
                transition: 'color 0.15s', color: tab === t ? 'var(--text)' : 'var(--text-muted)',
                fontFamily: 'var(--font)',
              }}>
                {label}
                {tab === t && <span style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'var(--text)', borderRadius: '2px 2px 0 0' }} />}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12, scrollbarWidth: 'none' }}>

          {error   && <p style={{ fontSize: 12, color: 'var(--accent)', textAlign: 'center', margin: 0 }}>{error}</p>}
          {success && <p style={{ fontSize: 12, color: '#22c55e', textAlign: 'center', margin: 0 }}>{success}</p>}

          {/* ── LOGIN ── */}
          {tab === 'login' && (<>
            {hasSaved && !selectedAccount && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={s.label}>Choose an account</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {savedAccounts.map(acc => (
                    <button key={acc.email} className="ag-saved-row" onClick={() => pickAccount(acc)} style={s.savedRow}>
                      <AvatarBubble acc={acc} size={36} radius={8} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.username}</span>
                      <button onClick={e => handleRemoveAccount(e, acc.email)} style={{ width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>
                        <i className="ri-close-line" />
                      </button>
                    </button>
                  ))}
                </div>
                {!showManual && (
                  <button className="ag-another-btn" onClick={() => setShowManual(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 9, border: '1px dashed var(--border-dark)', borderRadius: 8, background: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'var(--font)', transition: 'all 0.15s' }}>
                    <i className="ri-add-line" /> Use another account
                  </button>
                )}
              </div>
            )}

            {selectedAccount && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0 4px' }}>
                <AvatarBubble acc={selectedAccount} size={56} radius={14} fontSize={22} />
                <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: '4px 0 0' }}>{selectedAccount.username}</p>
                <button onClick={clearSelection} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                  <i className="ri-arrow-left-line" /> Switch account
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} style={s.form}>
              {(showManual && !selectedAccount) && (
                <Field label="Email"><InputWrap icon="ri-mail-line"><input type="text" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} required className="ag-input" /></InputWrap></Field>
              )}
              <Field label="Password"><InputWrap icon="ri-lock-line"><input ref={passwordRef} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className="ag-input" /></InputWrap></Field>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                <button type="submit" disabled={loading} style={s.submit(loading)}>{loading ? 'Please wait…' : 'Log In'}{!loading && <i className="ri-arrow-right-line" style={{ fontSize: 15 }} />}</button>
                <Divider />
                <button type="button" className="ag-google-btn" onClick={handleGoogle} style={s.googleBtn}><i className="ri-google-fill" style={{ fontSize: 16 }} /> Continue with Google</button>
              </div>
            </form>
          </>)}

          {/* ── SIGNUP ── */}
          {tab === 'signup' && (
            <form onSubmit={handleSubmit} style={s.form}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>Create your account</p>
              <Field label="Username"><InputWrap icon="ri-user-line"><input type="text" placeholder="PLAYER_01" value={username} onChange={e => setUsername(e.target.value)} className="ag-input" /></InputWrap></Field>
              <Field label="Country">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {FLAG_OPTIONS.map(f => (
                    <button key={f.value} type="button" className="ag-flag-btn" onClick={() => setCountryFlag(prev => prev === f.value ? '' : f.value)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '8px 6px', border: `1px solid ${countryFlag === f.value ? 'var(--text)' : 'var(--border-dark)'}`, borderRadius: 6, background: countryFlag === f.value ? 'var(--surface)' : 'var(--bg-2)', color: countryFlag === f.value ? 'var(--text)' : 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font)' }}>
                      <img src={`/${f.value}.png`} alt={f.label} style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      <span>{f.label}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Email"><InputWrap icon="ri-mail-line"><input type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} required className="ag-input" /></InputWrap></Field>
              <Field label="Password"><InputWrap icon="ri-lock-line"><input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className="ag-input" /></InputWrap></Field>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                <button type="submit" disabled={loading} style={s.submit(loading)}>{loading ? 'Please wait…' : 'Create Account'}{!loading && <i className="ri-arrow-right-line" style={{ fontSize: 15 }} />}</button>
                <Divider />
                <button type="button" className="ag-google-btn" onClick={handleGoogle} style={s.googleBtn}><i className="ri-google-fill" style={{ fontSize: 16 }} /> Continue with Google</button>
              </div>
            </form>
          )}

          {/* ── FIND ── */}
          {tab === 'find' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>Search by username or email</p>
              <form onSubmit={handleFindAccount} style={s.form}>
                <Field label="Username or Email">
                  <InputWrap icon="ri-search-line">
                    <input type="text" placeholder="PLAYER_01 or you@email.com" value={findQuery} onChange={e => { setFindQuery(e.target.value); setFindResult(null); setFindError('') }} autoFocus className="ag-input" />
                  </InputWrap>
                </Field>
                <button type="submit" disabled={findLoading || !findQuery.trim()} style={s.submit(findLoading || !findQuery.trim())}>{findLoading ? 'Searching…' : 'Find Account'}{!findLoading && <i className="ri-search-line" style={{ fontSize: 15 }} />}</button>
              </form>
              {findError && <p style={{ fontSize: 12, color: 'var(--accent)', textAlign: 'center', margin: 0 }}>{findError}</p>}
              {findResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={s.label}>Account found</p>
                  <button className="ag-saved-row" onClick={() => pickAccount(findResult)} style={s.savedRow}>
                    <AvatarBubble acc={findResult} size={36} radius={8} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1, textAlign: 'left' }}>{findResult.username}</span>
                    <i className="ri-login-box-line" style={{ color: 'var(--text-muted)', fontSize: 16 }} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ── */
function AvatarBubble({ acc, size = 36, radius = 8, fontSize = 14 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize, fontWeight: 800, overflow: 'hidden', color: 'var(--text)' }}>
      {acc.avatar_url ? <img src={acc.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span>{acc.initial}</span>}
    </div>
  )
}
function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{label}</label>
      {children}
    </div>
  )
}
function InputWrap({ icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border-dark)', borderRadius: 6, padding: '10px 12px', background: 'var(--bg-2)', width: '100%', boxSizing: 'border-box' }}>
      <i className={icon} style={{ fontSize: 14, color: 'var(--text-muted)', flexShrink: 0 }} />
      {children}
    </div>
  )
}
function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 11, fontWeight: 500, letterSpacing: '0.06em' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} /><span>or</span><span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

/* ── Shared styles ── */
const s = {
  label:     { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', margin: 0 },
  form:      { display: 'flex', flexDirection: 'column', gap: 10 },
  savedRow:  { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left', width: '100%', fontFamily: 'var(--font)' },
  submit:    (disabled) => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', transition: 'opacity 0.1s', cursor: disabled ? 'not-allowed' : 'pointer', width: '100%', opacity: disabled ? 0.5 : 1, fontFamily: 'var(--font)' }),
  googleBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12, border: '1px solid var(--border-dark)', background: 'none', color: 'var(--text)', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', width: '100%', fontFamily: 'var(--font)', transition: 'background 0.1s' },
}

/* ── Provider — wrap in layout.js ── */
export function AuthGateProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)
  const openAuthGate  = useCallback(() => setIsOpen(true),  [])
  const closeAuthGate = useCallback(() => setIsOpen(false), [])

  return (
    <AuthGateContext.Provider value={{ openAuthGate, closeAuthGate }}>
      {children}
      <AuthGateModal isOpen={isOpen} onClose={closeAuthGate} />
    </AuthGateContext.Provider>
  )
}
