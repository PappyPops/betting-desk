// Slant: NFL player props before kickoff, ranked by expected value at −110, with every pick graded after the game.
import { api, games, esc, fmtTime, fmtDay, pct, sgn, seg, onSeg, store, howTo, wireHow, footNote, clearCache } from './core.js?v=202611221424';
import { STATS, TYPE_GROUP, propData, project, probOver, boxVal, calibrate } from './propmodel.js?v=202611221424';
import { trackBtn } from './mybets.js?v=202611221424';

const PAY = 100 / 110;
export const MIN_EV = 0.06; // a pick needs 6%+ expected value at −110 (about 55.5% to win)
// TD counts and tiny lines (1.5 catches and the like) usually carry heavy juice that the free feed doesn't show, so they're priced but never picked
const PICKABLE = (r) => r.p.stat !== 'pass_td' && !(r.line < 2.5 && !STATS[r.p.stat].yards) && !r.status; // and never a player on the injury report

export async function slantRows() {
  const d = await propData();
  calibrate(d);
  const now = Date.now();
  const props = [];
  for (let off = 0; off < 20000; off += 1000) { const p = await api(`props?select=*&order=game_id&offset=${off}&limit=1000`, { ttl: 300_000 }); props.push(...p); if (p.length < 1000) break; }
  const ids = [...new Set(props.map((p) => p.game_id))];
  const G = new Map(); for (let i = 0; i < ids.length; i += 150) for (const g of await api(`games?select=id,start_time,state,home,away,home_score,away_score,spread_home,total,data&id=in.(${ids.slice(i, i + 150).join(',')})`, { ttl: 120_000 })) G.set(String(g.id), g);
  const finals = new Map(); for (const s of await api(`whistle_snaps?select=game_id,box&period=eq.4&limit=1000`, { ttl: 300_000 })) finals.set(String(s.game_id), s.box);
  const ctxRows = new Map((await api('game_context?select=*&limit=1000', { ttl: 300_000 })).map((c) => [String(c.game_id), c]));
  const OUT = /^(out|doubtful|injured reserve|ir|suspension)/i;
  // each player's team (nflverse code), from his latest game, or failing that his listed team
  const teamOf = (a, g, hg) => {
    const l = a?.gsis ? d.byPid.get(a.gsis) || [] : [];
    if (l.length) return l[l.length - 1].team;
    const m = { [g.home]: hg.home_team, [g.away]: hg.away_team };
    return m[a?.team] ?? (a?.team === hg.home_team || a?.team === hg.away_team ? a.team : null);
  };
  const ctxCache = new Map();
  const ctxFor = (g, hg, team) => {
    const k = `${g.id}|${team}`; if (ctxCache.has(k)) return ctxCache.get(k);
    const c = ctxRows.get(String(g.id));
    const out = (c?.injuries || []).filter((x) => OUT.test(x.status || '')).map((x) => ({ ...x, gsis: d.ath.get(String(x.id))?.gsis })).filter((x) => x.gsis && teamOf(d.ath.get(String(x.id)), g, hg) === team);
    const qbProp = props.find((q) => String(q.game_id) === String(g.id) && q.stat === 'pass_yds' && teamOf(d.ath.get(String(q.athlete_id)), g, hg) === team);
    const qa = qbProp ? d.ath.get(String(qbProp.athlete_id)) : null;
    const isHome = team === hg.home_team;
    const ctx = { team, out, qb: qa ? { gsis: qa.gsis, name: qa.name, passYds: Number(g.state === 'pre' ? qbProp.line_now : qbProp.line_close) } : null,
      weather: c?.weather ?? null, roof: hg.roof, spread: g.spread_home === null || g.spread_home === undefined ? NaN : (isHome ? Number(g.spread_home) : -Number(g.spread_home)), total: Number(g.total), injuries: c?.injuries || [] };
    ctxCache.set(k, ctx); return ctx;
  };
  const out = [];
  for (const p of props) {
    const g = G.get(String(p.game_id)), hg = d.week.get(String(p.game_id)), a = d.ath.get(String(p.athlete_id));
    if (!g || !hg || !a?.gsis) continue;
    const list = d.byPid.get(a.gsis) || [];
    const team = teamOf(a, g, hg); if (!team) continue;
    const ctx = ctxFor(g, hg, team);
    const me = ctx.injuries.find((x) => String(x.id) === String(p.athlete_id));
    if (me && OUT.test(me.status || '')) continue;
    const opp = team === hg.home_team ? hg.away_team : hg.home_team;
    const pos = d.posOf.get(a.gsis) || a.pos;
    const line = Number(g.state === 'pre' ? p.line_now : p.line_close);
    const pr = project(d, { gsis: a.gsis, pos, stat: p.stat, opp, wk: hg.week, line, open: Number(p.line_open), ctx }); if (!pr) continue;
    const pO = probOver(p.stat, pr.mean, line);
    const side = pO >= 0.5 ? 'over' : 'under', pS = side === 'over' ? pO : 1 - pO;
    const ev = pS * PAY - (1 - pS);
    let result = null, actual = null;
    if (g.state === 'post') {
      const box = finals.get(String(p.game_id));
      if (box) actual = boxVal(box[String(p.athlete_id)] ?? {}, p.stat);
      else { const r = list.find((x) => x.week === hg.week); if (r && d.rows.length) actual = STATS[p.stat].cols.reduce((s, c) => s + (r[c] || 0), 0); }
      if (actual !== null) result = actual === line ? 'P' : (actual > line) === (side === 'over') ? 'W' : 'L';
    }
    out.push({ p, g, hg, a, pos, team, opp, line, status: me?.status ?? null, open: Number(p.line_open), pr, pO, side, pS, ev, result, actual, upcoming: g.state === 'pre' && new Date(g.start_time).getTime() > now });
  }
  return out;
}

