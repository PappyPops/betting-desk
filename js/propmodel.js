// Shared NFL player-prop model for Slant (before kickoff) and At the Whistle (at each quarter break).
// Projections use only weeks before the game, so past weeks can be checked honestly.
import { api, blob, ncdf } from './core.js?v=202611221433';
import { nflHist } from './hist.js?v=202611221433';

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
  let g = list.filter((r) => r.week < wk);
  if (g.length >= 4) { // drop games he barely played (under a third of his usual volume), e.g. left hurt
    const vol = (r) => r.attempts + r.carries + r.targets; const med = [...g].map(vol).sort((a, b) => a - b)[Math.floor(g.length / 2)];
    g = g.filter((r) => vol(r) >= med / 3);
  }
  if (!g.length) return null;
  const last = g.slice(-4).reverse(); const w = [4, 3, 2, 1];
  const lw = last.reduce((a, r, i) => a + val(r, s) * w[i], 0) / w.slice(0, last.length).reduce((a, x) => a + x, 0);
  const sa = g.reduce((a, r) => a + val(r, s), 0) / g.length;
  return { mean: 0.6 * lw + 0.4 * sa, last: last.map((r) => val(r, s)), games: g.length };
}

// spread of outcomes around a projection, by stat. Once calibrate() has run, this is measured from how far the
// model's own projections missed in earlier weeks this season (a straight line fit of miss size against projection).
let CAL = null;
export function sdFor(s, mean) {
  const m = Math.max(0, mean);
  if (CAL?.[s]) return Math.max(CAL[s].min, CAL[s].a + CAL[s].b * m);
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

export function calibrate(d) {
  if (CAL) return CAL;
  const maxWk = Math.max(...d.rows.map((r) => r.week));
  const res = Object.fromEntries(Object.keys(STATS).map((k) => [k, []]));
  for (const [pid, list] of d.byPid) {
    const pos = d.posOf.get(pid);
    for (const r of list) {
      if (r.week < 5 || r.week > maxWk) continue;
      for (const k of Object.keys(STATS)) {
        if (!STATS[k].pos.includes(pos) || STATS[k].count) continue;
        const pr = project(d, { gsis: pid, pos, stat: k, opp: r.opp, wk: r.week, line: null });
        if (!pr || pr.model < (STATS[k].yards ? 10 : 1.5)) continue;
        res[k].push([pr.model, STATS[k].cols.reduce((a, c) => a + (r[c] || 0), 0)]);
      }
    }
  }
  CAL = {};
  for (const [k, pts] of Object.entries(res)) {
    if (pts.length < 60) continue;
    pts.sort((a, b) => a[0] - b[0]);
    const bins = 5, xs = [], ys = [];
    for (let i = 0; i < bins; i++) { const part = pts.slice(Math.floor(i * pts.length / bins), Math.floor((i + 1) * pts.length / bins)); xs.push(part.reduce((a, p) => a + p[0], 0) / part.length); ys.push(Math.sqrt(part.reduce((a, p) => a + (p[1] - p[0]) ** 2, 0) / part.length)); }
    const mx = xs.reduce((a, x) => a + x, 0) / bins, my = ys.reduce((a, y) => a + y, 0) / bins;
    const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0));
    CAL[k] = { a: my - b * mx, b: Math.max(0, b), min: Math.min(...ys) * 0.8, n: pts.length };
  }
  return CAL;
}

