import { games, line, esc, logo, seg, onSeg, store, pct, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, sgn, unitsAt110 } from './core.js?v=202611180335';
import { flagNow, loadFlags, gradeFlags, TRIG, historyNote } from './moves.js?v=202611180335';
import { nflHist } from './hist.js?v=202611180335';

// Totals rules written up front (not mined from the data), then checked on two separate halves of history.
export const CUTS = [
  { id: 'wind', side: 'under', name: 'Wind 15+ mph', why: 'Wind shortens the passing game and kicking range.', test: (g) => g.wind !== null && g.wind >= 15 && g.roof !== 'dome' && g.roof !== 'closed' },
  { id: 'cold', side: 'under', name: 'Freezing, outdoors', why: 'Kickoff temperature at or below 32°F.', test: (g) => g.temp !== null && g.temp <= 32 && g.roof === 'outdoors' },
  { id: 'hi', side: 'under', name: 'Total 50 or higher', why: 'The market tends to shade big totals up for over bettors.', test: (g) => g.total_line >= 50 },
  { id: 'lo', side: 'over', name: 'Total 38 or lower', why: 'Low totals leave little room for an under.', test: (g) => g.total_line <= 38 },
  { id: 'divhi', side: 'under', name: 'Division game, total 46+', why: 'Teams that see each other twice a year know each other.', test: (g) => g.div_game === 1 && g.total_line >= 46 },
  { id: 'dome', side: 'over', name: 'Dome, total 44 or lower', why: 'Indoor games priced like outdoor ones.', test: (g) => (g.roof === 'dome' || g.roof === 'closed') && g.total_line <= 44 },
  { id: 'prime', side: 'under', name: 'Prime time', why: 'Night games draw public over money.', test: (g) => g.gametime && Number(g.gametime.slice(0, 2)) >= 20 },
  { id: 'thu', side: 'under', name: 'Thursday game', why: 'Short week, simpler game plans.', test: (g) => g.weekday === 'Thursday' },
];

export function grade(list, side) {
  let w = 0, l = 0, p = 0;
  for (const g of list) {
    if (g.pts === null || g.total_line === null) continue;
    const d = g.pts - g.total_line;
    if (d === 0) p++; else if ((d > 0) === (side === 'over')) w++; else l++;
  }
  return { w, l, p, pct: w + l ? w / (w + l) : null };
}
const recTxt = (r) => r.w + r.l ? `${r.w}–${r.l}${r.p ? '–' + r.p : ''}` : '—';

