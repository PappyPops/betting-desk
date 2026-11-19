// More public handicapper picks for Cap'n Cash: ESPN's NFL expert picks, CBS Sports' expert picks and Doc's Sports free picks.
// Grades every non-Action pick against ESPN finals and keeps each handicapper's record.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; BettingDesk/1.0; personal research)', 'Accept': 'text/html' };
const norm = (s: string) => (s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
// stable numeric id from text (fits in a bigint, stays clear of Action's ids)
function hid(s: string) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; b = Math.imul(b ^ s.charCodeAt(i), 2246822519) >>> 0; }
  return 4e15 + (a % 2 ** 20) * 2 ** 26 + (b % 2 ** 26);
}
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'text/html' };
async function text(url: string, headers: Record<string, string> = H) { const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
async function gamesIn(lg: string, back = 3, fwd = 9) {
  const { data } = await sb.from('games').select('id,start_time,state,home,away,home_score,away_score,data').eq('league', lg)
    .gte('start_time', new Date(Date.now() - back * 86400e3).toISOString()).lt('start_time', new Date(Date.now() + fwd * 86400e3).toISOString());
  return data ?? [];
}

// ---------- ESPN NFL expert picks (straight up) ----------
async function espn() {
  const html = await text('https://www.espn.com/nfl/picks');
  const m = html.match(/window\['__espnfitt__'\]=(\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error('espn: no page data');
  const pd = JSON.parse(m[1])?.page?.content?.picksData;
  if (!pd) throw new Error('espn: no picks');
  const head = (pd.header ?? []).filter((x: any) => x && typeof x === 'object');
  const games = await gamesIn('nfl', 10, 10);
  const byId = new Map(games.map((g: any) => [String(g.id), g]));
  const ex: any[] = [], picks: any[] = [];
  for (const e of head) {
    const [w, l] = String(e.overall ?? '').split('-').map(Number);
    ex.push({ id: hid('espn:' + e.id), name: e.headshot?.alt ?? e.name, username: 'espn-' + e.id, source: 'espn', record: Number.isFinite(w) ? { win: w, loss: l, push: 0, count: w + l, window: 'season, straight up' } : null, record_text: `${e.overall ?? ''} straight up`, updated_at: new Date().toISOString() });
  }
  for (const row of pd.rows ?? []) {
    const info = row[0]; const g = byId.get(String(info?.id));
    if (!g) continue;
    for (const p of row.slice(1)) {
      const abbr = String(p.logo ?? '').match(/\/([a-z]+)\.png/)?.[1];
      if (!abbr) continue;
      const side = abbr === String(g.home).toLowerCase() ? 'home' : abbr === String(g.away).toLowerCase() ? 'away' : null;
      if (!side) continue;
      picks.push({ id: hid(`espn:${p.id}:${g.id}`), expert_id: hid('espn:' + p.id), source: 'espn', league: 'nfl', action_game_id: null, espn_id: String(g.id), type: `ml_${side}`, play: `${(g.data as any)?.[side]?.short ?? abbr.toUpperCase()} to win`, value: 0, odds: null, units: null, starts_at: g.start_time, created_at: new Date().toISOString(), side, status: 'published', updated_at: new Date().toISOString() });
    }
  }
  return { ex, picks };
}

// ---------- CBS Sports expert picks against the spread (server-rendered pick buttons) ----------
const CBS: Record<string, string> = { nfl: 'nfl', cfb: 'college-football' }; // CBS has no NBA expert board
async function cbs(lg: string) {
  const html = (await text(`https://www.cbssports.com/${CBS[lg]}/picks/experts/`, BROWSER)).replace(/\s+/g, ' ');
  const games = await gamesIn(lg, 1, 9);
  const now = Date.now();
  // season records from the header, in the same order as the pickers' columns
  const names: string[] = [], recs: string[] = [];
  const ex = new Map<number, any>(), picks: any[] = [];
  const re = /<a href="\/[a-z-]+\/teams\/([A-Z0-9]+)\/([a-z0-9-]+)\/"[^>]*>(?:(?!<\/td>).)*?data-config='(\{[^']*\})'(?:(?!<\/td>).)*?BetButton-text">\s*([^<]+?)\s*</g;
  for (const m of html.matchAll(re)) {
    let cfg: any; try { cfg = JSON.parse(m[4].replace(/&quot;/g, '"')); } catch { continue; }
    const who = cfg?.meta?.bets?.[0]?.expertLabel; if (!who) continue;
    const pos = Number(cfg.meta.bets[0].position);
    if (pos && !names[pos - 1]) names[pos - 1] = who;
    const slug = norm(m[2]), abbr = m[1].toLowerCase(), label = m[5].trim();
    const cand = games.filter((g: any) => { const t = new Date(g.start_time).getTime(); return t > now - 6 * 3600e3 && [g.data?.home, g.data?.away].some((d: any) => d && (norm(d.name) === slug || norm(d.abbr) === abbr)); })
      .sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const g: any = cand[0]; if (!g) continue;
    const isTot = /total|over|under/i.test(String(cfg.marketName)) || /^(o|u|over|under)\s/i.test(label);
    let side: string, type: string, value: number;
    if (isTot) { side = /^(o|over)/i.test(label) ? 'over' : 'under'; type = side; value = Number(String(cfg.line).replace(/[^0-9.]/g, '')); }
    else {
      side = (norm(g.data?.home?.name) === slug || norm(g.data?.home?.abbr) === abbr) ? 'home' : 'away';
      const n = label.match(/([+-]?\d+(\.\d+)?)\s*$/); value = /pk|even/i.test(label) ? 0 : n ? Number(n[1]) : Number(cfg.line);
      if (!Number.isFinite(value)) continue;
      type = `spread_${side}`;
    }
    const eid = hid('cbs:' + who.toLowerCase());
    if (!ex.has(eid)) ex.set(eid, { id: eid, name: who, username: 'cbs-' + norm(who), source: 'cbs', _pos: pos, updated_at: new Date().toISOString() });
    picks.push({ id: hid(`cbs:${lg}:${who}:${g.id}:${type}`), expert_id: eid, source: 'cbs', league: lg, action_game_id: null, espn_id: String(g.id), type, play: label, value, odds: -110, units: null, starts_at: g.start_time, created_at: new Date().toISOString(), side, status: 'published', updated_at: new Date().toISOString() });
  }
  for (const m of html.matchAll(/OVERALL:\s*<\/?[^>]*>?\s*(\d+-\d+(?:-\d+)?)/g)) recs.push(m[1]);
  if (!recs.length) for (const m of html.matchAll(/OVERALL:\s*(\d+-\d+(?:-\d+)?)/g)) recs.push(m[1]);
  for (const e of ex.values()) {
    const r = recs[e._pos - 1]; delete e._pos;
    if (r && recs.length === names.filter(Boolean).length) { const [w, l, pu] = r.split('-').map(Number); e.record = { win: w, loss: l, push: pu || 0, count: w + l + (pu || 0), units_net: w * 0.909 - l, window: 'season, against the spread' }; e.record_text = `${r} ATS (CBS)`; }
  }
  return { ex: [...ex.values()], picks };
}

