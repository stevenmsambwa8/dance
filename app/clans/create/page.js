'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_SLUGS, GAME_META } from '../../../lib/constants'
import styles from './page.module.css'

export default function CreateClanPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const fileRef = useRef()

  const [game, setGame]               = useState(params.get('game') || GAME_SLUGS[0])
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [logoFile, setLogoFile]       = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [alreadyIn, setAlreadyIn]     = useState(false)
  const [checking, setChecking]       = useState(true)

  useEffect(() => {
    if (!user) { openAuthGate(); return }
    checkExisting()
  }, [user, game])

  async function checkExisting() {
    setChecking(true)
    const { data } = await supabase
      .from('clan_members')
      .select('clan_id, clans!inner(id, game)')
      .eq('user_id', user.id)
      .eq('clans.game', game)
      .maybeSingle()
    setAlreadyIn(!!data)
    setChecking(false)
  }

  const tagPrefix = name.trim().slice(0, 3).toUpperCase()

  function handleLogoPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  async function handleCreate() {
    if (!user) { openAuthGate(); return }
    if (name.trim().length < 3) { setError('Clan name must be at least 3 characters.'); return }
    if (alreadyIn) { setError('You are already in a clan for this game.'); return }

    setSaving(true)
    setError('')

    let logo_url = null
    if (logoFile) {
      const ext = logoFile.name.split('.').pop()
      const path = `clan-logos/${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('public').upload(path, logoFile)
      if (!upErr) {
        const { data: pub } = supabase.storage.from('public').getPublicUrl(path)
        logo_url = pub.publicUrl
      }
    }

    const { data: clan, error: insertErr } = await supabase
      .from('clans')
      .insert({
        game,
        name: name.trim(),
        description: description.trim() || null,
        logo_url,
        leader_id: user.id,
        member_count: 1,
        squad_count: 0,
      })
      .select()
      .single()

    if (insertErr) {
      setError(insertErr.message.includes('duplicate') ? 'A clan with this name already exists.' : insertErr.message)
      setSaving(false)
      return
    }

    await supabase.from('clan_members').insert({
      clan_id: clan.id,
      squad_id: null,
      user_id: user.id,
      role: 'leader',
    })

    setSaving(false)
    router.push(`/clans/${clan.code}`)
  }

  if (checking) {
    return <div className={styles.page}><div className={styles.loadingBox}/></div>
  }

  if (alreadyIn) {
    return (
      <div className={styles.page}>
        <div className={styles.blockedState}>
          <i className="ri-shield-star-line"/>
          <h2>Already in a clan</h2>
          <p>You're already part of a {GAME_META[game]?.name} clan. Leave it first to create a new one.</p>
          <button className={styles.backBtn} onClick={() => router.push('/clans')}>
            Back to Clans
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <button className={styles.backLink} onClick={() => router.back()}>
        <i className="ri-arrow-left-line"/> Back
      </button>

      <h1 className={styles.headline}>Create a Clan</h1>
      <p className={styles.sub}>Free for everyone. Up to 125 members across 25 squads of 5.</p>

      <div className={styles.field}>
        <label>Game</label>
        <div className={styles.gameGrid}>
          {GAME_SLUGS.map(g => (
            <button key={g}
              className={`${styles.gameBtn} ${game === g ? styles.gameBtnActive : ''}`}
              onClick={() => setGame(g)}>
              <i className={GAME_META[g]?.icon}/> {GAME_META[g]?.name || g}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label>Clan Logo</label>
        <div className={styles.logoPicker} onClick={() => fileRef.current?.click()}>
          {logoPreview
            ? <img src={logoPreview} alt=""/>
            : <i className="ri-image-add-line"/>
          }
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleLogoPick}/>
      </div>

      <div className={styles.field}>
        <label>Clan Name</label>
        <input className={styles.textInput} placeholder="e.g. Abcsmokers"
          value={name} onChange={e => setName(e.target.value)} maxLength={24}/>
        {tagPrefix && (
          <p className={styles.prefixHint}>
            Squad tag prefix will be <strong>{tagPrefix}</strong> — e.g. "{tagPrefix}Raiders"
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label>Description (optional)</label>
        <textarea className={styles.textArea} placeholder="What's this clan about?"
          value={description} onChange={e => setDescription(e.target.value)}
          maxLength={200} rows={3}/>
      </div>

      {error && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {error}</p>}

      <button className={styles.submitBtn} disabled={saving || name.trim().length < 3} onClick={handleCreate}>
        {saving ? 'Creating…' : <><i className="ri-shield-star-line"/> Create Clan</>}
      </button>
    </div>
  )
}
