// Best bets: every tool's current reads on the same games, weighted by how each tool has actually done on games
// it hadn't seen yet. A source with no record, or a record under break-even, gets no weight.
import { api, games } from './core.js?v=202611221317';
import { matrixData } from './matrix.js?v=202611221317';
import { RESEARCH, BREAK_EVEN } from './research.js?v=202611221317';
import { CUTS, grade as cutGrade } from './linelife.js?v=202611221317';
import { flagNow, loadFlags, gradeFlags, historyNote } from './moves.js?v=202611221317';

const BE = 110 / 210;
const K = 150; // shrink each record toward break-even as if it had 150 more games at exactly break-even
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const MKT = (t) => /^spread/.test(t) ? 'sp' : /^ml/.test(t) ? 'ml' : ['over', 'under'].includes(t) ? 'tot' : null;

// edge = estimated win rate minus break-even, after shrinking toward break-even for sample size
export function edgeOf(w, l, be = BE) { const n = w + l; if (!n) return 0; return (w / n - be) * n / (n + K); }
const roiEdge = (u, n) => n ? (u / n) * n / (n + K) / 2 : 0; // a moneyline's return, roughly halved into win-rate terms

function gradeFinal(b, g) {
  if (!g || g.state !== 'post' || g.home_score === null) return null;
  const hs = g.home_score, as = g.away_score, ln = Number(b.line);
  if (b.market === 'tot') { const d = hs + as - ln; return d === 0 ? 'P' : (d > 0) === (b.side === 'over') ? 'W' : 'L'; }
  if (b.market === 'ml') return hs === as ? 'P' : (b.side === 'home') === (hs > as) ? 'W' : 'L';
  const m = (b.side === 'home' ? hs - as : as - hs) + ln; return m === 0 ? 'P' : m > 0 ? 'W' : 'L'; // sp and teaser legs
}
export { gradeFinal };

