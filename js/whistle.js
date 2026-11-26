// At the Whistle: NFL live player props at the end of Q1, halftime and the end of Q3. Each ticket is the projected
// final against the line at that moment, locked at the whistle and graded on the final box score.
import { api, apiAll, ago, esc, fmtTime, fmtDay, pct, sgn, seg, onSeg, store, howTo, wireHow, footNote, clearCache } from './core.js?v=202611260317';
import { STATS, TYPE_GROUP, propData, project, atWhistle, boxVal, calibrate } from './propmodel.js?v=202611260317';
import { trackBtn } from './mybets.js?v=202611260317';
import { ncdf } from './core.js?v=202611260317';

const QN = { 0: 'Live', 1: 'End Q1', 2: 'Halftime', 3: 'End Q3' };
const NEED = { over: 0.6, under: 0.58 }; // overs need more of an edge than unders
const LIVE_TID = { pass_yds: ['8'], pass_cmp: ['9'], pass_td: ['10'], rush_att: ['11'], rush_yds: ['12'], rec_yds: ['13'], rec: ['14'], pass_att: ['16'], pass_rush_yds: ['18'], rush_rec_yds: ['20'] };
const LIVE_NAME = { pass_yds: /passing yards/i, pass_cmp: /completions/i, pass_td: /passing touchdowns/i, rush_att: /carries|rushing attempts/i, rush_yds: /^(total )?rushing yards/i, rec_yds: /receiving yards/i, rec: /receptions/i, pass_att: /passing attempts/i, pass_rush_yds: /passing \+|passing plus/i, rush_rec_yds: /rushing \+|rushing plus/i };

function liveLine(snap, aid, stat) {
  for (const x of snap.live || []) {
    if (x.aid !== String(aid)) continue;
    if (!(LIVE_TID[stat].includes(String(x.tid)) || LIVE_NAME[stat].test(x.type || ''))) continue;
    if (/milestone|longest|\d\+/i.test(x.type || '')) continue;
    const v = Number(x.cur?.target?.value); if (Number.isFinite(v)) return v;
  }
  return null;
}

