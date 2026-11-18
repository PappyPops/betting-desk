// At the Whistle: at the end of Q1, halftime and the end of Q3 of every NFL game, saves the box score so far and
// DraftKings' live player props (ESPN provider 200) at that moment. When a game ends, saves the final box (period 4)
// so every ticket can be graded. Runs every minute during NFL hours (see supabase/cron.sql).
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'User-Agent': 'BettingDesk/1.0 (personal research)', 'Accept': 'application/json' };
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const j = async (u: string) => { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function parseBox(sum: any) {
  const out: Record<string, any> = {};
  for (const t of sum?.boxscore?.players ?? []) {
    const team = t.team?.abbreviation;
    for (const c of t.statistics ?? []) {
      const k = c.keys ?? [];
      for (const a of c.athletes ?? []) {
        const id = String(a.athlete?.id ?? ''); if (!id) continue;
        const p = out[id] ??= { id, name: a.athlete?.displayName, team };
        const v = (key: string) => a.stats?.[k.indexOf(key)];
        if (c.name === 'passing') { const [cmp, att] = String(v('completions/passingAttempts') ?? '0/0').split('/'); Object.assign(p, { pass_cmp: n(cmp), pass_att: n(att), pass_yds: n(v('passingYards')), pass_td: n(v('passingTouchdowns')), pass_int: n(v('interceptions')) }); }
        if (c.name === 'rushing') Object.assign(p, { rush_att: n(v('rushingAttempts')), rush_yds: n(v('rushingYards')), rush_td: n(v('rushingTouchdowns')), rush_long: n(v('longRushing')) });
        if (c.name === 'receiving') Object.assign(p, { rec: n(v('receptions')), rec_yds: n(v('receivingYards')), rec_td: n(v('receivingTouchdowns')), rec_long: n(v('longReception')), tgt: n(v('receivingTargets')) });
      }
    }
  }
  return out;
}

async function liveProps(id: string) {
  const items: any[] = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const d = await j(`${CORE}/events/${id}/competitions/${id}/odds/200/propBets?lang=en&region=us&limit=1000&page=${page}`);
      for (const x of d.items ?? []) items.push({ aid: String(x.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1] ?? null, tid: x.type?.id, type: x.type?.name, cur: x.current ?? null, odds: x.odds ?? null, at: x.lastUpdated });
      if (page >= (d.pageCount ?? 1)) break;
    }
  } catch (e) { items.push({ error: String(e).slice(0, 80) }); }
  return items;
}

Deno.serve(async () => {
  const sbd = await j('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  const done: any[] = [];
  for (const ev of sbd.events ?? []) {
    const c = ev.competitions?.[0]; const s = c?.status ?? ev.status; const name = s?.type?.name ?? '';
    const atBreak = (name === 'STATUS_HALFTIME' || name === 'STATUS_END_PERIOD') && s.period >= 1 && s.period <= 3;
    const final = s?.type?.state === 'post';
    if (!atBreak && !final) continue;
    const period = final ? 4 : s.period;
    if (final && Date.now() - new Date(ev.date).getTime() > 2 * 86400e3) continue;
    const { data: have } = await sb.from('whistle_snaps').select('period').eq('game_id', ev.id).eq('period', period);
    if (have?.length) continue;
    const home = c.competitors.find((t: any) => t.homeAway === 'home'), away = c.competitors.find((t: any) => t.homeAway === 'away');
    const sum = await j(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${ev.id}`);
    const row = { game_id: ev.id, period, ts: new Date().toISOString(), home_pts: n(home?.score), away_pts: n(away?.score), box: parseBox(sum), live: final ? null : await liveProps(ev.id) };
    await sb.from('whistle_snaps').upsert(row);
    done.push({ id: ev.id, period, players: Object.keys(row.box).length, live: row.live?.length ?? 0 });
  }
  return new Response(JSON.stringify(done), { headers: { 'content-type': 'application/json' } });
});
