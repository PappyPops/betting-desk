// Action Network public pages → ticket/money splits (The Juice) and expert picks (Cap'n Cash).
// Reads the same JSON the public web pages ship to every visitor; one page per league per run.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; BettingDesk/1.0; personal research)', 'Accept': 'text/html' };
const LG: Record<string, { path: string; espn: string }> = {
  nfl: { path: 'nfl', espn: 'nfl' }, ncaaf: { path: 'ncaaf', espn: 'cfb' }, nba: { path: 'nba', espn: 'nba' },
};
const CONSENSUS = '15', OPEN = '30';

async function nextData(url: string) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const t = await r.text();
  const m = t.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no page data ' + url);
  return JSON.parse(m[1]).props?.pageProps ?? {};
}

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function espnIndex(lg: string) {
  const from = new Date(Date.now() - 10 * 86400e3).toISOString(), to = new Date(Date.now() + 12 * 86400e3).toISOString();
  const { data } = await sb.from('games').select('id,start_time,home,away,data').eq('league', lg).gte('start_time', from).lt('start_time', to);
  return (data ?? []).map((g: any) => ({ id: g.id, t: new Date(g.start_time).getTime(), h: [norm(g.data?.home?.name), norm(g.home), norm(g.data?.home?.nick), norm(g.data?.home?.short)], a: [norm(g.data?.away?.name), norm(g.away), norm(g.data?.away?.nick), norm(g.data?.away?.short)] }));
}
function matchEspn(idx: any[], start: string, home: any, away: any) {
  const t = new Date(start).getTime();
  const hk = [norm(home?.full_name), norm(home?.abbr), norm(home?.display_name)], ak = [norm(away?.full_name), norm(away?.abbr), norm(away?.display_name)];
  let best: any = null, bestScore = 0;
  for (const g of idx) {
    if (Math.abs(g.t - t) > 6 * 3600e3) continue;
    const s = (g.h[0] && g.h[0] === hk[0] ? 3 : 0) + (g.a[0] && g.a[0] === ak[0] ? 3 : 0) + (g.h.includes(hk[1]) ? 1 : 0) + (g.a.includes(ak[1]) ? 1 : 0) + (g.h.includes(hk[2]) ? 1 : 0) + (g.a.includes(ak[2]) ? 1 : 0);
    if (s > bestScore) { bestScore = s; best = g; }
  }
  return bestScore >= 2 ? best.id : null;
}

function side(list: any[], s: string) { return (list ?? []).find((o: any) => o.side === s) ?? null; }
function readMarkets(g: any) {
  const c = g.markets?.[CONSENSUS]?.event ?? {}, o = g.markets?.[OPEN]?.event ?? {};
  const pack = (x: any) => x ? { v: x.value ?? null, o: x.odds ?? null, t: x.bet_info?.tickets?.percent ?? null, m: x.bet_info?.money?.percent ?? null } : null;
  const op = (x: any) => x ? { v: x.value ?? null, o: x.odds ?? null } : null;
  return {
    sp: { a: pack(side(c.spread, 'away')), h: pack(side(c.spread, 'home')), oa: op(side(o.spread, 'away')), oh: op(side(o.spread, 'home')) },
    tot: { a: pack(side(c.total, 'over')), h: pack(side(c.total, 'under')), oa: op(side(o.total, 'over')), oh: op(side(o.total, 'under')) },
    ml: { a: pack(side(c.moneyline, 'away')), h: pack(side(c.moneyline, 'home')), oa: op(side(o.moneyline, 'away')), oh: op(side(o.moneyline, 'home')) },
  };
}
const noVig = (a: number | null, b: number | null) => {
  if (a === null || b === null) return null;
  const p = (x: number) => x > 0 ? 100 / (x + 100) : -x / (-x + 100);
  const pa = p(a), pb = p(b); return pa / (pa + pb);
};

