'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Modal from '../../../../../components/Modal'
import MemberPreviewModal from '../../../../../components/MemberPreviewModal'
import UserBadges from '../../../../../components/UserBadges'
import { useAuth } from '../../../../../components/AuthProvider'
import { useAuthGate } from '../../../../../components/AuthGateModal'
import { supabase } from '../../../../../lib/supabase'
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

  const [clan, setClan]       = useState(null)
  const [squad, setSquad]     = useState(null)
  const [members, setMembers] = useState([])
  const [myMembership, setMyMembership] = useState(null) // clan_members row for current user
  const [loading, setLoading] = useState(true)
  usePageLoading(loading)

  const [confirmOpen, setConfirmOpen] = useState(null) // 'leave' | 'kick' | null
  const [kickTarget, setKickTarget]   = useState(null)
  const [acting, setActing]           = useState(false)

  const [previewMember, setPreviewMember] = useState(null)

  // Edit squad (squad leader only)
  const [editOpen, setEditOpen]       = useState(false)
  const [editSuffix, setEditSuffix]   = useState('')
  const [editImgFile, setEditImgFile] = useState(null)
  const [editImgPreview, setEditImgPreview] = useState(null)
  const [editSaving, setEditSaving]   = useState(false)
  const [editError, setEditError]     = useState('')

  // Delete squad (squad leader only)
  const [deleteOpen, setDeleteOpen]       = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState('')

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

    if (user) {
      const { data: mine } = await supabase.from('clan_members')
        .select('*').eq('clan_id', clanData.id).eq('user_id', user.id).maybeSingle()
      setMyMembership(mine || null)
    }
    setLoading(false)
  }

  const isInThisSquad = myMembership?.squad_id === squad?.id
  const isSquadLeader = squad?.leader_id === user?.id
  const isClanLeader  = clan?.leader_id === user?.id
  const isInClanNoSquad = myMembership && !myMembership.squad_id

  async function handleJoinSquad() {
    if (!user) { openAuthGate(); return }
    if (!myMembership) {
      router.push(`/clans/${code}`) // must join clan first
      return
    }
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
    await supabase.from('clan_members')
      .update({ squad_id: null, role: 'member' })
      .eq('id', kickTarget.id)

    if (squad.leader_id === kickTarget.user_id) {
      await supabase.rpc('reassign_squad_leader', { p_squad_id: squad.id })
    }
    setActing(false)
    setConfirmOpen(null)
    setKickTarget(null)
    loadAll()
  }

  // ── Edit squad (squad leader only) ──
  function openEditSquad() {
    if (!isSquadLeader) return
    const prefix = clan.tag_prefix || ''
    setEditSuffix(squad.name.startsWith(prefix) ? squad.name.slice(prefix.length) : squad.name)
    setEditImgFile(null)
    setEditImgPreview(squad.image_url)
    setEditError('')
    setEditOpen(true)
  }

  function handleEditImgPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setEditImgFile(file)
    setEditImgPreview(URL.createObjectURL(file))
  }

  async function handleSaveSquad() {
    if (!isSquadLeader || !squad) return
    const suffix = editSuffix.trim()
    if (!suffix) { setEditError('Squad name is required.'); return }

    setEditSaving(true)
    setEditError('')

    let image_url = squad.image_url
    if (editImgFile) {
      const ext = editImgFile.name.split('.').pop()
      const path = `${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('squad-images').upload(path, editImgFile)
      if (upErr) {
        setEditError(`Image upload failed: ${upErr.message}`)
        setEditSaving(false)
        return
      }
      const { data: pub } = supabase.storage.from('squad-images').getPublicUrl(path)
      image_url = pub.publicUrl
    }

    const { error } = await supabase
      .from('clan_squads')
      .update({ name: `${clan.tag_prefix}${suffix}`, image_url })
      .eq('id', squad.id)

    if (error) {
      setEditError(error.message)
      setEditSaving(false)
      return
    }

    setEditSaving(false)
    setEditOpen(false)
    loadAll()
  }

  // ── Delete squad (squad leader only) ──
  async function handleDeleteSquad() {
    if (!isSquadLeader || !squad) return
    if (deleteConfirmText.trim() !== squad.name) {
      setDeleteError(`Type "${squad.name}" exactly to confirm.`)
      return
    }
    setDeleting(true)
    setDeleteError('')

    // Unassign all members from the squad before removing it
    await supabase.from('clan_members')
      .update({ squad_id: null, role: 'member' })
      .eq('squad_id', squad.id)

    const { error } = await supabase.from('clan_squads').delete().eq('id', squad.id)

    if (error) {
      setDeleteError(error.message)
      setDeleting(false)
      return
    }

    setDeleting(false)
    setDeleteOpen(false)
    router.push(`/clans/${code}`)
  }

  if (loading) return <div className={styles.page}><div className={styles.loadingBox}/></div>
  if (!clan)   return <div className={styles.page}><p className={styles.notFound}>Clan not found.</p></div>
  if (!squad)  return <div className={styles.page}><p className={styles.notFound}>Squad not found.</p></div>

  const isFull = squad.member_count >= SQUAD_SIZE
  // Squad-scoped management (edit details, remove players, delete squad) is
  // exclusive to the squad leader — the clan leader does not have authority
  // inside a squad they don't lead.
  const canManage = isSquadLeader

  return (
    <div className={styles.page}>
      <button className={styles.backLink} onClick={() => router.push(`/clans/${code}`)}>
        <i className="ri-arrow-left-line"/> Back to {clan.name}
      </button>

      <div className={styles.hero}>
        <div className={styles.squadImgLarge}>
          {squad.image_url ? <img src={squad.image_url} alt=""/> : <i className="ri-team-line"/>}
        </div>
        <div>
          <h1 className={styles.squadName}>{squad.name}</h1>
          <p className={styles.squadMeta}>
            {squad.member_count}/{SQUAD_SIZE} members
            {isFull && <span className={styles.fullChip}>FULL</span>}
          </p>
        </div>

        {isSquadLeader && (
          <button className={styles.manageBtn} onClick={openEditSquad}>
            <i className="ri-settings-3-line"/>
          </button>
        )}
      </div>

      {/* Join CTA */}
      {!isInThisSquad && isInClanNoSquad && (
        <button className={styles.joinBtn} disabled={isFull} onClick={handleJoinSquad}>
          {isFull ? <><i className="ri-lock-line"/> Squad Full</> : <><i className="ri-user-add-line"/> Join Squad</>}
        </button>
      )}

      {/* Leave CTA */}
      {isInThisSquad && (
        <button className={styles.leaveBtn} onClick={() => setConfirmOpen('leave')}>
          <i className="ri-logout-box-line"/> Leave Squad
        </button>
      )}

      <h2 className={styles.sectionLabel}>Members</h2>
      <div className={styles.memberList}>
        {members.map(m => {
          const online = onlineIds.has(m.user_id)
          return (
            <div key={m.user_id} className={styles.memberRow}>
              <div className={styles.memberLink} onClick={() => setPreviewMember(m)} style={{ cursor: 'pointer' }}>
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
                      email={m.profiles?.email}
                      plan={m.profiles?.plan}
                      planExpiresAt={m.profiles?.plan_expires_at}
                      countryFlag={m.profiles?.country_flag}
                      isSeasonWinner={m.profiles?.is_season_winner}
                      size={13}
                    />
                  </span>
                  <span className={styles.memberRole}>
                    {m.user_id === squad.leader_id
                      ? <><i className="ri-star-fill"/> Squad Leader</>
                      : 'Member'}
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

      {/* Confirm modal */}
      <Modal open={!!confirmOpen} onClose={() => { setConfirmOpen(null); setKickTarget(null) }}
        title={confirmOpen === 'leave' ? 'Leave Squad?' : 'Remove Member?'} size="sm"
        footer={
          <button className={styles.confirmBtn} disabled={acting}
            onClick={confirmOpen === 'leave' ? handleLeaveSquad : handleKick}>
            {acting ? 'Working…' : 'Confirm'}
          </button>
        }>
        <p className={styles.confirmText}>
          {confirmOpen === 'leave'
            ? <>You'll remain in <strong>{clan.name}</strong> but leave this squad. {isSquadLeader && members.length > 1 && 'A new squad leader will be picked at random.'}</>
            : <>Remove <strong>{kickTarget?.profiles?.username}</strong> from this squad? They'll stay in the clan, unassigned.</>
          }
        </p>
      </Modal>

      <MemberPreviewModal
        member={previewMember}
        squadName={squad.name}
        onClose={() => setPreviewMember(null)}
      />

      {/* ── Edit Squad Modal (squad leader only) ── */}
      <Modal open={editOpen} onClose={() => { setEditOpen(false); setEditError('') }}
        title="Edit Squad" size="sm"
        footer={
          <button className={styles.confirmBtn} disabled={editSaving} onClick={handleSaveSquad}>
            {editSaving ? 'Saving…' : 'Save Changes'}
          </button>
        }>
        <div className={styles.modalBody}>
          <div className={styles.field}>
            <label>Squad Image</label>
            <div className={styles.squadImgPicker} onClick={() => document.getElementById('sq-edit-img-input').click()}>
              {editImgPreview ? <img src={editImgPreview} alt=""/> : <i className="ri-image-add-line"/>}
            </div>
            <input id="sq-edit-img-input" type="file" accept="image/*" hidden onChange={handleEditImgPick}/>
          </div>
          <div className={styles.field}>
            <label>Squad Name</label>
            <div className={styles.prefixedInput}>
              <span className={styles.prefixLock}>{clan.tag_prefix}</span>
              <input className={styles.suffixInput}
                value={editSuffix}
                onChange={e => setEditSuffix(e.target.value.replace(/^\s+/, ''))}
                maxLength={17}/>
            </div>
          </div>
          {editError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {editError}</p>}

          <div className={styles.dangerZone}>
            <p className={styles.dangerLabel}><i className="ri-error-warning-line"/> Danger Zone</p>
            <p className={styles.dangerDesc}>
              Permanently deletes this squad and unassigns all {squad.member_count} member{squad.member_count === 1 ? '' : 's'}. This cannot be undone.
            </p>
            <button className={styles.deleteBtn} onClick={() => { setEditOpen(false); setDeleteOpen(true) }}>
              <i className="ri-delete-bin-line"/> Delete Squad
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Squad Modal (squad leader only) ── */}
      <Modal open={deleteOpen} onClose={() => { setDeleteOpen(false); setDeleteConfirmText(''); setDeleteError('') }}
        title="Delete Squad" size="sm"
        footer={
          <button className={styles.deleteConfirmBtn} disabled={deleting} onClick={handleDeleteSquad}>
            {deleting ? 'Deleting…' : 'Permanently Delete'}
          </button>
        }>
        <div className={styles.deleteModalBody}>
          <p className={styles.confirmText}>
            This will permanently delete <strong>{squad.name}</strong> and unassign all <strong>{squad.member_count}</strong> member{squad.member_count === 1 ? '' : 's'}.
            This action <strong>cannot be undone</strong>.
          </p>
          <div className={styles.field}>
            <label>Type "{squad.name}" to confirm</label>
            <input className={styles.textInput}
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={squad.name}/>
          </div>
          {deleteError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {deleteError}</p>}
        </div>
      </Modal>
    </div>
  )
}
