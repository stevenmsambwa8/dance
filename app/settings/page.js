'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import usePageLoading from '../../components/usePageLoading'
import { useCurrency } from '../../lib/useCurrency'
import { RANK_META } from '../../lib/constants'
import styles from './page.module.css'

const PLAY_STYLES  = ['Aggressive', 'Defensive', 'Support', 'Sniper', 'All-Round']
const FLAG_OPTIONS = [
  { value: 'kenya',    label: 'Kenya',    code: '254', flag: '/kenya.png'    },
  { value: 'tanzania', label: 'Tanzania', code: '255', flag: '/tanzania.png' },
  { value: 'uganda',   label: 'Uganda',   code: '256', flag: '/uganda.png'   },
]
const GAME_SLUGS_LIST = ['pubgm','freefire','codm','bussid','efootball','dls']
const GAME_NAMES_MAP  = { pubgm:'PUBGM', freefire:'Free Fire', codm:'Call of Duty', bussid:'Maleo BUSSID', efootball:'eFootball', dls:'DLS26' }

function Section({ icon, title, children }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <i className={icon} />
        <span>{title}</span>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  )
}

function SettingRow({ label, sub, children }) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingLabel}>
        <span>{label}</span>
        {sub && <span className={styles.settingSub}>{sub}</span>}
      </div>
      <div className={styles.settingControl}>{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { user, profile, updateProfile, uploadAvatar, signOut, isAdmin } = useAuth()
  const { fmtAmt, currency } = useCurrency(profile?.country_flag ?? null)

  const [loading,      setLoading]      = useState(!profile)
  usePageLoading(loading)

  // ── Profile fields ──
  const [username,    setUsername]    = useState('')
  const [bio,         setBio]         = useState('')
  const [playStyle,   setPlayStyle]   = useState('Aggressive')
  const [gameTags,    setGameTags]    = useState([])
  const [countryFlag, setCountryFlag] = useState('')
  const [phoneCode,   setPhoneCode]   = useState('255')
  const [phoneLocal,  setPhoneLocal]  = useState('')

  // ── UI state ──
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [saveError,   setSaveError]   = useState('')
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [phoneError,  setPhoneError]  = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const fileRef = useRef()

  // ── Password change ──
  const [pwCurrent,   setPwCurrent]   = useState('')
  const [pwNew,       setPwNew]       = useState('')
  const [pwConfirm,   setPwConfirm]   = useState('')
  const [pwSaving,    setPwSaving]    = useState(false)
  const [pwMsg,       setPwMsg]       = useState('')

  // ── Notification prefs (stored in profile) ──
  const [notifMatch,  setNotifMatch]  = useState(true)
  const [notifShop,   setNotifShop]   = useState(true)
  const [notifTournament, setNotifTournament] = useState(true)

  // Prefill from profile
  useEffect(() => {
    if (!profile) return
    setUsername(profile.username || '')
    setBio(profile.bio || '')
    setPlayStyle(profile.play_style || 'Aggressive')
    setGameTags(profile.game_tags || [])
    setCountryFlag(profile.country_flag || '')
    setNotifMatch(profile.notif_match     !== false)
    setNotifShop(profile.notif_shop       !== false)
    setNotifTournament(profile.notif_tournament !== false)
    if (profile.phone) {
      const stripped = profile.phone.replace(/^\+/, '')
      const matched  = ['254','255','256'].find(c => stripped.startsWith(c))
      if (matched) { setPhoneCode(matched); setPhoneLocal(stripped.slice(matched.length)) }
      else setPhoneLocal(stripped)
    }
    setLoading(false)
  }, [profile])

  if (!user) {
    return (
      <div className={styles.page}>
        <div className={styles.guestMsg}>
          <i className="ri-lock-line" />
          <p>Please <a href="/login">log in</a> to access settings.</p>
        </div>
      </div>
    )
  }

  const tierMeta  = RANK_META[profile?.tier] || RANK_META.Gold
  const isPartner = profile?.tier === 'Partner'

  async function saveProfile() {
    if (phoneLocal.trim() && phoneLocal.trim().length < 6) {
      setPhoneError('Enter a valid phone number.')
      return
    }
    setPhoneError('')
    const fullPhone = phoneLocal.trim()
      ? `+${phoneCode}${phoneLocal.trim().replace(/^0/, '')}`
      : null
    setSaving(true); setSaveError(''); setSaved(false)
    try {
      await updateProfile({
        username,
        bio,
        play_style:      playStyle,
        game_tags:       gameTags,
        country_flag:    countryFlag || null,
        phone:           fullPhone,
        notif_match:     notifMatch,
        notif_shop:      notifShop,
        notif_tournament: notifTournament,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch(e) { setSaveError(e.message) }
    finally    { setSaving(false) }
  }

  async function changePassword() {
    if (!pwNew || pwNew !== pwConfirm) { setPwMsg('Passwords do not match.'); return }
    if (pwNew.length < 6)              { setPwMsg('Password must be at least 6 characters.'); return }
    setPwSaving(true); setPwMsg('')
    const { error } = await supabase.auth.updateUser({ password: pwNew })
    if (error) setPwMsg(error.message)
    else { setPwMsg('Password updated successfully.'); setPwCurrent(''); setPwNew(''); setPwConfirm('') }
    setPwSaving(false)
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarLoading(true)
    try { await uploadAvatar(file) }
    catch(e) { alert('Upload failed: ' + e.message) }
    finally   { setAvatarLoading(false) }
  }

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  function toggleGameTag(g) {
    setGameTags(t => t.includes(g) ? t.filter(x => x !== g) : [...t, g])
  }

  const initials = (profile?.username || 'P').slice(0,2).toUpperCase()

  return (
    <div className={styles.page}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <i className="ri-arrow-left-line" />
        </button>
        <h1 className={styles.title}>Settings</h1>
        <button
          className={`${styles.saveBtn} ${saved ? styles.saveBtnDone : ''}`}
          onClick={saveProfile}
          disabled={saving}
        >
          {saving ? <i className="ri-loader-4-line" /> : saved ? <><i className="ri-check-line" /> Saved</> : 'Save'}
        </button>
      </div>

      {saveError && <div className={styles.errorBanner}><i className="ri-error-warning-line" /> {saveError}</div>}

      {/* ── Avatar ── */}
      <div className={styles.avatarSection}>
        <div
          className={styles.avatarWrap}
          data-tier={profile?.tier || 'Gold'}
          onClick={() => fileRef.current?.click()}
        >
          {avatarLoading ? (
            <div className={styles.avatarInner}><i className="ri-loader-4-line" /></div>
          ) : profile?.avatar_url ? (
            <img src={profile.avatar_url} className={styles.avatarImg} alt="" />
          ) : (
            <div className={styles.avatarInner}>{initials}</div>
          )}
          <div className={styles.avatarCamera}><i className="ri-camera-line" /></div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleAvatarChange} />
        </div>
        <div className={styles.avatarMeta}>
          <div className={styles.avatarName}>{profile?.username}</div>
          <div className={styles.avatarTierRow}>
            {isPartner ? (
              <span className={styles.partnerChip}><i className="ri-shield-star-fill" /> PARTNER</span>
            ) : (
              <span className={styles.tierBadge} style={{ color: tierMeta.color, borderColor: tierMeta.color+'55', background: tierMeta.color+'18' }}>
                <i className={tierMeta.icon} /> {profile?.tier || 'Gold'}
              </span>
            )}
            <span className={styles.avatarLevel}>Lv.{profile?.level ?? '—'}</span>
          </div>
          <div className={styles.avatarCurrency}>Currency: <strong>{currency}</strong></div>
        </div>
      </div>

      {/* ── Profile Info ── */}
      <Section icon="ri-user-3-line" title="Profile Info">
        <div className={styles.field}>
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Your username" />
        </div>
        <div className={styles.field}>
          <label>Bio</label>
          <textarea rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell other players about yourself..." />
        </div>
        <div className={styles.field}>
          <label>Play Style</label>
          <div className={styles.chipRow}>
            {PLAY_STYLES.map(s => (
              <button key={s} type="button"
                className={`${styles.chip} ${playStyle === s ? styles.chipActive : ''}`}
                onClick={() => setPlayStyle(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <label>Game Tags</label>
          <div className={styles.chipRow}>
            {GAME_SLUGS_LIST.map(s => {
              const name = GAME_NAMES_MAP[s]
              return (
                <button key={s} type="button"
                  className={`${styles.chip} ${gameTags.includes(name) ? styles.chipActive : ''}`}
                  onClick={() => toggleGameTag(name)}>{name}</button>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ── Country & Phone ── */}
      <Section icon="ri-map-pin-line" title="Country & Phone">
        <div className={styles.field}>
          <label>Country</label>
          <div className={styles.flagRow}>
            {FLAG_OPTIONS.map(f => (
              <button key={f.value} type="button"
                className={`${styles.flagBtn} ${countryFlag === f.value ? styles.flagBtnActive : ''}`}
                onClick={() => { setCountryFlag(f.value); setPhoneCode(f.code) }}>
                <img src={f.flag} alt={f.label} />
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <label>Phone Number</label>
          <div className={styles.phoneCodeRow}>
            {FLAG_OPTIONS.map(f => (
              <button key={f.code} type="button"
                className={`${styles.codeBtn} ${phoneCode === f.code ? styles.codeBtnActive : ''}`}
                onClick={() => setPhoneCode(f.code)}>
                <img src={f.flag} alt="" />{`+${f.code}`}
              </button>
            ))}
          </div>
          <div className={`${styles.phoneInput} ${phoneError ? styles.phoneInputError : ''}`}>
            <span className={styles.phonePrefix}>+{phoneCode}</span>
            <div className={styles.phoneDivider} />
            <input
              type="tel"
              placeholder="712 345 678"
              value={phoneLocal}
              onChange={e => { setPhoneLocal(e.target.value); setPhoneError('') }}
            />
            {phoneLocal && (
              <button type="button" className={styles.phoneClear} onClick={() => setPhoneLocal('')}>
                <i className="ri-close-line" />
              </button>
            )}
          </div>
          {phoneError && <p className={styles.fieldError}><i className="ri-error-warning-line" /> {phoneError}</p>}
          <p className={styles.fieldHint}>Used for match confirmations and payouts only.</p>
        </div>
      </Section>

      {/* ── Notifications ── */}
      <Section icon="ri-notification-3-line" title="Notifications">
        <SettingRow label="Match alerts" sub="Challenges, results, and confirmations">
          <button className={`${styles.toggle} ${notifMatch ? styles.toggleOn : ''}`} onClick={() => setNotifMatch(v => !v)}>
            <span className={styles.toggleThumb} />
          </button>
        </SettingRow>
        <SettingRow label="Shop alerts" sub="Buy requests, negotiations, and sales">
          <button className={`${styles.toggle} ${notifShop ? styles.toggleOn : ''}`} onClick={() => setNotifShop(v => !v)}>
            <span className={styles.toggleThumb} />
          </button>
        </SettingRow>
        <SettingRow label="Tournament alerts" sub="Registrations, starts, and results">
          <button className={`${styles.toggle} ${notifTournament ? styles.toggleOn : ''}`} onClick={() => setNotifTournament(v => !v)}>
            <span className={styles.toggleThumb} />
          </button>
        </SettingRow>
      </Section>

      {/* ── Password ── */}
      <Section icon="ri-lock-password-line" title="Change Password">
        <div className={styles.field}>
          <label>New Password</label>
          <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Min 6 characters" />
        </div>
        <div className={styles.field}>
          <label>Confirm New Password</label>
          <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="Repeat password" />
        </div>
        {pwMsg && (
          <p className={`${styles.fieldHint} ${pwMsg.includes('success') ? styles.fieldSuccess : styles.fieldError}`}>
            {pwMsg.includes('success') ? <i className="ri-check-circle-line" /> : <i className="ri-error-warning-line" />} {pwMsg}
          </p>
        )}
        <button className={styles.actionBtn} onClick={changePassword} disabled={pwSaving}>
          {pwSaving ? 'Updating…' : 'Update Password'}
        </button>
      </Section>

      {/* ── Quick Links ── */}
      <Section icon="ri-link-m" title="Quick Links">
        <a href="/account" className={styles.linkRow}>
          <i className="ri-user-line" /> View My Profile <i className="ri-arrow-right-s-line" style={{marginLeft:'auto'}} />
        </a>
        {isAdmin && (
          <a href="/dashboard" className={styles.linkRow} style={{color:'#f59e0b'}}>
            <i className="ri-shield-line" /> Admin Dashboard <i className="ri-arrow-right-s-line" style={{marginLeft:'auto'}} />
          </a>
        )}
        {isPartner && (
          <a href="/partner" className={styles.linkRow} style={{color:'#22c55e'}}>
            <i className="ri-shield-star-fill" /> Partner Hub <i className="ri-arrow-right-s-line" style={{marginLeft:'auto'}} />
          </a>
        )}
        <a href="/wallet" className={styles.linkRow}>
          <i className="ri-wallet-3-line" /> Wallet <i className="ri-arrow-right-s-line" style={{marginLeft:'auto'}} />
        </a>
      </Section>

      {/* ── Danger Zone ── */}
      <Section icon="ri-logout-box-r-line" title="Account">
        <button className={styles.signOutBtn} onClick={handleSignOut}>
          <i className="ri-logout-box-r-line" /> Sign Out
        </button>
        <button className={styles.dangerBtn} onClick={() => setDeleteConfirm(v => !v)}>
          <i className="ri-delete-bin-line" /> Delete Account
        </button>
        {deleteConfirm && (
          <div className={styles.deleteConfirm}>
            <p>Type <strong>DELETE</strong> to confirm permanent deletion of your account.</p>
            <input
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
            />
            <button
              className={styles.dangerBtnFull}
              disabled={deleteInput !== 'DELETE'}
              onClick={async () => {
                await supabase.from('profiles').delete().eq('id', user.id)
                await supabase.auth.signOut()
                router.push('/login')
              }}
            >
              Permanently Delete Account
            </button>
          </div>
        )}
      </Section>

      <p className={styles.version}>Nabogaming · v1.0</p>
    </div>
  )
}
