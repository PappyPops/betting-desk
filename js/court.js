// Full Court: college basketball. 360+ teams and 150-game nights, so the job is filtering: only games where the
// model's number is far from DraftKings' (and, best of all, the Dunkel Index agrees) make the default list.
// Ratings are opponent-adjusted (beating a weak team by 30 says less than beating a good one by 10), from the
// same engine as the simulator, refit each day with only games already played, and graded against the close.
import { games, api, esc, logo, seg, onSeg, store, pct, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, sgn } from './core.js?v=202611221443';
import { fit, predict } from './sim.js?v=202611221443';
import { trackBtn } from './mybets.js?v=202611221443';

const SEASON_START = '2026-11-01';
const HALF = 8, LAM = 3;            // ratings: 8-week half-life, light pull toward average
const MIN_GP = 5;                   // both teams need 5 games in the data before a signal counts
const EDGE = { tot: 6, sp: 4 };     // points off DraftKings before a game is a signal
const CAP = { tot: 12, sp: 9 };     // further off than this, the model is usually the one missing something (injury, lineup); not a signal
const BE = 110 / 210;
const day = (iso) => Date.parse(iso) / 864e5;
const etKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// team ids, not abbreviations: with 360 schools some abbreviations repeat
export function asSim(g) { return { day: day(g.start_time), home: String(g.data?.home?.id ?? g.home), away: String(g.data?.away?.id ?? g.away), hs: g.home_score, as: g.away_score, neutral: !!g.data?.neutral, done: g.state === 'post' && g.home_score !== null }; }

// walk forward one day at a time: predict each day's games from earlier finals, grade the leans at the close
export function backtest(finals, half = HALF, lam = LAM) {
  const byDay = new Map(); for (const g of finals) { const k = etKey(g.start_time); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(g); }
  const days = [...byDay.keys()].sort().filter((k) => k >= '2026-11-12'); // a week and a half of games first
  const out = [];
  for (const k of days) {
    const these = byDay.get(k), t0 = Math.min(...these.map((g) => day(g.start_time)));
    const train = finals.filter((g) => day(g.start_time) < t0 - 0.1).map(asSim);
    const gp = new Map(); for (const g of train) { gp.set(g.home, (gp.get(g.home) ?? 0) + 1); gp.set(g.away, (gp.get(g.away) ?? 0) + 1); }
    const m = fit(train, t0, half, lam);
    for (const g of these) {
      if (!(g.close_total > 0) || g.close_spread_home === null) continue;
      const sg = asSim(g); if ((gp.get(sg.home) ?? 0) < MIN_GP || (gp.get(sg.away) ?? 0) < MIN_GP) continue;
      const p = predict(m, sg);
      out.push({ g, eT: p.ph + p.pa - Number(g.close_total), eS: (p.ph - p.pa) + Number(g.close_spread_home) });
    }
  }
  return out;
}
function rec(rows, key, th, resFn, cap = Infinity) { let w = 0, l = 0, p = 0; for (const r of rows) { const e = r[key]; if (Math.abs(e) < th || Math.abs(e) > cap) continue; const x = resFn(r.g) * Math.sign(e); if (x > 0) w++; else if (x < 0) l++; else p++; } return { w, l, p }; }
const totRes = (g) => g.home_score + g.away_score - Number(g.close_total);
const spRes = (g) => g.home_score - g.away_score + Number(g.close_spread_home);
const rt = (r) => r.w + r.l ? `${r.w}–${r.l}${r.p ? '–' + r.p : ''}` : '—';
const rp = (r) => r.w + r.l ? r.w / (r.w + r.l) : null;

