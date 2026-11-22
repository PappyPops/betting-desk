// NFL player prop lines (DraftKings via ESPN's public odds feed) for Slant and At the Whistle.
// Saves open and current lines for every game in the next 8 days; the last line before kickoff becomes the close.
// Also fills in any athlete the daily players job hasn't mapped yet.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'User-Agent': 'BettingDesk/1.0 (personal research)', 'Accept': 'application/json' };
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
// ESPN prop type id -> our stat key
const TYPES: Record<string, string> = { '8': 'pass_yds', '9': 'pass_cmp', '10': 'pass_td', '11': 'rush_att', '12': 'rush_yds', '13': 'rec_yds', '14': 'rec', '16': 'pass_att', '18': 'pass_rush_yds', '20': 'rush_rec_yds' };
// American odds from an ESPN prop's odds block, wherever it sits (it differs by market)
function american(o: any): number | null {
  if (o === null || o === undefined) return null;
  if (typeof o === 'number') return Number.isFinite(o) && Math.abs(o) >= 100 ? Math.round(o) : null;
  if (typeof o === 'string') { const n = Number(o.replace(/[^0-9+-]/g, '')); return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null; }
  if (typeof o === 'object') { for (const k of ['american', 'value', 'alternateDisplayValue', 'displayValue']) if (k in o) { const v = american(o[k]); if (v !== null) return v; } }
  return null;
}
const j = async (u: string) => { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

Deno.serve(async () => {
  const now = new Date();
  const { data: gs } = await sb.from('games').select('id,start_time,state').eq('league', 'nfl').eq('state', 'pre')
    .gte('start_time', now.toISOString()).lt('start_time', new Date(now.getTime() + 8 * 86400e3).toISOString());
  const out: any = { games: 0, props: 0, athletes: 0, errors: [] as string[] };
  const seenAth = new Set<string>();
  for (const g of gs ?? []) {
    try {
      const rows = new Map<string, any>(), td = new Map<string, any>();
      for (let page = 1; page <= 3; page++) {
        const d = await j(`${CORE}/events/${g.id}/competitions/${g.id}/odds/100/propBets?lang=en&region=us&limit=1000&page=${page}`);
        for (const x of d.items ?? []) {
          // anytime touchdown scorer (type 31): keep the price, for Redzone's round robin
          if (String(x.type?.id) === '31') { const aid = String(x.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1]; const am = american(x.odds) ?? american(x.current?.odds) ?? american(x.current); if (aid) td.set(aid, { game_id: g.id, athlete_id: aid, american: am, raw: { odds: x.odds ?? null, current: x.current ?? null }, updated_at: now.toISOString() }); continue; }
          const stat = TYPES[String(x.type?.id)]; if (!stat) continue;
          const aid = String(x.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1]; if (!aid) continue;
          const cur = Number(x.current?.target?.value), op = Number(x.open?.target?.value);
          if (!Number.isFinite(cur)) continue;
          rows.set(`${aid}|${stat}`, { game_id: g.id, athlete_id: aid, stat, line_now: cur, line_open: Number.isFinite(op) ? op : cur, line_close: cur, updated_at: now.toISOString() });
          seenAth.add(aid);
        }
        if (page >= (d.pageCount ?? 1)) break;
      }
      if (rows.size) { const { error } = await sb.from('props').upsert([...rows.values()]); if (error) out.errors.push(error.message); }
      if (td.size) { const { error } = await sb.from('td_odds').upsert([...td.values()]); if (error) out.errors.push('td ' + error.message); out.td = (out.td ?? 0) + td.size; }
      // injuries and the weather forecast for the game (ESPN game summary)
      try {
        const sum = await j(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${g.id}`);
        const injuries = (sum.injuries ?? []).flatMap((t: any) => (t.injuries ?? []).map((x: any) => ({ id: String(x.athlete?.id ?? ''), name: x.athlete?.displayName, pos: x.athlete?.position?.abbreviation, team: t.team?.abbreviation, status: x.status, detail: x.details?.type ?? null })));
        const w = sum.gameInfo?.weather ?? null;
        await sb.from('game_context').upsert({ game_id: g.id, injuries, weather: w ? { temp: w.temperature ?? null, gust: w.gust ?? null, precip: w.precipitation ?? null, cond: w.conditionId ?? null } : null, venue: sum.gameInfo?.venue?.fullName ?? null, updated_at: now.toISOString() });
      } catch (e) { out.errors.push('ctx ' + String(e).slice(0, 60)); }
      out.games++; out.props += rows.size;
    } catch (e) { out.errors.push(String(e).slice(0, 120)); }
  }
  // athletes we haven't mapped yet: look up name, position, team and headshot from ESPN
  const ids = [...seenAth];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) { const { data } = await sb.from('athletes').select('id').in('id', ids.slice(i, i + 300)); for (const a of data ?? []) known.add(a.id); }
  for (const id of ids.filter((x) => !known.has(x)).slice(0, 60)) {
    try {
      const a = await j(`${CORE}/seasons/${now.getUTCFullYear()}/athletes/${id}?lang=en&region=us`);
      let team = null; try { if (a.team?.$ref) team = (await j(a.team.$ref.replace('http://', 'https://'))).abbreviation; } catch { /* ignore */ }
      await sb.from('athletes').upsert({ id, name: a.displayName, pos: a.position?.abbreviation ?? null, team, headshot: a.headshot?.href ?? null, updated_at: now.toISOString() });
      out.athletes++;
    } catch (e) { out.errors.push(String(e).slice(0, 80)); }
  }
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
