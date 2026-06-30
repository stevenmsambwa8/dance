'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Modal from '../../../../components/Modal'
import UserBadges from '../../../../components/UserBadges'
import { useAuth } from '../../../../components/AuthProvider'
import { supabase } from '../../../../lib/supabase'
import { GAME_META } from '../../../../lib/constants'
import styles from './page.module.css'

export default function ManageClanPage() {
  const { code } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const logoRef = useRef()

  const [clan, setClan]       = useState(null)
  const [squads, setSquads]   = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('info')

  // Info form
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [logoFile, setLogoFile]       = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [saving, setSaving]           = useState(false)
  const [saveMsg, setSaveMsg]         = useState('')
  const [saveError, setSaveError]     = useState('')

  // Kick / transfer confirm modal
  const [confirmAction, setConfirmAction] = useState(null)
  const [acting, setActing] = useState(false)

  // Delete clan flow
  const [deleteOpen, setDeleteOpen]     = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting]         = useState(false)
  const [deleteError, setDeleteError]   = useState('')

  useEffect(() => { if (code) loadAll() }, [code])

  async function loadAll() {
    setLoading(true)
    const { data: clanData } = await supabase.from('clans').select('*').eq('code', code).single()
    if (!clanData) { setClan(null); setLoading(false); return }

    if (user && clanData.leader_id !== user.id) {
      router.replace(`/clans/${code}`)
      return
    }

    const [{ data: squadData }, { data: memberData }] = await Promise.all([
      supabase.from('clan_squads').select('*').eq('clan_id', clanData.id).order('created_at'),
      supabase.from('clan_members')
        .select('*, profiles(id, username, avatar_url, email, plan, plan_expires_at, country_flag, is_season_winner)')
        .eq('clan_id', clanData.id),
    ])

    setClan(clanData)
    setSquads(squadData || [])
    setMembers(memberData || [])
    setName(clanData.name)
    setDescription(clanData.description || '')
    setLogoPreview(clanData.logo_url)
    setLoading(false)
  }

  function handleLogoPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  async function handleSaveInfo() {
    if (!clan) return
    if (name.trim().length < 3) { setSaveError('Clan name must be at least 3 characters.'); return }

    setSaving(true)
    setSaveError('')
    setSaveMsg('')

    let logo_url = clan.logo_url
    if (logoFile) {
      const ext = logoFile.name.split('.').pop()
      const path = `${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('clan-logos').upload(path, logoFile)
      if (upErr) {
        setSaveError(`Logo upload failed: ${upErr.message}`)
        setSaving(false)
        return
      }
      const { data: pub } = supabase.storage.from('clan-logos').getPublicUrl(path)
      logo_url = pub.publicUrl
    }

    const { error } = await supabase
      .from('clans')
      .update({ name: name.trim(), description: description.trim() || null, logo_url })
      .eq('id', clan.id)

    if (error) {
      setSaveError(error.message.includes('duplicate') ? 'A clan with this name already exists.' : error.message)
    } else {
      setSaveMsg('Saved!')
      setTimeout(() => setSaveMsg(''), 2000)
      loadAll()
    }
    setSaving(false)
  }

  // ── Member actions ──
  // NOTE: removing a player from a squad, editing squad details, and deleting
  // a squad are squad-leader-only actions (handled on the squad's own page).
  // The clan leader can still kick from the clan entirely and transfer
  // clan/squad leadership, but cannot reach into a squad to remove players.
  function askKick(member)            { setConfirmAction({ type: 'kick', member }) }
  function askTransferClan(member)    { setConfirmAction({ type: 'transfer_clan', member }) }
  function askMakeSquadLeader(member) { setConfirmAction({ type: 'transfer_squad', member }) }

  async function executeAction() {
    if (!confirmAction || !clan) return
    setActing(true)
    const { type, member } = confirmAction

    if (type === 'kick') {
      await supabase.from('clan_members').delete()
        .eq('clan_id', clan.id).eq('user_id', member.user_id)

    } else if (type === 'transfer_clan') {
      await supabase.from('clans').update({ leader_id: member.user_id }).eq('id', clan.id)
      await supabase.from('clan_members')
        .update({ role: 'leader' }).eq('clan_id', clan.id).eq('user_id', member.user_id)
      await supabase.from('clan_members')
        .update({ role: member.squad_id ? 'squad_leader' : 'member' })
        .eq('clan_id', clan.id).eq('user_id', user.id)

    } else if (type === 'transfer_squad') {
      await supabase.from('clan_squads').update({ leader_id: member.user_id }).eq('id', member.squad_id)
      await supabase.from('clan_members')
        .update({ role: 'squad_leader' }).eq('squad_id', member.squad_id).eq('user_id', member.user_id)
      const prevLeader = squads.find(s => s.id === member.squad_id)?.leader_id
      if (prevLeader && prevLeader !== member.user_id) {
        await supabase.from('clan_members')
          .update({ role: 'member' }).eq('squad_id', member.squad_id).eq('user_id', prevLeader)
      }

    }

    setActing(false)
    setConfirmAction(null)
    loadAll()
  }

  // ── Delete clan entirely ──
  // Relies on ON DELETE CASCADE from clans -> clan_squads -> clan_members,
  // already set up in the schema. One delete call wipes everything.
  async function handleDeleteClan() {
    if (!clan) return
    if (deleteConfirmText.trim() !== clan.name) {
      setDeleteError(`Type "${clan.name}" exactly to confirm.`)
      return
    }
    setDeleting(true)
    setDeleteError('')

    const { error } = await supabase.from('clans').delete().eq('id', clan.id)

    if (error) {
      setDeleteError(error.message)
      setDeleting(false)
      return
    }

    setDeleting(false)
    setDeleteOpen(false)
    router.push('/clans')
  }

  if (loading) return <div className={styles.page}><div className={styles.loadingBox}/></div>
  if (!clan)   return <div className={styles.page}><p className={styles.notFound}>Clan not found.</p></div>

  const squadMap = Object.fromEntries(squads.map(s => [s.id, s]))

  return (
    <div className={styles.page}>
      <button className={styles.backLink} onClick={() => router.push(`/clans/${code}`)}>
        <i className="ri-arrow-left-line"/> Back to {clan.name}
      </button>

      <h1 className={styles.headline}>Manage Clan</h1>
      <p className={styles.sub}>
        <i className={GAME_META[clan.game]?.icon}/> {GAME_META[clan.game]?.name} · {clan.member_count}/125 members · {clan.squad_count}/25 squads
      </p>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'info' ? styles.tabActive : ''}`} onClick={() => setTab('info')}>Clan Info</button>
        <button className={`${styles.tab} ${tab === 'squads' ? styles.tabActive : ''}`} onClick={() => setTab('squads')}>Squads</button>
        <button className={`${styles.tab} ${tab === 'members' ? styles.tabActive : ''}`} onClick={() => setTab('members')}>Members</button>
      </div>

      {/* ── Clan Info ── */}
      {tab === 'info' && (
        <div className={styles.formBlock}>
          <div className={styles.field}>
            <label>Clan Logo</label>
            <div className={styles.logoPicker} onClick={() => logoRef.current?.click()}>
              {logoPreview ? <img src={logoPreview} alt=""/> : <i className="ri-image-add-line"/>}
            </div>
            <input ref={logoRef} type="file" accept="image/*" hidden onChange={handleLogoPick}/>
          </div>

          <div className={styles.field}>
            <label>Clan Name</label>
            <input className={styles.textInput} value={name}
              onChange={e => setName(e.target.value)} maxLength={24}/>
            <p className={styles.prefixHint}>
              Squad prefix: <strong>{name.trim().slice(0,3).toUpperCase()}</strong>
              {name.trim().slice(0,3).toUpperCase() !== clan.tag_prefix && (
                <span style={{ color:'#f59e0b' }}> — changing this won't rename existing squads</span>
              )}
            </p>
          </div>

          <div className={styles.field}>
            <label>Description</label>
            <textarea className={styles.textArea} value={description}
              onChange={e => setDescription(e.target.value)} maxLength={200} rows={3}/>
          </div>

          {saveError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {saveError}</p>}
          {saveMsg && <p className={styles.successMsg}><i className="ri-check-line"/> {saveMsg}</p>}

          <button className={styles.submitBtn} disabled={saving} onClick={handleSaveInfo}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>

          {/* ── Danger zone ── */}
          <div className={styles.dangerZone}>
            <p className={styles.dangerLabel}>
              <i className="ri-error-warning-line"/> Danger Zone
            </p>
            <p className={styles.dangerDesc}>
              Permanently deletes this clan, all {clan.squad_count} squad{clan.squad_count === 1 ? '' : 's'}, and removes all {clan.member_count} member{clan.member_count === 1 ? '' : 's'}. This cannot be undone.
            </p>
            <button className={styles.deleteBtn} onClick={() => setDeleteOpen(true)}>
              <i className="ri-delete-bin-line"/> Delete Clan
            </button>
          </div>
        </div>
      )}

      {/* ── Squads ── */}
      {tab === 'squads' && (
        <div className={styles.list}>
          {squads.map(squad => {
            const squadMembers = members.filter(m => m.squad_id === squad.id)
            return (
              <div key={squad.id} className={styles.squadManageCard}>
                <div className={styles.squadManageHeader}>
                  <div className={styles.squadImgSmall}>
                    {squad.image_url ? <img src={squad.image_url} alt=""/> : <i className="ri-team-line"/>}
                  </div>
                  <div>
                    <span className={styles.squadManageName}>{squad.name}</span>
                    <span className={styles.squadManageMeta}>{squad.member_count}/5 members</span>
                  </div>
                </div>
                <div className={styles.squadMemberChips}>
                  {squadMembers.map(m => (
                    <div key={m.user_id} className={styles.memberChip}>
                      <span>{m.profiles?.username}</span>
                      <UserBadges
                        email={m.profiles?.email}
                        plan={m.profiles?.plan}
                        planExpiresAt={m.profiles?.plan_expires_at}
                        countryFlag={m.profiles?.country_flag}
                        isSeasonWinner={m.profiles?.is_season_winner}
                        size={12}
                      />
                      {m.role === 'leader' && <i className="ri-vip-crown-line" title="Clan Leader"/>}
                      {m.role === 'squad_leader' && <i className="ri-star-fill" title="Squad Leader"/>}
                      {m.user_id !== user?.id && m.role !== 'squad_leader' && m.role !== 'leader' && (
                        <button onClick={() => askMakeSquadLeader(m)} title="Make squad leader">
                          <i className="ri-star-line"/>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {squads.length === 0 && <p className={styles.emptyText}>No squads created yet.</p>}
        </div>
      )}

      {/* ── Members ── */}
      {tab === 'members' && (
        <div className={styles.list}>
          {members.map(m => (
            <div key={m.user_id} className={styles.memberManageRow}>
              <div className={styles.memberAvatarSmall}>
                {m.profiles?.avatar_url
                  ? <img src={m.profiles.avatar_url} alt=""/>
                  : <span>{(m.profiles?.username || '?').slice(0,2).toUpperCase()}</span>
                }
              </div>
              <div className={styles.memberManageInfo}>
                <span className={styles.memberManageName}>
                  {m.profiles?.username}
                  <UserBadges
                    email={m.profiles?.email}
                    plan={m.profiles?.plan}
                    planExpiresAt={m.profiles?.plan_expires_at}
                    countryFlag={m.profiles?.country_flag}
                    isSeasonWinner={m.profiles?.is_season_winner}
                    size={13}
                  />
                </span>
                <span className={styles.memberManageRole}>
                  {m.role === 'leader' ? 'Clan Leader' :
                   m.role === 'squad_leader' ? `Squad Leader · ${squadMap[m.squad_id]?.name || ''}` :
                   m.squad_id ? `Member · ${squadMap[m.squad_id]?.name || ''}` : 'Unassigned'}
                </span>
              </div>
              {m.user_id !== user?.id && (
                <div className={styles.memberManageActions}>
                  <button className={styles.actionBtn} onClick={() => askTransferClan(m)} title="Transfer leadership">
                    <i className="ri-vip-crown-line"/>
                  </button>
                  <button className={styles.actionBtnDanger} onClick={() => askKick(m)} title="Kick from clan">
                    <i className="ri-user-unfollow-line"/>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Confirm modal (member actions) ── */}
      <Modal open={!!confirmAction} onClose={() => setConfirmAction(null)} title="Confirm Action" size="sm"
        footer={
          <button className={styles.submitBtn} disabled={acting} onClick={executeAction}
            style={confirmAction?.type === 'kick' ? { background: '#ef4444' } : {}}>
            {acting ? 'Working…' : 'Confirm'}
          </button>
        }>
        {confirmAction && (
          <p className={styles.confirmText}>
            {confirmAction.type === 'kick' &&
              <>Remove <strong>{confirmAction.member.profiles?.username}</strong> from the clan? They'll lose their squad spot too.</>
            }
            {confirmAction.type === 'transfer_clan' &&
              <>Make <strong>{confirmAction.member.profiles?.username}</strong> the new clan leader? You'll be demoted to a regular member.</>
            }
            {confirmAction.type === 'transfer_squad' &&
              <>Make <strong>{confirmAction.member.profiles?.username}</strong> the squad leader?</>
            }
          </p>
        )}
      </Modal>

      {/* ── Delete clan modal ── */}
      <Modal open={deleteOpen} onClose={() => { setDeleteOpen(false); setDeleteConfirmText(''); setDeleteError('') }}
        title="Delete Clan" size="sm"
        footer={
          <button className={styles.deleteConfirmBtn} disabled={deleting} onClick={handleDeleteClan}>
            {deleting ? 'Deleting…' : 'Permanently Delete'}
          </button>
        }>
        <div className={styles.deleteModalBody}>
          <p className={styles.confirmText}>
            This will permanently delete <strong>{clan.name}</strong>, all <strong>{clan.squad_count}</strong> squads,
            and remove all <strong>{clan.member_count}</strong> members. This action <strong>cannot be undone</strong>.
          </p>
          <div className={styles.field}>
            <label>Type "{clan.name}" to confirm</label>
            <input className={styles.textInput}
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={clan.name}/>
          </div>
          {deleteError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {deleteError}</p>}
        </div>
      </Modal>
    </div>
  )
}
