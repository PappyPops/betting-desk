import { games as loadGames, esc, seg, onSeg, store, pct, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, logo } from './core.js?v=202611201526';
import { nflHist } from './hist.js?v=202611201526';
import { makeContext, parseSystem, matchSystem, gradePick, pickLabel } from './systems.js?v=202611201526';
import { RESEARCH, gradeResearch, researchLabel, BREAK_EVEN, nbaGames } from './research.js?v=202611201526';

const NFL_IN_RECORD = (g) => g.season < 2026 || (g.season === 2026 && g.week <= 9); // original NFL records run through 2026 week 9
const CFB_FROM_WEEK = 5; // original college records run through 2026 week 4
const rec = (r) => r.w + r.l ? `${r.w}–${r.l}${r.p ? '–' + r.p : ''}` : '—';
const rate = (r) => r.w + r.l ? r.w / (r.w + r.l) : null;
const BE = 110 / 210;

let dataMemo = null;
async function systemsFile() {
  if (!dataMemo) { const r = await fetch('data/matrix-systems.json'); if (!r.ok) throw new Error('Matrix systems file missing'); dataMemo = await r.json(); }
  return dataMemo;
}

function nflGames(hist, liveById) {
  return hist.games.filter((h) => h.game_type === 'REG').map((h) => {
    const lv = h.espn ? liveById.get(String(h.espn)) : null;
    const pre = !h.done;
    const ml = (v) => v != null && Math.abs(v) >= 100 ? v : null;
    return {
      id: `${h.season}_${h.week}_${h.away_team}_${h.home_team}`, espn: h.espn, season: h.season, week: h.week, date: h.gameday, weekday: h.weekday, time: h.gametime || '',
      home: h.home_team, away: h.away_team, home_score: h.home_score, away_score: h.away_score,
      home_spread: pre && lv?.spread_home != null ? Number(lv.spread_home) : h.hspread, total: pre && lv?.total != null ? Number(lv.total) : h.total_line,
      home_ml: pre && lv?.ml_home != null ? lv.ml_home : ml(h.home_moneyline), away_ml: pre && lv?.ml_away != null ? lv.ml_away : ml(h.away_moneyline),
      div: h.div_game === 1, neutral: h.location === 'Neutral', home_rest: h.home_rest, away_rest: h.away_rest, temp: h.temp, roof: h.roof, surface: h.surface, wind: h.wind,
      overtime: h.overtime === 1, home_qb: h.home_qb_id, away_qb: h.away_qb_id, home_coach: h.home_coach, away_coach: h.away_coach, final: h.done, live: lv,
    };
  });
}
function cfbGames(rows) {
  const et = (iso, o) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', ...o }).format(new Date(iso));
  return rows.map((r) => {
    const fin = r.state === 'post', pre = r.state === 'pre';
    const sp = fin ? (r.close_spread_home != null ? Number(r.close_spread_home) : null) : pre && r.spread_home != null ? Number(r.spread_home) : null;
    const tot = fin ? (r.close_total > 0 ? Number(r.close_total) : null) : pre && r.total != null ? Number(r.total) : null;
    return {
      id: r.id, espn: r.id, season: 2026, week: r.week, date: et(r.start_time, { year: 'numeric', month: '2-digit', day: '2-digit' }), weekday: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date(r.start_time)),
      time: et(r.start_time, { hour: '2-digit', minute: '2-digit', hour12: false }), home: r.home, away: r.away, home_score: r.home_score, away_score: r.away_score,
      home_spread: sp, total: tot, conf: !!r.data?.conf, neutral: !!r.data?.neutral, final: fin && r.home_score != null, live: r,
    };
  });
}

