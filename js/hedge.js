// Hedge and middle finder. Your bet is on side A; the hedge is the other side at the live number.
// Everything is put on one scale X (the final total, or your side's margin) where your bet wins above `a` and the
// hedge wins below `b`. If a < b there's a middle (both win); if a > b there's a gap where both lose.
// Chances come from the live number itself (the market's best guess) with a spread that shrinks as the game runs out.
import { esc, store } from './core.js?v=202611221433';

export const decOf = (am) => am > 0 ? 1 + am / 100 : 1 + 100 / -am;
const SD = { nfl: { tot: 13.5, sp: 13.5 }, cfb: { tot: 16, sp: 15.5 }, nba: { tot: 17, sp: 12.5 }, cbb: { tot: 14, sp: 11 } };
const ncdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

// inputs: mk ('tot'|'sp'|'ml'), side ('over'|'under'|'mine' for spreads/ML), line1 (your number), odds1, stake1,
// line2 (hedge number: the other total, or the other team's spread), odds2, lg, left (share of game left, 0-1)
export function analyze(i) {
  const d1 = decOf(i.odds1), d2 = decOf(i.odds2), s1 = i.stake1;
  const plans = [
    { key: 'even', lab: 'Lock the same profit either way', h: s1 * d1 / d2 },
    { key: 'back', lab: 'Get your stake back if yours loses', h: s1 / (d2 - 1) },
  ];
  if (i.custom > 0) plans.push({ key: 'custom', lab: 'Your amount', h: i.custom });
  if (i.mk === 'ml') {
    // chance your side wins, from the hedge price with a typical 2.4% cut removed
    const pB = Math.min(0.99, (1 / d2) / 1.024), pA = 1 - pB;
    return { mk: 'ml', pA, plans: plans.map((p) => { const winA = s1 * (d1 - 1) - p.h, winB = p.h * (d2 - 1) - s1; return { ...p, rows: [{ lab: 'Your side wins', prob: pA, profit: winA }, { lab: 'Hedge wins', prob: pB, profit: winB }], ev: pA * winA + pB * winB }; }) };
  }
  // put both bets on one scale: your bet wins when X > a, the hedge wins when X < b
  let a, b, center;
  if (i.mk === 'tot') { if (i.side === 'over') { a = i.line1; b = i.line2; center = i.line2; } else { a = -i.line1; b = -i.line2; center = -i.line2; } }
  else { a = -i.line1; b = i.line2; center = i.line2; } // spread: X = your team's margin; you win if X + line1 > 0, hedge wins if X < line2
  const sd = Math.max(1.5, (SD[i.lg] ?? SD.nfl)[i.mk] * Math.sqrt(Math.max(0.02, i.left)));
  const lo = Math.floor(center - 5 * sd), hi = Math.ceil(center + 5 * sd);
  const cells = [];
  for (let x = lo; x <= hi; x++) {
    const p = ncdf((x + 0.5 - center) / sd) - ncdf((x - 0.5 - center) / sd);
    const rA = x > a ? 'W' : x === a ? 'P' : 'L', rB = x < b ? 'W' : x === b ? 'P' : 'L';
    cells.push({ x, p, rA, rB });
  }
  const groups = { both: 0, A: 0, B: 0, none: 0, push: 0 };
  for (const c of cells) { const k = c.rA === 'W' && c.rB === 'W' ? 'both' : c.rA === 'W' ? 'A' : c.rB === 'W' ? 'B' : c.rA === 'L' && c.rB === 'L' ? 'none' : 'push'; groups[k] += c.p; }
  const profitAt = (c, h) => (c.rA === 'W' ? s1 * (d1 - 1) : c.rA === 'L' ? -s1 : 0) + (c.rB === 'W' ? h * (d2 - 1) : c.rB === 'L' ? -h : 0);
  const show = (x) => i.mk === 'tot' ? (i.side === 'over' ? x : -x) : x;
  const win = a < b ? { from: show(Math.floor(a) + 1), to: show(Math.ceil(b) - 1) } : null; // whole numbers where both win
  return {
    mk: i.mk, a, b, center, sd, groups, win,
    plans: plans.map((p) => {
      const rows = [];
      const add = (lab, k, filt) => { const cs = cells.filter(filt); const pr = cs.reduce((s, c) => s + c.p, 0); if (pr < 0.0005 && k !== 'A' && k !== 'B') return; rows.push({ lab, prob: pr, profit: cs.length ? cs.reduce((s, c) => s + c.p * profitAt(c, p.h), 0) / (pr || 1) : 0 }); };
      add('Only your bet wins', 'A', (c) => c.rA === 'W' && c.rB !== 'W');
      add(a < b ? 'Both win (the middle)' : 'Both win', 'both', (c) => c.rA === 'W' && c.rB === 'W');
      add('Only the hedge wins', 'B', (c) => c.rB === 'W' && c.rA !== 'W');
      add(a > b ? 'Both lose (the gap)' : 'Both lose', 'none', (c) => c.rA === 'L' && c.rB === 'L');
      add('A push on one side', 'push', (c) => (c.rA === 'P' || c.rB === 'P') && !(c.rA === 'W' && c.rB === 'W'));
      return { ...p, rows, ev: cells.reduce((s, c) => s + c.p * profitAt(c, p.h), 0) };
    }),
  };
}

