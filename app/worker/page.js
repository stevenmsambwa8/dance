// app/worker/page.js
'use client';

import { useState, useEffect } from 'react';
import { GAME_SLUGS, GAME_META } from '@/lib/constants';
import styles from './page.module.css';

async function callCommand(secret, command, params) {
  const res = await fetch('/api/admin/command', {
    method: 'POST',
    headers: { 'x-admin-secret': secret, 'content-type': 'application/json' },
    body: JSON.stringify({ command, params }),
  });
  return res.json();
}

const STAGE_FORMATS = [
  { key: 'groups_knockout', label: 'Groups + Knockout' },
  { key: 'league', label: 'Premier League' },
  { key: 'br_points', label: 'Battle Royale Points' },
];
const SLOT_OPTIONS = [4, 8, 16, 32, 64];
const STATUS_OPTIONS = ['active', 'group_stage', 'knockout', 'completed', 'cancelled'];
const STATUS_COLOR = {
  active: '#0ea5e9', group_stage: '#f59e0b', knockout: '#a855f7',
  completed: '#64748b', cancelled: '#ef4444',
};

// Deletes/duplicates/restores are logged here so an accidental delete isn't
// final — no new DB table needed, this just lives in this browser.
const HISTORY_KEY = 'nabo_worker_tournament_history';
function loadHistory() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function pushHistory(entry) {
  if (typeof window === 'undefined') return [];
  try {
    const log = [entry, ...loadHistory()].slice(0, 50);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(log));
    return log;
  } catch { return loadHistory(); }
}

function StatusPill({ status }) {
  const color = STATUS_COLOR[status] || '#64748b';
  return (
    <span className={styles.statusPill} style={{ background: `${color}18`, color, border: `1px solid ${color}35` }}>
      {status}
    </span>
  );
}

