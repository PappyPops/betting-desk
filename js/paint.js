import { games, esc, logo, seg, onSeg, store, pct, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, sgn } from './core.js?v=202611162200';

// Edges a projection needs over the DraftKings number before it counts as a lock.
const EDGE = { pre: 5, q1: 6, half: 6, q3: 5 };
const SPREAD_EDGE = 4;
const STAGES = [['pre', 'Pregame', 0], ['q1', 'End 1Q', 12], ['half', 'Halftime', 24], ['q3', 'End 3Q', 36]];
const BE = 110 / 210;

// Team ratings from games played before `t`, weighted toward recent games.
function ratings(finals, t) {
  const R = new Map(); let sum = 0, n = 0, hadv = 0;
  for (const g of finals) {
    if (new Date(g.start_time).getTime() >= t) break;
    const hs = g.home_score, as = g.away_score;
    sum += hs + as; n += 2; hadv += hs - as;
    for (const [tm, pf, pa] of [[g.home, hs, as], [g.away, as, hs]]) {
      const r = R.get(tm) ?? { pf: 0, pa: 0, w: 0, gp: 0 };
      r.pf = r.pf * 0.93 + pf; r.pa = r.pa * 0.93 + pa; r.w = r.w * 0.93 + 1; r.gp++;
      R.set(tm, r);
    }
  }
  return { R, avg: n ? sum / n : 112, hadv: n ? hadv / (n / 2) : 2 };
}
function project(rt, home, away) {
  const h = rt.R.get(home), a = rt.R.get(away);
  if (!h || !a || h.gp < 4 || a.gp < 4) return null;
  // shrink each team toward league average while samples are small
  const sh = (r, v) => (v / r.w) * (r.gp / (r.gp + 6)) + rt.avg * (6 / (r.gp + 6));
  const hOff = sh(h, h.pf), hDef = sh(h, h.pa), aOff = sh(a, a.pf), aDef = sh(a, a.pa);
  const hp = hOff + aDef - rt.avg + rt.hadv / 2, ap = aOff + hDef - rt.avg - rt.hadv / 2;
  return { hp, ap, total: hp + ap, margin: hp - ap };
}
// Projected final from the score after `mins` of 48, leaning more on the live pace as the game goes on.
function liveProj(pre, ptsNow, mins) {
  const left = Math.max(0, 48 - mins) / 48, done = mins / 48;
  const pace = mins > 0 ? (ptsNow / mins) * 48 : pre;
  const w = Math.min(0.6, done * 0.8);
  return ptsNow + left * ((1 - w) * pre + w * pace);
}
const thru = (lines, q) => (lines || []).slice(0, q).reduce((a, b) => a + (b || 0), 0);
function grade(lean, ln, final) { const d = final - ln; if (d === 0) return 'P'; return (d > 0) === (lean === 'Over') ? 'W' : 'L'; }