let mxMemo = null, mxAt = 0;
// Everything the Matrix computes, shared with the Today page's best bets. Cached for five minutes.
export function matrixData() {
  if (!mxMemo || Date.now() - mxAt > 300_000) { mxAt = Date.now(); mxMemo = buildMatrix().catch((e) => { mxMemo = null; throw e; }); }
  return mxMemo;
}
async function buildMatrix() {
  const now = new Date();
  const [file, hist, nflLive, cfbRows, nbaRows] = await Promise.all([
    systemsFile(), nflHist(),
    loadGames({ league: 'nfl', from: new Date(now.getTime() - 6 * 3600e3).toISOString(), to: new Date(now.getTime() + 12 * 86400e3).toISOString() }),
    loadGames({ league: 'cfb', from: '2026-08-01', ttl: 300_000 }),
    loadGames({ league: 'nba', from: '2026-10-20', ttl: 300_000 }),
  ]);
  await new Promise((r) => setTimeout(r, 0));
  const liveById = new Map(nflLive.map((g) => [g.id, g]));
  const NG = nflGames(hist, liveById), CG = cfbGames(cfbRows);
  const ctx = { NFL: makeContext(NG, 'nfl'), NCAAF: makeContext(CG, 'cfb') };
  const systems = file.systems.map((s) => ({ ...s, parsed: parseSystem(s) }));
  const caches = { NFL: new Map(), NCAAF: new Map() };

  // ---- self-check: rebuild every NFL record and compare with the original ----
  let exact = 0, close = 0, checked = 0;
  const nflIn = NG.filter((g) => g.final && NFL_IN_RECORD(g));
  for (const s of systems.filter((x) => x.league === 'NFL')) {
    const r = { w: 0, l: 0, p: 0 }; let ok = true;
    for (const g of nflIn) { const m = matchSystem(ctx.NFL, s, s.parsed, g, caches.NFL); if (m === undefined) { ok = false; break; } if (!m) continue; const gr = gradePick(g, m); if (gr === 'win') r.w++; else if (gr === 'loss') r.l++; else if (gr === 'push') r.p++; }
    if (!ok) continue; checked++;
    s.rebuilt = r;
    const d = Math.abs(r.w - s.record.w) + Math.abs(r.l - s.record.l);
    if (d === 0) exact++; else { if (d <= Math.max(2, 0.05 * (s.record.w + s.record.l))) close++; else console.debug('matrix rebuild differs', s.key, s.record, r); }
  }

  // ---- since found: every game after the records were built ----
  const after = { NFL: NG.filter((g) => g.final && !NFL_IN_RECORD(g) && g.season === 2026), NCAAF: CG.filter((g) => g.final && g.week >= CFB_FROM_WEEK && g.home_spread != null) };
  const sinceAll = { NFL: { w: 0, l: 0, p: 0 }, NCAAF: { w: 0, l: 0, p: 0 } }, sinceBadged = { NFL: { w: 0, l: 0, p: 0 }, NCAAF: { w: 0, l: 0, p: 0 } };
  for (const s of systems) {
    s.since = { w: 0, l: 0, p: 0, games: [] };
    for (const g of after[s.league]) {
      const m = matchSystem(ctx[s.league], s, s.parsed, g, caches[s.league]); if (!m) continue;
      const gr = gradePick(g, m); if (!gr) continue;
      s.since[gr === 'win' ? 'w' : gr === 'loss' ? 'l' : 'p']++;
      s.since.games.push({ g, m, gr });
      const t = sinceAll[s.league]; t[gr === 'win' ? 'w' : gr === 'loss' ? 'l' : 'p']++;
      if (s.qualified) { const b = sinceBadged[s.league]; b[gr === 'win' ? 'w' : gr === 'loss' ? 'l' : 'p']++; }
    }
  }
  const cfbWeeks = [...new Set(after.NCAAF.map((g) => g.week))].sort((a, b) => a - b);
  const nflWeeks = [...new Set(after.NFL.map((g) => g.week))].sort((a, b) => a - b);

  // ---- research systems: graded before and after they were published ----
  const NB = nbaGames(nbaRows);
  const pool = { NFL: NG.filter((g) => g.final), NBA: NB.filter((g) => g.final) };
  const blank = () => ({ w: 0, l: 0, p: 0, u: 0, n: 0 });
  for (const r of RESEARCH) {
    r.before = blank(); r.after = blank(); r.now = blank();
    for (const g of pool[r.league]) {
      const m = r.pick(g); if (!m) continue;
      const gr = gradeResearch(g, m, gradePick); if (!gr) continue;
      const o = m.kind === 'moneyline' ? (m.side === 'home' ? g.home_ml : g.away_ml) : null;
      const units = gr === 'win' ? (o ? (o > 0 ? o / 100 : 100 / -o) : 100 / 110) : gr === 'loss' ? -1 : 0;
      const buckets = r.league === 'NBA' ? [r.now] : [g.season < r.year ? r.before : r.after, ...(g.season === 2026 ? [r.now] : [])];
      for (const b of buckets) { b[gr === 'win' ? 'w' : gr === 'loss' ? 'l' : 'p']++; b.u += units; if (gr !== 'push') b.n++; }
    }
  }
  const researchUpcoming = { NFL: [], NBA: NB.filter((g) => g.live.state === 'pre' && new Date(g.live.start_time).getTime() < now.getTime() + 2 * 86400e3) };

  // ---- this week ----
  const upcoming = {
    NFL: (() => { const u = NG.filter((g) => !g.final && g.season === 2026 && g.home_spread != null && (!g.live || g.live.state === 'pre') && g.date >= new Date(now.getTime() - 86400e3).toISOString().slice(0, 10)); const wk = Math.min(...u.map((g) => g.week)); return u.filter((g) => g.week === wk); })(),
    NCAAF: CG.filter((g) => g.live.state === 'pre' && g.home_spread != null && new Date(g.live.start_time).getTime() < now.getTime() + 7 * 86400e3),
  };
  const boards = {};
  for (const lg of ['NFL', 'NCAAF']) {
    boards[lg] = upcoming[lg].map((g) => {
      const hits = [];
      for (const s of systems.filter((x) => x.league === lg)) { const m = matchSystem(ctx[lg], s, s.parsed, g, caches[lg]); if (m) hits.push({ s, m, label: pickLabel(g, m) }); }
      const byPick = new Map(); for (const h of hits) { const k = h.label; if (!byPick.has(k)) byPick.set(k, []); byPick.get(k).push(h); }
      const rhits = lg === 'NFL' ? RESEARCH.filter((r) => r.league === 'NFL').map((r) => ({ r, m: r.pick(g) })).filter((x) => x.m).map((x) => ({ ...x, label: researchLabel(g, x.m, pickLabel) })) : [];
      return { g, hits, rhits, picks: [...byPick.entries()].sort((a, b) => b[1].length - a[1].length) };
    }).sort((a, b) => (a.g.date + a.g.time).localeCompare(b.g.date + b.g.time));
  }

  return { now, file, hist, NG, CG, NB, ctx, systems, caches, exact, close, checked, sinceAll, sinceBadged, cfbWeeks, nflWeeks, researchUpcoming, upcoming, boards };
}

