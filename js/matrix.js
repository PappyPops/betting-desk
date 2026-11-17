import { games, esc, logo, seg, onSeg, store, pct, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache } from './core.js?v=202611162143';
import { nflHist, teamRows } from './hist.js?v=202611162143';

// Building blocks. Angles are 2–3 of these from different families.
const ATOMS = [
  ['loc', 'home', 'Home', (r) => r.home], ['loc', 'away', 'Road', (r) => !r.home && !r.neutral],
  ['role', 'fav', 'Favorite', (r) => r.fav], ['role', 'dog', 'Underdog', (r) => r.dog],
  ['size', 'small', 'Spread 3 or less', (r) => r.spread !== null && Math.abs(r.spread) <= 3], ['size', 'mid', 'Spread 3.5–6.5', (r) => r.spread !== null && Math.abs(r.spread) >= 3.5 && Math.abs(r.spread) <= 6.5], ['size', 'big', 'Spread 7+', (r) => r.spread !== null && Math.abs(r.spread) >= 7],
  ['div', 'div', 'Division game', (r) => r.div], ['div', 'nondiv', 'Non-division', (r) => !r.div],
  ['slot', 'prime', 'Prime time', (r) => r.hour !== null && r.hour >= 20], ['slot', 'early', '1 PM slot', (r) => r.hour !== null && r.hour < 15 && r.weekday === 'Sunday'], ['slot', 'late', 'Late afternoon', (r) => r.hour !== null && r.hour >= 15 && r.hour < 20 && r.weekday === 'Sunday'],
  ['rest', 'restadv', 'Rest edge 3+ days', (r) => r.rest !== null && r.oppRest !== null && r.rest - r.oppRest >= 3], ['rest', 'restdis', 'Rest deficit 3+ days', (r) => r.rest !== null && r.oppRest !== null && r.rest - r.oppRest <= -3], ['rest', 'bye', 'Off a bye', (r) => r.rest !== null && r.rest >= 13],
  ['prev', 'pcov', 'Covered last week by 10+', (r) => r.prevAts !== null && r.prevAts >= 10], ['prev', 'pmiss', 'Missed last week by 10+', (r) => r.prevAts !== null && r.prevAts <= -10],
  ['pwl', 'pwin', 'Won last game', (r) => r.prevMargin !== null && r.prevMargin > 0], ['pwl', 'ploss', 'Lost last game', (r) => r.prevMargin !== null && r.prevMargin < 0],
  ['phase', 'wk1', 'Weeks 1–4', (r) => r.week <= 4], ['phase', 'wk2', 'Weeks 5–12', (r) => r.week >= 5 && r.week <= 12], ['phase', 'wk3', 'Weeks 13+', (r) => r.week >= 13],
  ['tot', 'tothi', 'Total 47+', (r) => r.total !== null && r.total >= 47], ['tot', 'totlo', 'Total 41 or less', (r) => r.total !== null && r.total <= 41],
];
const BAR = 0.57, MIN_HALF = 35, MIN_ALL = 90;