export async function render(el) {
  const st = { start: store.get('paint:start', 'all'), ev: 'all' };
  let all = [];

  async function load(quiet) {
    if (!quiet) el.innerHTML = '<div class="loading">Running the numbers…</div>';
    all = await games({ league: 'nba', from: '2026-10-01', ttl: 60_000 });
    draw();
  }

  function draw() {
    const now = Date.now();
    const finals = all.filter((g) => g.state === 'post' && g.home_score !== null).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    // backtest: every final this season, ratings from earlier games only, against the closing total
    const book = Object.fromEntries(STAGES.map(([k]) => [k, { w: 0, l: 0, p: 0, ow: 0, ol: 0 }]));
    const sp = { w: 0, l: 0, p: 0 };
    const ydayKey = new Date(now - 86400e3).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const yday = [];
    for (const g of finals) {
      const ln = g.close_total > 0 ? Number(g.close_total) : null;
      const rt = ratings(finals, new Date(g.start_time).getTime());
      const pr = project(rt, g.home, g.away);
      if (!pr || ln === null) continue;
      const fin = g.home_score + g.away_score;
      const res = {};
      for (const [k, , mins] of STAGES) {
        const ptsNow = thru(g.data.home.lines, mins / 12) + thru(g.data.away.lines, mins / 12);
        const p = k === 'pre' ? pr.total : liveProj(pr.total, ptsNow, mins);
        if (Math.abs(p - ln) < EDGE[k]) continue;
        const lean = p > ln ? 'Over' : 'Under', r = grade(lean, ln, fin);
        const b = book[k]; if (r === 'W') b.w++; else if (r === 'L') b.l++; else b.p++;
        if (lean === 'Over') { if (r === 'W') b.ow++; else if (r === 'L') b.ol++; }
        res[k] = { lean, p, r };
      }
      const cs = g.close_spread_home !== null ? Number(g.close_spread_home) : null;
      if (cs !== null && Math.abs(pr.margin + cs) >= SPREAD_EDGE) {
        const homeSide = pr.margin + cs > 0; const m = (g.home_score - g.away_score) + cs;
        const r = m === 0 ? 'P' : (m > 0) === homeSide ? 'W' : 'L'; if (r === 'W') sp.w++; else if (r === 'L') sp.l++; else sp.p++;
        res.sp = { side: homeSide ? 'home' : 'away', r };
      }
      if (new Date(g.start_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === ydayKey) yday.push({ g, pr, ln, res });
    }
    const rt = ratings(finals, now + 1);
    const upcoming = all.filter((g) => g.state === 'pre' && new Date(g.start_time).getTime() < now + 3 * 86400e3)
      .filter((g) => st.start === 'all' || (st.start === 'early' ? Number(new Date(g.start_time).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) < 20 : Number(new Date(g.start_time).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) >= 20));
    const live = all.filter((g) => g.state === 'in');
    const rec = (b) => b.w + b.l ? `${b.w}–${b.l}${b.p ? '–' + b.p : ''}` : '—';
    const rp = (b) => b.w + b.l ? b.w / (b.w + b.l) : null;

    const gameCard = (g, kind) => {
      const pr = project(rt, g.home, g.away); const d = g.data;
      const ln = g.total !== null ? Number(g.total) : null, spH = g.spread_home !== null ? Number(g.spread_home) : null;
      let projT = pr?.total ?? null, stage = 'Pregame';
      if (kind === 'live' && pr) {
        const per = d.period || 1; const [mm, ss] = String(d.clock || '12:00').split(':').map(Number);
        const mins = Math.min(48, (per - 1) * 12 + (12 - (mm + (ss || 0) / 60)));
        projT = liveProj(pr.total, (d.home.score || 0) + (d.away.score || 0), mins); stage = d.detail;
      }
      const edge = projT !== null && ln !== null ? projT - ln : null;
      const need = kind === 'live' ? EDGE.half : EDGE.pre;
      const lean = edge !== null && Math.abs(edge) >= need ? (edge > 0 ? 'Over' : 'Under') : null;
      const spLean = pr && spH !== null && Math.abs(pr.margin + spH) >= SPREAD_EDGE ? (pr.margin + spH > 0 ? d.home : d.away) : null;
      const spLine = spLean ? (spLean === d.home ? spH : -spH) : null;
      return `<div class="card ${lean ? 'hl' : ''}">
        <div class="row" style="justify-content:space-between;font-size:13px"><span>${kind === 'live' ? `<span class="pill-live">${esc(stage)}</span>` : `${esc(fmtDay(g.start_time))} · ${esc(fmtTime(g.start_time))}`}</span><span class="dim">${esc((d.bcast || []).join(', '))}</span></div>
        <div class="row" style="justify-content:space-between;margin-top:8px"><span class="team">${logo(d.away)}<span><b>${esc(d.away.short)}</b> <span class="dim">${esc(d.away.rec || '')}</span></span></span>${kind === 'live' ? `<b class="disp num" style="font-size:22px">${d.away.score ?? 0}</b>` : `<span class="num dim">${pr ? pr.ap.toFixed(0) : ''}</span>`}</div>
        <div class="row" style="justify-content:space-between"><span class="team">${logo(d.home)}<span><b>${esc(d.home.short)}</b> <span class="dim">${esc(d.home.rec || '')}</span></span></span>${kind === 'live' ? `<b class="disp num" style="font-size:22px">${d.home.score ?? 0}</b>` : `<span class="num dim">${pr ? pr.hp.toFixed(0) : ''}</span>`}</div>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px">
          <div class="stat"><div class="k">${kind === 'live' ? 'Pregame total' : 'DK total'}</div><div class="v num" style="font-size:24px">${ln ?? '—'}</div></div>
          <div class="stat"><div class="k">Projected</div><div class="v num" style="font-size:24px">${projT !== null ? projT.toFixed(1) : '—'}</div></div>
          <div class="stat"><div class="k">Edge</div><div class="v num ${lean ? 'gold' : 'dim'}" style="font-size:24px">${edge !== null ? sgn(edge) : '—'}</div></div></div>
        ${kind === 'live' ? `<div class="dim" style="font-size:12.5px;margin-top:8px">Projected final from the score so far. The pregame total is shown for reference only; compare the projection with the live total at your book.</div>`
          : lean ? `<div style="margin-top:8px"><span class="chip gold">${lean} ${ln}</span></div>` : `<div class="dim" style="font-size:12.5px;margin-top:8px">${pr ? `No total lock. Needs ${need}+ points of edge.` : 'Not enough games yet to project.'}</div>`}
        ${kind === 'pre' && spLean ? `<div class="dim" style="font-size:12.5px;margin-top:4px">Spread lean: <b class="muted">${esc(spLean.short)} ${line(spLine)}</b> (projected margin ${sgn(pr.margin, 1)} for ${esc(d.home.abbr)})</div>` : ''}
      </div>`;
    };

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">NBA · 2026–27</div><h1>In the Paint</h1><p>Projects every game’s total before tip and at each quarter break, and locks it when the projection is far enough from the DraftKings number.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How it works', `<ol>
      <li><b>Before tip:</b> each team’s scoring and points allowed this season, weighted toward recent games and pulled toward league average early on, plus home court. A lock needs ${EDGE.pre}+ points of edge.</li>
      <li><b>At each break:</b> points so far plus a projection for the rest, leaning more on the live pace as the game goes on. Locks need ${EDGE.q1}+ (1Q, half) or ${EDGE.q3}+ (3Q).</li>
      <li><b>The book</b> grades every pregame lock this season against the closing total, using only games played before that day. At −110 you need ${pct(BE, 1)}. Quarter-break locks will be graded once enough live totals have been logged.</li></ol>`, 'paint')}
    <div class="sec" style="margin-top:0"><h2>The book</h2><p class="sub">Every pregame lock this season, using only games played before that day, graded against the DraftKings close.</p>
    <div class="grid g4">
      <div class="card stat"><div class="k">Pregame totals</div><div class="v num">${rec(book.pre)}</div><div class="s ${rp(book.pre) !== null && rp(book.pre) > BE ? 'mint' : 'clay'}">${pct(rp(book.pre), 1)} · break-even ${pct(BE, 1)}</div></div>
      <div class="card stat"><div class="k">Pregame overs</div><div class="v num">${book.pre.ow + book.pre.ol ? `${book.pre.ow}–${book.pre.ol}` : '—'}</div><div class="s">unders ${book.pre.w - book.pre.ow}–${book.pre.l - book.pre.ol}</div></div>
      <div class="card stat"><div class="k">Spread leans</div><div class="v num">${rec(sp)}</div><div class="s">${pct(rp(sp), 1)} · ${SPREAD_EDGE}+ points off the close</div></div>
      <div class="card stat"><div class="k">Quarter breaks</div><div class="v" style="font-size:20px;line-height:1.2">Not graded yet</div><div class="s">needs the live line at that moment</div></div>
    </div>
    <p class="stamp">Why quarter breaks aren’t graded: by the end of the 3rd quarter most of the score is known, so grading against the pregame total wins almost every time (it would show about ${pct(rp(book.q3), 0)} here). That’s how the old version got End 3Q Overs at 55–4. Live totals from Action Network are now being logged every 10 minutes so these can be graded against the real number going forward.</p></div>
    ${live.length ? `<div class="sec"><h2>On the floor</h2><div class="grid g2">${live.map((g) => gameCard(g, 'live')).join('')}</div></div>` : ''}
    <div class="sec"><div class="row" style="justify-content:space-between"><h2>Next three days</h2>${seg('start', [['all', 'All'], ['early', 'Before 8 ET'], ['late', '8 ET or later']], st.start)}</div>
      <div class="grid g2">${upcoming.map((g) => gameCard(g, 'pre')).join('') || '<div class="empty">No games posted yet.</div>'}</div></div>
    ${yday.length ? `<div class="sec"><h2>Yesterday</h2><div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Game</th><th class="r">Close</th><th class="r">Proj</th><th class="r">Final</th><th>Locks</th></tr>
      ${yday.map(({ g, pr, ln, res }) => `<tr><td>${esc(g.data.away.abbr)} ${g.away_score} @ ${esc(g.data.home.abbr)} ${g.home_score}</td><td class="r num">${ln}</td><td class="r num">${pr.total.toFixed(1)}</td><td class="r num">${g.home_score + g.away_score}</td>
        <td>${STAGES.filter(([k]) => res[k]).map(([k, lab]) => `<span class="chip ${res[k].r === 'W' ? 'mint' : res[k].r === 'L' ? 'clay' : ''}">${lab} ${res[k].lean} ${res[k].r === 'W' ? '✓' : res[k].r === 'L' ? '✗' : 'push'}</span>`).join(' ') || '<span class="dim">none</span>'}</td></tr>`).join('')}</table></div></div>` : ''}
    ${footNote('Lines: DraftKings via ESPN. Scores and quarter lines: ESPN. Not betting advice.')}`;

    onSeg(el, 'start', (v) => { st.start = v; store.set('paint:start', v); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
  const t = setInterval(() => { if (all.some((g) => g.state === 'in')) { clearCache(); load(true); } }, 120_000);
  return () => clearInterval(t);
}
