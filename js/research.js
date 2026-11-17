// Systems from published research: each one comes with a reason it should work and a publication year,
// so it can be graded on the seasons after it became public (the honest test) as well as before.

const TZ = (team, season) => {
  if (['SF', 'SEA', 'OAK', 'LV'].includes(team)) return -3;
  if (team === 'LA') return season >= 2016 ? -3 : -1; // Rams moved from St. Louis in 2016
  if (team === 'STL') return -1;
  if (team === 'LAC' || team === 'SD') return -3;
  if (['DEN', 'ARI'].includes(team)) return -2;
  if (['CHI', 'GB', 'MIN', 'KC', 'DAL', 'HOU', 'NO', 'TEN'].includes(team)) return -1;
  return 0; // Eastern
};
const COLD = new Set(['BUF', 'NE', 'NYJ', 'NYG', 'PHI', 'PIT', 'CLE', 'CIN', 'BAL', 'WAS', 'CHI', 'GB', 'KC', 'DEN']);
const WARM_OR_DOME = new Set(['MIA', 'TB', 'JAX', 'HOU', 'NO', 'ATL', 'ARI', 'LA', 'LAC', 'SD', 'SF', 'OAK', 'LV', 'DAL', 'IND', 'DET', 'STL']);
const homeLine = (g) => g.home_spread;
const outdoors = (g) => g.roof === 'outdoors' || g.roof === 'open';

