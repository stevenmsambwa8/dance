// app/worker/page.js
//
// Your control panel. Visit yoursite.com/worker, type your password once,
// type a tournament ID, tap buttons.

'use client';

import { useState } from 'react';

async function callCommand(secret, command, params) {
  const res = await fetch('/api/admin/command', {
    method: 'POST',
    headers: { 'x-admin-secret': secret, 'content-type': 'application/json' },
    body: JSON.stringify({ command, params }),
  });
  return res.json();
}

export default function WorkerPage() {
  const [secret, setSecret] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tournamentId, setTournamentId] = useState('');
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  function addLog(line) {
    setLog((prev) => [{ time: new Date().toLocaleTimeString(), line }, ...prev].slice(0, 20));
  }

  async function run(command, extraParams = {}) {
    if (!tournamentId) {
      addLog('❌ Enter a tournament ID first');
      return;
    }
    setBusy(true);
    try {
      const result = await callCommand(secret, command, { tournament_id: tournamentId, ...extraParams });
      if (result.ok) {
        addLog(`✅ ${command} succeeded: ${JSON.stringify(result.result)}`);
      } else {
        addLog(`❌ ${command} failed: ${result.error}`);
      }
    } catch (e) {
      addLog(`❌ ${command} error: ${e.message}`);
    }
    setBusy(false);
  }

  if (!unlocked) {
    return (
      <div style={{ maxWidth: 400, margin: '80px auto', padding: 24, fontFamily: 'sans-serif' }}>
        <h2>Worker Access</h2>
        <input
          type="password"
          placeholder="Admin password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          style={{ width: '100%', padding: 10, marginBottom: 12 }}
        />
        <button onClick={() => secret && setUnlocked(true)} style={{ width: '100%', padding: 10 }}>
          Unlock
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 500, margin: '40px auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h2>Tournament Worker</h2>

      <input
        type="text"
        placeholder="Tournament ID"
        value={tournamentId}
        onChange={(e) => setTournamentId(e.target.value)}
        style={{ width: '100%', padding: 10, marginBottom: 16 }}
      />

      <div style={{ display: 'grid', gap: 8 }}>
        <button disabled={busy} onClick={() => run('generate-group-stage', { group_size: 4 })}>
          Generate Group Stage
        </button>
        <button disabled={busy} onClick={() => run('generate-bracket')}>
          Generate Knockout Bracket
        </button>
        <button disabled={busy} onClick={() => run('finalize-tournament')}>
          Finalize Tournament
        </button>
        <button disabled={busy} onClick={() => run('list-stuck-matches', { minutes_threshold: 60 })}>
          Check Stuck Matches
        </button>
      </div>

      <h3 style={{ marginTop: 24 }}>Activity Log</h3>
      <div style={{ fontSize: 13, fontFamily: 'monospace' }}>
        {log.length === 0 && <p>Nothing yet — tap a button above.</p>}
        {log.map((entry, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <span style={{ color: '#888' }}>[{entry.time}]</span> {entry.line}
          </div>
        ))}
      </div>
    </div>
  );
}
