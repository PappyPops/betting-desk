import { api, esc, seg, onSeg, store, pct, odds, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, ago } from './core.js?v=202611162123';

const LGS = [['nfl', 'NFL'], ['cfb', 'College'], ['nba', 'NBA']];
const MKT = (t) => /^spread/.test(t) ? 'sp' : /^ml/.test(t) ? 'ml' : ['over', 'under'].includes(t) ? 'tot' : null;
const MKN = { sp: 'Spread', tot: 'Total', ml: 'Moneyline' };
const img = (src, size = 22) => src ? `<img class="logo" style="width:${size}px;height:${size}px" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';

export async function render(el) {
  const st = { lg: store.get('capn:lg', 'nfl'), tab: store.get('capn:tab', 'board') };
  let picks = [], experts = new Map(), games = new Map(), at = null;

  async function load() {
    el.innerHTML = '<div class="loading">Opening the desk…</div>';
    const since = new Date(Date.now() - 45 * 86400e3).toISOString();
    const [p, ex, meta] = await Promise.all([
      api(`expert_picks?select=*&starts_at=gte.${encodeURIComponent(since)}&order=starts_at.asc&limit=5000`, { ttl: 120_000 }),
      api('experts?select=*', { ttl: 600_000 }),
      api('blobs?key=eq.action:experts&select=data', { ttl: 60_000 }),
    ]);
    picks = p; experts = new Map(ex.map((e) => [e.id, e])); at = meta[0]?.data?.at ? new Date(meta[0].data.at) : null;
    const gids = [...new Set(picks.map((x) => x.action_game_id))];
    games = new Map();
    for (let i = 0; i < gids.length; i += 150) {
      const part = await api(`splits_latest?select=action_id,league,start_time,status,data&action_id=in.(${gids.slice(i, i + 150).join(',')})`, { ttl: 120_000 });
      for (const g of part) games.set(g.action_id, g);
    }
    draw();
  }

  const expRec = (e) => e?.record ? `${e.record.win}–${e.record.loss}${e.record.push ? '–' + e.record.push : ''}` : '—';
  const expUnits = (e) => e?.record?.units_net ?? null;

  function stacks(list) {
    // group by game + market + side, ignoring half-point differences
    const m = new Map();
    for (const k of list) {
      const mk = MKT(k.type); if (!mk || !k.side) continue;
      const key = `${k.action_game_id}|${mk}|${k.side}`;
      if (!m.has(key)) m.set(key, { key, gid: k.action_game_id, mk, side: k.side, picks: [] });
      if (!m.get(key).picks.some((x) => x.expert_id === k.expert_id)) m.get(key).picks.push(k);
    }
    return [...m.values()];
  }
  const sideLabel = (g, mk, side) => mk === 'tot' ? (side === 'over' ? 'Over' : 'Under') : (side === 'home' ? g?.data?.home : g?.data?.away)?.nick ?? side;
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

  function draw() {
    const lgPicks = picks.filter((k) => k.league === st.lg);
    const open = lgPicks.filter((k) => k.status !== 'settled' && new Date(k.starts_at).getTime() > Date.now() - 4 * 3600e3);
    const st2 = stacks(open);
    const loud = st2.filter((s) => s.picks.length >= 3).sort((a, b) => b.picks.length - a.picks.length);
    // popular record: settled loud sides, graded by the pick at the median number
    const settled = stacks(lgPicks.filter((k) => k.status === 'settled'));
    let lw = 0, ll = 0, lp = 0;
    for (const s of settled.filter((x) => x.picks.length >= 3)) {
      const vals = s.picks.map((x) => Number(x.value)); const mv = median(vals);
      const pick = s.picks.find((x) => Number(x.value) === mv) ?? s.picks[0];
      if (pick.result === 'win') lw++; else if (pick.result === 'loss') ll++; else lp++;
    }
    const byGame = new Map();
    for (const s of st2) { if (!byGame.has(s.gid)) byGame.set(s.gid, []); byGame.get(s.gid).push(s); }
    const gameList = [...byGame.entries()].map(([gid, ss]) => ({ g: games.get(gid), ss })).filter((x) => x.g).sort((a, b) => new Date(a.g.start_time) - new Date(b.g.start_time));
    const board = [...experts.values()].filter((e) => e.record?.count).sort((a, b) => (b.record.units_net ?? 0) - (a.record.units_net ?? 0));

    const pickRow = (k) => { const e = experts.get(k.expert_id); const u = expUnits(e);
      return `<div class="row" style="justify-content:space-between;padding:5px 0;border-top:1px solid var(--line);font-size:13px">
        <span><b>${esc(e?.name ?? 'Expert')}</b> <span class="dim">${expRec(e)}${u !== null ? ` · ${u >= 0 ? '+' : ''}${u.toFixed(1)}u` : ''} last month</span></span>
        <span class="num">${esc(k.play)} ${k.odds ? `<span class="dim">${odds(k.odds)}</span>` : ''}${k.units ? ` <span class="dim">${k.units}u</span>` : ''}</span></div>`; };

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Handicapper overlap</div><h1>Cap’n Cash</h1><p>Public handicapper cards stacked by game. A side is <b>loud</b> when 3 or more handicappers are on it, ignoring half-point differences.</p></div>
      <div class="row"><span class="stamp">Cards ${esc(ago(at))}</span><button class="btn" data-act="refresh">↻ Refresh</button></div></div>
    ${howTo('How it works', `<ol>
      <li>Picks come from the handicappers Action Network lists publicly, refreshed every 30 minutes. Each one shows their last-month record and units, so you can see who’s actually winning.</li>
      <li>Loud sides are graded after the final at the median number among the handicappers on it. That’s the popular record below.</li>
      <li>Pickswise, Doc’s Sports, ESPN, and CBS Sports are next on the list to add.</li></ol>`, 'capn')}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Handicappers</div><div class="v num">${experts.size}</div><div class="s">with public cards</div></div>
      <div class="card stat"><div class="k">Open picks</div><div class="v num">${open.length}</div><div class="s">${esc(LGS.find((x) => x[0] === st.lg)[1])}, not yet played</div></div>
      <div class="card stat"><div class="k">Loudest stack</div><div class="v num">${loud[0] ? loud[0].picks.length : '—'}</div><div class="s">${loud[0] ? esc(sideLabel(games.get(loud[0].gid), loud[0].mk, loud[0].side) + ' · ' + MKN[loud[0].mk]) : 'needs 3 on one side'}</div></div>
      <div class="card stat"><div class="k">Popular record</div><div class="v num">${lw + ll ? `${lw}–${ll}${lp ? '–' + lp : ''}` : '—'}</div><div class="s">loud sides, finals only</div></div>
    </div>
    <div class="row" style="margin-bottom:12px">${seg('lg', LGS, st.lg)} ${seg('tab', [['board', 'Board'], ['cappers', 'Handicappers']], st.tab)}</div>
    ${st.tab === 'board' ? `
      ${loud.length ? `<div class="sec" style="margin-top:4px"><h2>Loud sides</h2><div class="grid g2">${loud.map((s) => { const g = games.get(s.gid); const vals = s.picks.map((x) => Number(x.value));
        return `<div class="card hl"><div class="dim" style="font-size:12.5px">${g ? `${esc(g.data.away?.abbr)} @ ${esc(g.data.home?.abbr)} · ${esc(fmtDay(g.start_time))} ${esc(fmtTime(g.start_time))}` : ''}</div>
        <div class="row" style="justify-content:space-between;margin:4px 0 6px"><b class="disp" style="font-size:22px">${esc(sideLabel(g, s.mk, s.side))} ${s.mk === 'ml' ? '' : s.mk === 'tot' ? median(vals) : line(median(vals))}</b><span class="chip gold">${s.picks.length} on it</span></div>
        ${s.picks.map(pickRow).join('')}</div>`; }).join('')}</div></div>` : '<div class="empty">No side has 3 handicappers on it yet. Cards fill in through the week.</div>'}
      <div class="sec"><h2>Every card</h2><p class="sub">All open picks, by game.</p><div class="grid g2">${gameList.map(({ g, ss }) => `<div class="card">
        <div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(fmtDay(g.start_time))} · ${esc(fmtTime(g.start_time))}</span><span class="dim">${ss.reduce((a, s) => a + s.picks.length, 0)} picks</span></div>
        <div class="team" style="margin-top:8px">${img(g.data.away?.logo)}<b>${esc(g.data.away?.nick ?? '')}</b></div><div class="team" style="margin-top:4px">${img(g.data.home?.logo)}<b>${esc(g.data.home?.nick ?? '')}</b></div>
        ${ss.sort((a, b) => b.picks.length - a.picks.length).map((s) => `<div style="margin-top:10px"><div class="row" style="justify-content:space-between"><b style="font-size:13px">${esc(sideLabel(g, s.mk, s.side))} · ${MKN[s.mk]}</b><span class="chip ${s.picks.length >= 3 ? 'gold' : ''}">${s.picks.length}</span></div>${s.picks.map(pickRow).join('')}</div>`).join('')}
      </div>`).join('') || '<div class="empty">No open picks yet for this league.</div>'}</div></div>`
    : `<div class="sec"><h2>Handicappers</h2><p class="sub">Ranked by units won over the last month, as Action Network reports it. Graded picks build up here over time.</p>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Handicapper</th><th class="r">Record</th><th class="r">Units</th><th class="r">ROI</th><th class="r">Followers</th></tr>
      ${board.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td class="r num">${expRec(e)}</td><td class="r num ${e.record.units_net >= 0 ? 'mint' : 'clay'}">${e.record.units_net >= 0 ? '+' : ''}${Number(e.record.units_net).toFixed(1)}</td><td class="r num">${e.record.roi !== null && e.record.roi !== undefined ? `${Number(e.record.roi).toFixed(1)}%` : '—'}</td><td class="r num dim">${e.followers ? e.followers.toLocaleString() : '—'}</td></tr>`).join('')}
      </table></div></div>`}
    ${footNote('Picks: public handicapper cards on Action Network. Records are last-month figures as published there. Not a promise, not advice.')}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('capn:lg', v); draw(); });
    onSeg(el, 'tab', (v) => { st.tab = v; store.set('capn:tab', v); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
}
