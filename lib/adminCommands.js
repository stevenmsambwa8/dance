// lib/adminCommands.js
//
// Server-only. Never import this into a page that runs in the browser.
// Holds the Supabase SERVICE ROLE key and does the actual work.
//
// IMPORTANT: Nabogaming does NOT use separate group_fixtures /
// group_standings / tournament_groups / knockout_matches tables.
// Everything for a tournament's group stage and bracket lives inside
// a single JSON column: tournaments.bracket_data — shaped exactly like
// lib/groupStage.js and the buildBracket() in app/tournaments/[slug]/page.js
// produce it:
//   { stage: 'groups', groups: [...], advancePerGroup }
//   { stage: 'knockout', rounds: [...], bracketSize, ... }
//   { stage: 'complete', winners: [...], podium }
// There is also no `ended_at` or `winner_id` column on `tournaments` —
// finishing a tournament just sets status: 'completed'.
//
// To add a new command: write a function, add one line to COMMANDS at the bottom.

import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------- shared helpers (mirrored from lib/groupStage.js + page.js) ----------

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function nextPow2(n) { let s = 1; while (s < n) s *= 2; return s; }

// Mirrors buildBracket() in app/tournaments/[slug]/page.js (solo mode only —
// team-battle tournaments should keep using the in-app "Generate Bracket"
// button, since team formation needs the UI's team-size context).
function buildBracket(parts, teamSize = 1) {
  if (!parts || parts.length < 2) return null;
  if (teamSize > 1) {
    throw new Error('Team-battle bracket generation is not supported from the worker yet — use the in-app manage page for team tournaments.');
  }

  const size = nextPow2(parts.length);
  const byeCount = size - parts.length;
  const shuffled = [...parts].sort(() => Math.random() - 0.5);
  const playerSlots = shuffled.map((p) => ({
    userId: p.user_id,
    name: p.profiles?.username || '?',
    avatar: p.profiles?.avatar_url || null,
    status: 'active',
  }));
  for (let i = 0; i < byeCount; i++) playerSlots.push({ userId: null, name: 'BYE', avatar: null, status: 'bye' });

  const rounds = [];
  let current = playerSlots;
  while (current.length > 1) {
    const pairs = [];
    for (let i = 0; i < current.length; i += 2) pairs.push([{ ...current[i] }, { ...current[i + 1] }]);
    rounds.push(pairs);
    current = pairs.map(() => ({ userId: null, name: '?', avatar: null, status: 'pending' }));
  }
  rounds.push([[{ userId: null, name: 'TBD', avatar: null, status: 'pending' }, null]]);
  return { rounds, bracketSize: size, byeCount };
}

// Mirrors buildGroups() in lib/groupStage.js (solo mode only, same reason as above).
function buildGroups(participants, groupCount, legs = 1) {
  if (!participants?.length || groupCount < 1) return [];

  const units = participants.map((p) => ({
    id: p.user_id,
    name: p.profiles?.username || '?',
    avatar: p.profiles?.avatar_url || null,
  }));

  const shuffled = [...units].sort(() => Math.random() - 0.5);
  const groups = Array.from({ length: groupCount }, (_, i) => ({
    id: `group_${i}`,
    name: groupCount === 1 ? 'League Table' : `Group ${String.fromCharCode(65 + i)}`,
    members: [],
  }));

  let dir = 1, g = 0;
  for (const unit of shuffled) {
    groups[g].members.push(unit);
    g += dir;
    if (g === groupCount) { g = groupCount - 1; dir = -1; }
    else if (g < 0) { g = 0; dir = 1; }
  }

  return groups.map((gr) => ({ ...gr, fixtures: generateRoundRobinFixtures(gr.members, legs) }));
}

function generateRoundRobinFixtures(members, legs = 1) {
  const n = members.length;
  if (n < 2) return [];

  const ids = members.map((m) => m.id);
  const hasBye = n % 2 !== 0;
  const list = hasBye ? [...ids, null] : [...ids];
  const size = list.length;
  const rounds = size - 1;
  const half = size / 2;

  const fixtures = [];
  let arr = [...list];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const home = arr[i];
      const away = arr[size - 1 - i];
      if (home != null && away != null) {
        fixtures.push({ id: `${home}_vs_${away}_r${r}`, round: r, homeId: home, awayId: away, scoreHome: null, scoreAway: null, status: 'pending' });
      }
    }
    arr = [arr[0], arr[size - 1], ...arr.slice(1, size - 1)];
  }

  if (legs >= 2) {
    const secondLeg = fixtures.map((fx) => ({
      id: `${fx.awayId}_vs_${fx.homeId}_r${fx.round + rounds}`,
      round: fx.round + rounds, homeId: fx.awayId, awayId: fx.homeId,
      scoreHome: null, scoreAway: null, status: 'pending',
    }));
    return [...fixtures, ...secondLeg];
  }
  return fixtures;
}