export async function render(el) {
  const st = { ty: store.get('sl:ty', 'all'), pos: store.get('sl:pos', 'all'), view: store.get('sl:view', 'board') };
  el.innerHTML = '<div class="loading">Pricing every prop…</div>';
  let rows = [];
  async function load() {
    try { rows = await slantRows(); } catch (e) { el.innerHTML = `<div class="err">Couldn’t load props (${esc(e.message)}). Try Refresh.</div>`; return; }
    draw();
  }
  function draw() {
    const keep = (r) => (st.ty === 'all' || TYPE_GROUP[r.p.stat] === st.ty) && (st.pos === 'all' || r.pos === st.pos);
    const board = rows.filter((r) => r.upcoming && r.ev >= MIN_EV && PICKABLE(r) && keep(r)).sort((a, b) => b.ev - a.ev);
    const graded = rows.filter((r) => r.result && r.ev >= MIN_EV && PICKABLE(r));
    const tally = (list) => list.reduce((a, r) => { a[r.result === 'W' ? 'w' : r.result === 'L' ? 'l' : 'p']++; return a; }, { w: 0, l: 0, p: 0 });
    const rt = (x) => `${x.w}–${x.l}${x.p ? '–' + x.p : ''}`;
    const rp = (x) => x.w + x.l ? x.w / (x.w + x.l) : null;
    const all = tally(graded);
    const breakdown = (key, labels) => labels.map(([k, lab]) => { const t = tally(graded.filter((r) => key(r) === k)); return `<tr><td>${lab}</td><td class="r num">${t.w + t.l ? rt(t) : '—'}</td><td class="r num">${pct(rp(t), 0)}</td></tr>`; }).join('');
    const posRank = (r) => r.pr.def.n ? `${r.opp} allows ${r.pr.def.per.toFixed(r.p.stat.includes('yds') ? 0 : 1)} ${STATS[r.p.stat].label.toLowerCase()} a game to ${r.pos}s (league ${r.pr.def.avg.toFixed(r.p.stat.includes('yds') ? 0 : 1)}).` : '';
    const card = (r, i) => `<div class="card">
      <div class="row" style="justify-content:space-between;font-size:12.5px"><span class="dim">${String(i + 1).padStart(2, '0')} · ${esc(r.pos)} · ${esc(r.team)} vs ${esc(r.opp)}</span><span class="dim">${esc(fmtDay(r.g.start_time))} ${esc(fmtTime(r.g.start_time))}</span></div>
      <div class="row" style="gap:10px;margin-top:6px">${r.a.headshot ? `<img src="${esc(r.a.headshot)}" alt="" width="44" height="44" style="border-radius:50%;object-fit:cover;background:var(--line2)">` : ''}<div><div class="disp" style="font-size:20px">${esc(r.a.name)}</div><div style="font-size:13px">${esc(STATS[r.p.stat].label)} · <b>${r.side === 'over' ? 'Over' : 'Under'} ${r.line}</b>${r.open !== r.line ? ` <span class="dim">(opened ${r.open})</span>` : ''}</div></div>
        <div style="margin-left:auto;text-align:right"><div class="disp mint" style="font-size:22px">+${(r.ev * 100).toFixed(1)}%</div><div class="dim" style="font-size:11.5px">EV at −110</div></div></div>
      <div style="font-size:12.5px;margin-top:8px">Projected <b>${r.pr.mean.toFixed(1)}</b> (form and matchup ${r.pr.model.toFixed(1)}, then weighted ${Math.round(r.pr.wModel * 100)}/${Math.round(100 - r.pr.wModel * 100)} with the line) · ${pct(r.pS, 0)} to hit</div>
      ${r.pr.sit.notes.length || r.pr.against ? `<div style="font-size:12.5px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line2)">${r.pr.against ? '<div class="clay">• The line has moved the other way since it opened, so the model counts for half as much.</div>' : ''}${r.pr.sit.notes.map((n) => `<div>• ${esc(n)}</div>`).join('')}</div>` : ''}
      <div class="dim" style="font-size:12.5px">Last ${r.pr.form.last.length}: ${r.pr.form.last.map((x) => Math.round(x * 10) / 10).join(' · ')}. ${esc(posRank(r))}</div>
      <div style="text-align:right;margin-top:8px">${trackBtn({ gid: String(r.p.game_id), market: 'prop', aid: String(r.p.athlete_id), stat: r.p.stat, side: r.side, line: r.line, name: r.a.name, game: `${r.team} vs ${r.opp}`, start: r.g.start_time, tool: 'Slant' })}</div></div>`;
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">NFL player props</div><h1>Slant</h1><p>Every DraftKings player prop priced against recent form and the matchup, ranked by expected value. Every pick is graded after the game.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How it works', `<ol><li><b>Form:</b> the player’s last four games (weighted toward the latest) blended with his season average.</li>
      <li><b>Matchup:</b> what the opponent has allowed to that position, compared with the league, pulled toward average until there are enough games.</li>
      <li><b>The situation:</b> a teammate ruled out (his share of targets or carries moves to the players left), who’s throwing (the starting QB’s own passing line against what the offense has thrown for lately, which catches a QB change like Cousins back in Minnesota), wind, rain and cold at outdoor stadiums, and game script from the spread (favorites run, underdogs throw). Every adjustment is spelled out on the card.</li>
      <li><b>The line counts most.</b> The model gets 25% and DraftKings’ line 75% (35/65 when a teammate being out or a QB change moves the model 8% or more; half the usual weight when the line has already moved against the model), because the market already knows things a box score doesn’t (injuries, snap counts, weather).</li>
      <li><b>Spread</b> comes from how far this model’s own projections missed in earlier weeks this season, so the percentages are measured, not assumed.</li>
      <li><b>EV</b> assumes −110 on both sides; DraftKings’ actual prices aren’t in the free feed, so check your book. A pick needs ${(MIN_EV * 100).toFixed(0)}%+, and players on the injury report are never picked. Touchdown counts and tiny lines (like 1.5 catches) are skipped because they usually carry juice the feed doesn’t show.</li>
      <li><b>The weights get tuned on results.</b> Once a few weeks are graded, the 25/75 split and the 6% bar get checked against what actually hit.</li></ol>`, 'sl')}
    <div class="grid g4">
      <div class="card stat"><div class="k">Record</div><div class="v num">${all.w + all.l ? rt(all) : '—'}</div><div class="s">${pct(rp(all), 1)} · break-even 52.4%</div></div>
      <div class="card stat"><div class="k">Overs</div><div class="v num">${rt(tally(graded.filter((r) => r.side === 'over')))}</div><div class="s">unders ${rt(tally(graded.filter((r) => r.side === 'under')))}</div></div>
      <div class="card stat"><div class="k">On the board</div><div class="v num">${rows.filter((r) => r.upcoming && r.ev >= MIN_EV && PICKABLE(r)).length}</div><div class="s">of ${rows.filter((r) => r.upcoming).length} props priced</div></div>
      <div class="card stat"><div class="k">Started</div><div class="v" style="font-size:20px">Week 11</div><div class="s">graded at the closing line</div></div></div>
    <div class="row" style="margin:14px 0;gap:8px;flex-wrap:wrap">${seg('ty', [['all', 'All'], ['Pass', 'Pass'], ['Rush', 'Rush'], ['Rec', 'Rec']], st.ty)} ${seg('pos', [['all', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], st.pos)}</div>
    <div class="sec"><h2>Best props</h2>${board.length ? `<div class="grid g2">${board.slice(0, 30).map(card).join('')}</div>${board.length > 30 ? `<p class="dim">+ ${board.length - 30} more above ${(MIN_EV * 100).toFixed(0)}%.</p>` : ''}` : '<div class="empty">Nothing clears the bar right now. Props post midweek and fill in through Sunday morning.</div>'}</div>
    ${graded.length ? `<div class="sec"><h2>Record</h2><div class="grid g3">
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>Type</th><th class="r">Record</th><th class="r">Hit</th></tr>${breakdown((r) => STATS[r.p.stat].label, Object.values(STATS).map((s) => [s.label, s.label]))}</table></div>
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>Position</th><th class="r">Record</th><th class="r">Hit</th></tr>${breakdown((r) => r.pos, ['QB', 'RB', 'WR', 'TE'].map((x) => [x, x]))}</table></div>
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>Week</th><th class="r">Record</th><th class="r">Hit</th></tr>${breakdown((r) => r.hg.week, [...new Set(graded.map((r) => r.hg.week))].sort((a, b) => a - b).map((w) => [w, `Week ${w}`]))}</table></div></div></div>` : ''}
    ${footNote('Prop lines: DraftKings via ESPN’s public odds feed, checked every 30 minutes. Player stats: nflverse. Graded on ESPN’s final box score.')}`;
    onSeg(el, 'ty', (v) => { st.ty = v; store.set('sl:ty', v); draw(); });
    onSeg(el, 'pos', (v) => { st.pos = v; store.set('sl:pos', v); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
}
