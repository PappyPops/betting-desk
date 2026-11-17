import { games, esc, logo, line, sgn, fmtTime, fmtDay, footNote, lastSync, ago, clearCache } from './core.js?v=202611162210';

const LG = { nfl: 'NFL', cfb: 'College', nba: 'NBA' };

export async function render(el, { toolById }) {
  el.innerHTML = '<div class="loading">Setting the desk…</div>';
  let liveCount = 0;
  async function draw() {
  const now = Date.now();
  const from = new Date(now - 5 * 3600e3).toISOString(), to = new Date(now + 3 * 86400e3).toISOString();
  const [nfl, cfb, nba, synced] = await Promise.all([
    games({ league: 'nfl', from, to }), games({ league: 'cfb', from, to }), games({ league: 'nba', from, to }), lastSync(),
  ]);
  const all = [...nfl, ...cfb, ...nba];
  const live = all.filter((g) => g.state === 'in');
  const moves = all.filter((g) => g.state === 'pre').flatMap((g) => {
    const out = [];
    if (g.open_spread_home !== null && g.spread_home !== null && Number(g.spread_home) !== Number(g.open_spread_home)) out.push({ g, k: 'Spread', open: Number(g.open_spread_home), now: Number(g.spread_home), mv: Number(g.spread_home) - Number(g.open_spread_home) });
    if (g.open_total !== null && g.total !== null && Number(g.total) !== Number(g.open_total)) out.push({ g, k: 'Total', open: Number(g.open_total), now: Number(g.total), mv: Number(g.total) - Number(g.open_total) });
    return out;
  }).sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv)).slice(0, 10);

  const tools = [
    ['juice', 'Where the tickets are versus where the money is, with every read graded.'],
    ['capn', 'Public handicapper picks stacked by side, with each one’s record.'],
    ['paint', 'NBA totals projected before tip and at every quarter break, with the season graded.'],
    ['redzone', 'Anytime touchdown chances, checked against what actually happened.'],
    ['linelife', 'Open vs. now vs. final on every total, plus rules that held up on two halves of history.'],
    ['matrix', 'Situational spread angles, checked against luck, matched to this week.'],
    ['tease', 'Every side teased through 3 and 7, priced as a slip.'],
    ['eye', 'The schedule filtered to the channels you actually have.'],
  ];

  el.innerHTML = `
  <div class="ph"><div><div class="kicker">${esc(fmtDay(new Date().toISOString()))}</div><h1>Today</h1><p>What’s moving, what’s on, and where to look next.</p></div>
    <div class="row"><span class="stamp">Synced ${esc(ago(synced))}</span><button class="btn" data-act="refresh">↻ Refresh</button></div></div>
  ${live.length ? `<div class="sec"><h2>Live now</h2><div class="grid g3">${live.map((g) => `<div class="card"><div class="row" style="justify-content:space-between"><span class="pill-live" style="font-size:12.5px">${esc(g.data.detail)}</span><span class="chip">${LG[g.league]}</span></div>
    <div class="row" style="justify-content:space-between;margin-top:8px">${`<span class="team">${logo(g.data.away)}<span>${esc(g.data.away.short)}</span></span>`}<b class="disp num" style="font-size:22px">${g.away_score ?? 0}</b></div>
    <div class="row" style="justify-content:space-between">${`<span class="team">${logo(g.data.home)}<span>${esc(g.data.home.short)}</span></span>`}<b class="disp num" style="font-size:22px">${g.home_score ?? 0}</b></div>
    ${(g.close_spread_home ?? g.spread_home) !== null ? `<div class="dim" style="font-size:12px;margin-top:6px">Closed ${esc(g.data.home.abbr)} ${line(Number(g.close_spread_home ?? g.spread_home))} · O/U ${g.close_total ?? g.total ?? '—'}</div>` : ''}</div>`).join('')}</div></div>` : ''}
  <div class="sec"><h2>Biggest moves</h2><p class="sub">Lines that have moved furthest from DraftKings’ opener, next 3 days.</p>
    <div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Game</th><th>Market</th><th class="r">Open</th><th class="r">Now</th><th class="r">Move</th></tr>
    ${moves.map(({ g, k, open, now: n, mv }) => `<tr><td><span class="chip">${LG[g.league]}</span> ${esc(g.data.away.short)} @ ${esc(g.data.home.short)}<div class="dim" style="font-size:12px">${esc(fmtDay(g.start_time))} ${esc(fmtTime(g.start_time))}</div></td>
      <td>${k}${k === 'Spread' ? ` <span class="dim">(${esc(g.home)})</span>` : ''}</td><td class="r num">${k === 'Spread' ? line(open) : open}</td><td class="r num">${k === 'Spread' ? line(n) : n}</td><td class="r num ${mv > 0 ? 'gold' : 'clay'}">${sgn(mv)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No moves yet.</td></tr>'}
    </table></div></div>
  <div class="sec"><h2>Tools</h2><div class="grid g2">${tools.map(([id, d]) => `<a class="card" href="#${id}" style="color:inherit;text-decoration:none"><b class="disp" style="font-size:22px">${esc(toolById[id].name)}</b><p class="muted" style="margin:4px 0 0">${esc(d)}</p></a>`).join('')}</div>
    <p class="muted" style="font-size:13.5px">Slant is waiting on this week’s prop lines; its page says what’s left.</p></div>
  ${footNote('Lines, scores, and TV: DraftKings and ESPN via ESPN’s public scoreboard, checked every 5 minutes.')}`;
  el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); draw(); };
  liveCount = live.length;
  }
  await draw();
  const t = setInterval(() => { if (liveCount) { clearCache(); draw(); } }, 90_000);
  return () => clearInterval(t);
}
