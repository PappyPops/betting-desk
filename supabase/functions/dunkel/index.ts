// The Dunkel Index: free power-rating predictions for NFL, FBS and NBA (dunkelindex.com/picks/<league>).
// Each game shows Dunkel's predicted winner, margin and total next to Vegas, plus a spread pick and a total pick.
// Saves the numbers per game (In the Paint shows Dunkel's NBA total beside its own) and the picks to Cap'n Cash,
// where the picks job grades them against ESPN finals like every other source.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'text/html' };
const norm = (s: string) => (s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
function hid(s: string) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; b = Math.imul(b ^ s.charCodeAt(i), 2246822519) >>> 0; }
  return 4e15 + (a % 2 ** 20) * 2 ** 26 + (b % 2 ** 26);
}
const PAGE: Record<string, string> = { nfl: 'nfl', cfb: 'fbs', nba: 'nba' };
const EXPERT = hid('dunkel');

// every way a team might be written: "Buffalo Bills", "Buffalo", "Bills"
function keys(t: any) {
  const name = t?.name ?? '', nick = t?.nick ?? '';
  const loc = nick && name.endsWith(nick) ? name.slice(0, -nick.length).trim() : '';
  return [...new Set([name, loc, t?.short].filter((x) => x && x.length > 2).map(norm))];
}
// position of a team's name in normalized text (last occurrence at or before `before`)
function posOf(text: string, t: any, before = Infinity) {
  let best = -1;
  for (const k of keys(t)) { let i = text.indexOf(k); while (i !== -1 && i <= before) { if (i > best) best = i; i = text.indexOf(k, i + 1); } }
  return best;
}