export const RESEARCH = [
  { id: 'r-home-dog', league: 'NFL', kind: 'spread', year: 2004, name: 'Home underdogs',
    cite: 'Levitt (2004), Economic Journal', url: 'https://www.nber.org/papers/w9422',
    why: 'Bettors overvalue favorites and road favorites; books shade the line toward them. Levitt found home dogs covered 53.3% from 1980 to 2001.',
    pick: (g) => homeLine(g) > 0 ? { side: 'home', kind: 'spread' } : null },
  { id: 'r-big-home-dog', league: 'NFL', kind: 'spread', year: 2007, name: 'Home underdogs getting 7 or more',
    cite: 'Borghesi (2007), Applied Economics', url: 'https://econpapers.repec.org/RePEc:taf:applec:v:39:y:2007:i:15:p:1889-1903',
    why: 'The home-dog edge grew as the spread grew.',
    pick: (g) => homeLine(g) >= 7 ? { side: 'home', kind: 'spread' } : null },
  { id: 'r-late-home-dog', league: 'NFL', kind: 'spread', year: 2007, name: 'Home underdogs, week 15 on',
    cite: 'Borghesi (2007), “The late-season bias”', url: 'https://econpapers.repec.org/RePEc:taf:applec:v:39:y:2007:i:15:p:1889-1903',
    why: 'The home-dog bias is concentrated in the final weeks of the season.',
    pick: (g) => homeLine(g) > 0 && g.week >= 15 ? { side: 'home', kind: 'spread' } : null },
  { id: 'r-cold-home', league: 'NFL', kind: 'spread', year: 2007, name: 'Cold-weather home team vs warm or dome visitor, 40°F or colder',
    cite: 'Borghesi (2007), Journal of Economics and Business', url: 'https://econpapers.repec.org/RePEc:eee:jebusi:v:59:y:2007:i:4:p:340-354',
    why: 'Visitors used to warm weather or a dome underperform in the cold more than the line expects.',
    pick: (g) => outdoors(g) && g.temp != null && g.temp <= 40 && COLD.has(g.home) && WARM_OR_DOME.has(g.away) && g.home_spread != null ? { side: 'home', kind: 'spread' } : null },
  { id: 'r-west-night', league: 'NFL', kind: 'spread', year: 2013, name: 'West Coast team vs East Coast team at night',
    cite: 'Smith et al. (2013), SLEEP', url: 'https://aasm.org/circadian-timing-may-give-edge-to-west-coast-nfl-teams-in-night-games/',
    why: 'Kickoff after 8 PM ET is the West Coast team’s late afternoon and the East Coast team’s bedtime. They found 66% ATS from 1970 to 2011.',
    pick: (g) => { if ((g.time || '') < '20:00') return null; const h = TZ(g.home, g.season), a = TZ(g.away, g.season);
      if (h === -3 && a === 0) return { side: 'home', kind: 'spread' }; if (a === -3 && h === 0) return { side: 'away', kind: 'spread' }; return null; } },
  { id: 'r-west-east-travel', league: 'NFL', kind: 'spread', year: 2014, name: 'Home team vs a visitor who flew west to east',
    cite: 'Nichols (2014), Journal of Sports Economics', url: 'https://metatoc.com/papers/9623-the-impact-of-visiting-team-travel-on-game-outcome-and-biases-in-nfl-betting-markets',
    why: 'Visitors crossing time zones eastward lose more than expected; the author warned the bias may be too small to bet.',
    pick: (g) => !g.neutral && TZ(g.away, g.season) < TZ(g.home, g.season) && g.home_spread != null ? { side: 'home', kind: 'spread' } : null },
  { id: 'r-div-road', league: 'NFL', kind: 'spread', year: 2019, name: 'Road team in a division game',
    cite: 'Shank (2019), Studies in Economics and Finance', url: 'https://econpapers.repec.org/RePEc:eme:sefpps:sef-11-2018-0354',
    why: 'Familiarity from playing twice a year shrinks home-field edge more than books assume.',
    pick: (g) => g.div && !g.neutral && g.home_spread != null ? { side: 'away', kind: 'spread' } : null },
  { id: 'r-div-under', league: 'NFL', kind: 'total', year: 2019, name: 'Under in a division game',
    cite: 'Shank (2019), Studies in Economics and Finance', url: 'https://econpapers.repec.org/RePEc:eme:sefpps:sef-11-2018-0354',
    why: 'Division rivals know each other’s schemes, which lowers scoring.',
    pick: (g) => g.div && g.total != null ? { side: 'under', kind: 'total' } : null },
  { id: 'r-high-total-under', league: 'NFL', kind: 'total', year: 2002, name: 'Under when the total is 47.5 or higher',
    cite: 'Paul & Weinbach (2002); later study found 59.7% for 2001–2009, gone by 2010–2018', url: 'https://mobile.aabri.com/manuscripts/193138.pdf',
    why: 'The public loves overs in high-scoring matchups, so books shade big totals up.',
    pick: (g) => g.total != null && g.total >= 47.5 ? { side: 'under', kind: 'total' } : null },
  { id: 'r-wind-under', league: 'NFL', kind: 'total', year: 2008, name: 'Under in 15+ mph wind',
    cite: 'Borghesi (2008), Applied Financial Economics', url: 'https://ideas.repec.org/a/taf/apfiec/v18y2008i12p947-953.html',
    why: 'Wind cuts scoring more than bettors expect.',
    pick: (g) => outdoors(g) && g.wind != null && g.wind >= 15 && g.total != null ? { side: 'under', kind: 'total' } : null },
  { id: 'r-ml-short-dog', league: 'NFL', kind: 'moneyline', year: 2026, name: 'Underdog moneyline when the spread is 3 or less',
    cite: 'Krieger & Shank (2026), Journal of Prediction Markets', url: 'https://www.ubplj.org/index.php/jpm/article/view/2325',
    why: 'Short dogs are priced better on the moneyline than on the spread; they found a 6.55% return.',
    pick: (g) => { const s = g.home_spread; if (s == null || s === 0 || Math.abs(s) > 3) return null; const side = s > 0 ? 'home' : 'away'; return (side === 'home' ? g.home_ml : g.away_ml) ? { side, kind: 'moneyline' } : null; } },
  { id: 'r-ml-mid-dog', league: 'NFL', kind: 'moneyline', year: 2026, name: 'Underdog moneyline when the spread is 3.5 to 7',
    cite: 'Krieger & Shank (2026), Journal of Prediction Markets', url: 'https://www.ubplj.org/index.php/jpm/article/view/2325',
    why: 'Same study: a smaller 2.17% return for dogs of 3.5 to 7.',
    pick: (g) => { const s = g.home_spread; if (s == null || Math.abs(s) <= 3 || Math.abs(s) > 7) return null; const side = s > 0 ? 'home' : 'away'; return (side === 'home' ? g.home_ml : g.away_ml) ? { side, kind: 'moneyline' } : null; } },
  { id: 'r-wong', league: 'NFL', kind: 'teaser', year: 2001, name: 'Wong teaser legs (6 points through 3 and 7)',
    cite: 'Stanford Wong (2001), Sharp Sports Betting', url: 'https://en.wikipedia.org/wiki/Stanford_Wong',
    why: 'NFL margins pile up on 3 and 7. Teasing favorites of 7.5 to 8.5 down, or dogs of 1.5 to 2.5 up, crosses both. A 2-team teaser at −110 needs each leg to win 72.4%.',
    pick: (g) => { const s = g.home_spread; if (s == null) return null;
      if (s <= -7.5 && s >= -8.5) return { side: 'home', kind: 'teaser', tease: 6 }; if (s >= 7.5 && s <= 8.5) return { side: 'away', kind: 'teaser', tease: 6 };
      if (s >= 1.5 && s <= 2.5) return { side: 'home', kind: 'teaser', tease: 6 }; if (s <= -1.5 && s >= -2.5) return { side: 'away', kind: 'teaser', tease: 6 }; return null; } },
  { id: 'r-nba-b2b-home', league: 'NBA', kind: 'spread', year: 2010, name: 'Fade a home team on the 2nd night of a back-to-back (visitor rested)',
    cite: 'Ashman, Bowman & Lambrinos (2010), Journal of Sports Economics', url: 'https://ideas.repec.org/a/sae/jospec/v11y2010i6p602-613.html',
    why: 'Over 19 seasons, tired home teams did poorly against the spread when the visitor had a day or two off.',
    pick: (g) => g.home_rest === 1 && g.away_rest != null && g.away_rest >= 2 && g.home_spread != null ? { side: 'away', kind: 'spread' } : null },
];

