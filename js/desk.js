import { games, api, esc, logo, line, sgn, odds, pct, fmtTime, fmtDay, footNote, lastSync, ago, clearCache, howTo, wireHow, SB_URL, SB_KEY } from './core.js?v=202611221538';
import { bestBets, gradeFinal } from './bets.js?v=202611221538';
import { trackBtn } from './mybets.js?v=202611221538';
import { NEWS } from './news.js?v=202611221538';

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
  const tools = [
    ['juice', 'Where the tickets are versus where the money is, with every read graded.'],
    ['capn', 'Public handicapper picks stacked by side, with each one’s record.'],
    ['whistle', 'NFL live player props at every quarter break, locked at the whistle and graded.'],
    ['slant', 'NFL player props before kickoff, ranked by expected value.'],
    ['paint', 'NBA totals projected before tip and at every quarter break, with the season graded.'],
    ['redzone', 'Anytime touchdown chances, checked against what actually happened.'],
    ['linelife', 'Open vs. now vs. final on every total, plus rules that held up on two halves of history.'],
    ['matrix', 'Situational spread angles, checked against luck, matched to this week.'],
    ['tease', 'Every side teased through 3 and 7, priced as a slip.'],
    ['eye', 'The schedule filtered to the channels you actually have.'],
  ];

  el.innerHTML = `
  <div class="ph"><div><div class="kicker">${esc(fmtDay(new Date().toISOString()))}</div><h1>Today</h1><p>Best bets from every tool, what’s on, and where to look next.</p></div>
    <div class="row"><span class="stamp">Synced ${esc(ago(synced))}</span><button class="btn" data-act="refresh">↻ Refresh</button></div></div>
  ${live.length ? `<div class="sec"><h2>Live now</h2><div class="grid g3">${live.map((g) => `<div class="card"><div class="row" style="justify-content:space-between"><span class="pill-live" style="font-size:12.5px">${esc(g.data.detail)}</span><span class="chip">${LG[g.league]}</span></div>
    <div class="row" style="justify-content:space-between;margin-top:8px">${`<span class="team">${logo(g.data.away)}<span>${esc(g.data.away.short)}</span></span>`}<b class="disp num" style="font-size:22px">${g.away_score ?? 0}</b></div>
    <div class="row" style="justify-content:space-between">${`<span class="team">${logo(g.data.home)}<span>${esc(g.data.home.short)}</span></span>`}<b class="disp num" style="font-size:22px">${g.home_score ?? 0}</b></div>
    ${(g.close_spread_home ?? g.spread_home) !== null ? `<div class="dim" style="font-size:12px;margin-top:6px">Closed ${esc(g.data.home.abbr)} ${line(Number(g.close_spread_home ?? g.spread_home))} · O/U ${g.close_total ?? g.total ?? '—'}</div>` : ''}</div>`).join('')}</div></div>` : ''}
  <div class="sec" id="bb"><h2>Best bets</h2><div class="loading" style="padding:20px 0">Checking every tool against every game…</div></div>
  <div class="sec"><h2>Tools</h2><div class="grid g2">${tools.map(([id, d]) => `<a class="card" href="#${id}" style="color:inherit;text-decoration:none"><b class="disp" style="font-size:22px">${esc(toolById[id].name)}</b><p class="muted" style="margin:4px 0 0">${esc(d)}</p></a>`).join('')}</div>
</div>
  ${newsHtml(showAll)}
  ${footNote('Lines, scores, and TV: DraftKings and ESPN via ESPN’s public scoreboard, checked every 5 minutes.')}`;
  el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); draw(); };
  const wireNews = () => { const m = el.querySelector('[data-act=news]'); if (m) m.onclick = () => { showAll = !showAll; el.querySelector('#news').outerHTML = newsHtml(showAll); wireNews(); }; };
  wireNews();
  try { localStorage.setItem('bd:newsSeen', NEWS[0].date); } catch { /* private mode */ }
  liveCount = live.length;
  fillBets(el.querySelector('#bb')).catch((e) => { el.querySelector('#bb').innerHTML = `<h2>Best bets</h2><div class="empty">Couldn’t build best bets right now (${esc(e.message)}). Try Refresh.</div>`; });
  }
  await draw();
  const t = setInterval(() => { if (liveCount) { clearCache(); draw(); } }, 90_000);
  return () => clearInterval(t);
}

