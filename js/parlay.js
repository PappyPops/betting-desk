// Parlay checker: build a ticket from any upcoming game and see, leg by leg, what each one is really worth.
// A leg's chance starts from the market's own price with the book's cut removed (a coin flip at -110/-110).
// When the Today page's best bets back that exact side, its graded edge is added. The ticket's chance is the legs
// multiplied together, which is right for different games; same-game legs get flagged because they move together.
import { games, esc, logo, line, odds, pct, decOdds, fmtDay, fmtTime, store, copy } from './core.js?v=202611221444';
import { bestBets } from './bets.js?v=202611221444';

const LG = [['nfl', 'NFL'], ['cfb', 'College FB'], ['nba', 'NBA']];
const amOf = (dec) => dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
const noVig = (a, b) => { const x = 1 / decOdds(a), y = 1 / decOdds(b); return x / (x + y); };

export async function mountParlay(el) {
  const st = { lg: store.get('parlay:lg', 'nfl'), legs: store.get('parlay:legs', []), bookOdds: store.get('parlay:book', '') };
  const save = () => { store.set('parlay:legs', st.legs); store.set('parlay:book', st.bookOdds); };
  el.innerHTML = '<div class="loading">Loading the slate…</div>';
  const now = new Date();
  const all = (await Promise.all(LG.map(([lg]) => games({ league: lg, from: now.toISOString(), to: new Date(now.getTime() + 8 * 86400e3).toISOString() })))).flat().filter((g) => g.state === 'pre');
  const G = new Map(all.map((g) => [String(g.id), g]));
  let bb = new Map();
  try { const { bets } = await bestBets(); bb = new Map(bets.map((b) => [`${b.gid}|${b.market}|${b.side}`, b])); } catch { /* best bets optional */ }

  // a leg's current number and the fair chance from the market
  function legInfo(l) {
    const g = G.get(String(l.gid)); if (!g) return null;
    const d = g.data, opp = { home: 'away', away: 'home', over: 'under', under: 'over' }[l.side];
    let fair = 0.5;
    if (l.market === 'ml' && g.ml_home && g.ml_away) { const p = noVig(Number(g.ml_home), Number(g.ml_away)); fair = l.side === 'home' ? p : 1 - p; }
    else if (l.oppOdds) fair = noVig(l.mOdds ?? l.odds, l.oppOdds); // the market's price when you added it, not the price you typed
    // the line moved since you added it: your number vs now (roughly 3% a point near the middle for spreads/totals)
    const nowLine = l.market === 'tot' ? Number(g.total) : l.market === 'sp' ? (l.side === 'home' ? Number(g.spread_home) : -Number(g.spread_home)) : null;
    let shift = 0;
    if (nowLine !== null && Number.isFinite(nowLine) && l.line !== nowLine) shift = (l.market === 'tot' ? (l.side === 'over' ? nowLine - l.line : l.line - nowLine) : l.line - nowLine) * 0.03;
    const tip = bb.get(`${l.gid}|${l.market}|${l.side}`), against = bb.get(`${l.gid}|${l.market}|${opp}`);
    const tool = tip ? Math.min(0.06, tip.score) : against ? -Math.min(0.06, against.score) : 0;
    const p = Math.max(0.02, Math.min(0.98, fair + shift + tool));
    const label = l.market === 'tot' ? `${l.side === 'over' ? 'Over' : 'Under'} ${l.line}` : l.market === 'ml' ? `${d[l.side].short} ML` : `${d[l.side].short} ${line(l.line)}`;
    return { g, d, p, fair, shift, tool, tip, against, label, dec: decOdds(l.odds), value: p * decOdds(l.odds) - 1 };
  }
  // pairs of legs from the same game and which way they lean together
  function sameGame(infos) {
    const notes = [];
    for (let i = 0; i < infos.length; i++) for (let j = i + 1; j < infos.length; j++) {
      const a = infos[i], b = infos[j]; if (!a || !b || String(a.l.gid) !== String(b.l.gid)) continue;
      const side = [a, b].find((x) => x.l.market !== 'tot'), tot = [a, b].find((x) => x.l.market === 'tot');
      if (side && tot) {
        const fav = side.l.market === 'ml' ? Number(side.l.odds) < 0 : side.l.line < 0;
        const pos = (fav && tot.l.side === 'over') || (!fav && tot.l.side === 'under');
        notes.push(`${side.label} + ${tot.label}: ${pos ? 'these tend to win together (a favorite covering usually means more points; an underdog covering, fewer). Books usually block this pairing in a regular parlay or price it in as a same-game parlay.' : 'these tend to work against each other, so the real chance of both is lower than the number shown.'}`);
      } else notes.push(`${a.label} + ${b.label}: same game, same result. Both legs ride on one outcome.`);
    }
    return notes;
  }

  function draw() {
    const infos = st.legs.map((l) => { const x = legInfo(l); return x ? { ...x, l } : null; });
    const live = infos.filter(Boolean);
    const pAll = live.reduce((a, x) => a * x.p, 1), decAll = live.reduce((a, x) => a * x.dec, 1);
    const bookDec = st.bookOdds !== '' && Math.abs(Number(st.bookOdds)) >= 100 ? decOdds(Number(st.bookOdds)) : decAll;
    const ev = live.length ? pAll * bookDec - 1 : 0;
    const without = live.length > 1 ? live.map((x) => { const p = pAll / x.p, d = bookDec / x.dec; return { x, ev: p * d - 1 }; }) : [];
    const bestDrop = without.length ? without.reduce((a, b) => b.ev > a.ev ? b : a) : null;
    const lgGames = all.filter((g) => g.league === st.lg).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const notes = sameGame(infos);
    el.innerHTML = `
    <div class="card">
      <div class="row" style="gap:8px;flex-wrap:wrap">${LG.map(([k, n]) => `<button class="btn ${k === st.lg ? 'on' : ''}" data-plg="${k}" style="${k === st.lg ? 'background:var(--gold);color:#111' : ''}">${n}</button>`).join('')}
        <select data-p="game" style="background:var(--surface2);color:inherit;border:1px solid var(--line2);border-radius:6px;padding:4px 6px;max-width:100%"><option value="">Add a leg: pick a game…</option>${lgGames.map((g) => `<option value="${g.id}">${esc(fmtDay(g.start_time))} · ${esc(g.data.away.short)} @ ${esc(g.data.home.short)}</option>`).join('')}</select></div>
      <div id="legpick"></div>
    </div>
    ${live.length ? `<div class="card" style="margin-top:12px">
      <table class="t"><tr><th>Leg</th><th class="r">Odds</th><th class="r">Chance</th><th class="r">Value</th><th></th></tr>
      ${infos.map((x, i) => x ? `<tr><td><div class="team">${logo(x.d[x.l.side === 'over' || x.l.side === 'under' ? 'home' : x.l.side])}<span><b>${esc(x.label)}</b> <span class="dim" style="font-size:12px">${esc(x.d.away.abbr)} @ ${esc(x.d.home.abbr)} · ${esc(fmtDay(x.g.start_time))}</span>
          ${x.tip ? `<div style="font-size:12px" class="mint">Best bets likes this side (+${(Math.min(0.06, x.tip.score) * 100).toFixed(1)} pts of chance)</div>` : x.against ? `<div style="font-size:12px" class="clay">Best bets is on the other side (−${(Math.min(0.06, x.against.score) * 100).toFixed(1)} pts)</div>` : ''}
          ${x.shift ? `<div style="font-size:12px" class="${x.shift > 0 ? 'mint' : 'clay'}">Your number is ${x.shift > 0 ? 'better' : 'worse'} than the line now (${x.shift > 0 ? '+' : ''}${(x.shift * 100).toFixed(1)} pts)</div>` : ''}</span></div></td>
        <td class="r"><input data-lodds="${i}" class="num" value="${x.l.odds > 0 ? '+' + x.l.odds : x.l.odds}" style="width:62px;text-align:right;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:2px 5px"></td>
        <td class="r num">${pct(x.p, 1)}</td><td class="r num ${x.value >= 0 ? 'mint' : 'clay'}">${x.value >= 0 ? '+' : ''}${(x.value * 100).toFixed(1)}%</td>
        <td class="r"><button class="btn" data-rm="${i}" style="padding:2px 8px;font-size:12px">✕</button></td></tr>` : `<tr><td colspan="4" class="dim">A leg whose game has started or dropped off the board</td><td class="r"><button class="btn" data-rm="${i}" style="padding:2px 8px;font-size:12px">✕</button></td></tr>`).join('')}</table>
      ${notes.length ? `<div style="margin-top:8px;font-size:13px">${notes.map((n) => `<div class="clay" style="padding:3px 0">⚠ ${esc(n)}</div>`).join('')}</div>` : ''}
      <div class="grid g4" style="margin-top:12px">
        <div class="stat"><div class="k">All ${live.length} hit</div><div class="v num" style="font-size:22px">${pct(pAll, pAll < 0.1 ? 1 : 0)}</div><div class="s">about 1 in ${Math.max(1, Math.round(1 / pAll))}</div></div>
        <div class="stat"><div class="k">Fair price</div><div class="v num" style="font-size:22px">${odds(amOf(1 / pAll))}</div><div class="s">what it should pay</div></div>
        <div class="stat"><div class="k">Book pays</div><div class="v num" style="font-size:22px">${odds(amOf(bookDec))}</div><div class="s"><input data-p="book" class="num" placeholder="${odds(amOf(decAll))}" value="${st.bookOdds}" style="width:70px;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:1px 5px"> if different</div></div>
        <div class="stat"><div class="k">Ticket value</div><div class="v num ${ev >= 0 ? 'mint' : 'clay'}" style="font-size:22px">${ev >= 0 ? '+' : ''}${(ev * 100).toFixed(1)}%</div><div class="s">per dollar bet</div></div></div>
      <p style="font-size:13.5px;margin:10px 0 0">${ev >= 0.03 ? '<b class="mint">Worth a look.</b> The legs’ edges outweigh the parlay’s built-in cut.' : ev >= 0 ? '<b>Close to even.</b> Small edges multiplied together barely cover the cut.' : `<b class="clay">The book has the edge.</b> Every −110 leg carries about a 4.5% cut, and a parlay multiplies them.`}
        ${bestDrop && bestDrop.ev > ev + 0.005 && (bestDrop.ev >= 0 || bestDrop.x.value < Math.min(...live.filter((y) => y !== bestDrop.x).map((y) => y.value)) - 0.01) ? ` Dropping <b>${esc(bestDrop.x.label)}</b> would take the ticket to ${bestDrop.ev >= 0 ? '+' : ''}${(bestDrop.ev * 100).toFixed(1)}%.` : ''}</p>
      <div class="row" style="gap:8px;margin-top:10px"><button class="btn" data-p="copy">Copy ticket</button><button class="btn" data-p="clear">Clear</button></div>
    </div>` : '<p class="dim" style="font-size:13px;margin-top:10px">Pick a game above to start a ticket. Up to 10 legs.</p>'}
    <p class="stamp">Chances: the market’s own price with the cut removed, plus the Today page’s graded edge when its best bets back (or oppose) that exact side, capped at 6 points. Different games are multiplied as independent; same-game legs are flagged instead of modeled.</p>`;

    el.querySelectorAll('[data-plg]').forEach((b) => b.onclick = () => { st.lg = b.dataset.plg; store.set('parlay:lg', st.lg); draw(); });
    el.querySelector('[data-p=game]').onchange = (e) => pickLeg(e.target.value);
    el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { st.legs.splice(Number(b.dataset.rm), 1); save(); draw(); });
    el.querySelectorAll('[data-lodds]').forEach((b) => b.onchange = () => { const v = Number(String(b.value).replace(/[^0-9+-]/g, '')); if (Math.abs(v) >= 100) { st.legs[Number(b.dataset.lodds)].odds = v; save(); } draw(); });
    const bk = el.querySelector('[data-p=book]'); if (bk) bk.onchange = () => { const v = String(bk.value).replace(/[^0-9+-]/g, ''); st.bookOdds = v === '' || Math.abs(Number(v)) < 100 ? '' : Number(v); save(); draw(); };
    el.querySelector('[data-p=copy]')?.addEventListener('click', () => copy(live.map((x) => `${x.label} (${odds(x.l.odds)})`).join(', ') + ` — parlay ${odds(amOf(bookDec))}`));
    el.querySelector('[data-p=clear]')?.addEventListener('click', () => { st.legs = []; st.bookOdds = ''; save(); draw(); });
  }
  // choose market and side for a game, with the current numbers filled in
  function pickLeg(gid) {
    const box = el.querySelector('#legpick'); const g = G.get(String(gid)); if (!g) { box.innerHTML = ''; return; }
    const d = g.data, sp = g.spread_home !== null ? Number(g.spread_home) : null, tot = g.total !== null ? Number(g.total) : null;
    const opts = [];
    if (sp !== null) { opts.push({ market: 'sp', side: 'away', line: -sp, odds: -110, oppOdds: -110, lab: `${d.away.short} ${line(-sp)}` }, { market: 'sp', side: 'home', line: sp, odds: -110, oppOdds: -110, lab: `${d.home.short} ${line(sp)}` }); }
    if (tot !== null) { opts.push({ market: 'tot', side: 'over', line: tot, odds: -110, oppOdds: -110, lab: `Over ${tot}` }, { market: 'tot', side: 'under', line: tot, odds: -110, oppOdds: -110, lab: `Under ${tot}` }); }
    if (g.ml_home && g.ml_away) { opts.push({ market: 'ml', side: 'away', line: null, odds: Number(g.ml_away), oppOdds: Number(g.ml_home), lab: `${d.away.short} ML ${odds(Number(g.ml_away))}` }, { market: 'ml', side: 'home', line: null, odds: Number(g.ml_home), oppOdds: Number(g.ml_away), lab: `${d.home.short} ML ${odds(Number(g.ml_home))}` }); }
    box.innerHTML = `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${opts.map((o, i) => `<button class="btn" data-opt="${i}">+ ${esc(o.lab)}</button>`).join('') || '<span class="dim">No lines posted for this game yet.</span>'}</div>`;
    box.querySelectorAll('[data-opt]').forEach((b) => b.onclick = () => { if (st.legs.length >= 10) return; const o = opts[Number(b.dataset.opt)]; st.legs.push({ gid: String(g.id), market: o.market, side: o.side, line: o.line, odds: o.odds, mOdds: o.odds, oppOdds: o.oppOdds }); save(); draw(); });
  }
  draw();
}
