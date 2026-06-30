'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Modal from '../../../../../components/Modal'
import MemberPreviewModal from '../../../../../components/MemberPreviewModal'
import UserBadges from '../../../../../components/UserBadges'
import { useAuth } from '../../../../../components/AuthProvider'
import { useAuthGate } from '../../../../../components/AuthGateModal'
import { supabase } from '../../../../../lib/supabase'
import { identityColor } from '../../../../../lib/clanColors'
import { useOnlineUsers } from '../../../../../lib/usePresence'
import usePageLoading from '../../../../../components/usePageLoading'
import styles from './page.module.css'

const SQUAD_SIZE = 5

export default function SquadPage() {
  const { code, squadCode } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const onlineIds = useOnlineUsers()
  const imgRef = useRef()

  const [clan, setClan]       = useState(null)
  const [squad, setSquad]     = useState(null)
  const [members, setMembers] = useState([])
  const [myMembership, setMyMembership] = useState(null)
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)

  const [previewMember, setPreviewMember] = useState(null)

  const [confirmOpen, setConfirmOpen] = useState(null)
  const [kickTarget, setKickTarget]   = useState(null)
  const [acting, setActing]           = useState(false)
  const [actionError, setActionError] = useState('')

  const [editOpen, setEditOpen]       = useState(false)
  const [editSuffix, setEditSuffix]   = useState('')
  const [editImgFile, setEditImgFile] = useState(null)
  const [editImgPreview, setEditImgPreview] = useState(null)
  const [savingEdit, setSavingEdit]   = useState(false)
  const [editError, setEditError]     = useState('')

  useEffect(() => { if (code && squadCode) loadAll() }, [code, squadCode, user])

  async function loadAll() {
    setLoading(true)
    const { data: clanData } = await supabase.from('clans').select('*').eq('code', code).single()
    if (!clanData) { setClan(null); setLoading(false); return }

    const { data: squadData } = await supabase.from('clan_squads')
      .select('*').eq('code', squadCode).eq('clan_id', clanData.id).single()
    if (!squadData) { setSquad(null); setClan(clanData); setLoading(false); return }

    const { data: memberData } = await supabase.from('clan_members')
      .select('*, profiles(id, username, avatar_url, tier, level, email, plan, plan_expires_at, country_flag, is_season_winner)')
      .eq('squad_id', squadData.id)

    setClan(clanData)
    setSquad(squadData)
    setMembers(memberData || [])
    setEditImgPreview(squadData.image_url)
    setEditSuffix(squadData.name.startsWith(clanData.tag_prefix)
      ? squadData.name.slice(clanData.tag_prefix.length)
      : squadData.name)

    if (user) {
      const { data: mine } = await supabase.from('clan_members')
        .select('*').eq('clan_id', clanData.id).eq('user_id', user.id).maybeSingle()
      setMyMembership(mine || null)
    }
    setLoading(false)
  }

  const isInThisSquad   = myMembership?.squad_id === squad?.id
  const isSquadLeader   = squad?.leader_id === user?.id
  const isClanLeader    = clan?.leader_id === user?.id
  const isInClanNoSquad = myMembership && !myMembership.squad_id
  const canManage       = isSquadLeader || isClanLeader

  async function handleJoinSquad() {
    if (!user) { openAuthGate(); return }
    if (!myMembership) { router.push(`/clans/${code}`); return }
    if (squad.member_count >= SQUAD_SIZE) return
    await supabase.from('clan_members')
      .update({ squad_id: squad.id, role: myMembership.role === 'leader' ? 'leader' : 'member' })
      .eq('id', myMembership.id)
    loadAll()
  }

  async function handleLeaveSquad() {
    setActing(true)
    await supabase.from('clan_members')
      .update({ squad_id: null, role: myMembership.role === 'leader' ? 'leader' : 'member' })
      .eq('id', myMembership.id)
    if (isSquadLeader && members.length > 1) {
      await supabase.rpc('reassign_squad_leader', { p_squad_id: squad.id })
    }
    setActing(false)
    setConfirmOpen(null)
    loadAll()
  }

  function askKick(member) { setKickTarget(member); setConfirmOpen('kick') }

  async function handleKick() {
    if (!kickTarget) return
    setActing(true)
    setActionError('')
    const { error } = await supabase.from('clan_members')
      .update({ squad_id: null, role: 'member' })
      .eq('id', kickTarget.id)
    if (error) { setActionError(error.message); setActing(false); return }
    if (squad.leader_id === kickTarget.user_id) {
      await supabase.rpc('reassign_squad_leader', { p_squad_id: squad.id })
    }
    setActing(false)
    setConfirmOpen(null)
    setKickTarget(null)
    loadAll()
  }

  function openEdit() {
    if (!canManage) return
    setEditError('')
    setEditOpen(true)
  }

  function handleEditImgPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setEditImgFile(file)
    setEditImgPreview(URL.createObjectURL(file))
  }

  async function handleSaveEdit() {
    if (!squad || !clan) return
    const suffix = editSuffix.trim()
    if (!suffix) { setEditError('Squad name is required.'); return }
    const fullName = `${clan.tag_prefix}${suffix}`

    setSavingEdit(true)
    setEditError('')

    let image_url = squad.image_url
    if (editImgFile) {
      const ext = editImgFile.name.split('.').pop()
      const path = `${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('squad-images').upload(path, editImgFile)
      if (upErr) { setEditError(`Image upload failed: ${upErr.message}`); setSavingEdit(false); return }
      const { data: pub } = supabase.storage.from('squad-images').getPublicUrl(path)
      image_url = pub.publicUrl
    }

    const { error } = await supabase.from('clan_squads').update({ name: fullName, image_url }).eq('id', squad.id)
    if (error) {
      setEditError(error.message.includes('duplicate') ? 'A squad with this name already exists.' : error.message)
      setSavingEdit(false)
      return
    }
    setSavingEdit(false)
    setEditOpen(false)
    setEditImgFile(null)
    loadAll()
  }

  async function handleDeleteSquad() {
    if (!squad || !canManage) return
    setActing(true)
    setActionError('')
    await supabase.from('clan_members').update({ squad_id: null, role: 'member' }).eq('squad_id', squad.id)
    const { error } = await supabase.from('clan_squads').delete().eq('id', squad.id)
    if (error) { setActionError(error.message); setActing(false); return }
    setActing(false)
    setConfirmOpen(null)
    router.push(`/clans/${code}`)
  }

  if (loading) return <div className={styles.page}><div className={styles.loadingBox}/></div>
  if (!clan)   return <div className={styles.page}><p className={styles.notFound}>Clan not found.</p></div>
  if (!squad)  return <div className={styles.page}><p className={styles.notFound}>Squad not found.</p></div>

  const isFull = squad.member_count >= SQUAD_SIZE
  const sColor = identityColor(squad.name)

  return (
    <div className={styles.page} style={{ '--squad-accent': sColor }}>
      <button className={styles.backLink} onClick={() => router.push(`/clans/${code}`)}>
        <i className="ri-arrow-left-line"/> {clan.name}
      </button>

      <div className={styles.hero}>
        <span className={styles.heroStripe}/>
        <div className={styles.squadImgLarge}>
          {squad.image_url ? <img src={squad.image_url} alt=""/> : <i className="ri-team-line"/>}
        </div>
        <div className={styles.heroInfo}>
          <h1 className={styles.squadName}>{squad.name}</h1>
          <div className={styles.heroDots}>
            {Array.from({ length: SQUAD_SIZE }).map((_, i) => (
              <span key={i} className={styles.heroDot}
                style={{ background: i < squad.member_count ? sColor : 'var(--border)' }}/>
            ))}
            <span className={styles.heroCount}>{squad.member_count}/{SQUAD_SIZE}</span>
            {isFull && <span className={styles.fullChip}>FULL</span>}
          </div>
        </div>
        {canManage && (
          <button className={styles.editBtn} onClick={openEdit} title="Edit squad">
            <i className="ri-edit-2-line"/>
          </button>
        )}
      </div>

      {!isInThisSquad && isInClanNoSquad && (
        <button className={styles.joinBtn} disabled={isFull} onClick={handleJoinSquad}>
          {isFull ? <><i className="ri-lock-line"/> Squad Full</> : <><i className="ri-user-add-line"/> Join Squad</>}
        </button>
      )}

      {isInThisSquad && (
        <button className={styles.leaveBtn} onClick={() => setConfirmOpen('leave')}>
          <i className="ri-logout-box-line"/> Leave Squad
        </button>
      )}

      <h2 className={styles.sectionLabel}>Roster</h2>
      <div className={styles.memberList}>
        {members.map(m => {
          const online = onlineIds.has(m.user_id)
          return (
            <div key={m.user_id} className={styles.memberRow}>
              <div className={styles.memberLink} onClick={() => setPreviewMember(m)}>
                <div className={styles.memberAvatar}>
                  {m.profiles?.avatar_url
                    ? <img src={m.profiles.avatar_url} alt=""/>
                    : <span>{(m.profiles?.username || '?').slice(0,2).toUpperCase()}</span>
                  }
                  <span className={styles.memberDot} style={{ background: online ? '#22c55e' : 'var(--border-dark)' }}/>
                </div>
                <div className={styles.memberInfo}>
                  <span className={styles.memberName}>
                    {m.profiles?.username}
                    <UserBadges
                      email={m.profiles?.email} plan={m.profiles?.plan} planExpiresAt={m.profiles?.plan_expires_at}
                      countryFlag={m.profiles?.country_flag} isSeasonWinner={m.profiles?.is_season_winner}
                      size={12} gap={2}/>
                  </span>
                  <span className={styles.memberRole}>
                    {m.user_id === squad.leader_id ? <><i className="ri-star-fill"/> Squad Leader</> : 'Member'}
                  </span>
                </div>
              </div>
              {canManage && m.user_id !== user?.id && (
                <button className={styles.kickBtn} onClick={() => askKick(m)} title="Remove from squad">
                  <i className="ri-close-line"/>
                </button>
              )}
            </div>
          )
        })}
      </div>

      {canManage && (
        <div className={styles.dangerZone}>
          <p className={styles.dangerLabel}><i className="ri-error-warning-line"/> Danger Zone</p>
          <p className={styles.dangerDesc}>
            Deletes this squad permanently. All {squad.member_count} member{squad.member_count === 1 ? '' : 's'} will remain in the clan, unassigned.
          </p>
          <button className={styles.deleteSquadBtn} onClick={() => setConfirmOpen('delete_squad')}>
            <i className="ri-delete-bin-line"/> Delete Squad
          </button>
        </div>
      )}

      <Modal open={!!confirmOpen}
        onClose={() => { setConfirmOpen(null); setKickTarget(null); setActionError('') }}
        title={confirmOpen === 'leave' ? 'Leave Squad?' : confirmOpen === 'delete_squad' ? 'Delete Squad?' : 'Remove Member?'}
        size="sm"
        footer={
          <button className={styles.confirmBtn} disabled={acting}
            style={confirmOpen === 'delete_squad' ? { background: '#ef4444' } : {}}
            onClick={confirmOpen === 'leave' ? handleLeaveSquad : confirmOpen === 'delete_squad' ? handleDeleteSquad : handleKick}>
            {acting ? 'Working…' : 'Confirm'}
          </button>
        }>
        <p className={styles.confirmText}>
          {confirmOpen === 'leave' &&
            <>You'll remain in <strong>{clan.name}</strong> but leave this squad. {isSquadLeader && members.length > 1 && 'A new squad leader will be picked at random.'}</>
          }
          {confirmOpen === 'kick' &&
            <>Remove <strong>{kickTarget?.profiles?.username}</strong> from this squad? They'll stay in the clan, unassigned.</>
          }
          {confirmOpen === 'delete_squad' &&
            <>Permanently delete <strong>{squad.name}</strong>? All members will remain in the clan, unassigned. This cannot be undone.</>
          }
        </p>
        {actionError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {actionError}</p>}
      </Modal>

      <Modal open={editOpen} onClose={() => { setEditOpen(false); setEditError('') }}
        title="Edit Squad" size="sm"
        footer={
          <button className={styles.confirmBtn} disabled={savingEdit} onClick={handleSaveEdit}>
            {savingEdit ? 'Saving…' : 'Save Changes'}
          </button>
        }>
        <div className={styles.editModalBody}>
          <div className={styles.field}>
            <label>Squad Image</label>
            <div className={styles.squadImgPicker} onClick={() => imgRef.current?.click()}>
              {editImgPreview ? <img src={editImgPreview} alt=""/> : <i className="ri-image-add-line"/>}
            </div>
            <input ref={imgRef} type="file" accept="image/*" hidden onChange={handleEditImgPick}/>
          </div>
          <div className={styles.field}>
            <label>Squad Name</label>
            <div className={styles.prefixedInput}>
              <span className={styles.prefixLock}>{clan.tag_prefix}</span>
              <input className={styles.suffixInput} value={editSuffix}
                onChange={e => setEditSuffix(e.target.value.replace(/^\s+/, ''))} maxLength={17}/>
            </div>
          </div>
          {editError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {editError}</p>}
        </div>
      </Modal>

      <MemberPreviewModal member={previewMember} squadName={squad.name} onClose={() => setPreviewMember(null)} />
    </div>
  )
}
