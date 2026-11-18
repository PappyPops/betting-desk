// Cooking from Scratch: reads every Louisiana Lottery scratch-off still listed for sale and its official prize table
// (printed, claimed, remaining per tier) from louisianalottery.com, and keeps one snapshot per game per day so
// trends can be shown. Runs every 6 hours (see supabase/cron.sql).
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; BettingDesk/1.0; personal research)', 'Accept': 'text/html' };
const BASE = 'https://louisianalottery.com';
const get = async (u: string) => { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${r.status}`); return (await r.text()).replace(/\s+/g, ' '); };
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, ''));
const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#0?39;/g, "'").trim();

function parseList(html: string) {
  const out: any[] = [];
  for (const m of html.matchAll(/<li data-filter-item data-filter-price="(\d+)" data-filter-type="([^"]*)"[^>]*> <a href="(https:\/\/louisianalottery\.com\/game\/[^"]+)"[^>]*>([\s\S]*?)<\/a> <\/li>/g)) {
    const body = m[4];
    const dd = (label: string) => (body.match(new RegExp(`<dt>${label}</dt> <dd>([^<]*)</dd>`)) || [])[1] ?? null;
    out.push({ price: Number(m[1]), types: m[2], url: m[3], img: (body.match(/<img src='([^']+)'/) || [])[1] ?? null, name: strip((body.match(/so-excerpt__title">([^<]*)</) || [])[1] ?? ''),
      num: Number(dd('Game No\\.')), top_prize: dd('Top Prize'), odds_overall: dd('Overall Odds') ? num(String(dd('Overall Odds')).split(':')[1] ?? '') : null });
  }
  return out.filter((g) => g.num);
}

function parseGame(html: string) {
  const table = (html.match(/<table class="table"[\s\S]*?<\/table>/) || [])[0];
  if (!table) return null;
  const tiers = [...table.matchAll(/<tr> <td>([^<]*)<\/td> <td>([^<]*)<\/td> <td>([^<]*)<\/td> <td>([^<]*)<\/td> <td>([^<]*)<\/td> <\/tr>/g)]
    .map((m) => ({ prize: m[1].trim(), odds: num(m[2].split(' in ')[1] ?? ''), total: num(m[3]), claimed: num(m[4]), remaining: num(m[5]) }))
    .filter((t) => t.total > 0);
  const launch = (html.match(/Launch Date: <time datetime="([^"]+)"/) || [])[1] ?? null;
  const upd = (table.match(/Last Updated: ([^<]*)</) || [])[1]?.trim() ?? null;
  return { tiers, launch, upd };
}

Deno.serve(async () => {
  const list = parseList(await get(`${BASE}/scratch-offs/`));
  const out = { listed: list.length, read: 0, failed: [] as number[] };
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(list.slice(i, i + 4).map(async (g) => {
      try {
        const d = parseGame(await get(g.url));
        if (!d || !d.tiers.length) throw new Error('no table');
        await sb.from('lotto_games').upsert({ ...g, launch: d.launch, tiers: d.tiers, source_updated: d.upd, active: true, updated_at: new Date().toISOString() });
        await sb.from('lotto_snaps').upsert({ num: g.num, day, tiers: d.tiers });
        out.read++;
      } catch (_) { out.failed.push(g.num); }
    }));
    await new Promise((r) => setTimeout(r, 400));
  }
  // games no longer listed for sale drop off the board
  if (list.length > 10) await sb.from('lotto_games').update({ active: false }).not('num', 'in', `(${list.map((g) => g.num).join(',')})`);
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
