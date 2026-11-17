import { esc, footNote } from './core.js?v=202611162122';

const INFO = {
  juice: {
    what: 'Where the tickets are versus where the money is, and the side the money is on when they split.',
    status: 'Waiting on a data source. The ticket and money split comes from Action Network’s private feed, which this site won’t pull without permission. The public Covers consensus is the likely replacement.',
    keep: 'https://thejuice.grok.me',
    plan: ['Rebuild on a public consensus source', 'Show the real season record of the gold bet next to break-even (52.4% at −110)', 'Test a stricter signal before calling anything a bet'],
  },
  capn: {
    what: 'Handicapper picks stacked by game, with “loud” sides where 3+ handicappers agree.',
    status: 'Waiting on a data source. Need to confirm where the handicapper cards come from and that they’re public.',
    keep: 'https://capncash.grok.me',
    plan: ['Track each handicapper’s record here, graded the same way for everyone', 'Only call a side loud when the handicappers behind it have a winning record'],
  },
  slant: {
    what: 'NFL player props ranked by expected value, plus mismatches when a starter is out.',
    status: 'In progress. Player stats from nflverse are loading; DraftKings prop lines come through ESPN once books post them midweek.',
    keep: 'https://slant.grok.me',
    plan: ['Projections from open nflverse player stats', 'Grade every prop after the game so the EV numbers earn a record'],
  },
  paint: {
    what: 'NBA game totals: a projection before tip and at each quarter break, flagged when it differs from the DraftKings number.',
    status: 'Next up. Lines and live scores are already flowing in; the projection model is being built.',
    keep: 'https://inthepaint.grok.me',
    plan: ['Audit the old record (End 3Q Overs at 55–4 needs checking)', 'Grade every lock against the number available at that moment'],
  },
  redzone: {
    what: 'Anytime-touchdown board: each player’s chance to score.',
    status: 'Next up. Player stats come from open nflverse data.',
    keep: 'https://redzone.grok.me',
    plan: ['Recalibrate: backs hit 36% against a 47% forecast, QBs 21% against 39%', 'Show forecast vs. actual so the percentages stay honest'],
  },
};

export async function render(el, { tool }) {
  const i = INFO[tool.id];
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">Being rebuilt</div><h1>${esc(tool.name)}</h1><p>${esc(i.what)}</p></div></div>
  <div class="card hl"><b>Status</b><p class="muted" style="margin:6px 0 0">${esc(i.status)}</p></div>
  <div class="sec"><h2>What changes in the rebuild</h2><ul class="muted">${i.plan.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
  <div class="sec"><p class="muted">Until then, the Grok version is still at <a href="${i.keep}" target="_blank" rel="noopener">${i.keep.replace('https://', '')}</a>.</p></div>
  ${footNote('')}`;
}
