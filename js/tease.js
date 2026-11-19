import { games, esc, logo, seg, onSeg, store, line, odds, pct, decOdds, fmtTime, fmtDay, howTo, wireHow, footNote, copy, ncdf, clearCache, sgn } from './core.js?v=202611192337';
import { nflHist, teamRows } from './hist.js?v=202611192337';

// The model is an estimate, so a slip needs a real cushion (3%+) before it's called a play.
const EDGE = 0.03;
const DEF_PRICES = { 6: [-120, 160], 6.5: [-130, 150], 7: [-140, 130], 10: [-260, -120] };

let rowsMemo = null;
async function histRows() {
  if (rowsMemo) return rowsMemo;
  const h = await nflHist();
  rowsMemo = teamRows(h.games).filter((r) => r.g.done && r.spread !== null && r.season < 2026);
  return rowsMemo;
}

// Chance a side covers its teased number, from every NFL side since 2002 with a similar closing spread.
function nflCover(rows, s, t) {
  let w = 0, win = 0, push = 0, n = 0;
  for (const width of [1, 2, 3]) {
    w = 0; win = 0; push = 0; n = 0;
    for (const r of rows) {
      const d = Math.abs(r.spread - s);
      if (d > width) continue;
      const wt = d === 0 ? 1 : d <= 0.5 ? 0.6 : d <= 1 ? 0.3 : 0.15;
      const m = r.margin + t;
      w += wt; n++;
      if (m > 0) win += wt; else if (m === 0) push += wt;
    }
    if (n >= 120) break;
  }
  return { pc: w ? win / w : null, pp: w ? push / w : 0, n };
}
function cfbCover(s, t) {
  // College margins are wider and lumpier at different numbers; a plain bell curve around the spread (sd 16).
  const exp = -s; const sd = 16;
  const pc = 1 - ncdf((-t - exp + 0.5) / sd);
  return { pc, pp: 0, n: 0 };
}
function keyTag(s, t) {
  // margins gained by moving from s to t: (−t, −s]
  const lo = -t, hi = -s;
  const has = (k) => k > lo && k <= hi;
  const both = (has(3) && has(7)) || (has(-3) && has(-7));
  const any = has(3) || has(7) || has(-3) || has(-7);
  return both ? 'both' : any ? 'any' : '';
}