export async function render(el) {
  const st = { view: store.get('court:view2', 'both'), when: store.get('court:when', 'today'), q: '' };
  el.innerHTML = '<div class="loading">Rating 360 teams…</div>';
  const now = Date.now();
  const [all, dk] = await Promise.all([
    games({ league: 'cbb', from: SEASON_START, ttl: 120_000 }),
    api('dunkel?league=eq.cbb&select=*&limit=5000', { ttl: 300_000 }).catch(() => []),
  ]);
  const DK = new Map(dk.map((r) => [String(r.game_id), r]));
  const finals = all.filter((g) => g.state === 'post' && g.home_score !== null).sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  await new Promise((r) => setTimeout(r, 0));
  const bt = backtest(finals);
  // Dunkel's record at the close (its first posted total; its spread pick at Vegas' number)
  const dkT = { w: 0, l: 0, p: 0 }, dkS = { w: 0, l: 0, p: 0 }, both = { w: 0, l: 0, p: 0 };
  const tally = (o, x) => { if (x > 0) o.w++; else if (x < 0) o.l++; else o.p++; };
  for (const g of finals) {
    const d = DK.get(String(g.id)); if (!d) continue;
    if (g.close_total > 0 && Number(d.first_total) !== Number(g.close_total)) tally(dkT, totRes(g) * Math.sign(Number(d.first_total) - Number(g.close_total)));
    if (d.pick_side && d.pick_line !== null) { const m = (d.pick_side === 'home' ? g.home_score - g.away_score : g.away_score - g.home_score) + Number(d.pick_line); tally(dkS, m); }
    const b = bt.find((r) => r.g.id === g.id);
    if (b && Math.abs(b.eT) >= EDGE.tot && Math.abs(b.eT) <= CAP.tot && g.close_total > 0 && Math.sign(Number(d.first_total) - Number(g.close_total)) === Math.sign(b.eT)) tally(both, totRes(g) * Math.sign(b.eT));
  }

  // today's ratings for upcoming games
  const train = finals.map(asSim);
  const gp = new Map(); for (const g of train) { gp.set(g.home, (gp.get(g.home) ?? 0) + 1); gp.set(g.away, (gp.get(g.away) ?? 0) + 1); }
  const M = fit(train, now / 864e5, HALF, LAM);
  const todayKey = etKey(new Date(now).toISOString()), tmrKey = etKey(new Date(now + 86400e3).toISOString());
  const upcoming = all.filter((g) => g.state === 'pre' && Date.parse(g.start_time) > now - 600e3).map((g) => {
    const p = predict(M, asSim(g)), d = DK.get(String(g.id));
    const ln = g.total !== null ? Number(g.total) : null, sp = g.spread_home !== null ? Number(g.spread_home) : null;
    const sg = asSim(g), early = (gp.get(sg.home) ?? 0) < MIN_GP || (gp.get(sg.away) ?? 0) < MIN_GP;
    const eT = ln !== null ? p.ph + p.pa - ln : null, eS = sp !== null ? (p.ph - p.pa) + sp : null;
    const dkTot = d ? Number(d.dunkel_total) : null;
    const dkSide = d?.pick_side ?? null;
    const tSig = !early && eT !== null && Math.abs(eT) >= EDGE.tot && Math.abs(eT) <= CAP.tot ? (eT > 0 ? 'over' : 'under') : null;
    const sSig = !early && eS !== null && Math.abs(eS) >= EDGE.sp && Math.abs(eS) <= CAP.sp ? (eS > 0 ? 'home' : 'away') : null;
    const wild = !early && ((eT !== null && Math.abs(eT) > CAP.tot) || (eS !== null && Math.abs(eS) > CAP.sp));
    const tAgree = tSig && dkTot !== null && ln !== null && Math.sign(dkTot - ln) === Math.sign(eT);
    const sAgree = sSig && dkSide === sSig;
    return { g, p, d, ln, sp, eT, eS, early, wild, tSig, sSig, tAgree, sAgree, score: (tSig ? Math.abs(eT) / EDGE.tot + (tAgree ? 1 : 0) : 0) + (sSig ? Math.abs(eS) / EDGE.sp + (sAgree ? 1 : 0) : 0) };
  });

  const T = (th) => rec(bt, 'eT', th, totRes, CAP.tot), S = (th) => rec(bt, 'eS', th, spRes, CAP.sp);
  function draw() {
    const inWhen = (x) => st.when === 'all' || etKey(x.g.start_time) === (st.when === 'today' ? todayKey : tmrKey);
    const match = (x) => !st.q || `${x.g.data.home.name} ${x.g.data.away.name}`.toLowerCase().includes(st.q.toLowerCase());
    let list = upcoming.filter(inWhen).filter(match);
    if (st.view === 'signals') list = list.filter((x) => x.tSig || x.sSig);
    if (st.view === 'both') list = list.filter((x) => x.tAgree || x.sAgree);
    list.sort(st.view === 'all' ? (a, b) => Date.parse(a.g.start_time) - Date.parse(b.g.start_time) : (a, b) => b.score - a.score);
    const counts = { all: upcoming.filter(inWhen).length, sig: upcoming.filter(inWhen).filter((x) => x.tSig || x.sSig).length, both: upcoming.filter(inWhen).filter((x) => x.tAgree || x.sAgree).length };
    const chip = (r) => `${rt(r)} <span class="dim">${pct(rp(r), 0)}</span>`;
    const row = (x) => {
      const g = x.g, d = g.data, team = (s) => d[s];
      const tLab = x.tSig ? `${x.tSig === 'over' ? 'Over' : 'Under'} ${x.ln}` : null, sTeam = x.sSig ? team(x.sSig) : null, sLine = x.sSig ? (x.sSig === 'home' ? x.sp : -x.sp) : null;
      return `<tr>
        <td style="white-space:nowrap" class="dim">${esc(fmtTime(g.start_time))}${st.when === 'all' ? `<br>${esc(fmtDay(g.start_time))}` : ''}</td>
        <td><div class="team">${logo(d.away)}<span>${d.away.rank ? `<span class="dim">${d.away.rank}</span> ` : ''}${esc(d.away.short)}</span></div><div class="team" style="margin-top:2px">${logo(d.home)}<span>${d.neutral ? 'vs' : '@'} ${d.home.rank ? `<span class="dim">${d.home.rank}</span> ` : ''}${esc(d.home.short)}</span></div>${x.early ? '<div class="dim" style="font-size:11px">early: under 5 games of data</div>' : x.wild ? '<div class="dim" style="font-size:11px">model far off the line: likely missing news, skipped</div>' : ''}</td>
        <td class="r num">${x.ln ?? '—'}<div class="dim">${x.sp !== null ? `${esc(d.home.abbr)} ${line(x.sp)}` : ''}</div></td>
        <td class="r num">${(x.p.ph + x.p.pa).toFixed(1)}<div class="dim">${esc(d.home.abbr)} ${line(-Math.round((x.p.ph - x.p.pa) * 2) / 2)}</div></td>
        <td class="r num">${x.d ? Number(x.d.dunkel_total) : '<span class="dim">—</span>'}<div class="dim">${x.d?.pick_side ? `${esc(team(x.d.pick_side).abbr)} ${line(Number(x.d.pick_line))}` : ''}</div></td>
        <td>${tLab ? `<div><span class="chip ${x.tAgree ? 'gold' : ''}">${esc(tLab)} · ${sgn(x.eT)}</span>${x.tAgree ? ' <span class="dim" style="font-size:11px">Dunkel agrees</span>' : ''}</div>` : ''}
            ${sTeam ? `<div style="margin-top:3px"><span class="chip ${x.sAgree ? 'gold' : ''}">${esc(sTeam.abbr)} ${line(sLine)} · ${sgn(Math.abs(x.eS))}</span>${x.sAgree ? ' <span class="dim" style="font-size:11px">Dunkel agrees</span>' : ''}</div>` : ''}</td>
        <td class="r" style="white-space:nowrap">${x.tSig ? trackBtn({ gid: String(g.id), market: 'tot', side: x.tSig, line: x.ln, label: tLab, game: `${d.away.short} @ ${d.home.short}`, start: g.start_time, tool: 'Full Court' }) : ''}${x.sSig ? ' ' + trackBtn({ gid: String(g.id), market: 'sp', side: x.sSig, line: sLine, label: `${sTeam.short} ${line(sLine)}`, game: `${d.away.short} @ ${d.home.short}`, start: g.start_time, tool: 'Full Court' }) : ''}</td></tr>`;
    };
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">College basketball</div><h1>Full Court</h1><p>Every Division I game, rated and filtered down to the ones where the numbers disagree with DraftKings, with the Dunkel Index as a second opinion.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How it works', `<ol>
      <li><b>Ratings:</b> every team’s offense and defense from its scores, adjusted for who it played, with recent games counting more and a home edge (none at neutral sites). Refit every day from games already played.</li>
      <li><b>A signal</b> is a game where the projected total is ${EDGE.tot}+ points off DraftKings, or the projected margin is ${EDGE.sp}+ points off the spread, and both teams have ${MIN_GP}+ games of data. Gaps bigger than ${CAP.tot} (totals) or ${CAP.sp} (spreads) are skipped: that far off, the model is usually the one missing something, like an injury. Gold means Dunkel’s own number points the same way.</li>
      <li><b>Graded honestly:</b> each past day is re-projected with only earlier games and graded at the closing line (table below). Early in the season ratings are rough; the record tells you when to trust them.</li>
      <li>With 150 games a night, the default list shows signals only. Switch to All games or search a team to see the rest.</li></ol>`, 'court')}
    <div class="grid g4" style="margin-bottom:12px">
      <div class="card stat"><div class="k">Totals, ${EDGE.tot}+ off</div><div class="v num">${rt(T(EDGE.tot))}</div><div class="s">${pct(rp(T(EDGE.tot)), 1)} · break-even ${pct(BE, 1)}</div></div>
      <div class="card stat"><div class="k">Spreads, ${EDGE.sp}+ off</div><div class="v num">${rt(S(EDGE.sp))}</div><div class="s">${pct(rp(S(EDGE.sp)), 1)} at the close</div></div>
      <div class="card stat"><div class="k">Dunkel totals</div><div class="v num">${rt(dkT)}</div><div class="s">${dkT.w + dkT.l ? pct(rp(dkT), 1) + ' · ' : ''}spreads ${rt(dkS)}</div></div>
      <div class="card stat"><div class="k">Both agree (totals)</div><div class="v num">${rt(both)}</div><div class="s">${both.w + both.l ? pct(rp(both), 1) : 'builds as games are graded'}</div></div></div>
    <div class="card" style="padding:4px 12px;overflow-x:auto;margin-bottom:12px"><table class="t"><tr><th>Model off DraftKings by</th>${[3, 5, 7, 9].map((t) => `<th class="r">Totals ${t}+</th>`).join('')}${[2, 4, 6].map((t) => `<th class="r">Spreads ${t}+</th>`).join('')}</tr>
      <tr><td class="dim">Graded at the close, since Nov 12</td>${[3, 5, 7, 9].map((t) => `<td class="r num">${chip(T(t))}</td>`).join('')}${[2, 4, 6].map((t) => `<td class="r num">${chip(S(t))}</td>`).join('')}</tr></table></div>
    ${(() => { const t = T(EDGE.tot), sp = S(EDGE.sp), ok = (r) => r.w + r.l >= 150 && rp(r) > BE; return ok(t) && ok(sp) ? '' : `<div class="card" style="border-color:#e0795a88;margin-bottom:12px;font-size:13.5px"><b class="clay">Early season: trust the gold rows first.</b> With only a handful of games per team, this model’s numbers miss by more than DraftKings’ do, and its own signals haven’t proven themselves yet (${rt(t)} on totals, ${rt(sp)} on spreads; it needs 150 graded plays above ${pct(BE, 1)} to count). The default list shows only games where it and the Dunkel Index agree. This note goes away once the record earns it.</div>`; })()}
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">${seg('when', [['today', 'Today'], ['tmr', 'Tomorrow'], ['all', 'Next 3 days']], st.when)}
      ${seg('view', [['signals', `Signals (${counts.sig})`], ['both', `Dunkel agrees (${counts.both})`], ['all', `All games (${counts.all})`]], st.view)}
      <input data-act="q" placeholder="Find a team" value="${esc(st.q)}" style="min-width:160px"></div>
    <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Tip</th><th>Game</th><th class="r">DraftKings</th><th class="r">Model</th><th class="r">Dunkel</th><th>Signal</th><th></th></tr>
      ${list.map(row).join('') || `<tr><td colspan="7" class="muted">${st.view === 'all' ? 'No games with lines in this window yet. Lines go up through the day.' : 'No signals in this window. Lines go up through the day; check back or switch to All games.'}</td></tr>`}</table></div>
    ${footNote('Scores and lines: ESPN (DraftKings), every 10 minutes. Second opinion: the Dunkel Index. Ratings and grading: this site. Not advice.')}`;
    onSeg(el, 'view', (v) => { st.view = v; store.set('court:view2', v); draw(); });
    onSeg(el, 'when', (v) => { st.when = v; store.set('court:when', v); draw(); });
    const q = el.querySelector('[data-act=q]'); q.oninput = () => { st.q = q.value; const pos = q.selectionStart; draw(); const n = el.querySelector('[data-act=q]'); n.focus(); n.setSelectionRange(pos, pos); };
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); render(el); };
    wireHow(el);
  }
  draw();
}
