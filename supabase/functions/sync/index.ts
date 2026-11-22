// Betting Desk data sync. Pulls public ESPN scoreboards (DraftKings lines, scores, TV) into the games table
// and records every line change in line_snaps. Runs on pg_cron every 5 minutes (see supabase/cron.sql).
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'User-Agent': 'BettingDesk/1.0 (personal research)', 'Accept': 'application/json' };
const SPORT: Record<string, string> = { nfl: 'football/nfl', cfb: 'football/college-football', nba: 'basketball/nba', cbb: 'basketball/mens-college-basketball' };
const CBB = '&groups=50&limit=500'; // every Division I game, not just the featured ones
const BASE = (lg: string) => `https://site.api.espn.com/apis/site/v2/sports/${SPORT[lg]}/scoreboard`;

const num = (s: unknown): number | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/^[ou]/i, '').trim();
  if (t === '') return null;
  if (/^(even|ev)$/i.test(t)) return 100;
  const n = Number(t.replace('+', ''));
  return Number.isFinite(n) ? n : null;
};

function etDate(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
}

async function getJSON(url: string) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.json();
}

function team(c: any) {
  const t = c?.team ?? {};
  return {
    id: t.id, abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName ?? t.name, nick: t.name,
    logo: t.logo ?? null, color: t.color ?? null,
    rec: (c?.records ?? []).find((r: any) => r.type === 'total' || r.name === 'overall')?.summary ?? null,
    score: c?.score !== undefined && c?.score !== '' ? Number(c.score) : null,
    rank: c?.curatedRank?.current && c.curatedRank.current < 99 ? c.curatedRank.current : null,
    lines: (c?.linescores ?? []).map((l: any) => l.value),
  };
}

function oddsOf(o: any) {
  if (!o) return null;
  const side = (x: any, k: 'open' | 'close') => x?.[k] ?? null;
  const ps = o.pointSpread ?? {}, tot = o.total ?? {}, ml = o.moneyline ?? {};
  const pick = (k: 'open' | 'close') => ({
    sp: num(side(ps.home, k)?.line), spH: num(side(ps.home, k)?.odds), spA: num(side(ps.away, k)?.odds),
    tot: num(side(tot.over, k)?.line), ovP: num(side(tot.over, k)?.odds), unP: num(side(tot.under, k)?.odds),
    mlH: num(side(ml.home, k)?.odds), mlA: num(side(ml.away, k)?.odds),
  });
  const cur = pick('close');
  // flat fields (summary/pickcenter shape)
  if (cur.tot === null) cur.tot = num(o.overUnder);
  if (cur.sp === null && typeof o.spread === 'number') cur.sp = o.spread;
  if (cur.mlH === null) cur.mlH = num(o.homeTeamOdds?.moneyLine);
  if (cur.mlA === null) cur.mlA = num(o.awayTeamOdds?.moneyLine);
  if (cur.sp === null && o.details) {
    const m = String(o.details).match(/^(\S+)\s+([+-]?\d+(\.\d+)?)$/);
    const homeAbbr = o.homeTeamOdds?.team?.abbreviation;
    if (m && homeAbbr) cur.sp = m[1] === homeAbbr ? Number(m[2]) : -Number(m[2]);
    else if (/even|pk/i.test(o.details)) cur.sp = 0;
  }
  return { prov: o.provider?.name ?? null, open: pick('open'), cur };
}

