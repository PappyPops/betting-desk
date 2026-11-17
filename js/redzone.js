import { games, blob, esc, seg, onSeg, store, pct, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, copy } from './core.js?v=202611162200';
import { nflHist } from './hist.js?v=202611162200';

const GROUP = (pos) => pos === 'QB' ? 'QB' : pos === 'TE' ? 'TE' : pos === 'WR' ? 'WR' : 'RB';
const K_RUSH = 60, K_REC = 50, K_OPP = 8;

// Everything the model needs from weeks before `wk`.
function buildModel(rows, players, histGames, wk) {
  const prior = rows.filter((r) => r.week < wk);
  const lg = { RB: [0, 0, 0, 0], WR: [0, 0, 0, 0], TE: [0, 0, 0, 0], QB: [0, 0, 0, 0] }; // carries, rushTD, targets, recTD
  const byP = new Map(), oppAllowed = new Map(), oppGames = new Map(), teamLast = new Map();
  for (const r of prior) {
    const g = GROUP(players[r.pid]?.[1]);
    const L = lg[g]; L[0] += r.carries; L[1] += r.rushing_tds; L[2] += r.targets; L[3] += r.receiving_tds;
    if (!byP.has(r.pid)) byP.set(r.pid, []);
    byP.get(r.pid).push(r);
    const k = r.opp + '|' + g; oppAllowed.set(k, (oppAllowed.get(k) ?? 0) + r.rushing_tds + (g === 'QB' ? 0 : r.receiving_tds));
    teamLast.set(r.team, Math.max(teamLast.get(r.team) ?? 0, r.week));
  }
  for (const r of prior) { const s = oppGames.get(r.opp) ?? new Set(); s.add(r.week); oppGames.set(r.opp, s); }
  const rate = Object.fromEntries(Object.entries(lg).map(([g, L]) => [g, { rush: L[0] ? L[1] / L[0] : 0.03, rec: L[2] ? L[3] / L[2] : 0.05 }]));
  // league TDs allowed per game by group
  const nOpp = [...oppGames.values()].reduce((a, s) => a + s.size, 0) || 1;
  const allowAvg = {};
  for (const g of Object.keys(lg)) { let t = 0; for (const [k, v] of oppAllowed) if (k.endsWith('|' + g)) t += v; allowAvg[g] = t / nOpp; }
  // team points per game this season (nflverse), for the scoring adjustment
  const pts = new Map();
  for (const h of histGames) { if (!h.done || h.season !== 2026 || h.week >= wk || h.game_type !== 'REG') continue;
    for (const [t, p] of [[h.home_team, h.home_score], [h.away_team, h.away_score]]) { const a = pts.get(t) ?? [0, 0]; a[0] += p; a[1]++; pts.set(t, a); } }
  return { byP, rate, oppAllowed, oppGames, allowAvg, teamLast, pts };
}

function lambda(m, players, pid, opp, implied) {
  const hist = (m.byP.get(pid) ?? []).sort((a, b) => b.week - a.week);
  if (!hist.length) return null;
  const team = hist[0].team;
  if (hist[0].week < (m.teamLast.get(team) ?? 0)) return null; // didn't play in his team's last game
  const g = GROUP(players[pid]?.[1]);
  const w = [4, 3, 2, 1]; let wc = 0, wt = 0, ws = 0;
  hist.slice(0, 4).forEach((r, i) => { wc += r.carries * w[i]; wt += r.targets * w[i]; ws += w[i]; });
  const eC = wc / ws, eT = wt / ws;
  const sC = hist.reduce((a, r) => a + r.carries, 0), sT = hist.reduce((a, r) => a + r.targets, 0);
  const sRT = hist.reduce((a, r) => a + r.rushing_tds, 0), sCT = hist.reduce((a, r) => a + r.receiving_tds, 0);
  const rRush = (sRT + K_RUSH * m.rate[g].rush) / (sC + K_RUSH);
  const rRec = g === 'QB' ? 0 : (sCT + K_REC * m.rate[g].rec) / (sT + K_REC);
  let lam = eC * rRush + eT * rRec;
  const tp = m.pts.get(team);
  const fTeam = implied && tp && tp[1] >= 3 ? Math.min(1.3, Math.max(0.75, implied / (tp[0] / tp[1]))) : 1;
  const og = m.oppGames.get(opp)?.size ?? 0, oa = m.oppAllowed.get(opp + '|' + g) ?? 0;
  const fOpp = m.allowAvg[g] ? ((oa + K_OPP * m.allowAvg[g]) / (og + K_OPP)) / m.allowAvg[g] : 1;
  lam *= fTeam * fOpp;
  return { lam, g, team, eC, eT, rRush, rRec, fTeam, fOpp, sRT, sCT, gp: hist.length, last: hist.slice(0, 4).map((r) => r.rushing_tds + (g === 'QB' ? 0 : r.receiving_tds)) };
}
const toP = (lam, cal = 1) => 1 - Math.exp(-lam * cal);