function computeStandings(group) {
  const table = {};
  group.members.forEach((m) => {
    table[m.id] = { id: m.id, name: m.name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 };
  });
  for (const fx of group.fixtures) {
    if (fx.status !== 'played' || fx.scoreHome == null || fx.scoreAway == null) continue;
    const home = table[fx.homeId], away = table[fx.awayId];
    if (!home || !away) continue;
    home.played++; away.played++;
    home.goalsFor += fx.scoreHome; home.goalsAgainst += fx.scoreAway;
    away.goalsFor += fx.scoreAway; away.goalsAgainst += fx.scoreHome;
    if (fx.scoreHome > fx.scoreAway) { home.won++; home.points += 3; away.lost++; }
    else if (fx.scoreHome < fx.scoreAway) { away.won++; away.points += 3; home.lost++; }
    else { home.drawn++; away.drawn++; home.points += 1; away.points += 1; }
  }
  const rows = Object.values(table).map((r) => ({ ...r, goalDiff: r.goalsFor - r.goalsAgainst }));
  rows.sort((a, b) => (b.points - a.points) || (b.goalDiff - a.goalDiff) || (b.goalsFor - a.goalsFor) || String(a.id).localeCompare(String(b.id)));
  return rows.map((row, i) => ({ ...row, position: i + 1 }));
}

function isGroupStageComplete(groups) {
  return groups.every((g) => g.fixtures.every((fx) => fx.status === 'played'));
}

function getQualifiers(groups, advancePerGroup) {
  const byRank = Array.from({ length: advancePerGroup }, () => []);
  groups.forEach((group) => {
    const standings = computeStandings(group);
    standings.slice(0, advancePerGroup).forEach((row, rankIdx) => {
      const member = group.members.find((m) => m.id === row.id);
      byRank[rankIdx].push({ user_id: member?.id, profiles: { username: member?.name, avatar_url: member?.avatar } });
    });
  });
  return byRank.flat();
}

function parseBracketData(bd) {
  if (!bd) return null;
  if (typeof bd === 'string') { try { return JSON.parse(bd); } catch { return null; } }
  return bd;
}

// ---------- commands ----------

async function listTournaments(supabase, { limit }) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, slug, game_slug, stage_format, slots, registered_count, status, entrance_fee, date, is_test, created_at')
    .order('created_at', { ascending: false })
    .limit(limit || 50);
  if (error) throw error;
  return { tournaments: data || [] };
}

async function createTournament(
  supabase,
  { name, game_slug, stage_format, slots, prize, date, entrance_fee, description, team_size, group_count, advance_per_group, is_test }
) {
  if (!name || !game_slug) throw new Error('name and game_slug are required');

  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      name: name.trim(),
      slug: slugify(name),
      game_slug,
      format: '',
      prize: prize || '',
      slots: Number(slots) || 16,
      date: date || '',
      description: description || '',
      entrance_fee: entrance_fee ? Number(String(entrance_fee).replace(/,/g, '')) : 0,
      team_size: Number(team_size) || 1,
      stage_format: stage_format || 'groups_knockout',
      group_count: stage_format === 'groups_knockout' ? Number(group_count) || 4 : null,
      advance_per_group: stage_format === 'groups_knockout' ? Number(advance_per_group) || 2 : null,
      bracket_data: null,
      round_names: null,
      is_test: !!is_test,
      pro_only: false,
      clan_id: null,
      status: 'active',
      registered_count: 0,
      created_by: null,
    })
    .select()
    .single();

  if (error) throw error;
  return { tournament: data };
}

async function getTournamentOrThrow(supabase, tournament_id) {
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', tournament_id).single();
  if (error) throw error;
  if (!data) throw new Error('Tournament not found');
  return data;
}

async function generateGroupStage(supabase, { tournament_id, group_count, group_size, legs }) {
  if (!tournament_id) throw new Error('tournament_id is required');
  const tournament = await getTournamentOrThrow(supabase, tournament_id);

  const { data: parts, error: partsErr } = await supabase
    .from('tournament_participants')
    .select('user_id, profiles(username, avatar_url)')
    .eq('tournament_id', tournament_id);
  if (partsErr) throw partsErr;
  if (!parts || parts.length < 2) throw new Error('Not enough participants to generate groups');

  const isLeague = tournament.stage_format === 'league';
  const numGroups = isLeague ? 1 : (group_count || group_size || tournament.group_count || 4);
  const numLegs = isLeague ? (legs || tournament.group_count || 2) : 1;
  const advancePerGroup = tournament.advance_per_group || (isLeague ? 3 : 2);

  const groups = buildGroups(parts, numGroups, numLegs);
  const bd = { stage: 'groups', groups, advancePerGroup };

  const { error } = await supabase.from('tournaments').update({ bracket_data: bd }).eq('id', tournament_id);
  if (error) throw error;
  return { groups: groups.length, players: parts.length, advancePerGroup };
}

