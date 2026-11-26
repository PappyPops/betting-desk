import { games, blob, api, esc, seg, onSeg, store, pct, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, copy } from './core.js?v=202611260323';
import { nflHist } from './hist.js?v=202611260323';
import { trackBtn } from './mybets.js?v=202611260323';
import { roundRobin, decOf, amOf } from './rr.js?v=202611260323';

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
  // touchdowns each defense has allowed per game, on the ground and through the air (all positions)
  const tdAllowed = new Map();
  for (const r of prior) { const a = tdAllowed.get(r.opp) ?? { rush: 0, rec: 0 }; a.rush += r.rushing_tds; a.rec += r.receiving_tds; tdAllowed.set(r.opp, a); }
  const def = new Map();
  for (const [t, a] of tdAllowed) { const n = oppGames.get(t)?.size || 1; def.set(t, { rush: a.rush / n, pass: a.rec / n }); }
  const rankOf = (key) => { const l = [...def.entries()].sort((x, y) => y[1][key] - x[1][key]); return new Map(l.map(([t], i) => [t, i + 1])); };
  return { byP, rate, oppAllowed, oppGames, allowAvg, teamLast, pts, def, defRank: { rush: rankOf('rush'), pass: rankOf('pass') }, nDef: def.size };
}

function lambda(m, players, pid, opp, implied, boost = null, back = null) {
  const hist = (m.byP.get(pid) ?? []).sort((a, b) => b.week - a.week);
  if (!hist.length) return null;
  const team = hist[0].team;
  // didn't play in his team's last game: out unless he's back this week (still on the roster, not on the injury report)
  if (hist[0].week < (m.teamLast.get(team) ?? 0) && !(back && back.has(pid) && hist.length >= 3 && (m.teamLast.get(team) - hist[0].week) <= 5)) return null;
  const g = GROUP(players[pid]?.[1]);
  const w = [4, 3, 2, 1]; let wc = 0, wt = 0, ws = 0;
  hist.slice(0, 4).forEach((r, i) => { wc += r.carries * w[i]; wt += r.targets * w[i]; ws += w[i]; });
  let eC = wc / ws, eT = wt / ws;
  if (boost) { eC += boost.c || 0; eT += boost.t || 0; }
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
  const recent = hist.slice(0, 3), recTD = recent.reduce((a, r) => a + r.rushing_tds + (g === 'QB' ? 0 : r.receiving_tds), 0);
  const recExp = recent.reduce((a, r) => a + r.carries * rRush + r.targets * rRec, 0);
  return { lam, g, team, eC, eT, rRush, rRec, fTeam, fOpp, sRT, sCT, gp: hist.length, recTD, recExp, scoredGames: hist.filter((r) => r.rushing_tds + (g === 'QB' ? 0 : r.receiving_tds) > 0).length,
    last: hist.slice(0, 4).map((r) => r.rushing_tds + (g === 'QB' ? 0 : r.receiving_tds)), boosted: !!boost };
}
const toP = (lam, cal = 1) => 1 - Math.exp(-lam * cal);