export async function tickets() {
  const d = await propData();
  calibrate(d);
  const snaps = await apiAll('whistle_snaps?select=*&order=ts.asc,game_id.asc,period.asc', { ttl: 20_000 });
  const ids = [...new Set(snaps.map((s) => s.game_id))];
  if (!ids.length) return { list: [], live: [], snaps, G: new Map() };
  const props = [], G = new Map();
  for (let i = 0; i < ids.length; i += 60) {
    const part = ids.slice(i, i + 60).join(',');
    for (let off = 0; off < 20000; off += 1000) { const p = await api(`props?select=*&game_id=in.(${part})&offset=${off}&limit=1000`, { ttl: 120_000 }); props.push(...p); if (p.length < 1000) break; }
    for (const g of await api(`games?select=id,start_time,state,home,away,home_score,away_score,data&id=in.(${part})`, { ttl: 60_000 })) G.set(String(g.id), g);
  }
  const byGame = new Map(); for (const s of snaps) { if (!byGame.has(s.game_id)) byGame.set(s.game_id, {}); byGame.get(s.game_id)[s.period] = s; }
  const list = [], live = []; // live = the in-progress read (period 0); list = tickets locked at a whistle
  for (const p of props) {
    const g = G.get(String(p.game_id)), sn = byGame.get(p.game_id), hg = d.week.get(String(p.game_id)), a = d.ath.get(String(p.athlete_id));
    if (!g || !sn || !a) continue;
    const pos = (a.gsis && d.posOf.get(a.gsis)) || a.pos;
    if (!STATS[p.stat].pos.includes(pos)) continue;
    const pre = Number(p.line_close);
    let prior = pre, team = null, opp = null;
    if (a.gsis && hg) {
      const l = d.byPid.get(a.gsis) || []; team = l.length ? l[l.length - 1].team : null;
      if (team) { opp = team === hg.home_team ? hg.away_team : hg.home_team; const pr = project(d, { gsis: a.gsis, pos, stat: p.stat, opp, wk: hg.week, line: pre }); if (pr) prior = pr.mean; }
    }
    const fin = sn[4];
    for (const q of [0, 1, 2, 3]) {
      const s = sn[q]; if (!s) continue;
      // the live read counts only while the game is on: a fresh row, no final box yet, in regulation, past the opening minutes
      if (q === 0 && (fin || !s.meta || s.meta.period > 4 || Date.now() - Date.parse(s.ts) > 10 * 60e3)) continue;
      const per = q === 0 ? (s.meta.period - 1) + 1 - Math.max(0, Number(s.meta.clock) || 0) / 900 : q;
      if (per < 0.2) continue;
      const b = s.box?.[String(p.athlete_id)] || {};
      const espnTeam = b.team ?? null;
      const isHome = espnTeam ? espnTeam === g.home : team === hg?.home_team;
      const lead = isHome ? s.home_pts - s.away_pts : s.away_pts - s.home_pts;
      const now = boxVal(b, p.stat);
      const long = STATS[p.stat].long ? b[STATS[p.stat].long] || 0 : 0;
      const m = atWhistle({ stat: p.stat, prior, now, long, period: per, lead });
      // a live number identical to the pregame close usually means the book froze that market, not that it priced it again
      const lv0 = liveLine(s, p.athlete_id, p.stat), live = lv0 !== null && lv0 === pre ? null : lv0;
      const ln = live ?? pre, src = live !== null ? 'live' : 'pregame';
      if (now > ln) continue; // already over: nothing left to bet
      const pOver = STATS[p.stat].count ? (() => { let c = 0, t = Math.exp(-m.remaining); for (let k = 0; k <= Math.floor(ln - now); k++) { c += t; t *= m.remaining / (k + 1); } return 1 - c; })()
        : 1 - ncdf((ln - m.fair) / Math.max(0.5, m.sd));
      const side = pOver >= NEED.over ? 'over' : 1 - pOver >= NEED.under ? 'under' : null;
      if (!side) continue;
      if (side === 'under' && m.remaining < (STATS[p.stat].yards ? 12 : 1.2)) continue; // too little game left for the under to mean anything
      const pS = side === 'over' ? pOver : 1 - pOver;
      let result = null, final = null;
      if (fin) { final = boxVal(fin.box?.[String(p.athlete_id)] || {}, p.stat); result = final === ln ? 'P' : (final > ln) === (side === 'over') ? 'W' : 'L'; }
      const dest = q === 0 ? live : list;
      dest.push({ p, g, a, pos, q, s, now, m, ln, src, pre, side, pS, edge: side === 'over' ? m.fair - ln : ln - m.fair, result, final, week: hg?.week ?? null, team: espnTeam ?? team });
    }
  }
  return { list, live, snaps, G };
}

