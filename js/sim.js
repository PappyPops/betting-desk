// Game simulator engine. Team ratings come from scores only:
//   points(team vs opp) = league average + team offense - opp defense + home edge (if home)
// fitted by weighted ridge regression where older games count less (half-life in weeks), using only games played
// before the one being predicted. Each game is then "played" thousands of times by adding the model's own past
// misses (home and away together), which keeps the real shape of NFL scores: key numbers, ties, blowouts.
export function fromHist(hist) {
  return hist.games.filter((g) => g.game_type === 'REG').map((g) => ({
    season: g.season, week: g.week, day: Date.parse(g.gameday) / 864e5, home: g.home_team, away: g.away_team,
    hs: g.home_score, as: g.away_score, done: g.done, spread: g.hspread ?? NaN, total: g.total_line ?? NaN, neutral: g.location === 'Neutral', espn: g.espn,
  })).sort((a, b) => a.day - b.day);
}

export function fit(train, now, half, lam) {
  const off = {}, def = {}; let mu = 21.5, hfa = 1.5;
  const rows = [];
  for (const g of train) {
    const w = Math.pow(0.5, (now - g.day) / 7 / half); if (w < 0.01) continue;
    rows.push({ t: g.home, o: g.away, pts: g.hs, home: g.neutral ? 0 : 1, w }, { t: g.away, o: g.home, pts: g.as, home: 0, w });
    off[g.home] ??= 0; off[g.away] ??= 0; def[g.home] ??= 0; def[g.away] ??= 0;
  }
  for (let it = 0; it < 25; it++) {
    let sw = 0, s = 0; for (const r of rows) { sw += r.w; s += r.w * (r.pts - off[r.t] + def[r.o] - hfa * r.home); } mu = s / sw;
    let hw = 0, hsum = 0; for (const r of rows) if (r.home) { hw += r.w; hsum += r.w * (r.pts - mu - off[r.t] + def[r.o]); } hfa = hw ? hsum / (hw + lam) : 0;
    const on = {}, dn = {};
    for (const r of rows) { const e = r.pts - mu - hfa * r.home; const a = on[r.t] ??= [0, 0]; a[0] += r.w * (e + def[r.o]); a[1] += r.w; }
    for (const k in on) off[k] = on[k][0] / (on[k][1] + lam);
    for (const r of rows) { const e = r.pts - mu - hfa * r.home; const a = dn[r.o] ??= [0, 0]; a[0] += r.w * (off[r.t] - e); a[1] += r.w; }
    for (const k in dn) def[k] = dn[k][0] / (dn[k][1] + lam);
  }
  return { mu, hfa, off, def };
}
export const predict = (m, g) => ({ ph: m.mu + (m.off[g.home] ?? 0) - (m.def[g.away] ?? 0) + (g.neutral ? 0 : m.hfa), pa: m.mu + (m.off[g.away] ?? 0) - (m.def[g.home] ?? 0) });

// predict every game in seasons from..to, refitting before each week with only earlier games
export function walk(games, from, to, half, lam) {
  const out = [];
  const keys = [...new Set(games.filter((g) => g.season >= from && g.season <= to).map((g) => `${g.season}|${g.week}`))];
  for (const k of keys) {
    const [s, w] = k.split('|').map(Number);
    const these = games.filter((g) => g.season === s && g.week === w);
    const first = Math.min(...these.map((g) => g.day));
    const m = fit(games.filter((g) => g.done && g.day < first - 0.5 && g.day > first - 3 * 365), first, half, lam);
    for (const g of these) out.push({ g, ...predict(m, g) });
  }
  return out;
}