async function generateKnockoutBracket(supabase, { tournament_id }) {
  if (!tournament_id) throw new Error('tournament_id is required');
  const tournament = await getTournamentOrThrow(supabase, tournament_id);
  const bd = parseBracketData(tournament.bracket_data);
  if (!bd?.groups) throw new Error('No group stage found on this tournament yet — run Generate Group Stage first');
  if (bd.stage === 'knockout' || bd.stage === 'complete') throw new Error('Knockout bracket already generated for this tournament');
  if (!isGroupStageComplete(bd.groups)) throw new Error('Group stage is not finished yet — some fixtures are still pending');

  const advancePerGroup = bd.advancePerGroup || tournament.advance_per_group || 2;
  const qualifiers = getQualifiers(bd.groups, advancePerGroup);
  if (qualifiers.length < 2) throw new Error('Not enough qualifiers to build a bracket');

  const knockout = buildBracket(qualifiers, tournament.team_size || 1);
  const merged = { ...bd, stage: 'knockout', ...knockout };

  const { error } = await supabase.from('tournaments').update({ bracket_data: merged }).eq('id', tournament_id);
  if (error) throw error;
  await supabase.from('tournaments').update({ status: 'knockout' }).eq('id', tournament_id).select();
  return { first_round_matches: knockout.rounds[0].length, total_qualifiers: qualifiers.length };
}

async function finalizeTournament(supabase, { tournament_id }) {
  if (!tournament_id) throw new Error('tournament_id is required');
  // Nabogaming's `tournaments` table has no ended_at/winner_id columns —
  // finishing just means flipping status to 'completed'. Bracket-level
  // winners (bracket_data.stage = 'complete') are computed by the app's
  // own auto-finalize flow when the last fixture/match is scored.
  const { data, error } = await supabase
    .from('tournaments')
    .update({ status: 'completed' })
    .eq('id', tournament_id)
    .select()
    .single();
  if (error) throw error;
  return { tournament: data };
}

async function listStuckMatches(supabase, { tournament_id, minutes_threshold }) {
  const threshold = minutes_threshold || 60;
  const now = Date.now();

  let query = supabase
    .from('tournaments')
    .select('id, name, slug, bracket_data')
    .in('status', ['group_stage', 'groups', 'active', 'knockout']);
  if (tournament_id) query = query.eq('id', tournament_id);

  const { data: tournaments, error } = await query;
  if (error) throw error;

  const stuck = [];
  for (const t of tournaments || []) {
    const bd = parseBracketData(t.bracket_data);
    if (!bd) continue;
    const schedule = bd.match_schedule || {};

    const checkPending = (key, label) => {
      const sched = schedule[key];
      if (!sched?.end) return;
      const endMs = new Date(sched.end).getTime();
      if (isNaN(endMs)) return;
      const overMinutes = (now - endMs) / 60000;
      if (overMinutes >= threshold) {
        stuck.push({ tournament_id: t.id, tournament_name: t.name, tournament_slug: t.slug, match: label, minutes_overdue: Math.floor(overMinutes) });
      }
    };

    (bd.groups || []).forEach((group) => {
      group.fixtures.forEach((fx) => {
        if (fx.status !== 'played') checkPending(`fx:${fx.id}`, `${group.name}: ${fx.homeId} vs ${fx.awayId}`);
      });
    });

    (bd.rounds || []).forEach((round, rIdx) => {
      round.forEach((pair, pIdx) => {
        const [a, b] = pair;
        if (a && b && a.status !== 'eliminated' && b.status !== 'eliminated' && a.name !== 'BYE' && b.name !== 'BYE') {
          checkPending(`ko:${rIdx}-${pIdx}`, `Round ${rIdx + 1}: ${a.name} vs ${b.name}`);
        }
      });
    });
  }

  return { stuck_matches: stuck, note: 'Only matches with an admin-set time window (bracket_data.match_schedule) that has expired are reported. Fixtures with no scheduled deadline are not flagged.' };
}

// ---------- registry ----------

export const COMMANDS = {
  'list-tournaments': listTournaments,
  'create-tournament': createTournament,
  'generate-group-stage': generateGroupStage,
  'generate-bracket': generateKnockoutBracket,
  'finalize-tournament': finalizeTournament,
  'list-stuck-matches': listStuckMatches,
};

export async function runCommand(commandName, params) {
  const fn = COMMANDS[commandName];
  if (!fn) {
    throw new Error(`Unknown command: ${commandName}. Available: ${Object.keys(COMMANDS).join(', ')}`);
  }
  const supabase = getServiceClient();
  return fn(supabase, params || {});
}