// ---------- Doc's Sports free picks (one article per game) ----------
const DOCS: Record<string, string> = { nfl: 'nfl', cfb: 'football', nba: 'nba' };
function parsePlay(play: string, g: any) {
  const t = play.replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const tot = t.match(/^(over|under)\s*([\d.]+)/i);
  if (tot) return { type: tot[1].toLowerCase(), side: tot[1].toLowerCase(), value: Number(tot[2]) };
  const keys = (s: string) => [g.data?.[s]?.nick, g.data?.[s]?.short, g.data?.[s]?.name, g.data?.[s]?.abbr].filter(Boolean).map(norm);
  const nt = norm(t.replace(/[+-]?\d+(\.\d+)?/g, ''));
  let side: string | null = null;
  for (const s of ['home', 'away']) if (keys(s).some((k) => k && (nt.includes(k) || k.includes(nt)))) side = side ? side : s;
  if (!side) return null;
  const n = t.match(/([+-]\d+(\.\d+)?)/);
  if (/\bpk\b|pick'?em/i.test(t)) return { type: `spread_${side}`, side, value: 0 };
  if (n) return { type: `spread_${side}`, side, value: Number(n[1]) };
  return { type: `ml_${side}`, side, value: 0 };
}
async function docs(lg: string) {
  const idx = await text(`https://www.docsports.com/free-picks/${DOCS[lg]}/`);
  const games = await gamesIn(lg, 2, 9);
  const seen = new Set<string>();
  const links: { url: string; title: string }[] = [];
  for (const m of idx.matchAll(/href="(https:\/\/www\.docsports\.com\/free-picks\/[a-z-]+\/\d{4}\/[^"]+\.html)"\s+title="([^"]+)"/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]); links.push({ url: m[1], title: m[2].replace(/&amp;/g, '&') });
  }
  const today = Date.now();
  const cand = links.filter((l) => { const d = l.title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (!d) return false; const t = Date.UTC(+d[3], +d[1] - 1, +d[2]); return t >= today - 1.5 * 86400e3 && t <= today + 8 * 86400e3; }).slice(0, 30);
  const ex = new Map<number, any>(), picks: any[] = [];
  // gentle: three articles at a time with a pause, so the site isn't hammered
  const one = async (l: { url: string; title: string }) => {
    try {
      const tm = l.title.match(/^(.+?)\s+vs\.?\s+(.+?)\s+Prediction/i); if (!tm) return;
      const a = norm(tm[1]), b = norm(tm[2]);
      const dm = l.title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)!;
      const day = Date.UTC(+dm[3], +dm[1] - 1, +dm[2]);
      const g = games.find((x: any) => { const hn = norm(x.data?.home?.name), an = norm(x.data?.away?.name); const t = new Date(x.start_time).getTime();
        return Math.abs(t - day - 12 * 3600e3) < 36 * 3600e3 && ((hn === a && an === b) || (hn === b && an === a) || ((hn.includes(a) || a.includes(hn)) && (an.includes(b) || b.includes(an))) || ((hn.includes(b) || b.includes(hn)) && (an.includes(a) || a.includes(an)))); });
      if (!g) return;
      const html = await text(l.url);
      const pm = html.match(/<strong>\s*([^<]{2,40}?)(?:&#39;|')s\s+Pick:\s*(?:Take\s+the\s+|Take\s+)?([^<]+?)<\/strong>/i);
      if (!pm) return;
      const who = pm[1].trim();
      const pp = parsePlay(pm[2], g); if (!pp) return;
      const eid = hid('docs:' + who.toLowerCase());
      ex.set(eid, { id: eid, name: `${who} (Doc’s Sports)`, username: 'docs-' + norm(who), source: 'docs', updated_at: new Date().toISOString() });
      picks.push({ id: hid(`docs:${who}:${g.id}`), expert_id: eid, source: 'docs', league: lg, action_game_id: null, espn_id: String(g.id), type: pp.type, play: pm[2].replace(/&#39;/g, "'").trim(), value: pp.value, odds: -110, units: null, starts_at: g.start_time, created_at: new Date().toISOString(), side: pp.side, status: 'published', updated_at: new Date().toISOString() });
    } catch (e) { console.error(String(e)); }
  };
  for (let i = 0; i < cand.length; i += 3) { await Promise.all(cand.slice(i, i + 3).map(one)); await new Promise((r) => setTimeout(r, 700)); }
  return { ex: [...ex.values()], picks };
}

// ---------- grade non-Action picks from ESPN finals; keep records ----------
async function gradeAll() {
  const { data: open } = await sb.from('expert_picks').select('id,espn_id,type,side,value').neq('source', 'action').neq('status', 'settled').not('espn_id', 'is', null).limit(2000);
  const ids = [...new Set((open ?? []).map((p: any) => p.espn_id))];
  if (!ids.length) return 0;
  const { data: gs } = await sb.from('games').select('id,state,home_score,away_score').in('id', ids);
  const fin = new Map((gs ?? []).filter((g: any) => g.state === 'post' && g.home_score !== null).map((g: any) => [g.id, g]));
  const upd: any[] = [];
  for (const p of open ?? []) {
    const g: any = fin.get(p.espn_id); if (!g) continue;
    let r: string;
    if (p.type === 'over' || p.type === 'under') { const d = g.home_score + g.away_score - Number(p.value); r = d === 0 ? 'push' : (d > 0) === (p.type === 'over') ? 'win' : 'loss'; }
    else if (p.type.startsWith('spread')) { const m = (p.side === 'home' ? g.home_score - g.away_score : g.away_score - g.home_score) + Number(p.value); r = m === 0 ? 'push' : m > 0 ? 'win' : 'loss'; }
    else { const m = p.side === 'home' ? g.home_score - g.away_score : g.away_score - g.home_score; r = m === 0 ? 'push' : m > 0 ? 'win' : 'loss'; }
    upd.push({ id: p.id, result: r, status: 'settled', units_net: r === 'win' ? 0.909 : r === 'loss' ? -1 : 0 });
  }
  for (const u of upd) await sb.from('expert_picks').update({ result: u.result, status: u.status, units_net: u.units_net }).eq('id', u.id);
  // Doc's handicappers: record from graded picks here
  const { data: settled } = await sb.from('expert_picks').select('expert_id,result').eq('source', 'docs').eq('status', 'settled'); // CBS pickers keep CBS's own season record
  const rec = new Map<number, any>();
  for (const s of settled ?? []) { const r = rec.get(s.expert_id) ?? { win: 0, loss: 0, push: 0 }; if (s.result === 'win') r.win++; else if (s.result === 'loss') r.loss++; else r.push++; rec.set(s.expert_id, r); }
  for (const [id, r] of rec) await sb.from('experts').update({ record: { ...r, count: r.win + r.loss + r.push, units_net: r.win * 0.909 - r.loss, window: 'tracked here' } }).eq('id', id);
  return upd.length;
}

Deno.serve(async () => {
  const out: Record<string, unknown> = {};
  const jobs: [string, () => Promise<any>][] = [['espn', espn], ['cbs_nfl', () => cbs('nfl')], ['cbs_cfb', () => cbs('cfb')], ['docs_nfl', () => docs('nfl')], ['docs_cfb', () => docs('cfb')], ['docs_nba', () => docs('nba')]];
  const pause = () => new Promise((r) => setTimeout(r, 2000));
  for (const [name, fn] of jobs) {
    try {
      const { ex, picks } = await fn();
      if (ex.length) await sb.from('experts').upsert(ex);
      // don't overwrite a graded pick with a fresh copy
      const ids = picks.map((p: any) => p.id);
      const { data: done } = ids.length ? await sb.from('expert_picks').select('id').in('id', ids).eq('status', 'settled') : { data: [] };
      const skip = new Set((done ?? []).map((d: any) => d.id));
      const fresh = picks.filter((p: any) => !skip.has(p.id));
      if (fresh.length) await sb.from('expert_picks').upsert(fresh);
      out[name] = { experts: ex.length, picks: fresh.length };
    } catch (e) { out[name] = { error: String(e) }; }
    await pause();
  }
  out.graded = await gradeAll();
  await sb.from('blobs').upsert({ key: 'picks:other', data: { at: new Date().toISOString(), out }, updated_at: new Date().toISOString() });
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