export async function bestBets() {
  const now = Date.now();
  const from = new Date(now - 3600e3).toISOString(), to = new Date(now + 8 * 86400e3).toISOString(); // a full NFL week ahead
  const [mx, nfl, cfb, nba, juiceOpen, juiceDone, picks] = await Promise.all([
    matrixData(),
    games({ league: 'nfl', from, to }), games({ league: 'cfb', from, to }), games({ league: 'nba', from, to }),
    api(`juice_bets?select=*&locked=eq.false&start_time=gte.${encodeURIComponent(new Date(now).toISOString())}`, { ttl: 60_000 }),
    api('juice_bets?select=*&locked=eq.true&order=start_time.desc&limit=3000', { ttl: 300_000 }),
    api(`expert_picks?select=*&starts_at=gte.${encodeURIComponent(new Date(now - 45 * 86400e3).toISOString())}&limit=8000`, { ttl: 300_000 }),
  ]);
  const G = new Map([...nfl, ...cfb, ...nba].map((g) => [String(g.id), g]));
  const pre = (id) => { const g = G.get(String(id)); return g && g.state === 'pre' && new Date(g.start_time).getTime() > now ? g : null; };
  const sources = []; // each: { id, name, short, w, l, edge, note, kind }
  const reads = [];   // each: { gid, market, side, src }
  const add = (src, gid, market, side) => { if (src.edge > 0 && pre(gid)) reads.push({ gid: String(gid), market, side, src }); };

  // 1. Research systems, judged only on seasons after they were published
  for (const r of RESEARCH.filter((x) => x.league === 'NFL' && x.after)) {
    const a = r.after;
    const edge = r.kind === 'moneyline' ? roiEdge(a.u, a.n) : edgeOf(a.w, a.l, BREAK_EVEN[r.kind]);
    const src = { id: r.id, name: r.name, short: r.cite.split(',')[0], w: a.w, l: a.l, edge, kind: r.kind, note: `since published ${a.w}–${a.l}` };
    sources.push(src);
    for (const g of mx.upcoming.NFL) { const m = r.pick(g); if (m) add(src, g.espn, m.kind === 'teaser' ? 'teaser' : m.kind === 'total' ? 'tot' : m.kind === 'moneyline' ? 'ml' : 'sp', m.side); }
  }
  // 2. Matrix badged systems, judged on games since they were found
  for (const lg of ['NFL', 'NCAAF']) {
    const b = mx.sinceBadged[lg];
    const src = { id: `matrix-${lg}`, name: `Matrix badged ${lg === 'NFL' ? 'NFL' : 'college'} systems`, short: 'Matrix', w: b.w, l: b.l, edge: edgeOf(b.w, b.l), note: `badged plays since found ${b.w}–${b.l}` };
    sources.push(src);
    for (const { g, hits } of mx.boards[lg]) {
      const seen = new Set();
      for (const h of hits.filter((x) => x.s.qualified)) { const k = `${h.m.kind}|${h.m.side}`; if (seen.has(k)) continue; seen.add(k); add({ ...src, count: hits.filter((x) => x.s.qualified && x.m.side === h.m.side && x.m.kind === h.m.kind).length }, g.espn ?? g.id, h.m.kind === 'moneyline' ? 'ml' : h.m.kind === 'total' ? 'tot' : 'sp', h.m.side); }
    }
  }
  // 3. Line Life totals rules that held on both halves of history; weighted on 2014–2025
  {
    const done = mx.hist.games.filter((g) => g.done && g.total_line !== null && g.game_type === 'REG');
    const A = done.filter((g) => g.season <= 2013), B = done.filter((g) => g.season >= 2014 && g.season <= 2025);
    for (const c of CUTS) {
      const a = cutGrade(A.filter(c.test), c.side), b = cutGrade(B.filter(c.test), c.side);
      if (!(a.pct > 0.524 && b.pct > 0.524 && a.w + a.l >= 60 && b.w + b.l >= 60)) continue;
      const src = { id: `cut-${c.id}`, name: `Line Life: ${c.name}`, short: 'Line Life', w: b.w, l: b.l, edge: edgeOf(b.w, b.l), note: `2014–2025 ${b.w}–${b.l}` };
      sources.push(src);
      for (const h of mx.hist.games.filter((x) => x.season === 2026 && !x.done && x.espn)) {
        const live = pre(h.espn); if (!live || live.total === null) continue;
        if (c.test({ ...h, total_line: Number(live.total) })) add(src, h.espn, 'tot', c.side);
      }
    }
  }
  // 4. The Juice: money against tickets, judged on every read it has locked so far
  {
    let w = 0, l = 0;
    const ids = [...new Set(juiceDone.map((b) => b.espn_id).filter(Boolean))];
    const fin = new Map();
    for (let i = 0; i < ids.length; i += 150) for (const g of await api(`games?select=id,state,home_score,away_score&id=in.(${ids.slice(i, i + 150).join(',')})`, { ttl: 600_000 })) fin.set(String(g.id), g);
    const side = (b) => b.market === 'tot' ? (b.side === 'a' ? 'over' : 'under') : b.side === 'a' ? 'away' : 'home';
    for (const b of juiceDone) { if (b.market === 'ml') continue; const r = gradeFinal({ market: b.market, side: side(b), line: b.line }, fin.get(String(b.espn_id))); if (r === 'W') w++; else if (r === 'L') l++; }
    const src = { id: 'juice', name: 'The Juice: money against tickets', short: 'The Juice', w, l, edge: edgeOf(w, l), note: `locked reads ${w}–${l}` };
    sources.push(src);
    for (const b of juiceOpen) if (b.market !== 'ml') add(src, b.espn_id, b.market, side(b));
  }
  // 5. Cap'n Cash: three or more handicappers on the same side, judged on settled stacks
  {
    const full = picks.filter((k) => k.espn_id && k.source !== 'espn' && !/\((1H|2H|1Q|2Q|3Q|4Q|1P|2P|3P)\)/i.test(k.play || ''));
    const stacks = (list) => { const m = new Map(); for (const k of list) { const mk = MKT(k.type); if (!mk || !k.side) continue; const key = `${k.espn_id}|${mk}|${k.side}`; if (!m.has(key)) m.set(key, { gid: k.espn_id, mk, side: k.side, picks: [] }); const s = m.get(key); if (!s.picks.some((x) => x.expert_id === k.expert_id)) s.picks.push(k); } return [...m.values()].filter((s) => s.picks.length >= 3); };
    let w = 0, l = 0;
    for (const s of stacks(full.filter((k) => k.status === 'settled'))) { const mv = median(s.picks.map((x) => Number(x.value))); const p = s.picks.find((x) => Number(x.value) === mv) ?? s.picks[0]; if (p.result === 'win') w++; else if (p.result === 'loss') l++; }
    const src = { id: 'capn', name: 'Cap’n Cash: 3+ handicappers agree', short: 'Cap’n Cash', w, l, edge: edgeOf(w, l), note: `settled stacks ${w}–${l}` };
    sources.push(src);
    for (const s of stacks(full.filter((k) => k.status !== 'settled'))) if (s.mk !== 'ml') add({ ...src, count: s.picks.length }, s.gid, s.mk, s.side);
  }

  // 6. Line Life move flags, judged on every frozen flag since line history started
  {
    const recent = (await Promise.all(['nfl', 'cfb', 'nba'].map((lg) => games({ league: lg, from: '2026-11-16', ttl: 300_000 })))).flat();
    const r = gradeFlags(await loadFlags(recent)).all ?? { w: 0, l: 0 };
    const src = { id: 'moves', name: 'Line Life: line moved toward this side', short: 'Line Life', w: r.w, l: r.l, edge: edgeOf(r.w, r.l), note: `flags so far ${r.w}–${r.l}` };
    sources.push(src);
    for (const g of G.values()) if (pre(g.id)) for (const f of flagNow(g)) if (historyNote(g.league, f)?.tone !== 'clay') add(src, g.id, f.mk, f.side);
  }

  // combine: the strongest source counts in full, each extra agreeing source a quarter, opposing sources subtract
  const opp = { home: 'away', away: 'home', over: 'under', under: 'over' };
  const byKey = new Map();
  for (const r of reads) { const k = `${r.gid}|${r.market}|${r.side}`; if (!byKey.has(k)) byKey.set(k, { gid: r.gid, market: r.market, side: r.side, srcs: [] }); const b = byKey.get(k); if (!b.srcs.some((s) => s.id === r.src.id)) b.srcs.push(r.src); }
  const out = [];
  for (const b of byKey.values()) {
    const g = pre(b.gid); if (!g) continue;
    const es = b.srcs.map((s) => s.edge).sort((x, y) => y - x);
    const against = byKey.get(`${b.gid}|${b.market === 'teaser' ? 'sp' : b.market}|${opp[b.side]}`)?.srcs ?? [];
    const score = es[0] + 0.25 * es.slice(1).reduce((a, x) => a + x, 0) - against.reduce((a, s) => a + s.edge, 0);
    if (score < 0.01) continue;
    const ln = b.market === 'tot' ? Number(g.total) : b.market === 'ml' ? (b.side === 'home' ? g.ml_home : g.ml_away) : g.spread_home === null ? null : (b.side === 'home' ? Number(g.spread_home) : -Number(g.spread_home)) + (b.market === 'teaser' ? 6 : 0);
    if (ln === null || ln === undefined || Number.isNaN(ln)) continue;
    out.push({ ...b, g, line: ln, score, against, be: b.market === 'teaser' ? BREAK_EVEN.teaser : BE, tier: score >= 0.025 ? 'best' : 'lean' });
  }
  out.sort((a, b) => b.score - a.score);
  return { bets: out, sources: sources.sort((a, b) => b.edge - a.edge) };
}
