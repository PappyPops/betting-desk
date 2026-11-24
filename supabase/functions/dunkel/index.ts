// The Dunkel Index: free power-rating predictions for NFL, FBS, NBA and college basketball (dunkelindex.com/picks/<league>).
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
// Dunkel's page shows only the first 10 games; the rest (and each day's slate) load from a JSON feed the page's own
// "Load more" button calls. League ids on that feed: NFL 1, FBS 2, NBA 4, NCAA men's 6. Dunkel posts a game's numbers
// on the day it's played, so a date past today comes back empty.
const LID: Record<string, number> = { nfl: 1, cfb: 2, nba: 4, cbb: 6 };
const EXPERT = hid('dunkel');
const JH = { ...UA, 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

// every way a team might be written: "Buffalo Bills", "Buffalo", "Bills"
function keys(t: any) {
  const name = t?.name ?? '', nick = t?.nick ?? '';
  const loc = nick && name.endsWith(nick) ? name.slice(0, -nick.length).trim() : '';
  return [...new Set([name, loc, t?.short].filter((x) => x && x.length > 2).map(norm))];
}
function etOffset() {
  const z = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).match(/GMT([+-]\d\d:\d\d)/);
  return z ? z[1] : '-05:00';
}
async function feed(lid: number, q: Record<string, string>) {
  const r = await fetch(`https://www.dunkelindex.com/picks/get/${lid}?${new URLSearchParams(q)}`, { headers: JH, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  const j = await r.json();
  return (j?.games ?? []) as any[];
}
// the default list (today's slate, 10 games a page) plus the next few days, so nothing waits for a refresh
async function dunkelGames(lg: string) {
  const lid = LID[lg], tz = etOffset(), out = new Map<string, any>();
  for (let page = 1; page <= 12; page++) {
    const gs = await feed(lid, { page: String(page), tz, exclusion: 'leagues,teams' });
    for (const g of gs) out.set(String(g.id), g);
    if (gs.length < 10) break;
  }
  for (let i = 0; i < 4; i++) {
    const day = new Date(Date.now() + i * 86400e3).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    try { for (const g of await feed(lid, { date: day, tz })) out.set(String(g.id), g); } catch (_) { /* a missing day isn't fatal */ }
  }
  return [...out.values()];
}

async function league(lg: string) {
  const dk = await dunkelGames(lg);
  const { data: games } = await sb.from('games').select('id,start_time,state,data').eq('league', lg).eq('state', 'pre')
    .gte('start_time', new Date(Date.now() - 3600e3).toISOString()).lt('start_time', new Date(Date.now() + 8 * 86400e3).toISOString()).limit(3000);
  const rows = new Map<string, any>(), picks: any[] = [];
  const isTeam = (t: any, full: string, nick: string) => keys(t).includes(norm(full)) || (!!nick && norm(t?.nick ?? '') === norm(nick) && !!norm(t?.nick ?? ''));
  const now = new Date().toISOString();
  for (const d of dk) {
    if (!/^pre|^sched|^$/i.test(d.status ?? '') && /final|F\//i.test(d.status ?? '')) continue;
    const t0 = Date.parse(String(d.date_of_match_utc).replace(' ', 'T') + 'Z');
    // the ESPN game in the same hour with both teams (either way round, for neutral sites)
    const g: any = (games ?? []).filter((x: any) => Math.abs(Date.parse(x.start_time) - t0) < 3 * 3600e3)
      .filter((x: any) => (isTeam(x.data?.home, d.home_team_full_name, d.home_team_name) && isTeam(x.data?.away, d.away_team_full_name, d.away_team_name))
        || (isTeam(x.data?.home, d.away_team_full_name, d.away_team_name) && isTeam(x.data?.away, d.home_team_full_name, d.home_team_name)))
      .sort((a: any, b: any) => Math.abs(Date.parse(a.start_time) - t0) - Math.abs(Date.parse(b.start_time) - t0))[0];
    if (!g || rows.has(String(g.id))) continue;
    const dkTotal = Number(d.dunkel_total), vegTotal = Number(d.over_under);
    if (!Number.isFinite(dkTotal)) continue;
    const row: any = { game_id: String(g.id), league: lg, dunkel_team: d.dunkel_pick_name ?? null, dunkel_margin: Number.isFinite(Number(d.dunkel_line)) ? -Number(d.dunkel_line) : null,
      dunkel_total: dkTotal, vegas_team: d.vegas_pick_name ?? null, vegas_margin: Number.isFinite(Number(d.vegas_line)) ? Number(d.vegas_line) : null, vegas_total: Number.isFinite(vegTotal) ? vegTotal : null, updated_at: now };
    // the spread pick: Dunkel's recommended team, at the number Vegas has for that team
    const rec = String(d.team_recommendation ?? '');
    const val = /^(pk|even)$/i.test(String(d.money_line ?? '').trim()) ? 0 : Number(d.money_line);
    if (rec && Number.isFinite(val)) {
      const recHome = rec === String(d.home_team_id);
      const side = (isTeam(g.data?.home, recHome ? d.home_team_full_name : d.away_team_full_name, recHome ? d.home_team_name : d.away_team_name)) ? 'home' : 'away';
      row.pick_side = side; row.pick_line = val;
      picks.push({ id: hid(`dunkel:${g.id}:spread`), expert_id: EXPERT, source: 'dunkel', league: lg, action_game_id: null, espn_id: String(g.id), type: `spread_${side}`, side, value: val, play: `${g.data[side]?.short ?? side} ${val > 0 ? '+' : ''}${val === 0 ? 'PK' : val}`, odds: -110, units: null, starts_at: g.start_time, created_at: now, status: 'published', updated_at: now });
    }
    const tp = String(d.dunkel_over_under ?? '').toLowerCase();
    if ((tp === 'over' || tp === 'under') && row.vegas_total !== null) {
      row.total_pick = tp;
      picks.push({ id: hid(`dunkel:${g.id}:total`), expert_id: EXPERT, source: 'dunkel', league: lg, action_game_id: null, espn_id: String(g.id), type: tp, side: tp, value: row.vegas_total, play: `${tp === 'over' ? 'Over' : 'Under'} ${row.vegas_total} (Dunkel ${row.dunkel_total})`, odds: -110, units: null, starts_at: g.start_time, created_at: now, status: 'published', updated_at: now });
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
  return { feed: dk.length, games: rows.size, picks: picks.length };
}

Deno.serve(async () => {
  const out: Record<string, unknown> = {};
  await sb.from('experts').upsert({ id: EXPERT, name: 'Dunkel Index', username: 'dunkel', source: 'dunkel', updated_at: new Date().toISOString() });
  for (const lg of ['nfl', 'cfb', 'nba', 'cbb']) {
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
