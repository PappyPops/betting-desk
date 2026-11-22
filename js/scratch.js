// Cooking from Scratch: every Louisiana scratch-off still for sale, read from the official prize tables.
// Return per $1, "heat" (are the good prizes lasting longer than the tickets?), real odds of a $500+ prize now,
// and what it costs on average to hit one. Not a tip to buy: every game returns less than it costs.
import { api, esc, pct, seg, onSeg, store, howTo, wireHow, footNote, clearCache } from './core.js?v=202611221421';

const money = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n % 1 ? n.toFixed(2) : n}`;
const cents = (x) => `${Math.round(x * 100)}¢`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const prizeVal = (p, price) => /ticket/i.test(p) ? price : Number(String(p).replace(/[^0-9.]/g, '')) || 0;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function analyze(g) {
  const price = Number(g.price);
  const tiers = (g.tiers || []).map((t) => ({ ...t, val: prizeVal(t.prize, price) })).filter((t) => t.val > 0).sort((a, b) => b.val - a.val);
  if (!tiers.length) return null;
  // printed tickets: each tier's count times its odds should land on the same print run; take the middle one
  const printed = med(tiers.filter((t) => t.odds > 0).map((t) => t.total * t.odds));
  // share sold: the small prizes (up to $100, including free tickets) get cashed almost as soon as they're scratched
  const small = tiers.filter((t) => t.val <= 100);
  const sold = small.reduce((a, t) => a + t.claimed, 0) / Math.max(1, small.reduce((a, t) => a + t.total, 0));
  const left = clamp(1 - sold, 0.005, 1), ticketsLeft = printed * left;
  const ev = tiers.reduce((a, t) => a + t.remaining * t.val, 0) / (ticketsLeft * price);
  const evLaunch = tiers.reduce((a, t) => a + t.total * t.val, 0) / (printed * price);
  const big = tiers.filter((t) => t.val >= 500).length ? tiers.filter((t) => t.val >= 500) : [tiers[0]];
  const bigRem = big.reduce((a, t) => a + t.remaining, 0), bigTot = big.reduce((a, t) => a + t.total, 0);
  const heat500 = bigTot ? (bigRem / bigTot) / left : 0;
  const top = tiers[0], topHeat = (top.remaining / top.total) / left;
  const odds500 = bigRem ? ticketsLeft / bigRem : Infinity;
  const ret = clamp((ev - 0.6) / 0.3, 0, 1), heat = clamp((heat500 - 0.6) / 1.2, 0, 1), topLeft = top.remaining / top.total;
  let score = 100 * (0.5 * ret + 0.3 * heat + 0.2 * topLeft);
  if (left < 0.2) score *= 0.6 + 2 * left; // one leftover jackpot on a nearly empty shelf is loud but hard to find
  const tags = [];
  if (sold < 0.25) tags.push('FRESH');
  if (left < 0.15 && top.remaining > 0) tags.push('LONE JACKPOT');
  if (heat500 >= 1.15 && top.remaining > 0) tags.push('SIZZLING'); else if (heat500 < 0.85) tags.push('FADING'); else if (sold >= 0.25) tags.push('ON PACE');
  if (left < 0.25 && bigRem > 0) tags.push('LAST CALL');
  return { g, price, tiers, printed, sold, left, ticketsLeft, ev, evLaunch, big, bigRem, heat500, top, topHeat, topLeft, odds500, score: Math.round(score), tags,
    cost500: price * odds500, loss: price * (1 - ev), bigFloor: big[big.length - 1].val };
}

// chance of at least one $500+ prize when spending `budget` on this game
const hitChance = (a, budget) => 1 - Math.pow(1 - 1 / a.odds500, Math.floor(budget / a.price));

function blurb(a) {
  const t = a.top, shelf = `${t.remaining} of ${t.total} ${money(t.val)} prizes are still unclaimed`;
  const r = `About ${cents(a.ev)} comes back per $1, ${a.ev >= a.evLaunch - 0.005 ? 'versus' : 'under the'} ${cents(a.evLaunch)} ${a.ev >= a.evLaunch - 0.005 ? 'on launch day' : 'it launched with'}.`;
  if (a.tags.includes('LONE JACKPOT')) return `${shelf}, but only about ${pct(a.left, 0)} of the tickets are left, so it’s a lone jackpot on a thin shelf. Jackpot heat is ${a.topHeat.toFixed(2)}×. ${r}`;
  if (a.tags.includes('FRESH')) return `Clean slate. ${shelf} and about ${pct(a.left, 0)} of the book is still out, so the prize pool is close to what was printed. ${r}`;
  if (a.tags.includes('SIZZLING')) return `${shelf} while about ${pct(a.sold, 0)} of the book has sold. $500+ heat is ${a.heat500.toFixed(2)}×: the good prizes are lasting longer than the tickets. ${r}`;
  if (a.tags.includes('FADING')) return `${shelf}, but big prizes are leaving faster than the tickets ($500+ heat ${a.heat500.toFixed(2)}×). ${r}`;
  return `${shelf}. $500+ heat is ${a.heat500.toFixed(2)}×, right around the pace of the tickets. ${r}`;
}

function trend(a, snaps) {
  const s = snaps.filter((x) => x.num === a.g.num).sort((x, y) => x.day.localeCompare(y.day));
  if (s.length < 2) return null;
  const old = analyze({ ...a.g, tiers: s[0].tiers });
  return old ? { days: Math.round((new Date(s[s.length - 1].day) - new Date(s[0].day)) / 86400e3), ev: a.ev - old.ev, heat: a.heat500 - old.heat500, sold: a.sold - old.sold } : null;
}

export async function render(el) {
  const st = { price: store.get('sc:price', 'all'), budget: store.get('sc:budget', 20), open: null };
  el.innerHTML = '<div class="loading">Reading the prize tables…</div>';
  let A = [], snaps = [], meta = {};
  async function load() {
    try {
      const games = await api('lotto_games?select=*&active=eq.true&order=price', { ttl: 600_000 });
      snaps = await api(`lotto_snaps?select=num,day,tiers&day=gte.${new Date(Date.now() - 15 * 86400e3).toISOString().slice(0, 10)}&order=day&limit=2000`, { ttl: 600_000 });
      A = games.map(analyze).filter(Boolean);
      meta = { n: games.length, upd: games.map((g) => g.source_updated).filter(Boolean).sort().pop(), at: games.map((g) => g.updated_at).sort().pop() };
    } catch (e) { el.innerHTML = `<div class="err">Couldn’t read the board (${esc(e.message)}). Try Refresh.</div>`; return; }
    draw();
  }
  const chip = (t) => `<span class="chip ${t === 'SIZZLING' ? 'gold' : t === 'FADING' ? 'clay' : t === 'LAST CALL' ? 'clay' : t === 'FRESH' ? 'mint' : ''}" style="font-size:10.5px">${t}</span>`;
  function card(a, i, lead) {
    return `<div class="card" data-open="${a.g.num}" style="cursor:pointer">
      <div class="row" style="gap:10px">${a.g.img ? `<img src="${esc(a.g.img)}" alt="" width="64" height="37" style="border-radius:6px;object-fit:cover">` : ''}
        <div style="flex:1;min-width:0"><div class="dim" style="font-size:12px">${i !== null ? `#${i + 1} · ` : ''}$${a.price} · No. ${a.g.num}</div><div class="disp" style="font-size:19px;line-height:1.15">${esc(a.g.name)}</div></div></div>
      <div style="margin:6px 0">${a.tags.map(chip).join(' ')}</div>
      <div style="font-size:13px">${esc(blurb(a))}</div>
      <div class="grid g4" style="margin-top:10px;text-align:center;gap:6px">
        <div><div class="dim" style="font-size:10.5px">PER $1</div><b class="num">${cents(a.ev)}</b></div>
        <div><div class="dim" style="font-size:10.5px">$500+ HEAT</div><b class="num">${a.heat500.toFixed(2)}×</b></div>
        <div><div class="dim" style="font-size:10.5px">TOP LEFT</div><b class="num">${a.top.remaining}/${a.top.total}</b></div>
        <div><div class="dim" style="font-size:10.5px">${lead === 'odds' ? '$500+ NOW' : 'SCORE'}</div><b class="num">${lead === 'odds' ? (isFinite(a.odds500) ? `1 in ${Math.round(a.odds500).toLocaleString()}` : '—') : a.score}</b></div></div></div>`;
  }
  function detail(a) {
    const tr = trend(a, snaps);
    return `<div class="card hl" style="margin-top:12px" id="sc-detail">
      <div class="row" style="justify-content:space-between"><div><div class="dim" style="font-size:12px">$${a.price} · No. ${a.g.num}${a.g.launch ? ` · launched ${esc(a.g.launch)}` : ''}</div><div class="disp" style="font-size:24px">${esc(a.g.name)}</div></div><button class="btn" data-close>✕</button></div>
      <div class="grid g4" style="margin-top:10px">
        <div class="card stat"><div class="k">Back per $1</div><div class="v num">${cents(a.ev)}</div><div class="s">launch ${cents(a.evLaunch)} · you lose about ${money(a.loss)} a ticket on average</div></div>
        <div class="card stat"><div class="k">$500+ odds now</div><div class="v num" style="font-size:24px">${isFinite(a.odds500) ? `1 in ${Math.round(a.odds500).toLocaleString()}` : '—'}</div><div class="s">${a.bigRem.toLocaleString()} prizes of ${money(a.bigFloor)}+ left</div></div>
        <div class="card stat"><div class="k">Cost to hit one</div><div class="v num" style="font-size:24px">${isFinite(a.cost500) ? money(a.cost500) : '—'}</div><div class="s">average spend per ${money(a.bigFloor)}+ prize</div></div>
        <div class="card stat"><div class="k">Book left</div><div class="v num">${pct(a.left, 0)}</div><div class="s">about ${Math.round(a.ticketsLeft).toLocaleString()} of ${Math.round(a.printed).toLocaleString()} tickets</div></div></div>
      <p style="font-size:13.5px;margin:10px 0">Spending <b>$${st.budget}</b> on this game ($${a.price} × ${Math.floor(st.budget / a.price)}): about a <b>${pct(hitChance(a, st.budget), 1)}</b> chance of at least one ${money(a.bigFloor)}+ prize.${tr && tr.days ? ` Over the last ${tr.days} days the return moved ${tr.ev >= 0 ? '+' : '−'}${Math.abs(Math.round(tr.ev * 100))}¢ and $500+ heat ${tr.heat >= 0 ? '+' : '−'}${Math.abs(tr.heat).toFixed(2)}.` : ''}</p>
      <div style="overflow-x:auto"><table class="t"><tr><th>Prize</th><th class="r">Printed</th><th class="r">Left</th><th class="r">Heat</th><th class="r">Odds printed</th><th class="r">Odds now</th></tr>
      ${a.tiers.map((t) => { const h = (t.remaining / t.total) / a.left; const now = t.remaining ? a.ticketsLeft / t.remaining : Infinity; return `<tr><td><b>${/ticket/i.test(t.prize) ? 'Free ticket' : money(t.val)}</b></td><td class="r num">${t.total.toLocaleString()}</td><td class="r num">${t.remaining.toLocaleString()}</td>
        <td class="r num ${h >= 1.15 ? 'mint' : h < 0.85 ? 'clay' : ''}">${h.toFixed(2)}×</td><td class="r num dim">1 in ${t.odds.toLocaleString()}</td><td class="r num">${isFinite(now) ? `1 in ${now >= 100 ? Math.round(now).toLocaleString() : now.toFixed(1)}` : 'gone'}</td></tr>`; }).join('')}</table></div>
      <p class="stamp">Heat above 1.00× (green) means that prize is lasting longer than the tickets; below 0.85× (red) it’s going faster. <a href="${esc(a.g.url)}" target="_blank" rel="noopener">Official prize table</a></p></div>`;
  }
  function draw() {
    const pool = A.filter((a) => st.price === 'all' || String(a.price) === st.price);
    const byScore = [...pool].sort((a, b) => b.score - a.score);
    const shot = [...pool].filter((a) => isFinite(a.odds500)).sort((a, b) => a.odds500 - b.odds500);
    const last = [...pool].filter((a) => a.tags.includes('LAST CALL')).sort((a, b) => b.heat500 - a.heat500);
    const sharp = [...pool].sort((a, b) => b.ev - a.ev)[0];
    const prices = [...new Set(A.map((a) => a.price))].sort((a, b) => a - b);
    const open = st.open ? A.find((a) => a.g.num === st.open) : null;
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Louisiana scratch-offs</div><h1>Cooking from Scratch</h1><p>Every scratch-off still for sale, read from the Louisiana Lottery’s own prize tables: what comes back per dollar, whether the big prizes are outlasting the tickets, and the real odds of a $500+ prize right now.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">${seg('price', [['all', 'All'], ...prices.map((p) => [String(p), `$${p}`])], st.price)}
      <span class="row" style="gap:6px;font-size:13px"><span class="dim">Budget</span>${seg('budget', [[10, '$10'], [20, '$20'], [50, '$50'], [100, '$100']].map(([v, l]) => [String(v), l]), String(st.budget))}</span></div>
    ${open ? detail(open) : ''}
    <div class="sec"><h2>Top three</h2><p class="sub">Ranked by plate score: return per dollar, how well the $500+ prizes are holding up, and how much of the top prize is left. Tap any card for the full prize table.</p>
      <div class="grid g3">${byScore.slice(0, 3).map((a, i) => card(a, i)).join('')}</div>
      ${sharp ? `<p class="dim" style="font-size:13px;margin-top:8px">Best raw return: ${esc(sharp.g.name)} ($${sharp.price}) at ${cents(sharp.ev)} per $1${byScore.slice(0, 3).includes(sharp) ? '.' : ', kept off the podium because the book is thin or the big prizes aren’t keeping pace.'}</p>` : ''}</div>
    <div class="sec"><h2>Best shot at $500+</h2><p class="sub">Lowest odds of a $500+ prize on the next ticket: tickets still out divided by $500+ prizes still unclaimed. “Cost to hit one” in each breakdown is what that takes in dollars at this price.</p>
      <div class="grid g3">${shot.slice(0, 3).map((a, i) => card(a, i, 'odds')).join('')}</div></div>
    ${last.length ? `<div class="sec"><h2>Last call</h2><p class="sub">Almost sold out (under a quarter of the tickets left) but still holding $500+ prizes. These are the ones to grab if a store still has them.</p><div class="grid g3">${last.slice(0, 6).map((a, i) => card(a, i)).join('')}</div></div>` : ''}
    ${(st.price === 'all' ? prices : [Number(st.price)]).map((p) => { const rack = byScore.filter((a) => a.price === p); return `<div class="sec"><h2>The $${p} rack</h2>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Game</th><th class="r">Per $1</th><th class="r">$500+ heat</th><th class="r">Top left</th><th class="r">$500+ odds</th><th class="r">Score</th></tr>
      ${rack.map((a) => `<tr data-open="${a.g.num}" style="cursor:pointer"><td><b>${esc(a.g.name)}</b> <span class="dim" style="font-size:12px">No. ${a.g.num}</span><div>${a.tags.map(chip).join(' ')}</div></td><td class="r num">${cents(a.ev)}</td><td class="r num ${a.heat500 >= 1.15 ? 'mint' : a.heat500 < 0.85 ? 'clay' : ''}">${a.heat500.toFixed(2)}×</td><td class="r num">${a.top.remaining}/${a.top.total}</td><td class="r num">${isFinite(a.odds500) ? `1 in ${Math.round(a.odds500).toLocaleString()}` : '—'}</td><td class="r num"><b>${a.score}</b></td></tr>`).join('')}</table></div></div>`; }).join('')}
    ${howTo('How the numbers are made', `<ol>
      <li><b>Tickets still out</b> are estimated from the small prizes (up to $100 and free tickets), because those get cashed almost as soon as they’re scratched. If 40% of them are claimed, about 40% of the book has sold. Prizes not yet cashed make this run a little high early on.</li>
      <li><b>Per $1</b> is the prize money still unclaimed divided by the tickets still out, compared with the return printed on launch day. Every game is under $1: on average, scratch-offs lose money.</li>
      <li><b>Heat</b> is how much of a prize tier is left divided by how much of the book is left. 1.00× is exactly on pace; above it, the good prizes are lasting longer than the tickets. $500 and up is the shelf that counts; a game that never pays $500 uses its top prize.</li>
      <li><b>Odds now</b> is tickets still out divided by prizes still unclaimed in that tier. <b>Cost to hit one</b> is those odds times the ticket price.</li>
      <li><b>Plate score</b> blends return (50%), $500+ heat (30%) and top prizes left (20%). A nearly sold-out book is marked down, because one leftover jackpot makes the numbers loud and the ticket hard to find.</li></ol>`, 'sc')}
    <p class="stamp">${meta.n} games read${meta.upd ? `; the lottery’s tables were last updated ${esc(meta.upd)}` : ''}. Checked every 6 hours. Trends fill in as daily snapshots build up.</p>
    ${footNote('Prize tables: louisianalottery.com. Not the Louisiana Lottery and not a tip to buy. Scratch-offs return less than they cost on average; a high score means the published prize file looks richer than the pace of sales, not that the next ticket wins.')}`;
    onSeg(el, 'price', (v) => { st.price = v; store.set('sc:price', v); draw(); });
    onSeg(el, 'budget', (v) => { st.budget = Number(v); store.set('sc:budget', st.budget); draw(); });
    el.querySelectorAll('[data-open]').forEach((n) => n.onclick = () => { st.open = Number(n.dataset.open); draw(); el.querySelector('#sc-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    el.querySelector('[data-close]')?.addEventListener('click', () => { st.open = null; draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
}
