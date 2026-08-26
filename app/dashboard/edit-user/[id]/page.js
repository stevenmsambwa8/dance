'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import { FLAG_OPTIONS, DEFAULT_FLAG } from '../../../../lib/constants'
import styles from './page.module.css'
import usePageLoading from '../../../../components/usePageLoading'

const PHONE_CODES = [
  { code: '254', label: 'Kenya' },
  { code: '255', label: 'Tanzania' },
  { code: '256', label: 'Uganda' },
]

export default function EditUserPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const userId = params?.id

  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [phoneCode, setPhoneCode] = useState('255')
  const [phoneLocal, setPhoneLocal] = useState('')

  const [newBadgeDraft, setNewBadgeDraft] = useState({ label: '', icon: '🏅', color: '', desc: '', iconUrl: '' })
  const [useCustomColor, setUseCustomColor] = useState(false)
  const [badgeIconFile, setBadgeIconFile] = useState(null)
  const [badgeIconUploading, setBadgeIconUploading] = useState(false)

  usePageLoading(authLoading || loading)

  // Admin-only: revoke access immediately for anyone else.
  useEffect(() => { if (!authLoading && !isAdmin) router.replace('/') }, [authLoading, isAdmin])

  useEffect(() => {
    if (!isAdmin || !userId) return
    (async () => {
      setLoading(true)
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (error || !data) { setNotFound(true); setLoading(false); return }
      setProfile(data)
      const CODES = PHONE_CODES.map(c => c.code)
      const stripped = (data.phone || '').replace(/^\+/, '')
      const matched = CODES.find(c => stripped.startsWith(c))
      setPhoneCode(matched || '255')
      setPhoneLocal(matched ? stripped.slice(matched.length) : stripped)
      setLoading(false)
    })()
  }, [isAdmin, userId])

  async function saveUser() {
    if (!profile) return
    setSaving(true)
    const fullPhone = phoneLocal.trim()
      ? `+${phoneCode}${phoneLocal.trim().replace(/^0/, '')}` : null
    const payload = {
      username: profile.username, tier: profile.tier,
      level: Number(profile.level ?? 1), wins: Number(profile.wins || 0),
      losses: Number(profile.losses || 0), points: Number(profile.points || 0),
      bio: profile.bio, phone: fullPhone,
      country_flag: profile.country_flag || DEFAULT_FLAG,
      is_season_winner: !!profile.is_season_winner,
      custom_badges: profile.custom_badges || [],
    }
    const { error } = await supabase.from('profiles').update(payload).eq('id', profile.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    router.push('/dashboard?tab=Users')
  }

  async function deleteUser() {
    if (!profile) return
    if (!confirm('Delete this profile? Their auth record stays, but the profile row and its data go away.')) return
    await supabase.from('profiles').delete().eq('id', profile.id)
    router.push('/dashboard?tab=Users')
  }

  async function uploadBadgeIcon() {
    if (!badgeIconFile || !profile) return
    setBadgeIconUploading(true)
    const ext = badgeIconFile.name.split('.').pop()
    const path = `badge-icons/${profile.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('public').upload(path, badgeIconFile)
    if (upErr) { alert(upErr.message); setBadgeIconUploading(false); return }
    const { data: pub } = supabase.storage.from('public').getPublicUrl(path)
    setNewBadgeDraft(d => ({ ...d, iconUrl: pub.publicUrl }))
    setBadgeIconFile(null)
    setBadgeIconUploading(false)
  }

  function addCustomBadge() {
    if (!newBadgeDraft.label.trim()) return
    const badge = {
      id: `b_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      label: newBadgeDraft.label.trim(),
      icon: newBadgeDraft.icon.trim() || '🏅',
      iconUrl: newBadgeDraft.iconUrl || null,
      // Leave color unset unless the admin explicitly picked one — the
      // badge then renders in the site's theme accent color.
      color: useCustomColor ? (newBadgeDraft.color || null) : null,
      desc: newBadgeDraft.desc.trim() || '',
    }
    setProfile(x => ({ ...x, custom_badges: [...(x.custom_badges || []), badge] }))
    setNewBadgeDraft({ label: '', icon: '🏅', color: '', desc: '', iconUrl: '' })
    setUseCustomColor(false)
    setBadgeIconFile(null)
  }
  function removeCustomBadge(id) {
    setProfile(x => ({ ...x, custom_badges: (x.custom_badges || []).filter(b => b.id !== id) }))
  }

  if (authLoading || !isAdmin) return null
  if (loading) return <div className={styles.page} />
  if (notFound) {
    return (
      <div className={styles.page}>
        <div className={styles.hero}>
          <p className={styles.notFound}>Player not found.</p>
          <button className={styles.backBtn} onClick={() => router.push('/dashboard?tab=Users')}>
            <i className="ri-arrow-left-line" /> Back to Users
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroTop}>
          <button className={styles.backBtn} onClick={() => router.push('/dashboard?tab=Users')}>
            <i className="ri-arrow-left-line" /> Back
          </button>
          <button className={styles.deleteBtn} onClick={deleteUser}>
            <i className="ri-delete-bin-line" /> Delete
          </button>
        </div>

        <div className={styles.avatarRow}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" className={styles.avatar} />
            : <div className={styles.avatarFallback}><i className="ri-user-3-fill" /></div>}
          <div>
            <h1 className={styles.title}>{profile.username || 'Unnamed Player'}</h1>
            <p className={styles.subtitle}>{profile.email}</p>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.field}><label>Username</label>
            <input value={profile.username || ''} onChange={e => setProfile(x => ({ ...x, username: e.target.value }))} /></div>

          <div className={styles.fieldRow}>
            <div className={styles.field}><label>Rank Tier</label>
              <select value={profile.tier || 'Gold'} onChange={e => setProfile(x => ({ ...x, tier: e.target.value }))}>
                {['Bronze','Silver','Gold','Platinum','Diamond','Elite'].map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className={styles.field}><label>Level</label>
              <input type="number" value={profile.level ?? 1} onChange={e => setProfile(x => ({ ...x, level: e.target.value }))} /></div>
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}><label>Wins</label>
              <input type="number" value={profile.wins ?? 0} onChange={e => setProfile(x => ({ ...x, wins: e.target.value }))} /></div>
            <div className={styles.field}><label>Losses</label>
              <input type="number" value={profile.losses ?? 0} onChange={e => setProfile(x => ({ ...x, losses: e.target.value }))} /></div>
            <div className={styles.field}><label>Points</label>
              <input type="number" value={profile.points ?? 0} onChange={e => setProfile(x => ({ ...x, points: e.target.value }))} /></div>
          </div>

          <div className={styles.field}><label>Bio</label>
            <textarea rows={2} value={profile.bio || ''} onChange={e => setProfile(x => ({ ...x, bio: e.target.value }))} /></div>

          <div className={styles.field}>
            <label>Country Flag {!profile.country_flag && <span className={styles.warnNote}>(none set — defaults to Tanzania)</span>}</label>
            <div className={styles.flagRow}>
              {FLAG_OPTIONS.map(f => (
                <button key={f.value} type="button"
                  className={`${styles.flagBtn} ${(profile.country_flag || DEFAULT_FLAG) === f.value ? styles.flagBtnActive : ''}`}
                  onClick={() => setProfile(x => ({ ...x, country_flag: f.value }))}>
                  <img src={f.flag} alt={f.value} />
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label>Phone Number</label>
            <div className={styles.phoneRow}>
              <div className={styles.codeRow}>
                {PHONE_CODES.map(c => (
                  <button key={c.code} type="button"
                    className={`${styles.codeBtn} ${phoneCode === c.code ? styles.codeBtnActive : ''}`}
                    onClick={() => setPhoneCode(c.code)}>+{c.code}</button>
                ))}
              </div>
              <input type="tel" placeholder="712 345 678" value={phoneLocal} onChange={e => setPhoneLocal(e.target.value)} />
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <label className={styles.sectionLabel}>Winner Badges</label>

          <label className={styles.championToggle}>
            <input type="checkbox" checked={!!profile.is_season_winner}
              onChange={e => setProfile(x => ({ ...x, is_season_winner: e.target.checked }))} />
            <img src="/fire.png" alt="" />
            Season Champion badge
          </label>

          {(profile.custom_badges || []).length > 0 && (
            <div className={styles.badgeList}>
              {profile.custom_badges.map(b => (
                <div key={b.id} className={styles.badgeRow}>
                  {b.iconUrl
                    ? <img src={b.iconUrl} alt="" className={styles.badgeThumb} />
                    : <span className={styles.badgeEmoji}>{b.icon}</span>}
                  <div className={styles.badgeInfo}>
                    <div className={styles.badgeLabel} style={{ color: b.color || 'var(--accent)' }}>{b.label}</div>
                    {b.desc && <div className={styles.badgeDesc}>{b.desc}</div>}
                  </div>
                  <button type="button" className={styles.iconBtnDanger} onClick={() => removeCustomBadge(b.id)}>
                    <i className="ri-delete-bin-line" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.composer}>
            <div className={styles.composerRow}>
              <input placeholder="Badge name e.g. MVP" value={newBadgeDraft.label}
                onChange={e => setNewBadgeDraft(d => ({ ...d, label: e.target.value }))}
                className={styles.composerLabelInput} />
              {!newBadgeDraft.iconUrl && (
                <input placeholder="🏅" value={newBadgeDraft.icon}
                  onChange={e => setNewBadgeDraft(d => ({ ...d, icon: e.target.value }))}
                  className={styles.composerEmojiInput} maxLength={4} />
              )}
            </div>

            <textarea rows={2} placeholder="Tooltip description shown when a player taps the badge…"
              value={newBadgeDraft.desc}
              onChange={e => setNewBadgeDraft(d => ({ ...d, desc: e.target.value }))} />

            <label className={styles.colorToggle}>
              <input type="checkbox" checked={useCustomColor}
                onChange={e => { setUseCustomColor(e.target.checked); if (!e.target.checked) setNewBadgeDraft(d => ({ ...d, color: '' })) }} />
              Use a custom color <span className={styles.colorToggleHint}>(off = matches site theme)</span>
            </label>
            {useCustomColor && (
              <input type="color" value={newBadgeDraft.color || '#f97316'}
                onChange={e => setNewBadgeDraft(d => ({ ...d, color: e.target.value }))}
                className={styles.colorInput} />
            )}

            <div className={styles.uploadRow}>
              {newBadgeDraft.iconUrl ? (
                <div className={styles.uploadPreview}>
                  <img src={newBadgeDraft.iconUrl} alt="" />
                  <button type="button" className={styles.iconBtnDanger}
                    onClick={() => setNewBadgeDraft(d => ({ ...d, iconUrl: '' }))}>
                    <i className="ri-close-line" />
                  </button>
                </div>
              ) : (
                <>
                  <input type="file" accept="image/*"
                    onChange={e => setBadgeIconFile(e.target.files?.[0] || null)} />
                  <button type="button" className={styles.iconBtnSm} disabled={!badgeIconFile || badgeIconUploading}
                    onClick={uploadBadgeIcon} title="Upload badge image (used instead of the emoji)">
                    {badgeIconUploading ? <i className="ri-loader-4-line" /> : <i className="ri-upload-2-line" />}
                  </button>
                </>
              )}
            </div>

            <button type="button" className={styles.addBadgeBtn} onClick={addCustomBadge}>
              <i className="ri-add-line" /> Add Badge
            </button>
          </div>
        </div>

        <button className={styles.saveBtn} onClick={saveUser} disabled={saving}>
          <i className="ri-check-line" /> {saving ? 'Saving…' : 'Save Player'}
        </button>
      </div>
    </div>
  )
}
