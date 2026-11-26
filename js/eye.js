import { games, fmtTime, fmtDay, dayKey, esc, logo, seg, onSeg, store, tzPref, TZS, howTo, wireHow, footNote, clearCache } from './core.js?v=202611260323';

const NET_ORDER = ['CBS', 'Fox', 'NBC', 'ABC', 'ESPN', 'ESPN2', 'ESPNU', 'ESPN+', 'Prime Video', 'Netflix', 'NFL Net', 'Peacock', 'Disney+', 'FS1', 'CBSSN', 'BTN', 'SEC Network', 'SECN+', 'ACC Network', 'ACCNX', 'CW', 'TNT', 'USA Net'];

function gcal(g) {
  const s = new Date(g.start_time), e = new Date(s.getTime() + 3.5 * 3600e3);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const d = g.data;
  const text = `${d.away.short || d.away.abbr} at ${d.home.short || d.home.abbr}`;
  const det = `On ${(d.bcast || []).join(', ') || 'TBD'}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(text)}&dates=${f(s)}/${f(e)}&details=${encodeURIComponent(det)}&location=${encodeURIComponent(d.venue || '')}`;
}

export async function render(el) {
  const st = {
    lg: store.get('eye:lg', 'nfl'),
    tz: tzPref(),
    team: store.get('eye:team', ''),
    off: new Set(store.get('eye:off', [])),
    past: store.get('eye:past', false),
  };
  let all = [];

  async function load() {
    el.innerHTML = '<div class="loading">Pulling the schedule…</div>';
    const rows = await games({ league: st.lg, ttl: 120_000 });
    all = st.lg === 'cfb' ? rows.filter((g) => g.data?.home?.rank || g.data?.away?.rank) : rows;
    draw();
  }

  function nets(g) { return (g.data.bcast && g.data.bcast.length) ? g.data.bcast : ['TBD']; }
  function visible(g) {
    if (st.team && g.home !== st.team && g.away !== st.team) return false;
    return nets(g).some((n) => !st.off.has(n));
  }

  function draw() {
    const now = Date.now();
    const netCount = {};
    for (const g of all) for (const n of nets(g)) netCount[n] = (netCount[n] || 0) + 1;
    const netList = Object.keys(netCount).sort((a, b) => {
      const ia = NET_ORDER.indexOf(a), ib = NET_ORDER.indexOf(b);
      if (a === 'TBD') return 1; if (b === 'TBD') return -1;
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || netCount[b] - netCount[a];
    });
    const teams = [...new Map(all.flatMap((g) => [[g.home, g.data.home], [g.away, g.data.away]])).entries()]
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    const shown = all.filter(visible);
    const live = shown.filter((g) => g.state === 'in');
    const next = shown.find((g) => g.state === 'pre' && new Date(g.start_time).getTime() > now);

    // group by week
    const weeks = new Map();
    for (const g of shown) {
      const k = g.week ?? 0;
      if (!weeks.has(k)) weeks.set(k, []);
      weeks.get(k).push(g);
    }
    let dropped = 0;
    const weekHtml = [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([wk, list]) => {
      const done = list.every((g) => g.state === 'post');
      if (done && !st.past) { dropped++; return ''; }
      const first = list[0].start_time, last = list[list.length - 1].start_time;
      let lastDay = '';
      const rows = list.map((g) => {
        const d = g.data;
        const dk = dayKey(g.start_time, st.tz);
        const dayRow = dk !== lastDay ? `<tr><td colspan="4" style="padding-top:14px;border-bottom:1px solid var(--line2)"><span class="kicker" style="color:var(--muted)">${esc(fmtDay(g.start_time, { tz: st.tz }))}</span></td></tr>` : '';
        lastDay = dk;
        const fin = g.state === 'post';
        const aw = fin && d.away.score > d.home.score, hw = fin && d.home.score > d.away.score;
        const when = g.state === 'in' ? `<span class="pill-live">${esc(d.detail)}</span>`
          : fin ? `<span class="dim">Final</span>` : d.tbd ? `<span class="dim">Window TBD</span>` : `<span class="num">${esc(fmtTime(g.start_time, { tz: st.tz }))}</span>`;
        const score = (g.state !== 'pre') ? `<span class="num disp" style="font-size:18px">${d.away.score ?? ''}–${d.home.score ?? ''}</span>` : '';
        const mine = nets(g).filter((n) => !st.off.has(n));
        return dayRow + `<tr>
          <td style="width:120px">${when}</td>
          <td><div class="team" style="${aw ? 'font-weight:600' : fin ? 'opacity:.6' : ''}">${logo(d.away)}<span>${d.away.rank ? `<span class="dim">${d.away.rank}</span> ` : ''}${esc(d.away.short)}</span></div>
              <div class="team" style="margin-top:4px;${hw ? 'font-weight:600' : fin ? 'opacity:.6' : ''}">${logo(d.home)}<span>${d.neutral ? 'vs' : '@'} ${d.home.rank ? `<span class="dim">${d.home.rank}</span> ` : ''}${esc(d.home.short)}</span></div>
              ${d.note ? `<div class="dim" style="font-size:12px;margin-top:3px">${esc(d.note)}</div>` : ''}</td>
          <td>${score}</td>
          <td class="r"><div class="chips" style="justify-content:flex-end">${nets(g).map((n) => `<span class="chip ${mine.includes(n) ? '' : 'off'}">${esc(n)}</span>`).join('')}</div>
              ${g.state === 'pre' && !d.tbd ? `<a href="${gcal(g)}" target="_blank" rel="noopener" style="font-size:12px">+ Calendar</a>` : ''}</td></tr>`;
      }).join('');
      return `<div class="sec"><h2>${st.lg === 'nfl' ? 'Week' : 'Week'} ${wk}</h2><p class="sub">${esc(fmtDay(first, { tz: st.tz }))} – ${esc(fmtDay(last, { tz: st.tz }))} · ${list.length} game${list.length === 1 ? '' : 's'} on your services</p>
        <div class="card" style="padding:4px 12px"><table class="t">${rows}</table></div></div>`;
    }).join('');

    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Watch guide</div><h1>Eye in the Sky</h1><p>Where the ball is, and which screen it’s on. Turn off the channels you don’t have and the schedule shrinks to what you can actually watch.</p></div>
      <button class="btn" data-act="refresh">↻ Refresh</button></div>
    <div class="row" style="margin-bottom:12px">
      ${seg('lg', [['nfl', 'NFL'], ['cfb', 'College Top 25']], st.lg)}
      ${seg('tz', Object.keys(TZS).map((k) => [k, k === 'Local' ? 'My time' : k]), st.tz)}
      <select data-act="team" aria-label="Team"><option value="">All teams</option>${teams.map(([abbr, t]) => `<option value="${esc(abbr)}" ${abbr === st.team ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <label class="row" style="gap:6px;font-size:13.5px"><input type="checkbox" data-act="past" ${st.past ? 'checked' : ''}> Show finished weeks</label>
    </div>
    <div class="card" style="margin-bottom:6px"><div class="kicker" style="color:var(--muted);margin-bottom:8px">My channels <span class="dim" style="letter-spacing:0;text-transform:none">· tap to turn off the ones you don’t get</span></div>
      <div class="chips">${netList.map((n) => `<button class="chip ${st.off.has(n) ? 'off' : 'on'}" data-net="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>
    <p class="stamp">${shown.length} games on your services${dropped ? ` · ${dropped} finished week${dropped === 1 ? '' : 's'} hidden` : ''}</p>
    ${live.length ? `<div class="sec"><h2>On now</h2><div class="grid g3">${live.map((g) => `<div class="card"><div class="pill-live" style="font-size:13px">${esc(g.data.detail)} · ${esc(nets(g).join(', '))}</div>
      <div class="row" style="justify-content:space-between;margin-top:8px"><span class="team">${logo(g.data.away)}<span>${esc(g.data.away.short)}</span></span><b class="disp num" style="font-size:22px">${g.data.away.score ?? 0}</b></div>
      <div class="row" style="justify-content:space-between"><span class="team">${logo(g.data.home)}<span>${esc(g.data.home.short)}</span></span><b class="disp num" style="font-size:22px">${g.data.home.score ?? 0}</b></div></div>`).join('')}</div></div>` : ''}
    ${next ? `<div class="sec"><h2>Next on your services</h2><div class="card hl"><div class="row" style="justify-content:space-between">
      <div><div class="disp" style="font-size:26px">${esc(next.data.away.name)} ${next.data.neutral ? 'vs' : 'at'} ${esc(next.data.home.name)}</div>
      <div class="muted">${esc(fmtDay(next.start_time, { tz: st.tz }))} · ${next.data.tbd ? 'Window TBD' : esc(fmtTime(next.start_time, { tz: st.tz })) + ' ' + st.tz} · ${esc(nets(next).join(', '))}${next.data.city ? ' · ' + esc(next.data.city) : ''}</div></div>
      ${!next.data.tbd ? `<a class="btn" href="${gcal(next)}" target="_blank" rel="noopener">+ Calendar</a>` : ''}</div></div></div>` : ''}
    ${weekHtml || '<div class="empty sec">Nothing left on the channels you picked.</div>'}
    ${footNote('Schedule and channels from ESPN, refreshed every morning and every 5 minutes on game days. Kickoffs and flex games move. Independent guide, not affiliated with the NFL, NCAA, or any network.')}`;

    onSeg(el, 'lg', (v) => { st.lg = v; store.set('eye:lg', v); st.team = ''; store.set('eye:team', ''); load(); });
    onSeg(el, 'tz', (v) => { st.tz = v; store.set('tz', v); draw(); });
    el.querySelector('[data-act=team]').onchange = (e) => { st.team = e.target.value; store.set('eye:team', st.team); draw(); };
    el.querySelector('[data-act=past]').onchange = (e) => { st.past = e.target.checked; store.set('eye:past', st.past); draw(); };
    el.querySelector('[data-act=refresh]').onclick = () => { clearCache(); load(); };
    el.querySelectorAll('[data-net]').forEach((b) => b.onclick = () => {
      const n = b.dataset.net; st.off.has(n) ? st.off.delete(n) : st.off.add(n); store.set('eye:off', [...st.off]); draw();
    });
    wireHow(el);
  }

  await load();
  const t = setInterval(() => { if (all.some((g) => g.state === 'in')) { clearCache(); load(); } }, 120_000);
  return () => clearInterval(t);
}
