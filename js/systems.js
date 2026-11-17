// Rule engine for the Matrix systems (a faithful port of the Grok workspace's mine_angles.py / build-matrix.py).
// A system key reads: tier - [fade] - role - bucket - filters... - market, e.g. m-fade-away_dog-ge5-loss7-cold-late-ats.

export const NFL_CONF = {
  BUF: 'AFC', MIA: 'AFC', NE: 'AFC', NYJ: 'AFC', BAL: 'AFC', CIN: 'AFC', CLE: 'AFC', PIT: 'AFC', HOU: 'AFC', IND: 'AFC', JAX: 'AFC', TEN: 'AFC',
  DEN: 'AFC', KC: 'AFC', LV: 'AFC', LAC: 'AFC', OAK: 'AFC', SD: 'AFC', DAL: 'NFC', NYG: 'NFC', PHI: 'NFC', WAS: 'NFC', CHI: 'NFC', DET: 'NFC',
  GB: 'NFC', MIN: 'NFC', ATL: 'NFC', CAR: 'NFC', NO: 'NFC', TB: 'NFC', ARI: 'NFC', LA: 'NFC', SF: 'NFC', SEA: 'NFC', STL: 'NFC',
};
const CFB_FILTERS = new Set(['conf', 'nonconf', 'loss', 'loss7', 'loss10', 'loss14', 'win', 'win7', 'win14', 'streakL', 'streakW', 'low3', 'low7', 'shut', 'allowed28', 'nocover', 'cover', 'opp_loss', 'opp_loss10', 'opp_win', 'oppblow', 'opp_cover', 'opp_nocover', 'bothloss', 'early', 'late', 'sept', 'dec', 'lowtot', 'hightot', 'rematch', 'offroad', 'offhome']);
const TOTAL_FILTERS = new Set(['div', 'conf', 'nonconf', 'prime', 'thu', 'mon', 'cold', 'wind', 'dome', 'outdoor', 'grass', 'turf', 'early', 'late', 'sept', 'dec', 'bothloss', 'rematch']);
const DOG_SPREADS = { le3: (g) => g > 0 && g <= 3, le45: (g) => g > 0 && g <= 4.5, m36: (g) => g >= 3.5 && g <= 6.5, m79: (g) => g >= 7 && g <= 9.5, ge5: (g) => g >= 5, ge7: (g) => g >= 7, ge10: (g) => g >= 10, ge14: (g) => g >= 14 };
const FAV_SPREADS = { lay3: (l) => l > 0 && l <= 3, lay6: (l) => l > 0 && l <= 6, lay36: (l) => l >= 3.5 && l <= 6.5, lay7: (l) => l >= 7, lay10: (l) => l >= 10, lay14: (l) => l >= 14 };
const TOTAL_BUCKETS = { any: () => true, tle40: (t) => t <= 40.5, tle43: (t) => t <= 43, t4147: (t) => t >= 41 && t <= 47, tge47: (t) => t >= 47.5, tge50: (t) => t >= 50 };
const DOG_ROLES = new Set(['dog', 'home_dog', 'away_dog']);
const FAV_ROLES = new Set(['fav', 'home_fav', 'away_fav']);
const other = (s) => ({ home: 'away', away: 'home', over: 'under', under: 'over' }[s]);

// ---------- game helpers ----------
const margin = (team, g) => g.home === team ? g.home_score - g.away_score : g.away_score - g.home_score;
const scored = (team, g) => g.home === team ? g.home_score : g.away_score;
export function spreadGrade(g, side) {
  if (!g.final || g.home_spread === null || g.home_spread === undefined) return null;
  const d = (g.home_score - g.away_score) + g.home_spread;
  if (Math.abs(d) < 1e-9) return 'push';
  return (d > 0 ? 'home' : 'away') === side ? 'win' : 'loss';
}
export function totalGrade(g, side) {
  if (!g.final || g.total === null || g.total === undefined) return null;
  const pts = g.home_score + g.away_score;
  if (Math.abs(pts - g.total) < 1e-9) return 'push';
  return (pts > g.total ? 'over' : 'under') === side ? 'win' : 'loss';
}
export function suGrade(g, side) {
  if (!g.final) return null;
  const m = side === 'home' ? g.home_score - g.away_score : g.away_score - g.home_score;
  return m === 0 ? 'push' : m > 0 ? 'win' : 'loss';
}
const primetime = (g) => g.weekday === 'Thursday' || g.weekday === 'Monday' || (g.weekday === 'Sunday' && (g.time || '') >= '19:00');
const dogSide = (g) => g.home_spread === null || g.home_spread === undefined || Math.abs(g.home_spread) < 1e-9 ? null : g.home_spread > 0 ? 'home' : 'away';