export async function render(el) {
  const st = {
    lg: store.get('tease:lg', 'nfl'), pts: store.get('tease:pts', 6), wk: 'this',
    pushLoses: store.get('tease:push', false), filter: 'all',
    prices: store.get('tease:prices', DEF_PRICES), slip: [],
  };
  let legs = [], weekLabel = '';
  const rows = await histRows();

  async function load() {
    el.innerHTML = '<div class="loading">Pulling the slate…</div>';
    const now = new Date();
    const list = await games({ league: st.lg, from: new Date(now.getTime() - 4 * 3600e3).toISOString(), to: new Date(now.getTime() + 16 * 86400e3).toISOString() });
    const pre = list.filter((g) => g.state === 'pre' && g.spread_home !== null);
    const weeks = [...new Set(pre.map((g) => g.week))].sort((a, b) => a - b);
    const wk = st.wk === 'next' ? weeks[1] : weeks[0];
    weekLabel = wk ? `Week ${wk}` : '';
    legs = [];
    for (const g of pre.filter((x) => x.week === wk)) {
      for (const side of ['away', 'home']) {
        const s = side === 'home' ? Number(g.spread_home) : -Number(g.spread_home);
        const t = s + Number(st.pts);
        const c = st.lg === 'nfl' ? nflCover(rows, s, t) : cfbCover(s, t);
        const open = g.open_spread_home === null ? null : (side === 'home' ? Number(g.open_spread_home) : -Number(g.open_spread_home));
        legs.push({ id: `${g.id}:${side}`, gid: g.id, g, side, team: g.data[side], opp: g.data[side === 'home' ? 'away' : 'home'], s, t, open, ...c, key: keyTag(s, t) });
      }
    }
    draw();
  }

  const price = (n) => n === 2 ? st.prices[st.pts][0] : st.prices[st.pts][1];
  const legP = (l) => st.pushLoses ? l.pc : l.pc + l.pp;
  function slipEV(ls) {
    const pr = price(ls.length);
    const p = ls.reduce((a, l) => a * legP(l), 1);
    return { p, ev: p * decOdds(pr) - 1, pr };
  }
  function bestSlips() {
    const cand = legs.filter((l) => l.pc !== null).sort((a, b) => legP(b) - legP(a)).slice(0, 16);
    const out = [];
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      if (cand[i].gid === cand[j].gid) continue;
      out.push([cand[i], cand[j]]);
      for (let k = j + 1; k < cand.length; k++) { if (cand[k].gid === cand[i].gid || cand[k].gid === cand[j].gid) continue; out.push([cand[i], cand[j], cand[k]]); }
    }
    return out.map((ls) => ({ ls, ...slipEV(ls) })).sort((a, b) => b.ev - a.ev);
  }

  function slipCard(s, title) {
    const good = s.ev >= EDGE, thin = s.ev > 0 && !good;
    return `<div class="card ${good ? 'hl' : ''}">
      <div class="row" style="justify-content:space-between"><b>${esc(title)}</b><span class="chip ${good ? 'gold' : ''}">${good ? 'Plays' : thin ? 'Thin' : 'Pass'} · ${sgn(s.ev * 100, 1)}%</span></div>
      <div class="muted" style="font-size:13px;margin:4px 0 8px">${s.ls.length} legs at ${st.pts} pts, ${odds(s.pr)} · all legs hit ${pct(s.p, 1)} · break-even ${pct(1 / decOdds(s.pr), 1)}</div>
      ${s.ls.map((l) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-top:1px solid var(--line)"><span class="team">${logo(l.team)}<span>${esc(l.team.short)} ${line(l.s)} → <b>${line(l.t)}</b></span></span><span class="num">${pct(legP(l), 1)}</span></div>`).join('')}
      <div style="margin-top:8px"><button class="btn" data-copy="${esc(s.ls.map((l) => `${l.team.abbr} ${line(l.t)}`).join(', ') + ` (${st.pts}-pt teaser, ${odds(s.pr)})`)}">Copy slip</button></div></div>`;
  }

  function draw() {
    const be2 = Math.sqrt(1 / decOdds(price(2))), be3 = Math.cbrt(1 / decOdds(price(3)));
    const shown = legs.filter((l) => st.filter === 'all' || (st.filter === 'both' ? l.key === 'both' : l.key))
      .sort((a, b) => new Date(a.g.start_time) - new Date(b.g.start_time) || a.gid.localeCompare(b.gid));
    const best = bestSlips();
    const plays = best.filter((s) => s.ev >= EDGE).slice(0, 4);
    const near = best.slice(0, 2);
    const mine = st.slip.map((id) => legs.find((l) => l.id === id)).filter(Boolean);

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Teaser calculator</div><h1>Tease Me</h1><p>Every side on the board, teased. A slip only shows as a play when the legs together beat the price after you buy the points.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How the edge is counted', `<ol>
      <li>Each leg’s chance comes from every NFL side since 2002 that closed at about the same spread: how often it would have covered the teased number. That keeps the real bumps at 3 and 7 instead of smoothing them away.</li>
      <li>A teaser pays only if every leg covers. The slip’s chance is the legs multiplied together, then compared with the payout. Break-even per leg is shown on the board.</li>
      <li>Legs are treated as independent and lines move, so this is an estimate. College uses a plain bell curve and is rougher.</li></ol>`, 'tease')}
    <div class="row" style="margin-bottom:10px">
      ${seg('lg', [['nfl', 'NFL'], ['cfb', 'College']], st.lg)}
      ${seg('wk', [['this', 'This week'], ['next', 'Next week']], st.wk)}
      ${seg('pts', [6, 6.5, 7, 10].map((p) => [p, `${p} pts`]), st.pts)}
    </div>
    <div class="row" style="margin-bottom:6px;font-size:13.5px">
      <label>2-leg price <input data-price="0" value="${odds(price(2)).replace('−', '-')}" style="width:76px"></label>
      <label>3-leg price <input data-price="1" value="${odds(price(3)).replace('−', '-')}" style="width:76px"></label>
      <label class="row" style="gap:6px"><input type="checkbox" data-act="push" ${st.pushLoses ? 'checked' : ''}> A push loses the slip</label>
    </div>
    <p class="stamp">${esc(weekLabel)} · ${legs.length / 2} games · DraftKings spreads via ESPN · leg break-even ${pct(be2, 1)} (2 legs), ${pct(be3, 1)} (3 legs)</p>

    <div class="sec"><h2>${plays.length ? 'Slips that clear the price' : 'Nothing clears this price'}</h2>
      <p class="sub">${plays.length ? 'Best combinations on the board right now.' : 'Closest slips below. A slip needs about 3% of cushion to count, since the model is an estimate. Try a friendlier price or another point count.'}</p>
      <div class="grid g2">${(plays.length ? plays : near).map((s, i) => slipCard(s, plays.length ? `Slip ${i + 1}` : `Closest ${i + 1}`)).join('') || '<div class="empty">No lines posted yet.</div>'}</div></div>

    <div class="sec"><h2>Your slip</h2><p class="sub">Tap sides on the board to build your own.</p>
      ${mine.length ? (() => { const s = mine.length >= 2 && mine.length <= 3 ? slipEV(mine) : null; return s ? slipCard({ ls: mine, ...s }, 'Your slip') : `<div class="card">${mine.map((l) => esc(`${l.team.short} ${line(l.t)}`)).join(', ')} <span class="muted">· pick ${mine.length < 2 ? 'at least 2' : 'at most 3'} legs</span></div>`; })() : '<div class="empty">Nothing picked yet.</div>'}
      ${mine.length ? '<div style="margin-top:8px"><button class="btn" data-act="clear">Clear slip</button></div>' : ''}</div>

    <div class="sec"><div class="row" style="justify-content:space-between"><h2>The board</h2>${seg('filter', [['all', 'All sides'], ['both', 'Through 3 and 7'], ['any', 'Through a key']], st.filter)}</div>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t">
      <tr><th>Side</th><th class="r">Open</th><th class="r">Now</th><th class="r">Teased</th><th>Crosses</th><th class="r">Cover</th><th></th></tr>
      ${shown.map((l) => {
        const p = legP(l), ok = p !== null && p >= be2, inSlip = st.slip.includes(l.id);
        return `<tr class="click" data-leg="${l.id}">
          <td><div class="team">${logo(l.team)}<span><b>${esc(l.team.short)}</b> <span class="dim">${l.side === 'home' ? 'vs' : '@'} ${esc(l.opp.abbr)} · ${esc(fmtDay(l.g.start_time))} ${esc(fmtTime(l.g.start_time))}</span></span></div></td>
          <td class="r num dim">${line(l.open)}</td><td class="r num">${line(l.s)}</td><td class="r num"><b>${line(l.t)}</b></td>
          <td>${l.key === 'both' ? '<span class="chip gold">3 and 7</span>' : l.key ? '<span class="chip">a key</span>' : ''}</td>
          <td class="r num ${ok ? 'mint' : ''}">${pct(p, 1)}${st.lg === 'nfl' ? `<div class="dim" style="font-size:11px">${l.n} games</div>` : ''}</td>
          <td class="r">${inSlip ? '<span class="chip gold">In slip</span>' : '<span class="chip">+ Add</span>'}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No spreads posted yet for this week.</td></tr>'}
      </table></div></div>
    ${footNote('Spreads are DraftKings numbers as shown on ESPN, updated every 5 minutes. History: nflverse closing lines, 2002–2025. Even a plus-EV slip loses plenty of weeks.')}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('tease:lg', v); st.slip = []; load(); });
    onSeg(el, 'wk', (v) => { st.wk = v; st.slip = []; load(); });
    onSeg(el, 'pts', (v) => { st.pts = Number(v); store.set('tease:pts', st.pts); st.slip = []; load(); });
    onSeg(el, 'filter', (v) => { st.filter = v; draw(); });
    el.querySelector('[data-act=push]').onchange = (e) => { st.pushLoses = e.target.checked; store.set('tease:push', st.pushLoses); draw(); };
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    el.querySelector('[data-act=clear]')?.addEventListener('click', () => { st.slip = []; draw(); });
    el.querySelectorAll('[data-price]').forEach((inp) => inp.onchange = () => {
      const v = Number(inp.value.replace('−', '-').replace('+', ''));
      if (!Number.isFinite(v) || Math.abs(v) < 100) { inp.value = odds(price(inp.dataset.price === '0' ? 2 : 3)); return; }
      st.prices = { ...st.prices, [st.pts]: inp.dataset.price === '0' ? [v, price(3)] : [price(2), v] };
      store.set('tease:prices', st.prices); draw();
    });
    el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(b.dataset.copy));
    el.querySelectorAll('[data-leg]').forEach((tr) => tr.onclick = () => {
      const l = legs.find((x) => x.id === tr.dataset.leg);
      if (st.slip.includes(l.id)) st.slip = st.slip.filter((x) => x !== l.id);
      else { st.slip = st.slip.filter((x) => !x.startsWith(l.gid + ':')); if (st.slip.length < 3) st.slip.push(l.id); }
      draw();
    });
    wireHow(el);
  }
  await load();
}