function norm(lg: string, e: any) {
  const comp = e.competitions?.[0] ?? {};
  const cs = comp.competitors ?? [];
  const home = cs.find((c: any) => c.homeAway === 'home'), away = cs.find((c: any) => c.homeAway === 'away');
  const st = comp.status ?? e.status ?? {};
  const prob = comp.situation?.lastPlay?.probability;
  const bc: string[] = [];
  for (const b of comp.broadcasts ?? []) for (const n of b.names ?? []) if (!bc.includes(n)) bc.push(n);
  for (const g of comp.geoBroadcasts ?? []) { const n = g.media?.shortName; if (n && !bc.includes(n)) bc.push(n); }
  return {
    id: String(e.id), lg, season: e.season?.year ?? null, stype: e.season?.type ?? null, week: e.week?.number ?? null,
    start: e.date, tbd: !!st.isTBDFlex || comp.timeValid === false,
    state: st.type?.state ?? 'pre', detail: st.type?.shortDetail ?? '', period: st.period ?? null, clock: st.displayClock ?? null,
    completed: !!st.type?.completed,
    neutral: !!comp.neutralSite, conf: !!comp.conferenceCompetition, indoor: comp.venue?.indoor ?? null,
    venue: comp.venue?.fullName ?? null, city: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(', ') || null,
    bcast: bc, note: (comp.notes ?? [])[0]?.headline ?? null,
    home: team(home), away: team(away),
    wpHome: prob ? prob.homeWinPercentage : null,
    sit: comp.situation ? { dd: comp.situation.downDistanceText ?? null, rz: !!comp.situation.isRedZone, pos: comp.situation.possession ?? null } : null,
    odds: oddsOf((comp.odds ?? [])[0]),
  };
}

async function pull(lg: string, qs: string) {
  try { const j = await getJSON(`${BASE(lg)}${qs}`); return { ev: (j.events ?? []).map((e: any) => norm(lg, e)), j }; }
  catch (err) { console.error(String(err)); return { ev: [], j: null }; }
}

async function store(games: any[]) {
  if (!games.length) return 0;
  const ids = games.map((g) => g.id);
  const existing = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from('games').select('id,state,open_spread_home,open_total,open_ml_home,open_ml_away,spread_home,total,ml_home,ml_away,close_spread_home,close_total,close_ml_home,close_ml_away').in('id', ids.slice(i, i + 300));
    for (const r of data ?? []) existing.set(r.id, r);
  }
  const rows: any[] = [], snaps: any[] = [];
  const now = new Date().toISOString();
  for (const g of games) {
    const ex = existing.get(g.id);
    const cur = g.odds?.cur ?? {}, op = g.odds?.open ?? {};
    const live = g.state !== 'pre';
    // Once a game starts ESPN stops quoting the pregame line, so keep the last pregame number.
    const keep = (curV: any, exV: any) => live ? (exV ?? curV ?? null) : (curV ?? exV ?? null);
    const sp = keep(cur.sp, ex?.spread_home), tot = keep(cur.tot, ex?.total), mlh = keep(cur.mlH, ex?.ml_home), mla = keep(cur.mlA, ex?.ml_away);
    rows.push({
      id: g.id, league: g.lg, season: g.season, week: g.week, start_time: g.start, state: g.state,
      home: g.home.abbr, away: g.away.abbr, home_score: g.home.score, away_score: g.away.score,
      open_spread_home: ex?.open_spread_home ?? op.sp ?? cur.sp ?? null,
      open_total: ex?.open_total ?? op.tot ?? cur.tot ?? null,
      open_ml_home: ex?.open_ml_home ?? op.mlH ?? cur.mlH ?? null,
      open_ml_away: ex?.open_ml_away ?? op.mlA ?? cur.mlA ?? null,
      spread_home: sp, total: tot, ml_home: mlh, ml_away: mla,
      close_spread_home: ex?.close_spread_home ?? (live ? sp : null),
      close_total: ex?.close_total ?? (live ? tot : null),
      close_ml_home: ex?.close_ml_home ?? (live ? mlh : null),
      close_ml_away: ex?.close_ml_away ?? (live ? mla : null),
      updated_at: now, data: g,
    });
    if (!live && (cur.sp !== null || cur.tot !== null)) {
      const changed = !ex || ex.spread_home != cur.sp || ex.total != cur.tot || ex.ml_home != cur.mlH || ex.ml_away != cur.mlA;
      if (changed) snaps.push({ game_id: g.id, league: g.lg, spread_home: cur.sp, total: cur.tot, ml_home: cur.mlH, ml_away: cur.mlA, spread_home_price: cur.spH, over_price: cur.ovP });
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from('games').upsert(rows.slice(i, i + 200));
    if (error) console.error('upsert', error.message);
  }
  if (snaps.length) { const { error } = await sb.from('line_snaps').insert(snaps); if (error) console.error('snaps', error.message); }
  return rows.length;
}