export default function WorkerPage() {
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tournaments, setTournaments] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', prize: '', slots: '', status: 'active' });
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const [form, setForm] = useState({
    name: '',
    game_slug: GAME_SLUGS[0],
    stage_format: 'groups_knockout',
    slots: 16,
    prize: '',
    date: '',
    entrance_fee: '',
    is_test: false,
  });

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function addLog(line, ok = true) {
    setLog((prev) => [{ time: new Date().toLocaleTimeString(), line, ok }, ...prev].slice(0, 15));
  }

  async function refreshTournaments() {
    const result = await callCommand(secret, 'list-tournaments', {});
    if (result.ok) setTournaments(result.result.tournaments);
    else addLog(`Couldn't load tournaments: ${result.error}`, false);
  }

  useEffect(() => {
    if (unlocked) refreshTournaments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  useEffect(() => { setHistory(loadHistory()); }, []);

  async function run(command, params = {}) {
    setBusy(true);
    const result = await callCommand(secret, command, params);
    if (result.ok) {
      addLog(`${command} ✓ ${JSON.stringify(result.result)}`, true);
      refreshTournaments();
    } else {
      addLog(`${command} ✗ ${result.error}`, false);
    }
    setBusy(false);
    return result;
  }

  async function handleCreate() {
    if (!form.name.trim()) return addLog('Give the tournament a name first', false);
    setBusy(true);
    const result = await callCommand(secret, 'create-tournament', form);
    if (result.ok) {
      addLog(`Created "${result.result.tournament.name}" ✓`, true);
      setShowCreate(false);
      setForm({ ...form, name: '', prize: '', date: '', entrance_fee: '' });
      refreshTournaments();
    } else {
      addLog(`Create failed ✗ ${result.error}`, false);
    }
    setBusy(false);
  }

  function startEdit(t) {
    setEditingId(t.id);
    setEditForm({ name: t.name || '', prize: t.prize || '', slots: t.slots || '', status: t.status || 'active' });
    if (selected === t.id) setSelected(null);
  }

  async function saveEdit(t) {
    const result = await run('edit-tournament', { tournament_id: t.id, ...editForm });
    if (result.ok) setEditingId(null);
  }

  async function handleDuplicate(t) {
    const result = await run('duplicate-tournament', { tournament_id: t.id });
    if (result.ok) {
      setHistory(pushHistory({ action: 'duplicated', at: new Date().toISOString(), snapshot: result.result.tournament, from: t.name }));
    }
  }

  async function handleDelete(t) {
    if (!confirm(`Delete "${t.name}" and all its data?`)) return;
    const result = await run('delete-tournament', { tournament_id: t.id });
    if (result.ok) {
      setHistory(pushHistory({ action: 'deleted', at: new Date().toISOString(), snapshot: result.result.deleted }));
      if (selected === t.id) setSelected(null);
    }
  }

  async function handleRestore(entry) {
    const s = entry.snapshot;
    setBusy(true);
    const result = await callCommand(secret, 'create-tournament', {
      name: s.name, game_slug: s.game_slug, stage_format: s.stage_format, slots: s.slots,
      prize: s.prize, date: s.date, entrance_fee: s.entrance_fee, description: s.description,
      team_size: s.team_size, group_count: s.group_count, advance_per_group: s.advance_per_group,
      is_test: s.is_test,
    });
    if (result.ok) {
      addLog(`Restored "${s.name}" ✓`, true);
      refreshTournaments();
      setHistory(pushHistory({ action: 'restored', at: new Date().toISOString(), snapshot: result.result.tournament, from: s.name }));
    } else {
      addLog(`Restore failed ✗ ${result.error}`, false);
    }
    setBusy(false);
  }

  // ── Lock screen ──
  if (!unlocked) {
    return (
      <div className={styles.page}>
        <div className={styles.lockCard}>
          <div className={styles.lockIcon}><i className="ri-shield-keyhole-line" /></div>
          <h2>Worker Access</h2>
          <input
            type="password"
            placeholder="Admin password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && secret && setUnlocked(true)}
            className={styles.input}
          />
          <button className={styles.primaryBtn} onClick={() => secret && setUnlocked(true)}>
            Unlock
          </button>
        </div>
      </div>
    );
  }

  const selectedT = tournaments?.find((t) => t.id === selected);
  const q = search.trim().toLowerCase();
  const filtered = (tournaments || []).filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (q && !(t.name || '').toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <span className={styles.topTitle}><i className="ri-tools-fill" /> Tournament Worker</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={styles.iconBtn} title="History" onClick={() => setShowHistory((v) => !v)}>
            <i className="ri-history-line" />
          </button>
          <button className={styles.newBtn} onClick={() => setShowCreate((v) => !v)}>
            <i className={showCreate ? 'ri-close-line' : 'ri-add-line'} /> {showCreate ? 'Cancel' : 'New Tournament'}
          </button>
        </div>
      </div>

      {/* ── Create form — just name + game, everything else defaulted ── */}
      {showCreate && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Create Tournament</h3>
          <p className={styles.hint}>
            Defaults: 16 slots, Groups + Knockout, free entry, no date/prize set yet.
            Edit any of that on the main site after — or expand "More options" below.
          </p>

          <label className={styles.label}>Name</label>
          <input
            className={styles.input}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. Friday Night Cup"
          />

          <label className={styles.label}>Game</label>
          <select className={styles.input} value={form.game_slug} onChange={(e) => set('game_slug', e.target.value)}>
            {GAME_SLUGS.map((slug) => (
              <option key={slug} value={slug}>{GAME_META[slug]?.name || slug}</option>
            ))}
          </select>

          <button className={styles.toggleRow} onClick={() => setShowMore((v) => !v)}>
            <i className={showMore ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            <span>More options {showMore ? '' : '(slots, format, prize, date, fee)'}</span>
          </button>

          {showMore && (
            <>
              <div className={styles.fieldRow}>
                <div style={{ flex: 1 }}>
                  <label className={styles.label}>Slots</label>
                  <select className={styles.input} value={form.slots} onChange={(e) => set('slots', Number(e.target.value))}>
                    {SLOT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className={styles.label}>Format</label>
                  <select className={styles.input} value={form.stage_format} onChange={(e) => set('stage_format', e.target.value)}>
                    {STAGE_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              </div>

              <div className={styles.fieldRow}>
                <div style={{ flex: 1 }}>
                  <label className={styles.label}>Prize (TZS)</label>
                  <input className={styles.input} value={form.prize} onChange={(e) => set('prize', e.target.value)} placeholder="e.g. 500,000" />
                </div>
                <div style={{ flex: 1 }}>
                  <label className={styles.label}>Date</label>
                  <input className={styles.input} value={form.date} onChange={(e) => set('date', e.target.value)} placeholder="e.g. Apr 20" />
                </div>
              </div>

              <label className={styles.label}>Entrance Fee (TZS, optional)</label>
              <input className={styles.input} value={form.entrance_fee} onChange={(e) => set('entrance_fee', e.target.value)} placeholder="Leave blank for free entry" />

              <button className={styles.toggleRow} onClick={() => set('is_test', !form.is_test)}>
                <i className={form.is_test ? 'ri-flask-fill' : 'ri-flask-line'} />
                <span>Test Run {form.is_test ? '(silent — no notifications)' : ''}</span>
              </button>
            </>
          )}

          <button className={styles.primaryBtn} disabled={busy} onClick={handleCreate}>
            <i className="ri-rocket-line" /> Create Tournament
          </button>
        </div>
      )}

      {/* ── History panel ── */}
      {showHistory && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>History</h3>
          <p className={styles.hint}>Deletes, duplicates and restores on this device — kept so an accidental delete isn't final.</p>
          {history.length === 0 && <p className={styles.hint}>Nothing yet.</p>}
          {history.map((h, i) => (
            <div key={i} className={styles.historyItem}>
              <div className={styles.listInfo}>
                <span className={styles.listName}>{h.snapshot?.name || '—'}</span>
                <span className={styles.listMeta}>
                  {h.action} · {new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {h.from ? ` · from "${h.from}"` : ''}
                </span>
              </div>
              {h.action === 'deleted' && (
                <button className={styles.iconBtn} title="Restore" disabled={busy} onClick={() => handleRestore(h)}>
                  <i className="ri-arrow-go-back-line" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Tournament grid ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Tournaments</h3>

        {tournaments === null && <p className={styles.hint}>Loading…</p>}
        {tournaments?.length === 0 && <p className={styles.hint}>None yet — create one above.</p>}

        {tournaments && tournaments.length > 0 && (
          <>
            <div className={styles.toolbar}>
              <div className={styles.searchBox}>
                <i className="ri-search-line" />
                <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className={styles.input} style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All status</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {filtered.length === 0 && <p className={styles.hint}>No tournaments match.</p>}

            <div className={styles.grid}>
              {filtered.map((t) => {
                const isEditing = editingId === t.id;
                const isSelected = selected === t.id;
                return (
                  <div key={t.id} className={`${styles.gridCard} ${isSelected ? styles.gridCardActive : ''}`}>
                    {isEditing ? (
                      <div className={styles.editForm}>
                        <input className={styles.input} value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" />
                        <div className={styles.fieldRow}>
                          <input className={styles.input} value={editForm.prize} onChange={(e) => setEditForm((f) => ({ ...f, prize: e.target.value }))} placeholder="Prize" />
                          <input className={styles.input} type="number" value={editForm.slots} onChange={(e) => setEditForm((f) => ({ ...f, slots: e.target.value }))} placeholder="Slots" />
                        </div>
                        <select className={styles.input} value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <div className={styles.fieldRow}>
                          <button className={styles.smallBtn} disabled={busy} onClick={() => saveEdit(t)}>
                            <i className="ri-check-line" /> Save
                          </button>
                          <button className={styles.smallBtnGhost} onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button className={styles.gridCardBody} onClick={() => setSelected(isSelected ? null : t.id)}>
                          <div className={styles.gridCardTop}>
                            <span className={styles.listGameIcon}><i className={GAME_META[t.game_slug]?.icon || 'ri-gamepad-line'} /></span>
                            <StatusPill status={t.status} />
                          </div>
                          <span className={styles.gridCardName}>{t.name}{t.is_test && ' 🧪'}</span>
                          <span className={styles.listMeta}>
                            {GAME_META[t.game_slug]?.name || t.game_slug} · {t.registered_count || 0}/{t.slots}
                          </span>
                        </button>
                        <div className={styles.gridCardFoot}>
                          <button className={styles.iconBtn} title="Edit" onClick={() => startEdit(t)}><i className="ri-edit-line" /></button>
                          <button className={styles.iconBtn} title="Duplicate" disabled={busy} onClick={() => handleDuplicate(t)}><i className="ri-file-copy-line" /></button>
                          <button className={styles.iconBtnDanger} title="Delete" disabled={busy} onClick={() => handleDelete(t)}><i className="ri-delete-bin-line" /></button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Actions for selected tournament ── */}
      {selectedT && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Manage: {selectedT.name}</h3>
          <div className={styles.actionGrid}>
            <button disabled={busy} onClick={() => run('generate-group-stage', { tournament_id: selectedT.id, group_size: 4 })}>
              Generate Group Stage
            </button>
            <button disabled={busy} onClick={() => run('generate-bracket', { tournament_id: selectedT.id })}>
              Generate Knockout Bracket
            </button>
            <button disabled={busy} onClick={() => run('finalize-tournament', { tournament_id: selectedT.id })}>
              Finalize Tournament
            </button>
            <button disabled={busy} onClick={() => run('list-stuck-matches', { tournament_id: selectedT.id, minutes_threshold: 60 })}>
              Check Stuck Matches
            </button>
          </div>
        </div>
      )}

      {/* ── Log ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Activity Log</h3>
        {log.length === 0 && <p className={styles.hint}>Nothing yet.</p>}
        {log.map((entry, i) => (
          <div key={i} className={styles.logLine} style={{ color: entry.ok ? 'var(--tone-clan, #22c55e)' : 'var(--tone-danger, #dc2626)' }}>
            [{entry.time}] {entry.line}
          </div>
        ))}
      </div>
    </div>
  );
}