// Everything Redzone computes, shared with Redzone FIRST. Cached for five minutes.
let rzMemo = null, rzAt = 0;
export function redzoneData() {
  if (!rzMemo || Date.now() - rzAt > 300_000) { rzAt = Date.now(); rzMemo = buildRedzone().catch((e) => { rzMemo = null; throw e; }); }
  return rzMemo;
}
async function buildRedzone() {
  const [pb, h] = await Promise.all([blob('nfl_players_2026', 3 * 3600_000), nflHist()]);
  if (!pb) return null;
  const { cols, rows: raw, players } = pb.data;
  const rows = raw.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const lastWeek = Math.max(...rows.map((r) => r.week));
  const histGames = h.games;
  const now = new Date();
  const live = await games({ league: 'nfl', from: new Date(now.getTime() - 5 * 3600e3).toISOString(), to: new Date(now.getTime() + 9 * 86400e3).toISOString() });
  // injury report (ESPN, saved with the prop lines) and ESPN id -> nflverse id
  const [ctxRows, ath, tdRows] = await Promise.all([
    api('game_context?select=game_id,injuries&limit=500', { ttl: 600_000 }).catch(() => []),
    (async () => { const out = []; for (let off = 0; off < 8000; off += 1000) { const p = await api(`athletes?select=id,gsis,team&gsis=not.is.null&offset=${off}&limit=1000`, { ttl: 3600_000 }).catch(() => []); out.push(...p); if (p.length < 1000) break; } return out; })(),
    api('td_odds?select=game_id,athlete_id,american&american=not.is.null', { ttl: 300_000 }).catch(() => [])
  ]);
  const gsisOf = new Map(ath.map((a) => [String(a.id), a.gsis]));
  const espnOf = new Map(ath.map((a) => [a.gsis, String(a.id)]));
  const rosterTeam = new Map(ath.map((a) => [a.gsis, a.team]));
  const injBy = new Map(ctxRows.map((c) => [String(c.game_id), (c.injuries || []).map((x) => ({ ...x, gsis: gsisOf.get(String(x.id)) })).filter((x) => x.gsis)]));
  const OUT = /^(out|doubtful|injured reserve|ir|suspension|pup)/i;
  const tdOdds = new Map(tdRows.map((r) => [`${r.game_id}|${r.athlete_id}`, Number(r.american)]));

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
  // this week = the earliest week with a game not yet final; keep its started and finished games too (Redzone FIRST
  // marks touchdowns as they happen), Redzone itself shows only games still to finish
  const pre = live.filter((g) => g.state === 'pre' && g.week);
  const wk = Math.min(...live.filter((g) => g.state !== 'post' && g.week).map((g) => g.week));
  const slate = live.filter((g) => g.week === wk);
  const cards = slate.map((g) => {
    const hrow = histGames.find((x) => String(x.espn) === g.id);
    if (!hrow) return null;
    const tot = g.total !== null ? Number(g.total) : hrow.total_line, sp = g.spread_home !== null ? Number(g.spread_home) : (hrow.spread_line !== null ? -hrow.spread_line : null);
    const sides = [[hrow.home_team, hrow.away_team, tot !== null && sp !== null ? tot / 2 - sp / 2 : null, g.data.home], [hrow.away_team, hrow.home_team, tot !== null && sp !== null ? tot / 2 + sp / 2 : null, g.data.away]];
    const list = [];
    const inj = injBy.get(String(g.id)) || [];
    const status = new Map(inj.map((x) => [x.gsis, x]));
    for (const [team, opp, implied, espnTeam] of sides) {
      const base = [];
      // players back from a missed stretch: listed on this team and not on the injury report
      const back = new Set([...m.byP.keys()].filter((pid) => rosterTeam.get(pid) === team && !status.has(pid)));
      for (const [pid] of m.byP) { const L = lambda(m, players, pid, opp, implied, null, back); if (L && L.team === team) base.push({ pid, L: { ...L, returning: (m.byP.get(pid) ?? []).reduce((a2, r) => Math.max(a2, r.week), 0) < (m.teamLast.get(team) ?? 0) } }); }
      // players ruled out: their expected carries and targets move to healthy teammates at the same position
      const outs = base.filter((x) => OUT.test(status.get(x.pid)?.status || ''));
      const healthy = base.filter((x) => !OUT.test(status.get(x.pid)?.status || ''));
      const freed = {}; for (const o of outs) { const f = freed[o.L.g] ??= { c: 0, t: 0, who: [] }; f.c += o.L.eC; f.t += o.L.eT; f.who.push(players[o.pid][0]); }
      for (const x of healthy) {
        let L = x.L, boostNote = null;
        const f = freed[L.g];
        if (f && (f.c + f.t) >= 2) {
          const same = healthy.filter((y) => y.L.g === L.g), totC = same.reduce((a, y) => a + y.L.eC, 0) || 1, totT = same.reduce((a, y) => a + y.L.eT, 0) || 1;
          const add = { c: f.c * 0.7 * (L.eC / totC), t: f.t * 0.7 * (L.eT / totT) }; // 70%: some of the work goes to players not on this list
          if (add.c + add.t >= 0.5) { L = { ...lambda(m, players, x.pid, opp, implied, add, new Set([x.pid])), returning: x.L.returning }; boostNote = { names: f.who, add: add.c + add.t }; }
        }
        list.push({ pid: x.pid, name: players[x.pid][0], pos: players[x.pid][1], shot: players[x.pid][2], L, p: calP(L.g, toP(L.lam)), implied, espnTeam, opp, team, status: status.get(x.pid)?.status ?? null, boostNote, opImp: null });
      }
      // depth: rank among teammates at the same position by expected work
      const teamList = list.filter((y) => y.team === team);
      for (const y of teamList) { const same = teamList.filter((z) => z.L.g === y.L.g).sort((a, b2) => (b2.L.eC + b2.L.eT) - (a.L.eC + a.L.eT)); y.depth = same.indexOf(y) + 1;
        const tc = base.reduce((a2, z) => a2 + z.L.eC, 0), tt = base.reduce((a2, z) => a2 + z.L.eT, 0); y.shareC = tc ? y.L.eC / tc : 0; y.shareT = tt ? y.L.eT / tt : 0; }
    }
    list.sort((a, b) => b.p - a.p);
    for (const x of list) x._gid = g.id;
    for (const x of list) x.oppImp = sides.find((sd) => sd[0] === x.opp)?.[2] ?? null;
    const outsList = inj.filter((x) => OUT.test(x.status || '') && ['RB', 'WR', 'TE', 'QB'].includes(x.pos));
    return { g, hrow, sides, top: list.slice(0, 4), next: list.slice(4, 7), all: list, outsList };
  }).filter(Boolean);
  const locks = cards.filter((c) => c.g.state === 'pre').map((c) => c.top[0]).filter(Boolean).sort((a, b) => b.p - a.p).slice(0, 5);
  const allTop2 = weekly.reduce((a, w) => ({ hit: a.hit + w.hit, tot: a.tot + w.tot }), { hit: 0, tot: 0 });
  return { cards, locks, allTop2, weekly, cal, bands, fit, espnOf, tdOdds, lastWeek, wk, players, groups, m, pre, slate };
}

