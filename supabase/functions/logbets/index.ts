// Records the Today page's best bets before kickoff so they can be graded. Lines are re-read from the games table
// here (the page's numbers are not trusted), only games that haven't started are accepted, and a bet that drops
// off the list before kickoff is removed. After kickoff a bet is frozen.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const MK = new Set(['sp', 'tot', 'ml', 'teaser']), SD = new Set(['home', 'away', 'over', 'under']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });
  let body: any; try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }
  const list = (Array.isArray(body?.bets) ? body.bets : []).slice(0, 80).filter((b: any) =>
    /^\d{6,12}$/.test(String(b.espn_id)) && MK.has(b.market) && SD.has(b.side) && ((b.market === 'tot') === (b.side === 'over' || b.side === 'under')));
  const now = Date.now();
  const ids = [...new Set(list.map((b: any) => String(b.espn_id)))];
  const { data: gs } = ids.length ? await sb.from('games').select('id,league,state,start_time,spread_home,total,ml_home,ml_away').in('id', ids) : { data: [] };
  const G = new Map((gs ?? []).map((g: any) => [String(g.id), g]));
  const rows: any[] = [];
  for (const b of list) {
    const g: any = G.get(String(b.espn_id));
    if (!g || g.state !== 'pre' || new Date(g.start_time).getTime() <= now) continue;
    const sp = g.spread_home === null ? null : Number(g.spread_home);
    const line = b.market === 'tot' ? (g.total === null ? null : Number(g.total)) : b.market === 'ml' ? (b.side === 'home' ? g.ml_home : g.ml_away)
      : sp === null ? null : (b.side === 'home' ? sp : -sp) + (b.market === 'teaser' ? 6 : 0);
    if (line === null || line === undefined) continue;
    rows.push({ id: `${g.id}|${b.market}|${b.side}`, espn_id: String(g.id), league: g.league, start_time: g.start_time, market: b.market, side: b.side, line,
      score: Number.isFinite(Number(b.score)) ? Number(b.score) : null, tier: b.tier === 'best' ? 'best' : 'lean', sources: String(b.sources ?? '').slice(0, 300), updated_at: new Date().toISOString() });
  }
  // drop not-yet-started bets that are no longer on the list (only within the window the page looks at)
  const horizon = new Date(now + 4 * 86400e3).toISOString();
  const { data: open } = await sb.from('best_bets').select('id').gt('start_time', new Date(now).toISOString()).lt('start_time', horizon);
  const keep = new Set(rows.map((r) => r.id));
  const drop = (open ?? []).map((r: any) => r.id).filter((id: string) => !keep.has(id));
  if (body?.complete === true && drop.length) await sb.from('best_bets').delete().in('id', drop);
  if (rows.length) await sb.from('best_bets').upsert(rows, { onConflict: 'id' });
  return new Response(JSON.stringify({ saved: rows.length, dropped: body?.complete === true ? drop.length : 0 }), { headers: { ...CORS, 'content-type': 'application/json' } });
});
