// Round robin math for anytime-touchdown legs: every subset of winners is enumerated exactly (8 legs = 256 cases),
// so the chance of each outcome and what it pays are exact under the assumption that legs are independent.
export const decOf = (am) => am > 0 ? 1 + am / 100 : 1 + 100 / -am;
export const amOf = (dec) => dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));

// every combination of `k` items from 0..n-1, as bitmasks
function combos(n, k) {
  const out = [];
  const rec = (start, left, mask) => { if (!left) { out.push(mask); return; } for (let i = start; i <= n - left; i++) rec(i + 1, left - 1, mask | (1 << i)); };
  rec(0, k, 0); return out;
}
const bits = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

// legs: [{ p, dec }]; sizes: parlay sizes to bet (e.g. [2] for "by 2s", [1..n] for everything); stake per bet
export function roundRobin(legs, sizes, stake) {
  const n = legs.length;
  const bets = sizes.flatMap((k) => k >= 1 && k <= n ? combos(n, k) : []);
  const payOf = (mask) => bets.reduce((a, b) => (b & mask) === b ? a + stake * [...Array(n).keys()].reduce((x, i) => b & (1 << i) ? x * legs[i].dec : x, 1) : a, 0);
  const byHits = Array.from({ length: n + 1 }, () => ({ prob: 0, pay: 0 }));
  let er = 0;
  for (let w = 0; w < 1 << n; w++) {
    let pr = 1; for (let i = 0; i < n; i++) pr *= w & (1 << i) ? legs[i].p : 1 - legs[i].p;
    const pay = payOf(w), h = byHits[bits(w)];
    h.prob += pr; h.pay += pr * pay; er += pr * pay;
  }
  for (const h of byHits) h.pay = h.prob ? h.pay / h.prob : 0; // average payout given exactly that many hit
  const cost = bets.length * stake;
  return { bets: bets.length, cost, er, ev: er - cost, byHits };
}