// pregame projection for one player prop, using only weeks before the game
const REC_STATS = new Set(['rec', 'rec_yds']), RUSH_STATS = new Set(['rush_att', 'rush_yds']);
const PASS_STATS = new Set(['pass_yds', 'pass_cmp', 'pass_att', 'pass_rush_yds']);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// the situation around one game for one team: who's out, who's throwing, weather, and how the game should go
// ctx = { team, out: [{gsis, name, pos}], qb: {gsis, name, passYds, passAtt} | null, weather, roof, spread, total }
function situational(d, { gsis, pos, stat, wk, ctx }) {
  const notes = []; let f = 1, news = 1;
  if (!ctx) return { f, notes, news };
  const mine = (d.byPid.get(gsis) || []).filter((r) => r.week < wk && r.team === ctx.team).slice(-4);
  const weeks = new Set(mine.map((r) => r.week));
  const teamRows = d.rows.filter((r) => r.team === ctx.team && weeks.has(r.week));
  // 1. a teammate is out: his share of targets (or carries) moves to the players left
  const shareOf = (key, who) => { const tot = teamRows.reduce((a, r) => a + (r[key] || 0), 0); return tot ? teamRows.filter((r) => r.pid === who).reduce((a, r) => a + (r[key] || 0), 0) / tot : 0; };
  const volKey = REC_STATS.has(stat) ? 'targets' : RUSH_STATS.has(stat) ? 'carries' : stat === 'rush_rec_yds' ? 'targets' : null;
  if (volKey && ctx.out?.length && weeks.size) {
    const gone = ctx.out.filter((o) => o.gsis !== gsis && teamRows.some((r) => r.pid === o.gsis && (r[volKey] || 0) > 0));
    const missing = gone.reduce((a, o) => a + shareOf(volKey, o.gsis), 0);
    const mineShare = shareOf(volKey, gsis);
    if (missing > 0.05 && mineShare > 0) {
      const boost = clamp(1 + missing / Math.max(0.2, 1 - missing), 1, 1.6);
      f *= boost; news *= boost;
      notes.push(`${gone.map((o) => `${o.name} (${o.pos})`).join(', ')} out: ${(missing * 100).toFixed(0)}% of the ${volKey} are up for grabs, about ${sgnPct(boost - 1)} for him.`);
    }
  }
  // 2. who's throwing: the QB's own passing line against what this offense threw for in his recent games
  if ((REC_STATS.has(stat) || stat === 'rush_rec_yds') && ctx.qb?.passYds) {
    const qbRows = teamRows.filter((r) => d.posOf.get(r.pid) === 'QB');
    const perWk = weeks.size ? qbRows.reduce((a, r) => a + r.passing_yards, 0) / weeks.size : null;
    if (perWk && perWk > 80) {
      const ratio = ctx.qb.passYds / perWk;
      const adj = clamp(1 + 0.6 * (ratio - 1) * (stat === 'rush_rec_yds' ? 0.5 : 1), 0.75, 1.35);
      const usual = [...qbRows.reduce((m, r) => m.set(r.pid, (m.get(r.pid) || 0) + r.attempts), new Map())].sort((x, y) => y[1] - x[1])[0]?.[0];
      const change = usual && usual !== ctx.qb.gsis;
      if (Math.abs(adj - 1) >= 0.03) { f *= adj; news *= adj; notes.push(`${change ? `QB change: ${ctx.qb.name} starts. ` : ''}${ctx.qb.name}’s passing line is ${ctx.qb.passYds} vs the ${perWk.toFixed(0)} a game this offense threw for lately: ${sgnPct(adj - 1)} for receivers.`); }
    }
  }
  // 3. weather (outdoor stadiums only)
  const w = ctx.weather;
  if (w && ctx.roof !== 'dome' && ctx.roof !== 'closed') {
    const gust = Number(w.gust) || 0, rain = Number(w.precip) || 0, temp = Number(w.temp);
    let wx = 1; const why = [];
    if (gust >= 35) { wx = 0.85; why.push(`gusts to ${gust} mph`); } else if (gust >= 25) { wx = 0.92; why.push(`gusts to ${gust} mph`); }
    if (rain >= 60) { wx *= 0.95; why.push(`${rain}% chance of rain`); }
    if (Number.isFinite(temp) && temp <= 25) { wx *= 0.96; why.push(`${temp}°F`); }
    if (wx < 1) {
      const isAir = PASS_STATS.has(stat) || REC_STATS.has(stat), isGround = RUSH_STATS.has(stat);
      const adj = isAir ? wx : isGround ? 1 + (1 - wx) * 0.5 : 1;
      if (adj !== 1) { f *= adj; notes.push(`Weather: ${why.join(', ')}. ${isAir ? 'Passing' : 'Running'} ${sgnPct(adj - 1)}.`); }
    }
  }
  // 4. game script from the spread: favorites run more late, underdogs throw more
  if (Number.isFinite(ctx.spread)) {
    const fav = -ctx.spread; // points this team is favored by
    let adj = 1;
    if (RUSH_STATS.has(stat)) adj = clamp(1 + 0.012 * fav, 0.88, 1.12);
    else if (PASS_STATS.has(stat) || REC_STATS.has(stat)) adj = clamp(1 - 0.005 * fav, 0.94, 1.06);
    if (Math.abs(adj - 1) >= 0.03) { f *= adj; notes.push(`${fav > 0 ? `Favored by ${fav}` : `${-fav}-point underdog`}: ${sgnPct(adj - 1)} ${RUSH_STATS.has(stat) ? 'on the ground' : 'through the air'} from game script.`); }
  }
  return { f: clamp(f, 0.6, 1.8), notes, news };
}
const sgnPct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)}%`;

// pregame projection for one player prop, using only weeks before the game
export function project(d, { gsis, pos, stat, opp, wk, line, open = null, ctx = null }) {
  const list = d.byPid.get(gsis) || [];
  const f = form(list, wk, stat); if (!f || f.games < 3) return null;
  const dfn = (d._def ??= new Map()); if (!dfn.has(wk)) dfn.set(wk, defenseFactors(d.rows, d.posOf, wk));
  const df = dfn.get(wk)(opp, pos, stat);
  const sit = situational(d, { gsis, pos, stat, wk, ctx });
  const model = f.mean * df.f * sit.f;
  // The market line carries most of the weight. News the line may not have caught up to (a teammate out, a QB change)
  // earns the model a little more; a line already moving the other way earns it less.
  let wModel = Math.abs(sit.news - 1) >= 0.08 ? 0.35 : 0.25;
  const moved = open && line ? (line - open) / Math.max(1, open) : 0;
  const against = line != null && ((model > line && moved <= -0.06) || (model < line && moved >= 0.06));
  if (against) wModel /= 2;
  const mean = line === null || line === undefined ? model : wModel * model + (1 - wModel) * line;
  return { model, mean, form: f, def: df, sit, wModel, against };
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