// grade a research pick (teasers grade the teased leg)
export function gradeResearch(g, m, gradePick) {
  if (m.kind !== 'teaser') return gradePick(g, m);
  if (!g.final || g.home_spread == null) return null;
  const line = (m.side === 'home' ? g.home_spread : -g.home_spread) + m.tease;
  const d = (m.side === 'home' ? g.home_score - g.away_score : g.away_score - g.home_score) + line;
  return Math.abs(d) < 1e-9 ? 'push' : d > 0 ? 'win' : 'loss';
}
export function researchLabel(g, m, pickLabel) {
  if (m.kind !== 'teaser') return pickLabel(g, m);
  const ln = (m.side === 'home' ? g.home_spread : -g.home_spread) + m.tease;
  return `${m.side === 'home' ? g.home : g.away} ${ln > 0 ? '+' : ''}${ln} (teased)`;
}
export const BREAK_EVEN = { spread: 110 / 210, total: 110 / 210, teaser: Math.sqrt(1 / (1 + 100 / 110)), moneyline: null };

// NBA rest from a season's schedule (days since each team's previous game)
export function nbaGames(rows) {
  const sorted = [...rows].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const last = new Map(); const out = [];
  const day = (iso) => Math.floor((new Date(iso).getTime() - 5 * 3600e3) / 86400e3);
  for (const r of sorted) {
    const d = day(r.start_time);
    const hr = last.has(r.home) ? d - last.get(r.home) : null, ar = last.has(r.away) ? d - last.get(r.away) : null;
    const fin = r.state === 'post' && r.home_score != null;
    const sp = fin ? (r.close_spread_home != null ? Number(r.close_spread_home) : null) : r.spread_home != null ? Number(r.spread_home) : null;
    out.push({ id: r.id, season: 2027, week: 0, date: new Date(r.start_time).toISOString().slice(0, 10), home: r.home, away: r.away, home_score: r.home_score, away_score: r.away_score,
      home_spread: sp, total: fin ? (r.close_total > 0 ? Number(r.close_total) : null) : r.total, home_rest: hr, away_rest: ar, final: fin, live: r });
    last.set(r.home, d); last.set(r.away, d);
  }
  return out;
}