// Finished games that never got a closing line (played before tracking began): read it from ESPN's game summary.
async function backfill(lg: string, limit: number) {
  const { data } = await sb.from('games').select('id').eq('league', lg).eq('state', 'post').is('close_total', null).order('start_time', { ascending: false }).limit(limit);
  let done = 0;
  const ids = (data ?? []).map((r: any) => r.id);
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async (id: string) => {
      try {
        const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/${SPORT[lg]}/summary?event=${id}`);
        const pc = (j.pickcenter ?? []).find((p: any) => p.provider?.name === 'DraftKings') ?? (j.pickcenter ?? [])[0];
        const o = oddsOf(pc);
        const c = o?.cur ?? {}, op = o?.open ?? {};
        const upd: any = {
          close_spread_home: c.sp ?? null, close_total: c.tot ?? -1, close_ml_home: c.mlH ?? null, close_ml_away: c.mlA ?? null,
        };
        if (op.tot !== null && op.tot !== undefined) upd.open_total = op.tot;
        if (op.sp !== null && op.sp !== undefined) upd.open_spread_home = op.sp;
        await sb.from('games').update(upd).eq('id', id);
        done++;
      } catch (e) { console.error(String(e)); }
    }));
  }
  return done;
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const mode = u.searchParams.get('mode') ?? 'live';
  const t0 = Date.now();
  const all: any[] = [];
  const out: Record<string, unknown> = { mode };

  if (mode === 'live') {
    const n0 = await pull('nfl', '');
    all.push(...n0.ev);
    const wk = n0.j?.week?.number, st = n0.j?.season?.type ?? 2;
    if (wk) all.push(...(await pull('nfl', `?week=${wk + 1}&seasontype=${st}`)).ev);
    const c0 = await pull('cfb', '?groups=80&limit=400');
    all.push(...c0.ev);
    const cw = c0.j?.week?.number, cst = c0.j?.season?.type ?? 2;
    const dow = new Date().getUTCDay();
    if (cw && (dow === 0 || dow === 1 || dow === 2)) all.push(...(await pull('cfb', `?groups=80&limit=400&week=${cw + 1}&seasontype=${cst}`)).ev);
    for (const off of [-1, 0, 1, 2]) all.push(...(await pull('nba', `?dates=${etDate(off)}`)).ev);
  } else if (mode === 'schedule') {
    const lg = u.searchParams.get('lg') ?? 'nfl';
    const weeks = lg === 'nfl' ? 18 : 16;
    const grp = lg === 'cfb' ? '&groups=80&limit=400' : '';
    for (let w = 1; w <= weeks; w++) all.push(...(await pull(lg, `?week=${w}&seasontype=2${grp}`)).ev);
  } else if (mode === 'cbb') {
    // college basketball runs on its own schedule (150+ games on a busy day)
    for (const off of [-1, 0, 1, 2]) all.push(...(await pull('cbb', `?dates=${etDate(off)}${CBB}`)).ev);
  } else if (mode === 'nbadays' || mode === 'days') {
    const lg = mode === 'nbadays' ? 'nba' : (u.searchParams.get('lg') ?? 'nba');
    const from = Number(u.searchParams.get('from') ?? -7), to = Number(u.searchParams.get('to') ?? -2);
    for (let off = from; off <= to; off++) all.push(...(await pull(lg, `?dates=${etDate(off)}${lg === 'cbb' ? CBB : ''}`)).ev);
  } else if (mode === 'backfill') {
    const lg = u.searchParams.get('lg') ?? 'nba';
    out.backfilled = await backfill(lg, Number(u.searchParams.get('limit') ?? 150));
  }
  const seen = new Map<string, any>();
  for (const g of all) seen.set(g.id, g);
  out.games = await store([...seen.values()]);
  await sb.from('blobs').upsert({ key: `sync:${mode}`, data: { at: new Date().toISOString(), ...out, ms: Date.now() - t0 }, updated_at: new Date().toISOString() });
  out.ms = Date.now() - t0;
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