// The read: money at least 15 points away from tickets, or a line that moved hard against a lopsided public.
function signals(mk: any) {
  const out: any[] = [];
  for (const key of ['sp', 'tot', 'ml']) {
    const m = mk[key]; if (!m?.a || !m?.h) continue;
    for (const s of ['a', 'h']) {
      const me = m[s], op = m[s === 'a' ? 'h' : 'a'];
      if (me.t === null || me.m === null || (me.t === 0 && me.m === 0)) continue;
      const gap = me.m - me.t;
      // line movement toward this side since the open
      let moved = 0;
      const o = m['o' + s];
      if (o && o.v !== null && me.v !== null) {
        if (key === 'sp') moved = o.v - me.v; // more negative now = market moved toward this side
        if (key === 'tot') moved = s === 'a' ? me.v - o.v : o.v - me.v; // over: total up; under: total down
      }
      if (key === 'ml' && o && o.o !== null && me.o !== null) moved = (o.o - me.o) / 20; // price shortened
      const rlm = moved >= 1 && op.t !== null && op.t >= 65;
      if (gap < 15 && !rlm) continue;
      // Moneyline money skews to favorites because favorite bets are bigger, so only read near-even prices.
      if (key === 'ml' && (me.o === null || me.o < -200 || me.o > 250)) continue;
      const conf = Math.max(1, Math.min(95, Math.round(40 + gap * 1.2 + (rlm ? 12 : 0))));
      const chance = noVig(me.o, op.o);
      out.push({ market: key, side: s, line: me.v, odds: me.o, tix: me.t, money: me.m, gap, rlm, moved, conf, chance });
    }
  }
  out.sort((x, y) => y.conf - x.conf);
  return out;
}

async function doSplits() {
  const res: Record<string, number> = {};
  for (const [lg, cfg] of Object.entries(LG)) {
    try {
      const pp = await nextData(`https://www.actionnetwork.com/${cfg.path}/public-betting`);
      const gs = pp.scoreboardResponse?.games ?? [];
      const idx = await espnIndex(cfg.espn);
      const ids = gs.map((g: any) => g.id);
      const { data: prevRows } = await sb.from('splits_latest').select('action_id,data').in('action_id', ids.length ? ids : [0]);
      const prev = new Map((prevRows ?? []).map((r: any) => [r.action_id, r.data]));
      const latest: any[] = [], hist: any[] = [], bets: any[] = [];
      for (const g of gs) {
        const home = g.teams?.find((t: any) => t.id === g.home_team_id), away = g.teams?.find((t: any) => t.id === g.away_team_id);
        const mk = readMarkets(g);
        const espn = matchEspn(idx, g.start_time, home, away);
        const pre = g.status === 'scheduled';
        const sig = pre ? signals(mk) : (prev.get(g.id)?.sig ?? []);
        const p = prev.get(g.id);
        // flips: majority tickets or majority money changed sides since the last reading
        const flips: string[] = [];
        if (p?.mk) for (const k of ['sp', 'tot', 'ml']) {
          const was = p.mk[k], now = mk[k];
          if (!was?.a || !now?.a || was.a.t === null || now.a.t === null) continue;
          const maj = (x: any, f: 't' | 'm') => x.a[f] > 50 ? 'a' : x.a[f] < 50 ? 'h' : null;
          if (maj(was, 't') && maj(now, 't') && maj(was, 't') !== maj(now, 't')) flips.push(`${k}:tickets`);
          if (maj(was, 'm') && maj(now, 'm') && maj(was, 'm') !== maj(now, 'm')) flips.push(`${k}:money`);
        }
        const flipLog = [...(p?.flipLog ?? []), ...flips.map((f) => ({ f, at: new Date().toISOString() }))].slice(-20);
        const data = {
          status: g.status, display: g.status_display, week: g.week ?? null, num_bets: g.num_bets ?? null,
          home: home && { id: home.id, abbr: home.abbr, name: home.full_name, nick: home.display_name, logo: home.logo },
          away: away && { id: away.id, abbr: away.abbr, name: away.full_name, nick: away.display_name, logo: away.logo },
          score: g.boxscore ? { h: g.boxscore.total_home_points ?? null, a: g.boxscore.total_away_points ?? null, clock: g.boxscore.clock ?? null, period: g.boxscore.period ?? null } : null,
          mk, sig, flipLog,
        };
        latest.push({ action_id: g.id, league: cfg.espn, espn_id: espn, start_time: g.start_time, status: g.status, num_bets: g.num_bets ?? null, data, updated_at: new Date().toISOString() });
        if (pre && (!p || JSON.stringify(p.mk) !== JSON.stringify(mk))) hist.push({ action_id: g.id, league: cfg.espn, data: mk, flips });
        if (pre) {
          sig.forEach((s: any, i: number) => {
            const t = s.market === 'tot' ? (s.side === 'a' ? 'Over' : 'Under') : (s.side === 'a' ? away?.abbr : home?.abbr);
            bets.push({ action_id: g.id, market: s.market, league: cfg.espn, espn_id: espn, start_time: g.start_time, side: s.side, team: t, line: s.line, odds: s.odds, tix: s.tix, money: s.money, gap: s.gap, rlm: s.rlm, conf: s.conf, chance: s.chance, is_top: i === 0, locked: false, updated_at: new Date().toISOString() });
          });
        }
      }
      if (latest.length) await sb.from('splits_latest').upsert(latest);
      if (hist.length) await sb.from('splits_hist').insert(hist);
      // a pregame signal that disappears before kickoff is removed; once a game starts its last read stays
      const preIds = gs.filter((g: any) => g.status === 'scheduled').map((g: any) => g.id);
      if (preIds.length) await sb.from('juice_bets').delete().in('action_id', preIds).eq('locked', false);
      if (bets.length) await sb.from('juice_bets').upsert(bets);
      const started = gs.filter((g: any) => g.status !== 'scheduled').map((g: any) => g.id);
      if (started.length) await sb.from('juice_bets').update({ locked: true }).in('action_id', started).eq('locked', false);
      res[lg] = latest.length;
    } catch (e) { console.error(lg, String(e)); res[lg] = -1; }
  }
  return res;
}