const W = (n) => Math.ceil(n / 32);
function bits(n) { return new Uint32Array(W(n)); }
function set(b, i) { b[i >>> 5] |= 1 << (i & 31); }
function has(b, i) { return (b[i >>> 5] >>> (i & 31)) & 1; }
function pop(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function andCount(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += pop(a[i] & b[i]); return s; }

function build(rows) {
  const n = rows.length;
  const atomBits = ATOMS.map(([, , , f]) => { const b = bits(n); rows.forEach((r, i) => { if (f(r)) set(b, i); }); return b; });
  return { n, atomBits };
}

function evaluate(rows, atomBits, cover) {
  // cover: per-row 1 (covered) / 0 (missed) / -1 (push or unknown)
  const n = rows.length;
  const mk = (pred) => { const b = bits(n); rows.forEach((r, i) => { if (pred(r, i)) set(b, i); }); return b; };
  const decA = mk((r, i) => cover[i] >= 0 && r.season <= 2013), decB = mk((r, i) => cover[i] >= 0 && r.season >= 2014 && r.season <= 2025);
  const winA = mk((r, i) => cover[i] === 1 && r.season <= 2013), winB = mk((r, i) => cover[i] === 1 && r.season >= 2014 && r.season <= 2025);
  const dec26 = mk((r, i) => cover[i] >= 0 && r.season === 2026), win26 = mk((r, i) => cover[i] === 1 && r.season === 2026);
  const out = [];
  const fam = ATOMS.map((a) => a[0]);
  const tmp = bits(n);
  const consider = (ids) => {
    tmp.fill(0xffffffff);
    for (const id of ids) { const b = atomBits[id]; for (let i = 0; i < tmp.length; i++) tmp[i] &= b[i]; }
    const ones = tmp;
    const dA = andCount(ones, decA), dB = andCount(ones, decB);
    if (dA < MIN_HALF || dB < MIN_HALF || dA + dB < MIN_ALL) return;
    const wA = andCount(ones, winA), wB = andCount(ones, winB);
    const pA = wA / dA, pB = wB / dB;
    let kind = null;
    if (pA >= BAR && pB >= BAR) kind = 'play'; else if (pA <= 1 - BAR && pB <= 1 - BAR) kind = 'fade';
    if (!kind) return;
    const d26 = andCount(ones, dec26), w26 = andCount(ones, win26);
    out.push({ ids: [...ids], kind, wA, dA, wB, dB, w: wA + wB, d: dA + dB, w26, d26, mask: Uint32Array.from(ones) });
  };
  let tested = 0;
  for (let i = 0; i < ATOMS.length; i++) for (let j = i + 1; j < ATOMS.length; j++) {
    if (fam[i] === fam[j]) continue;
    tested++; consider([i, j]);
    for (let k = j + 1; k < ATOMS.length; k++) { if (fam[k] === fam[i] || fam[k] === fam[j]) continue; tested++; consider([i, j, k]); }
  }
  return { angles: out, tested };
}

export async function render(el) {
  const st = { tab: store.get('mx:tab', 'board') };
  el.innerHTML = '<div class="loading">Grading 24 years of NFL lines…</div>';
  const now = new Date();
  const [h, live] = await Promise.all([nflHist(), games({ league: 'nfl', from: new Date(now.getTime() - 6 * 3600e3).toISOString(), to: new Date(now.getTime() + 12 * 86400e3).toISOString() })]);
  // use the live DraftKings spread for games not yet played
  const liveById = new Map(live.map((g) => [g.id, g]));
  const hg = h.games.map((g) => {
    const lv = g.espn && liveById.get(String(g.espn));
    if (!g.done && lv && lv.spread_home !== null) return { ...g, hspread: Number(lv.spread_home), total_line: lv.total !== null ? Number(lv.total) : g.total_line, _live: lv };
    return { ...g, _live: lv };
  });
  const rows = teamRows(hg).filter((r) => r.reg && r.spread !== null);
  const cover = rows.map((r) => r.ats === null ? -1 : r.ats > 0 ? 1 : r.ats < 0 ? 0 : -1);
  const { atomBits } = build(rows);
  await new Promise((r) => setTimeout(r, 0));
  const res = evaluate(rows, atomBits, cover);
  // luck check: same test on coin-flip results (keeping each game's two sides opposite)
  let luck = 0;
  for (let s = 0; s < 4; s++) {
    const flip = new Map();
    const fake = rows.map((r, i) => {
      if (cover[i] === -1) return -1;
      const k = r.g; if (!flip.has(k)) flip.set(k, Math.random() < 0.5 ? 1 : 0);
      return r.side === 'home' ? flip.get(k) : 1 - flip.get(k);
    });
    luck += evaluate(rows, atomBits, fake).angles.length / 4;
  }

  // upcoming week
  const pre = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.season === 2026 && !r.g.done && r.g._live && r.g._live.state === 'pre');
  const nextWeek = Math.min(...pre.map(({ r }) => r.week));
  const weekRows = pre.filter(({ r }) => r.week === nextWeek);
  const sideAngles = (i) => res.angles.filter((a) => has(a.mask, i));
  const games2 = new Map();
  for (const { r, i } of weekRows) {
    const key = r.g.espn;
    if (!games2.has(key)) games2.set(key, { g: r.g, sides: {} });
    const a = sideAngles(i);
    games2.get(key).sides[r.side] = { r, plays: a.filter((x) => x.kind === 'play'), fades: a.filter((x) => x.kind === 'fade') };
  }
  // score each side: its plays + the other side's fades
  const cards = [...games2.values()].map((x) => {
    const H = x.sides.home, A = x.sides.away;
    const score = (me, op) => (me?.plays.length || 0) + (op?.fades.length || 0);
    const sh = score(H, A), sa = score(A, H);
    return { ...x, sh, sa, lean: sh > sa ? 'home' : sa > sh ? 'away' : null, gap: Math.abs(sh - sa) };
  }).sort((a, b) => new Date(a.g._live.start_time) - new Date(b.g._live.start_time));

  // this season: did the side with more agreeing angles cover?
  let sw = 0, sl = 0;
  const byGame = new Map();
  rows.forEach((r, i) => { if (r.season === 2026 && r.g.done) { const k = r.g; if (!byGame.has(k)) byGame.set(k, {}); byGame.get(k)[r.side] = i; } });
  for (const [, s] of byGame) {
    if (s.home === undefined || s.away === undefined) continue;
    const cnt = (me, op) => sideAngles(me).filter((a) => a.kind === 'play').length + sideAngles(op).filter((a) => a.kind === 'fade').length;
    const ch = cnt(s.home, s.away), ca = cnt(s.away, s.home);
    if (ch === ca) continue;
    const side = ch > ca ? s.home : s.away;
    if (cover[side] === 1) sw++; else if (cover[side] === 0) sl++;
  }

  const plays = res.angles.filter((a) => a.kind === 'play').length, fades = res.angles.length - plays;
  const name = (a) => a.ids.map((id) => ATOMS[id][2]).join(' · ');
  const rate = (a) => a.kind === 'play' ? a.w / a.d : 1 - a.w / a.d;
  const angleLine = (a, team) => `<div style="padding:6px 0;border-top:1px solid var(--line);font-size:13.5px">
    <div class="row" style="justify-content:space-between"><span>${a.kind === 'fade' ? `<span class="chip clay">Fade</span> ` : ''}${esc(name(a))}</span><b class="num">${pct(rate(a), 1)}</b></div>
    <div class="dim" style="font-size:12px">${a.kind === 'fade' ? 'Opponents' : esc(team)} ${a.kind === 'play' ? a.w : a.d - a.w}–${a.kind === 'play' ? a.d - a.w : a.w} since 2002 · ${pct(a.kind === 'play' ? a.wA / a.dA : 1 - a.wA / a.dA, 0)} then ${pct(a.kind === 'play' ? a.wB / a.dB : 1 - a.wB / a.dB, 0)} · 2026 ${a.d26 ? (a.kind === 'play' ? `${a.w26}–${a.d26 - a.w26}` : `${a.d26 - a.w26}–${a.w26}`) : '—'}</div></div>`;

  function draw() {
    const clusters = cards.filter((c) => c.gap >= 2).sort((a, b) => b.gap - a.gap).slice(0, 6);
    const lib = [...res.angles].sort((a, b) => rate(b) - rate(a));
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">NFL angles</div><h1>Matrix</h1><p>Situations that covered the spread at 57% or better in <i>both</i> halves of NFL history (2002–2013 and 2014–2025), matched to this week’s games.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('Read this first', `<ol>
      <li>An angle is two or three situations combined, like “Road · Underdog · Off a bye.” Every combination is graded against the closing spread.</li>
      <li>Testing ${res.tested.toLocaleString()} combinations means some will look great by luck. Running the same test on coin-flip results passes about <b>${Math.round(luck)}</b>; the real data passes <b>${res.angles.length}</b>. That gap is the only part that might be real.</li>
      <li>The honest score is this season: when more angles sided with one team, that team covered <b>${sw}–${sl}</b> in 2026. Treat angles as a tiebreaker, not a pick.</li></ol>`, 'mx')}
    ${res.angles.length <= Math.max(luck * 2, luck + 6) ? `<div class="card" style="border-color:#e0795a88;margin-bottom:12px"><b class="clay">Verdict:</b> <span class="muted">the real data passes about as many angles as coin flips would (${res.angles.length} vs ~${Math.round(luck)}). There’s no evidence these situations beat the closing spread, so don’t bet them on their own.</span></div>` : ''}
    <div class="grid g4">
      <div class="card stat"><div class="k">Angles tested</div><div class="v num">${res.tested.toLocaleString()}</div><div class="s">2 and 3-way combinations</div></div>
      <div class="card stat"><div class="k">Passed both halves</div><div class="v num">${res.angles.length}</div><div class="s">${plays} plays · ${fades} fades</div></div>
      <div class="card stat"><div class="k">Luck would pass</div><div class="v num">~${Math.round(luck)}</div><div class="s">same test, coin-flip results</div></div>
      <div class="card stat"><div class="k">2026 so far</div><div class="v num">${sw}–${sl}</div><div class="s">side with more angles, ATS</div></div>
    </div>
    <div class="row" style="margin-top:18px">${seg('tab', [['board', `Week ${Number.isFinite(nextWeek) ? nextWeek : ''} board`], ['lib', 'Library']], st.tab)}</div>
    ${st.tab === 'board' ? `
      ${clusters.length ? `<div class="sec"><h2>Where angles agree</h2><p class="sub">Games where one side has at least two more angles than the other.</p>
        <div class="grid g3">${clusters.map((c) => { const t = c.g._live.data[c.lean]; const sp = c.lean === 'home' ? Number(c.g._live.spread_home) : -Number(c.g._live.spread_home);
          return `<div class="card hl"><div class="row" style="justify-content:space-between"><span class="team">${logo(t)}<b>${esc(t.short)} ${line(sp)}</b></span><span class="chip gold">${Math.max(c.sh, c.sa)} to ${Math.min(c.sh, c.sa)}</span></div>
          <div class="dim" style="font-size:12.5px;margin-top:4px">${esc(c.g._live.data.away.abbr)} @ ${esc(c.g._live.data.home.abbr)} · ${esc(fmtDay(c.g._live.start_time))} ${esc(fmtTime(c.g._live.start_time))}</div></div>`; }).join('')}</div></div>` : ''}
      <div class="sec"><h2>Every game</h2><p class="sub">Spreads are DraftKings now. Each angle shows its full record, each half, and 2026.</p>
      <div class="grid g2">${cards.map((c) => {
        const lv = c.g._live, d = lv.data;
        const col = (side) => { const s = c.sides[side], o = c.sides[side === 'home' ? 'away' : 'home']; const t = d[side];
          const sp = side === 'home' ? Number(lv.spread_home) : -Number(lv.spread_home);
          const list = [...(s?.plays || []).map((a) => angleLine(a, t.short)), ...(o?.fades || []).map((a) => angleLine(a, t.short))];
          return `<div><div class="row" style="justify-content:space-between"><span class="team">${logo(t)}<b>${esc(t.short)} ${line(sp)}</b></span><span class="chip ${c.lean === side ? 'gold' : ''}">${side === 'home' ? c.sh : c.sa}</span></div>${list.slice(0, 4).join('') || '<div class="dim" style="font-size:12.5px;padding:6px 0">No angles</div>'}${list.length > 4 ? `<div class="dim" style="font-size:12px">+ ${list.length - 4} more</div>` : ''}</div>`; };
        return `<div class="card"><div class="dim" style="font-size:12.5px;margin-bottom:8px">${esc(fmtDay(lv.start_time))} ${esc(fmtTime(lv.start_time))}${c.g.div_game ? ' · Division' : ''}${d.neutral ? ' · Neutral' : ''}</div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">${col('away')}${col('home')}</div></div>`;
      }).join('') || '<div class="empty">No games with lines yet this week.</div>'}</div></div>`
    : `<div class="sec"><h2>Library</h2><p class="sub">Every angle that passed, best first. Rates are against the closing spread; pushes don’t count.</p>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Angle</th><th class="r">Record</th><th class="r">2002–13</th><th class="r">2014–25</th><th class="r">2026</th></tr>
      ${lib.map((a) => { const r = rate(a); const w = a.kind === 'play' ? a.w : a.d - a.w; const w26 = a.kind === 'play' ? a.w26 : a.d26 - a.w26;
        return `<tr><td>${a.kind === 'fade' ? '<span class="chip clay">Fade</span> ' : ''}${esc(name(a))}</td><td class="r num">${w}–${a.d - w}<div class="dim" style="font-size:12px">${pct(r, 1)}</div></td>
        <td class="r num">${pct(a.kind === 'play' ? a.wA / a.dA : 1 - a.wA / a.dA, 1)}</td><td class="r num">${pct(a.kind === 'play' ? a.wB / a.dB : 1 - a.wB / a.dB, 1)}</td>
        <td class="r num">${a.d26 ? `${w26}–${a.d26 - w26}` : '—'}</td></tr>`; }).join('')}</table></div></div>`}
    ${footNote('History: nflverse closing spreads, regular season 2002–2026. Current spreads: DraftKings via ESPN. Reference only, not a recommendation.')}`;
    onSeg(el, 'tab', (v) => { st.tab = v; store.set('mx:tab', v); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); render(el); };
    wireHow(el);
  }
  draw();
}