// ---------- context: previous games, rematches ----------
export function makeContext(games, league) {
  const sorted = [...games].sort((a, b) => (a.date + (a.time || '') + a.id).localeCompare(b.date + (b.time || '') + b.id));
  const byTeam = new Map(), pos = new Map(), seen = new Set(), rematch = new Set();
  for (const g of sorted) {
    const k = g.season + '|' + [g.home, g.away].sort().join('|');
    if (seen.has(k)) rematch.add(g.id); seen.add(k);
    if (!g.final) continue;
    for (const t of [g.home, g.away]) { if (!byTeam.has(t)) byTeam.set(t, []); const s = byTeam.get(t); pos.set(t + '|' + g.id, s.length); s.push(g); }
  }
  const prevTwo = (team, g) => {
    const s = byTeam.get(team) ?? [];
    const i = pos.get(team + '|' + g.id);
    if (i === undefined) { const e = s.filter((x) => x.date < g.date); return [e[e.length - 1] ?? null, e[e.length - 2] ?? null]; }
    return [i ? s[i - 1] : null, i >= 2 ? s[i - 2] : null];
  };
  return { league, games: sorted, prevTwo, rematch, nfl: league === 'nfl' };
}

// ---------- situation flags for one side of one game ----------
export function sideFlags(ctx, g, side) {
  const F = new Set(), nfl = ctx.nfl;
  if (g.div) F.add('div');
  let same = false;
  if (nfl && NFL_CONF[g.home] && NFL_CONF[g.home] === NFL_CONF[g.away]) { same = true; F.add('conf'); }
  if (!nfl && g.conf) { same = true; F.add('conf'); }
  if (!same) { if (nfl && NFL_CONF[g.home] && NFL_CONF[g.away]) F.add('nonconf'); if (!nfl) F.add('nonconf'); }
  if (nfl && primetime(g)) F.add('prime');
  if (g.weekday === 'Thursday') F.add('thu');
  if (g.weekday === 'Monday') F.add('mon');
  const own = side === 'home' ? g.home_rest : g.away_rest, opp = side === 'home' ? g.away_rest : g.home_rest;
  if (own != null && own >= 13) F.add('bye');
  if (opp != null && opp >= 13) F.add('oppbye');
  if (own != null && own <= 6) F.add('short');
  if (opp != null && opp <= 6) F.add('oppshort');
  if (own != null && opp != null && own - opp >= 4) F.add('rest');
  if (own != null && opp != null && opp - own >= 4) F.add('tired');
  const team = side === 'home' ? g.home : g.away, oppTeam = side === 'home' ? g.away : g.home;
  const [prev, two] = ctx.prevTwo(team, g), [oprev] = ctx.prevTwo(oppTeam, g);
  const pm = prev ? margin(team, prev) : null, ps = prev ? scored(team, prev) : null;
  const pa = prev ? (prev.home === team ? prev.away_score : prev.home_score) : null;
  if (pm !== null) { if (pm <= -14) F.add('loss14'); if (pm <= -10) F.add('loss10'); if (pm <= -7) F.add('loss7'); if (pm < 0) F.add('loss'); if (pm >= 14) F.add('win14'); if (pm >= 7) F.add('win7'); if (pm > 0) F.add('win'); }
  if (two && prev && pm !== null) { const em = margin(team, two); if (pm < 0 && em < 0) F.add('streakL'); if (pm > 0 && em > 0) F.add('streakW'); }
  if (ps !== null && ps <= 3) F.add('low3');
  if (ps !== null && ps <= 7) F.add('low7');
  if (ps === 0) F.add('shut');
  if (pa !== null && pa >= (nfl ? 28 : 35)) F.add('allowed28');
  if (prev && prev.home_spread != null) { const c = spreadGrade(prev, prev.home === team ? 'home' : 'away'); if (c === 'loss') F.add('nocover'); else if (c === 'win') F.add('cover'); }
  if (prev) {
    if (prev.away === team) F.add('offroad'); else if (prev.home === team) F.add('offhome');
    if (prev.overtime) F.add('ot');
    const pq = prev.home === team ? prev.home_qb : prev.away_qb, tq = side === 'home' ? g.home_qb : g.away_qb;
    if (pq && tq && pq !== tq) F.add('newqb');
    const pc = prev.home === team ? prev.home_coach : prev.away_coach, tc = side === 'home' ? g.home_coach : g.away_coach;
    if (pc && tc && pc !== tc) F.add('newcoach');
  }
  const om = oprev ? margin(oppTeam, oprev) : null;
  if (om !== null) { if (om >= 14) F.add('oppblow'); if (om < 0) F.add('opp_loss'); if (om <= -10) F.add('opp_loss10'); if (om > 0) F.add('opp_win'); }
  if (oprev && oprev.home_spread != null) { const c = spreadGrade(oprev, oprev.home === oppTeam ? 'home' : 'away'); if (c === 'win') F.add('opp_cover'); else if (c === 'loss') F.add('opp_nocover'); }
  if (pm !== null && om !== null && pm < 0 && om < 0) F.add('bothloss');
  const roof = g.roof || '';
  if (g.temp != null && g.temp <= 40 && (roof === 'outdoors' || roof === 'open')) F.add('cold');
  if (g.wind != null && g.wind >= 15 && (roof === 'outdoors' || roof === 'open')) F.add('wind');
  if (roof === 'dome' || roof === 'closed') F.add('dome');
  if (roof === 'outdoors' || roof === 'open') F.add('outdoor');
  const surf = (g.surface || '').toLowerCase();
  if (surf) { if (surf.includes('grass') && !surf.includes('turf')) F.add('grass'); else if (surf.includes('turf') || surf.includes('artificial')) F.add('turf'); }
  if (g.week <= (nfl ? 4 : 3)) F.add('early');
  if (g.week >= (nfl ? 14 : 10)) F.add('late');
  const mo = (g.date || '').slice(5, 7);
  if (mo === '09') F.add('sept');
  if (mo === '12') F.add('dec');
  if (g.total != null && g.total <= 43) F.add('lowtot');
  if (g.total != null && g.total >= 47.5) F.add('hightot');
  if (ctx.rematch.has(g.id)) F.add('rematch');
  if (!nfl) for (const f of [...F]) if (!CFB_FILTERS.has(f)) F.delete(f);
  return F;
}