async function doExperts() {
  const res: Record<string, number> = {};
  for (const [lg, cfg] of Object.entries(LG)) {
    try {
      const pp = await nextData(`https://www.actionnetwork.com/${cfg.path}/picks`);
      const profiles = pp.initialExpertsResponse?.response?.profiles ?? [];
      const idx = await espnIndex(cfg.espn);
      const ex: any[] = [], picks: any[] = [];
      for (const p of profiles) {
        ex.push({ id: p.id, name: p.name, username: p.username, followers: p.followers ?? null, record: p.record ?? null, updated_at: new Date().toISOString() });
        for (const k of p.picks ?? []) {
          if (k.player_id) continue; // props live in Slant
          const g = k.game ?? {};
          const home = g.teams?.find((t: any) => t.id === g.home_team_id), away = g.teams?.find((t: any) => t.id === g.away_team_id);
          const sideTeam = k.side_id ?? null;
          const s = ['over', 'under'].includes(k.type) ? k.type : /_home$/.test(k.type) ? 'home' : /_away$/.test(k.type) ? 'away' : sideTeam === g.home_team_id ? 'home' : sideTeam === g.away_team_id ? 'away' : null;
          picks.push({
            id: k.id, expert_id: p.id, league: cfg.espn, action_game_id: k.game_id, espn_id: g.start_time ? matchEspn(idx, g.start_time, home, away) : null,
            type: k.type, play: k.play, value: k.value, odds: k.odds, units: k.units, units_net: k.units_net, result: k.result, status: k.status,
            starts_at: k.starts_at, created_at: k.created_at, team_id: sideTeam, side: s, updated_at: new Date().toISOString(),
          });
        }
      }
      if (ex.length) await sb.from('experts').upsert(ex);
      if (picks.length) await sb.from('expert_picks').upsert(picks);
      res[lg] = picks.length;
    } catch (e) { console.error(lg, String(e)); res[lg] = -1; }
  }
  return res;
}

Deno.serve(async (req) => {
  const mode = new URL(req.url).searchParams.get('mode') ?? 'splits';
  const t0 = Date.now();
  const out = mode === 'experts' ? await doExperts() : await doSplits();
  await sb.from('blobs').upsert({ key: `action:${mode}`, data: { at: new Date().toISOString(), out, ms: Date.now() - t0 }, updated_at: new Date().toISOString() });
  return new Response(JSON.stringify({ mode, out, ms: Date.now() - t0 }), { headers: { 'content-type': 'application/json' } });
});
