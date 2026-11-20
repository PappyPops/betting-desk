import { api, esc, seg, onSeg, store, odds, line, fmtTime, fmtDay, howTo, wireHow, footNote, clearCache, ago, logo } from './core.js?v=202611201524';

const LGS = [['nfl', 'NFL'], ['cfb', 'College'], ['nba', 'NBA']];
const SRC = { action: 'Action', docs: 'Doc’s', espn: 'ESPN', cbs: 'CBS', pickswise: 'Pickswise', covers: 'Covers', dimers: 'Dimers', espnmodel: 'ESPN' };
const MODEL = new Set(['covers', 'dimers', 'espnmodel']); // computer picks, not people
const MKT = (t) => /^spread/.test(t) ? 'sp' : /^ml/.test(t) ? 'ml' : ['over', 'under'].includes(t) ? 'tot' : null;
const MKN = { sp: 'Spread', tot: 'Total', ml: 'Moneyline' };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export async function render(el) {
  const st = { lg: store.get('capn:lg', 'nfl'), tab: store.get('capn:tab', 'board') };
  let picks = [], experts = new Map(), games = new Map(), at = null, cbsRec = new Map(), since = {};
  const follows = new Set(store.get('capn:follow', []));

  async function load() {
    el.innerHTML = '<div class="loading">Opening the desk…</div>';
    const from = new Date(Date.now() - 45 * 86400e3).toISOString();
    const [p, ex, meta] = await Promise.all([
      api(`expert_picks?select=*&starts_at=gte.${encodeURIComponent(from)}&order=starts_at.asc&limit=8000`, { ttl: 120_000 }),
      api('experts?select=*', { ttl: 600_000 }),
      api('blobs?key=in.(action:experts,picks:other)&select=key,data', { ttl: 60_000 }),
      api('cbs_records?select=*', { ttl: 600_000 }).catch(() => []),
    ]).then(([a, b, c, d]) => { cbsRec = new Map(d.map((r) => [`${r.expert_id}|${r.league}`, r])); return [a, b, c]; });
    // full-game sides only: first-half, quarter and team-total picks aren't the same bet
    picks = p.filter((k) => k.espn_id && !/\((1H|2H|1Q|2Q|3Q|4Q|1P|2P|3P)\)/i.test(k.play || '')); experts = new Map(ex.map((e) => [e.id, e]));
    since = {}; for (const k of p) if (!since[k.source] || k.starts_at < since[k.source]) since[k.source] = k.starts_at;
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
  const rt = (r) => r && r.w + r.l + r.p ? `${r.w}–${r.l}${r.p ? '–' + r.p : ''}` : '—';
  const rp = (r) => r && r.w + r.l ? r.w / (r.w + r.l) : null;
  // Records for one handicapper in one league: the long record (season or as published) and the last 30 days.
  // CBS: CBS's own season and the last five weeks of its pages. Action: Action publishes last month only.
  // Everyone else: picks graded here, which started on the date in `since` for that source.
  function recs(e, lg) {
    if (!e) return { long: null, l30: null };
    const settled30 = (id) => { const r = { w: 0, l: 0, p: 0 }; const cut = Date.now() - 30 * 86400e3; for (const k of picks) if (k.expert_id === id && k.league === lg && k.status === 'settled' && new Date(k.starts_at).getTime() >= cut) { if (k.result === 'win') r.w++; else if (k.result === 'loss') r.l++; else if (k.result === 'push') r.p++; } return r; };
    const er = e.record?.count ? { w: e.record.win, l: e.record.loss, p: e.record.push || 0 } : null;
    if (e.source === 'cbs') { const c = cbsRec.get(`${e.id}|${lg}`); return c ? { long: { w: c.season_w, l: c.season_l, p: c.season_p }, longLab: 'season ATS', l30: c.l30_w !== null ? { w: c.l30_w, l: c.l30_l, p: c.l30_p } : null, l30Lab: 'L30' } : { long: er, longLab: 'season ATS', l30: null }; }
    if (e.source === 'action') return { long: null, l30: er, l30Lab: 'L30' };
    const s30 = settled30(e.id), started = since[e.source], full = started && Date.now() - new Date(started).getTime() >= 30 * 86400e3;
    return { long: e.source === 'espn' || full ? er : null, longLab: e.source === 'espn' ? 'season, to win' : 'tracked here', l30: s30.w + s30.l + s30.p ? s30 : null, l30Lab: full ? 'L30' : `since ${new Date(started).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  // hot = 60%+ over enough games to mean something
  const hot = (R) => (R.l30 && R.l30.w + R.l30.l >= 10 && rp(R.l30) >= 0.6) || (R.long && R.long.w + R.long.l >= 30 && rp(R.long) >= 0.6);
  const star = (id) => `<button class="btn" data-follow="${id}" title="${follows.has(String(id)) ? 'Unfollow' : 'Follow'}" style="padding:0 6px;font-size:13px;line-height:1.4;border:none;background:none;color:${follows.has(String(id)) ? 'var(--gold)' : 'var(--muted)'}">${follows.has(String(id)) ? '★' : '☆'}</button>`;
  const recLine = (R) => [R.long ? `<span title="${esc(R.longLab)}">${rt(R.long)}</span>` : '', R.l30 ? `<span title="${esc(R.l30Lab)}">(${esc(R.l30Lab)}) <b class="${rp(R.l30) >= 0.6 && R.l30.w + R.l30.l >= 10 ? 'gold' : rp(R.l30) !== null && rp(R.l30) < 0.5 ? 'clay' : ''}">${rt(R.l30)}</b></span>` : ''].filter(Boolean).join(' ') || 'new';
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
    const lgIds = new Set(lgPicks.map((k) => k.expert_id));
    const board = [...experts.values()].filter((e) => lgIds.has(e.id) && !MODEL.has(e.source)).map((e) => ({ e, R: recs(e, st.lg) })).filter((x) => x.R.long || x.R.l30)
      .sort((a, b) => (follows.has(String(b.e.id)) - follows.has(String(a.e.id))) || (hot(b.R) - hot(a.R)) || ((rp(b.R.l30) ?? rp(b.R.long) ?? 0) - (rp(a.R.l30) ?? rp(a.R.long) ?? 0)));

    const pickRow = (k) => { const e = experts.get(k.expert_id); const R = recs(e, k.league); const f = follows.has(String(k.expert_id)), h = hot(R);
      return `<div class="row" style="justify-content:space-between;padding:5px 0;border-top:1px solid var(--line);font-size:13px;${f || h ? 'background:linear-gradient(90deg,#f0b4291f,transparent 70%);' : ''}">
        <span>${star(k.expert_id)}<span class="chip" style="font-size:10.5px;padding:0 6px">${MODEL.has(k.source) ? 'Model' : SRC[k.source] ?? k.source}</span> <b class="${f || h ? 'gold' : ''}">${esc(e?.name ?? 'Handicapper')}</b> <span class="dim">${recLine(R)}</span></span>
        <span class="num">${esc(k.play)}${k.odds && k.source === 'action' ? ` <span class="dim">${odds(k.odds)}</span>` : ''}</span></div>`; };
    const rank = (k) => { const R = recs(experts.get(k.expert_id), k.league); return (follows.has(String(k.expert_id)) ? 2 : 0) + (hot(R) ? 1 : 0); };
    const rows = (list) => [...list].sort((a, b) => rank(b) - rank(a)).map(pickRow).join('');
    const panelLine = (gid, g) => { const p = panel.get(gid); if (!p) return ''; const n = p.home + p.away; const lead = p.home >= p.away ? 'home' : 'away';
      return `<div class="dim" style="font-size:12.5px;margin-top:8px">ESPN panel: <b class="muted">${p[lead]} of ${n}</b> pick ${esc(g.data[lead].short)} to win</div>`; };

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Handicapper overlap</div><h1>Cap’n Cash</h1><p>Public handicapper cards stacked by game. A side is <b>loud</b> when 3 or more handicappers are on it, ignoring half-point differences.</p></div>
      <div class="row"><span class="stamp">Cards ${esc(ago(at))}</span><button class="btn" data-act="refresh">↻ Refresh</button></div></div>
    ${howTo('How it works', `<ol>
      <li><b>Handicappers:</b> Action Network (every 30 minutes), CBS Sports’ experts against the spread (NFL, college), Pickswise’s experts (NFL, college, NBA), Doc’s Sports free picks, and ESPN’s NFL panel (every 2 hours).</li>
      <li><b>Models</b> (marked “model”): the OddsShark computer on Covers (a predicted score for every game, turned into a spread and a total pick when it’s half a point or more off DraftKings), and the Dimers and ESPN win-chance models, which only pick a moneyline when they rate a side 3+ points higher than DraftKings’ price implies.</li>
      <li>ESPN’s panel only picks winners, not spreads, so it shows as its own line on each game and doesn’t count toward loud.</li>
      <li>Loud sides are graded after the final at the median number among the handicappers on it. Each handicapper shows two records: the longer one (CBS’s season against the spread, ESPN’s season picking winners, or picks graded here) and, in parentheses, the last 30 days. CBS’s last 30 days come from its own weekly pages; Action publishes only last month; everyone else is graded here, so until a source has 30 days of grading it says “since” the date it started.</li>
      <li><b>Follow</b> anyone with ☆; they’re starred, highlighted and listed first. Names in <b class="gold">gold</b> are hitting 60%+ (last 30 days with 10+ decisions, or the longer record with 30+). No unit records: units depend on bet sizing and are easy to dress up.</li>
      <li>Every source is graded here after the final, so the Handicappers tab shows who actually wins. SportsLine and Covers’ own experts sit behind a login or load in the browser, so they aren’t included.</li></ol>`, 'capn')}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card stat"><div class="k">Handicappers</div><div class="v num">${experts.size}</div><div class="s">Action, CBS, Pickswise, Doc’s, ESPN + 3 models</div></div>
      <div class="card stat"><div class="k">Open picks</div><div class="v num">${open.length}</div><div class="s">${esc(LGS.find((x) => x[0] === st.lg)[1])}, not yet played</div></div>
      <div class="card stat"><div class="k">Loudest stack</div><div class="v num">${loud[0] ? loud[0].picks.length : '—'}</div><div class="s">${loud[0] ? esc(sideLabel(games.get(loud[0].gid), loud[0].mk, loud[0].side) + ' · ' + MKN[loud[0].mk]) : 'needs 3 on one side'}</div></div>
      <div class="card stat"><div class="k">Popular record</div><div class="v num">${lw + ll ? `${lw}–${ll}${lp ? '–' + lp : ''}` : '—'}</div><div class="s">loud sides, finals only</div></div>
    </div>
    <div class="row" style="margin-bottom:12px">${seg('lg', LGS, st.lg)} ${seg('tab', [['board', 'Board'], ['cappers', 'Handicappers']], st.tab)}</div>
    ${st.tab === 'board' ? `
      ${loud.length ? `<div class="sec" style="margin-top:4px"><h2>Loud sides</h2><div class="grid g2">${loud.map((s) => { const g = games.get(s.gid); const mv = median(s.picks.map((x) => Number(x.value)));
        return `<div class="card hl"><div class="dim" style="font-size:12.5px">${g ? `${esc(g.data.away.abbr)} @ ${esc(g.data.home.abbr)} · ${esc(fmtDay(g.start_time))} ${esc(fmtTime(g.start_time))}` : ''}</div>
        <div class="row" style="justify-content:space-between;margin:4px 0 6px"><b class="disp" style="font-size:22px">${esc(sideLabel(g, s.mk, s.side))} ${s.mk === 'ml' ? 'ML' : s.mk === 'tot' ? mv : line(mv)}</b><span class="chip gold">${s.picks.length} on it</span></div>
        ${rows(s.picks)}</div>`; }).join('')}</div></div>` : '<div class="empty">No side has 3 handicappers on it yet. Cards fill in through the week.</div>'}
      <div class="sec"><h2>Every card</h2><p class="sub">All open picks, by game.</p><div class="grid g2">${gameList.map(({ gid, g, ss }) => `<div class="card">
        <div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(fmtDay(g.start_time))} · ${esc(fmtTime(g.start_time))}</span><span class="dim">${(() => { const all = ss.flatMap((s) => s.picks); const pn = panel.get(gid); const n = all.length + (pn ? pn.home + pn.away : 0); const by = {}; for (const k of all) by[k.source] = (by[k.source] || 0) + 1; if (pn) by.espn = pn.home + pn.away; return `${n} picks · ${Object.entries(by).map(([k, v]) => `${SRC[k] ?? k} ${v}`).join(', ')}`; })()}</span></div>
        <div class="team" style="margin-top:8px">${logo(g.data.away)}<b>${esc(g.data.away.short)}</b></div><div class="team" style="margin-top:4px">${logo(g.data.home)}<b>${esc(g.data.home.short)}</b></div>
        ${panelLine(gid, g)}
        ${ss.sort((a, b) => b.picks.length - a.picks.length).map((s) => `<div style="margin-top:10px"><div class="row" style="justify-content:space-between"><b style="font-size:13px">${esc(sideLabel(g, s.mk, s.side))} · ${MKN[s.mk]}</b><span class="chip ${s.picks.length >= 3 ? 'gold' : ''}">${s.picks.length}</span></div>${rows(s.picks)}</div>`).join('')}
      </div>`).join('') || '<div class="empty">No open picks yet for this league.</div>'}</div></div>`
    : `<div class="sec"><h2>Handicappers</h2><p class="sub">Tap ☆ to follow someone; followed handicappers are starred and listed first on every card. <b class="gold">Gold</b> names are hitting 60%+ over the last 30 days (10+ decisions) or over their longer record (30+). Win–loss only: units depend on how each one sizes bets, so they aren’t shown.</p>
      <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Handicapper</th><th>Source</th><th class="r">Record</th><th class="r">Last 30 days</th></tr>
      ${board.map(({ e, R }) => { const f = follows.has(String(e.id)), h = hot(R); return `<tr><td>${star(e.id)}<b class="${f || h ? 'gold' : ''}">${esc(e.name)}</b></td><td><span class="chip">${SRC[e.source] ?? e.source}</span></td>
        <td class="r num">${R.long ? `${rt(R.long)}<div class="dim" style="font-size:12px">${R.long.w + R.long.l ? Math.round(rp(R.long) * 100) + '% · ' : ''}${esc(R.longLab)}</div>` : '<span class="dim">—</span>'}</td>
        <td class="r num">${R.l30 ? `<b class="${rp(R.l30) >= 0.6 && R.l30.w + R.l30.l >= 10 ? 'gold' : rp(R.l30) < 0.5 ? 'clay' : ''}">${rt(R.l30)}</b><div class="dim" style="font-size:12px">${R.l30.w + R.l30.l ? Math.round(rp(R.l30) * 100) + '% · ' : ''}${esc(R.l30Lab === 'L30' ? (e.source === 'action' ? 'last month, per Action' : e.source === 'cbs' ? 'last 5 CBS weeks' : 'graded here') : R.l30Lab)}</div>` : '<span class="dim">—</span>'}</td></tr>`; }).join('')}
      </table></div></div>`}
    ${footNote('Picks: Action Network public handicappers, Doc’s Sports free picks, ESPN NFL expert picks. Not a promise, not advice.')}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('capn:lg', v); draw(); });
    onSeg(el, 'tab', (v) => { st.tab = v; store.set('capn:tab', v); draw(); });
    el.querySelectorAll('[data-follow]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); const id = b.dataset.follow; follows.has(id) ? follows.delete(id) : follows.add(id); store.set('capn:follow', [...follows]); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
}
