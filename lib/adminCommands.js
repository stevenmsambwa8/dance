// lib/adminCommands.js
//
// Server-only. Never import this into a page that runs in the browser.
// Holds the Supabase SERVICE ROLE key and does the actual work.
//
// To add a new command: write a function, add one line to COMMANDS at the bottom.

import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------- commands ----------

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

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

async function generateGroupStage(supabase, { tournament_id, group_size }) {
  if (!tournament_id) throw new Error('tournament_id is required');

  const { data: players, error: playersErr } = await supabase
    .from('tournament_participants')
    .select('user_id')
    .eq('tournament_id', tournament_id);
  if (playersErr) throw playersErr;
  if (!players || players.length < 2) throw new Error('Not enough participants to generate groups');

  const size = group_size || 4;
  const numGroups = Math.max(1, Math.ceil(players.length / size));
  const groups = Array.from({ length: numGroups }, () => []);
  players.forEach((p, i) => {
    const round = Math.floor(i / numGroups);
    const idx = round % 2 === 0 ? i % numGroups : numGroups - 1 - (i % numGroups);
    groups[idx].push(p.user_id);
  });

  const insertedGroups = [];
  for (let g = 0; g < groups.length; g++) {
    const { data: groupRow, error: groupErr } = await supabase
      .from('tournament_groups')
      .insert({ tournament_id, name: `Group ${String.fromCharCode(65 + g)}` })
      .select()
      .single();
    if (groupErr) throw groupErr;
    insertedGroups.push(groupRow);

    const members = groups[g];
    const memberRows = members.map((user_id) => ({ group_id: groupRow.id, user_id }));
    if (memberRows.length) {
      const { error: memErr } = await supabase.from('tournament_group_members').insert(memberRows);
      if (memErr) throw memErr;
    }

    const fixtures = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        fixtures.push({
          group_id: groupRow.id,
          tournament_id,
          player_a: members[i],
          player_b: members[j],
          status: 'pending',
        });
      }
    }
    if (fixtures.length) {
      const { error: fixErr } = await supabase.from('group_fixtures').insert(fixtures);
      if (fixErr) throw fixErr;
    }
  }

  await supabase.from('tournaments').update({ status: 'group_stage' }).eq('id', tournament_id);
  return { groups: insertedGroups.length, players: players.length };
}

async function finalizeMatch(supabase, { fixture_table, fixture_id, winner_id, score_a, score_b }) {
  if (!fixture_table || !fixture_id || !winner_id) {
    throw new Error('fixture_table, fixture_id and winner_id are required');
  }
  const { data, error } = await supabase
    .from(fixture_table)
    .update({ status: 'completed', winner_id, score_a, score_b })
    .eq('id', fixture_id)
    .select()
    .single();
  if (error) throw error;
  return { fixture: data };
}

async function generateKnockoutBracket(supabase, { tournament_id }) {
  if (!tournament_id) throw new Error('tournament_id is required');

  // Adjust this query if your standings table/view has different column names
  const { data: standings, error } = await supabase
    .from('group_standings')
    .select('group_id, user_id, points, rank')
    .eq('tournament_id', tournament_id)
    .order('rank', { ascending: true });
  if (error) throw error;

  const qualifiers = (standings || []).filter((s) => s.rank <= 2).map((s) => s.user_id);
  if (qualifiers.length < 2) throw new Error('Not enough qualifiers to build a bracket');

  const matches = [];
  for (let i = 0; i < qualifiers.length; i += 2) {
    matches.push({
      tournament_id,
      round: 1,
      player_a: qualifiers[i],
      player_b: qualifiers[i + 1] || null,
      status: qualifiers[i + 1] ? 'pending' : 'bye',
    });
  }

  const { data: inserted, error: insErr } = await supabase
    .from('knockout_matches')
    .insert(matches)
    .select();
  if (insErr) throw insErr;

  await supabase.from('tournaments').update({ status: 'knockout' }).eq('id', tournament_id);
  return { first_round_matches: inserted.length, total_qualifiers: qualifiers.length };
}

async function finalizeTournament(supabase, { tournament_id, winner_id }) {
  if (!tournament_id) throw new Error('tournament_id is required');
  const { data, error } = await supabase
    .from('tournaments')
    .update({ status: 'completed', winner_id: winner_id || null, ended_at: new Date().toISOString() })
    .eq('id', tournament_id)
    .select()
    .single();
  if (error) throw error;
  return { tournament: data };
}

async function listStuckMatches(supabase, { tournament_id, minutes_threshold }) {
  const threshold = minutes_threshold || 60;
  const cutoff = new Date(Date.now() - threshold * 60 * 1000).toISOString();

  let query = supabase
    .from('group_fixtures')
    .select('id, tournament_id, player_a, player_b, created_at')
    .eq('status', 'pending')
    .lt('created_at', cutoff);

  if (tournament_id) query = query.eq('tournament_id', tournament_id);

  const { data, error } = await query;
  if (error) throw error;
  return { stuck_matches: data };
}

// ---------- registry ----------

export const COMMANDS = {
  'list-tournaments': listTournaments,
  'create-tournament': createTournament,
  'generate-group-stage': generateGroupStage,
  'finalize-match': finalizeMatch,
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
