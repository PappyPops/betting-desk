// Shared NFL player-prop model for Slant (before kickoff) and At the Whistle (at each quarter break).
// Projections use only weeks before the game, so past weeks can be checked honestly.
import { api, blob, ncdf } from './core.js?v=202611180333';
import { nflHist } from './hist.js?v=202611180333';

export const STATS = {
  pass_yds: { label: 'Pass yds', cols: ['passing_yards'], box: ['pass_yds'], pos: ['QB'], yards: true },
  pass_cmp: { label: 'Completions', cols: ['completions'], box: ['pass_cmp'], pos: ['QB'] },
  pass_att: { label: 'Pass attempts', cols: ['attempts'], box: ['pass_att'], pos: ['QB'] },
  pass_td: { label: 'Pass TD', cols: ['passing_tds'], box: ['pass_td'], pos: ['QB'], count: true },
  rush_att: { label: 'Carries', cols: ['carries'], box: ['rush_att'], pos: ['QB', 'RB'] },
  rush_yds: { label: 'Rush yds', cols: ['rushing_yards'], box: ['rush_yds'], pos: ['QB', 'RB', 'WR'], yards: true, long: 'rush_long' },
  rec: { label: 'Receptions', cols: ['receptions'], box: ['rec'], pos: ['RB', 'WR', 'TE'] },
  rec_yds: { label: 'Rec yds', cols: ['receiving_yards'], box: ['rec_yds'], pos: ['RB', 'WR', 'TE'], yards: true, long: 'rec_long' },
  pass_rush_yds: { label: 'Pass + rush yds', cols: ['passing_yards', 'rushing_yards'], box: ['pass_yds', 'rush_yds'], pos: ['QB'], yards: true },
  rush_rec_yds: { label: 'Rush + rec yds', cols: ['rushing_yards', 'receiving_yards'], box: ['rush_yds', 'rec_yds'], pos: ['RB', 'WR', 'TE'], yards: true },
};
export const TYPE_GROUP = { pass_yds: 'Pass', pass_cmp: 'Pass', pass_att: 'Pass', pass_td: 'Pass', pass_rush_yds: 'Pass', rush_att: 'Rush', rush_yds: 'Rush', rush_rec_yds: 'Rush', rec: 'Rec', rec_yds: 'Rec' };
const PASS_SIDE = new Set(['pass_yds', 'pass_cmp', 'pass_att', 'pass_td', 'pass_rush_yds', 'rec', 'rec_yds']);
const RUSH_SIDE = new Set(['rush_att', 'rush_yds']);

const val = (r, s) => STATS[s].cols.reduce((a, c) => a + (r[c] || 0), 0);
export const boxVal = (b, s) => b ? STATS[s].box.reduce((a, k) => a + (b[k] || 0), 0) : null;

// the data both pages need, loaded once
let memo = null;
export function propData() {
  if (memo) return memo;
  memo = (async () => {
    const [pb, hist, athletes] = await Promise.all([blob('nfl_players_2026', 3 * 3600_000), nflHist(), api('athletes?select=id,name,pos,team,headshot,gsis&limit=1000', { ttl: 3600_000 })]);
    const more = []; for (let off = 1000; off < 6000; off += 1000) { const p = await api(`athletes?select=id,name,pos,team,headshot,gsis&offset=${off}&limit=1000`, { ttl: 3600_000 }); more.push(...p); if (p.length < 1000) break; }
    const { cols, rows: raw } = pb.data;
    const rows = raw.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    const byPid = new Map(); for (const r of rows) { if (!byPid.has(r.pid)) byPid.set(r.pid, []); byPid.get(r.pid).push(r); }
    for (const l of byPid.values()) l.sort((a, b) => a.week - b.week);
    const ath = new Map([...athletes, ...more].map((a) => [String(a.id), a]));
    const posOf = new Map(Object.entries(pb.data.players).map(([pid, p]) => [pid, p[1]]));
    const week = new Map(hist.games.filter((g) => g.season === 2026 && g.espn).map((g) => [String(g.espn), g]));
    return { rows, byPid, ath, posOf, hist, week };
  })().catch((e) => { memo = null; throw e; });
  return memo;
}