export async function render(el) {
  const st = { view: store.get('rz:view', 'board') };
  el.innerHTML = '<div class="loading">Reading the box scores…</div>';
  const [pb, h] = await Promise.all([blob('nfl_players_2026', 3 * 3600_000), nflHist()]);
  if (!pb) { el.innerHTML = '<div class="err">Player stats haven’t loaded yet. Check back in a few minutes.</div>'; return; }
  const { cols, rows: raw, players } = pb.data;
  const rows = raw.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const lastWeek = Math.max(...rows.map((r) => r.week));
  const histGames = h.games;
  const now = new Date();
  const live = await games({ league: 'nfl', from: new Date(now.getTime() - 5 * 3600e3).toISOString(), to: new Date(now.getTime() + 9 * 86400e3).toISOString() });

  // ---- backtest: each past week from earlier weeks only, against the closing line ----
  const groups = ['RB', 'WR', 'TE', 'QB'];
  const cal = Object.fromEntries(groups.map((g) => [g, { pred: 0, act: 0, n: 0, top: [0, 0] }]));
  const weekly = [], pairs = [];
  for (let wk = 4; wk <= lastWeek; wk++) {
    const m = buildModel(rows, players, histGames, wk);
    const gamesWk = histGames.filter((x) => x.season === 2026 && x.week === wk && x.game_type === 'REG' && x.done && x.spread_line !== null);
    let hit = 0, tot = 0;
    for (const gm of gamesWk) {
      for (const [team, opp, sideSign] of [[gm.home_team, gm.away_team, 1], [gm.away_team, gm.home_team, -1]]) {
        const implied = gm.total_line / 2 + sideSign * gm.spread_line / 2;
        const cand = [];
        for (const [pid] of m.byP) {
          const L = lambda(m, players, pid, opp, implied); if (!L || L.team !== team) continue; cand.push({ pid, L }); }
        cand.sort((a, b) => b.L.lam - a.L.lam);
        for (const { pid, L } of cand.slice(0, 6)) {
          const act = rows.find((r) => r.pid === pid && r.week === wk);
          if (!act) continue; // didn't play
          const scored = (act.rushing_tds + (L.g === 'QB' ? 0 : act.receiving_tds)) > 0 ? 1 : 0;
          const c = cal[L.g]; c.pred += toP(L.lam); c.act += scored; c.n++; pairs.push([L.g, toP(L.lam), scored]);
        }
        for (const { pid, L } of cand.slice(0, 2)) { const act = rows.find((r) => r.pid === pid && r.week === wk); if (!act) continue; const s = (act.rushing_tds + (L.g === 'QB' ? 0 : act.receiving_tds)) > 0; tot++; if (s) hit++; cal[L.g].top[0] += s ? 1 : 0; cal[L.g].top[1]++; }
      }
    }
    weekly.push({ wk, hit, tot });
  }
  // Calibration: fit forecasts to what happened across the whole range (logistic fit on the raw forecast, one offset per position).
  const lg = (p) => Math.log(Math.min(0.97, Math.max(0.02, p)) / (1 - Math.min(0.97, Math.max(0.02, p))));
  const fit = { a: { RB: 0, WR: 0, TE: 0, QB: 0 }, b: 1 };
  if (pairs.length > 150) {
    for (let it = 0; it < 600; it++) {
      const ga = { RB: 0, WR: 0, TE: 0, QB: 0 }; let gb = 0;
      for (const [g, p, y] of pairs) { const x = lg(p); const q = 1 / (1 + Math.exp(-(fit.a[g] + fit.b * x))); ga[g] += q - y; gb += (q - y) * x; }
      for (const g of groups) fit.a[g] -= 0.5 * ga[g] / pairs.length;
      fit.b -= 0.5 * gb / pairs.length;
    }
  }
  const calP = (g, p) => 1 / (1 + Math.exp(-(fit.a[g] + fit.b * lg(p))));
  // forecast vs actual by band, after calibration
  const bands = [[0, 0.15], [0.15, 0.25], [0.25, 0.35], [0.35, 0.45], [0.45, 1]].map(([lo, hi]) => { let n = 0, f = 0, a = 0; for (const [g, p, y] of pairs) { const c = calP(g, p); if (c >= lo && c < hi) { n++; f += c; a += y; } } return { lo, hi, n, f: n ? f / n : null, a: n ? a / n : null }; });
  // ---- this week ----
  const m = buildModel(rows, players, histGames, lastWeek + 1);
  const pre = live.filter((g) => g.state === 'pre' && g.week);
  const wk = Math.min(...pre.map((g) => g.week));
  const slate = pre.filter((g) => g.week === wk);
  const cards = slate.map((g) => {
    const hrow = histGames.find((x) => String(x.espn) === g.id);
    if (!hrow) return null;
    const tot = g.total !== null ? Number(g.total) : hrow.total_line, sp = g.spread_home !== null ? Number(g.spread_home) : (hrow.spread_line !== null ? -hrow.spread_line : null);
    const sides = [[hrow.home_team, hrow.away_team, tot !== null && sp !== null ? tot / 2 - sp / 2 : null, g.data.home], [hrow.away_team, hrow.home_team, tot !== null && sp !== null ? tot / 2 + sp / 2 : null, g.data.away]];
    const list = [];
    for (const [team, opp, implied, espnTeam] of sides) {
      for (const [pid] of m.byP) {
        const L = lambda(m, players, pid, opp, implied); if (!L || L.team !== team) continue;
        list.push({ pid, name: players[pid][0], pos: players[pid][1], shot: players[pid][2], L, p: calP(L.g, toP(L.lam)), implied, espnTeam, opp });
      }
    }
    list.sort((a, b) => b.p - a.p);
    return { g, top: list.slice(0, 4), next: list.slice(4, 7) };
  }).filter(Boolean);
  const locks = cards.map((c) => c.top[0]).filter(Boolean).sort((a, b) => b.p - a.p).slice(0, 5);
  const allTop2 = weekly.reduce((a, w) => ({ hit: a.hit + w.hit, tot: a.tot + w.tot }), { hit: 0, tot: 0 });

  const pCard = (x) => `<div class="row" style="justify-content:space-between;padding:7px 0;border-top:1px solid var(--line)">
    <span class="team">${x.shot ? `<img class="logo" style="width:30px;height:30px;border-radius:50%;object-fit:cover;background:var(--surface2)" src="${esc(x.shot)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span><b>${esc(x.name)}</b> <span class="dim">${esc(x.pos)} · ${esc(x.espnTeam.abbr)}</span>
      <div class="dim" style="font-size:12px">${x.L.eC >= 1 ? `${x.L.eC.toFixed(1)} carries` : ''}${x.L.eC >= 1 && x.L.eT >= 1 ? ' · ' : ''}${x.L.eT >= 1 ? `${x.L.eT.toFixed(1)} targets` : ''} · ${x.L.sRT + x.L.sCT} TD in ${x.L.gp} · last 4: ${x.L.last.join(', ')}</div></span></span>
    <span style="text-align:right"><b class="disp num" style="font-size:22px">${pct(x.p)}</b><div class="dim" style="font-size:11px">${x.L.fOpp > 1.1 ? 'soft defense' : x.L.fOpp < 0.9 ? 'tough defense' : ''}${x.L.fTeam > 1.1 ? ' · high total' : x.L.fTeam < 0.9 ? ' · low total' : ''}</div></span></div>`;

  function draw() {
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">NFL · Week ${Number.isFinite(wk) ? wk : ''}</div><h1>Redzone</h1><p>Anytime touchdown board: each player’s chance of scoring at least once, from his role, the matchup, and the game’s betting total.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How the board is built', `<ol>
      <li><b>Role:</b> carries and targets from his last four games, weighted toward the most recent.</li>
      <li><b>Finishing:</b> touchdowns per carry and per target this season, pulled toward his position’s average so one lucky week doesn’t dominate.</li>
      <li><b>Spot:</b> scaled by his team’s implied points from the DraftKings spread and total, and by how many touchdowns the defense allows to his position.</li>
      <li><b>Kept honest:</b> every past week is re-forecast using only earlier weeks, then the forecasts are fitted to what actually happened, so a 40% here has scored about 40% of the time (table below). QB passing touchdowns don’t count. Injury news isn’t included, so check status before you bet.</li></ol>`, 'rz')}
    <div class="grid g4">${groups.map((g) => { const c = cal[g]; return `<div class="card stat"><div class="k">${g}s, forecast vs actual</div><div class="v num">${c.n ? `${pct(c.pred / c.n)} → ${pct(c.act / c.n)}` : '—'}</div><div class="s">${c.n} player-games before calibration</div></div>`; }).join('')}</div>
    <div class="card" style="padding:4px 12px;margin-top:12px;overflow-x:auto"><table class="t"><tr><th>After calibration, forecast band</th><th class="r">Player-games</th><th class="r">Forecast</th><th class="r">Actually scored</th></tr>
      ${bands.map((b) => `<tr><td>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</td><td class="r num">${b.n}</td><td class="r num">${pct(b.f)}</td><td class="r num">${pct(b.a)}</td></tr>`).join('')}</table></div>
    <p class="stamp">Top two per team each week, weeks 4–${lastWeek}: ${allTop2.hit} of ${allTop2.tot} scored (${pct(allTop2.tot ? allTop2.hit / allTop2.tot : null)}). Stats through week ${lastWeek} (nflverse).</p>
    <div class="row" style="margin:14px 0">${seg('view', [['board', 'By game'], ['week', 'Week by week']], st.view)}</div>
    ${st.view === 'board' ? `
      ${locks.length ? `<div class="sec" style="margin-top:0"><h2>Best bets to score</h2><div class="grid g2">${locks.map((x) => `<div class="card hl">${pCard(x)}<div style="margin-top:6px"><button class="btn" data-copy="${esc(`${x.name} anytime TD`)}">Copy</button></div></div>`).join('')}</div></div>` : ''}
      <div class="sec"><h2>Every game</h2><div class="grid g2">${cards.map((c) => `<div class="card">
        <div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(c.g.data.away.short)} @ ${esc(c.g.data.home.short)}</span><span class="dim">${esc(fmtDay(c.g.start_time))} ${esc(fmtTime(c.g.start_time))}</span></div>
        <div class="dim" style="font-size:12px;margin:4px 0">O/U ${c.g.total ?? '—'} · ${esc(c.g.data.home.abbr)} ${c.g.spread_home ?? ''}</div>
        ${c.top.map(pCard).join('')}
        ${c.next.length ? `<div class="dim" style="font-size:12px;margin-top:8px">Next: ${c.next.map((x) => `${esc(x.name)} ${pct(x.p)}`).join(' · ')}</div>` : ''}
      </div>`).join('') || '<div class="empty">No games with lines yet this week.</div>'}</div></div>`
    : `<div class="sec"><h2>Week by week</h2><p class="sub">Top two forecasts per team, re-run each week with only earlier data.</p>
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>Week</th><th class="r">Scored</th><th class="r">Rate</th></tr>
      ${weekly.map((w) => `<tr><td>Week ${w.wk}</td><td class="r num">${w.hit} of ${w.tot}</td><td class="r num">${pct(w.tot ? w.hit / w.tot : null)}</td></tr>`).join('')}</table></div></div>`}
    ${footNote('Player stats: nflverse (open data), refreshed daily. Lines: DraftKings via ESPN. Estimates for entertainment, not a sportsbook price.')}`;
    onSeg(el, 'view', (v) => { st.view = v; store.set('rz:view', v); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); render(el); };
    el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(b.dataset.copy));
    wireHow(el);
  }
  draw();
}