export async function render(el) {
  const st = { lg: store.get('ll:lg', 'nfl'), view: 'board' };
  let rows = [], hist = null, flagRec = null;

  async function load() {
    el.innerHTML = '<div class="loading">Pulling the book…</div>';
    const seasonStart = st.lg === 'nba' ? '2026-10-01' : '2026-08-01';
    rows = await games({ league: st.lg, from: seasonStart, ttl: 90_000 });
    if (st.lg === 'nfl' && !hist) hist = await nflHist();
    draw();
    // grade the move signal across all three leagues (doesn't hold up the page)
    if (!flagRec) {
      const recent = (await Promise.all(['nfl', 'cfb', 'nba'].map((lg) => games({ league: lg, from: '2026-11-16', ttl: 300_000 })))).flat();
      flagRec = gradeFlags(await loadFlags(recent)); draw();
    }
  }

  function draw() {
    const now = Date.now();
    const finals = rows.filter((g) => g.state === 'post' && g.close_total > 0 && g.home_score !== null);
    const vs = (key) => {
      let o = 0, u = 0, p = 0;
      for (const g of finals) { const t = g[key]; if (!(t > 0)) continue; const d = g.home_score + g.away_score - t; d > 0 ? o++ : d < 0 ? u++ : p++; }
      return { o, u, p };
    };
    const vClose = vs('close_total'), vOpen = vs('open_total');
    const avgMiss = finals.length ? finals.reduce((a, g) => a + (g.home_score + g.away_score - g.close_total), 0) / finals.length : null;
    const upcoming = rows.filter((g) => g.state === 'pre' && new Date(g.start_time).getTime() < now + 8 * 86400e3 && g.total !== null);
    const moved = upcoming.map((g) => ({ g, mv: g.open_total !== null ? Number(g.total) - Number(g.open_total) : 0 }));

    // cuts (NFL)
    let cutHtml = '', liveCuts = new Map();
    if (st.lg === 'nfl' && hist) {
      const done = hist.games.filter((g) => g.done && g.total_line !== null && g.game_type === 'REG');
      const A = done.filter((g) => g.season <= 2013), B = done.filter((g) => g.season >= 2014 && g.season <= 2025), C = done.filter((g) => g.season === 2026);
      const res = CUTS.map((c) => {
        const a = grade(A.filter(c.test), c.side), b = grade(B.filter(c.test), c.side), now26 = grade(C.filter(c.test), c.side);
        const holds = a.pct !== null && b.pct !== null && a.pct > 0.524 && b.pct > 0.524 && (a.w + a.l) >= 60 && (b.w + b.l) >= 60;
        return { ...c, a, b, now26, holds };
      });
      // which upcoming games each holding cut applies to
      for (const g of hist.games.filter((x) => x.season === 2026 && !x.done && x.espn)) {
        const live = rows.find((r) => r.id === String(g.espn));
        if (!live || live.state !== 'pre') continue;
        const gg = { ...g, total_line: live.total !== null ? Number(live.total) : g.total_line };
        if (gg.total_line === null) continue;
        const hits = res.filter((c) => c.holds && c.test(gg));
        if (hits.length) liveCuts.set(live.id, hits);
      }
      const yr = res.filter((c) => c.holds).reduce((a, c) => ({ w: a.w + c.now26.w, l: a.l + c.now26.l }), { w: 0, l: 0 });
      cutHtml = `
      <div class="sec"><h2>Cuts</h2><p class="sub">Rules written down first, then checked on two separate halves of NFL history (2002–2013 and 2014–2025). A cut only “holds” if it beat 52.4% (break-even at −110) in both halves. This season’s record is the real test. Held cuts are ${yr.w}–${yr.l} in 2026.</p>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t">
        <tr><th>Cut</th><th>Play</th><th class="r">2002–13</th><th class="r">2014–25</th><th class="r">2026</th><th></th></tr>
        ${res.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="dim" style="font-size:12px">${esc(c.why)}</div></td><td>${c.side === 'under' ? '<span class="chip clay">Under</span>' : '<span class="chip gold">Over</span>'}</td>
          <td class="r num">${recTxt(c.a)}<div class="dim" style="font-size:12px">${pct(c.a.pct, 1)}</div></td>
          <td class="r num">${recTxt(c.b)}<div class="dim" style="font-size:12px">${pct(c.b.pct, 1)}</div></td>
          <td class="r num">${recTxt(c.now26)}<div class="dim" style="font-size:12px">${pct(c.now26.pct, 1)}</div></td>
          <td class="r">${c.holds ? '<span class="chip mint">Holds</span>' : '<span class="chip off">Doesn’t hold</span>'}</td></tr>`).join('')}
      </table></div></div>`;
    }

    const board = moved.sort((a, b) => new Date(a.g.start_time) - new Date(b.g.start_time)).map(({ g, mv }) => {
      const d = g.data, cuts = liveCuts.get(g.id) || [];
      const big = Math.abs(mv) >= (st.lg === 'nba' ? 3 : 2);
      return `<tr style="${cuts.length ? 'box-shadow:inset 3px 0 0 var(--gold)' : ''}">
        <td><div class="team">${logo(d.away)}<span>${esc(d.away.short)}</span></div><div class="team" style="margin-top:3px">${logo(d.home)}<span>${d.neutral ? 'vs' : '@'} ${esc(d.home.short)}</span></div></td>
        <td class="muted" style="font-size:13px">${esc(fmtDay(g.start_time))}<br>${esc(fmtTime(g.start_time))}</td>
        <td class="r num disp" style="font-size:20px">${g.open_total ?? '—'}</td>
        <td class="r num disp" style="font-size:20px">${g.total ?? '—'}</td>
        <td class="r num ${big ? (mv > 0 ? 'gold' : 'clay') : 'dim'}">${mv ? sgn(mv) : '0'}</td>
        <td>${cuts.map((c) => `<span class="chip ${c.side === 'under' ? 'clay' : 'gold'}" title="${esc(c.why)}">${c.side === 'under' ? 'Under' : 'Over'} · ${esc(c.name)}</span>`).join(' ')}</td></tr>`;
    }).join('');

    const LGN = { nfl: 'NFL', cfb: 'College', nba: 'NBA' };
    const team = (g, side) => g.data?.[side]?.short ?? (side === 'home' ? g.home : g.away);
    const pick = (g, f, n) => f.mk === 'tot' ? `${f.side === 'over' ? 'Over' : 'Under'} ${n}` : `${team(g, f.side)} ${line(n)}`;
    const movers = rows.filter((g) => g.state === 'pre' && new Date(g.start_time).getTime() > now + 3600e3 && new Date(g.start_time).getTime() < now + 8 * 86400e3)
      .flatMap((g) => flagNow(g).map((f) => ({ g, f }))).sort((a, b) => b.f.move - a.f.move);
    const fr = (k) => flagRec?.[k];
    const recCell = (b) => b && b.n ? `${b.w}–${b.l}${b.p ? '–' + b.p : ''}<div class="dim" style="font-size:12px">${pct(b.w + b.l ? b.w / (b.w + b.l) : null, 1)}</div>` : '—';
    const clvCell = (b) => b && b.n ? `${b.beat} of ${b.n}<div class="dim" style="font-size:12px">${b.same} same · ${b.back} came back</div>` : '—';
    const movesHtml = `
    <div class="sec"><h2>Moving lines</h2><p class="sub">The opener is where books make mistakes, and the move shows which side they were wrong on. When a line has moved ${TRIG[st.lg].tot}+ on a total or ${TRIG[st.lg].sp}+ on a spread, the side it moved toward is flagged with the number to get and the point where it’s no longer worth chasing.</p>
      ${movers.length ? `<div class="grid g3">${movers.map(({ g, f }) => `<div class="card">
        <div class="row" style="justify-content:space-between;font-size:12.5px"><span>${esc(fmtDay(g.start_time))} · ${esc(fmtTime(g.start_time))}</span><span class="chip">${f.mk === 'tot' ? 'Total' : 'Spread'}</span></div>
        <div class="dim" style="font-size:13px;margin-top:6px">${esc(team(g, 'away'))} @ ${esc(team(g, 'home'))}</div>
        <div class="disp" style="font-size:22px;margin:2px 0">${esc(pick(g, f, f.num))}</div>
        <div style="font-size:13px">Opened ${esc(pick(g, f, f.open))} · moved ${f.move} toward this side</div>
        ${(() => { const h = historyNote(st.lg, f); return h && h.tone === 'clay' ? `<div style="font-size:13px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line2)" class="clay"><b>${esc(h.text)}</b></div>`
          : `<div style="font-size:13px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line2)"><b class="mint">Get it at ${esc(pick(g, f, f.num))} or better.</b> <span class="clay">Pass past ${esc(pick(g, f, f.limit))}.</span>${h ? `<div class="mint" style="font-size:12.5px;margin-top:4px">${esc(h.text)}</div>` : ''}</div>`; })()}</div>`).join('')}</div>` : '<div class="empty">No line has moved enough yet.</div>'}
      <div class="card" style="padding:4px 12px;overflow-x:auto;margin-top:12px"><table class="t"><tr><th>Does the flag work?</th><th class="r">Line kept moving past the flag</th><th class="r">Record at the flagged number</th></tr>
        ${[['all', 'All leagues'], ...['nfl', 'cfb', 'nba'].flatMap((lg) => [[`${lg}:tot`, `${LGN[lg]} totals`], [`${lg}:sp`, `${LGN[lg]} spreads`]])].map(([k, lab]) => `<tr><td>${lab}</td><td class="r num">${flagRec ? clvCell(fr(k)) : '…'}</td><td class="r num">${flagRec ? recCell(fr(k)) : '…'}</td></tr>`).join('')}</table></div>
      <p class="stamp">NFL history notes: TeamRankings’ opening and closing lines since 2008, graded at the close. Each flag is frozen the first time it fires (every line change has been saved since Nov 16, 2026) and graded at that number. “Kept moving” means the closing line ended up worse than the flagged number, so taking the flag beat the close. Break-even is 52.4% at −110. These rules were written before any flag was graded.</p></div>`;

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Line tracker</div><h1>Line Life</h1><p>Open, close, and what actually scored. The opener posts when the book hangs it, the number becomes the close at kickoff, and the final is measured against both.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How to read it', `<ol>
      <li><b>Moving lines</b> flags any total or spread that has moved far enough from the opener, with the number to get and where to stop chasing it. The table under it grades every flag.</li>
      <li><b>Season</b> shows how finals landed against the closing total and the opener. A market that’s right should split about 50/50.</li>
      <li><b>Board</b> lists every upcoming total with its open, the number now, and the move. Big moves are highlighted. A gold edge means a cut that holds applies to that game.</li>
      <li><b>Cuts</b> (NFL) are simple rules checked on two separate halves of history. The old version mined patterns on past seasons and went 16–22 this year; these have to survive both halves before they light up.</li></ol>`, 'll')}
    <div class="row" style="margin-bottom:14px">${seg('lg', [['nfl', 'NFL'], ['cfb', 'College'], ['nba', 'NBA']], st.lg)}</div>
    <div class="grid g4">
      <div class="card stat"><div class="k">Measured</div><div class="v num">${finals.length}</div><div class="s">finals with a closing total</div></div>
      <div class="card stat"><div class="k">Vs the close</div><div class="v num">${vClose.o}–${vClose.u}${vClose.p ? '–' + vClose.p : ''}</div><div class="s">over–under${vClose.p ? '–push' : ''}</div></div>
      <div class="card stat"><div class="k">Vs the open</div><div class="v num">${vOpen.o}–${vOpen.u}${vOpen.p ? '–' + vOpen.p : ''}</div><div class="s">over–under${vOpen.p ? '–push' : ''}</div></div>
      <div class="card stat"><div class="k">Avg miss</div><div class="v num">${avgMiss === null ? '—' : sgn(avgMiss)}</div><div class="s">final minus close, points</div></div>
    </div>
    ${movesHtml}
    <div class="sec"><h2>On the board</h2><p class="sub">${upcoming.length} totals posted in the next 8 days. Moves are measured from DraftKings’ opener.</p>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t">
      <tr><th>Game</th><th>When</th><th class="r">Open</th><th class="r">Now</th><th class="r">Move</th><th>Cuts</th></tr>
      ${board || '<tr><td colspan="6" class="muted">No totals posted yet.</td></tr>'}</table></div></div>
    ${cutHtml}
    ${footNote(`Lines: DraftKings via ESPN, checked every 5 minutes. ${st.lg === 'nfl' ? 'History: nflverse closing totals, 2002–2025.' : ''} Not a promise.`)}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('ll:lg', v); load(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
}
