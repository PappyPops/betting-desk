// Loads nflverse's open NFL game history (every game since 2002, closing spread/total, weather, rest) into blobs.nfl_hist.
import { createClient } from 'npm:@supabase/supabase-js@2';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const URL_GAMES = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const COLS = ['season','game_type','week','gameday','weekday','gametime','away_team','away_score','home_team','home_score','location','result','total','overtime','away_rest','home_rest','away_moneyline','home_moneyline','spread_line','total_line','div_game','roof','surface','temp','wind','espn'];
const TEXT = ['game_type','gameday','weekday','gametime','away_team','home_team','location','roof','surface','espn'];

function parseCSV(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  const idx = COLS.map((c) => head.indexOf(c));
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    if (Number(f[idx[0]]) < 2002) continue;
    rows.push(idx.map((j, k) => {
      const v = f[j];
      if (v === undefined || v === '' || v === 'NA') return null;
      if (TEXT.includes(COLS[k])) return v;
      const n = Number(v); return Number.isFinite(n) ? n : v;
    }));
  }
  return rows;
}

Deno.serve(async () => {
  const r = await fetch(URL_GAMES, { headers: { 'User-Agent': 'BettingDesk/1.0' } });
  if (!r.ok) return new Response(JSON.stringify({ error: r.status }), { status: 502 });
  const rows = parseCSV(await r.text());
  const data = { cols: COLS, rows, at: new Date().toISOString(), source: 'nflverse/nfldata games.csv' };
  const { error } = await sb.from('blobs').upsert({ key: 'nfl_hist', data, updated_at: new Date().toISOString() });
  return new Response(JSON.stringify({ rows: rows.length, error: error?.message ?? null }), { headers: { 'content-type': 'application/json' } });
});
