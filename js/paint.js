import { games, api, esc, logo, seg, onSeg, store, pct, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, sgn } from './core.js?v=202611260314';

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
  let all = [], breaks = [], dunkel = [], DK = new Map();

  async function load(quiet) {
    if (!quiet) el.innerHTML = '<div class="loading">Running the numbers…</div>';
    [all, breaks, dunkel] = await Promise.all([games({ league: 'nba', from: '2026-10-01', ttl: 60_000 }), api('break_lines?select=*&live_total=not.is.null&limit=10000', { ttl: 60_000 }).catch(() => []), api('dunkel?league=eq.nba&select=*', { ttl: 300_000 }).catch(() => [])]);
    DK = new Map(dunkel.map((r) => [String(r.game_id), r]));
    draw();
  }

  function draw() {
    const now = Date.now();
    const finals = all.filter((g) => g.state === 'post' && g.home_score !== null).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    // backtest: every final this season, ratings from earlier games only, against the closing total
    const book = Object.fromEntries(STAGES.map(([k]) => [k, { w: 0, l: 0, p: 0, ow: 0, ol: 0 }]));
    const BR = new Map(); for (const r of breaks) { if (!BR.has(r.espn_id)) BR.set(r.espn_id, {}); BR.get(r.espn_id)[r.period] = r; }
    const blank = () => ({ w: 0, l: 0, p: 0 });
    // quarter breaks: the projection at that moment against DraftKings' live line at that moment
    const brk = Object.fromEntries(STAGES.slice(1).map(([k]) => [k, { n: 0, all: blank(), lock: blank(), closer: 0, ties: 0, err: 0, lerr: 0, sAll: blank(), sLock: blank() }]));
    const tally = (b, r) => { if (r === 'W') b.w++; else if (r === 'L') b.l++; else b.p++; };
    const sp = { w: 0, l: 0, p: 0 };
    const ydayKey = new Date(now - 86400e3).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const yday = [];
    // Dunkel's own total (the first one it posted) graded against the same closing line
    const dk = blank();
    for (const g of finals) { const r = DK.get(String(g.id)); const c = g.close_total > 0 ? Number(g.close_total) : null; if (!r || c === null || Number(r.first_total) === c) continue; tally(dk, grade(Number(r.first_total) > c ? 'Over' : 'Under', c, g.home_score + g.away_score)); }
    for (const g of finals) {
      const ln = g.close_total > 0 ? Number(g.close_total) : null;
      const rt = ratings(finals, new Date(g.start_time).getTime());
      const pr = project(rt, g.home, g.away);
      if (!pr || ln === null) continue;
      const fin = g.home_score + g.away_score;
      const res = {};
      for (const [k, , mins] of STAGES) {
        if (k !== 'pre') {
          const br = BR.get(g.id)?.[mins / 12]; if (!br) continue;
          const b = brk[k], lt = Number(br.live_total), now2 = br.home_pts + br.away_pts;
          const p = liveProj(pr.total, now2, mins), left = (48 - mins) / 48;
          b.n++; b.err += Math.abs(p - fin); b.lerr += Math.abs(lt - fin);
          if (Math.abs(p - fin) < Math.abs(lt - fin)) b.closer++; else if (Math.abs(p - fin) === Math.abs(lt - fin)) b.ties++;
          if (p !== lt) { const lean = p > lt ? 'Over' : 'Under', r = grade(lean, lt, fin); tally(b.all, r); if (Math.abs(p - lt) >= EDGE[k]) { tally(b.lock, r); res[k] = { lean, p, r, lt }; } }
          if (br.live_spread_home !== null) {
            const ls = Number(br.live_spread_home), pm = (br.home_pts - br.away_pts) + left * pr.margin, x = pm + ls;
            if (x !== 0) { const m = (g.home_score - g.away_score) + ls; const r = m === 0 ? 'P' : (m > 0) === (x > 0) ? 'W' : 'L'; tally(b.sAll, r); if (Math.abs(x) >= SPREAD_EDGE) tally(b.sLock, r); }
          }
          continue;
        }
        const p = pr.total;
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
      const pr = project(rt, g.home, g.away); const d = g.data; const dkr = DK.get(String(g.id));
      const ln = g.total !== null ? Number(g.total) : g.close_total > 0 ? Number(g.close_total) : null, spH = g.spread_home !== null ? Number(g.spread_home) : null;
      let projT = pr?.total ?? null, stage = 'Pregame';
      if (kind === 'live' && pr) {
        const per = Math.min(4, d.period || 1); const ck = String(d.clock ?? '12:00');
        const left = ck.includes(':') ? (([mm, ss]) => mm + (ss || 0) / 60)(ck.split(':').map(Number)) : Number(ck) / 60; // under a minute ESPN sends seconds only
        const mins = Math.min(48, (per - 1) * 12 + (12 - Math.min(12, left || 0)));
        projT = liveProj(pr.total, (d.home.score || 0) + (d.away.score || 0), mins); stage = d.detail;
      }
      const edge = kind === 'pre' && projT !== null && ln !== null ? projT - ln : null;
      const need = EDGE.pre;
      const lean = edge !== null && Math.abs(edge) >= need ? (edge > 0 ? 'Over' : 'Under') : null;
      // latest quarter break with a logged DraftKings live line
      let bk = null;
      if (kind === 'live' && pr) { const rows = BR.get(g.id) || {}; const pk = [3, 2, 1].find((q) => rows[q]); if (pk) { const r = rows[pk], st2 = STAGES[pk]; const pj = liveProj(pr.total, r.home_pts + r.away_pts, pk * 12); const e = pj - Number(r.live_total); bk = { lab: st2[1], k: st2[0], lt: Number(r.live_total), pj, e, lean: Math.abs(e) >= EDGE[st2[0]] ? (e > 0 ? 'Over' : 'Under') : null, ls: r.live_spread_home, pm: (r.home_pts - r.away_pts) + ((48 - pk * 12) / 48) * pr.margin }; } }
      const spLean = pr && spH !== null && Math.abs(pr.margin + spH) >= SPREAD_EDGE ? (pr.margin + spH > 0 ? d.home : d.away) : null;
      const spLine = spLean ? (spLean === d.home ? spH : -spH) : null;
      return `<div class="card ${lean ? 'hl' : ''}">
        <div class="row" style="justify-content:space-between;font-size:13px"><span>${kind === 'live' ? `<span class="pill-live">${esc(stage)}</span>` : `${esc(fmtDay(g.start_time))} · ${esc(fmtTime(g.start_time))}`}</span><span class="dim">${esc((d.bcast || []).join(', '))}</span></div>
        <div class="row" style="justify-content:space-between;margin-top:8px"><span class="team">${logo(d.away)}<span><b>${esc(d.away.short)}</b> <span class="dim">${esc(d.away.rec || '')}</span></span></span>${kind === 'live' ? `<b class="disp num" style="font-size:22px">${d.away.score ?? 0}</b>` : `<span class="num dim">${pr ? pr.ap.toFixed(0) : ''}</span>`}</div>
        <div class="row" style="justify-content:space-between"><span class="team">${logo(d.home)}<span><b>${esc(d.home.short)}</b> <span class="dim">${esc(d.home.rec || '')}</span></span></span>${kind === 'live' ? `<b class="disp num" style="font-size:22px">${d.home.score ?? 0}</b>` : `<span class="num dim">${pr ? pr.hp.toFixed(0) : ''}</span>`}</div>
        <div class="grid" style="grid-template-columns:repeat(${dkr ? 4 : 3},1fr);gap:8px;margin-top:10px">
          <div class="stat"><div class="k">${kind === 'live' ? 'Pregame total' : 'DK total'}</div><div class="v num" style="font-size:24px">${ln ?? '—'}</div></div>
          <div class="stat"><div class="k">Projected</div><div class="v num" style="font-size:24px">${projT !== null ? projT.toFixed(1) : '—'}</div></div>
          ${dkr ? `<div class="stat"><div class="k">Dunkel</div><div class="v num" style="font-size:24px">${Number(dkr.dunkel_total)}</div></div>` : ''}
          <div class="stat"><div class="k">Edge</div><div class="v num ${lean ? 'gold' : 'dim'}" style="font-size:24px">${edge !== null ? sgn(edge) : '—'}</div></div></div>
        ${kind === 'pre' && dkr && ln !== null && projT !== null ? (() => { const a = projT > ln ? 'Over' : 'Under', b = Number(dkr.dunkel_total) > ln ? 'Over' : Number(dkr.dunkel_total) < ln ? 'Under' : null; return b ? `<div style="font-size:12.5px;margin-top:6px" class="${a === b ? 'mint' : 'dim'}">${a === b ? `Both models lean <b>${a}</b> ${ln}` : `Models split: this one ${a}, Dunkel ${b}`}</div>` : ''; })() : ''}
        ${kind === 'live' ? (bk ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--line2);font-size:13px"><b>${esc(bk.lab)}:</b> DraftKings live total <b class="num">${bk.lt}</b>, projected <b class="num">${bk.pj.toFixed(1)}</b> (${sgn(bk.e)}) ${bk.lean ? `<span class="chip gold">${bk.lean} ${bk.lt}</span>` : `<span class="dim">no lock, needs ${EDGE[bk.k]}+</span>`}${bk.ls !== null ? `<div class="dim" style="font-size:12.5px">Live spread ${esc(d.home.abbr)} ${line(Number(bk.ls))}; projected margin ${esc(d.home.abbr)} ${sgn(bk.pm, 1)}</div>` : ''}</div>` : `<div class="dim" style="font-size:12.5px;margin-top:8px">Projected final from the score so far. DraftKings’ live line is saved at each quarter break and compared here.</div>`)
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
      <li><b>The book</b> grades every pregame lock this season against the closing total, using only games played before that day. At −110 you need ${pct(BE, 1)}. Quarter-break projections are graded against DraftKings’ live line saved at that break.</li></ol>`, 'paint')}
    <div class="sec" style="margin-top:0"><h2>The book</h2><p class="sub">Every pregame lock this season, using only games played before that day, graded against the DraftKings close.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="card stat"><div class="k">Pregame totals</div><div class="v num">${rec(book.pre)}</div><div class="s ${rp(book.pre) !== null && rp(book.pre) > BE ? 'mint' : 'clay'}">${pct(rp(book.pre), 1)} · break-even ${pct(BE, 1)}</div></div>
      <div class="card stat"><div class="k">Dunkel totals</div><div class="v num">${rec(dk)}</div><div class="s ${rp(dk) !== null && rp(dk) > BE ? 'mint' : 'clay'}">${dk.w + dk.l ? pct(rp(dk), 1) + ' · ' : ''}its first number vs the close, since Nov 22</div></div>
      <div class="card stat"><div class="k">Pregame overs</div><div class="v num">${book.pre.ow + book.pre.ol ? `${book.pre.ow}–${book.pre.ol}` : '—'}</div><div class="s">unders ${book.pre.w - book.pre.ow}–${book.pre.l - book.pre.ol}</div></div>
      <div class="card stat"><div class="k">Spread leans</div><div class="v num">${rec(sp)}</div><div class="s">${pct(rp(sp), 1)} · ${SPREAD_EDGE}+ points off the close</div></div>
      <div class="card stat"><div class="k">Halftime locks</div><div class="v num">${rec(brk.half.lock)}</div><div class="s">vs the live total · ${brk.half.n} halves logged</div></div>
    </div>
    </div>
    <div class="sec"><h2>At the breaks</h2><p class="sub">At the end of the 1st, at halftime and at the end of the 3rd, the projected final is saved next to DraftKings’ live total and spread at that moment, then graded when the game ends.</p>
    <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Break</th><th class="r">Games</th><th class="r">Total, every game</th><th class="r">Total locks</th><th class="r">Projection closer than the line</th><th class="r">Spread, every game</th><th class="r">Spread ${SPREAD_EDGE}+</th></tr>
    ${STAGES.slice(1).map(([k, lab]) => { const b = brk[k]; const c = (x) => `${rec(x)}<div class="dim" style="font-size:12px">${pct(rp(x), 1)}</div>`; return `<tr><td><b>${lab}</b><div class="dim" style="font-size:12px">lock at ${EDGE[k]}+ points</div></td><td class="r num">${b.n}</td><td class="r num">${c(b.all)}</td><td class="r num">${c(b.lock)}</td>
      <td class="r num">${b.n ? `${b.closer} of ${b.n}<div class="dim" style="font-size:12px">avg miss ${(b.err / b.n).toFixed(1)} vs line ${(b.lerr / b.n).toFixed(1)}</div>` : '—'}</td><td class="r num">${c(b.sAll)}</td><td class="r num">${c(b.sLock)}</td></tr>`; }).join('')}</table></div>
    <p class="stamp">Started logging Nov 16, 2026, so this fills in game by game. Break-even ${pct(BE, 1)} at −110. “Every game” takes whichever side the projection points to, however small the gap; “locks” only count when the gap clears the threshold. Lines: ESPN’s “DraftKings – Live Odds” feed, checked every minute during games.</p></div>
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
