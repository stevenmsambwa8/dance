'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Modal from '../../../components/Modal'
import MemberPreviewModal from '../../../components/MemberPreviewModal'
import UserBadges from '../../../components/UserBadges'
import { useAuth } from '../../../components/AuthProvider'
import { useAuthGate } from '../../../components/AuthGateModal'
import { supabase } from '../../../lib/supabase'
import { GAME_META } from '../../../lib/constants'
import { useOnlineUsers } from '../../../lib/usePresence'
import usePageLoading from '../../../components/usePageLoading'
import styles from './page.module.css'

const CLAN_CAP   = 125
const SQUAD_CAP  = 25
const SQUAD_SIZE = 5

export default function ClanPage() {
  const { code } = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const { openAuthGate } = useAuthGate()
  const onlineIds = useOnlineUsers()

  const [clan, setClan]         = useState(null)
  const [squads, setSquads]     = useState([])
  const [members, setMembers]   = useState([])
  const [myRole, setMyRole]     = useState(null)
  const [mySquadId, setMySquadId] = useState(null)
  const [activeTab, setActiveTab] = useState('squads')
  const [loading, setLoading]   = useState(true)
  usePageLoading(loading)

  const [createOpen, setCreateOpen]     = useState(false)
  const [squadSuffix, setSquadSuffix]   = useState('') // user only types this part
  const [squadImgFile, setSquadImgFile] = useState(null)
  const [squadImgPreview, setSquadImgPreview] = useState(null)
  const [creating, setCreating]         = useState(false)
  const [createError, setCreateError]   = useState('')

  const [previewMember, setPreviewMember] = useState(null)

  useEffect(() => { if (code) loadClan() }, [code, user])

  async function loadClan() {
    setLoading(true)
    const { data: clanData } = await supabase.from('clans').select('*').eq('code', code).single()

    if (!clanData) { setClan(null); setLoading(false); return }

    const [{ data: squadData }, { data: memberData }] = await Promise.all([
      supabase.from('clan_squads').select('*').eq('clan_id', clanData.id).order('created_at'),
      supabase.from('clan_members')
        .select('*, profiles(id, username, avatar_url, tier, level, email, plan, plan_expires_at, country_flag, is_season_winner)')
        .eq('clan_id', clanData.id),
    ])

    setClan(clanData)
    setSquads(squadData || [])
    setMembers(memberData || [])

    if (user) {
      const mine = (memberData || []).find(m => m.user_id === user.id)
      setMyRole(mine?.role || null)
      setMySquadId(mine?.squad_id || null)
    }
    setLoading(false)
  }

  const isLeader = myRole === 'leader'
  const inClan   = !!myRole

  function openCreateSquad() {
    if (!user) { openAuthGate(); return }
    if (!inClan) return
    if (squads.length >= SQUAD_CAP) return
    setCreateOpen(true)
  }

  function handleSquadImgPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSquadImgFile(file)
    setSquadImgPreview(URL.createObjectURL(file))
  }

  // User types only the suffix; prefix is locked and prepended automatically.
  function handleSuffixChange(e) {
    // Strip whitespace at the start so "  Raiders" doesn't become "BIK  Raiders"
    setSquadSuffix(e.target.value.replace(/^\s+/, ''))
  }

  async function handleCreateSquad() {
    if (!user || !clan) return
    const suffix = squadSuffix.trim()
    if (!suffix) { setCreateError('Squad name is required.'); return }

    const fullName = `${clan.tag_prefix}${suffix}`

    if (squads.length >= SQUAD_CAP) { setCreateError('This clan has reached the 25-squad limit.'); return }

    setCreating(true)
    setCreateError('')

    let image_url = null
    if (squadImgFile) {
      const ext = squadImgFile.name.split('.').pop()
      const path = `${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('squad-images').upload(path, squadImgFile)
      if (upErr) {
        setCreateError(`Image upload failed: ${upErr.message}`)
        setCreating(false)
        return
      }
      const { data: pub } = supabase.storage.from('squad-images').getPublicUrl(path)
      image_url = pub.publicUrl
    }

    const { data: squad, error: insertErr } = await supabase
      .from('clan_squads')
      .insert({
        clan_id: clan.id,
        name: fullName,
        image_url,
        leader_id: user.id,
      })
      .select()
      .single()

    if (insertErr) {
      setCreateError(insertErr.message)
      setCreating(false)
      return
    }

    await supabase.from('clan_members')
      .update({ squad_id: squad.id, role: myRole === 'leader' ? 'leader' : 'squad_leader' })
      .eq('clan_id', clan.id).eq('user_id', user.id)

    setCreating(false)
    setCreateOpen(false)
    setSquadSuffix('')
    setSquadImgFile(null)
    setSquadImgPreview(null)
    loadClan()
  }

  async function handleJoinClan() {
    if (!user) { openAuthGate(); return }
    if (!clan || clan.member_count >= CLAN_CAP) return
    await supabase.from('clan_members').insert({
      clan_id: clan.id, squad_id: null, user_id: user.id, role: 'member',
    })
    loadClan()
  }

  if (loading) {
    return <div className={styles.page}><div className={styles.loadingHero}/></div>
  }

  if (!clan) {
    return <div className={styles.page}><p className={styles.notFound}>Clan not found.</p></div>
  }

  const capPct = Math.min(100, Math.round((clan.member_count / CLAN_CAP) * 100))

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        {clan.banner_url && <img className={styles.bannerImg} src={clan.banner_url} alt=""/>}
        <div className={styles.heroContent}>
          <div className={styles.logoLarge}>
            {clan.logo_url ? <img src={clan.logo_url} alt=""/> : <span>{clan.tag_prefix}</span>}
          </div>
          <div>
            <h1 className={styles.clanName}>{clan.name}</h1>
            <p className={styles.clanGame}>
              <i className={GAME_META[clan.game]?.icon}/> {GAME_META[clan.game]?.name}
              {' · '}<span className={styles.tagChip}>{clan.tag_prefix}</span>
            </p>
          </div>
        </div>

        {isLeader && (
          <button className={styles.manageBtn} onClick={() => router.push(`/clans/${clan.code}/manage`)}>
            <i className="ri-settings-3-line"/>
          </button>
        )}
      </div>

      {clan.description && <p className={styles.description}>{clan.description}</p>}

      <div className={styles.statsRow}>
        <div className={styles.statBox}>
          <span className={styles.statNum}>{clan.member_count}/{CLAN_CAP}</span>
          <span className={styles.statLabel}>Members</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statNum}>{clan.squad_count}/{SQUAD_CAP}</span>
          <span className={styles.statLabel}>Squads</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statNum}>{clan.total_wins || 0}</span>
          <span className={styles.statLabel}>Total Wins</span>
        </div>
      </div>
      <div className={styles.capBarOuter}>
        <div className={styles.capBarFill} style={{ width: `${capPct}%` }}/>
      </div>

      {!inClan && (
        <button className={styles.joinBtn}
          disabled={clan.member_count >= CLAN_CAP}
          onClick={handleJoinClan}>
          {clan.member_count >= CLAN_CAP
            ? <><i className="ri-lock-line"/> Clan Full</>
            : <><i className="ri-user-add-line"/> Join Clan</>
          }
        </button>
      )}

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${activeTab === 'squads' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('squads')}>Squads</button>
        <button className={`${styles.tab} ${activeTab === 'members' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('members')}>Members</button>
      </div>

      {activeTab === 'squads' && (
        <div className={styles.squadGrid}>
          {squads.map(squad => (
            <Link key={squad.code} href={`/clans/${clan.code}/squads/${squad.code}`} className={styles.squadCard}>
              <div className={styles.squadImg}>
                {squad.image_url ? <img src={squad.image_url} alt=""/> : <i className="ri-team-line"/>}
              </div>
              <div className={styles.squadInfo}>
                <span className={styles.squadName}>{squad.name}</span>
                <span className={styles.squadMeta}>{squad.member_count}/{SQUAD_SIZE} members</span>
              </div>
              {squad.member_count >= SQUAD_SIZE && <span className={styles.fullTag}>FULL</span>}
            </Link>
          ))}

          {inClan && !mySquadId && squads.length < SQUAD_CAP && (
            <button className={styles.createSquadCard} onClick={openCreateSquad}>
              <i className="ri-add-line"/>
              <span>Create a Squad</span>
            </button>
          )}

          {squads.length === 0 && !inClan && (
            <p className={styles.emptyTabText}>No squads yet.</p>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div className={styles.memberList}>
          {members.map(m => {
            const online = onlineIds.has(m.user_id)
            const squadOfMember = squads.find(s => s.id === m.squad_id)
            return (
              <div key={m.user_id} className={styles.memberRow}
                onClick={() => setPreviewMember(m)} style={{ cursor: 'pointer' }}>
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
                    {m.role === 'leader' ? <><i className="ri-vip-crown-line"/> Clan Leader</> :
                     m.role === 'squad_leader' ? <><i className="ri-star-line"/> Squad Leader</> :
                     'Member'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <MemberPreviewModal
        member={previewMember}
        squadName={squads.find(s => s.id === previewMember?.squad_id)?.name}
        onClose={() => setPreviewMember(null)}
      />

      {/* ── Create Squad Modal — prefix locked & shown inline ── */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setCreateError('') }}
        title="Create a Squad" size="sm"
        footer={
          <button className={styles.submitBtn} disabled={creating} onClick={handleCreateSquad}>
            {creating ? 'Creating…' : 'Create Squad'}
          </button>
        }>
        <div className={styles.modalBody}>
          <div className={styles.field}>
            <label>Squad Image</label>
            <div className={styles.squadImgPicker} onClick={() => document.getElementById('sq-img-input').click()}>
              {squadImgPreview ? <img src={squadImgPreview} alt=""/> : <i className="ri-image-add-line"/>}
            </div>
            <input id="sq-img-input" type="file" accept="image/*" hidden onChange={handleSquadImgPick}/>
          </div>
          <div className={styles.field}>
            <label>Squad Name</label>
            <div className={styles.prefixedInput}>
              <span className={styles.prefixLock}>{clan.tag_prefix}</span>
              <input className={styles.suffixInput}
                placeholder="Raiders"
                value={squadSuffix}
                onChange={handleSuffixChange}
                maxLength={17}
                autoFocus/>
            </div>
          </div>
          {createError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {createError}</p>}
        </div>
      </Modal>
    </div>
  )
}
