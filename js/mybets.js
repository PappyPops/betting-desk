// My Bets: track the bets you actually place from any tool, graded automatically, with units and ROI by tool.
// Saved in this browser; Export and Import move them to another phone or computer.
import { api, blob, esc, fmtDay, fmtTime, pct, odds, store, toast, footNote, seg, onSeg } from './core.js?v=202611221403';

const KEY = 'mybets';
export const getBets = () => store.get(KEY, []);
const save = (list) => store.set(KEY, list);
const PROP_LABEL = { pass_yds: 'Pass yds', pass_cmp: 'Completions', pass_att: 'Pass attempts', pass_td: 'Pass TD', rush_att: 'Carries', rush_yds: 'Rush yds', rec: 'Receptions', rec_yds: 'Rec yds', pass_rush_yds: 'Pass + rush yds', rush_rec_yds: 'Rush + rec yds', td: 'Anytime TD' };
const boxStat = (b, s) => { if (!b) return 0; const m = { pass_rush_yds: ['pass_yds', 'rush_yds'], rush_rec_yds: ['rush_yds', 'rec_yds'], td: ['rush_td', 'rec_td'] }; return (m[s] || [s]).reduce((a, k) => a + (b[k] || 0), 0); };

// a button any tool can drop on a card: <button data-track='{...}'>
export function trackBtn(bet) {
  const id = betId(bet);
  const on = getBets().some((b) => b.id === id);
  return `<button class="btn" style="padding:4px 10px;font-size:12px" data-track="${esc(JSON.stringify(bet))}">${on ? '✓ Tracked' : '+ Track'}</button>`;
}
const betId = (b) => [b.gid, b.market, b.side, b.aid ?? '', b.stat ?? '', b.q ?? ''].join('|');

export const isTracked = (bet) => getBets().some((b) => b.id === betId(bet));
// Adds a bet; returns false if it's already tracked. bet.units multiplies the default stake (council 2U plays).
export function addBet(bet) {
  const id = betId(bet), list = getBets();
  if (list.some((b) => b.id === id)) return false;
  const odd = Number(store.get('mb:odds', -110)), stake = Number(store.get('mb:stake', 1)) * (bet.units || 1);
  list.unshift({ ...bet, id, odds: bet.odds ?? odd, stake, placed: new Date().toISOString() });
  save(list); return true;
}
export function wireTrack(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-track]'); if (!btn) return;
    if (!addBet(JSON.parse(btn.dataset.track))) { toast('Already tracked. Edit it on My Bets.'); return; }
    btn.textContent = '✓ Tracked'; toast('Tracked on My Bets');
  });
}
// Council picks we can't match to a game (NHL, college hoops, props) grade from the council ledger, or by hand.
const normPick = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.+\-]/g, '');
function ledgerRows(text) {
  return (text || '').split(/\n/).filter((l) => /^\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l)).map((l) => { const c = l.split('|').map((x) => x.trim()); return { date: c[0], member: c[1], pick: c[2], result: (c[4] || '').toUpperCase() }; });
}

const payout = (o) => o > 0 ? o / 100 : 100 / -o;
function gradeOne(b, g, box) {
  if (b.market === 'prop') { if (!box) return null; const v = boxStat(box[String(b.aid)], b.stat); return v === b.line ? 'P' : (v > b.line) === (b.side === 'over') ? 'W' : 'L'; }
  if (!g || g.state !== 'post' || g.home_score === null) return null;
  const hs = g.home_score, as = g.away_score, ln = Number(b.line);
  if (b.market === 'tot') { const d = hs + as - ln; return d === 0 ? 'P' : (d > 0) === (b.side === 'over') ? 'W' : 'L'; }
  if (b.market === 'ml') return hs === as ? 'P' : (b.side === 'home') === (hs > as) ? 'W' : 'L';
  const m = (b.side === 'home' ? hs - as : as - hs) + ln; return m === 0 ? 'P' : m > 0 ? 'W' : 'L';
}

