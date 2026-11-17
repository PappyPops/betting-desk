import { api, esc, seg, onSeg, store, odds, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, ago, logo } from './core.js?v=202611162202';

const LGS = [['nfl', 'NFL'], ['cfb', 'College'], ['nba', 'NBA']];
const SRC = { action: 'Action', docs: 'Doc’s', espn: 'ESPN' };
const MKT = (t) => /^spread/.test(t) ? 'sp' : /^ml/.test(t) ? 'ml' : ['over', 'under'].includes(t) ? 'tot' : null;
const MKN = { sp: 'Spread', tot: 'Total', ml: 'Moneyline' };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export async function render(el) {
  const st = { lg: store.get('capn:lg', 'nfl'), tab: store.get('capn:tab', 'board') };
  let picks = [], experts = new Map(), games = new Map(), at = null;

  async function load() {
    el.innerHTML = '<div class="loading">Opening the desk…</div>';
    const since = new Date(Date.now() - 45 * 86400e3).toISOString();
    const [p, ex, meta] = await Promise.all([
      api(`expert_picks?select=*&starts_at=gte.${encodeURIComponent(since)}&order=starts_at.asc&limit=8000`, { ttl: 120_000 }),
      api('experts?select=*', { ttl: 600_000 }),
      api('blobs?key=in.(action:experts,picks:other)&select=key,data', { ttl: 60_000 }),
    ]);
    // full-game sides only: first-half, quarter and team-total picks aren't the same bet
    picks = p.filter((k) => k.espn_id && !/\((1H|2H|1Q|2Q|3Q|4Q|1P|2P|3P)\)/i.test(k.play || '')); experts = new Map(ex.map((e) => [e.id, e]));
    at = meta.map((m) => m.data?.at).filter(Boolean).sort().pop(); at = at ? new Date(at) : null;
    const gids = [...new Set(picks.map((x) => x.espn_id))];
    games = new Map();
    for (let i = 0; i < gids.length; i += 150) {
      const part = await api(`games?select=id,league,start_time,state,home_score,away_score,data&id=in.(${gids.slice(i, i + 150).join(',')})`, { ttl: 120_000 });
      for (const g of part) games.set(g.id, g);
    }
    draw();
  }

  const expRec = (e) => e?.record?.count ? `${e.record.win}–${e.record.loss}${e.record.push ? '–' + e.record.push : ''}` : 'new';
  const sideLabel = (g, mk, side) => mk === 'tot' ? (side === 'over' ? 'Over' : 'Under') : (g?.data?.[side])?.short ?? side;

  function stacks(list) {
    const m = new Map();
    for (const k of list) {
      const mk = MKT(k.type); if (!mk || !k.side) continue;
      const key = `${k.espn_id}|${mk}|${k.side}`;
      if (!m.has(key)) m.set(key, { key, gid: k.espn_id, mk, side: k.side, picks: [] });
      if (!m.get(key).picks.some((x) => x.expert_id === k.expert_id)) m.get(key).picks.push(k);
    }
    return [...m.values()];
  }

  function draw() {
    const now = Date.now();
    const lgPicks = picks.filter((k) => k.league === st.lg);
    const isOpen = (k) => k.status !== 'settled' && new Date(k.starts_at).getTime() > now - 4 * 3600e3;
    // ESPN's panel picks winners straight up; shown as a panel line, not counted toward loud
    const betPicks = lgPicks.filter((k) => k.source !== 'espn');
    const open = betPicks.filter(isOpen);
    const panel = new Map();
    for (const k of lgPicks.filter((x) => x.source === 'espn' && isOpen(x))) { const p = panel.get(k.espn_id) ?? { home: 0, away: 0 }; p[k.side]++; panel.set(k.espn_id, p); }
    const st2 = stacks(open);
    const loud = st2.filter((s) => s.picks.length >= 3).sort((a, b) => b.picks.length - a.picks.length);
    let lw = 0, ll = 0, lp = 0;
    for (const s of stacks(betPicks.filter((k) => k.status === 'settled')).filter((x) => x.picks.length >= 3)) {
      const mv = median(s.picks.map((x) => Number(x.value)));
      const pick = s.picks.find((x) => Number(x.value) === mv) ?? s.picks[0];
      if (pick.result === 'win') lw++; else if (pick.result === 'loss') ll++; else lp++;
    }
    const byGame = new Map();
    for (const s of st2) { if (!byGame.has(s.gid)) byGame.set(s.gid, []); byGame.get(s.gid).push(s); }
    for (const gid of panel.keys()) if (!byGame.has(gid)) byGame.set(gid, []);
    const gameList = [...byGame.entries()].map(([gid, ss]) => ({ gid, g: games.get(gid), ss })).filter((x) => x.g && x.g.league === st.lg).sort((a, b) => new Date(a.g.start_time) - new Date(b.g.start_time));
    const board = [...experts.values()].filter((e) => e.record?.count).sort((a, b) => (b.record.units_net ?? -99) - (a.record.units_net ?? -99));

    const pickRow = (k) => { const e = experts.get(k.expert_id); const u = e?.record?.units_net;
      return `<div class="row" style="justify-content:space-between;padding:5px 0;border-top:1px solid var(--line);font-size:13px">
        <span><span class="chip" style="font-size:10.5px;padding:0 6px">${SRC[k.source] ?? k.source}</span> <b>${esc(e?.name ?? 'Handicapper')}</b> <span class="dim">${expRec(e)}${u !== null && u !== undefined && e?.record?.count ? ` · ${u >= 0 ? '+' : ''}${Number(u).toFixed(1)}u` : ''}</span></span>
        <span class="num">${esc(k.play)}${k.odds && k.source === 'action' ? ` <span class="dim">${odds(k.odds)}</span>` : ''}${k.units ? ` <span class="dim">${k.units}u</span>` : ''}</span></div>`; };
    const panelLine = (gid, g) => { const p = panel.get(gid); if (!p) return ''; const n = p.home + p.away; const lead = p.home >= p.away ? 'home' : 'away';
      return `<div class="dim" style="font-size:12.5px;margin-top:8px">ESPN panel: <b class="muted">${p[lead]} of ${n}</b> pick ${esc(g.data[lead].short)} to win</div>`; };

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Handicapper overlap</div><h1>Cap’n Cash</h1><p>Public handicapper cards stacked by game. A side is <b>loud</b> when 3 or more handicappers are on it, ignoring half-point differences.</p></div>
      <div class="row"><span class="stamp">Cards ${esc(ago(at))}</span><button class="btn" data-act="refresh">↻ Refresh</button></div></div>
    ${howTo('How it works', `<ol>
      <li>Picks come from Action Network’s public handicappers (every 30 minutes), Doc’s Sports free picks, and ESPN’s NFL expert panel (every 2 hours).</li>
      <li>ESPN’s panel only picks winners, not spreads, so it shows as its own line on each game and doesn’t count toward loud.</li>
      <li>Loud sides are graded after the final at the median number among the handicappers on it. Doc’s handicappers start with a blank record and build one here as their picks are graded.</li>
      <li>CBS Sports and Pickswise load their picks in the browser, out of reach of the backend, so they aren’t included.</li></ol>`, 'capn')}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Handicappers</div><div class="v num">${experts.size}</div><div class="s">Action, Doc’s, ESPN</div></div>
      <div class="card stat"><div class="k">Open picks</div><div class="v num">${open.length}</div><div class="s">${esc(LGS.find((x) => x[0] === st.lg)[1])}, not yet played</div></div>
      <div class="card stat"><div class="k">Loudest stack</div><div class="v num">${loud[0] ? loud[0].picks.length : '—'}</div><div class="s">${loud[0] ? esc(sideLabel(games.get(loud[0].gid), loud[0].mk, loud[0].side) + ' · ' + MKN[loud[0].mk]) : 'needs 3 on one side'}</div></div>
      <div class="card stat"><div class="k">Popular record</div><div class="v num">${lw + ll ? `${lw}–${ll}${lp ? '–' + lp : ''}` : '—'}</div><div class="s">loud sides, finals only</div></div>
    </div>
    <div class="row" style="margin-bottom:12px">${seg('lg', LGS, st.lg)} ${seg('tab', [['board', 'Board'], ['cappers', 'Handicappers']], st.tab)}</div>
    ${st.tab === 'board' ? `
      ${loud.length ? `<div class="sec" style="margin-top:4px"><h2>Loud sides</h2><div class="grid g2">${loud.map((s) => { const g = games.get(s.gid); const mv = median(s.picks.map((x) => Number(x.value)));
        return `<div class="card hl"><div class="dim" style="font-size:12.5px">${g ? `${esc(g.data.away.abbr)} @ ${esc(g.data.home.abbr)} · ${esc(fmtDay(g.start_time))} ${esc(fmtTime(g.start_time))}` : ''}</div>
        <div class="row" style="justify-content:space-between;margin:4px 0 6px"><b class="disp" style="font-size:22px">${esc(sideLabel(g, s.mk, s.side))} ${s.mk === 'ml' ? 'ML' : s.mk === 'tot' ? mv : line(mv)}</b><span class="chip gold">${s.picks.length} on it</span></div>
        ${s.picks.map(pickRow).join('')}</div>`; }).join('')}</div></div>` : '<div class="empty">No side has 3 handicappers on it yet. Cards fill in through the week.</div>'}
      <div class="sec"><h2>Every card</h2><p class="sub">All open picks, by game.</p><div class="grid g2">${gameList.map(({ gid, g, ss }) => `<div class="card">
        <div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(fmtDay(g.start_time))} · ${esc(fmtTime(g.start_time))}</span><span class="dim">${ss.reduce((a, s) => a + s.picks.length, 0)} picks</span></div>
        <div class="team" style="margin-top:8px">${logo(g.data.away)}<b>${esc(g.data.away.short)}</b></div><div class="team" style="margin-top:4px">${logo(g.data.home)}<b>${esc(g.data.home.short)}</b></div>
        ${panelLine(gid, g)}
        ${ss.sort((a, b) => b.picks.length - a.picks.length).map((s) => `<div style="margin-top:10px"><div class="row" style="justify-content:space-between"><b style="font-size:13px">${esc(sideLabel(g, s.mk, s.side))} · ${MKN[s.mk]}</b><span class="chip ${s.picks.length >= 3 ? 'gold' : ''}">${s.picks.length}</span></div>${s.picks.map(pickRow).join('')}</div>`).join('')}
      </div>`).join('') || '<div class="empty">No open picks yet for this league.</div>'}</div></div>`
    : `<div class="sec"><h2>Handicappers</h2><p class="sub">Ranked by units. Action records are last-month figures as Action publishes them; ESPN records are straight-up winners this season; Doc’s records are built here.</p>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Handicapper</th><th>Source</th><th class="r">Record</th><th class="r">Units</th><th class="r">Window</th></tr>
      ${board.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td><span class="chip">${SRC[e.source] ?? e.source}</span></td><td class="r num">${expRec(e)}</td>
        <td class="r num ${(e.record.units_net ?? 0) >= 0 ? 'mint' : 'clay'}">${e.record.units_net !== null && e.record.units_net !== undefined ? `${e.record.units_net >= 0 ? '+' : ''}${Number(e.record.units_net).toFixed(1)}` : '—'}</td>
        <td class="r dim" style="font-size:12.5px">${esc(e.record.window === 'last_month' ? 'last month' : e.record.window ?? '')}</td></tr>`).join('')}
      </table></div></div>`}
    ${footNote('Picks: Action Network public handicappers, Doc’s Sports free picks, ESPN NFL expert picks. Not a promise, not advice.')}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('capn:lg', v); draw(); });
    onSeg(el, 'tab', (v) => { st.tab = v; store.set('capn:tab', v); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
}