async function league(lg: string) {
  const r = await fetch(`https://www.dunkelindex.com/picks/${PAGE[lg]}`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  const text = (await r.text()).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const { data: games } = await sb.from('games').select('id,start_time,state,data').eq('league', lg).eq('state', 'pre')
    .gte('start_time', new Date(Date.now() - 3600e3).toISOString()).lt('start_time', new Date(Date.now() + 8 * 86400e3).toISOString());
  const chunks = text.split(/Bonus Code:\s*DUNKEL/i);
  const rows = new Map<string, any>(), picks: any[] = [];
  for (const raw of chunks) {
    // drop page furniture (the team-filter menu lists every team) before the game's own block
    const r0 = raw.indexOf('RANKING'); if (r0 < 0) continue;
    const c = raw.slice(Math.max(0, r0 - 120));
    const pm = c.match(/DUNKEL PREDICTION\s+(.+?)\s+Winning Margin:\s*(-?[\d.]+)\s+Total Score:\s*([\d.]+)\s+VEGAS PREDICTION\s+(.+?)\s+Winning Margin:\s*(-?[\d.]+)\s+Total Score:\s*([\d.]+)/i);
    if (!pm) continue;
    const n = norm(c);
    // the game whose two teams both appear in this block; earliest start if a matchup repeats
    // the teams Dunkel and Vegas name must be this game's two teams (a nickname like "Cowboys" or "Wildcats" settles
    // look-alikes such as Arizona and Arizona State)
    const named = [norm(pm[1]), norm(pm[4])];
    const isTeam = (t: any, k: string) => [...keys(t), norm(t?.nick ?? '')].filter(Boolean).some((x) => x === k || (k.length > 3 && x.endsWith(k)));
    const g: any = (games ?? []).filter((x: any) => posOf(n, x.data?.home) >= 0 && posOf(n, x.data?.away) >= 0 && named.every((k) => isTeam(x.data?.home, k) || isTeam(x.data?.away, k)))
      .sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
    if (!g || rows.has(String(g.id))) continue;
    const row: any = { game_id: String(g.id), league: lg, dunkel_team: pm[1].trim(), dunkel_margin: Number(pm[2]), dunkel_total: Number(pm[3]), vegas_team: pm[4].trim(), vegas_margin: Number(pm[5]), vegas_total: Number(pm[6]), updated_at: new Date().toISOString() };
    // the spread pick sits inside the block of the team it's on
    const pk = c.match(/Dunkel Pick:\s*\(\s*([+-]?[\d.]+|PK|pk|EVEN)\s*\)\s*(Over|Under)?/i);
    if (pk) {
      const at = norm(c.slice(0, pk.index)).length;
      const ph = posOf(n, g.data.home, at), pa = posOf(n, g.data.away, at);
      const side = ph > pa ? 'home' : pa >= 0 ? 'away' : null;
      const val = /pk|even/i.test(pk[1]) ? 0 : Number(pk[1]);
      if (side && Number.isFinite(val)) {
        row.pick_side = side; row.pick_line = val;
        picks.push({ id: hid(`dunkel:${g.id}:spread`), expert_id: EXPERT, source: 'dunkel', league: lg, action_game_id: null, espn_id: String(g.id), type: `spread_${side}`, side, value: val, play: `${g.data[side]?.short ?? side} ${val > 0 ? '+' : ''}${val === 0 ? 'PK' : val}`, odds: -110, units: null, starts_at: g.start_time, created_at: new Date().toISOString(), status: 'published', updated_at: new Date().toISOString() });
      }
      if (pk[2]) {
        const tp = pk[2].toLowerCase(); row.total_pick = tp;
        picks.push({ id: hid(`dunkel:${g.id}:total`), expert_id: EXPERT, source: 'dunkel', league: lg, action_game_id: null, espn_id: String(g.id), type: tp, side: tp, value: row.vegas_total, play: `${tp === 'over' ? 'Over' : 'Under'} ${row.vegas_total} (Dunkel ${row.dunkel_total})`, odds: -110, units: null, starts_at: g.start_time, created_at: new Date().toISOString(), status: 'published', updated_at: new Date().toISOString() });
      }
    }
    rows.set(String(g.id), row);
  }
  // keep the first total Dunkel posted for each game, so a later update can't rewrite history
  const ids = [...rows.keys()];
  if (ids.length) {
    const { data: prev } = await sb.from('dunkel').select('game_id,first_total').in('game_id', ids);
    const first = new Map((prev ?? []).map((p: any) => [p.game_id, p.first_total]));
    for (const r of rows.values()) r.first_total = first.get(r.game_id) ?? r.dunkel_total;
    await sb.from('dunkel').upsert([...rows.values()]);
  }
  if (picks.length) {
    const { data: done } = await sb.from('expert_picks').select('id').in('id', picks.map((p) => p.id)).eq('status', 'settled');
    const skip = new Set((done ?? []).map((d: any) => d.id));
    const fresh = picks.filter((p) => !skip.has(p.id));
    if (fresh.length) await sb.from('expert_picks').upsert(fresh);
  }
  return { games: rows.size, picks: picks.length };
}

Deno.serve(async () => {
  const out: Record<string, unknown> = {};
  await sb.from('experts').upsert({ id: EXPERT, name: 'Dunkel Index', username: 'dunkel', source: 'dunkel', updated_at: new Date().toISOString() });
  for (const lg of ['nfl', 'cfb', 'nba']) {
    try { out[lg] = await league(lg); } catch (e) { out[lg] = { error: String(e).slice(0, 120) }; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // record from picks graded here (the picks job grades every non-Action pick)
  const { data: settled } = await sb.from('expert_picks').select('result').eq('source', 'dunkel').eq('status', 'settled');
  const rec = { win: 0, loss: 0, push: 0 };
  for (const s of settled ?? []) { if (s.result === 'win') rec.win++; else if (s.result === 'loss') rec.loss++; else rec.push++; }
  await sb.from('experts').update({ record: { ...rec, count: rec.win + rec.loss + rec.push, units_net: rec.win * 0.909 - rec.loss, window: 'tracked here' } }).eq('id', EXPERT);
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
