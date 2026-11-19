// More free pick sources for Cap'n Cash:
//   Pickswise experts (NFL, college, NBA): spreads, totals, moneylines (props skipped)
//   Covers computer picks (formerly OddsShark): predicted scores -> a spread and a total pick per game
//   Dimers model (NFL, NBA) and ESPN's matchup predictor (NFL, college, NBA): win chance vs DraftKings' moneyline;
//     a pick only when the model is 3+ points higher than the market's no-vig chance
// Every pick is graded against ESPN finals (by the picks job) and each source keeps a record here.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'text/html,application/json' };
const norm = (s: string) => (s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
function hid(s: string) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; b = Math.imul(b ^ s.charCodeAt(i), 2246822519) >>> 0; }
  return 4e15 + (a % 2 ** 20) * 2 ** 26 + (b % 2 ** 26);
}
async function get(url: string) { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
// page -> plain text with " | " between elements
const plain = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' | ')
  .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&commat;/g, '@').replace(/&#x2BC6;|&#x2022;|&middot;|&nbsp;/g, ' ').replace(/&#x2B;/g, '+')
  .replace(/\s+/g, ' ').replace(/( \| )+/g, ' | ').replace(/(\| )+\|/g, '|');
const now = () => Date.now();
const nowIso = () => new Date().toISOString();

async function gamesIn(lg: string, fwd = 9) {
  const { data } = await sb.from('games').select('id,league,start_time,state,home,away,spread_home,total,ml_home,ml_away,data').eq('league', lg)
    .gte('start_time', new Date(now() - 6 * 3600e3).toISOString()).lt('start_time', new Date(now() + fwd * 86400e3).toISOString());
  return (data ?? []).filter((g: any) => g.state === 'pre');
}
// does a site's team label mean this ESPN team?
function teamIs(label: string, t: any) {
  const k = norm(label); if (!k || !t) return false;
  const name = norm(t.name), nick = norm(t.nick), loc = name.endsWith(nick) ? name.slice(0, name.length - nick.length) : '';
  return [name, norm(t.short), norm(t.abbr), nick, loc].includes(k) || (k.length >= 5 && name.startsWith(k));
}
function findGame(games: any[], a: string, h: string, strictOrder = false) {
  const hit = games.filter((g) => (teamIs(a, g.data?.away) && teamIs(h, g.data?.home)) || (!strictOrder && teamIs(a, g.data?.home) && teamIs(h, g.data?.away)));
  return hit.sort((x, y) => new Date(x.start_time).getTime() - new Date(y.start_time).getTime())[0] ?? null;
}
const sideOf = (g: any, label: string) => teamIs(label, g.data?.home) ? 'home' : teamIs(label, g.data?.away) ? 'away' : null;
const pick = (src: string, expert: string, lg: string, g: any, type: string, side: string, value: number, play: string, odds: number | null) => ({
  id: hid(`${src}:${lg}:${expert}:${g.id}:${type.startsWith('spread') ? 'sp' : type.startsWith('ml') ? 'ml' : 'tot'}`), expert_id: hid(`${src}:${expert.toLowerCase()}`), source: src, league: lg,
  action_game_id: null, espn_id: String(g.id), type, play, value, odds, units: null, starts_at: g.start_time, created_at: nowIso(), side, status: 'published', updated_at: nowIso() });
const implied = (o: number) => o < 0 ? -o / (-o + 100) : 100 / (o + 100);

// ---------- Pickswise ----------
const PW: Record<string, string> = { nfl: 'nfl', cfb: 'college-football', nba: 'nba' };
async function pickswise(lg: string) {
  const t = plain(await get(`https://www.pickswise.com/${PW[lg]}/picks/`));
  const games = await gamesIn(lg);
  const ex = new Map<number, any>(), picks: any[] = [];
  const re = /\| ([^|]{3,40}?) \| (Low|Fair|Medium|Good|High|Very High|Strong|Max|Best Bet) \| ([^|]+?) \| ([^|]+?) \| (?:NFL|NBA|College Football|NCAAF) \| [^|]+ \| [^|]+ \| ([^|]+?) \| ((?:[^|]+ \| ){0,3}?)(Point Spread Pick|Game Totals Pick|Money ?Line Pick)/g;
  for (const m of t.matchAll(re)) {
    const who = m[1].replace(/💡|Suggested/g, '').trim(); if (!who || /\d/.test(who)) continue;
    const g = findGame(games, m[3], m[4]); if (!g) continue;
    const sel = m[5].trim(), mid = m[6].split('|').map((x) => x.trim()).filter(Boolean);
    let type: string, side: string | null, value = 0, odds: number | null = null;
    if (m[7] === 'Game Totals Pick') {
      const tm = sel.match(/^(Over|Under)\s+([\d.]+)/i); if (!tm) continue;
      side = tm[1].toLowerCase(); type = side; value = Number(tm[2]);
    } else if (m[7] === 'Point Spread Pick') {
      const sm = sel.match(/^Spread - (.+?)\s+([+-]?\d+(?:\.\d+)?|PK)$/i); if (!sm) continue;
      side = sideOf(g, sm[1]); if (!side) continue; type = `spread_${side}`; value = /pk/i.test(sm[2]) ? 0 : Number(sm[2]);
    } else {
      const mm = sel.match(/^Money ?line - (.+)$/i); if (!mm) continue;
      side = sideOf(g, mm[1]); if (!side) continue; type = `ml_${side}`;
      const o = Number(mid.find((x) => /^[+-]\d{3,4}$/.test(x))); odds = Number.isFinite(o) ? o : null;
    }
    const oddsSp = Number(mid.find((x) => /^[+-]\d{3}$/.test(x)));
    if (odds === null && Number.isFinite(oddsSp) && !type.startsWith('ml')) odds = oddsSp;
    const eid = hid(`pickswise:${who.toLowerCase()}`);
    ex.set(eid, { id: eid, name: who, username: 'pickswise-' + norm(who), source: 'pickswise', updated_at: nowIso() });
    picks.push(pick('pickswise', who, lg, g, type, side!, value, sel.replace(/^Spread - |^Money ?line - /i, ''), odds ?? -110));
  }
  return { ex: [...ex.values()], picks };
}

// ---------- Covers computer picks (OddsShark) ----------
const CV: Record<string, string> = { nfl: 'nfl', cfb: 'ncaaf', nba: 'nba' };
async function covers(lg: string) {
  const t = plain(await get(`https://www.covers.com/picks/${CV[lg]}`));
  const games = await gamesIn(lg);
  const picks: any[] = [];
  const re = /\| ([^|@]{2,40}?) @ ([^|]{2,40}?) \| [^|]*?(?:AM|PM) ET \|.{0,200}?Predicted Score \| (\S+) \| \3 \| ([\d.]+) \| @ \| ([\d.]+) \| (\S+) \| \6 \|/g;
  const seen = new Set<string>();
  for (const m of t.matchAll(re)) {
    const g = findGame(games, m[3], m[6], true) ?? findGame(games, m[1], m[2], true); if (!g || seen.has(g.id)) continue; seen.add(g.id);
    const pa = Number(m[4]), ph = Number(m[5]);
    const sp = g.spread_home === null ? null : Number(g.spread_home), tot = g.total === null ? null : Number(g.total);
    const who = 'OddsShark computer';
    if (sp !== null) { const edge = (ph - pa) + sp; if (Math.abs(edge) >= 0.5) { const side = edge > 0 ? 'home' : 'away'; const v = side === 'home' ? sp : -sp; picks.push(pick('covers', who, lg, g, `spread_${side}`, side, v, `${g.data?.[side]?.abbr ?? side} ${v > 0 ? '+' : ''}${v} (proj ${pa.toFixed(1)}–${ph.toFixed(1)})`, -110)); } }
    if (tot) { const d = pa + ph - tot; if (Math.abs(d) >= 0.5) { const side = d > 0 ? 'over' : 'under'; picks.push(pick('covers', who, lg, g, side, side, tot, `${side === 'over' ? 'Over' : 'Under'} ${tot} (proj ${(pa + ph).toFixed(1)})`, -110)); } }
  }
  const eid = hid('covers:oddsshark computer');
  return { ex: picks.length ? [{ id: eid, name: 'OddsShark computer', username: 'covers-oddsshark', source: 'covers', updated_at: nowIso() }] : [], picks };
}

// ---------- model moneylines: Dimers and ESPN ----------
function mlPick(src: string, who: string, lg: string, g: any, pHome: number, minEdge = 0.03) {
  const mh = Number(g.ml_home), ma = Number(g.ml_away); if (!mh || !ma) return null;
  const ih = implied(mh), ia = implied(ma), fh = ih / (ih + ia);
  const eh = pHome - fh, ea = (1 - pHome) - (1 - fh);
  const side = eh >= ea ? 'home' : 'away', edge = Math.max(eh, ea); if (edge < minEdge) return null;
  const o = side === 'home' ? mh : ma, pm = side === 'home' ? pHome : 1 - pHome;
  return pick(src, who, lg, g, `ml_${side}`, side, 0, `${g.data?.[side]?.abbr ?? side} ML (model ${(pm * 100).toFixed(0)}% vs market ${((side === 'home' ? fh : 1 - fh) * 100).toFixed(0)}%)`, o);
}
const DM: Record<string, string> = { nfl: 'nfl', nba: 'nba' };
async function dimers(lg: string) {
  const t = plain(await get(`https://www.dimers.com/${DM[lg]}/predictions`));
  const games = await gamesIn(lg, 8);
  const picks: any[] = [];
  const re = /\| ([A-Z][A-Za-z0-9 .'&]{1,30}?) \| ([\d.]+)% \| (?:[+-]?[\d.]+|PK|Pick) \| ([A-Z][A-Za-z0-9 .'&]{1,30}?) \| ([\d.]+)% \|/g;
  for (const m of t.matchAll(re)) {
    const g = findGame(games, m[1], m[3]); if (!g) continue;
    const p1 = Number(m[2]) / 100, home1 = teamIs(m[1], g.data?.home);
    const p = mlPick('dimers', 'Dimers model', lg, g, home1 ? p1 : Number(m[4]) / 100); if (p) picks.push(p);
  }
  const eid = hid('dimers:dimers model');
  return { ex: [{ id: eid, name: 'Dimers model', username: 'dimers-model', source: 'dimers', updated_at: nowIso() }], picks };
}
const ESP: Record<string, string> = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba' };
async function espnModel(lg: string) {
  const games = (await gamesIn(lg, lg === 'nfl' ? 8 : 3)).filter((g: any) => g.ml_home && g.ml_away);
  const picks: any[] = [];
  for (let i = 0; i < games.length; i += 6) {
    await Promise.all(games.slice(i, i + 6).map(async (g: any) => {
      try {
        const s = JSON.parse(await get(`https://site.api.espn.com/apis/site/v2/sports/${ESP[lg]}/summary?event=${g.id}`));
        const hp = Number(s?.predictor?.homeTeam?.gameProjection ?? s?.predictor?.homeTeam?.statistics?.find?.((x: any) => x.name === 'gameProjection')?.value);
        if (!Number.isFinite(hp) || hp <= 0 || hp >= 100) return;
        const p = mlPick('espnmodel', 'ESPN model', lg, g, hp / 100); if (p) picks.push(p);
      } catch (_) { /* skip game */ }
    }));
  }
  const eid = hid('espnmodel:espn model');
  return { ex: [{ id: eid, name: 'ESPN model', username: 'espn-model', source: 'espnmodel', updated_at: nowIso() }], picks };
}

// ---------- records for these sources, from picks graded here ----------
const SOURCES = ['pickswise', 'covers', 'dimers', 'espnmodel'];
async function records() {
  const { data: settled } = await sb.from('expert_picks').select('expert_id,result,type,odds').in('source', SOURCES).eq('status', 'settled').limit(20000);
  const rec = new Map<number, any>();
  for (const s of settled ?? []) {
    const r = rec.get(s.expert_id) ?? { win: 0, loss: 0, push: 0, units_net: 0 };
    const o = Number(s.odds) || -110, pay = o > 0 ? o / 100 : 100 / -o;
    if (s.result === 'win') { r.win++; r.units_net += pay; } else if (s.result === 'loss') { r.loss++; r.units_net -= 1; } else r.push++;
    rec.set(s.expert_id, r);
  }
  for (const [id, r] of rec) await sb.from('experts').update({ record: { ...r, units_net: Math.round(r.units_net * 100) / 100, count: r.win + r.loss + r.push, window: 'tracked here' } }).eq('id', id);
  return rec.size;
}

Deno.serve(async () => {
  const out: Record<string, unknown> = {};
  const jobs: [string, () => Promise<any>][] = [
    ['pickswise_nfl', () => pickswise('nfl')], ['pickswise_cfb', () => pickswise('cfb')], ['pickswise_nba', () => pickswise('nba')],
    ['covers_nfl', () => covers('nfl')], ['covers_cfb', () => covers('cfb')], ['covers_nba', () => covers('nba')],
    ['dimers_nfl', () => dimers('nfl')], ['dimers_nba', () => dimers('nba')],
    ['espn_nfl', () => espnModel('nfl')], ['espn_cfb', () => espnModel('cfb')], ['espn_nba', () => espnModel('nba')],
  ];
  for (const [name, fn] of jobs) {
    try {
      const { ex, picks } = await fn();
      if (ex.length) await sb.from('experts').upsert(ex);
      const ids = picks.map((p: any) => p.id);
      const done = new Set<number>();
      for (let i = 0; i < ids.length; i += 300) { const { data } = await sb.from('expert_picks').select('id').in('id', ids.slice(i, i + 300)).eq('status', 'settled'); for (const d of data ?? []) done.add(d.id); }
      const fresh = picks.filter((p: any) => !done.has(p.id));
      for (let i = 0; i < fresh.length; i += 500) await sb.from('expert_picks').upsert(fresh.slice(i, i + 500));
      out[name] = { experts: ex.length, picks: fresh.length };
    } catch (e) { out[name] = { error: String(e).slice(0, 160) }; }
    await new Promise((r) => setTimeout(r, 800));
  }
  out.records = await records();
  await sb.from('blobs').upsert({ key: 'picks:more', data: { at: nowIso(), out }, updated_at: nowIso() });
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
