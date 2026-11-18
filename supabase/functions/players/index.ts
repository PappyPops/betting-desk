// nflverse weekly player stats (open data) -> compact blob for Redzone and Slant.
import { createClient } from 'npm:@supabase/supabase-js@2';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SEASON = 2026;
const URL_STATS = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${SEASON}.csv`;
// per-week numbers kept for each player
const NUM = ['carries', 'rushing_yards', 'rushing_tds', 'targets', 'receptions', 'receiving_yards', 'receiving_tds', 'attempts', 'completions', 'passing_yards', 'passing_tds'];

function splitCSV(line: string) {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}

Deno.serve(async () => {
  const r = await fetch(URL_STATS, { headers: { 'User-Agent': 'BettingDesk/1.0' } });
  if (!r.ok) return new Response(JSON.stringify({ error: r.status }), { status: 502 });
  const lines = (await r.text()).split(/\r?\n/).filter(Boolean);
  const head = splitCSV(lines[0]);
  const ix = (c: string) => head.indexOf(c);
  const I = { id: ix('player_id'), name: ix('player_display_name'), pos: ix('position'), shot: ix('headshot_url'), week: ix('week'), st: ix('season_type'), team: ix('team'), opp: ix('opponent_team') };
  const nIx = NUM.map(ix);
  const players: Record<string, [string, string, string]> = {};
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = splitCSV(lines[i]);
    if (f[I.st] !== 'REG') continue;
    const pos = f[I.pos];
    if (!['QB', 'RB', 'WR', 'TE', 'FB'].includes(pos)) continue;
    const nums = nIx.map((j) => { const v = Number(f[j]); return Number.isFinite(v) ? v : 0; });
    if (nums[0] + nums[3] + nums[7] === 0) continue; // no touches, targets or passes
    players[f[I.id]] = [f[I.name], pos, f[I.shot] || ''];
    rows.push([f[I.id], Number(f[I.week]), f[I.team], f[I.opp], ...nums]);
  }
  const data = { season: SEASON, cols: ['pid', 'week', 'team', 'opp', ...NUM], rows, players, at: new Date().toISOString(), source: 'nflverse stats_player_week' };
  const { error } = await sb.from('blobs').upsert({ key: `nfl_players_${SEASON}`, data, updated_at: new Date().toISOString() });
  // ESPN athlete id <-> nflverse gsis id, so prop lines (ESPN ids) can be matched to weekly stats (gsis ids)
  let mapped = 0;
  try {
    const pr = await fetch('https://github.com/nflverse/nflverse-data/releases/download/players/players.csv', { headers: { 'User-Agent': 'BettingDesk/1.0' } });
    const pl = (await pr.text()).split(/\r?\n/).filter(Boolean);
    const ph = splitCSV(pl[0]); const px = (c: string) => ph.indexOf(c);
    const P = { g: px('gsis_id'), e: px('espn_id'), n: px('display_name'), pos: px('position'), t: px('latest_team'), h: px('headshot'), last: px('last_season') };
    const ups: any[] = [];
    for (let i = 1; i < pl.length; i++) {
      const f = splitCSV(pl[i]);
      if (!f[P.e] || Number(f[P.last]) < SEASON - 1 || !['QB', 'RB', 'WR', 'TE', 'FB'].includes(f[P.pos])) continue;
      ups.push({ id: String(Number(f[P.e])), gsis: f[P.g], name: f[P.n], pos: f[P.pos], team: f[P.t] || null, headshot: f[P.h] || null, updated_at: new Date().toISOString() });
    }
    for (let i = 0; i < ups.length; i += 500) { const { error: e2 } = await sb.from('athletes').upsert(ups.slice(i, i + 500)); if (!e2) mapped += Math.min(500, ups.length - i); }
  } catch (_) { /* mapping is best-effort */ }
  return new Response(JSON.stringify({ rows: rows.length, players: Object.keys(players).length, mapped, error: error?.message ?? null }), { headers: { 'content-type': 'application/json' } });
});