export function simulate(p, resid, spread, total, n = 4000) {
  let cover = 0, push = 0, over = 0, opush = 0, win = 0;
  for (let i = 0; i < n; i++) {
    const [eh, ea] = resid[(Math.random() * resid.length) | 0];
    const h = Math.max(0, Math.round(p.ph + eh)), a = Math.max(0, Math.round(p.pa + ea));
    if (h > a) win++;
    if (Number.isFinite(spread)) { const m = h - a + spread; if (m > 0) cover++; else if (m === 0) push++; }
    if (Number.isFinite(total)) { const t = h + a - total; if (t > 0) over++; else if (t === 0) opush++; }
  }
  return { pWin: win / n, pHomeCover: n - push ? cover / (n - push) : 0.5, pOver: n - opush ? over / (n - opush) : 0.5 };
}

const blank = () => ({ w: 0, l: 0, p: 0 });
export function grade(preds, resid) {
  const bins = [0.52, 0.54, 0.56, 0.58, 0.6];
  const sp = Object.fromEntries(bins.map((b) => [b, blank()])), tot = Object.fromEntries(bins.map((b) => [b, blank()]));
  const pts = [0, 1, 2, 3, 4, 5, 6], spP = pts.map((t) => ({ t, ...blank() })), toP = pts.map((t) => ({ t, ...blank() }));
  let n = 0, mm = 0, ml = 0, tm = 0, tl = 0;
  for (const p of preds) {
    const g = p.g; if (!g.done || !Number.isFinite(g.spread) || !Number.isFinite(g.total)) continue;
    const marg = g.hs - g.as, sum = g.hs + g.as; n++;
    mm += Math.abs(p.ph - p.pa - marg); ml += Math.abs(-g.spread - marg); tm += Math.abs(p.ph + p.pa - sum); tl += Math.abs(g.total - sum);
    const s = simulate(p, resid, g.spread, g.total, 2000);
    const hc = marg + g.spread, ou = sum - g.total;
    const side = s.pHomeCover >= 0.5 ? 1 : -1, pS = Math.max(s.pHomeCover, 1 - s.pHomeCover);
    const tside = s.pOver >= 0.5 ? 1 : -1, pT = Math.max(s.pOver, 1 - s.pOver);
    const add = (r, res, want) => { if (res === 0) r.p++; else if (Math.sign(res) === want) r.w++; else r.l++; };
    for (const b of bins) { if (pS >= b) add(sp[b], hc, side); if (pT >= b) add(tot[b], ou, tside); }
    const dS = (p.ph - p.pa) + g.spread, dT = (p.ph + p.pa) - g.total;
    for (const x of spP) if (Math.abs(dS) >= x.t) add(x, hc, Math.sign(dS));
    for (const x of toP) if (Math.abs(dT) >= x.t) add(x, ou, Math.sign(dT));
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  return { games: n, missMargin: { model: r2(mm / n), line: r2(ml / n) }, missTotal: { model: r2(tm / n), line: r2(tl / n) }, byChance: { spread: sp, total: tot }, byPoints: { spread: spP, total: toP } };
}

// the full honest test: settings chosen on 2006-2013 only, then 2014-2025 and 2026 graded untouched
export function backtest(games, halves = [6, 12, 24], lams = [2, 6]) {
  const grid = [];
  for (const half of halves) for (const lam of lams) {
    const pr = walk(games, 2006, 2013, half, lam).filter((p) => p.g.done);
    grid.push({ half, lam, err: pr.reduce((a, p) => a + Math.abs(p.ph - p.pa - (p.g.hs - p.g.as)) + Math.abs(p.ph + p.pa - (p.g.hs + p.g.as)), 0) / pr.length });
  }
  const best = [...grid].sort((a, b) => a.err - b.err)[0];
  const tune = walk(games, 2006, 2013, best.half, best.lam);
  const resid = tune.filter((p) => p.g.done).map((p) => [p.g.hs - p.ph, p.g.as - p.pa]);
  return { settings: best, grid, tune: grade(tune, resid), holdout: grade(walk(games, 2014, 2025, best.half, best.lam), resid), now: grade(walk(games, 2026, 2026, best.half, best.lam), resid) };
}
