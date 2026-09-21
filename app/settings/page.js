'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../components/AuthProvider'
import { useAuthGate } from '../../components/AuthGateModal'
import { supabase } from '../../lib/supabase'
import usePageLoading from '../../components/usePageLoading'
import { useCurrency } from '../../lib/useCurrency'
import { RANK_META, GAME_SLUGS, GAME_META } from '../../lib/constants'
import { isLocked, daysRemaining } from '../../lib/profileLock'
import styles from './page.module.css'

const PLAY_STYLES  = ['Aggressive', 'Defensive', 'Support', 'Sniper', 'All-Round']
const FLAG_OPTIONS = [
  { value: 'kenya',        label: 'Kenya',        code: '254', flag: '/kenya.png'        },
  { value: 'tanzania',     label: 'Tanzania',     code: '255', flag: '/tanzania.png'     },
  { value: 'uganda',       label: 'Uganda',       code: '256', flag: '/uganda.png'       },
  { value: 'south-africa', label: 'South Africa', code: '27',  flag: '/south-africa.png' },
  { value: 'nigeria',      label: 'Nigeria',      code: '234', flag: '/nigeria.png'      },
]
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
  const { openAuthGate } = useAuthGate()
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
  const [photoError, setPhotoError] = useState('')
  const [photoDone,  setPhotoDone]  = useState(false)
  const [phoneError,  setPhoneError]  = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')
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
      const matched  = ['254','255','256','27','234'].find(c => stripped.startsWith(c))
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
          <p>Please <button onClick={openAuthGate} style={{background:'none',border:'none',color:'var(--text)',fontWeight:700,cursor:'pointer',padding:0,textDecoration:'underline',fontFamily:'var(--font)'}}>log in</button> to access settings.</p>
        </div>
      </div>
    )
  }

  const tierMeta  = RANK_META[profile?.tier] || RANK_META.Gold
  const isPartner = profile?.tier === 'Partner'

  // ── 60-day identity lock: username, avatar, and country flag ──
  const usernameLocked = isLocked(profile?.username_changed_at)
  const avatarLocked   = isLocked(profile?.avatar_changed_at)
  const flagLocked     = isLocked(profile?.country_flag_changed_at)
  const usernameDaysLeft = daysRemaining(profile?.username_changed_at)
  const avatarDaysLeft   = daysRemaining(profile?.avatar_changed_at)
  const flagDaysLeft     = daysRemaining(profile?.country_flag_changed_at)

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
    const input = e.target
    const file = input.files?.[0]
    input.value = '' // allow re-selecting the same file later
    if (!file) return
    setPhotoError(''); setPhotoDone(false)
    if (!file.type.startsWith('image/')) { setPhotoError('Please choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024)     { setPhotoError('Image is too large — max 5 MB.'); return }
    setAvatarLoading(true)
    try {
      await uploadAvatar(file)
      setPhotoDone(true)
      setTimeout(() => setPhotoDone(false), 4000)
    }
    catch(err) { setPhotoError('Upload failed: ' + err.message) }
    finally    { setAvatarLoading(false) }
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
          className={`${styles.avatarWrap} ${avatarLocked ? styles.avatarWrapLocked : ''}`}
          data-tier={profile?.tier || 'Gold'}
          onClick={() => { if (!avatarLocked) fileRef.current?.click() }}
        >
          {avatarLoading ? (
            <div className={styles.avatarInner}><i className="ri-loader-4-line" /></div>
          ) : profile?.avatar_url ? (
            <img src={profile.avatar_url} className={styles.avatarImg} alt="" />
          ) : (
            <div className={styles.avatarInner}>{initials}</div>
          )}
          <div className={styles.avatarCamera}>
            <i className={avatarLocked ? 'ri-lock-line' : 'ri-camera-line'} />
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleAvatarChange} disabled={avatarLocked} />
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

      {/* ── Profile Photo ── */}
      <Section icon="ri-image-add-line" title="Profile Photo">
        <div className={styles.photoArea}>
          <div className={styles.photoPreview}>
            {avatarLoading ? (
              <i className="ri-loader-4-line" />
            ) : profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div className={styles.photoInfo}>
            <button
              type="button"
              className={styles.photoBtn}
              onClick={() => fileRef.current?.click()}
              disabled={avatarLocked || avatarLoading}
            >
              <i className={avatarLocked ? 'ri-lock-line' : 'ri-camera-line'} />
              {avatarLoading ? 'Uploading…' : profile?.avatar_url ? 'Change photo' : 'Upload photo'}
            </button>
            {avatarLocked ? (
              <p className={styles.fieldHint}>
                <i className="ri-lock-line" /> Locked for {avatarDaysLeft} more day{avatarDaysLeft === 1 ? '' : 's'} — your photo can only change once every 60 days.
              </p>
            ) : (
              <p className={styles.fieldHint}>JPG, PNG or WebP, up to 5 MB. Square photos look best. You can change it once every 60 days.</p>
            )}
            {photoDone  && <p className={`${styles.fieldHint} ${styles.fieldSuccess}`}><i className="ri-check-circle-line" /> Photo updated.</p>}
            {photoError && <p className={`${styles.fieldHint} ${styles.fieldError}`}><i className="ri-error-warning-line" /> {photoError}</p>}
          </div>
        </div>
      </Section>

      {/* ── Profile Info ── */}
      <Section icon="ri-user-3-line" title="Profile Info">
        <div className={styles.field}>
          <label>Username</label>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Your username"
            disabled={usernameLocked}
          />
          {usernameLocked && (
            <p className={styles.fieldHint}>
              <i className="ri-lock-line" /> Locked for {usernameDaysLeft} more day{usernameDaysLeft === 1 ? '' : 's'} — usernames can only change once every 60 days.
            </p>
          )}
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
            {GAME_SLUGS.map(s => {
              const name = GAME_META[s].name
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
          <div className={`${styles.flagRow} ${flagLocked ? styles.flagRowLocked : ''}`}>
            {FLAG_OPTIONS.map(f => (
              <button key={f.value} type="button"
                disabled={flagLocked}
                className={`${styles.flagBtn} ${countryFlag === f.value ? styles.flagBtnActive : ''}`}
                onClick={() => { if (!flagLocked) { setCountryFlag(f.value); setPhoneCode(f.code) } }}>
                <img src={f.flag} alt={f.label} />
                <span>{f.label}</span>
              </button>
            ))}
          </div>
          {flagLocked && (
            <p className={styles.fieldHint}>
              <i className="ri-lock-line" /> Locked for {flagDaysLeft} more day{flagDaysLeft === 1 ? '' : 's'} — your country flag can only change once every 60 days.
            </p>
          )}
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
        <a href="/invite" className={styles.linkRow} style={{color:'#22c55e'}}>
          <i className="ri-user-add-line" /> Invite &amp; Earn <i className="ri-arrow-right-s-line" style={{marginLeft:'auto'}} />
        </a>
      </Section>

      {/* ── Account / Danger Zone ── */}
      <Section icon="ri-logout-box-r-line" title="Account">
        <button className={styles.signOutBtn} onClick={handleSignOut}>
          <i className="ri-logout-box-r-line" /> Sign Out
        </button>
        <button className={styles.dangerBtn} onClick={() => { setDeleteConfirm(true); setDeleteInput(''); setDeleteError('') }}>
          <i className="ri-delete-bin-line" /> Delete Account
        </button>
      </Section>

      {/* ── Delete confirmation modal ── */}
      {deleteConfirm && (
        <div className={styles.modalOverlay} onClick={() => { if (!deleteLoading) setDeleteConfirm(false) }}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.modalIcon}><i className="ri-delete-bin-2-fill" /></div>
            <h2 className={styles.modalTitle}>Delete Account?</h2>
            <p className={styles.modalDesc}>
              This will permanently erase your profile, matches, shop items, wallet, posts, and all other data.
              <strong> This cannot be undone.</strong>
            </p>
            <div className={styles.modalField}>
              <label>Type <strong>DELETE</strong> to confirm</label>
              <input
                value={deleteInput}
                onChange={e => { setDeleteInput(e.target.value); setDeleteError('') }}
                placeholder="DELETE"
                autoCapitalize="characters"
                disabled={deleteLoading}
              />
            </div>
            {deleteError && (
              <p className={styles.modalError}><i className="ri-error-warning-line" /> {deleteError}</p>
            )}
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setDeleteConfirm(false)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                className={styles.modalDeleteBtn}
                disabled={deleteInput !== 'DELETE' || deleteLoading}
                onClick={async () => {
                  setDeleteLoading(true)
                  setDeleteError('')
                  try {
                    // Get current session token to send to server
                    const { data: { session } } = await supabase.auth.getSession()
                    if (!session) throw new Error('No active session')

                    const res = await fetch('/api/delete-account', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                      },
                    })
                    const json = await res.json()
                    if (!res.ok) throw new Error(json.error || 'Delete failed')

                    // Success — sign out locally and redirect
                    await supabase.auth.signOut()
                    router.push('/login')
                  } catch(e) {
                    setDeleteError(e.message)
                    setDeleteLoading(false)
                  }
                }}
              >
                {deleteLoading
                  ? <><i className="ri-loader-4-line" style={{animation:'spin 1s linear infinite'}} /> Deleting…</>
                  : <><i className="ri-delete-bin-line" /> Delete Forever</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      <p className={styles.version}>Nabogaming · v1.0</p>
    </div>
  )
}