export async function render(el) {
  const st = { view: store.get('rz:view', 'board'), rr: { stake: store.get('rz:rrStake', 5), mode: store.get('rz:rrMode', 'all'), sel: new Set(store.get('rz:rrSel', [])), odds: new Map(Object.entries(store.get('rz:rrOdds', {})).map(([k, v]) => [k, Number(v)])) } };
  el.innerHTML = '<div class="loading">Reading the box scores…</div>';
  const D = await redzoneData();
  if (!D) { el.innerHTML = '<div class="err">Player stats haven’t loaded yet. Check back in a few minutes.</div>'; return; }
  const { locks, allTop2, weekly, cal, bands, fit, espnOf, tdOdds, lastWeek, wk, players, groups, m } = D;
  const cards = D.cards.filter((c) => c.g.state !== 'post');

  const byKey = new Map(); for (const c of cards) for (const x of c.all) byKey.set(`${c.g.id}|${x.pid}`, { x, c });
  // round robin candidates: players in games not yet started, with DraftKings' anytime price when the feed has it
  // round robin pool: every player 50%+ to score in a game that hasn't started. ESPN's free feed has no anytime
  // prices, so each one starts at an estimated typical book price (fair chance plus the usual ~12% margin), marked est.
  const estAm = (p) => amOf(1 / Math.min(0.95, p * 1.12));
  const rrPool = cards.filter((c) => c.g.state === 'pre').flatMap((c) => c.all.filter((x) => x.p >= 0.5).map((x) => {
    const am = tdOdds.get(`${c.g.id}|${espnOf.get(x.pid)}`) ?? null;
    return { x, c, key: `${c.g.id}|${x.pid}`, am, est: estAm(x.p) };
  })).sort((a, b) => b.x.p - a.x.p);
  const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  const calNote = (g) => { const c = cal[g]; if (!c.n) return ''; const d = c.act / c.n - c.pred / c.n; return Math.abs(d) < 0.015 ? '' : d < 0 ? `${g} forecasts have run high this season, so the chance is marked down.` : `${g} forecasts have run low this season, so the chance is marked up.`; };
  const conf = (x) => x.L.gp >= 6 && !x.boostNote && !x.status && !x.L.returning ? 'High' : x.L.gp < 3 || x.status ? 'Low' : 'Medium';
  const bars = (x) => {
    const touches = x.L.eC + x.L.eT;
    const fin = x.L.g === 'QB' ? x.L.rRush / (m.rate.QB.rush || 0.03) : (x.L.eC * x.L.rRush + x.L.eT * x.L.rRec) / Math.max(0.1, x.L.eC * m.rate[x.L.g].rush + x.L.eT * m.rate[x.L.g].rec);
    return [['Usage', Math.min(100, touches / 18 * 100), `${touches.toFixed(1)} expected touches`], ['Matchup', Math.max(0, Math.min(100, 50 + (x.L.fOpp - 1) * 125)), x.L.fOpp > 1.05 ? 'Softer than average' : x.L.fOpp < 0.95 ? 'Tougher than average' : 'About average'],
      ['Finishing', Math.max(0, Math.min(100, fin * 50)), `${x.L.sRT + x.L.sCT} TD on ${Math.round(x.L.eC * x.L.gp + x.L.eT * x.L.gp)} looks`], ['Script', Math.max(0, Math.min(100, (x.implied ?? 0) / 30 * 100)), x.implied ? `Implied ${x.implied.toFixed(1)}` : 'No line yet']];
  };
  function detail(x, c) {
    const d = m.def.get(x.opp), team = x.espnTeam.abbr, oppAbbr = (c.g.data.home.abbr === team ? c.g.data.away : c.g.data.home);
    const pos = x.L.g, depthWord = x.depth === 1 ? (pos === 'RB' ? 'Lead back' : pos === 'QB' ? 'Starter' : `${pos}1`) : `${pos}${x.depth}`;
    const share = pos === 'RB' || pos === 'QB' ? (x.shareC >= 0.1 ? `Handles ${Math.round(x.shareC * 100)}% of team carries. ` : '') : (x.shareT >= 0.08 ? `Gets ${Math.round(x.shareT * 100)}% of team targets. ` : '');
    const role = `Projected ${x.L.eC.toFixed(1)} carries and ${x.L.eT.toFixed(1)} targets. ${share}${depthWord} with ${x.L.sRT + x.L.sCT} score${x.L.sRT + x.L.sCT === 1 ? '' : 's'} in ${x.L.gp} games (${x.L.scoredGames} games with one).`;
    const ease = x.L.fOpp > 1.05 ? 'easier than a typical defense to score on' : x.L.fOpp < 0.95 ? 'harder than a typical defense to score on' : 'about average to score on';
    const matchup = d ? `${oppAbbr.short}: ${d.rush.toFixed(1)} rush TD/g allowed (${ord(m.defRank.rush.get(x.opp))}-most of ${m.nDef}), ${d.pass.toFixed(1)} pass TD/g (${ord(m.defRank.pass.get(x.opp))}-most). Against ${pos}s specifically, this is ${ease}.` : 'Not enough games to rate this defense yet.';
    const fav = c.g.spread_home === null ? '' : (() => { const sp = Number(c.g.spread_home) * (c.g.data.home.abbr === team ? 1 : -1); return sp < 0 ? ` ${x.espnTeam.short} are favored by ${-sp}.` : sp > 0 ? ` ${x.espnTeam.short} are getting ${sp}.` : ' Pick’em.'; })();
    const recent = x.L.recExp > 0.3 ? (x.L.recTD < x.L.recExp * 0.6 ? ' Recent weeks have been quieter than his role suggests.' : x.L.recTD > x.L.recExp * 1.6 ? ` Scored ${x.L.recTD} in his last three, ahead of what his role suggests.` : '') : '';
    const spot = `${x.L.returning ? 'Back after missing recent games; his role is projected from before he left, so treat it as a guess. ' : ''}${x.boostNote ? `${x.boostNote.names.join(' and ')} ${x.boostNote.names.length > 1 ? 'are' : 'is'} out, so about ${x.boostNote.add.toFixed(1)} more touches come his way. ` : ''}${x.implied ? `Implied team total ${x.implied.toFixed(1)}.` : ''}${fav}${recent} ${calNote(pos)}`.trim();
    const cf = conf(x);
    return `<div class="rz-ov" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px" data-close>
      <div class="card" style="max-width:640px;width:100%;margin:auto;padding:18px">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <span class="team">${x.shot ? `<img style="width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--surface2)" src="${esc(x.shot)}" alt="" referrerpolicy="no-referrer">` : ''}<span><b class="disp" style="font-size:22px">${esc(x.name)}</b><div class="dim" style="font-size:13px">${esc(x.pos)} · ${esc(team)} vs ${esc(oppAbbr.abbr)} · ${x.L.sRT + x.L.sCT} TD in ${x.L.gp}g${x.status ? ` · <span class="clay">${esc(x.status)}</span>` : ''}</div></span></span>
          <span style="text-align:right"><b class="disp num" style="font-size:40px;line-height:1">${pct(x.p)}</b><div class="dim" style="font-size:12px">${cf} confidence</div></span></div>
        <div style="font-size:14px;margin-top:14px;line-height:1.5">
          <p style="margin:0 0 8px"><span class="kicker" style="margin-right:6px">Role</span>${esc(role)}</p>
          <p style="margin:0 0 8px"><span class="kicker" style="margin-right:6px">Matchup</span>${esc(matchup)}</p>
          <p style="margin:0"><span class="kicker" style="margin-right:6px">Spot</span>${esc(spot)}</p></div>
        <div class="grid g4" style="margin-top:14px;gap:10px">${bars(x).map(([k, v, sub]) => `<div><div class="row" style="justify-content:space-between;font-size:12px"><span class="dim">${k}</span><b class="num">${Math.round(v)}</b></div>
          <div style="height:6px;background:var(--line2);border-radius:3px;margin:4px 0"><div style="height:6px;width:${v}%;background:var(--ink);border-radius:3px"></div></div><div class="dim" style="font-size:11.5px">${esc(sub)}</div></div>`).join('')}</div>
        <div class="dim" style="font-size:12px;margin-top:10px">Last 4 games: ${x.L.last.join(', ')} TD. Confidence is High with 6+ games and a steady role, Low with under 3 games, an injury tag, or a role that just changed.</div>
        <div class="row" style="gap:8px;margin-top:14px;justify-content:flex-end">${trackBtn({ gid: String(c.g.id), market: 'prop', aid: espnOf.get(x.pid) ?? '', stat: 'td', side: 'over', line: 0.5, name: x.name, game: `${c.g.data.away.short} @ ${c.g.data.home.short}`, start: c.g.start_time, tool: 'Redzone', gsis: x.pid })}<button class="btn" data-copy="${esc(`${x.name} anytime TD`)}">Copy</button><button class="btn" data-close>Close</button></div>
      </div></div>`;
  }
  const pCard = (x) => `<div class="row" data-rz="${esc(`${x._gid}|${x.pid}`)}" style="justify-content:space-between;padding:7px 0;border-top:1px solid var(--line);cursor:pointer" title="Tap for the breakdown">
    <span class="team">${x.shot ? `<img class="logo" style="width:30px;height:30px;border-radius:50%;object-fit:cover;background:var(--surface2)" src="${esc(x.shot)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span><b>${esc(x.name)}</b> <span class="dim">${esc(x.pos)} · ${esc(x.espnTeam.abbr)}</span>
      ${x.status ? ` <span class="chip clay" style="font-size:10px">${esc(x.status)}</span>` : ''}${x.boostNote ? ' <span class="chip gold" style="font-size:10px">more work</span>' : ''}${x.L.returning ? ' <span class="chip" style="font-size:10px">back</span>' : ''}<div class="dim" style="font-size:12px">${x.L.eC >= 1 ? `${x.L.eC.toFixed(1)} carries` : ''}${x.L.eC >= 1 && x.L.eT >= 1 ? ' · ' : ''}${x.L.eT >= 1 ? `${x.L.eT.toFixed(1)} targets` : ''} · ${x.L.sRT + x.L.sCT} TD in ${x.L.gp} · last 4: ${x.L.last.join(', ')}</div></span></span>
    <span style="text-align:right"><b class="disp num" style="font-size:22px">${pct(x.p)}</b><div class="dim" style="font-size:11px">${x.L.fOpp > 1.1 ? 'soft defense' : x.L.fOpp < 0.9 ? 'tough defense' : ''}${x.L.fTeam > 1.1 ? ' · high total' : x.L.fTeam < 0.9 ? ' · low total' : ''}</div></span></div>`;

  const money = (v) => `$${v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;
  const RRMODES = (n) => [['all', 'Everything'], ['par', 'Parlays (2s up)'], ...Array.from({ length: n - 2 }, (_, i) => [`k${i + 2}`, `By ${i + 2}s`]), [`k${n}`, `Full ${n}-leg`]];
  const sizesFor = (mode, n) => mode === 'all' ? Array.from({ length: n }, (_, i) => i + 1) : mode === 'par' ? Array.from({ length: n - 1 }, (_, i) => i + 2) : [Number(mode.slice(1))];
  function rrHtml() {
    const R = st.rr; if (!rrPool.length) return '';
    for (const k of [...R.sel]) if (!rrPool.some((r) => r.key === k)) R.sel.delete(k); // drop players whose game started
    const priceOf = (r) => R.odds.get(r.key) ?? r.am ?? r.est;
    const legs = rrPool.filter((r) => R.sel.has(r.key)).map((r) => ({ ...r, dec: decOf(priceOf(r)), priced: R.odds.has(r.key) || r.am !== null }));
    const n = legs.length;
    let mode = R.mode; if (n < 2) mode = 'all'; else if (/^k/.test(mode) && Number(mode.slice(1)) > n) mode = `k${n}`;
    const res = n ? roundRobin(legs.map((l) => ({ p: l.x.p, dec: l.dec })), sizesFor(mode, n), R.stake) : null;
    const compare = n >= 2 ? RRMODES(n).map(([k, lab]) => ({ k, lab, r: roundRobin(legs.map((l) => ({ p: l.x.p, dec: l.dec })), sizesFor(k, n), R.stake) })) : [];
    const unpriced = legs.filter((l) => !l.priced).length;
    const opts = rrPool.filter((r) => !R.sel.has(r.key));
    return `<div class="sec"><h2>Round robin builder</h2><p class="sub">Pick the players you like from everyone 50%+ to score this week, set the dollars per bet, and see what each outcome pays. Prices start as estimates (est.); type your book’s price for the exact return.</p>
      <div class="card">
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <select data-rr="add" style="background:var(--surface2);color:inherit;border:1px solid var(--line2);border-radius:6px;padding:5px 8px;max-width:100%" ${R.sel.size >= 8 ? 'disabled' : ''}>
            <option value="">${R.sel.size >= 8 ? '8 players max' : `Add a player (${opts.length} at 50%+)…`}</option>
            ${opts.map((r) => `<option value="${esc(r.key)}">${esc(r.x.name)} · ${esc(r.x.pos)} ${esc(r.x.espnTeam.abbr)} · ${pct(r.x.p)} · ${r.am !== null ? (r.am > 0 ? '+' : '') + r.am : `est. ${r.est > 0 ? '+' : ''}${r.est}`}</option>`).join('')}</select>
          <span class="dim" style="font-size:13px">$ per bet</span><input data-rr="stake" class="num" value="${R.stake}" style="width:64px;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:3px 6px">
          ${R.sel.size ? '<button class="btn" data-rr="clear" style="padding:3px 10px;font-size:12px">Clear</button>' : ''}</div>
        ${legs.length ? `<div style="overflow-x:auto"><table class="t"><tr><th>Player</th><th class="r">Chance</th><th class="r">Fair</th><th class="r">Price</th><th class="r">Value</th><th></th></tr>
        ${legs.map((r) => { const am = priceOf(r), ev = r.x.p * decOf(am) - 1; return `<tr>
          <td><b>${esc(r.x.name)}</b> <span class="dim" style="font-size:12px">${esc(r.x.pos)} · ${esc(r.c.g.data.away.abbr)} @ ${esc(r.c.g.data.home.abbr)}</span></td>
          <td class="r num">${pct(r.x.p)}</td><td class="r num dim">${amOf(1 / r.x.p) > 0 ? '+' : ''}${amOf(1 / r.x.p)}</td>
          <td class="r" style="white-space:nowrap">${r.priced ? '' : '<span class="dim" style="font-size:11px">est.</span> '}<input data-rrodds="${esc(r.key)}" class="num" value="${am > 0 ? '+' + am : am}" style="width:62px;text-align:right;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:2px 5px"></td>
          <td class="r num ${r.priced ? (ev > 0 ? 'mint' : 'clay') : 'dim'}">${ev > 0 ? '+' : ''}${Math.round(ev * 100)}%</td>
          <td class="r"><button class="btn" data-rrdel="${esc(r.key)}" style="padding:2px 8px;font-size:12px">✕</button></td></tr>`; }).join('')}</table></div>
        ${legs.length >= 2 && new Set(legs.map((l) => l.c.g.id)).size < legs.length ? '<p class="clay" style="font-size:12.5px;margin:8px 0 0">⚠ Two players from the same game tend to score (or not) together, so the real chance of both is a bit different from what’s shown.</p>' : ''}
        ${unpriced ? `<p class="dim" style="font-size:12.5px;margin:8px 0 0">${unpriced} price${unpriced > 1 ? 's are' : ' is an'} estimate${unpriced > 1 ? 's' : ''} (a typical book price for that chance), so the results show the usual book edge, not a real one. Type your book’s price to see the true return; anything longer than Fair is value.</p>` : ''}` : '<p class="dim" style="font-size:13px;margin:4px 0 0">Add players from the list to build the ticket. Up to 8.</p>'}
      </div>
      ${n >= 1 ? `<div class="grid g2" style="margin-top:12px">
        <div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><b>${n} legs</b>${n >= 2 ? seg('rrMode', RRMODES(n), mode) : ''}</div>
          <div class="grid g3" style="margin:10px 0"><div class="stat"><div class="k">Bets · cost</div><div class="v num" style="font-size:20px">${res.bets} · ${money(res.cost)}</div></div>
            <div class="stat"><div class="k">Expected return</div><div class="v num" style="font-size:20px">${money(res.er)}</div></div>
            <div class="stat"><div class="k">Expected profit</div><div class="v num ${res.ev >= 0 ? 'mint' : 'clay'}" style="font-size:20px">${res.ev >= 0 ? '+' : '−'}${money(Math.abs(res.ev))}</div><div class="s">${res.ev >= 0 ? '+' : ''}${(res.ev / res.cost * 100).toFixed(1)}% of cost</div></div></div>
          <table class="t"><tr><th>Legs that score</th><th class="r">Chance</th><th class="r">Pays</th><th class="r">Profit</th></tr>
          ${res.byHits.map((h, k) => ({ h, k })).reverse().map(({ h, k }) => `<tr><td>${k === n ? `All ${n}` : k}</td><td class="r num">${pct(h.prob, h.prob < 0.01 ? 1 : 0)}</td><td class="r num">${money(h.pay)}</td><td class="r num ${h.pay - res.cost >= 0 ? 'mint' : 'clay'}">${h.pay - res.cost >= 0 ? '+' : '−'}${money(Math.abs(h.pay - res.cost))}</td></tr>`).join('')}</table>
          <p class="dim" style="font-size:12px;margin:6px 0 0">“Pays” is the average payout when exactly that many score, weighted by which players are likeliest to be the ones who do.</p></div>
        ${compare.length ? `<div class="card"><b>Every way to bet these ${n}</b><table class="t" style="margin-top:8px"><tr><th>Ticket</th><th class="r">Bets</th><th class="r">Cost</th><th class="r">Expected return</th><th class="r">Edge</th></tr>
          ${compare.map(({ k, lab, r }) => `<tr style="${k === mode ? 'background:#f0b42914' : ''}"><td>${esc(lab)}</td><td class="r num">${r.bets}</td><td class="r num">${money(r.cost)}</td><td class="r num">${money(r.er)}</td><td class="r num ${r.ev >= 0 ? 'mint' : 'clay'}">${r.ev >= 0 ? '+' : ''}${(r.ev / r.cost * 100).toFixed(1)}%</td></tr>`).join('')}</table>
          <p class="dim" style="font-size:12px;margin:6px 0 0">Bigger parlays multiply each leg’s edge, good or bad: if most legs are priced below their chance, the full parlay loses the most; if they’re priced above it, it gains the most, with far more variance.</p></div>` : ''}
      </div>` : ''}</div>`;
  }
  function wireRR() {
    const R = st.rr;
    const saveSel = () => { store.set('rz:rrSel', [...R.sel]); store.set('rz:rrOdds', Object.fromEntries(R.odds)); };
    onSeg(el, 'rrMode', (v) => { R.mode = v; store.set('rz:rrMode', v); draw(); });
    const add = el.querySelector('[data-rr=add]'); if (add) add.onchange = () => { if (add.value && R.sel.size < 8) { R.sel.add(add.value); saveSel(); } draw(); };
    el.querySelectorAll('[data-rrdel]').forEach((b) => b.onclick = () => { R.sel.delete(b.dataset.rrdel); saveSel(); draw(); });
    el.querySelector('[data-rr=clear]')?.addEventListener('click', () => { R.sel.clear(); saveSel(); draw(); });
    el.querySelectorAll('[data-rrodds]').forEach((b) => b.onchange = () => { const v = Number(String(b.value).replace(/[^0-9+-]/g, '')); if (Number.isFinite(v) && Math.abs(v) >= 100) R.odds.set(b.dataset.rrodds, v); else R.odds.delete(b.dataset.rrodds); saveSel(); draw(); });
    const sk = el.querySelector('[data-rr=stake]'); if (sk) sk.onchange = () => { const v = Number(sk.value); if (v > 0) { R.stake = v; store.set('rz:rrStake', v); } draw(); };
  }
  function draw() {
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">NFL · Week ${Number.isFinite(wk) ? wk : ''}</div><h1>Redzone</h1><p>Anytime touchdown board: each player’s chance of scoring at least once, from his role, the matchup, and the game’s betting total.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How the board is built', `<ol>
      <li><b>Role:</b> carries and targets from his last four games, weighted toward the most recent.</li>
      <li><b>Finishing:</b> touchdowns per carry and per target this season, pulled toward his position’s average so one lucky week doesn’t dominate.</li>
      <li><b>Spot:</b> scaled by his team’s implied points from the DraftKings spread and total, and by how many touchdowns the defense allows to his position.</li>
      <li><b>Injuries:</b> players ESPN lists as out or doubtful are dropped, and 70% of their expected carries and targets move to healthy teammates at the same position. Questionable players stay on with a tag.</li>
      <li><b>Tap any player</b> for the full breakdown: role, matchup, spot, and four 0–100 bars (usage, matchup, finishing, script).</li>
      <li><b>Kept honest:</b> every past week is re-forecast using only earlier weeks, then the forecasts are fitted to what actually happened, so a 40% here has scored about 40% of the time (table below). QB passing touchdowns don’t count. Injury news isn’t included, so check status before you bet.</li></ol>`, 'rz')}
    <div class="grid g4">${groups.map((g) => { const c = cal[g]; return `<div class="card stat"><div class="k">${g}s, forecast vs actual</div><div class="v num">${c.n ? `${pct(c.pred / c.n)} → ${pct(c.act / c.n)}` : '—'}</div><div class="s">${c.n} player-games before calibration</div></div>`; }).join('')}</div>
    <div class="card" style="padding:4px 12px;margin-top:12px;overflow-x:auto"><table class="t"><tr><th>After calibration, forecast band</th><th class="r">Player-games</th><th class="r">Forecast</th><th class="r">Actually scored</th></tr>
      ${bands.map((b) => `<tr><td>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</td><td class="r num">${b.n}</td><td class="r num">${pct(b.f)}</td><td class="r num">${pct(b.a)}</td></tr>`).join('')}</table></div>
    <p class="stamp">Top two per team each week, weeks 4–${lastWeek}: ${allTop2.hit} of ${allTop2.tot} scored (${pct(allTop2.tot ? allTop2.hit / allTop2.tot : null)}). Stats through week ${lastWeek} (nflverse).</p>
    <div class="row" style="margin:14px 0">${seg('view', [['board', 'By game'], ['week', 'Week by week']], st.view)}</div>
    ${st.view === 'board' ? `
      ${rrHtml()}
      <div class="sec"><h2>Every game</h2><div class="grid g2">${cards.map((c) => `<div class="card">
        <div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(c.g.data.away.short)} @ ${esc(c.g.data.home.short)}</span><span class="dim">${esc(fmtDay(c.g.start_time))} ${esc(fmtTime(c.g.start_time))}</span></div>
        <div class="dim" style="font-size:12px;margin:4px 0">O/U ${c.g.total ?? '—'} · ${esc(c.g.data.home.abbr)} ${c.g.spread_home ?? ''}${c.sides[0][2] !== null ? ` · implied ${esc(c.g.data.away.abbr)} ${c.sides[1][2].toFixed(1)}, ${esc(c.g.data.home.abbr)} ${c.sides[0][2].toFixed(1)}` : ''}</div>
        <div class="dim" style="font-size:11.5px;margin-bottom:4px">${[[c.g.data.away.abbr, c.hrow.away_team], [c.g.data.home.abbr, c.hrow.home_team]].map(([ab, t]) => { const d = m.def.get(t); return d ? `${esc(ab)} D allows ${d.rush.toFixed(1)} rush / ${d.pass.toFixed(1)} pass TD a game` : ''; }).filter(Boolean).join(' · ')}${c.outsList.length ? ` · <span class="clay">Out: ${c.outsList.slice(0, 4).map((o) => esc(o.name)).join(', ')}${c.outsList.length > 4 ? '…' : ''}</span>` : ''}</div>
        ${c.top.map(pCard).join('')}
        ${c.next.length ? `<div class="dim" style="font-size:12px;margin-top:8px">Next: ${c.next.map((x) => `${esc(x.name)} ${pct(x.p)}`).join(' · ')}</div>` : ''}
      </div>`).join('') || '<div class="empty">No games with lines yet this week.</div>'}</div></div>`
    : `<div class="sec"><h2>Week by week</h2><p class="sub">Top two forecasts per team, re-run each week with only earlier data.</p>
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>Week</th><th class="r">Scored</th><th class="r">Rate</th></tr>
      ${weekly.map((w) => `<tr><td>Week ${w.wk}</td><td class="r num">${w.hit} of ${w.tot}</td><td class="r num">${pct(w.tot ? w.hit / w.tot : null)}</td></tr>`).join('')}</table></div></div>`}
    ${footNote('Player stats: nflverse (open data), refreshed daily. Lines: DraftKings via ESPN. Estimates for entertainment, not a sportsbook price.')}`;
    onSeg(el, 'view', (v) => { st.view = v; store.set('rz:view', v); draw(); });
    if (st.view === 'board') wireRR();
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); render(el); };
    el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(b.dataset.copy));
    el.querySelectorAll('[data-rz]').forEach((r) => r.onclick = () => {
      const hit = byKey.get(r.dataset.rz); if (!hit) return;
      const box = document.createElement('div'); box.innerHTML = detail(hit.x, hit.c); const ov = box.firstElementChild; el.appendChild(ov);
      const close = () => { ov.remove(); document.removeEventListener('keydown', esc_); };
      const esc_ = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', esc_);
      ov.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', (e) => { if (e.target === b) close(); }));
      ov.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(b.dataset.copy));
    });
    wireHow(el);
  }
  draw();
}
