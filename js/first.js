// Redzone FIRST: who scores the first touchdown, of each game and of the whole day.
// Built on Redzone's calibrated anytime chances. Each player's anytime chance p becomes a scoring rate
// (lambda = -ln(1 - p)); touchdowns arrive like a race between everyone on the field, so a player's chance to score
// a game's first TD is his share of the game's total rate, times the chance there's a TD at all. About 8% of TDs go
// to defense, special teams or players off the list, so that share is set aside. For the whole day, the first TD
// comes from the earliest kickoff window (games that start together race the same way).
// While games are on, ESPN's free scoring plays are checked every minute and every TD is marked with the game clock
// and the time this page first saw it.
import { esc, pct, fmtTime, fmtDay, footNote, howTo, wireHow, store, seg, onSeg, clearCache } from './core.js?v=202611221856';
import { redzoneData } from './redzone.js?v=202611221856';
import { amOf } from './rr.js?v=202611221856';

const OTHER = 0.08; // share of TDs scored by defense, special teams, or players not listed
const etDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const ord = (n) => n === 1 ? '' : `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}-`;

// "Nico Collins 42 Yd pass from C.J. Stroud (kick)" -> "Nico Collins"; "Josh Allen 1 Yd Run" -> "Josh Allen"
const scorerOf = (text) => String(text || '').replace(/\s+\d+\s+(Yd|Yard|Yds)\b.*$/i, '').replace(/\s+(Fumble|Interception|Punt|Kickoff|Blocked).*$/i, '').trim();

