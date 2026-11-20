// Line-move signal: when a DraftKings line has moved far enough from its opener, flag the side it moved toward,
// the number to get, and the number where it's no longer worth chasing. Every flag is frozen when it first fires
// (from the saved line history) and graded two ways: did the line keep moving past it by kickoff, and did it win.
// Rules written Nov 17, 2026, before any of these flags had been graded.
import { api } from './core.js?v=202611200341';

export const TRIG = { nfl: { tot: 1.5, sp: 1 }, cfb: { tot: 1.5, sp: 1.5 }, nba: { tot: 2, sp: 1.5 } };
export const STEP = { nfl: { tot: 1, sp: 1 }, cfb: { tot: 1.5, sp: 1.5 }, nba: { tot: 1.5, sp: 1 } };
export const SNAPS_FROM = '2026-11-17T02:46:00Z'; // every line change has been saved since this time

// a side's number: spread from that team's view, or the total
const sideNum = (mk, side, v) => mk === 'tot' ? v : side === 'home' ? v : -v;
// is a better for the bettor than b? (more points on a spread, lower total for an over, higher for an under)
export const better = (mk, side, a, b) => mk === 'tot' ? (side === 'over' ? a < b : a > b) : a > b;

// side the line moved toward, from opener `o` to value `v` (home spread or total)
function moveSide(mk, o, v) {
  if (v === o) return null;
  if (mk === 'tot') return v > o ? 'over' : 'under';
  return v < o ? 'home' : 'away'; // home spread falling = money on home
}

// the worst number still worth taking: one step further along the move, stopping at 3 and 7 in the NFL
export function limitFor(lg, mk, side, num) {
  const step = STEP[lg]?.[mk] ?? 1;
  let lim = mk === 'tot' ? (side === 'over' ? num + step : num - step) : num - step;
  if (lg === 'nfl' && mk === 'sp') for (const k of [3, 7, -3, -7]) if (num > k && lim < k) { lim = k; break; } // don't give up a key number
  return lim;
}

export function flagNow(g) {
  const out = [];
  const lg = g.league;
  for (const mk of ['tot', 'sp']) {
    const o = mk === 'tot' ? g.open_total : g.open_spread_home, v = mk === 'tot' ? g.total : g.spread_home;
    if (o === null || v === null || o === undefined || v === undefined) continue;
    const ov = Number(o), cv = Number(v); if (mk === 'tot' && !(ov > 0)) continue;
    if (Math.abs(cv - ov) < TRIG[lg][mk]) continue;
    const side = moveSide(mk, ov, cv);
    const num = sideNum(mk, side, cv);
    out.push({ mk, side, open: sideNum(mk, side, ov), num, limit: limitFor(lg, mk, side, num), move: Math.abs(cv - ov) });
  }
  return out;
}

// first time each game's line crossed the trigger, from the saved snapshots
export function firstFlags(games, snaps) {
  const by = new Map(); for (const s of snaps) { if (!by.has(s.game_id)) by.set(s.game_id, []); by.get(s.game_id).push(s); }
  const flags = [];
  for (const g of games) {
    const list = (by.get(String(g.id)) || []).sort((a, b) => new Date(a.ts) - new Date(b.ts));
    for (const mk of ['tot', 'sp']) {
      const o = Number(mk === 'tot' ? g.open_total : g.open_spread_home); if (!Number.isFinite(o) || (mk === 'tot' && !(o > 0))) continue;
      for (const s of list) {
        if (new Date(s.ts).getTime() >= new Date(g.start_time).getTime()) break;
        const v = s[mk === 'tot' ? 'total' : 'spread_home']; if (v === null) continue;
        if (Math.abs(Number(v) - o) < TRIG[g.league][mk]) continue;
        const side = moveSide(mk, o, Number(v)), num = sideNum(mk, side, Number(v));
        flags.push({ g, mk, side, num, at: s.ts, limit: limitFor(g.league, mk, side, num) });
        break;
      }
    }
  }
  return flags;
}

// grade frozen flags on finished games: closing-line value and win/loss at the flagged number
export function gradeFlags(flags) {
  const rec = {};
  const bucket = (k) => rec[k] ??= { w: 0, l: 0, p: 0, beat: 0, same: 0, back: 0, n: 0 };
  for (const f of flags) {
    const g = f.g; if (g.state !== 'post' || g.home_score === null) continue;
    const closeRaw = f.mk === 'tot' ? g.close_total : g.close_spread_home; if (closeRaw === null || closeRaw === undefined) continue;
    const close = sideNum(f.mk, f.side, Number(closeRaw));
    let r;
    if (f.mk === 'tot') { const d = g.home_score + g.away_score - f.num; r = d === 0 ? 'p' : (d > 0) === (f.side === 'over') ? 'w' : 'l'; }
    else { const m = (f.side === 'home' ? g.home_score - g.away_score : g.away_score - g.home_score) + f.num; r = m === 0 ? 'p' : m > 0 ? 'w' : 'l'; }
    for (const k of ['all', `${g.league}:${f.mk}`]) {
      const b = bucket(k); b[r]++; b.n++;
      if (close === f.num) b.same++; else if (better(f.mk, f.side, f.num, close)) b.beat++; else b.back++;
    }
  }
  return rec;
}

export async function loadFlags(games) {
  const snaps = [];
  for (let off = 0; off < 60000; off += 1000) {
    const part = await api(`line_snaps?select=game_id,ts,spread_home,total&ts=gte.${SNAPS_FROM}&order=id.asc&offset=${off}&limit=1000`, { ttl: 300_000 });
    snaps.push(...part); if (part.length < 1000) break;
  }
  return firstFlags(games, snaps);
}

// What NFL history says about chasing a move this size at the closing number (TeamRankings, opening vs closing
// lines since 2008, graded at the close). Only the two cases with a real lean are called out.
export function historyNote(lg, f) {
  if (lg !== 'nfl') return null;
  if (f.mk === 'sp' && f.move >= 3 && f.open < 0) return { tone: 'clay', text: 'Don’t chase this one. Since 2008, opening NFL favorites the line moved 3+ more points toward covered only 63–90 (41%) at the closing number. Big moves like this are usually injury news that’s already priced in.' };
  if (f.mk === 'tot' && f.move >= 4 && f.side === 'under') return { tone: 'mint', text: 'History backs it: since 2008, NFL totals that fell 4+ points still went under 82–57 (59%) at the closing number.' };
  return null;
}