export async function render(el) {
  const st = { view: store.get('mb:view', 'open') };
  el.innerHTML = '<div class="loading">Grading your tickets…</div>';
  async function draw() {
    const list = getBets();
    const gids = [...new Set(list.map((b) => b.gid).filter((g) => /^\d+$/.test(String(g))))];
    const L = list.some((b) => b.council) ? ledgerRows((await blob('council:ledger', 5 * 60_000).catch(() => null))?.data?.text) : [];
    const G = new Map(), B = new Map();
    for (let i = 0; i < gids.length; i += 150) {
      const part = gids.slice(i, i + 150).join(',');
      if (!part) break;
      for (const g of await api(`games?select=id,state,home_score,away_score,start_time&id=in.(${part})`, { ttl: 60_000 })) G.set(String(g.id), g);
      for (const s of await api(`whistle_snaps?select=game_id,box&period=eq.4&game_id=in.(${part})`, { ttl: 120_000 })) B.set(String(s.game_id), s.box);
    }
    for (const b of list) {
      b.result = b.manual || (b.market === 'manual' ? null : gradeOne(b, G.get(String(b.gid)), B.get(String(b.gid))));
      if (!b.result && b.market === 'manual' && b.council) {
        const c = b.council, r = L.find((x) => x.date === c.date && x.member.toLowerCase() === c.member.toLowerCase() && normPick(x.pick).startsWith(normPick(c.sel)));
        if (r && ['W', 'L', 'P'].includes(r.result)) b.result = r.result;
      }
    }
    const won = (b) => b.result === 'W' ? b.stake * payout(b.odds) : b.result === 'L' ? -b.stake : 0;
    const done = list.filter((b) => b.result), open = list.filter((b) => !b.result);
    const sum = (l) => { const w = l.filter((b) => b.result === 'W').length, ls = l.filter((b) => b.result === 'L').length, p = l.filter((b) => b.result === 'P').length; const u = l.reduce((a, b) => a + won(b), 0), risk = l.reduce((a, b) => a + (b.result === 'P' ? 0 : b.stake), 0); return { w, l: ls, p, u, roi: risk ? u / risk : null }; };
    const all = sum(done);
    const tools = [...new Set(done.map((b) => b.tool))];
    const label = (b) => b.market === 'prop' && b.stat === 'td' ? `${b.name} anytime TD` : b.market === 'prop' ? `${b.name} ${b.side === 'over' ? 'Over' : 'Under'} ${b.line} ${PROP_LABEL[b.stat] ?? b.stat}${b.q ? ` (${b.q})` : ''}` : b.label;
    const row = (b, i) => `<tr data-i="${list.indexOf(b)}"><td><b>${esc(label(b))}</b><div class="dim" style="font-size:12px">${esc(b.game ?? '')}${b.start ? ` · ${esc(fmtDay(b.start))} ${esc(fmtTime(b.start))}` : ''} · ${esc(b.tool)}</div></td>
      <td class="r"><input class="num" data-f="odds" value="${b.odds}" style="width:62px;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:2px 4px;text-align:right"></td>
      <td class="r"><input class="num" data-f="stake" value="${b.stake}" style="width:46px;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:2px 4px;text-align:right"></td>
      <td class="r num">${b.result ? `<b class="${b.result === 'W' ? 'mint' : b.result === 'L' ? 'clay' : 'dim'}">${b.result === 'W' ? '+' + (b.stake * payout(b.odds)).toFixed(2) : b.result === 'L' ? '−' + b.stake : 'push'}</b>${b.manual ? ' <button class="btn" data-man="" title="Undo" style="padding:0 6px;font-size:11px">↺</button>' : ''}` : b.market === 'manual' ? `<span style="white-space:nowrap">${['W', 'L', 'P'].map((r) => `<button class="btn" data-man="${r}" style="padding:1px 7px;font-size:11px">${r}</button>`).join(' ')}</span>` : '<span class="dim">open</span>'}</td>
      <td class="r"><button class="btn" data-del style="padding:2px 8px;font-size:12px">✕</button></td></tr>`;
    const shown = st.view === 'open' ? open : done;
    el.innerHTML = `
    <div class="ph"><div><div class="kicker">Your tickets</div><h1>My Bets</h1><p>Tap <b>+ Track</b> on any pick in Best bets, Betting Council, Slant, At the Whistle or Line Life. Each bet grades itself when the game ends (council picks the site can't match to a game grade from the council ledger, or tap W / L / P), and the record is split by the tool it came from, so you can see which ones actually pay you.</p></div></div>
    <div class="grid g4">
      <div class="card stat"><div class="k">Record</div><div class="v num">${all.w}–${all.l}${all.p ? '–' + all.p : ''}</div><div class="s">${pct(all.w + all.l ? all.w / (all.w + all.l) : null, 1)}</div></div>
      <div class="card stat"><div class="k">Units</div><div class="v num ${all.u >= 0 ? 'mint' : 'clay'}">${all.u >= 0 ? '+' : '−'}${Math.abs(all.u).toFixed(2)}</div><div class="s">at the odds you entered</div></div>
      <div class="card stat"><div class="k">ROI</div><div class="v num">${all.roi === null ? '—' : (all.roi * 100).toFixed(1) + '%'}</div><div class="s">profit per unit risked</div></div>
      <div class="card stat"><div class="k">Open</div><div class="v num">${open.length}</div><div class="s">waiting on a final</div></div></div>
    ${tools.length ? `<div class="sec"><h2>By tool</h2><div class="card" style="padding:4px 12px;overflow-x:auto"><table class="t"><tr><th>Tool</th><th class="r">Record</th><th class="r">Units</th><th class="r">ROI</th></tr>
      ${tools.map((t) => { const s = sum(done.filter((b) => b.tool === t)); return `<tr><td>${esc(t)}</td><td class="r num">${s.w}–${s.l}${s.p ? '–' + s.p : ''}</td><td class="r num ${s.u >= 0 ? 'mint' : 'clay'}">${s.u >= 0 ? '+' : '−'}${Math.abs(s.u).toFixed(2)}</td><td class="r num">${s.roi === null ? '—' : (s.roi * 100).toFixed(1) + '%'}</td></tr>`; }).join('')}</table></div></div>` : ''}
    <div class="sec"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">${seg('view', [['open', `Open (${open.length})`], ['done', `Graded (${done.length})`]], st.view)}
      <span class="row" style="gap:6px"><span class="dim" style="font-size:12.5px">New bets at</span><input data-def="odds" value="${store.get('mb:odds', -110)}" style="width:58px;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:2px 4px"><span class="dim" style="font-size:12.5px">for</span><input data-def="stake" value="${store.get('mb:stake', 1)}" style="width:40px;background:transparent;color:inherit;border:1px solid var(--line2);border-radius:6px;padding:2px 4px"><span class="dim" style="font-size:12.5px">u</span></span></div>
      <div class="card" style="padding:4px 12px;overflow-x:auto;margin-top:10px"><table class="t"><tr><th>Bet</th><th class="r">Odds</th><th class="r">Units</th><th class="r">Result</th><th></th></tr>
      ${shown.map(row).join('') || `<tr><td colspan="5" class="muted">${st.view === 'open' ? 'No open bets. Tap + Track on a pick to add one.' : 'Nothing graded yet.'}</td></tr>`}</table></div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn" data-act="export">Export</button><button class="btn" data-act="import">Import</button><button class="btn" data-act="csv">Download CSV</button></div>
      <p class="stamp">Bets are saved in this browser. To move them to another device, tap Export here, then Import on the other one and paste.</p></div>
    ${footNote('Graded from ESPN final scores and box scores.')}`;
    onSeg(el, 'view', (v) => { st.view = v; store.set('mb:view', v); draw(); });
    el.querySelectorAll('tr[data-i]').forEach((tr) => {
      const i = Number(tr.dataset.i);
      tr.querySelectorAll('input[data-f]').forEach((inp) => inp.onchange = () => { const l = getBets(); const v = Number(inp.value); if (Number.isFinite(v) && v !== 0) { l[i][inp.dataset.f] = v; save(l); draw(); } });
      tr.querySelector('[data-del]').onclick = () => { const l = getBets(); l.splice(i, 1); save(l); draw(); };
      tr.querySelectorAll('[data-man]').forEach((btn) => btn.onclick = () => { const l = getBets(); if (btn.dataset.man) l[i].manual = btn.dataset.man; else delete l[i].manual; save(l); draw(); });
    });
    el.querySelectorAll('input[data-def]').forEach((inp) => inp.onchange = () => { const v = Number(inp.value); if (Number.isFinite(v) && v !== 0) store.set(`mb:${inp.dataset.def}`, v); });
    el.querySelector('[data-act=export]').onclick = async () => { const t = btoa(unescape(encodeURIComponent(JSON.stringify(getBets())))); try { await navigator.clipboard.writeText(t); toast('Copied. Paste it into Import on your other device.'); } catch { prompt('Copy this:', t); } };
    el.querySelector('[data-act=import]').onclick = () => { const t = prompt('Paste the text from Export:'); if (!t) return; try { const inc = JSON.parse(decodeURIComponent(escape(atob(t.trim())))); const l = getBets(); const have = new Set(l.map((b) => b.id)); const add = inc.filter((b) => b.id && !have.has(b.id)); save([...add, ...l]); toast(`Added ${add.length} bets`); draw(); } catch { toast('That text didn’t read as an export.'); } };
    el.querySelector('[data-act=csv]').onclick = () => { const l = getBets(); const rows = [['placed', 'tool', 'bet', 'game', 'odds', 'units', 'result'], ...l.map((b) => [b.placed, b.tool, label(b), b.game ?? '', b.odds, b.stake, b.result ?? 'open'])]; const blob = new Blob([rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-bets.csv'; a.click(); };
  }
  await draw();
}
