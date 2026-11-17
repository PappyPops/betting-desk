// In the Paint: at the end of the 1st quarter, halftime and the end of the 3rd, saves DraftKings' live total and
// spread (ESPN provider 200, "DraftKings - Live Odds") with the score at that moment, so break projections can be
// graded against the real number. Runs every minute during NBA hours (see supabase/cron.sql).
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'User-Agent': 'BettingDesk/1.0 (personal research)', 'Accept': 'application/json' };
const num = (s: unknown): number | null => { if (s === null || s === undefined || s === '') return null; const n = Number(String(s).replace(/^[ou]/i, '')); return Number.isFinite(n) ? n : null; };

Deno.serve(async () => {
  const sbd = await (await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard', { headers: H, signal: AbortSignal.timeout(12000) })).json();
  const out: any[] = [];
  for (const ev of sbd.events ?? []) {
    const c = ev.competitions?.[0]; const s = c?.status ?? ev.status; const per = s?.period ?? 0;
    const name = s?.type?.name ?? '';
    const atBreak = name === 'STATUS_HALFTIME' || name === 'STATUS_END_PERIOD' || (name === 'STATUS_IN_PROGRESS' && Number(s?.clock ?? 1) === 0);
    if (!atBreak || per < 1 || per > 3) continue;
    const { data: have } = await sb.from('break_lines').select('espn_id').eq('espn_id', ev.id).eq('period', per).not('live_total', 'is', null);
    if (have?.length) continue;
    const home = c.competitors.find((t: any) => t.homeAway === 'home'), away = c.competitors.find((t: any) => t.homeAway === 'away');
    let row: any = { espn_id: ev.id, period: per, ts: new Date().toISOString(), status: name, home_pts: num(home?.score), away_pts: num(away?.score) };
    try {
      const od = await (await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${ev.id}/competitions/${ev.id}/odds`, { headers: H, signal: AbortSignal.timeout(12000) })).json();
      const lv = (od.items ?? []).find((x: any) => String(x.provider?.id) === '200');
      if (lv) row = { ...row, live_total: num(lv.current?.total?.american) ?? num(lv.overUnder), over_odds: num(lv.current?.over?.american), under_odds: num(lv.current?.under?.american),
        live_spread_home: num(lv.homeTeamOdds?.current?.pointSpread?.american) };
    } catch (e) { row.status += ' (odds error)'; }
    await sb.from('break_lines').upsert(row);
    out.push(row);
  }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
