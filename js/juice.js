import { api, esc, seg, onSeg, store, pct, odds, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, ago, decOdds } from './core.js?v=202611162200';

const LGS = [['nfl', 'NFL'], ['cfb', 'College'], ['nba', 'NBA']];
const MK = { sp: 'Spread', tot: 'Total', ml: 'Moneyline' };
const BE = 110 / 210; // break-even at -110

function img(src, size = 22) { return src ? `<img class="logo" style="width:${size}px;height:${size}px" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''; }
function sideName(d, market, s) {
  if (market === 'tot') return s === 'a' ? 'Over' : 'Under';
  return (s === 'a' ? d.away : d.home)?.nick ?? '';
}
function lineTxt(market, v, s) {
  if (v === null || v === undefined) return '—';
  if (market === 'tot') return String(v);
  if (market === 'ml') return odds(v);
  return line(v);
}

// Grade a locked read against the final score.
function grade(b, g) {
  if (!g || g.state !== 'post' || g.home_score === null) return null;
  const hs = g.home_score, as = g.away_score;
  let r;
  if (b.market === 'tot') { const d = hs + as - Number(b.line); r = d === 0 ? 'P' : (d > 0) === (b.side === 'a') ? 'W' : 'L'; }
  else if (b.market === 'sp') { const m = (b.side === 'a' ? as - hs : hs - as) + Number(b.line); r = m === 0 ? 'P' : m > 0 ? 'W' : 'L'; }
  else { const won = b.side === 'a' ? as > hs : hs > as; r = hs === as ? 'P' : won ? 'W' : 'L'; }
  return r;
}
function units(r, o) { if (r === 'W') return o ? decOdds(o) - 1 : 100 / 110; if (r === 'L') return -1; return 0; }

export async function render(el) {
  const st = { lg: store.get('juice:lg', 'nfl'), show: store.get('juice:show', 'pre'), sort: store.get('juice:sort', 'time'), cat: 'all' };
  let rows = [], bets = [], finals = new Map(), at = null, counts = {};

  async function load(quiet = false) {
    if (!quiet) el.innerHTML = '<div class="loading">Reading the splits…</div>';
    const since = new Date(Date.now() - 2 * 86400e3).toISOString();
    const [latest, allBets, meta] = await Promise.all([
      api(`splits_latest?select=*&start_time=gte.${encodeURIComponent(since)}&order=start_time.asc`, { ttl: 60_000 }),
      api('juice_bets?select=*&locked=eq.true&order=start_time.desc&limit=3000', { ttl: 120_000 }),
      api('blobs?key=eq.action:splits&select=data', { ttl: 60_000 }),
    ]);
    at = meta[0]?.data?.at ? new Date(meta[0].data.at) : null;
    counts = Object.fromEntries(LGS.map(([k]) => [k, latest.filter((r) => r.league === k && r.status === 'scheduled').length]));
    rows = latest.filter((r) => r.league === st.lg);
    bets = allBets;
    const ids = [...new Set(bets.map((b) => b.espn_id).filter(Boolean))];
    finals = new Map();
    for (let i = 0; i < ids.length; i += 150) {
      const part = await api(`games?select=id,state,home_score,away_score&id=in.(${ids.slice(i, i + 150).join(',')})`, { ttl: 300_000 });
      for (const g of part) finals.set(g.id, g);
    }
    draw();
  }

  function record(list) {
    let w = 0, l = 0, p = 0, u = 0;
    for (const b of list) { const r = grade(b, finals.get(b.espn_id)); if (!r) continue; if (r === 'W') w++; else if (r === 'L') l++; else p++; u += units(r, b.market === 'ml' ? b.odds : -110); }
    return { w, l, p, u, pct: w + l ? w / (w + l) : null };
  }

  function card(r) {
    const d = r.data, mk = d.mk ?? {}, sig = d.sig ?? [];
    const top = sig[0];
    const juiciest = ['sp', 'tot', 'ml'].map((k) => [k, Math.max(Math.abs((mk[k]?.a?.m ?? 0) - (mk[k]?.a?.t ?? 0)), 0)]).sort((a, b) => b[1] - a[1])[0]?.[0];
    const live = r.status === 'inprogress', fin = r.status === 'complete';
    const when = live ? `<span class="pill-live">${esc(d.display || 'Live')}</span>` : fin ? '<span class="dim">Final</span>' : `${esc(fmtDay(r.start_time))} · ${esc(fmtTime(r.start_time))}`;
    const box = (k) => {
      const m = mk[k]; if (!m?.a) return '';
      const hot = k === juiciest;
      const sideRow = (s) => { const x = m[s]; if (!x) return ''; const gap = (x.m ?? 0) - (x.t ?? 0);
        return `<div style="margin-top:6px"><div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(sideName(d, k, s))} <b class="num">${lineTxt(k, k === 'ml' ? x.o : x.v, s)}</b></span><span class="num"><span class="muted">${x.t ?? '—'}%</span> · <span class="mint">${x.m ?? '—'}%</span></span></div>
        <div class="bar" style="height:4px;margin-top:3px;position:relative"><i style="width:${x.t ?? 0}%;background:var(--muted)"></i></div><div class="bar" style="height:4px;margin-top:2px"><i style="width:${x.m ?? 0}%;background:var(--mint)"></i></div>
        ${Math.abs(gap) >= 15 ? `<div style="font-size:11.5px" class="${gap > 0 ? 'gold' : 'dim'}">${gap > 0 ? '+' : ''}${gap} money vs tickets</div>` : ''}</div>`; };
      const o = m.oa, open = k === 'ml' ? (m.oa?.o != null ? `${odds(m.oa.o)} / ${odds(m.oh?.o)}` : null) : k === 'tot' ? m.oa?.v : m.oh?.v != null ? `${d.home?.abbr} ${line(m.oh.v)}` : null;
      return `<div class="card" style="padding:10px 12px;background:var(--surface2);${hot ? 'border-color:var(--gold)' : ''}">
        <div class="row" style="justify-content:space-between"><b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;${hot ? 'color:var(--gold)' : ''}">${MK[k]}</b>${open !== null && open !== undefined ? `<span class="dim" style="font-size:11.5px">Open ${esc(String(open))}</span>` : ''}</div>
        ${sideRow('a')}${sideRow('h')}</div>`;
    };
    const flips = (d.flipLog ?? []).slice(-3).map((f) => { const [k, w] = f.f.split(':'); return `<span class="chip clay">${MK[k]} ${w} flipped</span>`; }).join(' ');
    const score = (live || fin) && d.score ? `<span class="disp num" style="font-size:20px">${d.score.a ?? ''}–${d.score.h ?? ''}</span>` : '';
    return `<div class="card">
      <div class="row" style="justify-content:space-between;font-size:13px"><span>${when}</span><span class="dim">${r.num_bets ? `${(r.num_bets / 1000).toFixed(1)}k bets` : ''}</span></div>
      <div class="row" style="justify-content:space-between;margin:8px 0"><div><div class="team">${img(d.away?.logo)}<span><b>${esc(d.away?.nick ?? '')}</b></span></div><div class="team" style="margin-top:4px">${img(d.home?.logo)}<span><b>${esc(d.home?.nick ?? '')}</b></span></div></div>${score}</div>
      ${flips ? `<div class="chips" style="margin-bottom:8px">${flips}</div>` : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">${box('sp')}${box('tot')}${box('ml')}</div>
      <div class="dim" style="font-size:11.5px;margin-top:6px"><span class="muted">■</span> tickets &nbsp; <span class="mint">■</span> money</div>
      ${top ? `<div style="margin-top:10px;background:var(--gold);color:var(--gold-ink);border-radius:12px;padding:12px 14px">
        <div class="row" style="justify-content:space-between"><b style="font-size:11.5px;letter-spacing:.14em">THE READ</b><span style="font-size:12.5px"><b>${top.conf}</b> conf · <b>${pct(top.chance)}</b> market chance</span></div>
        <div class="disp" style="font-size:24px;font-weight:700">${esc(sideName(d, top.market, top.side))} ${lineTxt(top.market, top.market === 'ml' ? top.odds : top.line, top.side)}${top.market !== 'ml' && top.odds ? ` <span style="font-size:16px">(${odds(top.odds)})</span>` : ''}</div>
        <div style="font-size:13.5px">${top.money}% of the money on ${esc(sideName(d, top.market, top.side))} with ${top.tix}% of the tickets${top.rlm ? ', and the line moved toward it against a lopsided public' : ''}.</div></div>`
      : `<div class="dim" style="font-size:13px;margin-top:10px">No read. Tickets and money agree${(d.sig ?? []).length ? '' : ''}.</div>`}
    </div>`;
  }

  function draw() {
    let list = rows.filter((r) => st.show === 'pre' ? r.status === 'scheduled' : st.show === 'live' ? r.status === 'inprogress' : r.status === 'complete');
    if (st.cat === 'read') list = list.filter((r) => (r.data.sig ?? []).length);
    if (st.cat === 'rlm') list = list.filter((r) => (r.data.sig ?? []).some((s) => s.rlm));
    if (st.cat === 'lop') list = list.filter((r) => ['sp', 'tot'].some((k) => Math.max(r.data.mk?.[k]?.a?.t ?? 0, r.data.mk?.[k]?.h?.t ?? 0) >= 70));
    if (st.cat === 'flip') list = list.filter((r) => (r.data.flipLog ?? []).length);
    if (st.sort === 'bets') list.sort((a, b) => (b.num_bets ?? 0) - (a.num_bets ?? 0));
    if (st.sort === 'juice') list.sort((a, b) => ((b.data.sig ?? [])[0]?.conf ?? 0) - ((a.data.sig ?? [])[0]?.conf ?? 0));

    const tops = bets.filter((b) => b.is_top);
    const all = record(tops), byMk = Object.fromEntries(['sp', 'tot', 'ml'].map((k) => [k, record(tops.filter((b) => b.market === k))]));
    const strong = record(tops.filter((b) => b.gap >= 25)), rlm = record(tops.filter((b) => b.rlm));
    const lgRec = record(tops.filter((b) => b.league === st.lg));
    const recTxt = (r) => r.w + r.l ? `${r.w}–${r.l}${r.p ? '–' + r.p : ''}` : '—';
    const loud = rows.filter((r) => r.status === 'scheduled' && (r.data.sig ?? []).length).map((r) => ({ r, s: r.data.sig[0] })).sort((a, b) => b.s.conf - a.s.conf).slice(0, 6);

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Tickets vs. money</div><h1>The Juice</h1><p>Where the tickets are. Where the money is. When they split by 15 points or more, or the line moves against a lopsided public, that side is the read.</p></div>
      <div class="row"><span class="stamp">Splits ${esc(ago(at))}</span><button class="btn" data-act="refresh">↻ Refresh</button></div></div>
    ${howTo('How to read it', `<ol>
      <li><b>Tickets</b> (gray) is the share of bets, <b>money</b> (green) is the share of dollars. Bigger bettors move the money number.</li>
      <li>A <b>read</b> is the side with money at least 15 points above its tickets, or a line that moved toward a side while 65%+ of tickets were on the other one. The gold box is the strongest read in the game; the gold-edged box is the market with the widest split.</li>
      <li><b>Conf</b> is how wide the split is. <b>Market chance</b> is the book’s own no-vig probability, not a model. Moneylines only count between −200 and +250, because favorite money is inflated by bet size.</li>
      <li>The record below grades every gold read at its last pregame number. At −110 you need ${pct(BE, 1)} to break even.</li></ol>`, 'juice')}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Gold reads, all sports</div><div class="v num">${recTxt(all)}</div><div class="s">${pct(all.pct, 1)} · ${all.u >= 0 ? '+' : ''}${all.u.toFixed(1)}u · break-even ${pct(BE, 1)}</div></div>
      <div class="card stat"><div class="k">${LGS.find((x) => x[0] === st.lg)[1]} only</div><div class="v num">${recTxt(lgRec)}</div><div class="s">${pct(lgRec.pct, 1)} · ${lgRec.u >= 0 ? '+' : ''}${lgRec.u.toFixed(1)}u</div></div>
      <div class="card stat"><div class="k">Split 25+ points</div><div class="v num">${recTxt(strong)}</div><div class="s">${pct(strong.pct, 1)} · the loudest reads</div></div>
      <div class="card stat"><div class="k">Line moved against public</div><div class="v num">${recTxt(rlm)}</div><div class="s">${pct(rlm.pct, 1)}</div></div>
    </div>
    <p class="stamp">By market: spread ${recTxt(byMk.sp)} · total ${recTxt(byMk.tot)} · moneyline ${recTxt(byMk.ml)}. Tracking started Nov 16, 2026, so the sample is small; give it a few weeks before trusting any of it.</p>
    <div class="row" style="margin:14px 0 10px">${seg('lg', LGS.map(([k, l]) => [k, `${l} ${counts[k] ?? ''}`]), st.lg)}</div>
    ${loud.length ? `<div class="sec" style="margin-top:6px"><h2>Loudest reads</h2><div class="grid g3">${loud.map(({ r, s }) => `<div class="card hl"><div class="dim" style="font-size:12px">${esc(r.data.away?.abbr)} @ ${esc(r.data.home?.abbr)} · ${esc(fmtDay(r.start_time))} ${esc(fmtTime(r.start_time))}</div>
      <div class="row" style="justify-content:space-between;margin-top:4px"><b class="disp" style="font-size:20px">${esc(sideName(r.data, s.market, s.side))} ${lineTxt(s.market, s.market === 'ml' ? s.odds : s.line, s.side)}</b><span class="chip gold">${s.conf}</span></div>
      <div class="muted" style="font-size:12.5px">${MK[s.market]} · ${s.money}% money / ${s.tix}% tickets${s.rlm ? ' · moved' : ''}</div></div>`).join('')}</div></div>` : ''}
    <div class="row" style="margin:18px 0 10px">
      ${seg('show', [['pre', 'Upcoming'], ['live', 'Live'], ['fin', 'Final']], st.show)}
      ${seg('cat', [['all', 'All'], ['read', 'Has a read'], ['lop', 'Lopsided'], ['rlm', 'Moved'], ['flip', 'Flipped']], st.cat)}
      ${seg('sort', [['time', 'By time'], ['bets', 'Most bets'], ['juice', 'Most juice']], st.sort)}
    </div>
    <div class="grid g2">${list.map(card).join('') || '<div class="empty">Nothing here right now.</div>'}</div>
    ${footNote('Ticket and money percentages: Action Network’s public consensus board (DraftKings, FanDuel, BetMGM, Caesars, BetRivers and others), checked every 10 minutes. Openers: Action Network’s opening line. Juice keeps every reading and flags when the public side flips.')}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('juice:lg', v); load(); });
    onSeg(el, 'show', (v) => { st.show = v; store.set('juice:show', v); draw(); });
    onSeg(el, 'sort', (v) => { st.sort = v; store.set('juice:sort', v); draw(); });
    onSeg(el, 'cat', (v) => { st.cat = v; draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
  const t = setInterval(() => { clearCache(); load(true); }, 5 * 60_000);
  return () => clearInterval(t);
}
