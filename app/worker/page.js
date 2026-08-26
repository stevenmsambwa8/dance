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

export default function WorkerPage() {
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tournaments, setTournaments] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <span className={styles.topTitle}><i className="ri-tools-fill" /> Tournament Worker</span>
        <button className={styles.newBtn} onClick={() => setShowCreate((v) => !v)}>
          <i className={showCreate ? 'ri-close-line' : 'ri-add-line'} /> {showCreate ? 'Cancel' : 'New Tournament'}
        </button>
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

      {/* ── Tournament list ── */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Tournaments</h3>
        {tournaments === null && <p className={styles.hint}>Loading…</p>}
        {tournaments?.length === 0 && <p className={styles.hint}>None yet — create one above.</p>}
        <div className={styles.list}>
          {tournaments?.map((t) => (
            <button
              key={t.id}
              className={`${styles.listItem} ${selected === t.id ? styles.listItemActive : ''}`}
              onClick={() => setSelected(t.id === selected ? null : t.id)}
            >
              <span className={styles.listGameIcon}><i className={GAME_META[t.game_slug]?.icon || 'ri-gamepad-line'} /></span>
              <span className={styles.listInfo}>
                <span className={styles.listName}>{t.name}{t.is_test && ' 🧪'}</span>
                <span className={styles.listMeta}>
                  {GAME_META[t.game_slug]?.name || t.game_slug} · {t.stage_format} · {t.registered_count}/{t.slots} · {t.status}
                </span>
              </span>
              <i className={`ri-arrow-${selected === t.id ? 'up' : 'down'}-s-line`} />
            </button>
          ))}
        </div>
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