export async function render(el) {
  const st = { tab: store.get('mx2:tab', 'week'), lg: store.get('mx2:lg', 'NFL'), kind: 'all', tier: 'all', q: '', open: null };
  el.innerHTML = '<div class="loading">Loading 464 systems and rebuilding every rule…</div>';
  const { now, file, hist, NG, CG, NB, ctx, systems, caches, exact, close, checked, sinceAll, sinceBadged, cfbWeeks, nflWeeks, researchUpcoming, upcoming, boards } = await matrixData();

  function sysRow(s) {
    const r = s.record, sr = rate(s.since);
    return `<tr class="click" data-sys="${esc(s.id)}"><td>${s.qualified ? '<span class="chip gold">Badged</span> ' : ''}${s.fade ? '<span class="chip clay">Fade</span> ' : ''}${s.priced ? '<span class="chip">ML</span> ' : ''}${esc(s.name)}</td>
      <td class="r num">${rec(r)}<div class="dim" style="font-size:12px">${pct(s.rate, 1)}</div></td>
      <td class="r num ${s.since.w + s.since.l ? (sr > BE ? 'mint' : 'clay') : 'dim'}">${rec(s.since)}${s.since.w + s.since.l ? `<div style="font-size:12px">${pct(sr, 0)}</div>` : ''}</td></tr>
      ${st.open === s.id ? `<tr><td colspan="3" style="background:var(--surface2)"><div class="muted" style="font-size:13px;margin-bottom:6px">${esc(s.rule)}</div>
        ${s.since.games.length ? `<div class="kicker" style="color:var(--muted);margin:6px 0">Since it was found</div>${s.since.games.slice(-12).reverse().map(({ g, m, gr }) => `<div style="font-size:12.5px">${esc(g.date)} · ${esc(g.away)} ${g.away_score} @ ${esc(g.home)} ${g.home_score} · ${esc(pickLabel(g, m))} <b class="${gr === 'win' ? 'mint' : gr === 'loss' ? 'clay' : ''}">${gr}</b></div>`).join('')}` : ''}
        <div class="kicker" style="color:var(--muted);margin:8px 0 4px">Recent games in the record</div>${(s.history || []).slice(0, 8).map((x) => `<div style="font-size:12.5px">${esc(x.date)} · ${esc(x.matchup)} · ${esc(x.pick)} <b class="${x.result === 'win' ? 'mint' : x.result === 'loss' ? 'clay' : ''}">${x.result}</b>${x.score ? ` <span class="dim">(${esc(x.score)})</span>` : ''}</div>`).join('')}
        ${s.rebuilt ? `<div class="dim" style="font-size:12px;margin-top:6px">Rebuilt here from nflverse: ${rec(s.rebuilt)} (original record: ${rec(s.record)}).</div>` : ''}</td></tr>` : ''}`;
  }

  const resRec = (b) => b.w + b.l ? `${b.w}–${b.l}${b.p ? '–' + b.p : ''}` : '—';
  const resRate = (b) => b.w + b.l ? b.w / (b.w + b.l) : null;
  function verdict(r) {
    const a = r.after, be = BREAK_EVEN[r.kind];
    if (r.kind === 'moneyline') { if (a.n < 150) return ['Too few games yet', '']; const roi = a.u / a.n; return roi > 0.02 ? ['Holding up', 'mint'] : roi > -0.02 ? ['About even', ''] : ['Faded', 'clay']; }
    if (a.n < 150) return ['Too few games yet', ''];
    const p = resRate(a); return p > be + 0.01 ? ['Holding up', 'mint'] : p > be - 0.01 ? ['About break-even', ''] : ['Faded', 'clay'];
  }
  function researchView() {
    const cell = (b, kind) => kind === 'moneyline' ? `${resRec(b)}<div class="dim" style="font-size:12px">${b.n ? `${b.u >= 0 ? '+' : ''}${b.u.toFixed(1)}u · ${((b.u / b.n) * 100).toFixed(1)}% ROI` : ''}</div>` : `${resRec(b)}<div class="dim" style="font-size:12px">${pct(resRate(b), 1)}</div>`;
    const nbaUp = researchUpcoming.NBA.map((g) => ({ g, m: RESEARCH.find((r) => r.id === 'r-nba-b2b-home').pick(g) })).filter((x) => x.m);
    return `<p class="muted" style="margin-top:0">These come from published studies or a classic betting book, each with a reason to work and a publication year. That makes the seasons <b>after</b> publication a fair test: if a pattern was real and nobody priced it in, it should still beat break-even; if it was luck, or the books adjusted, it fades.</p>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>System and source</th><th class="r">Before published</th><th class="r">Since published</th><th class="r">2026</th><th>Verdict</th></tr>
      ${RESEARCH.map((r) => { const [v, c] = verdict(r); return `<tr><td><b>${esc(r.name)}</b> <span class="chip">${r.league}</span><div class="dim" style="font-size:12px"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.cite)}</a> · ${esc(r.why)}</div>${r.kind === 'teaser' ? `<div class="dim" style="font-size:12px">Leg break-even ${pct(BREAK_EVEN.teaser, 1)}.</div>` : ''}</td>
        <td class="r num">${r.league === 'NBA' ? '<span class="dim">no history</span>' : cell(r.before, r.kind)}</td><td class="r num">${r.league === 'NBA' ? '<span class="dim">this season only</span>' : cell(r.after, r.kind)}</td><td class="r num">${cell(r.now, r.kind)}</td>
        <td><span class="chip ${c}">${r.league === 'NBA' ? 'Tracking' : v}</span></td></tr>`; }).join('')}</table></div>
      <p class="stamp">NFL: nflverse closing lines, 2002 to now. “Since published” runs from the publication season through 2026. NBA: this season only, at DraftKings closing lines, because free NBA history with lines isn’t available.</p>
      ${nbaUp.length ? `<div class="sec"><h2>NBA back-to-back spots, next two days</h2><div class="grid g3">${nbaUp.map(({ g, m }) => `<div class="card"><div class="dim" style="font-size:12.5px">${esc(fmtDay(g.live.start_time))} ${esc(fmtTime(g.live.start_time))}</div><b>${esc(researchLabel(g, m, pickLabel))}</b><div class="dim" style="font-size:12.5px">${esc(g.home)} played yesterday; ${esc(g.away)} had ${g.away_rest - 1} day${g.away_rest - 1 === 1 ? '' : 's'} off</div></div>`).join('')}</div></div>` : ''}`;
  }

  function draw() {
    const lg = st.lg;
    const lib = systems.filter((s) => s.league === lg && (st.kind === 'all' || s.kind === st.kind) && (st.tier === 'all' || (st.tier === 'badged' ? s.qualified : !s.qualified)) && (!st.q || s.name.toLowerCase().includes(st.q.toLowerCase())))
      .sort((a, b) => (b.qualified - a.qualified) || ((b.rate ?? 0) - (a.rate ?? 0)));
    const sa = sinceAll[lg], sb = sinceBadged[lg];
    const gb = file.boards.filter((b) => b.league === lg);
    const board = boards[lg];

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">${lg === 'NFL' ? 'NFL' : 'College'} systems</div><h1>Matrix</h1><p>464 situational systems, matched to this week’s games, plus the test that matters: how they’ve done on games played after they were found.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    <div class="card" style="border-color:#e0795a88;margin-bottom:14px"><b class="clay">Read this before betting a system.</b>
      <p class="muted" style="margin:6px 0 0">These were found by grading ${lg === 'NFL' ? '259,428 NFL' : '36,602 college'} combinations of situations and keeping the ones with the best past records. Search that many and hundreds will look great by luck alone. The only fair test is games played after a system was found. So far:</p>
      <div class="grid g4" style="margin-top:10px">
        <div class="stat"><div class="k">All plays since found</div><div class="v num ${rate(sa) !== null ? (rate(sa) > BE ? 'mint' : 'clay') : ''}">${rec(sa)}</div><div class="s">${pct(rate(sa), 1)} · ${lg === 'NFL' ? `week${nflWeeks.length > 1 ? 's' : ''} ${nflWeeks.join(', ') || '—'}` : `weeks ${cfbWeeks[0] ?? ''}–${cfbWeeks[cfbWeeks.length - 1] ?? ''}`}</div></div>
        <div class="stat"><div class="k">Badged plays since</div><div class="v num ${rate(sb) !== null ? (rate(sb) > BE ? 'mint' : 'clay') : ''}">${rec(sb)}</div><div class="s">${pct(rate(sb), 1)} · the 60%+ tier</div></div>
        ${gb.map((b) => `<div class="stat"><div class="k">${esc(b.label)} board</div><div class="v num">${rec(b.all)}</div><div class="s">badged ${rec(b.badged)} · ${b.note.includes('inside the record') ? 'inside its own record' : 'after the record'}</div></div>`).join('')}
      </div>
      <p class="dim" style="font-size:12.5px;margin:8px 0 0">Break-even at −110 is ${pct(BE, 1)}. ${lg === 'NFL' ? `Rebuild check: ${exact} of ${checked} NFL systems reproduce their original record exactly, ${close} more within a few games.` : `College plays since found are graded at ESPN’s DraftKings closing line, on the ${after.NCAAF.length} games so far with a closing number (more are filled in each night). Previous-game situations only see games against FBS teams.`}</p></div>
    <div class="row" style="margin-bottom:12px">${seg('lg', [['NFL', 'NFL'], ['NCAAF', 'College']], lg)} ${seg('tab', [['week', 'This week'], ['lib', 'Systems library'], ['research', 'Research systems']], st.tab)}</div>
    ${st.tab === 'research' ? researchView() : st.tab === 'week' ? `<div class="grid g2">${board.map(({ g, hits, rhits, picks }) => {
        const lv = g.live, d = lv?.data;
        return `<div class="card ${picks[0] && picks[0][1].some((h) => h.s.qualified) ? 'hl' : ''}">
          <div class="row" style="justify-content:space-between;font-size:13px"><span>${lv ? `${esc(fmtDay(lv.start_time))} · ${esc(fmtTime(lv.start_time))}` : esc(g.date)}</span><span class="dim">${hits.length} system${hits.length === 1 ? '' : 's'}</span></div>
          <div class="team" style="margin-top:8px">${d ? logo(d.away) : ''}<b>${esc(d?.away?.short ?? g.away)}</b></div><div class="team" style="margin-top:4px">${d ? logo(d.home) : ''}<b>${d?.neutral || g.neutral ? 'vs' : '@'} ${esc(d?.home?.short ?? g.home)}</b> <span class="dim">${g.home} ${g.home_spread > 0 ? '+' : ''}${g.home_spread} · O/U ${g.total ?? '—'}</span></div>
          ${picks.map(([label, hs]) => `<div style="margin-top:10px"><div class="row" style="justify-content:space-between"><b>${esc(label)}</b><span class="chip ${hs.some((h) => h.s.qualified) ? 'gold' : ''}">${hs.length}</span></div>
            ${hs.slice(0, 4).map((h) => `<div class="dim" style="font-size:12.5px;padding:3px 0;border-top:1px solid var(--line)">${h.s.qualified ? '<b class="gold">Badged</b> · ' : ''}${esc(h.s.name)} · ${rec(h.s.record)} · since: <span class="${h.s.since.w + h.s.since.l ? (rate(h.s.since) > BE ? 'mint' : 'clay') : ''}">${rec(h.s.since)}</span></div>`).join('')}
            ${hs.length > 4 ? `<div class="dim" style="font-size:12px">+ ${hs.length - 4} more</div>` : ''}</div>`).join('') || '<div class="dim" style="font-size:12.5px;margin-top:8px">No systems fit this game.</div>'}
          ${rhits.length ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--line2)"><div class="kicker" style="color:var(--sky);margin-bottom:4px">Research systems</div>${rhits.map((x) => `<div style="font-size:12.5px;padding:2px 0"><b>${esc(x.label)}</b> <span class="dim">· ${esc(x.r.name)} · since published ${resRec(x.r.after)}</span></div>`).join('')}</div>` : ''}
        </div>`; }).join('') || '<div class="empty">No games with lines yet.</div>'}</div>`
    : `<div class="row" style="margin-bottom:10px">${seg('kind', [['all', 'All'], ['spread', 'Spread'], ['total', 'Total'], ['moneyline', 'Moneyline']], st.kind)} ${seg('tier', [['all', 'All tiers'], ['badged', 'Badged'], ['library', 'Library']], st.tier)}
        <input data-act="q" placeholder="Search systems" value="${esc(st.q)}" style="min-width:200px"></div>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>${lib.length} systems · tap one for details</th><th class="r">Record</th><th class="r">Since found</th></tr>${lib.map(sysRow).join('')}</table></div>`}
    ${footNote(`Systems and records as of ${esc(file.asOf)}. NFL history: nflverse closing lines. College since-found games: ESPN with DraftKings closing lines. Reference only, not a recommendation.`)}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('mx2:lg', v); st.open = null; draw(); });
    onSeg(el, 'tab', (v) => { st.tab = v; store.set('mx2:tab', v); draw(); });
    onSeg(el, 'kind', (v) => { st.kind = v; draw(); });
    onSeg(el, 'tier', (v) => { st.tier = v; draw(); });
    const q = el.querySelector('[data-act=q]'); if (q) q.oninput = () => { st.q = q.value; const pos = q.selectionStart; draw(); const n = el.querySelector('[data-act=q]'); n.focus(); n.setSelectionRange(pos, pos); };
    el.querySelectorAll('[data-sys]').forEach((tr) => tr.onclick = () => { st.open = st.open === tr.dataset.sys ? null : tr.dataset.sys; draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); render(el); };
    wireHow(el);
  }
  draw();
}