export async function render(el) {
  el.innerHTML = '<div class="loading">Lining up the first scorers…</div>';
  const D = await redzoneData();
  if (!D) { el.innerHTML = '<div class="err">Player stats haven’t loaded yet. Check back in a few minutes.</div>'; return; }
  const { cards, m } = D;
  const days = [...new Set(cards.map((c) => etDay(c.g.start_time)))].sort();
  const today = etDay(new Date().toISOString());
  const st = { day: days.includes(today) ? today : days.find((d) => d >= today) ?? days[0] };
  let feed = new Map(); // game id -> [{ name, type, period, clock, seen }]
  let firstPull = true; // touchdowns already on the board when the page opens get no 'seen' time
  const seenAt = store.get('first:seen', {});

  // per game: every listed player's rate and chance to score the game's first TD
  function gameModel(c) {
    const rows = c.all.map((x) => ({ x, lam: -Math.log(1 - Math.min(0.97, x.p)) }));
    const listed = rows.reduce((a, r) => a + r.lam, 0), total = listed / (1 - OTHER);
    const anyTD = 1 - Math.exp(-total);
    for (const r of rows) r.pFirst = (r.lam / total) * anyTD;
    rows.sort((a, b) => b.pFirst - a.pFirst);
    return { c, rows, total, anyTD };
  }
  // short "why" for a player
  function why(x, c) {
    const d = m.def.get(x.opp), pos = x.L.g;
    const role = pos === 'RB' || pos === 'QB' ? (x.shareC >= 0.1 ? `${Math.round(x.shareC * 100)}% of ${x.espnTeam.abbr} carries` : `${x.L.eC.toFixed(1)} carries`) : `${Math.round(x.shareT * 100)}% of ${x.espnTeam.abbr} targets`;
    const goal = `${x.L.sRT + x.L.sCT} TD in ${x.L.gp} games`;
    const imp = x.implied ? `${x.espnTeam.abbr} implied ${x.implied.toFixed(1)} pts` : '';
    const opp = d ? (pos === 'RB' || pos === 'QB' ? `opp. allows ${d.rush.toFixed(1)} rush TD/g (${ord(m.defRank.rush.get(x.opp))}most)` : `opp. allows ${d.pass.toFixed(1)} pass TD/g (${ord(m.defRank.pass.get(x.opp))}most)`) : '';
    return [role, goal, imp, opp, x.boostNote ? `${x.boostNote.names.join(' & ')} out` : ''].filter(Boolean).join(' · ');
  }
  const fair = (p) => { const a = amOf(1 / p); return `${a > 0 ? '+' : ''}${a}`; };

  // ---- live: ESPN scoring plays for games on the selected day that have started ----
  async function pull() {
    const todays = cards.filter((c) => etDay(c.g.start_time) === st.day && new Date(c.g.start_time).getTime() <= Date.now());
    await Promise.all(todays.map(async (c) => {
      try {
        const j = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${c.g.id}`)).json();
        const tds = (j.scoringPlays || []).filter((p) => /touchdown/i.test(p.type?.text || '') || /\bTD\b/.test(p.text || ''));
        feed.set(String(c.g.id), tds.map((p) => {
          const key = `${c.g.id}|${p.id ?? p.text}`;
          if (seenAt[key] === undefined) seenAt[key] = firstPull ? 0 : Date.now();
          return { name: scorerOf(p.text), text: p.text, type: p.type?.text ?? 'Touchdown', period: p.period?.number, clock: p.clock?.displayValue, team: p.team?.abbreviation, seen: seenAt[key] };
        }));
      } catch { /* keep the last read */ }
    }));
    store.set('first:seen', seenAt); firstPull = false;
  }
  const scored = (x, gid) => { const l = feed.get(String(gid)) || []; const i = l.findIndex((t) => norm(t.name) === norm(x.name)); return i < 0 ? null : { ...l[i], first: i === 0 }; };
  const stamp = (t) => `${t.period ? `Q${t.period}` : ''} ${t.clock ?? ''}${t.seen ? ` · seen ${new Date(t.seen).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`;

  function draw() {
    const dayCards = cards.filter((c) => etDay(c.g.start_time) === st.day).sort((a, b) => new Date(a.g.start_time) - new Date(b.g.start_time));
    const models = dayCards.map(gameModel);
    // the day's first TD comes from the earliest kickoff window
    const t0 = Math.min(...dayCards.map((c) => new Date(c.g.start_time).getTime()));
    const early = models.filter((g) => new Date(g.c.g.start_time).getTime() - t0 < 20 * 60e3);
    const window = early.reduce((a, g) => a + g.total, 0), anyEarly = 1 - Math.exp(-window);
    const dayList = early.flatMap((g) => g.rows.map((r) => ({ ...r, c: g.c, pDay: (r.lam / window) * anyEarly }))).sort((a, b) => b.pDay - a.pDay).slice(0, 15);
    // what actually happened so far today: the first TD of the day is the one in the earliest game window with the
    // least game time played (approximate: earliest quarter, then most clock left)
    const allTD = dayCards.flatMap((c) => (feed.get(String(c.g.id)) || []).map((t, i) => ({ ...t, c, i })));
    const firstOfDay = allTD.filter((t) => t.i === 0 && early.some((g) => g.c === t.c)).sort((a, b) => (a.period - b.period) || (Number(String(b.clock).replace(':', '.')) - Number(String(a.clock).replace(':', '.'))))[0] ?? null;
    const live = dayCards.some((c) => c.g.state === 'in');
    const mark = (x, gid, firstOnly) => { const s = scored(x, gid); if (!s) return ''; return s.first ? `<div style="font-size:12px" class="gold">✓ First TD of the game · ${esc(stamp(s))}</div>` : firstOnly ? `<div style="font-size:12px" class="mint">Scored later · ${esc(stamp(s))}</div>` : `<div style="font-size:12px" class="mint">TD · ${esc(stamp(s))}</div>`; };
    const pRow = (x, p, c, extra = '') => { const s = scored(x, c.g.id); return `<div class="row" style="justify-content:space-between;padding:7px 0;border-top:1px solid var(--line);${s?.first ? 'background:linear-gradient(90deg,#f0b42926,transparent 70%);' : s ? 'background:linear-gradient(90deg,#3fb9861a,transparent 70%);' : ''}">
      <span class="team">${x.shot ? `<img class="logo" style="width:30px;height:30px;border-radius:50%;object-fit:cover;background:var(--surface2)" src="${esc(x.shot)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span><b>${esc(x.name)}</b> <span class="dim">${esc(x.pos)} · ${esc(x.espnTeam.abbr)}${extra}</span>
        <div class="dim" style="font-size:11.5px">${esc(why(x, c))}</div>${mark(x, c.g.id, true)}</span></span>
      <span style="text-align:right;white-space:nowrap"><b class="disp num" style="font-size:20px">${pct(p, 1)}</b><div class="dim" style="font-size:11px">fair ${fair(p)}</div></span></div>`; };

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">NFL first touchdown</div><h1>Redzone FIRST</h1><p>Who scores first: the top 15 for the first touchdown of the whole day, and the top 4 in every game, with why. Touchdowns are marked as they happen.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    ${howTo('How it works', `<ol>
      <li>Starts from Redzone’s anytime chances, which are calibrated to what has actually happened this season.</li>
      <li>Touchdowns come like a race between everyone on the field: a player’s chance to score his game’s first TD is his share of the game’s total scoring rate. About ${Math.round(OTHER * 100)}% of TDs go to a defense, special teams or someone not listed, and that share is set aside.</li>
      <li>The day’s first TD almost always comes from the earliest kickoff window, so the day list races those games against each other.</li>
      <li>First-TD bets carry a big book margin. “Fair” is what the chance is worth; a book price longer than fair is value.</li>
      <li>During games, ESPN’s scoring plays are checked every minute. A gold mark is the first TD of that game; green is a TD later in the game. Times show the game clock and when this page first saw it.</li></ol>`, 'first')}
    <div class="row" style="margin-bottom:12px">${seg('day', days.map((d) => [d, new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })]), st.day)}${live ? '<span class="pill-live" style="margin-left:8px">Live · checking every minute</span>' : ''}</div>
    ${firstOfDay ? `<div class="card hl" style="margin-bottom:12px"><span class="kicker" style="color:var(--gold)">First TD of the day</span><div style="font-size:16px;margin-top:4px"><b>${esc(firstOfDay.name)}</b> (${esc(firstOfDay.team ?? '')}) · ${esc(stamp(firstOfDay))}</div><div class="dim" style="font-size:12.5px">${esc(firstOfDay.text)}</div>
      <div style="font-size:12.5px;margin-top:4px">${(() => { const i = dayList.findIndex((r) => norm(r.x.name) === norm(firstOfDay.name)); return i >= 0 ? `<span class="gold">#${i + 1} on the list below.</span>` : '<span class="dim">Not in the top 15.</span>'; })()}</div></div>` : ''}
    <div class="grid g2">
      <div class="card"><div class="row" style="justify-content:space-between"><b>First TD of the day: top 15</b><span class="dim" style="font-size:12px">${early.length} game${early.length === 1 ? '' : 's'} at ${esc(fmtTime(new Date(t0).toISOString()))}</span></div>
        ${dayList.map((r, i) => pRow(r.x, r.pDay, r.c, ` · ${esc(r.c.g.data.away.abbr)} @ ${esc(r.c.g.data.home.abbr)} · #${i + 1}`)).join('') || '<div class="dim">No lines for this day yet.</div>'}
        <div class="dim" style="font-size:12px;margin-top:6px">Chance there’s a TD in that window at all: ${pct(anyEarly)}. Even the favorite here is a long shot; that’s the nature of this bet.</div></div>
      <div class="card"><b>TDs so far</b>
        ${allTD.length ? allTD.sort((a, b) => (b.seen - a.seen) || (new Date(b.c.g.start_time) - new Date(a.c.g.start_time)) || (b.period - a.period)).map((t) => `<div style="padding:6px 0;border-top:1px solid var(--line);font-size:13px"><b>${esc(t.name)}</b> <span class="dim">${esc(t.team ?? '')} · ${esc(t.c.g.data.away.abbr)} @ ${esc(t.c.g.data.home.abbr)}</span>${t.i === 0 ? ' <span class="chip gold" style="font-size:10px">first of game</span>' : ''}
          <div class="dim" style="font-size:12px">${esc(stamp(t))} · ${esc(t.type)}</div></div>`).join('') : `<div class="dim" style="font-size:13px;margin-top:6px">${dayCards.some((c) => new Date(c.g.start_time).getTime() <= Date.now()) ? 'No touchdowns yet.' : 'Nothing yet. This fills in once games kick off.'}</div>`}</div></div>
    <div class="sec"><h2>Every game: top 4 to score first</h2><div class="grid g2">${models.map((g) => { const c = g.c, first = (feed.get(String(c.g.id)) || [])[0];
      return `<div class="card"><div class="row" style="justify-content:space-between;font-size:13px"><b>${esc(c.g.data.away.short)} @ ${esc(c.g.data.home.short)}</b><span class="dim">${esc(fmtDay(c.g.start_time))} ${esc(fmtTime(c.g.start_time))}</span></div>
        ${first ? `<div style="font-size:12.5px;margin:4px 0" class="${g.rows.slice(0, 4).some((r) => norm(r.x.name) === norm(first.name)) ? 'gold' : 'dim'}">First TD: <b>${esc(first.name)}</b> · ${esc(stamp(first))}</div>` : ''}
        ${g.rows.slice(0, 4).map((r) => pRow(r.x, r.pFirst, c)).join('')}
        <div class="dim" style="font-size:11.5px;margin-top:6px">Chance of any TD: ${pct(g.anyTD)} · defense, special teams or someone else first: ${pct(OTHER * g.anyTD)}</div></div>`; }).join('') || '<div class="empty">No games this day.</div>'}</div></div>
    ${footNote('Anytime chances: Redzone (nflverse stats, DraftKings lines via ESPN). Live touchdowns: ESPN scoring plays. Not advice.')}`;
    onSeg(el, 'day', async (v) => { st.day = v; feed = new Map(); await pull(); draw(); });
    el.querySelector('[data-act=refresh]').onclick = async () => { clearCache(); await pull(); draw(); };
    wireHow(el);
  }
  await pull();
  draw();
  // keep checking while any game that day is on (or about to be)
  const t = setInterval(async () => {
    const on = cards.some((c) => etDay(c.g.start_time) === st.day && new Date(c.g.start_time).getTime() <= Date.now() + 60e3 && c.g.state !== 'post');
    if (!on || !document.body.contains(el)) return;
    await pull(); draw();
  }, 60_000);
  return () => clearInterval(t);
}
