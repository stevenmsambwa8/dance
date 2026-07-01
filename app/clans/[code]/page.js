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
import { identityColor } from '../../../lib/clanColors'
import { useOnlineUsers } from '../../../lib/usePresence'
import usePageLoading from '../../../components/usePageLoading'
import MarqueeText from '../../../components/MarqueeText'
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
  const [tournaments, setTournaments] = useState([])
  const [myRole, setMyRole]     = useState(null)
  const [mySquadId, setMySquadId] = useState(null)
  const [activeTab, setActiveTab] = useState('squads')
  const [loading, setLoading]   = useState(true)
  usePageLoading(loading)

  const [createOpen, setCreateOpen]     = useState(false)
  const [squadSuffix, setSquadSuffix]   = useState('')
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

    const [{ data: squadData }, { data: memberData }, { data: tourData }] = await Promise.all([
      supabase.from('clan_squads').select('*').eq('clan_id', clanData.id).order('created_at'),
      supabase.from('clan_members')
        .select('*, profiles(id, username, avatar_url, tier, level, email, plan, plan_expires_at, country_flag, is_season_winner)')
        .eq('clan_id', clanData.id),
      // Real tournament data for this clan's game — active/upcoming, soonest first
      supabase.from('tournaments')
        .select('id, slug, name, status, game_slug, prize, entrance_fee, slots, registered_count, date')
        .eq('game_slug', clanData.game)
        .in('status', ['active', 'ongoing', 'upcoming'])
        .order('date', { ascending: true })
        .limit(4),
    ])

    setClan(clanData)
    setSquads(squadData || [])
    setMembers(memberData || [])
    setTournaments(tourData || [])

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

  function handleSuffixChange(e) {
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
      if (upErr) { setCreateError(`Image upload failed: ${upErr.message}`); setCreating(false); return }
      const { data: pub } = supabase.storage.from('squad-images').getPublicUrl(path)
      image_url = pub.publicUrl
    }

    const { data: squad, error: insertErr } = await supabase
      .from('clan_squads')
      .insert({ clan_id: clan.id, name: fullName, image_url, leader_id: user.id })
      .select().single()

    if (insertErr) { setCreateError(insertErr.message); setCreating(false); return }

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
    await supabase.from('clan_members').insert({ clan_id: clan.id, squad_id: null, user_id: user.id, role: 'member' })
    loadClan()
  }

  if (loading) return <div className={styles.page}><div className={styles.loadingHero}/></div>
  if (!clan)   return <div className={styles.page}><p className={styles.notFound}>Clan not found.</p></div>

  const capPct = Math.min(100, Math.round((clan.member_count / CLAN_CAP) * 100))
  const accentColor = identityColor(clan.name)
  const heroImage = clan.banner_url || clan.logo_url

  return (
    <div className={styles.page}>
      {/* ── Hero ── */}
      <div className={styles.hero}
        style={{
          '--clan-accent': accentColor,
          backgroundImage: heroImage ? `url(${heroImage})` : 'none',
          backgroundColor: heroImage ? undefined : accentColor,
        }}>
        <span className={`${styles.heroOverlay} ${heroImage ? styles.heroOverlayGradient : styles.heroOverlayFlat}`}/>
        <div className={styles.heroContent}>
          <div className={styles.logoLarge}>
            {clan.logo_url ? <img src={clan.logo_url} alt=""/> : <span>{clan.tag_prefix}</span>}
            <span className={styles.logoRing}/>
          </div>
          <div className={styles.heroText}>
            <h1 className={styles.clanName}>{clan.name}</h1>
            <p className={styles.clanGame}>
              {GAME_META[clan.game]?.image
                ? <img src={GAME_META[clan.game].image} alt="" className={styles.clanGameImg}/>
                : <i className={GAME_META[clan.game]?.icon}/>}
              {GAME_META[clan.game]?.name}
              {' '}<span className={styles.tagChip}>{clan.tag_prefix}</span>
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

      {/* ── Member capacity, segmented by squad ── */}
      <div className={styles.deployWrap}>
        <div className={styles.deployHeader}>
          <span className={styles.deployLabel}>
            <i className="ri-group-line"/> Capacity
          </span>
          <span className={styles.deployReadout}>{clan.member_count}<span className={styles.deploySlash}>/{CLAN_CAP}</span></span>
        </div>
        <div className={styles.deploySegments}>
          {Array.from({ length: SQUAD_CAP }).map((_, i) => {
            const squad = squads[i]
            const filled = squad ? squad.member_count / SQUAD_SIZE : 0
            return (
              <div key={i} className={styles.deploySeg}>
                <div className={styles.deploySegFill}
                  style={{
                    height: `${filled * 100}%`,
                    background: squad ? identityColor(squad.name) : 'var(--border)',
                  }}/>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className={styles.statsRow}>
        <div className={styles.statBox}>
          <span className={styles.statNum}>{clan.squad_count}<span className={styles.statMax}>/{SQUAD_CAP}</span></span>
          <span className={styles.statLabel}>Squads</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statNum}>{clan.total_wins || 0}</span>
          <span className={styles.statLabel}>Total Wins</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statNum}>{capPct}<span className={styles.statMax}>%</span></span>
          <span className={styles.statLabel}>Filled</span>
        </div>
      </div>

      {!inClan && (
        <button className={styles.joinBtn} disabled={clan.member_count >= CLAN_CAP} onClick={handleJoinClan}
          style={{ '--clan-accent': accentColor }}>
          {clan.member_count >= CLAN_CAP
            ? <><i className="ri-lock-line"/> Clan Full</>
            : <><i className="ri-user-add-line"/> Join Clan</>
          }
        </button>
      )}

      {/* ── Clan Wars — real tournament data, styled like the tournament listing cards ── */}
      {tournaments.length > 0 && (
        <div className={styles.warsSection}>
          <p className={styles.sectionLabel}><i className="ri-sword-line"/> CLAN WARS · {GAME_META[clan.game]?.name}</p>
          <div className={styles.warsScroll}>
            {tournaments.map(t => {
              const pct = t.slots ? Math.round(((t.registered_count || 0) / t.slots) * 100) : 0
              const isFull = (t.registered_count || 0) >= t.slots
              const isLive = t.status === 'active' || t.status === 'ongoing'
              const hasFee = !!Number(String(t.entrance_fee || '').replace(/[^0-9.]/g, ''))
              return (
                <Link key={t.id} href={`/tournaments/${t.slug || t.id}`} className={styles.warCard}>
                  <div className={styles.warBanner}>
                    {GAME_META[t.game_slug]?.image
                      ? <img src={GAME_META[t.game_slug].image} alt="" className={styles.warBannerImg}/>
                      : <div className={styles.warBannerFallback}><i className="ri-gamepad-line"/></div>}
                    <div className={styles.warBannerOverlay}>
                      <span className={`${styles.warStatusBadge} ${isLive ? styles.warStatusLive : styles.warStatusSoon}`}>
                        {isLive ? 'LIVE' : 'SOON'}
                      </span>
                      {hasFee && <span className={styles.warFeeBadge}><i className="ri-money-dollar-circle-line"/> Paid</span>}
                    </div>
                    {isFull && <span className={styles.warFullPip}><i className="ri-lock-line"/></span>}
                  </div>
                  <div className={styles.warBody}>
                    <p className={styles.warName}>{t.name}</p>
                    <div className={styles.warStatsRow}>
                      {t.prize && (
                        <span className={styles.warStatChip} style={{ color: '#22c55e' }}>
                          <i className="ri-trophy-line"/> {t.prize}
                        </span>
                      )}
                      <span className={styles.warStatChip}>
                        <i className="ri-group-line"/> {t.registered_count || 0}/{t.slots}
                      </span>
                    </div>
                    <div className={styles.warSlotTrack}>
                      <div className={styles.warSlotFill}
                        style={{ width: `${pct}%`, background: isFull ? '#dc2626' : pct >= 80 ? '#f97316' : 'var(--text-dim)' }}/>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${activeTab === 'squads' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('squads')}>
          Squads <span className={styles.tabCount}>{squads.length}</span>
        </button>
        <button className={`${styles.tab} ${activeTab === 'members' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('members')}>
          Members <span className={styles.tabCount}>{members.length}</span>
        </button>
      </div>

      {/* ── Squads — image tiles, same style as the clan listing ── */}
      {activeTab === 'squads' && (
        <div className={styles.squadGrid}>
          {squads.map(squad => {
            const sColor = identityColor(squad.name)
            const isFull = squad.member_count >= SQUAD_SIZE
            const sqImage = squad.image_url
            return (
              <Link key={squad.code} href={`/clans/${clan.code}/squads/${squad.code}`}
                className={styles.squadCard}
                style={{
                  '--squad-accent': sColor,
                  backgroundImage: sqImage ? `url(${sqImage})` : 'none',
                  backgroundColor: sqImage ? undefined : sColor,
                }}>
                <span className={`${styles.tileOverlay} ${sqImage ? styles.tileOverlayGradient : styles.tileOverlayFlat}`}/>
                {isFull && <span className={styles.fullTag}>FULL</span>}
                <div className={styles.squadCardContent}>
                  <MarqueeText text={squad.name} wrapClassName={styles.squadNameWrap} textClassName={styles.squadName}/>
                  <div className={styles.squadDots}>
                    {Array.from({ length: SQUAD_SIZE }).map((_, i) => (
                      <span key={i} className={styles.squadDot}
                        style={{ background: i < squad.member_count ? sColor : 'rgba(128,128,128,0.35)' }}/>
                    ))}
                  </div>
                </div>
              </Link>
            )
          })}

          {inClan && !mySquadId && squads.length < SQUAD_CAP && (
            <button className={styles.createSquadCard} onClick={openCreateSquad}>
              <i className="ri-add-line"/>
              <span>Form a Squad</span>
            </button>
          )}

          {squads.length === 0 && !inClan && (
            <p className={styles.emptyTabText}>No squads yet.</p>
          )}
        </div>
      )}

      {/* ── Members — avatar-bg tiles, same style as squads/clans ── */}
      {activeTab === 'members' && (
        <div className={styles.memberGrid}>
          {members.map(m => {
            const online = onlineIds.has(m.user_id)
            const squadOfMember = squads.find(s => s.id === m.squad_id)
            const avatar = m.profiles?.avatar_url
            const memberColor = identityColor(m.profiles?.username || m.user_id)
            return (
              <div key={m.user_id} className={styles.memberCard}
                onClick={() => setPreviewMember(m)}
                style={{
                  backgroundImage: avatar ? `url(${avatar})` : 'none',
                  backgroundColor: avatar ? undefined : memberColor,
                }}>
                <span className={`${styles.tileOverlay} ${avatar ? styles.tileOverlayGradient : styles.tileOverlayFlat}`}/>

                {squadOfMember && (
                  <span className={styles.memberSquadBadge} style={{ background: identityColor(squadOfMember.name) }}>
                    {squadOfMember.name}
                  </span>
                )}
                {m.role === 'leader' && (
                  <span className={styles.memberCrown}><i className="ri-vip-crown-line"/></span>
                )}
                <span className={styles.memberOnlineDot} style={{ background: online ? '#22c55e' : 'rgba(128,128,128,0.5)' }}/>

                <div className={styles.memberCardContent}>
                  <div className={styles.memberNameRow}>
                    <MarqueeText text={m.profiles?.username || 'Player'} wrapClassName={styles.memberNameWrap} textClassName={styles.memberName}/>
                    <UserBadges
                      email={m.profiles?.email} plan={m.profiles?.plan} planExpiresAt={m.profiles?.plan_expires_at}
                      countryFlag={m.profiles?.country_flag} isSeasonWinner={m.profiles?.is_season_winner}
                      size={11} gap={2}/>
                  </div>
                  <span className={styles.memberRoleText}>
                    {m.role === 'leader' ? 'Clan Leader' :
                     m.role === 'squad_leader' ? `Squad Leader · ${squadOfMember?.name || ''}` :
                     squadOfMember ? squadOfMember.name : 'Unassigned'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Create Squad Modal ── */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setCreateError('') }}
        title="Form a Squad" size="sm"
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
              <input className={styles.suffixInput} placeholder="Raiders"
                value={squadSuffix} onChange={handleSuffixChange} maxLength={17} autoFocus/>
            </div>
          </div>
          {createError && <p className={styles.errorMsg}><i className="ri-error-warning-line"/> {createError}</p>}
        </div>
      </Modal>

      <MemberPreviewModal
        member={previewMember}
        squadName={squads.find(s => s.id === previewMember?.squad_id)?.name}
        onClose={() => setPreviewMember(null)}
      />
    </div>
  )
}
