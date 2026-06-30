'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Modal from '../../../../../components/Modal'
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

  useEffect(() => { if (code && squadCode) loadAll() }, [code, squadCode, user])

  async function loadAll() {
    setLoading(true)
    const { data: clanData } = await supabase.from('clans').select('*').eq('code', code).single()
    if (!clanData) { setClan(null); setLoading(false); return }

    const { data: squadData } = await supabase.from('clan_squads')
      .select('*').eq('code', squadCode).eq('clan_id', clanData.id).single()
    if (!squadData) { setSquad(null); setClan(clanData); setLoading(false); return }

    const { data: memberData } = await supabase.from('clan_members')
      .select('*, profiles(id, username, avatar_url, tier, level)')
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

  if (loading) return <div className={styles.page}><div className={styles.loadingBox}/></div>
  if (!clan)   return <div className={styles.page}><p className={styles.notFound}>Clan not found.</p></div>
  if (!squad)  return <div className={styles.page}><p className={styles.notFound}>Squad not found.</p></div>

  const isFull = squad.member_count >= SQUAD_SIZE
  const canManage = isSquadLeader || isClanLeader

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
              <Link href={`/profile/${m.user_id}`} className={styles.memberLink}>
                <div className={styles.memberAvatar}>
                  {m.profiles?.avatar_url
                    ? <img src={m.profiles.avatar_url} alt=""/>
                    : <span>{(m.profiles?.username || '?').slice(0,2).toUpperCase()}</span>
                  }
                  <span className={styles.memberDot} style={{ background: online ? '#22c55e' : 'var(--border-dark)' }}/>
                </div>
                <div className={styles.memberInfo}>
                  <span className={styles.memberName}>{m.profiles?.username}</span>
                  <span className={styles.memberRole}>
                    {m.user_id === squad.leader_id
                      ? <><i className="ri-star-fill"/> Squad Leader</>
                      : 'Member'}
                  </span>
                </div>
              </Link>
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
    </div>
  )
}