const money = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(2)}`;
const pc = (p) => p < 0.01 && p > 0 ? '<1%' : `${Math.round(p * 100)}%`;
const LEFT = [[1, 'Pregame'], [0.75, 'After Q1'], [0.5, 'Halftime'], [0.25, 'After Q3'], [0.1, 'Late Q4']];
const inp = (k, v, w = 70) => `<input data-h="${k}" value="${v ?? ''}" class="num" style="width:${w}px;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:3px 6px">`;
const sel = (k, opts, v) => `<select data-h="${k}" style="background:var(--surface2);color:inherit;border:1px solid var(--line2);border-radius:6px;padding:3px 6px">${opts.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;

// a self-contained panel; `init` comes from a tracked bet or is blank for the free calculator
export function mountHedge(box, init = {}) {
  const st = { mk: 'tot', side: 'over', line1: '', odds1: -110, stake1: 10, line2: '', odds2: -110, lg: 'nfl', left: 0.5, custom: '', title: '', ...init };
  const draw = () => {
    const ready = Number.isFinite(+st.odds1) && Math.abs(+st.odds1) >= 100 && Number.isFinite(+st.odds2) && Math.abs(+st.odds2) >= 100 && +st.stake1 > 0 && (st.mk === 'ml' || (st.line1 !== '' && st.line2 !== '' && Number.isFinite(+st.line1) && Number.isFinite(+st.line2)));
    const r = ready ? analyze({ mk: st.mk, side: st.side, line1: +st.line1, odds1: +st.odds1, stake1: +st.stake1, line2: +st.line2, odds2: +st.odds2, lg: st.lg, left: +st.left, custom: +st.custom }) : null;
    const hedgeLab = st.mk === 'tot' ? `${st.side === 'over' ? 'Under' : 'Over'} (live)` : st.mk === 'sp' ? 'Other team’s spread (live)' : 'Other side’s price (live)';
    box.innerHTML = `<div class="card" style="margin-top:10px">
      ${st.title ? `<b>${esc(st.title)}</b>` : '<b>Hedge and middle calculator</b>'}
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;font-size:13px">
        <span>${sel('lg', [['nfl', 'NFL'], ['cfb', 'College FB'], ['nba', 'NBA'], ['cbb', 'College BB']], st.lg)}</span>
        <span>${sel('mk', [['tot', 'Total'], ['sp', 'Spread'], ['ml', 'Moneyline']], st.mk)}</span>
        ${st.mk === 'tot' ? `<span>${sel('side', [['over', 'I have the Over'], ['under', 'I have the Under']], st.side)}</span>` : ''}
        <span>Time left ${sel('left', LEFT, st.left)}</span></div>
      <div class="grid g2" style="margin-top:10px;font-size:13px">
        <div><div class="kicker" style="color:var(--muted)">Your bet</div>${st.mk !== 'ml' ? `Line ${inp('line1', st.line1, 64)} ` : ''}Odds ${inp('odds1', st.odds1, 64)} Stake $${inp('stake1', st.stake1, 64)}</div>
        <div><div class="kicker" style="color:var(--muted)">${esc(hedgeLab)}</div>${st.mk !== 'ml' ? `Line ${inp('line2', st.line2, 64)} ` : ''}Odds ${inp('odds2', st.odds2, 64)} Custom $${inp('custom', st.custom, 64)}</div></div>
      ${st.mk === 'sp' ? '<p class="dim" style="font-size:12px;margin:6px 0 0">Spreads: enter each line from its own team’s side, e.g. yours −3, the hedge +7.</p>' : ''}
      ${!r ? '<p class="dim" style="font-size:13px;margin:10px 0 0">Fill in both numbers to see the options.</p>' : `
      ${r.mk !== 'ml' ? `<div style="margin:12px 0 4px;font-size:14px">${r.win ? `<b class="gold">Middle:</b> both bets win if the ${st.mk === 'tot' ? 'final total' : 'margin'} lands ${r.win.from === r.win.to ? `exactly on ${r.win.from}` : `between ${Math.min(r.win.from, r.win.to)} and ${Math.max(r.win.from, r.win.to)}`}, about <b>${pc(r.groups.both)}</b> from here.` : r.a > r.b ? `<b class="clay">No middle:</b> the live number moved against you, so there’s a ${pc(r.groups.none)} gap where both bets lose. Hedging here mostly buys certainty, not profit.` : '<b>No middle:</b> the numbers are the same, so a hedge just locks in a result.'}</div>` : ''}
      <div class="grid g${r.plans.length}" style="margin-top:10px">${r.plans.map((p) => `<div class="stat" style="background:var(--surface2);border-radius:10px;padding:10px">
        <div class="k">${esc(p.lab)}</div><div class="v num" style="font-size:20px">Bet ${money(p.h)}</div>
        <table class="t" style="margin-top:6px;font-size:12.5px">${p.rows.map((x) => `<tr><td>${esc(x.lab)}</td><td class="r num dim">${pc(x.prob)}</td><td class="r num ${x.profit >= 0 ? 'mint' : 'clay'}">${x.profit >= 0 ? '+' : ''}${money(x.profit)}</td></tr>`).join('')}</table>
        <div class="dim" style="font-size:12px;margin-top:4px">Expected ${p.ev >= 0 ? '+' : ''}${money(p.ev)} vs ${(() => { const ne = r.plans[0] ? noHedgeEV(st, r) : 0; return `${ne >= 0 ? '+' : ''}${money(ne)} without a hedge`; })()}</div></div>`).join('')}</div>
      <p class="dim" style="font-size:12px;margin:8px 0 0">Chances use the live number as the market’s best guess, with a spread that narrows as the game runs out (${st.mk === 'ml' ? 'from the hedge price with the book’s cut removed' : `about ±${r.sd.toFixed(1)} points from here`}). A hedge without a middle usually costs a little expected value, the book’s cut on the second bet, in exchange for a sure result. A real middle can pay for itself.</p>`}
    </div>`;
    box.querySelectorAll('[data-h]').forEach((e) => e.onchange = () => { st[e.dataset.h] = e.value; if (e.dataset.h === 'mk' && st.mk !== 'tot') st.side = 'mine'; if (e.dataset.h === 'mk' && st.mk === 'tot') st.side = 'over'; draw(); });
  };
  draw();
}
// expected value of keeping only your bet, on the same chances
function noHedgeEV(st, r) {
  const d1 = decOf(+st.odds1), s1 = +st.stake1;
  if (r.mk === 'ml') return r.pA * s1 * (d1 - 1) - (1 - r.pA) * s1;
  const pWin = 1 - ncdf((r.a + 0.5 - r.center) / r.sd), pPush = Number.isInteger(r.a) ? ncdf((r.a + 0.5 - r.center) / r.sd) - ncdf((r.a - 0.5 - r.center) / r.sd) : 0;
  return pWin * s1 * (d1 - 1) - (1 - pWin - pPush) * s1;
}
