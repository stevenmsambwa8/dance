'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, ADMIN_EMAIL } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { RANK_TIERS, GAME_META, GAME_SLUGS } from '../../lib/constants'
import { getTierTheme } from '../../lib/tierTheme'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'

function makeMatchCode(id) {
  if (!id) return '0000'
  const clean = id.replace(/-/g, '')
  return ((clean[0] || '0') + (clean[2] || '0') + (clean[9] || '0') + (clean[14] || '0')).toLowerCase()
}

const TABS = ['Overview', 'Todos', 'Masters', 'Users', 'Posts', 'Tournaments', 'Battles', 'Shop', 'Notifications']

const TAB_ICONS = {
  Overview:      'ri-dashboard-3-line',
  Todos:         'ri-checkbox-multiple-line',
  Masters:       'ri-crown-line',
  Users:         'ri-group-line',
  Posts:         'ri-article-line',
  Tournaments:   'ri-trophy-line',
  Battles:       'ri-sword-line',
  Shop:          'ri-store-2-line',
  Notifications: 'ri-notification-3-line',
}

function fmtDate(iso, short) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', short
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: '2-digit' })
}

function Badge({ color, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
      background: `${color}18`, color, border: `1px solid ${color}35`,
      letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function ActionRow({ children }) {
  return <div className={styles.actionRow}>{children}</div>
}

export default function Dashboard() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState('Overview')
  const [stats, setStats] = useState({})
  const [users, setUsers] = useState([])
  const [posts, setPosts] = useState([])
  const [tournaments, setTournaments] = useState([])
  const [battles, setBattles] = useState([])
  const [shopItems, setShopItems] = useState([])
  const [dataLoading, setDataLoading] = useState(true)
  usePageLoading(authLoading || dataLoading)

  const [todos, setTodos] = useState([])
  const [todosLoading, setTodosLoading] = useState(false)
  const [tournamentPayments, setTournamentPayments] = useState([])
  const [tournamentPaymentsLoading, setTournamentPaymentsLoading] = useState(false)

  // ── Game Masters ──
  const [allMasters, setAllMasters] = useState([])
  const [mastersLoading, setMastersLoading] = useState(false)
  const [crownModal, setCrownModal] = useState(null) // { gameSlug }
  const [crownSearch, setCrownSearch] = useState('')
  const [crownResults, setCrownResults] = useState([])
  const [crownSearching, setCrownSearching] = useState(false)
  const [crownSelected, setCrownSelected] = useState(null)
  const [crownSaving, setCrownSaving] = useState(false)
  const [crownSuccess, setCrownSuccess] = useState(null)

  // Notification composer
  const [notifForm, setNotifForm] = useState({
    target: 'all', targetUserId: '', targetUsername: '',
    title: '', body: '', type: 'announcement', ctaLabel: '', ctaLink: '',
  })
  const [notifSending, setNotifSending] = useState(false)
  const [notifResult, setNotifResult] = useState(null)
  const [notifHistory, setNotifHistory] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState([])
  const [searching, setSearching] = useState(false)

  // Edit states
  const [editUser, setEditUser] = useState(null)
  const [editUserPhoneCode, setEditUserPhoneCode] = useState('255')
  const [editUserPhoneLocal, setEditUserPhoneLocal] = useState('')
  const [editPost, setEditPost] = useState(null)
  const [editTournament, setEditTournament] = useState(null)
  const [editShop, setEditShop] = useState(null)
  const [editBattle, setEditBattle] = useState(null)
  const [battleModal, setBattleModal] = useState(false)
  const [battleForm, setBattleForm] = useState({ player1: '', player2: '', game_mode: '', format: '', scheduled_at: '' })
  const [battleCreating, setBattleCreating] = useState(false)

  useEffect(() => { if (!authLoading && !isAdmin) router.replace('/') }, [authLoading, isAdmin])
  useEffect(() => { if (isAdmin) loadAll() }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    const ch = supabase.channel('admin-tournament-payments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tournament_payments' }, () => loadTournamentPayments())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [isAdmin])

  useEffect(() => {
    if (isAdmin && tab === 'Todos') { loadTodos(); loadTournamentPayments() }
    if (isAdmin && tab === 'Masters') loadAllMasters()
  }, [isAdmin, tab])

  // ── Data loaders ──
  async function loadAll() {
    setDataLoading(true)
    const [
      { count: userCount }, { count: postCount }, { count: tournCount }, { count: matchCount },
      { data: recentUsers }, { data: recentPosts }, { data: recentTourns },
      { data: recentBattles }, { data: shopData }
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('posts').select('*', { count: 'exact', head: true }),
      supabase.from('tournaments').select('*', { count: 'exact', head: true }),
      supabase.from('matches').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('posts').select('id, user_id, content, likes, comment_count, created_at, profiles(username)').order('created_at', { ascending: false }).limit(50),
      supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('matches').select('*, challenger:profiles!matches_challenger_id_fkey(username), challenged:profiles!matches_challenged_id_fkey(username)').order('created_at', { ascending: false }).limit(50),
      supabase.from('shop_items').select('*, profiles(username)').order('created_at', { ascending: false }).limit(50),
    ])
    setStats({ users: userCount || 0, posts: postCount || 0, tournaments: tournCount || 0, matches: matchCount || 0 })
    setUsers(recentUsers || [])
    setPosts(recentPosts || [])
    setTournaments(recentTourns || [])
    setBattles(recentBattles || [])
    setShopItems(shopData || [])
    setDataLoading(false)
  }

  async function loadTodos() {
    setTodosLoading(true)
    const { data } = await supabase.from('buy_requests')
      .select(`id, status, offer_price, payment_ref, payment_phone, paid_at, payout_name, payout_number, seller_message, admin_approved_at, item_id,
        buyer:profiles!buy_requests_buyer_id_fkey(username, avatar_url),
        seller:profiles!buy_requests_seller_id_fkey(username, avatar_url),
        shop_items(title)`)
      .in('status', ['payment_submitted', 'admin_approved', 'payout_pending'])
      .order('paid_at', { ascending: true })
    setTodos(data || [])
    setTodosLoading(false)
  }

  async function loadTournamentPayments() {
    setTournamentPaymentsLoading(true)
    const { data } = await supabase.from('tournament_payments')
      .select(`id, status, amount, payment_ref, payment_phone, submitted_at, tournament_id,
        user:profiles!tournament_payments_user_id_fkey(id, username, avatar_url),
        tournaments(id, name, slug, entrance_fee)`)
      .eq('status', 'payment_submitted')
      .order('submitted_at', { ascending: true })
    setTournamentPayments(data || [])
    setTournamentPaymentsLoading(false)
  }

  async function loadAllMasters() {
    setMastersLoading(true)
    const { data } = await supabase
      .from('game_masters')
      .select('*, profiles(username, avatar_url, tier, country_flag)')
      .order('week_start', { ascending: false })
      .limit(40)
    setAllMasters(data || [])
    setMastersLoading(false)
  }

  // ── Crown master ──
  async function searchCrownUsers(q) {
    if (!q.trim()) { setCrownResults([]); return }
    setCrownSearching(true)
    const { data } = await supabase.from('profiles').select('id, username, avatar_url, tier, wins, points')
      .ilike('username', `%${q}%`).limit(8)
    setCrownResults(data || [])
    setCrownSearching(false)
  }

  async function crownManually() {
    if (!crownSelected || !crownModal) return
    setCrownSaving(true)
    const weekStart = (() => {
      const d = new Date()
      const day = d.getDay() // 0=Sun
      const diff = day === 0 ? -6 : 1 - day // Sun→-6 days, else go back to Monday
      d.setDate(d.getDate() + diff)
      d.setHours(0, 0, 0, 0)
      return d.toISOString().split('T')[0]
    })()
    const { error } = await supabase.from('game_masters').upsert({
      game_slug: crownModal.gameSlug,
      user_id: crownSelected.id,
      week_start: weekStart,
      total_wins: crownSelected.wins || 0,
      total_points: crownSelected.points || 0,
      tournaments_played: 0,
      crowned_at: new Date().toISOString(),
    }, { onConflict: 'game_slug,week_start' })
    setCrownSaving(false)
    if (error) { alert(error.message); return }
    setCrownSuccess(`${crownSelected.username} crowned as ${GAME_META[crownModal.gameSlug]?.name} Master!`)
    setTimeout(() => setCrownSuccess(null), 3000)
    setCrownModal(null)
    setCrownSelected(null)
    setCrownSearch('')
    setCrownResults([])
    loadAllMasters()
  }

  async function removeMaster(id) {
    if (!confirm('Remove this master crown?')) return
    await supabase.from('game_masters').delete().eq('id', id)
    loadAllMasters()
  }

  // ── Payments ──
  async function approveTournamentPayment(pmt) {
    const { data: adminProf } = await supabase.from('profiles').select('id').eq('email', ADMIN_EMAIL).single()
    const { error } = await supabase.rpc('approve_tournament_payment', { p_payment_id: pmt.id, p_admin_id: adminProf?.id })
    if (error) { alert(error.message); return }
    await supabase.from('notifications').insert({
      user_id: pmt.user.id,
      title: '✅ Payment Approved — You\'re Registered!',
      body: `Your entry fee for "${pmt.tournaments?.name}" has been verified. You are now registered and placed in the bracket!`,
      type: 'tournament', meta: { tournament_id: pmt.tournament_id }, read: false,
    })
    loadTournamentPayments()
  }

  async function rejectTournamentPayment(pmt) {
    if (!confirm(`Reject payment from ${pmt.user?.username}?`)) return
    await supabase.from('tournament_payments').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', pmt.id)
    await supabase.from('notifications').insert({
      user_id: pmt.user.id, title: '❌ Payment Rejected',
      body: `Your entry fee for "${pmt.tournaments?.name}" was rejected. Please check your reference and resubmit.`,
      type: 'tournament', meta: { tournament_id: pmt.tournament_id }, read: false,
    })
    loadTournamentPayments()
  }

  async function todoApprove(req) {
    await supabase.from('buy_requests').update({ status: 'admin_approved', admin_approved_at: new Date().toISOString() }).eq('id', req.id)
    await supabase.from('notifications').insert([
      { user_id: req.seller?.id || req.seller_id, type: 'request_update', title: '✅ Payment Confirmed — Fill Payout Details', body: `Payment for "${req.shop_items?.title}" verified.`, meta: { request_id: req.id, item_id: req.item_id }, read: false },
      { user_id: req.buyer?.id  || req.buyer_id,  type: 'request_update', title: '✅ Payment Verified by Admin', body: `Your payment for "${req.shop_items?.title}" is confirmed.`, meta: { request_id: req.id, item_id: req.item_id }, read: false },
    ])
    loadTodos()
  }

  async function todoComplete(req) {
    await supabase.from('buy_requests').update({ status: 'completed' }).eq('id', req.id)
    await supabase.from('shop_items').update({ active: false }).eq('id', req.item_id)
    await supabase.from('notifications').insert([
      { user_id: req.buyer?.id  || req.buyer_id,  type: 'request_update', title: '🎉 Transaction Complete!', body: `Your purchase of "${req.shop_items?.title}" is complete.`, meta: { request_id: req.id, item_id: req.item_id }, read: false },
      { user_id: req.seller?.id || req.seller_id, type: 'request_update', title: '💰 Payout Released!', body: `Funds for "${req.shop_items?.title}" released to ${req.payout_name} — ${req.payout_number}.`, meta: { request_id: req.id, item_id: req.item_id }, read: false },
    ])
    loadTodos()
  }

  // ── Users ──
  async function saveUser() {
    const fullPhone = editUserPhoneLocal.trim()
      ? `+${editUserPhoneCode}${editUserPhoneLocal.trim().replace(/^0/, '')}` : null
    const { error } = await supabase.from('profiles').update({
      username: editUser.username, tier: editUser.tier,
      level: Number(editUser.level ?? 1), wins: Number(editUser.wins),
      losses: Number(editUser.losses), points: Number(editUser.points),
      bio: editUser.bio, phone: fullPhone,
    }).eq('id', editUser.id)
    if (error) { alert(error.message); return }
    setUsers(u => u.map(x => x.id === editUser.id ? { ...x, ...editUser, phone: fullPhone } : x))
    setEditUser(null)
  }
  async function deleteUser(id) {
    if (!confirm('Delete profile? Auth record stays.')) return
    await supabase.from('profiles').delete().eq('id', id)
    setUsers(u => u.filter(x => x.id !== id))
  }

  // ── Posts ──
  async function savePost() {
    const { error } = await supabase.from('posts').update({ content: editPost.content }).eq('id', editPost.id)
    if (error) { alert(error.message); return }
    setPosts(p => p.map(x => x.id === editPost.id ? { ...x, content: editPost.content } : x))
    setEditPost(null)
  }
  async function deletePost(id) {
    if (!confirm('Delete this post?')) return
    await supabase.from('posts').delete().eq('id', id)
    setPosts(p => p.filter(x => x.id !== id))
  }

  // ── Tournaments ──
  async function saveTournament() {
    const { error } = await supabase.from('tournaments').update({
      name: editTournament.name, prize: editTournament.prize, format: editTournament.format,
      slots: Number(editTournament.slots), date: editTournament.date,
      status: editTournament.status, description: editTournament.description,
    }).eq('id', editTournament.id)
    if (error) { alert(error.message); return }
    setTournaments(ts => ts.map(t => t.id === editTournament.id ? { ...t, ...editTournament } : t))
    setEditTournament(null)
  }
  async function deleteTournament(id) {
    if (!confirm('Delete this tournament and all its data?')) return
    await supabase.from('tournament_leaderboard').delete().eq('tournament_id', id)
    await supabase.from('tournament_participants').delete().eq('tournament_id', id)
    await supabase.from('tournaments').delete().eq('id', id)
    setTournaments(ts => ts.filter(t => t.id !== id))
  }

  // ── Battles ──
  async function saveBattle() {
    const { error } = await supabase.from('matches').update({
      status: editBattle.status, game_mode: editBattle.game_mode, format: editBattle.format,
    }).eq('id', editBattle.id)
    if (error) { alert(error.message); return }
    setBattles(bs => bs.map(b => b.id === editBattle.id ? { ...b, ...editBattle } : b))
    setEditBattle(null)
  }
  async function deleteBattle(id) {
    if (!confirm('Delete this match?')) return
    await supabase.from('matches').delete().eq('id', id)
    setBattles(bs => bs.filter(b => b.id !== id))
  }
  async function createBattle() {
    setBattleCreating(true)
    const [{ data: p1 }, { data: p2 }] = await Promise.all([
      supabase.from('profiles').select('id').eq('username', battleForm.player1).single(),
      supabase.from('profiles').select('id').eq('username', battleForm.player2).single(),
    ])
    if (!p1 || !p2) { alert('One or both usernames not found'); setBattleCreating(false); return }
    const { error } = await supabase.from('matches').insert({
      challenger_id: p1.id, challenged_id: p2.id, game_mode: battleForm.game_mode,
      format: battleForm.format, scheduled_at: battleForm.scheduled_at || null, status: 'confirmed',
    })
    setBattleCreating(false)
    if (!error) { setBattleModal(false); loadAll() } else alert(error.message)
  }

  // ── Shop ──
  async function saveShop() {
    const { error } = await supabase.from('shop_items').update({
      title: editShop.title, price: editShop.price, category: editShop.category,
      description: editShop.description, active: editShop.active,
    }).eq('id', editShop.id)
    if (error) { alert(error.message); return }
    setShopItems(s => s.map(x => x.id === editShop.id ? { ...x, ...editShop } : x))
    setEditShop(null)
  }
  async function deleteShop(id) {
    if (!confirm('Delete this shop item?')) return
    await supabase.from('shop_items').delete().eq('id', id)
    setShopItems(s => s.filter(x => x.id !== id))
  }

  // ── Notifications ──
  async function searchUsers(q) {
    if (!q.trim()) { setUserResults([]); return }
    setSearching(true)
    const { data } = await supabase.from('profiles').select('id, username, tier, avatar_url').ilike('username', `%${q}%`).limit(8)
    setUserResults(data || [])
    setSearching(false)
  }
  async function sendNotification() {
    const { target, targetUserId, title, body, type, ctaLabel, ctaLink } = notifForm
    if (!title.trim() || !body.trim()) return
    setNotifSending(true); setNotifResult(null)
    const meta = {}
    if (ctaLink.trim()) meta.cta_link = ctaLink.trim()
    if (ctaLabel.trim()) meta.cta_label = ctaLabel.trim()
    let sent = 0, errors = 0
    const insert = async (userId) => {
      const { error } = await supabase.from('notifications').insert({ user_id: userId, type, title: title.trim(), body: body.trim(), meta, read: false })
      if (error) errors++; else sent++
    }
    if (target === 'user') {
      if (!targetUserId) { setNotifSending(false); return }
      await insert(targetUserId)
    } else {
      const { data: allUsers } = await supabase.from('profiles').select('id')
      if (allUsers) for (let i = 0; i < allUsers.length; i += 20) await Promise.all(allUsers.slice(i, i + 20).map(u => insert(u.id)))
    }
    const historyEntry = { id: Date.now(), at: new Date().toISOString(), target: target === 'all' ? 'All Users' : notifForm.targetUsername, title: title.trim(), body: body.trim(), sent, errors }
    setNotifHistory(h => [historyEntry, ...h])
    setNotifResult({ sent, errors })
    setNotifSending(false)
    setNotifForm(f => ({ ...f, title: '', body: '' }))
  }

  if (authLoading || !isAdmin) return null

  const anyEdit = editUser || editPost || editTournament || editBattle || editShop || battleModal
  const todoBadge = todos.length + tournamentPayments.length

  // Group masters by game
  const mastersByGame = GAME_SLUGS.reduce((acc, slug) => {
    acc[slug] = allMasters.filter(m => m.game_slug === slug)
    return acc
  }, {})

  return (
    <div className={styles.page}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <div className={styles.adminChip}><i className="ri-shield-star-fill" /> Admin</div>
          <div>
            <h1 className={styles.headline}>Dashboard</h1>
            <p className={styles.subline}>{ADMIN_EMAIL}</p>
          </div>
        </div>
        <div className={styles.topBarRight}>
          <button className={styles.iconBtn} onClick={loadAll} title="Refresh"><i className="ri-refresh-line" /></button>
          <button className={styles.iconBtn} onClick={() => router.push('/')} title="Home"><i className="ri-home-4-line" /></button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className={styles.statsGrid}>
        {[
          { label: 'Players', value: stats.users,       icon: 'ri-group-fill',    color: '#6366f1' },
          { label: 'Posts',   value: stats.posts,        icon: 'ri-article-fill',  color: '#0ea5e9' },
          { label: 'Tourneys',value: stats.tournaments,  icon: 'ri-trophy-fill',   color: '#f59e0b' },
          { label: 'Battles', value: stats.matches,      icon: 'ri-sword-fill',    color: '#ef4444' },
        ].map(s => (
          <div key={s.label} className={styles.statCard} style={{ '--stat-color': s.color }}>
            <div className={styles.statIcon}><i className={s.icon} /></div>
            <div className={styles.statBody}>
              <span className={styles.statVal}>{s.value ?? '—'}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {TABS.map(t => (
            <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
              <i className={TAB_ICONS[t]} />
              <span>{t}</span>
              {t === 'Todos' && todoBadge > 0 && <span className={styles.tabBadge}>{todoBadge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Crown success toast ── */}
      {crownSuccess && (
        <div className={styles.crownToast}><i className="ri-crown-fill" /> {crownSuccess}</div>
      )}

      <div className={styles.tabContent}>
        {!dataLoading && (<>

          {/* ════ OVERVIEW ════ */}
          {tab === 'Overview' && (
            <div className={styles.overviewGrid}>
              <div className={styles.overviewCard}>
                <div className={styles.ocHead}><i className="ri-flash-fill" /> Quick Actions</div>
                <div className={styles.qaGrid}>
                  {[
                    { label: 'Tournaments',    icon: 'ri-trophy-line',       action: () => setTab('Tournaments') },
                    { label: 'Create Battle',  icon: 'ri-sword-line',        action: () => { setTab('Battles'); setBattleModal(true) } },
                    { label: 'Crown Master',   icon: 'ri-crown-line',        action: () => setTab('Masters') },
                    { label: 'Send Notif',     icon: 'ri-notification-3-line', action: () => setTab('Notifications') },
                    { label: 'Pending Todos',  icon: 'ri-checkbox-multiple-line', action: () => setTab('Todos') },
                    { label: 'Live Site',      icon: 'ri-external-link-line', action: () => router.push('/tournaments') },
                  ].map(a => (
                    <button key={a.label} className={styles.qaBtn} onClick={a.action}>
                      <i className={a.icon} />
                      <span>{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.overviewCard}>
                <div className={styles.ocHead}><i className="ri-activity-line" /> Platform Snapshot</div>
                <div className={styles.snapshotList}>
                  {[
                    { label: 'Total players', val: stats.users, color: '#6366f1' },
                    { label: 'Tournaments',   val: stats.tournaments, color: '#f59e0b' },
                    { label: 'Battles',       val: stats.matches, color: '#ef4444' },
                    { label: 'Pending todos', val: todoBadge, color: todoBadge > 0 ? '#f59e0b' : 'var(--text-muted)' },
                    { label: 'Active tourns', val: tournaments.filter(t => t.status === 'active').length, color: '#22c55e' },
                    { label: 'Live tourns',   val: tournaments.filter(t => t.status === 'ongoing').length, color: '#6366f1' },
                  ].map(r => (
                    <div key={r.label} className={styles.snapshotRow}>
                      <span className={styles.snapshotLabel}>{r.label}</span>
                      <span className={styles.snapshotVal} style={{ color: r.color }}>{r.val ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════ TODOS ════ */}
          {tab === 'Todos' && (
            <div>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Pending Actions</h2>
                  <p className={styles.sectionSub}>Payment approvals & payout releases requiring admin attention</p>
                </div>
                <button className={styles.iconBtn} onClick={() => { loadTodos(); loadTournamentPayments() }}><i className="ri-refresh-line" /></button>
              </div>

              {(todosLoading || tournamentPaymentsLoading) && <div className={styles.loadWrap}><div className="loader" /></div>}

              {!todosLoading && !tournamentPaymentsLoading && todos.length === 0 && tournamentPayments.length === 0 && (
                <div className={styles.emptyState}>
                  <i className="ri-checkbox-circle-line" />
                  <p>All clear</p>
                  <span>No pending payment actions</span>
                </div>
              )}

              <div className={styles.todoList}>
                {todos.map(req => {
                  const isPaySub = req.status === 'payment_submitted'
                  const isPoP    = req.status === 'payout_pending'
                  const stepColor  = isPaySub ? '#0ea5e9' : req.status === 'admin_approved' ? '#a855f7' : '#f97316'
                  const stepLabel  = isPaySub ? 'Verify Payment' : req.status === 'admin_approved' ? 'Awaiting Payout Info' : 'Release Payout'
                  const deadline   = req.paid_at ? new Date(req.paid_at).getTime() + 10 * 3600 * 1000 : null
                  const remaining  = deadline ? Math.max(0, deadline - Date.now()) : null
                  const h          = remaining !== null ? Math.floor(remaining / 3600000) : null
                  const m          = remaining !== null ? Math.floor((remaining % 3600000) / 60000) : null
                  const urgent     = remaining !== null && remaining < 2 * 3600000

                  return (
                    <div key={req.id} className={styles.todoCard} style={{ '--step-color': stepColor }}>
                      <div className={styles.todoCardHeader}>
                        <Badge color={stepColor}><i className="ri-shopping-bag-line" /> {stepLabel}</Badge>
                        {remaining !== null && (
                          <span className={styles.todoTimer} style={{ color: urgent ? '#ef4444' : 'var(--text-muted)' }}>
                            <i className={urgent ? 'ri-alarm-warning-line' : 'ri-timer-line'} /> {h}h {m}m left
                          </span>
                        )}
                      </div>
                      <div className={styles.todoMeta}>
                        <div className={styles.todoMetaRow}><span>Item</span><strong>{req.shop_items?.title || '—'}</strong></div>
                        <div className={styles.todoMetaRow}><span>Buyer</span><strong>{req.buyer?.username || '—'}</strong></div>
                        <div className={styles.todoMetaRow}><span>Seller</span><strong>{req.seller?.username || '—'}</strong></div>
                        <div className={styles.todoMetaRow}><span>Amount</span><strong>TZS {Number(req.offer_price).toLocaleString()}</strong></div>
                        {req.payment_ref   && <div className={styles.todoMetaRow}><span>Ref</span><strong>{req.payment_ref}</strong></div>}
                        {req.payment_phone && <div className={styles.todoMetaRow}><span>Phone</span><strong>{req.payment_phone}</strong></div>}
                        {req.payout_name   && <div className={styles.todoMetaRow}><span>Payout To</span><strong>{req.payout_name}</strong></div>}
                        {req.payout_number && <div className={styles.todoMetaRow}><span>Account #</span><strong>{req.payout_number}</strong></div>}
                      </div>
                      <ActionRow>
                        <a href={`/shop/${req.item_id}/request/${req.id}`} target="_blank" rel="noopener noreferrer" className={styles.btnGhost}>
                          <i className="ri-external-link-line" /> View Thread
                        </a>
                        {isPaySub && (
                          <button className={styles.btnPrimary} style={{ '--btn-color': '#0ea5e9' }} onClick={() => todoApprove(req)}>
                            <i className="ri-check-double-line" /> Approve Payment
                          </button>
                        )}
                        {isPoP && (
                          <button className={styles.btnPrimary} style={{ '--btn-color': '#22c55e' }} onClick={() => todoComplete(req)}>
                            <i className="ri-check-double-line" /> Release Funds
                          </button>
                        )}
                      </ActionRow>
                    </div>
                  )
                })}

                {tournamentPayments.length > 0 && (
                  <>
                    <div className={styles.sectionDivider}><i className="ri-trophy-line" /> Tournament Entry Fees</div>
                    {tournamentPayments.map(pmt => (
                      <div key={pmt.id} className={styles.todoCard} style={{ '--step-color': '#0ea5e9' }}>
                        <div className={styles.todoCardHeader}>
                          <Badge color="#0ea5e9"><i className="ri-bank-card-line" /> Tournament Payment</Badge>
                          <span className={styles.todoTimer}>{fmtDate(pmt.submitted_at)}</span>
                        </div>
                        <div className={styles.todoMeta}>
                          <div className={styles.todoMetaRow}><span>Tournament</span><strong>{pmt.tournaments?.name || '—'}</strong></div>
                          <div className={styles.todoMetaRow}><span>Player</span><strong>{pmt.user?.username || '—'}</strong></div>
                          <div className={styles.todoMetaRow}><span>Amount</span><strong>TZS {Number(pmt.amount).toLocaleString()}</strong></div>
                          {pmt.payment_ref   && <div className={styles.todoMetaRow}><span>Ref</span><strong>{pmt.payment_ref}</strong></div>}
                          {pmt.payment_phone && <div className={styles.todoMetaRow}><span>Phone</span><strong>{pmt.payment_phone}</strong></div>}
                        </div>
                        <ActionRow>
                          <a href={`/tournaments/${pmt.tournaments?.slug || pmt.tournament_id}`} target="_blank" rel="noopener noreferrer" className={styles.btnGhost}>
                            <i className="ri-external-link-line" /> View
                          </a>
                          <button className={styles.btnPrimary} style={{ '--btn-color': '#0ea5e9' }} onClick={() => approveTournamentPayment(pmt)}>
                            <i className="ri-check-double-line" /> Approve & Register
                          </button>
                          <button className={styles.btnDanger} onClick={() => rejectTournamentPayment(pmt)}>
                            <i className="ri-close-line" />
                          </button>
                        </ActionRow>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ════ MASTERS ════ */}
          {tab === 'Masters' && (
            <div>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Game Masters</h2>
                  <p className={styles.sectionSub}>Weekly crowns per game. Auto-computed every Monday or set manually below.</p>
                </div>
                <button className={styles.iconBtn} onClick={loadAllMasters}><i className="ri-refresh-line" /></button>
              </div>

              {/* Crown by RPC */}
              <div className={styles.masterAutoRow}>
                <button className={styles.btnAccent} onClick={async () => {
                  const { error } = await supabase.rpc('crown_weekly_game_master', { p_game_slug: null })
                  if (error) alert(error.message)
                  else { loadAllMasters(); setCrownSuccess('All weekly masters recomputed from tournament data!') }
                }}>
                  <i className="ri-cpu-line" /> Auto-Compute All Masters
                </button>
                <p className={styles.masterAutoNote}>Reads this week's tournament leaderboards and crowns the player with most wins + points per game.</p>
              </div>

              {mastersLoading && <div className={styles.loadWrap}><div className="loader" /></div>}

              {/* Per-game master panels */}
              {!mastersLoading && (
                <div className={styles.masterGameGrid}>
                  {GAME_SLUGS.map(slug => {
                    const game = GAME_META[slug]
                    const records = mastersByGame[slug] || []
                    const current = records[0]
                    const isThisWeek = current && (() => {
                      const weekStart = new Date()
                      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
                      weekStart.setHours(0, 0, 0, 0)
                      return current.week_start >= weekStart.toISOString().split('T')[0]
                    })()
                    const tierTheme = getTierTheme(current?.profiles?.tier)

                    return (
                      <div key={slug} className={styles.masterGameCard}>
                        {/* Game header */}
                        <div className={styles.masterGameHead}>
                          {game?.image && <img src={game.image} alt={game.name} className={styles.masterGameImg} />}
                          <div className={styles.masterGameName}>{game?.name}</div>
                          {isThisWeek
                            ? <Badge color="#f59e0b"><i className="ri-crown-fill" /> This Week</Badge>
                            : <Badge color="var(--text-muted)">No Master</Badge>
                          }
                        </div>

                        {/* Current master */}
                        {current ? (
                          <div className={styles.masterPlayerRow}>
                            <div className={styles.masterPlayerAvatar}>
                              {current.profiles?.avatar_url
                                ? <img src={current.profiles.avatar_url} alt="" />
                                : <span>{current.profiles?.username?.[0]?.toUpperCase()}</span>
                              }
                            </div>
                            <div className={styles.masterPlayerInfo}>
                              <span className={styles.masterPlayerName}>{current.profiles?.username}</span>
                              <span className={styles.masterPlayerTier} style={{ color: tierTheme?.primary }}>
                                {current.profiles?.tier} · {current.total_wins}W · {current.total_points}pts
                              </span>
                              <span className={styles.masterPlayerWeek}>{current.week_start}</span>
                            </div>
                            <button className={styles.btnDanger} onClick={() => removeMaster(current.id)} title="Remove crown">
                              <i className="ri-delete-bin-line" />
                            </button>
                          </div>
                        ) : (
                          <div className={styles.masterNoPlayer}>No master this week</div>
                        )}

                        {/* Manual crown button */}
                        <button className={styles.btnCrownManual} onClick={() => { setCrownModal({ gameSlug: slug }); setCrownSelected(null); setCrownSearch(''); setCrownResults([]) }}>
                          <i className="ri-crown-line" /> Crown Manually
                        </button>

                        {/* Past records */}
                        {records.length > 1 && (
                          <div className={styles.masterPastList}>
                            {records.slice(1, 4).map(r => (
                              <div key={r.id} className={styles.masterPastRow}>
                                <span className={styles.masterPastWeek}>{r.week_start}</span>
                                <span className={styles.masterPastName}>{r.profiles?.username}</span>
                                <span className={styles.masterPastStat}>{r.total_wins}W/{r.total_points}pt</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════ USERS ════ */}
          {tab === 'Users' && (
            <div>
              <div className={styles.sectionHead}>
                <div><h2 className={styles.sectionTitle}>Players <span className={styles.sectionCount}>{users.length}</span></h2></div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr>
                    <th>Player</th><th>Email</th><th>Phone</th><th>Tier</th><th>Lv</th><th>W</th><th>Pts</th><th></th>
                  </tr></thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td><a href={`/profile/${u.id}`} className={styles.link}>{u.username}</a></td>
                        <td className={styles.dimCell}>{u.email}</td>
                        <td className={styles.monoCell}>{u.phone || <span className={styles.nil}>—</span>}</td>
                        <td><Badge color={getTierTheme(u.tier)?.primary || '#f59e0b'}>{u.tier}</Badge></td>
                        <td>{u.level ?? 1}</td>
                        <td>{u.wins}</td>
                        <td>{(u.points || 0).toLocaleString()}</td>
                        <td>
                          <div className={styles.rowActions}>
                            <button className={styles.iconBtnSm} onClick={() => {
                              const CODES = ['254', '255', '256']
                              const stripped = (u.phone || '').replace(/^\+/, '')
                              const matched = CODES.find(c => stripped.startsWith(c))
                              setEditUserPhoneCode(matched || '255')
                              setEditUserPhoneLocal(matched ? stripped.slice(matched.length) : stripped)
                              setEditUser({ ...u })
                            }}><i className="ri-edit-line" /></button>
                            <button className={styles.iconBtnSmDanger} onClick={() => deleteUser(u.id)}><i className="ri-delete-bin-line" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════ POSTS ════ */}
          {tab === 'Posts' && (
            <div>
              <div className={styles.sectionHead}><h2 className={styles.sectionTitle}>Posts <span className={styles.sectionCount}>{posts.length}</span></h2></div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>User</th><th>Content</th><th>❤</th><th>💬</th><th>Date</th><th></th></tr></thead>
                  <tbody>
                    {posts.map(p => (
                      <tr key={p.id}>
                        <td className={styles.bold}>{p.profiles?.username}</td>
                        <td className={styles.truncCell}>{p.content}</td>
                        <td>{p.likes}</td>
                        <td>{p.comment_count}</td>
                        <td className={styles.dimCell}>{fmtDate(p.created_at)}</td>
                        <td>
                          <div className={styles.rowActions}>
                            <button className={styles.iconBtnSm} onClick={() => setEditPost({ ...p })}><i className="ri-edit-line" /></button>
                            <button className={styles.iconBtnSmDanger} onClick={() => deletePost(p.id)}><i className="ri-delete-bin-line" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════ TOURNAMENTS ════ */}
          {tab === 'Tournaments' && (
            <div>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Tournaments <span className={styles.sectionCount}>{tournaments.length}</span></h2>
                <button className={styles.btnAccent} onClick={() => router.push('/tournaments/create')}>
                  <i className="ri-add-line" /> Create
                </button>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Name</th><th>Game</th><th>Prize</th><th>Slots</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {tournaments.map(t => (
                      <tr key={t.id}>
                        <td className={styles.bold}><a href={`/tournaments/${t.id}`} className={styles.link}>{t.name}</a></td>
                        <td className={styles.dimCell}>{GAME_META[t.game_slug]?.name || t.game_slug}</td>
                        <td>{t.prize || '—'}</td>
                        <td>{t.registered_count || 0}/{t.slots}</td>
                        <td>
                          <select className={styles.statusSelect} value={t.status} onChange={async e => {
                            const s = e.target.value
                            await supabase.from('tournaments').update({ status: s }).eq('id', t.id)
                            setTournaments(ts => ts.map(x => x.id === t.id ? { ...x, status: s } : x))
                          }}>
                            <option>active</option><option>ongoing</option><option>completed</option><option>cancelled</option>
                          </select>
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <button className={styles.iconBtnSm} onClick={() => setEditTournament({ ...t })}><i className="ri-edit-line" /></button>
                            <button className={styles.iconBtnSmDanger} onClick={() => deleteTournament(t.id)}><i className="ri-delete-bin-line" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════ BATTLES ════ */}
          {tab === 'Battles' && (
            <div>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Battles <span className={styles.sectionCount}>{battles.length}</span></h2>
                <button className={styles.btnAccent} onClick={() => setBattleModal(true)}>
                  <i className="ri-sword-line" /> Create
                </button>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Challenger</th><th>vs</th><th>Mode</th><th>Status</th><th>Date</th><th></th></tr></thead>
                  <tbody>
                    {battles.map(b => (
                      <tr key={b.id}>
                        <td className={styles.bold}>{b.challenger?.username}</td>
                        <td className={styles.dimCell}>{b.challenged?.username}</td>
                        <td>{b.game_mode || '—'}</td>
                        <td><Badge color={b.status === 'live' ? '#22c55e' : b.status === 'completed' ? '#64748b' : '#f59e0b'}>{b.status}</Badge></td>
                        <td className={styles.dimCell}>{b.scheduled_at ? fmtDate(b.scheduled_at) : 'TBD'}</td>
                        <td>
                          <div className={styles.rowActions}>
                            <button className={styles.iconBtnSm} onClick={() => router.push(`/matches/${makeMatchCode(b.id)}`)} title="Open"><i className="ri-external-link-line" /></button>
                            <button className={styles.iconBtnSm} onClick={() => setEditBattle({ ...b })}><i className="ri-edit-line" /></button>
                            <button className={styles.iconBtnSmDanger} onClick={() => deleteBattle(b.id)}><i className="ri-delete-bin-line" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════ SHOP ════ */}
          {tab === 'Shop' && (
            <div>
              <div className={styles.sectionHead}><h2 className={styles.sectionTitle}>Shop Items <span className={styles.sectionCount}>{shopItems.length}</span></h2></div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Title</th><th>Seller</th><th>Price (TZS)</th><th>Category</th><th>Active</th><th></th></tr></thead>
                  <tbody>
                    {shopItems.map(item => (
                      <tr key={item.id}>
                        <td className={styles.bold}>{item.title}</td>
                        <td className={styles.dimCell}>{item.profiles?.username}</td>
                        <td>{Number(item.price).toLocaleString()}</td>
                        <td className={styles.dimCell}>{item.category}</td>
                        <td>
                          <button className={`${styles.toggleBtn} ${item.active ? styles.toggleOn : styles.toggleOff}`}
                            onClick={async () => {
                              await supabase.from('shop_items').update({ active: !item.active }).eq('id', item.id)
                              setShopItems(s => s.map(x => x.id === item.id ? { ...x, active: !item.active } : x))
                            }}>{item.active ? 'Active' : 'Hidden'}</button>
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <button className={styles.iconBtnSm} onClick={() => setEditShop({ ...item })}><i className="ri-edit-line" /></button>
                            <button className={styles.iconBtnSmDanger} onClick={() => deleteShop(item.id)}><i className="ri-delete-bin-line" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ════ NOTIFICATIONS ════ */}
          {tab === 'Notifications' && (
            <div className={styles.notifComposer}>
              <div className={styles.sectionHead}>
                <div><h2 className={styles.sectionTitle}>Send Notification</h2>
                  <p className={styles.sectionSub}>Broadcast to all users or target a specific player</p>
                </div>
              </div>

              <div className={styles.notifSection}>
                <div className={styles.notifSectionLabel}><i className="ri-user-target-line" /> Send To</div>
                <div className={styles.targetBtns}>
                  <button className={`${styles.targetBtn} ${notifForm.target === 'all' ? styles.targetBtnActive : ''}`}
                    onClick={() => setNotifForm(f => ({ ...f, target: 'all', targetUserId: '', targetUsername: '' }))}>
                    <i className="ri-group-line" /> All Users
                  </button>
                  <button className={`${styles.targetBtn} ${notifForm.target === 'user' ? styles.targetBtnActive : ''}`}
                    onClick={() => setNotifForm(f => ({ ...f, target: 'user' }))}>
                    <i className="ri-user-line" /> Specific User
                  </button>
                </div>
                {notifForm.target === 'user' && (
                  <div className={styles.userSearchWrap}>
                    <input className={styles.notifInput} placeholder="Search username…" value={userSearch}
                      onChange={e => { setUserSearch(e.target.value); searchUsers(e.target.value) }} />
                    {searching && <span className={styles.notifHint}><i className="ri-loader-4-line" /> Searching…</span>}
                    {userResults.length > 0 && (
                      <div className={styles.userResults}>
                        {userResults.map(u => (
                          <button key={u.id}
                            className={`${styles.userResult} ${notifForm.targetUserId === u.id ? styles.userResultActive : ''}`}
                            onClick={() => { setNotifForm(f => ({ ...f, targetUserId: u.id, targetUsername: u.username })); setUserSearch(u.username); setUserResults([]) }}>
                            <span className={styles.userResultName}>{u.username}</span>
                            <span className={styles.userResultTier}>{u.tier}</span>
                            {notifForm.targetUserId === u.id && <i className="ri-check-line" style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
                          </button>
                        ))}
                      </div>
                    )}
                    {notifForm.targetUserId && (
                      <div className={styles.selectedUser}>
                        <i className="ri-checkbox-circle-fill" style={{ color: 'var(--accent)' }} />
                        Sending to: <strong>{notifForm.targetUsername}</strong>
                        <button onClick={() => setNotifForm(f => ({ ...f, targetUserId: '', targetUsername: '' }))}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>
                          <i className="ri-close-line" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.notifSection}>
                <div className={styles.notifSectionLabel}><i className="ri-tag-line" /> Type</div>
                <div className={styles.typeGrid}>
                  {[
                    { val: 'announcement', icon: 'ri-megaphone-line', label: 'Announcement' },
                    { val: 'tournament', icon: 'ri-node-tree', label: 'Tournament' },
                    { val: 'tier_up', icon: 'ri-shield-star-line', label: 'Tier Up' },
                    { val: 'level_up', icon: 'ri-bar-chart-fill', label: 'Level Up' },
                    { val: 'season_ended', icon: 'ri-calendar-check-line', label: 'Season' },
                    { val: 'direct_message', icon: 'ri-chat-private-line', label: 'DM' },
                  ].map(t => (
                    <button key={t.val}
                      className={`${styles.typeBtn} ${notifForm.type === t.val ? styles.typeBtnActive : ''}`}
                      onClick={() => setNotifForm(f => ({ ...f, type: t.val }))}>
                      <i className={t.icon} /><span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.notifSection}>
                <div className={styles.notifSectionLabel}><i className="ri-notification-3-line" /> Message</div>
                <input className={styles.notifInput} placeholder="Title (bold headline)" value={notifForm.title}
                  onChange={e => setNotifForm(f => ({ ...f, title: e.target.value }))} />
                <textarea className={styles.notifTextarea} placeholder="Body — tell users what this is about…" rows={3}
                  value={notifForm.body} onChange={e => setNotifForm(f => ({ ...f, body: e.target.value }))} />
              </div>

              <div className={styles.notifSection}>
                <div className={styles.notifSectionLabel}><i className="ri-cursor-line" /> CTA (optional)</div>
                <div className={styles.ctaRow}>
                  <input className={styles.notifInput} placeholder="Button label" value={notifForm.ctaLabel}
                    onChange={e => setNotifForm(f => ({ ...f, ctaLabel: e.target.value }))} style={{ flex: 1 }} />
                  <input className={styles.notifInput} placeholder="/tournaments/slug" value={notifForm.ctaLink}
                    onChange={e => setNotifForm(f => ({ ...f, ctaLink: e.target.value }))} style={{ flex: 2 }} />
                </div>
              </div>

              {(notifForm.title || notifForm.body) && (
                <div className={styles.notifSection}>
                  <div className={styles.notifSectionLabel}><i className="ri-eye-line" /> Preview</div>
                  <div className={styles.notifPreview}>
                    <div className={styles.previewApp}>Nabogaming</div>
                    <div className={styles.previewTitle}>{notifForm.title || 'Title'}</div>
                    <div className={styles.previewBody}>{notifForm.body || 'Message body…'}</div>
                    {notifForm.ctaLabel && <div className={styles.previewCta}>{notifForm.ctaLabel} →</div>}
                  </div>
                </div>
              )}

              {notifResult && (
                <div className={`${styles.notifResult} ${notifResult.errors > 0 ? styles.notifResultWarn : styles.notifResultOk}`}>
                  <i className={notifResult.errors > 0 ? 'ri-error-warning-line' : 'ri-checkbox-circle-fill'} />
                  Sent to {notifResult.sent} user{notifResult.sent !== 1 ? 's' : ''}
                  {notifResult.errors > 0 && ` · ${notifResult.errors} failed`}
                </div>
              )}

              <button className={styles.sendBtn} onClick={sendNotification}
                disabled={notifSending || !notifForm.title.trim() || !notifForm.body.trim() || (notifForm.target === 'user' && !notifForm.targetUserId)}>
                {notifSending
                  ? <><i className="ri-loader-4-line" style={{ animation: 'spin .7s linear infinite' }} /> Sending…</>
                  : <><i className="ri-send-plane-fill" /> Send {notifForm.target === 'all' ? 'to All Users' : `to ${notifForm.targetUsername}`}</>}
              </button>

              {notifHistory.length > 0 && (
                <div className={styles.notifSection}>
                  <div className={styles.notifSectionLabel}><i className="ri-history-line" /> Sent This Session</div>
                  <div className={styles.historyList}>
                    {notifHistory.map(h => (
                      <div key={h.id} className={styles.historyRow}>
                        <div className={styles.historyMeta}>
                          <span className={styles.historyTitle}>{h.title}</span>
                          <span className={styles.historyTarget}>→ {h.target}</span>
                        </div>
                        <span className={styles.historySent}>{h.sent} sent</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>)}
      </div>

      {/* ════ CROWN MODAL ════ */}
      {crownModal && (
        <div className={styles.modalOverlay} onClick={() => setCrownModal(null)}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <i className="ri-crown-fill" style={{ color: '#f59e0b', marginRight: 8 }} />
                Crown Master — {GAME_META[crownModal.gameSlug]?.name}
              </div>
              <button onClick={() => setCrownModal(null)}><i className="ri-close-line" /></button>
            </div>
            <div className={styles.modalBody}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Manually set this week's master for <strong style={{ color: 'var(--text)' }}>{GAME_META[crownModal.gameSlug]?.name}</strong>. Overwrites any existing crown.
              </p>
              <div className={styles.createField}>
                <label>Search Player</label>
                <input type="text" placeholder="Username…" value={crownSearch}
                  onChange={e => { setCrownSearch(e.target.value); searchCrownUsers(e.target.value) }} />
              </div>
              {crownSearching && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Searching…</p>}
              {crownResults.length > 0 && (
                <div className={styles.userResults} style={{ marginTop: 4 }}>
                  {crownResults.map(u => (
                    <button key={u.id}
                      className={`${styles.userResult} ${crownSelected?.id === u.id ? styles.userResultActive : ''}`}
                      onClick={() => { setCrownSelected(u); setCrownSearch(u.username); setCrownResults([]) }}>
                      <div className={styles.crownResultAvatar}>
                        {u.avatar_url ? <img src={u.avatar_url} alt="" /> : <span>{u.username?.[0]?.toUpperCase()}</span>}
                      </div>
                      <div>
                        <span className={styles.userResultName}>{u.username}</span>
                        <span className={styles.userResultTier} style={{ display: 'block', marginTop: 2 }}>
                          {u.tier} · {u.wins}W · {(u.points || 0).toLocaleString()}pts
                        </span>
                      </div>
                      {crownSelected?.id === u.id && <i className="ri-crown-fill" style={{ color: '#f59e0b', marginLeft: 'auto', fontSize: 16 }} />}
                    </button>
                  ))}
                </div>
              )}
              {crownSelected && (
                <div className={styles.crownSelectedBanner}>
                  <i className="ri-crown-fill" style={{ color: '#f59e0b' }} />
                  Crowning <strong>{crownSelected.username}</strong> as this week's {GAME_META[crownModal.gameSlug]?.name} Master
                </div>
              )}
              <button className={styles.saveBtn} onClick={crownManually}
                disabled={!crownSelected || crownSaving} style={{ background: '#f59e0b', color: '#000' }}>
                {crownSaving
                  ? <><i className="ri-loader-4-line" /> Saving…</>
                  : <><i className="ri-crown-fill" /> Crown {crownSelected?.username || 'Player'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ EDIT MODALS ════ */}
      {anyEdit && (
        <div className={styles.modalOverlay} onClick={() => { setEditUser(null); setEditPost(null); setEditTournament(null); setEditBattle(null); setEditShop(null); setBattleModal(false) }}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>

            {editUser && <>
              <div className={styles.modalHeader}><span>Edit Player</span><button onClick={() => setEditUser(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}><label>Username</label>
                  <input value={editUser.username || ''} onChange={e => setEditUser(x => ({ ...x, username: e.target.value }))} /></div>
                <div className={styles.createField}><label>Rank Tier</label>
                  <select value={editUser.tier || 'Gold'} onChange={e => setEditUser(x => ({ ...x, tier: e.target.value }))}>
                    {RANK_TIERS.map(t => <option key={t}>{t}</option>)}
                  </select></div>
                {[['level','Level','number'],['wins','Wins','number'],['losses','Losses','number'],['points','Points','number']].map(([k,l,t]) => (
                  <div key={k} className={styles.createField}><label>{l}</label>
                    <input type={t} value={editUser[k] || ''} onChange={e => setEditUser(x => ({ ...x, [k]: e.target.value }))} /></div>
                ))}
                <div className={styles.createField}><label>Bio</label>
                  <textarea rows={2} value={editUser.bio || ''} onChange={e => setEditUser(x => ({ ...x, bio: e.target.value }))} /></div>
                <div className={styles.createField}>
                  <label>Phone Number</label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    {[{ code: '254', flag: '/kenya.png', label: '+254' }, { code: '255', flag: '/tanzania.png', label: '+255' }, { code: '256', flag: '/uganda.png', label: '+256' }].map(c => (
                      <button key={c.code} type="button" onClick={() => setEditUserPhoneCode(c.code)} style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        padding: '7px 8px', borderRadius: 8,
                        border: `1.5px solid ${editUserPhoneCode === c.code ? 'var(--text)' : 'var(--border-dark)'}`,
                        background: editUserPhoneCode === c.code ? 'var(--surface)' : 'var(--bg-2)',
                        color: editUserPhoneCode === c.code ? 'var(--text)' : 'var(--text-muted)',
                        fontWeight: 700, fontSize: 11, cursor: 'pointer',
                      }}>
                        <img src={c.flag} alt={c.code} style={{ width: 16, height: 12, borderRadius: 2, objectFit: 'cover' }} />{c.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border-dark)', borderRadius: 8, background: 'var(--bg-2)', padding: '0 12px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>+{editUserPhoneCode}</span>
                    <div style={{ width: 1, height: 16, background: 'var(--border-dark)', flexShrink: 0 }} />
                    <input type="tel" placeholder="712 345 678" value={editUserPhoneLocal} onChange={e => setEditUserPhoneLocal(e.target.value)}
                      style={{ flex: 1, border: 'none', background: 'transparent', padding: '10px 0', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'var(--font)' }} />
                  </div>
                </div>
                <button className={styles.saveBtn} onClick={saveUser}><i className="ri-check-line" /> Save Player</button>
              </div>
            </>}

            {editPost && <>
              <div className={styles.modalHeader}><span>Edit Post</span><button onClick={() => setEditPost(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}><label>Content</label>
                  <textarea rows={5} value={editPost.content || ''} onChange={e => setEditPost(x => ({ ...x, content: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={savePost}><i className="ri-check-line" /> Save Post</button>
              </div>
            </>}

            {editTournament && <>
              <div className={styles.modalHeader}><span>Edit Tournament</span><button onClick={() => setEditTournament(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                {[['name','Name','text'],['prize','Prize (TZS)','text'],['format','Format','text'],['slots','Max Slots','number'],['date','Date','text']].map(([k,l,t]) => (
                  <div key={k} className={styles.createField}><label>{l}</label>
                    <input type={t} value={editTournament[k] || ''} onChange={e => setEditTournament(x => ({ ...x, [k]: e.target.value }))} /></div>
                ))}
                <div className={styles.createField}><label>Status</label>
                  <select value={editTournament.status} onChange={e => setEditTournament(x => ({ ...x, status: e.target.value }))}>
                    <option>active</option><option>ongoing</option><option>completed</option><option>cancelled</option>
                  </select></div>
                <div className={styles.createField}><label>Description</label>
                  <textarea rows={3} value={editTournament.description || ''} onChange={e => setEditTournament(x => ({ ...x, description: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={saveTournament}><i className="ri-check-line" /> Save</button>
              </div>
            </>}

            {editBattle && <>
              <div className={styles.modalHeader}><span>Edit Battle</span><button onClick={() => setEditBattle(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}><label>Game Mode</label>
                  <input value={editBattle.game_mode || ''} onChange={e => setEditBattle(x => ({ ...x, game_mode: e.target.value }))} /></div>
                <div className={styles.createField}><label>Format</label>
                  <input value={editBattle.format || ''} onChange={e => setEditBattle(x => ({ ...x, format: e.target.value }))} /></div>
                <div className={styles.createField}><label>Status</label>
                  <select value={editBattle.status} onChange={e => setEditBattle(x => ({ ...x, status: e.target.value }))}>
                    {['pending','confirmed','live','completed','declined','cancelled'].map(s => <option key={s}>{s}</option>)}
                  </select></div>
                <button className={styles.saveBtn} onClick={saveBattle}><i className="ri-check-line" /> Save</button>
              </div>
            </>}

            {editShop && <>
              <div className={styles.modalHeader}><span>Edit Shop Item</span><button onClick={() => setEditShop(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}><label>Title</label><input value={editShop.title || ''} onChange={e => setEditShop(x => ({ ...x, title: e.target.value }))} /></div>
                <div className={styles.createField}><label>Price (TZS)</label><input value={editShop.price || ''} onChange={e => setEditShop(x => ({ ...x, price: e.target.value }))} /></div>
                <div className={styles.createField}><label>Category</label>
                  <select value={editShop.category} onChange={e => setEditShop(x => ({ ...x, category: e.target.value }))}>
                    <option value="accounts">Account</option><option value="gear">Gear</option><option value="services">Service</option>
                  </select></div>
                <div className={styles.createField}><label>Description</label>
                  <textarea rows={3} value={editShop.description || ''} onChange={e => setEditShop(x => ({ ...x, description: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={saveShop}><i className="ri-check-line" /> Save</button>
              </div>
            </>}

            {battleModal && !editBattle && <>
              <div className={styles.modalHeader}><span>Create Battle</span><button onClick={() => setBattleModal(false)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                {[['player1','Player 1 Username'],['player2','Player 2 Username']].map(([k,l]) => (
                  <div key={k} className={styles.createField}><label>{l}</label>
                    <input placeholder="username" value={battleForm[k]} onChange={e => setBattleForm(x => ({ ...x, [k]: e.target.value }))} /></div>
                ))}
                <div className={styles.createField}><label>Scheduled At</label>
                  <input type="datetime-local" value={battleForm.scheduled_at} onChange={e => setBattleForm(x => ({ ...x, scheduled_at: e.target.value }))} /></div>
                <div className={styles.createField}><label>Game Mode</label>
                  <input placeholder="e.g. Elimination, Deathmatch…" value={battleForm.game_mode} onChange={e => setBattleForm(x => ({ ...x, game_mode: e.target.value }))} /></div>
                <div className={styles.createField}><label>Format</label>
                  <input placeholder="e.g. Bo3, Bo5, Round Robin…" value={battleForm.format} onChange={e => setBattleForm(x => ({ ...x, format: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={createBattle} disabled={battleCreating}>
                  {battleCreating ? 'Creating…' : <><i className="ri-sword-line" /> Create Battle</>}
                </button>
              </div>
            </>}
          </div>
        </div>
      )}
    </div>
  )
}
