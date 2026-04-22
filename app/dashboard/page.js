'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, ADMIN_EMAIL } from '../../components/AuthProvider'
import { supabase } from '../../lib/supabase'
import { RANK_TIERS } from '../../lib/constants'
import styles from './page.module.css'
import usePageLoading from '../../components/usePageLoading'

function makeMatchCode(id) {
  if (!id) return '0000'
  const clean = id.replace(/-/g, '')
  return ((clean[0] || '0') + (clean[2] || '0') + (clean[9] || '0') + (clean[14] || '0')).toLowerCase()
}

const TABS = ['Overview', 'Todos', 'Users', 'Posts', 'Tournaments', 'Battles', 'Shop']

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

  // Edit states
  const [editUser, setEditUser] = useState(null)
  const [editPost, setEditPost] = useState(null)
  const [editTournament, setEditTournament] = useState(null)
  const [editShop, setEditShop] = useState(null)
  const [editBattle, setEditBattle] = useState(null)

  // Create battle
  const [battleModal, setBattleModal] = useState(false)
  const [battleForm, setBattleForm] = useState({ player1: '', player2: '', game_mode: '', format: '', scheduled_at: '' })
  const [battleCreating, setBattleCreating] = useState(false)

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/')
  }, [authLoading, isAdmin])

  useEffect(() => {
    if (isAdmin) loadAll()
  }, [isAdmin])

  // Live updates for tournament payment submissions
  useEffect(() => {
    if (!isAdmin) return
    const ch = supabase
      .channel('admin-tournament-payments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tournament_payments' }, () => {
        loadTournamentPayments()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [isAdmin])

  async function loadAll() {
    setDataLoading(true)
    const [
      { count: userCount }, { count: postCount }, { count: tournCount }, { count: matchCount },
      { data: recentUsers }, { data: recentPosts }, { data: recentTourns }, { data: recentBattles }, { data: shopData }
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

  useEffect(() => {
    if (isAdmin && tab === 'Todos') { loadTodos(); loadTournamentPayments() }
  }, [isAdmin, tab])

  async function loadTodos() {
    setTodosLoading(true)
    const { data } = await supabase
      .from('buy_requests')
      .select(`
        id, status, offer_price, payment_ref, payment_phone,
        paid_at, payout_name, payout_number, seller_message, admin_approved_at, item_id,
        buyer:profiles!buy_requests_buyer_id_fkey(username, avatar_url),
        seller:profiles!buy_requests_seller_id_fkey(username, avatar_url),
        shop_items(title)
      `)
      .in('status', ['payment_submitted', 'admin_approved', 'payout_pending'])
      .order('paid_at', { ascending: true })
    setTodos(data || [])
    setTodosLoading(false)
  }

  async function loadTournamentPayments() {
    setTournamentPaymentsLoading(true)
    const { data } = await supabase
      .from('tournament_payments')
      .select(`
        id, status, amount, payment_ref, payment_phone, submitted_at,
        tournament_id,
        user:profiles!tournament_payments_user_id_fkey(id, username, avatar_url),
        tournaments(id, name, slug, entrance_fee)
      `)
      .eq('status', 'payment_submitted')
      .order('submitted_at', { ascending: true })
    setTournamentPayments(data || [])
    setTournamentPaymentsLoading(false)
  }

  async function approveTournamentPayment(pmt) {
    const { data: adminProf } = await supabase.from('profiles').select('id').eq('email', ADMIN_EMAIL).single()
    const adminId = adminProf?.id
    const { error } = await supabase.rpc('approve_tournament_payment', {
      p_payment_id: pmt.id,
      p_admin_id: adminId,
    })
    if (error) { alert(error.message); return }

    // Notify the user
    await supabase.from('notifications').insert({
      user_id: pmt.user.id,
      title: '✅ Payment Approved — You\'re Registered!',
      body: `Your entry fee for "${pmt.tournaments?.name}" has been verified. You are now registered and placed in the bracket!`,
      type: 'tournament',
      meta: { tournament_id: pmt.tournament_id },
      read: false,
    })
    loadTournamentPayments()
  }

  async function rejectTournamentPayment(pmt) {
    if (!confirm(`Reject payment from ${pmt.user?.username}?`)) return
    await supabase.from('tournament_payments').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', pmt.id)
    await supabase.from('notifications').insert({
      user_id: pmt.user.id,
      title: '❌ Payment Rejected',
      body: `Your entry fee for "${pmt.tournaments?.name}" was rejected. Please check your reference and resubmit.`,
      type: 'tournament',
      meta: { tournament_id: pmt.tournament_id },
      read: false,
    })
    loadTournamentPayments()
  }

  async function todoApprove(req) {
    await supabase.from('buy_requests').update({
      status: 'admin_approved',
      admin_approved_at: new Date().toISOString(),
    }).eq('id', req.id)
    await supabase.from('notifications').insert([
      { user_id: req.seller?.id || req.seller_id, type: 'request_update', title: '✅ Payment Confirmed — Fill Payout Details', body: `Payment for "${req.shop_items?.title}" verified. Please fill in your account details for payout.`, meta: { request_id: req.id, item_id: req.item_id }, read: false },
      { user_id: req.buyer?.id  || req.buyer_id,  type: 'request_update', title: '✅ Payment Verified by Admin', body: `Your payment for "${req.shop_items?.title}" is confirmed. Waiting for seller's details.`, meta: { request_id: req.id, item_id: req.item_id }, read: false },
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
    const { error } = await supabase.from('profiles').update({
      username: editUser.username,
      tier: editUser.tier,
      level: Number(editUser.level ?? 1),
      wins: Number(editUser.wins),
      losses: Number(editUser.losses),
      points: Number(editUser.points),
      bio: editUser.bio,
    }).eq('id', editUser.id)
    if (error) { alert(error.message); return }
    setUsers(u => u.map(x => x.id === editUser.id ? { ...x, ...editUser } : x))
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
      name: editTournament.name,
      prize: editTournament.prize,
      format: editTournament.format,
      slots: Number(editTournament.slots),
      date: editTournament.date,
      status: editTournament.status,
      description: editTournament.description,
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
      status: editBattle.status,
      game_mode: editBattle.game_mode,
      format: editBattle.format,
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
      challenger_id: p1.id, challenged_id: p2.id,
      game_mode: battleForm.game_mode, format: battleForm.format,
      scheduled_at: battleForm.scheduled_at || null, status: 'confirmed',
    })
    setBattleCreating(false)
    if (!error) { setBattleModal(false); loadAll() }
    else alert(error.message)
  }

  // ── Shop ──
  async function saveShop() {
    const { error } = await supabase.from('shop_items').update({
      title: editShop.title,
      price: editShop.price,
      category: editShop.category,
      description: editShop.description,
      active: editShop.active,
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

  if (authLoading) return null
  if (!isAdmin) return null

  const anyEdit = editUser || editPost || editTournament || editBattle || editShop || battleModal

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div>
          <p className={styles.eyebrow}>Admin · {ADMIN_EMAIL}</p>
          <h1 className={styles.headline}>DASHBOARD</h1>
        </div>
        <button className={styles.refreshBtn} onClick={loadAll}><i className="ri-refresh-line" /></button>
      </div>

      <div className={styles.statsGrid}>
        {[
          { label: 'Users', value: stats.users, icon: 'ri-user-line' },
          { label: 'Posts', value: stats.posts, icon: 'ri-article-line' },
          { label: 'Tournaments', value: stats.tournaments, icon: 'ri-trophy-line' },
          { label: 'Matches', value: stats.matches, icon: 'ri-sword-line' },
        ].map(s => (
          <div key={s.label} className={styles.statCard}>
            <i className={s.icon} />
            <span className={styles.statVal}>{s.value ?? '…'}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.tabs}>
        {TABS.map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
            {t}
            {t === 'Todos' && (todos.length + tournamentPayments.length) > 0 && (
              <span style={{ marginLeft: 5, background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 800, padding: '1px 5px' }}>
                {todos.length + tournamentPayments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {!dataLoading && (<>

          {tab === 'Todos' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Payment actions requiring admin attention. <strong style={{ color: (todos.length + tournamentPayments.length) > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{todos.length + tournamentPayments.length} pending</strong>
                </p>
                <button className={styles.refreshBtn} onClick={() => { loadTodos(); loadTournamentPayments() }}><i className="ri-refresh-line" /></button>
              </div>

              {(todosLoading || tournamentPaymentsLoading) && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>}

              {!todosLoading && !tournamentPaymentsLoading && todos.length === 0 && tournamentPayments.length === 0 && (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  <i className="ri-checkbox-circle-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                  All clear — no pending payment actions.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {todos.map(req => {
                  const isPaySub   = req.status === 'payment_submitted'
                  const isAdmAppr  = req.status === 'admin_approved'
                  const isPoP      = req.status === 'payout_pending'
                  const stepColor  = isPaySub ? '#0ea5e9' : isAdmAppr ? '#a855f7' : '#f97316'
                  const stepLabel  = isPaySub ? '💳 Verify Payment' : isAdmAppr ? '⏳ Awaiting Seller Payout Info' : '🏦 Release Payout'
                  const deadline   = req.paid_at ? new Date(req.paid_at).getTime() + 10 * 3600 * 1000 : null
                  const remaining  = deadline ? Math.max(0, deadline - Date.now()) : null
                  const h          = remaining !== null ? Math.floor(remaining / 3600000) : null
                  const m          = remaining !== null ? Math.floor((remaining % 3600000) / 60000) : null
                  const urgent     = remaining !== null && remaining < 2 * 3600000

                  return (
                    <div key={req.id} style={{ padding: 16, borderRadius: 14, border: `1.5px solid ${stepColor}40`, background: 'var(--surface)' }}>
                      {/* Header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: stepColor }}>{stepLabel}</span>
                        {remaining !== null && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: urgent ? '#ef4444' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <i className={urgent ? 'ri-alarm-warning-line' : 'ri-timer-line'} />
                            {h}h {m}m left
                          </span>
                        )}
                      </div>

                      {/* Parties + item */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 12, marginBottom: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Item</span>
                        <strong>{req.shop_items?.title || '—'}</strong>
                        <span style={{ color: 'var(--text-muted)' }}>Buyer</span>
                        <strong>{req.buyer?.username || '—'}</strong>
                        <span style={{ color: 'var(--text-muted)' }}>Seller</span>
                        <strong>{req.seller?.username || '—'}</strong>
                        <span style={{ color: 'var(--text-muted)' }}>Amount</span>
                        <strong>TZS {Number(req.offer_price).toLocaleString()}</strong>
                        {req.payment_ref   && <><span style={{ color: 'var(--text-muted)' }}>Ref</span><strong>{req.payment_ref}</strong></>}
                        {req.payment_phone && <><span style={{ color: 'var(--text-muted)' }}>Phone</span><strong>{req.payment_phone}</strong></>}
                        {req.payout_name   && <><span style={{ color: 'var(--text-muted)' }}>Payout To</span><strong>{req.payout_name}</strong></>}
                        {req.payout_number && <><span style={{ color: 'var(--text-muted)' }}>Account #</span><strong>{req.payout_number}</strong></>}
                        {req.seller_message && <><span style={{ color: 'var(--text-muted)' }}>Seller Note</span><strong style={{ whiteSpace: 'pre-wrap' }}>{req.seller_message}</strong></>}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <a href={`/shop/${req.item_id}/request/${req.id}`} target="_blank" rel="noopener noreferrer"
                          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: 'var(--bg-2)', border: '1px solid var(--border-dark)', borderRadius: 8, fontSize: 12, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}>
                          <i className="ri-external-link-line" /> View Thread
                        </a>
                        {isPaySub && (
                          <button
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#0ea5e9', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 800, color: '#fff', cursor: 'pointer' }}
                            onClick={() => todoApprove(req)}
                          >
                            <i className="ri-check-double-line" /> Approve Payment
                          </button>
                        )}
                        {isPoP && (
                          <button
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#22c55e', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 800, color: '#fff', cursor: 'pointer' }}
                            onClick={() => todoComplete(req)}
                          >
                            <i className="ri-check-double-line" /> Release Funds
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* ── Tournament Entry Fee Payments ── */}
              {tournamentPayments.length > 0 && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '20px 0 10px' }}>
                    <i className="ri-trophy-line" style={{ marginRight: 5 }} />Tournament Entry Fees
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {tournamentPayments.map(pmt => (
                      <div key={pmt.id} style={{ padding: 16, borderRadius: 14, border: '1.5px solid rgba(14,165,233,0.35)', background: 'var(--surface)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#0ea5e9' }}>💳 Verify Tournament Payment</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {new Date(pmt.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 12, marginBottom: 12 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Tournament</span>
                          <strong>{pmt.tournaments?.name || '—'}</strong>
                          <span style={{ color: 'var(--text-muted)' }}>Player</span>
                          <strong>{pmt.user?.username || '—'}</strong>
                          <span style={{ color: 'var(--text-muted)' }}>Amount</span>
                          <strong>TZS {Number(pmt.amount).toLocaleString()}</strong>
                          {pmt.payment_ref   && <><span style={{ color: 'var(--text-muted)' }}>Ref</span><strong>{pmt.payment_ref}</strong></>}
                          {pmt.payment_phone && <><span style={{ color: 'var(--text-muted)' }}>Phone</span><strong>{pmt.payment_phone}</strong></>}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <a
                            href={`/tournaments/${pmt.tournaments?.slug || pmt.tournament_id}`}
                            target="_blank" rel="noopener noreferrer"
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: 'var(--bg-2)', border: '1px solid var(--border-dark)', borderRadius: 8, fontSize: 12, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}
                          >
                            <i className="ri-external-link-line" /> View Tournament
                          </a>
                          <button
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#0ea5e9', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 800, color: '#fff', cursor: 'pointer' }}
                            onClick={() => approveTournamentPayment(pmt)}
                          >
                            <i className="ri-check-double-line" /> Approve & Register
                          </button>
                          <button
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '9px 12px', background: 'var(--surface)', border: '1px solid var(--border-dark)', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#ef4444', cursor: 'pointer' }}
                            onClick={() => rejectTournamentPayment(pmt)}
                          >
                            <i className="ri-close-line" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'Overview' && (
            <div className={styles.overview}>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Full admin control. Edit or delete any record across the platform.</p>
              <div className={styles.quickActions}>
                {[
                  { label: 'Manage Tournaments', icon: 'ri-trophy-line', action: () => setTab('Tournaments') },
                  { label: 'Create Battle', icon: 'ri-sword-line', action: () => { setTab('Battles'); setBattleModal(true) } },
                  { label: 'Tournaments Page', icon: 'ri-external-link-line', action: () => router.push('/tournaments') },
                ].map(a => (
                  <button key={a.label} className={styles.qaBtn} onClick={a.action}>
                    <i className={a.icon} /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'Users' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Username</th><th>Email</th><th>Tier</th><th>Rank</th><th>Wins</th><th>Points</th><th>Actions</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td><a href={`/profile/${u.id}`} className={styles.link}>{u.username}</a></td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</td>
                      <td>{u.tier}</td>
                      <td>Lv.{u.level ?? 1}</td>
                      <td>{u.wins}</td>
                      <td>{(u.points || 0).toLocaleString()}</td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        <button className={styles.editBtn} onClick={() => setEditUser({ ...u })}><i className="ri-edit-line" /></button>
                        <button className={styles.delBtn} onClick={() => deleteUser(u.id)}><i className="ri-delete-bin-line" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Posts' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>User</th><th>Content</th><th>Likes</th><th>Comments</th><th>Date</th><th>Actions</th></tr></thead>
                <tbody>
                  {posts.map(p => (
                    <tr key={p.id}>
                      <td className={styles.bold}>{p.profiles?.username}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.content}</td>
                      <td>{p.likes}</td>
                      <td>{p.comment_count}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        <button className={styles.editBtn} onClick={() => setEditPost({ ...p })}><i className="ri-edit-line" /></button>
                        <button className={styles.delBtn} onClick={() => deletePost(p.id)}><i className="ri-delete-bin-line" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Tournaments' && (
            <div>
              <button className={styles.createBtn} onClick={() => router.push('/tournaments')}>
                <i className="ri-add-line" /> Create Tournament
              </button>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Name</th><th>Game</th><th>Prize (TZS)</th><th>Slots</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {tournaments.map(t => (
                      <tr key={t.id}>
                        <td className={styles.bold}><a href={`/tournaments/${t.id}`} className={styles.link}>{t.name}</a></td>
                        <td>{t.game_slug}</td>
                        <td>{t.prize}</td>
                        <td>{t.registered_count}/{t.slots}</td>
                        <td>
                          <select className={styles.statusSelect} value={t.status} onChange={async e => {
                            const s = e.target.value
                            await supabase.from('tournaments').update({ status: s }).eq('id', t.id)
                            setTournaments(ts => ts.map(x => x.id === t.id ? { ...x, status: s } : x))
                          }}>
                            <option>active</option><option>completed</option><option>cancelled</option>
                          </select>
                        </td>
                        <td style={{ display: 'flex', gap: 4 }}>
                          <button className={styles.editBtn} onClick={() => setEditTournament({ ...t })}><i className="ri-edit-line" /></button>
                          <button className={styles.delBtn} onClick={() => deleteTournament(t.id)}><i className="ri-delete-bin-line" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'Battles' && (
            <div>
              <button className={styles.createBtn} onClick={() => setBattleModal(true)}>
                <i className="ri-add-line" /> Create Battle
              </button>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Challenger</th><th>Challenged</th><th>Mode</th><th>Format</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
                  <tbody>
                    {battles.map(b => (
                      <tr key={b.id}>
                        <td className={styles.bold}>{b.challenger?.username}</td>
                        <td>{b.challenged?.username}</td>
                        <td>{b.game_mode}</td>
                        <td>{b.format}</td>
                        <td><span className={styles.statusPill}>{b.status}</span></td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.scheduled_at ? new Date(b.scheduled_at).toLocaleDateString() : 'TBD'}</td>
                        <td style={{ display: 'flex', gap: 4 }}>
                          <button className={styles.editBtn} onClick={() => router.push(`/matches/${makeMatchCode(b.id)}`)} title="Full detail"><i className="ri-external-link-line" /></button>
                          <button className={styles.editBtn} onClick={() => setEditBattle({ ...b })}><i className="ri-edit-line" /></button>
                          <button className={styles.delBtn} onClick={() => deleteBattle(b.id)}><i className="ri-delete-bin-line" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'Shop' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Title</th><th>Seller</th><th>Price (TZS)</th><th>Category</th><th>Active</th><th>Actions</th></tr></thead>
                <tbody>
                  {shopItems.map(item => (
                    <tr key={item.id}>
                      <td className={styles.bold}>{item.title}</td>
                      <td>{item.profiles?.username}</td>
                      <td>{item.price}</td>
                      <td>{item.category}</td>
                      <td>
                        <button
                          className={`${styles.toggleBtn} ${item.active ? styles.toggleOn : styles.toggleOff}`}
                          onClick={async () => {
                            await supabase.from('shop_items').update({ active: !item.active }).eq('id', item.id)
                            setShopItems(s => s.map(x => x.id === item.id ? { ...x, active: !item.active } : x))
                          }}
                        >{item.active ? 'Active' : 'Hidden'}</button>
                      </td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        <button className={styles.editBtn} onClick={() => setEditShop({ ...item })}><i className="ri-edit-line" /></button>
                        <button className={styles.delBtn} onClick={() => deleteShop(item.id)}><i className="ri-delete-bin-line" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </>)}
      </div>

      {/* ── Edit Modals ── */}
      {anyEdit && (
        <div className={styles.modalOverlay} onClick={() => { setEditUser(null); setEditPost(null); setEditTournament(null); setEditBattle(null); setEditShop(null); setBattleModal(false) }}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>

            {/* Edit User */}
            {editUser && <>
              <div className={styles.modalHeader}><span>Edit User</span><button onClick={() => setEditUser(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}>
                  <label>Username</label>
                  <input type="text" value={editUser.username || ''} onChange={e => setEditUser(x => ({ ...x, username: e.target.value }))} />
                </div>
                <div className={styles.createField}>
                  <label>Rank Tier</label>
                  <select value={editUser.tier || 'Gold'} onChange={e => setEditUser(x => ({ ...x, tier: e.target.value }))}>
                    {RANK_TIERS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                {[['level','Level','number'],['wins','Wins','number'],['losses','Losses','number'],['points','Points','number']].map(([k,l,t]) => (
                  <div key={k} className={styles.createField}>
                    <label>{l}</label>
                    <input type={t} value={editUser[k] || ''} onChange={e => setEditUser(x => ({ ...x, [k]: e.target.value }))} />
                  </div>
                ))}
                <div className={styles.createField}><label>Bio</label><textarea rows={2} value={editUser.bio || ''} onChange={e => setEditUser(x => ({ ...x, bio: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={saveUser}><i className="ri-check-line" /> Save User</button>
              </div>
            </>}

            {/* Edit Post */}
            {editPost && <>
              <div className={styles.modalHeader}><span>Edit Post</span><button onClick={() => setEditPost(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}><label>Content</label><textarea rows={5} value={editPost.content || ''} onChange={e => setEditPost(x => ({ ...x, content: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={savePost}><i className="ri-check-line" /> Save Post</button>
              </div>
            </>}

            {/* Edit Tournament */}
            {editTournament && <>
              <div className={styles.modalHeader}><span>Edit Tournament</span><button onClick={() => setEditTournament(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                {[['name','Name','text'],['prize','Prize (TZS)','text'],['format','Format','text'],['slots','Max Slots','number'],['date','Date','text']].map(([k,l,t]) => (
                  <div key={k} className={styles.createField}>
                    <label>{l}</label>
                    <input type={t} value={editTournament[k] || ''} onChange={e => setEditTournament(x => ({ ...x, [k]: e.target.value }))} />
                  </div>
                ))}
                <div className={styles.createField}><label>Status</label>
                  <select value={editTournament.status} onChange={e => setEditTournament(x => ({ ...x, status: e.target.value }))}>
                    <option>active</option><option>completed</option><option>cancelled</option>
                  </select>
                </div>
                <div className={styles.createField}><label>Description</label><textarea rows={3} value={editTournament.description || ''} onChange={e => setEditTournament(x => ({ ...x, description: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={saveTournament}><i className="ri-check-line" /> Save Tournament</button>
              </div>
            </>}

            {/* Edit Battle */}
            {editBattle && <>
              <div className={styles.modalHeader}><span>Edit Battle</span><button onClick={() => setEditBattle(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}><label>Game Mode</label>
                  <input placeholder="e.g. Elimination, Deathmatch…" value={editBattle.game_mode || ''} onChange={e => setEditBattle(x => ({ ...x, game_mode: e.target.value }))} />
                </div>
                <div className={styles.createField}><label>Format</label>
                  <input placeholder="e.g. Bo3, Bo5, Round Robin…" value={editBattle.format || ''} onChange={e => setEditBattle(x => ({ ...x, format: e.target.value }))} />
                </div>
                <div className={styles.createField}><label>Status</label>
                  <select value={editBattle.status} onChange={e => setEditBattle(x => ({ ...x, status: e.target.value }))}>
                    {['pending','confirmed','live','completed','declined','cancelled'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <button className={styles.saveBtn} onClick={saveBattle}><i className="ri-check-line" /> Save Battle</button>
              </div>
            </>}

            {/* Edit Shop Item */}
            {editShop && <>
              <div className={styles.modalHeader}><span>Edit Shop Item</span><button onClick={() => setEditShop(null)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                <div className={styles.createField}><label>Title</label><input value={editShop.title || ''} onChange={e => setEditShop(x => ({ ...x, title: e.target.value }))} /></div>
                <div className={styles.createField}><label>Price (TZS)</label><input value={editShop.price || ''} onChange={e => setEditShop(x => ({ ...x, price: e.target.value }))} /></div>
                <div className={styles.createField}><label>Category</label>
                  <select value={editShop.category} onChange={e => setEditShop(x => ({ ...x, category: e.target.value }))}>
                    <option value="accounts">Account</option><option value="gear">Gear</option><option value="services">Service</option>
                  </select>
                </div>
                <div className={styles.createField}><label>Description</label><textarea rows={3} value={editShop.description || ''} onChange={e => setEditShop(x => ({ ...x, description: e.target.value }))} /></div>
                <button className={styles.saveBtn} onClick={saveShop}><i className="ri-check-line" /> Save Item</button>
              </div>
            </>}

            {/* Create Battle */}
            {battleModal && !editBattle && <>
              <div className={styles.modalHeader}><span>Create Battle</span><button onClick={() => setBattleModal(false)}><i className="ri-close-line" /></button></div>
              <div className={styles.modalBody}>
                {[['player1','Player 1 Username'],['player2','Player 2 Username']].map(([k,l]) => (
                  <div key={k} className={styles.createField}><label>{l}</label><input placeholder="username" value={battleForm[k]} onChange={e => setBattleForm(x => ({ ...x, [k]: e.target.value }))} /></div>
                ))}
                <div className={styles.createField}><label>Scheduled At</label><input type="datetime-local" value={battleForm.scheduled_at} onChange={e => setBattleForm(x => ({ ...x, scheduled_at: e.target.value }))} /></div>
                <div className={styles.createField}><label>Game Mode</label>
                  <input placeholder="e.g. Elimination, Deathmatch, Sniper…" value={battleForm.game_mode} onChange={e => setBattleForm(x => ({ ...x, game_mode: e.target.value }))} />
                </div>
                <div className={styles.createField}><label>Format</label>
                  <input placeholder="e.g. Bo1, Bo3, Bo5, Round Robin…" value={battleForm.format} onChange={e => setBattleForm(x => ({ ...x, format: e.target.value }))} />
                </div>
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