// What's new, newest first; entries since your last visit get a New tag
let showAll = false;
const seenAt = (() => { try { return localStorage.getItem('bd:newsSeen') || ''; } catch { return ''; } })();
function newsHtml(all) {
  const list = all ? NEWS : NEWS.slice(0, 6);
  const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `<div class="sec" id="news"><h2>What’s new</h2><div class="card" style="padding:4px 14px">
    ${list.map((n) => `<div style="padding:10px 0;border-top:1px solid var(--line)"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="dim num" style="font-size:12px;min-width:46px">${day(n.date)}</span>${n.date > seenAt && seenAt ? '<span class="chip gold">New</span>' : ''}<b>${n.tool ? `<a href="#${n.tool}" style="color:inherit">${esc(n.title)}</a>` : esc(n.title)}</b></div>
      <div class="muted" style="font-size:13.5px;margin-top:3px">${esc(n.text)}</div></div>`).join('')}
    ${NEWS.length > 6 ? `<div style="padding:8px 0;border-top:1px solid var(--line)"><button class="btn" data-act="news">${all ? 'Show fewer' : `Show all ${NEWS.length}`}</button></div>` : ''}</div></div>`;
}
const MKN = { sp: 'Spread', tot: 'Total', ml: 'Moneyline', teaser: 'Teaser leg' };
function betLabel(b, g) {
  const team = (s) => g.data?.[s]?.short ?? (s === 'home' ? g.home : g.away);
  if (b.market === 'tot') return `${b.side === 'over' ? 'Over' : 'Under'} ${b.line}`;
  if (b.market === 'ml') return `${team(b.side)} ${odds(Number(b.line))}`;
  return `${team(b.side)} ${line(Number(b.line))}${b.market === 'teaser' ? ' (6-pt teaser)' : ''}`;
}
async function fillBets(box) {
  const [{ bets, sources }, logged] = await Promise.all([bestBets(), api('best_bets?select=*&order=start_time.desc&limit=2000', { ttl: 120_000 })]);
  // log the list so it can be graded (lines are re-read on the server; started games are frozen)
  fetch(`${SB_URL}/functions/v1/logbets`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SB_KEY },
    body: JSON.stringify({ complete: true, bets: bets.map((b) => ({ espn_id: b.gid, market: b.market, side: b.side, score: b.score.toFixed(4), tier: b.tier, sources: b.srcs.map((x) => x.short).join(', ') })) }) }).catch(() => {});
  // grade what's been logged
  const past = logged.filter((b) => new Date(b.start_time).getTime() < Date.now());
  const fin = new Map();
  const ids = [...new Set(past.map((b) => b.espn_id))];
  for (let i = 0; i < ids.length; i += 150) for (const g of await api(`games?select=id,state,home_score,away_score&id=in.(${ids.slice(i, i + 150).join(',')})`, { ttl: 300_000 })) fin.set(String(g.id), g);
  const recs = { best: { w: 0, l: 0, p: 0 }, lean: { w: 0, l: 0, p: 0 }, tease: { w: 0, l: 0, p: 0 } };
  for (const b of past) { const r = gradeFinal(b, fin.get(b.espn_id)); if (!r) continue; const k = b.market === 'teaser' ? 'tease' : b.tier; recs[k][r === 'W' ? 'w' : r === 'L' ? 'l' : 'p']++; }
  const rt = (x) => x.w + x.l ? `${x.w}–${x.l}${x.p ? '–' + x.p : ''}` : '—';
  const rp = (x) => x.w + x.l ? x.w / (x.w + x.l) : null;
  const legs = bets.filter((b) => b.market === 'teaser');
  const straight = bets.filter((b) => b.market !== 'teaser').slice(0, 12);
  const LGN = { nfl: 'NFL', cfb: 'College', nba: 'NBA' };
  const card = (b) => { const g = b.g, est = b.be + b.score;
    return `<div class="card ${b.tier === 'best' ? 'hl' : ''}">
      <div class="row" style="justify-content:space-between;font-size:12.5px"><span><span class="chip">${LGN[g.league] ?? g.league}</span> ${esc(fmtDay(g.start_time))} · ${esc(fmtTime(g.start_time))}</span>${b.tier === 'best' ? '<span class="chip gold">Best bet</span>' : '<span class="chip">Lean</span>'}</div>
      <div class="dim" style="font-size:13px;margin-top:6px">${esc(g.data?.away?.short ?? g.away)} @ ${esc(g.data?.home?.short ?? g.home)}</div>
      <div class="disp" style="font-size:24px;margin:2px 0 4px">${esc(betLabel(b, g))}</div>
      <div class="dim" style="font-size:12.5px">${MKN[b.market]} · estimated ${pct(est, 1)} to win, break-even ${pct(b.be, 1)}</div>
      <div style="margin-top:8px;font-size:12.5px">${b.srcs.map((x) => `<div>✓ <b>${esc(x.name)}</b>${x.count > 1 ? ` (${x.count} agree)` : ''} <span class="dim">· ${esc(x.note)}</span></div>`).join('')}
      ${b.against.map((x) => `<div class="clay">✗ ${esc(x.name)} takes the other side</div>`).join('')}</div>
      <div class="row" style="justify-content:space-between;margin-top:8px;font-size:12px"><span class="dim">${(() => { const p = b.market === 'teaser' ? est * est : est, k = (p * (100 / 110) - (1 - p)) / (100 / 110); return k > 0 ? `Stake: ${Math.min(3, k / 4 * 100).toFixed(1)}% of bankroll${b.market === 'teaser' ? ' per 2-leg slip' : ''} (quarter Kelly)` : ''; })()}</span>${trackBtn({ gid: b.gid, market: b.market, side: b.side, line: b.line, label: betLabel(b, g), game: `${g.data?.away?.short ?? g.away} @ ${g.data?.home?.short ?? g.home}`, start: g.start_time, tool: 'Best bets' })}</div></div>`; };
  box.innerHTML = `<h2>Best bets</h2>
    <p class="sub">Every tool’s reads on the same games, weighted by how that tool has done on games it hadn’t seen yet. Sides, totals and moneylines across NFL, college and NBA, strongest first. Tools under break-even get no weight.</p>
    <div class="grid g4" style="margin-bottom:12px">
      <div class="card stat"><div class="k">Best bets record</div><div class="v num">${rt(recs.best)}</div><div class="s">${pct(rp(recs.best), 1)} · break-even 52.4%</div></div>
      <div class="card stat"><div class="k">Leans record</div><div class="v num">${rt(recs.lean)}</div><div class="s">${pct(rp(recs.lean), 1)}</div></div>
      <div class="card stat"><div class="k">Teaser legs</div><div class="v num">${rt(recs.tease)}</div><div class="s">${pct(rp(recs.tease), 1)} · leg break-even 72.4%</div></div>
      <div class="card stat"><div class="k">On the board</div><div class="v num">${straight.filter((b) => b.tier === 'best').length} + ${straight.filter((b) => b.tier === 'lean').length}</div><div class="s">best bets + leans, next 8 days</div></div></div>
    <p class="stamp" style="margin-top:0">Logged at the line shown when the page is opened before kickoff and frozen at kickoff. Record started Nov 16, 2026.</p>
    ${straight.length ? `<div class="grid g3">${straight.map(card).join('')}</div>` : '<div class="empty">Nothing clears the bar right now. That happens; no bet is a fine bet.</div>'}
    ${legs.length ? `<div class="sec"><h2 style="font-size:20px">Teaser legs</h2><p class="sub">${legs.length >= 2 ? `Pair any two as a 6-point, 2-team teaser at −110 (each leg needs 72.4%).` : 'One qualifying leg so far; it needs a partner for a 2-team teaser.'}</p><div class="grid g3">${legs.map(card).join('')}</div></div>` : ''}
    ${howTo('How the weights work', `<p>Each tool is scored on games it hadn’t seen: research systems on seasons after they were published, Matrix systems on games after they were found, Line Life rules on 2014–2025, The Juice and Cap’n Cash on their own graded reads. Each record is pulled toward break-even as if it had 150 more games at exactly break-even, so a hot 20-game start barely counts. A bet’s strength is its best tool in full, plus a quarter of each other tool that agrees, minus any tool on the other side. 2.5+ points over break-even is a best bet; 1 to 2.5 is a lean.</p>
      <table class="t" style="margin-top:8px"><tr><th>Tool</th><th class="r">Record it’s judged on</th><th class="r">Weight</th></tr>${sources.map((x) => `<tr><td>${esc(x.name)}</td><td class="r num">${x.w + x.l ? `${x.w}–${x.l}` : '—'}</td><td class="r num ${x.edge > 0 ? 'mint' : 'dim'}">${x.edge > 0 ? '+' + (x.edge * 100).toFixed(1) + ' pts' : 'none'}</td></tr>`).join('')}
      <tr><td>In the Paint pregame totals</td><td class="r num">see its page</td><td class="r num dim">none (under break-even)</td></tr><tr><td>Redzone touchdown model</td><td class="r num">—</td><td class="r num dim">no free prop prices to bet against</td></tr></table>`, 'bets')}`;
  wireHow(box);
}
