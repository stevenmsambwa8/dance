'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'

const FLAG_OPTIONS = [
  { value: 'kenya',    label: 'Kenya' },
  { value: 'tanzania', label: 'Tanzania' },
  { value: 'uganda',   label: 'Uganda' },
]

const STORAGE_KEY = 'arena_saved_accounts'

function getSavedAccounts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
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

export default function Login() {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const router = useRouter()
  const passwordRef = useRef(null)
  usePageLoading(false)  // login page is always ready immediately

  const [tab, setTab]                     = useState('login')
  const [savedAccounts, setSavedAccounts] = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [showManual, setShowManual]       = useState(false)
  const [username, setUsername]           = useState('')
  const [email, setEmail]                 = useState('')
  const [password, setPassword]           = useState('')
  const [countryFlag, setCountryFlag]     = useState('')
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [success, setSuccess]             = useState('')

  // Find tab
  const [findQuery, setFindQuery]   = useState('')
  const [findLoading, setFindLoading] = useState(false)
  const [findResult, setFindResult] = useState(null)
  const [findError, setFindError]   = useState('')

  useEffect(() => {
    const accounts = getSavedAccounts()
    setSavedAccounts(accounts)
    if (accounts.length === 0) setShowManual(true)
  }, [])

  function pickAccount(acc) {
    setSelectedAccount(acc)
    setEmail(acc.email)
    setPassword('')
    setError('')
    setTab('login')
    setTimeout(() => passwordRef.current?.focus(), 100)
  }

  function clearSelection() {
    setSelectedAccount(null)
    setEmail('')
    setPassword('')
    setError('')
  }

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
    setFindLoading(true)
    setFindError('')
    setFindResult(null)
    try {
      const q = findQuery.trim()
      const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url, email')
        .or(`username.ilike.${q},email.ilike.${q}`)
        .limit(1)
        .single()
      if (error || !data) {
        setFindError('No account found. Try a different username or email.')
      } else {
        setFindResult({
          email: data.email,
          username: data.username,
          avatar_url: data.avatar_url || null,
          initial: data.username?.[0]?.toUpperCase() || '?',
        })
      }
    } catch {
      setFindError('No account found.')
    } finally {
      setFindLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tab === 'login') {
        await signIn(email, password)
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('profiles').select('username, avatar_url').eq('id', user.id).single()
          saveAccount({
            email,
            username: profile?.username || email.split('@')[0],
            avatar_url: profile?.avatar_url || null,
            initial: (profile?.username || email)[0].toUpperCase(),
          })
        }
        router.push('/')
      } else {
        if (!username.trim()) { setError('Username is required'); setLoading(false); return }
        await signUp(email, password, username.trim(), countryFlag || null)
        setSuccess('Account created!. Click login button')
        setTab('login')
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError('')
    try { await signInWithGoogle() }
    catch (err) { setError(err.message) }
  }

  function switchTab(t) {
    setTab(t); setError(''); setSuccess('')
    setFindQuery(''); setFindResult(null); setFindError('')
    if (t === 'login') {
      const accounts = getSavedAccounts()
      setSavedAccounts(accounts)
      setShowManual(accounts.length === 0)
      setSelectedAccount(null)
    } else {
      setShowManual(true)
    }
  }

  const hasSaved = savedAccounts.length > 0

  return (
    <div className={styles.page}>
      <div className={styles.card}>

        {/* ── Fixed header ── */}
        <div className={styles.cardHead}>
          <div className={styles.logoWrap}>
            <img src="/logo.png"       alt="Arena" className={`${styles.logoImg} ${styles.logoLight}`} />
            <img src="/logo-black.png" alt="Arena" className={`${styles.logoImg} ${styles.logoDark}`} />
          </div>
          <div className={styles.tabs}>
            <button className={tab === 'login' ? styles.activeTab : styles.inactiveTab}
              onClick={() => switchTab('login')} type="button">Log In</button>
            <button className={tab === 'signup' ? styles.activeTab : styles.inactiveTab}
              onClick={() => switchTab('signup')} type="button">Sign Up</button>
            <button className={tab === 'find' ? styles.activeTab : styles.inactiveTab}
              onClick={() => switchTab('find')} type="button">Find</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={styles.cardBody}>

          {error   && <p className={styles.msgError}>{error}</p>}
          {success && <p className={styles.msgSuccess}>{success}</p>}

          {/* ═══ LOGIN TAB ═══ */}
          {tab === 'login' && (<>

            {/* Saved accounts */}
            {hasSaved && !selectedAccount && (
              <div className={styles.savedSection}>
                <p className={styles.savedLabel}>Choose an account</p>
                <div className={styles.savedList}>
                  {savedAccounts.map(acc => (
                    <button key={acc.email} className={styles.savedRow}
                      onClick={() => pickAccount(acc)} type="button">
                      <div className={styles.savedAvatar}>
                        {acc.avatar_url ? <img src={acc.avatar_url} alt="" /> : <span>{acc.initial}</span>}
                      </div>
                      <span className={styles.savedUsername}>{acc.username}</span>
                      <button className={styles.savedRemove}
                        onClick={e => handleRemoveAccount(e, acc.email)}
                        type="button" title="Remove">
                        <i className="ri-close-line" />
                      </button>
                    </button>
                  ))}
                </div>
                {!showManual && (
                  <button className={styles.useAnotherBtn}
                    onClick={() => setShowManual(true)} type="button">
                    <i className="ri-add-line" /> Use another account
                  </button>
                )}
              </div>
            )}

            {/* Selected account hero */}
            {selectedAccount && (
              <div className={styles.selectedWrap}>
                <div className={styles.selectedAvatar}>
                  {selectedAccount.avatar_url
                    ? <img src={selectedAccount.avatar_url} alt="" />
                    : <span>{selectedAccount.initial}</span>}
                </div>
                <p className={styles.selectedName}>{selectedAccount.username}</p>
                <button className={styles.switchAccountBtn} onClick={clearSelection} type="button">
                  <i className="ri-arrow-left-line" /> Switch account
                </button>
              </div>
            )}

            <form className={styles.form} onSubmit={handleSubmit}>
              {(showManual && !selectedAccount) && (
                <div className={styles.field}>
                  <label>Email</label>
                  <div className={styles.inputWrap}>
                    <i className="ri-mail-line" />
                    <input type="text" placeholder="you@email.com"
                      value={email} onChange={e => setEmail(e.target.value)} required />
                  </div>
                </div>
              )}
              <div className={styles.field}>
                <label>Password</label>
                <div className={styles.inputWrap}>
                  <i className="ri-lock-line" />
                  <input ref={passwordRef} type="password" placeholder="••••••••"
                    value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                </div>
              </div>
              <div className={styles.ctaGroup}>
                <button type="submit" className={styles.submit} disabled={loading}>
                  {loading ? 'Please wait…' : 'Log In'}
                  {!loading && <i className="ri-arrow-right-line" />}
                </button>
                <div className={styles.divider}><span>or</span></div>
                <button className={styles.googleBtn} onClick={handleGoogle} type="button">
                  <i className="ri-google-fill" /> Continue with Google
                </button>
              </div>
            </form>
          </>)}

          {/* ═══ SIGNUP TAB ═══ */}
          {tab === 'signup' && (
            <form className={styles.form} onSubmit={handleSubmit}>
              <p className={styles.sub}>Create your account</p>
              <div className={styles.field}>
                <label>Username</label>
                <div className={styles.inputWrap}>
                  <i className="ri-user-line" />
                  <input type="text" placeholder="PLAYER_01" value={username} onChange={e => setUsername(e.target.value)} />
                </div>
              </div>
              <div className={styles.field}>
                <label>Country</label>
                <div className={styles.flagPicker}>
                  {FLAG_OPTIONS.map(f => (
                    <button key={f.value} type="button"
                      className={`${styles.flagBtn} ${countryFlag === f.value ? styles.flagBtnActive : ''}`}
                      onClick={() => setCountryFlag(prev => prev === f.value ? '' : f.value)}>
                      <img src={`/${f.value}.png`} alt={f.label} />
                      <span>{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.field}>
                <label>Email</label>
                <div className={styles.inputWrap}>
                  <i className="ri-mail-line" />
                  <input type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
              </div>
              <div className={styles.field}>
                <label>Password</label>
                <div className={styles.inputWrap}>
                  <i className="ri-lock-line" />
                  <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                </div>
              </div>
              <div className={styles.ctaGroup}>
                <button type="submit" className={styles.submit} disabled={loading}>
                  {loading ? 'Please wait…' : 'Create Account'}
                  {!loading && <i className="ri-arrow-right-line" />}
                </button>
                <div className={styles.divider}><span>or</span></div>
                <button className={styles.googleBtn} onClick={handleGoogle} type="button">
                  <i className="ri-google-fill" /> Continue with Google
                </button>
              </div>
            </form>
          )}

          {/* ═══ FIND TAB ═══ */}
          {tab === 'find' && (
            <div className={styles.findTab}>
              <p className={styles.sub}>Search by username or email</p>

              <form className={styles.form} onSubmit={handleFindAccount}>
                <div className={styles.field}>
                  <label>Username or Email</label>
                  <div className={styles.inputWrap}>
                    <i className="ri-search-line" />
                    <input
                      type="text"
                      placeholder="PLAYER_01 or you@email.com"
                      value={findQuery}
                      onChange={e => { setFindQuery(e.target.value); setFindResult(null); setFindError('') }}
                      autoFocus
                    />
                  </div>
                </div>
                <button type="submit" className={styles.submit} disabled={findLoading || !findQuery.trim()}>
                  {findLoading ? 'Searching…' : 'Find Account'}
                  {!findLoading && <i className="ri-search-line" />}
                </button>
              </form>

              {findError && <p className={styles.msgError}>{findError}</p>}

              {findResult && (
                <div className={styles.findResultWrap}>
                  <p className={styles.savedLabel}>Account found</p>
                  <button className={styles.savedRow} onClick={() => pickAccount(findResult)} type="button">
                    <div className={styles.savedAvatar}>
                      {findResult.avatar_url
                        ? <img src={findResult.avatar_url} alt="" />
                        : <span>{findResult.initial}</span>}
                    </div>
                    <span className={styles.savedUsername}>{findResult.username}</span>
                    <i className="ri-login-box-line" style={{ color: 'var(--text-muted)', fontSize: 16, marginLeft: 'auto' }} />
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