// ---------- parse a system ----------
export function parseSystem(s) {
  const t = s.key.split('-');
  if (!['m', 's', 'p'].includes(t[0])) return { classic: s.key };
  let i = 1; const fade = t[i] === 'fade'; if (fade) i++;
  const role = t[i++], bucket = t[i++], market = t[t.length - 1];
  return { tier: t[0], fade, role, bucket, filters: t.slice(i, t.length - 1), market };
}

const rolesFor = (home, dog, fav) => { const r = [home ? 'home' : 'away']; if (dog) r.push('dog', home ? 'home_dog' : 'away_dog'); else if (fav) r.push('fav', home ? 'home_fav' : 'away_fav'); return r; };
function bucketOk(role, bucket, line) {
  if (bucket === 'any') return true;
  if (DOG_ROLES.has(role) && line > 0) return DOG_SPREADS[bucket]?.(line) ?? false;
  if (FAV_ROLES.has(role) && line < 0) return FAV_SPREADS[bucket]?.(-line) ?? false;
  return false;
}

// Classic hand-written systems
function classic(ctx, key, g) {
  const nfl = ctx.nfl, ds = dogSide(g), dp = ds ? Math.abs(g.home_spread) : null, fs = ds ? other(ds) : null;
  const team = (s) => s === 'home' ? g.home : g.away;
  const prev = (s) => ctx.prevTwo(team(s), g)[0];
  const sameConf = nfl ? (NFL_CONF[g.home] && NFL_CONF[g.home] === NFL_CONF[g.away]) : !!g.conf;
  const bounce = (needConf, needDiv) => { if (needDiv && !g.div) return null; if (needConf && !sameConf) return null; if (!ds || dp > 4.5) return null; const p = prev(ds); return p && scored(team(ds), p) <= 3 ? ds : null; };
  switch (key) {
    case 'bounce-div': return bounce(false, true);
    case 'bounce-conf': return bounce(true, false);
    case 'bounce-any': return bounce(false, false);
    case 'shutout-dog': { if (!ds) return null; const p = prev(ds); return p && scored(team(ds), p) === 0 ? ds : null; }
    case 'home-dog': return (!nfl && g.neutral) ? null : ds === 'home' ? 'home' : null;
    case 'home-dog-short': return (!nfl && g.neutral) ? null : ds === 'home' && dp <= 3 ? 'home' : null;
    case 'div-dog-short': return g.div && ds && dp <= 3 ? ds : null;
    case 'conf-dog-short': return g.conf && ds && dp <= 3 ? ds : null;
    case 'primetime-dog': return primetime(g) && ds ? ds : null;
    case 'bye-dog': { if (!ds) return null; const r = ds === 'home' ? g.home_rest : g.away_rest, o = ds === 'home' ? g.away_rest : g.home_rest; return r != null && o != null && r >= 13 && o <= 8 ? ds : null; }
    case 'road-fav': return fs === 'away' ? 'away' : null;
    case 'big-dog': return ds && dp >= (nfl ? 10 : 14) ? ds : null;
    case 'fav-blowout-loss': { if (!fs) return null; const p = prev(fs); return p && margin(team(fs), p) <= -14 ? fs : null; }
    case 'dog-blowout-win': { if (!ds) return null; const p = prev(ds); return p && margin(team(ds), p) >= 14 ? ds : null; }
    case 'div-under': return g.div && g.total != null ? 'under' : null;
    case 'conf-under': return g.conf && g.total != null ? 'under' : null;
    case 'low-total-under': return g.total != null && g.total <= 40.5 ? 'under' : null;
    case 'thu-under': return g.weekday === 'Thursday' && g.total != null ? 'under' : null;
    case 'cold-under': return g.temp != null && g.temp <= 32 && g.total != null ? 'under' : null;
    case 'home-div-dog-loss10': { if (!g.div || ds !== 'home' || dp < 5) return null; const p = prev('home'); return p && margin(g.home, p) <= -10 ? 'home' : null; }
    default: return undefined; // unknown classic
  }
}
const CLASSIC_KIND = (key) => /under/.test(key) ? 'total' : 'spread';