export async function render(el) {
  const st = { game: null, ty: store.get('wh:ty', 'all'), pos: store.get('wh:pos', 'all'), q: store.get('wh:q', 'all'), src: store.get('wh:src', 'live'), wk: store.get('wh:wk', 'all') };
  el.innerHTML = '<div class="loading">Reading the tape…</div>';
  let T = null;
  async function load() {
    try { T = await tickets(); const now = Date.now(); T.sched = await api(`games?select=id,start_time,state,home,away,home_score,away_score&league=eq.nfl&start_time=gte.${encodeURIComponent(new Date(now - 6 * 3600e3).toISOString())}&start_time=lt.${encodeURIComponent(new Date(now + 8 * 86400e3).toISOString())}&order=start_time.asc`, { ttl: 60_000 }).catch(() => []); } catch (e) { el.innerHTML = `<div class="err">Couldn’t load (${esc(e.message)}). Try Refresh.</div>`; return; }
    draw();
  }
  function draw() {
    const { list } = T;
    const keep = (t) => (st.ty === 'all' || TYPE_GROUP[t.p.stat] === st.ty) && (st.pos === 'all' || t.pos === st.pos) && (st.q === 'all' || String(t.q) === st.q) && (st.src === 'all' || t.src === st.src) && (st.wk === 'all' || String(t.week) === st.wk);
    const shown = list.filter(keep);
    const graded = shown.filter((t) => t.result);
    const open = list.filter((t) => !t.result && t.g.state !== 'post').filter((t) => (st.ty === 'all' || TYPE_GROUP[t.p.stat] === st.ty) && (st.pos === 'all' || t.pos === st.pos)).sort((a, b) => b.pS - a.pS);
    const tally = (l) => l.reduce((a, t) => { a[t.result === 'W' ? 'w' : t.result === 'L' ? 'l' : 'p']++; return a; }, { w: 0, l: 0, p: 0 });
    const rt = (x) => x.w + x.l + x.p ? `${x.w}–${x.l}${x.p ? '–' + x.p : ''}` : '—';
    const rp = (x) => x.w + x.l ? x.w / (x.w + x.l) : null;
    const row = (lab, l) => { const t = tally(l); return `<tr><td>${lab}</td><td class="r num">${rt(t)}</td><td class="r num">${pct(rp(t), 0)}</td></tr>`; };
    const weeks = [...new Set(list.map((t) => t.week).filter(Boolean))].sort((a, b) => a - b);
    const all = tally(graded);
    const card = (t, i) => {
      const unit = STATS[t.p.stat].yards ? 'yds' : '';
      const span = Math.max(t.ln, t.m.fair, t.now) * 1.15 || 1;
      return `<div class="card">
      <div class="row" style="justify-content:space-between;font-size:12.5px"><span><span class="chip ${t.side === 'over' ? 'gold' : 'clay'}">${t.side === 'over' ? '↗ Over' : '↘ Under'}</span> <span class="dim">${QN[t.q]} · ${esc(t.g.away)} @ ${esc(t.g.home)}${t.week ? ` · Wk ${t.week}` : ''}</span></span>
        ${t.result ? `<b class="${t.result === 'W' ? 'mint' : t.result === 'L' ? 'clay' : 'dim'}">${t.result === 'W' ? 'HIT' : t.result === 'L' ? 'MISS' : 'PUSH'} · ${t.final}</b>` : t.q === 0 ? '<span class="chip mint">● Live</span>' : '<span class="chip">Locked</span>'}</div>
      <div class="row" style="gap:10px;margin-top:8px">${t.a.headshot ? `<img src="${esc(t.a.headshot)}" alt="" width="44" height="44" style="border-radius:50%;object-fit:cover;background:var(--line2)">` : ''}
        <div><div class="disp" style="font-size:19px">${esc(t.a.name)}</div><div class="dim" style="font-size:13px">${esc(t.pos)} · ${esc(STATS[t.p.stat].label)} ${t.ln} <span class="chip ${t.src === 'live' ? 'mint' : ''}" style="font-size:10.5px">${t.src === 'live' ? 'live line' : 'pregame line'}</span></div></div></div>
      <div class="grid g3" style="margin-top:8px;text-align:center"><div><div class="k dim" style="font-size:11px">NOW</div><b class="num">${Math.round(t.now * 10) / 10}</b></div><div><div class="k dim" style="font-size:11px">LINE</div><b class="num">${t.ln}</b></div><div><div class="k dim" style="font-size:11px">FAIR</div><b class="num">${t.m.fair.toFixed(1)}</b></div></div>
      <div style="position:relative;height:8px;background:var(--line2);border-radius:4px;margin:10px 0 6px"><div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(100, t.now / span * 100)}%;background:var(--dim);border-radius:4px"></div>
        <div title="line" style="position:absolute;top:-2px;width:3px;height:12px;background:var(--ink);left:${Math.min(100, t.ln / span * 100)}%"></div><div title="fair" style="position:absolute;top:-2px;width:10px;height:12px;border-radius:6px;background:var(--mint);left:calc(${Math.min(100, t.m.fair / span * 100)}% - 5px)"></div></div>
      <div class="dim" style="font-size:12.5px">${Math.round(t.now * 10) / 10} so far · full-game pace ${t.m.pace.toFixed(0)} vs pregame expectation ${t.pre}. ${esc(t.m.note)}</div>
      <div class="row" style="justify-content:space-between;margin-top:6px;font-size:13px"><span class="dim">Edge</span><b class="num">${sgn(t.edge)} ${unit} · ${pct(t.pS, 0)}</b></div>
      ${t.result ? '' : `<div style="text-align:right;margin-top:6px">${trackBtn({ gid: String(t.p.game_id), market: 'prop', aid: String(t.p.athlete_id), stat: t.p.stat, side: t.side, line: t.ln, q: QN[t.q], name: t.a.name, game: `${t.g.away} @ ${t.g.home}`, start: t.g.start_time, tool: 'At the Whistle' })}</div>`}</div>`;
    };
    // ---- the slate: tap a game for its live read first, then what locked at each whistle
    const nowMs = Date.now();
    const finals = new Set(T.snaps.filter((s) => s.period === 4).map((s) => String(s.game_id)));
    const liveSnaps = new Map(T.snaps.filter((s) => s.period === 0 && s.meta && !finals.has(String(s.game_id)) && nowMs - Date.parse(s.ts) < 10 * 60e3).map((s) => [String(s.game_id), s]));
    const cnt = new Map(); for (const t of [...T.live, ...list]) { const k = String(t.p.game_id); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const slate = (T.sched || []).filter((g) => g.state !== 'post' && !finals.has(String(g.id))).sort((a, b) => (liveSnaps.has(String(b.id)) - liveSnaps.has(String(a.id))) || Date.parse(a.start_time) - Date.parse(b.start_time));
    const gcard = (g) => { const id = String(g.id), ls = liveSnaps.get(id); const hp = ls ? ls.home_pts : g.home_score ?? 0, ap = ls ? ls.away_pts : g.away_score ?? 0, n = cnt.get(id) || 0;
      const status = ls ? (/half|end/i.test(ls.meta.detail || '') ? ls.meta.detail : `Q${ls.meta.period} ${ls.meta.display}`) : `${fmtDay(g.start_time)} · ${fmtTime(g.start_time)}`;
      return `<div class="card" role="button" tabindex="0" data-game="${id}" style="flex:0 0 auto;min-width:190px;padding:10px 14px;cursor:pointer;${st.game === id ? 'outline:1.5px solid var(--mint);' : ''}">
        <div class="row" style="justify-content:space-between;gap:10px;font-size:11.5px"><span class="${ls ? 'mint' : 'dim'}">${ls ? '● ' : ''}${esc(status)}</span>${n ? `<span class="chip" style="font-size:10px">${n} ticket${n > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="row" style="justify-content:space-between;margin-top:6px"><b>${esc(g.away)}</b><b class="num">${ap}</b></div>
        <div class="row" style="justify-content:space-between;margin-top:2px"><b>${esc(g.home)}</b><b class="num">${hp}</b></div></div>`; };
    const stripHtml = slate.length ? `<div style="display:flex;gap:10px;overflow-x:auto;padding:4px 2px 10px;margin:10px 0 4px">${slate.map(gcard).join('')}</div><p class="stamp" style="margin-top:0">Tap a game for its live read and every whistle. Finished games drop off the slate; their tickets stay in Results.</p>` : '';
    let gameHtml = '';
    if (st.game) {
      const gid = st.game, gm = slate.find((x) => String(x.id) === gid) ?? (T.sched || []).find((x) => String(x.id) === gid) ?? T.G.get(gid) ?? {};
      const ls = liveSnaps.get(gid);
      const tf = (t) => (st.ty === 'all' || TYPE_GROUP[t.p.stat] === st.ty) && (st.pos === 'all' || t.pos === st.pos);
      const mine = (l) => l.filter((t) => String(t.p.game_id) === gid).filter(tf).sort((a, b) => b.pS - a.pS);
      const hp = ls ? ls.home_pts : gm.home_score ?? 0, ap = ls ? ls.away_pts : gm.away_score ?? 0, d = Math.abs(hp - ap), lead = hp > ap ? gm.home : gm.away;
      const script = d === 0 ? `Tied-up game (${ap}–${hp}). Neutral script — don’t overfit one drive.`
        : d < 10 ? `${esc(lead)} up ${d}. Score still tight; game script close to the open.`
        : `${esc(lead)} up ${d}. ${ls && ls.meta.period >= 2 ? 'The trailing team leans on the pass, the leader on the run.' : 'Early yet; the script isn’t set.'}`;
      const liveT = mine(T.live);
      const lockedSec = [3, 2, 1].map((q) => { const sn = T.snaps.find((s) => String(s.game_id) === gid && s.period === q); if (!sn) return '';
        const ts = mine(list.filter((t) => t.q === q)), gr = ts.filter((t) => t.result), tl = tally(gr);
        return `<div class="sec"><h2 style="font-size:20px">${QN[q]}</h2><p class="sub">Locked at the whistle · ${esc(gm.away)} ${sn.away_pts}, ${esc(gm.home)} ${sn.home_pts}${gr.length ? ` · <b class="num">${rt(tl)}</b> ${pct(rp(tl), 0)}` : ''}</p>
          ${ts.length ? `<div class="grid g2">${ts.map(card).join('')}</div>` : '<div class="empty">Nothing cleared the bar at this whistle.</div>'}</div>`; }).join('');
      gameHtml = `<div class="sec"><div class="row" style="justify-content:space-between;gap:12px;align-items:flex-start"><div><h2>${esc(gm.away)} @ ${esc(gm.home)}</h2><p class="sub">${script}</p></div><button class="btn" data-act="back">← Back</button></div>
        <div class="row" style="margin:10px 0;gap:8px;flex-wrap:wrap">${seg('ty', [['all', 'All'], ['Pass', 'Pass'], ['Rush', 'Rush'], ['Rec', 'Rec']], st.ty)} ${seg('pos', [['all', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], st.pos)}</div>
        <div class="sec"><h2 style="font-size:20px">Live</h2>
          <p class="sub">${ls ? `${esc(ls.meta.detail || 'In progress')} · updated ${esc(ago(new Date(ls.ts)))}. These move until the quarter ends, then lock below.` : 'Live tickets appear once the game is under way. Each one locks at the end of Q1, halftime and the end of Q3.'}</p>
          ${ls ? (liveT.length ? `<div class="grid g2">${liveT.map(card).join('')}</div>` : '<div class="empty">Nothing is a 58%+ shot right now. It updates every minute.</div>') : ''}</div>
        ${lockedSec}</div>`;
    }
    const wkSel = st.wk === 'all' ? (weeks[weeks.length - 1] ?? null) : Number(st.wk);
    const ticketsWk = shown.filter((t) => t.result && t.week === wkSel).sort((a, b) => a.q - b.q || b.pS - a.pS);
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">NFL live props</div><h1>At the Whistle</h1><p>At the end of the 1st, halftime and the end of the 3rd, every player prop is projected to the final whistle and compared with DraftKings’ number at that moment. Tickets lock at the whistle and are graded on the final box score.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${stripHtml}${st.game ? gameHtml : `${howTo('How the desk works', `<ol>
      <li><b>Fair</b> = what he has now, plus the rest of the game at a blend of his pregame expectation and his pace so far. The pace counts for more as the game goes on (25% after Q1, 40% at half, 50% after Q3).</li>
      <li><b>One long play doesn’t set the pace.</b> Anything past 25 yards on his longest catch or run is left out of the pace.</li>
      <li><b>Game script:</b> down 10+ in the second half, passing and catching go up and rushing goes down; up 10+, the reverse.</li>
      <li><b>Tickets</b> need a 60% chance for an over and 58% for an under. An under with almost no game left isn’t a ticket.</li>
      <li><b>The line:</b> DraftKings’ live prop line at the whistle when ESPN’s feed has one and it has moved off the pregame number (an unmoved number usually means the market was frozen); otherwise the pregame line. Those are graded separately. Halftime records against the pregame line run high because the book would have moved; only the live-line record is a real betting record.</li></ol>`, 'wh')}
    <div class="grid g4">
      <div class="card stat"><div class="k">Season</div><div class="v num">${rt(all)}</div><div class="s">${pct(rp(all), 1)} · ${st.src === 'live' ? 'live lines' : st.src === 'pregame' ? 'pregame lines' : 'all lines'}</div></div>
      <div class="card stat"><div class="k">Over</div><div class="v num">${rt(tally(graded.filter((t) => t.side === 'over')))}</div><div class="s">${pct(rp(tally(graded.filter((t) => t.side === 'over'))), 0)}</div></div>
      <div class="card stat"><div class="k">Under</div><div class="v num">${rt(tally(graded.filter((t) => t.side === 'under')))}</div><div class="s">${pct(rp(tally(graded.filter((t) => t.side === 'under'))), 0)}</div></div>
      <div class="card stat"><div class="k">Whistles logged</div><div class="v num">${T.snaps.filter((s) => s.period >= 1 && s.period < 4).length}</div><div class="s">since Nov 19, 2026</div></div></div>
    <div class="row" style="margin:14px 0;gap:8px;flex-wrap:wrap">${seg('src', [['live', 'Live line'], ['pregame', 'Pregame line'], ['all', 'Both']], st.src)} ${seg('q', [['all', 'All'], ['1', 'Q1'], ['2', 'Half'], ['3', 'Q3']], st.q)} ${seg('ty', [['all', 'All'], ['Pass', 'Pass'], ['Rush', 'Rush'], ['Rec', 'Rec']], st.ty)} ${seg('pos', [['all', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], st.pos)}
      ${weeks.length ? seg('wk', [['all', 'All weeks'], ...weeks.map((w) => [String(w), `Wk ${w}`])], st.wk) : ''}</div>
    <div class="sec"><h2>Best at the whistle</h2><p class="sub">Open tickets from games still being played, ranked by chance to hit.</p>
      ${open.length ? `<div class="grid g2">${open.slice(0, 20).map(card).join('')}</div>` : '<div class="empty">No live tickets. They appear here within a minute of each quarter break on game days (Thursday, Sunday, Monday).</div>'}</div>
    <div class="sec"><h2>Results</h2>${graded.length ? `<div class="grid g4">
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>By week</th><th class="r"></th><th class="r"></th></tr>${weeks.map((w) => row(`Week ${w}`, graded.filter((t) => t.week === w))).join('')}</table></div>
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>By quarter</th><th class="r"></th><th class="r"></th></tr>${[1, 2, 3].map((q) => row(QN[q], graded.filter((t) => t.q === q))).join('')}</table></div>
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>By type</th><th class="r"></th><th class="r"></th></tr>${Object.entries(STATS).map(([k, s]) => row(s.label, graded.filter((t) => t.p.stat === k))).join('')}</table></div>
      <div class="card" style="padding:4px 12px"><table class="t"><tr><th>By position</th><th class="r"></th><th class="r"></th></tr>${['QB', 'RB', 'WR', 'TE'].map((x) => row(x, graded.filter((t) => t.pos === x))).join('')}</table></div></div>
      <p class="stamp">Hit rate ignores pushes. Break-even at −110 is 52.4%.</p>
      ${ticketsWk.length ? `<div class="sec"><h2 style="font-size:20px">Week ${wkSel}: every ticket</h2><div class="grid g2">${ticketsWk.map(card).join('')}</div></div>` : ''}`
      : '<div class="empty">No graded tickets yet. The first whistles are Thursday night (Colts @ Texans).</div>'}</div>`}
    ${footNote('Box scores and live lines: ESPN (DraftKings – Live Odds), saved within a minute of each whistle. Pregame lines: DraftKings via ESPN. Not betting advice.')}`;
    el.querySelectorAll('[data-game]').forEach((c) => { const go = () => { st.game = st.game === c.dataset.game ? null : c.dataset.game; draw(); el.scrollIntoView?.(); }; c.onclick = go; c.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
    el.querySelector('[data-act=back]')?.addEventListener('click', () => { st.game = null; draw(); });
    for (const k of ['src', 'q', 'ty', 'pos', 'wk']) onSeg(el, k, (v) => { st[k] = v; store.set(`wh:${k}`, v); draw(); });
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    wireHow(el);
  }
  await load();
  // while a game is open and live, pick up the new read every minute
  const iv = setInterval(() => { if (!el.isConnected) return clearInterval(iv); if (st.game && T && !document.hidden) load(); }, 60_000);
}
