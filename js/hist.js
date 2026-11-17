// NFL history from nflverse (open data): every game since 2002 with the closing spread and total.
import { blob } from './core.js?v=202611162210';

let memo = null;
export async function nflHist() {
  if (memo) return memo;
  const b = await blob('nfl_hist', 6 * 3600_000);
  if (!b) throw new Error('NFL history not loaded yet');
  const { cols, rows, at } = b.data;
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const games = rows.map((r) => {
    const g = {};
    for (const c of cols) g[c] = r[ix[c]];
    g.done = g.home_score !== null && g.away_score !== null;
    g.margin = g.done ? g.home_score - g.away_score : null; // home margin
    g.pts = g.done ? g.home_score + g.away_score : null;
    g.hspread = g.spread_line === null ? null : -g.spread_line; // home spread, negative = home favored
    g.date = g.gameday;
    return g;
  });
  memo = { games, at, byEspn: new Map(games.filter((g) => g.espn).map((g) => [String(g.espn), g])) };
  return memo;
}

// One row per team per game (team perspective), with prior-game context. Used by Matrix and Tease Me.
export function teamRows(games) {
  const sorted = [...games].sort((a, b) => (a.date + (a.gametime || '')).localeCompare(b.date + (b.gametime || '')));
  const last = new Map(); // team -> previous row
  const out = [];
  for (const g of sorted) {
    for (const side of ['home', 'away']) {
      const team = g[side + '_team'], opp = g[(side === 'home' ? 'away' : 'home') + '_team'];
      const spread = g.hspread === null ? null : (side === 'home' ? g.hspread : -g.hspread); // team spread
      const margin = g.margin === null ? null : (side === 'home' ? g.margin : -g.margin);
      const prev = last.get(team + g.season);
      const row = {
        g, side, team, opp, season: g.season, week: g.week, reg: g.game_type === 'REG',
        spread, margin, ats: margin === null || spread === null ? null : margin + spread,
        home: side === 'home' && g.location !== 'Neutral', neutral: g.location === 'Neutral',
        fav: spread !== null && spread < 0, dog: spread !== null && spread > 0,
        rest: side === 'home' ? g.home_rest : g.away_rest, oppRest: side === 'home' ? g.away_rest : g.home_rest,
        div: g.div_game === 1, weekday: g.weekday, hour: g.gametime ? Number(g.gametime.slice(0, 2)) : null,
        roof: g.roof, wind: g.wind, temp: g.temp, total: g.total_line,
        prevAts: prev ? prev.ats : null, prevMargin: prev ? prev.margin : null, prevSpread: prev ? prev.spread : null,
      };
      out.push(row);
      if (g.done) last.set(team + g.season, row);
    }
  }
  return out;
}