// how many yards/catches a defense gives up to a position, relative to league average, from weeks before `wk`
function defenseFactors(rows, posOf, wk) {
  const agg = new Map(), lg = new Map();
  for (const r of rows) {
    if (r.week >= wk) continue;
    const pos = posOf.get(r.pid); if (!pos) continue;
    for (const s of Object.keys(STATS)) {
      const v = val(r, s), k = `${r.opp}|${pos}|${s}`, lk = `${pos}|${s}`;
      const a = agg.get(k) ?? { v: 0, wk: new Set() }; a.v += v; a.wk.add(r.week); agg.set(k, a);
      const l = lg.get(lk) ?? { v: 0, n: new Set() }; l.v += v; l.n.add(`${r.opp}|${r.week}`); lg.set(lk, l);
    }
  }
  return (opp, pos, s) => {
    const a = agg.get(`${opp}|${pos}|${s}`), l = lg.get(`${pos}|${s}`);
    if (!a || !l || !l.v) return { f: 1, n: 0, rank: null };
    const per = a.v / a.wk.size, avg = l.v / l.n.size, n = a.wk.size;
    const f = 1 + (per / avg - 1) * n / (n + 4);
    return { f: Math.max(0.8, Math.min(1.2, f)), n, per, avg };
  };
}

// recent form: last four games weighted 4-3-2-1, blended with the season average
function form(list, wk, s) {
  const g = list.filter((r) => r.week < wk);
  if (!g.length) return null;
  const last = g.slice(-4).reverse(); const w = [4, 3, 2, 1];
  const lw = last.reduce((a, r, i) => a + val(r, s) * w[i], 0) / w.slice(0, last.length).reduce((a, x) => a + x, 0);
  const sa = g.reduce((a, r) => a + val(r, s), 0) / g.length;
  return { mean: 0.6 * lw + 0.4 * sa, last: last.map((r) => val(r, s)), games: g.length };
}

// spread of outcomes around a projection, by stat
export function sdFor(s, mean) {
  const m = Math.max(0, mean);
  switch (s) {
    case 'pass_yds': case 'pass_rush_yds': return 0.22 * m + 30;
    case 'rush_yds': return 0.45 * m + 8;
    case 'rec_yds': case 'rush_rec_yds': return 0.55 * m + 8;
    case 'rec': return 0.4 * m + 0.9;
    case 'pass_cmp': return 0.13 * m + 2.5;
    case 'pass_att': return 0.11 * m + 3;
    case 'rush_att': return 0.28 * m + 1.8;
    default: return Math.sqrt(m) + 0.2;
  }
}
const poissonOver = (mean, line) => { let p = 0, t = Math.exp(-mean); for (let k = 0; k <= Math.floor(line); k++) { p += t; t *= mean / (k + 1); } return 1 - p; };
export function probOver(s, mean, line, sd = sdFor(s, mean)) {
  if (STATS[s].count) return poissonOver(Math.max(0.01, mean), line);
  return 1 - ncdf((line - mean) / Math.max(0.5, sd));
}

// pregame projection for one player prop, using only weeks before the game
export function project(d, { gsis, pos, stat, opp, wk, line }) {
  const list = d.byPid.get(gsis) || [];
  const f = form(list, wk, stat); if (!f || f.games < 2) return null;
  const dfn = (d._def ??= new Map()); if (!dfn.has(wk)) dfn.set(wk, defenseFactors(d.rows, d.posOf, wk));
  const df = dfn.get(wk)(opp, pos, stat);
  const model = f.mean * df.f;
  const mean = line === null || line === undefined ? model : 0.5 * model + 0.5 * line; // the market line is half the prior
  return { model, mean, form: f, def: df };
}

// at a quarter break: projected final from the stat so far, the prior, pace, game script and the clock
export function atWhistle({ stat, prior, now, long = 0, period, lead }) {
  const e = period / 4, r = 1 - e;
  const cleaned = STATS[stat].yards && long > 25 ? now - (long - 15) : now; // one long play doesn't set the pace
  const pace = Math.max(0, cleaned) / e;
  const w = { 1: 0.75, 2: 0.6, 3: 0.5 }[period];
  let rate = w * prior + (1 - w) * pace;
  let script = 1, note = 'Score close. Game script near the open.';
  if (period >= 2 && Math.abs(lead) >= 10) {
    const big = Math.abs(lead) >= 17;
    if (lead < 0) { if (PASS_SIDE.has(stat)) script = big ? 1.2 : 1.1; if (RUSH_SIDE.has(stat) || stat === 'rush_rec_yds') script = big ? 0.75 : 0.88; note = `Down ${-lead}. Trailing teams throw more the rest of the way.`; }
    else { if (PASS_SIDE.has(stat)) script = big ? 0.8 : 0.9; if (RUSH_SIDE.has(stat)) script = big ? 1.2 : 1.1; note = `Up ${lead}. Leading teams run the clock.`; }
  }
  const remaining = r * rate * script;
  const fair = now + remaining;
  const sd = sdFor(stat, prior) * Math.sqrt(r);
  return { fair, remaining, pace, sd, note, script };
}
