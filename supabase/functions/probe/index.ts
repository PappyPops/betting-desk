// Source inspector for development: fixed list of public pages. ?p= walks embedded JSON (Next.js or ESPN), ?re= returns text around a pattern.
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; BettingDesk/1.0; personal research)', 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8' };
const T: Record<string, string> = {
  pickswise: 'https://www.pickswise.com/nfl/picks/',
  docs: 'https://www.docsports.com/free-picks/nfl/',
  cbs: 'https://www.cbssports.com/nfl/picks/experts/',
  espn_picks: 'https://www.espn.com/nfl/picks',
  espn_props: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401873073/competitions/401873073/odds/100/propBets?lang=en&region=us&limit=50',
  action_props: 'https://www.actionnetwork.com/nfl/props',
  nflv_stats: 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv',
};
function walk(v: any, p: string) { for (const s of p.split('.').filter(Boolean)) { if (s === '*') return Array.isArray(v) ? { len: v.length } : Object.keys(v ?? {}); v = v?.[isNaN(+s) ? s : +s]; } return v; }
function shape(v: any, d = 0): any { if (d > 2) return typeof v; if (Array.isArray(v)) return [`len ${v.length}`, v.length ? shape(v[0], d + 1) : null]; if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v).slice(0, 40)) o[k] = shape(v[k], d + 1); return o; } return v; }
Deno.serve(async (req) => {
  const u = new URL(req.url); const k = u.searchParams.get('k') ?? ''; if (!T[k]) return new Response('unknown', { status: 400 });
  const url = u.searchParams.get('path') ? new URL(u.searchParams.get('path')!, T[k]).toString() : T[k];
  if (new URL(url).host !== new URL(T[k]).host) return new Response('bad host', { status: 400 });
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
  const txt = await r.text();
  const n = Number(u.searchParams.get('n') ?? 6000);
  let out: any;
  const re = u.searchParams.get('re');
  if (re) { const m = [...txt.matchAll(new RegExp(re, 'g'))].slice(0, Number(u.searchParams.get('m') ?? 3)); out = m.map((x) => txt.slice(Math.max(0, x.index! - Number(u.searchParams.get('b') ?? 200)), x.index! + Number(u.searchParams.get('a') ?? 1500))); }
  else {
    let j: any = null;
    const nd = txt.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    const ef = txt.match(/window\['__espnfitt__'\]=(\{[\s\S]*?\});<\/script>/);
    try { j = nd ? JSON.parse(nd[1]) : ef ? JSON.parse(ef[1]) : JSON.parse(txt); } catch { j = null; }
    if (u.searchParams.get('ld')) j = [...txt.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
    const v = walk(j, u.searchParams.get('p') ?? '');
    out = u.searchParams.get('shape') ? shape(v) : v;
  }
  return new Response(JSON.stringify(out).slice(0, n), { headers: { 'content-type': 'application/json' } });
});