// Which pick (if any) a system makes on a game. Returns { side, kind } or null; undefined if the system can't be evaluated.
export function matchSystem(ctx, sys, parsed, g, flagCache) {
  if (parsed.classic) {
    const k = sys.key;
    if (g.home_spread == null && CLASSIC_KIND(k) === 'spread') return null;
    const side = classic(ctx, k, g);
    if (side === undefined) return undefined;
    return side ? { side, kind: CLASSIC_KIND(k) } : null;
  }
  const flagsOf = (side) => { const ck = g.id + ':' + side; if (!flagCache.has(ck)) flagCache.set(ck, sideFlags(ctx, g, side)); return flagCache.get(ck); };
  if (parsed.market === 'tot') {
    if (g.total == null || g.home_spread == null) return null;
    if (!TOTAL_BUCKETS[parsed.bucket]?.(g.total)) return null;
    const fl = flagsOf('away');
    for (const f of parsed.filters) if (!TOTAL_FILTERS.has(f) || !fl.has(f)) return null;
    return { side: parsed.fade ? other(parsed.role) : parsed.role, kind: 'total' };
  }
  if (g.home_spread == null) return null;
  for (const side of ['home', 'away']) {
    if (!ctx.nfl && side === 'home' && g.neutral) continue;
    const ln = side === 'home' ? g.home_spread : -g.home_spread;
    const dog = ln > 1e-9, fav = ln < -1e-9;
    if (!rolesFor(side === 'home', dog, fav).includes(parsed.role)) continue;
    if (!bucketOk(parsed.role, parsed.bucket, ln)) continue;
    const fl = flagsOf(side);
    if (!parsed.filters.every((f) => fl.has(f))) continue;
    const pick = parsed.fade ? other(side) : side;
    return { side: pick, kind: parsed.market === 'su' ? 'moneyline' : 'spread' };
  }
  return null;
}

export function gradePick(g, m) {
  return m.kind === 'total' ? totalGrade(g, m.side) : m.kind === 'moneyline' ? suGrade(g, m.side) : spreadGrade(g, m.side);
}
export function pickLabel(g, m, abbr = (t) => t) {
  if (m.kind === 'total') return `${m.side === 'over' ? 'Over' : 'Under'} ${g.total}`;
  const team = abbr(m.side === 'home' ? g.home : g.away);
  if (m.kind === 'moneyline') { const o = m.side === 'home' ? g.home_ml : g.away_ml; return `${team} ${o ? (o > 0 ? '+' + o : o) : 'ML'}`; }
  const ln = m.side === 'home' ? g.home_spread : -g.home_spread;
  return `${team} ${Math.abs(ln) < 1e-9 ? 'PK' : (ln > 0 ? '+' : '') + ln}`;
}
