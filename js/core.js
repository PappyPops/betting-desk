// Shared plumbing: data access, formatting, small DOM helpers.
export const SB_URL = 'https://itjzenhpkxmlvjokwfrd.supabase.co';
export const SB_KEY = 'sb_publishable_iW4n0LsySCpRofMEsyo1MQ_ClfZ9zet'; // public read-only key (row-level security allows reads only)

const cache = new Map();
export async function api(path, { ttl = 60_000 } = {}) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY } });
  if (!r.ok) throw new Error(`Data request failed (${r.status})`);
  const v = await r.json();
  cache.set(path, { t: Date.now(), v });
  return v;
}
export function clearCache() { cache.clear(); }

export async function blob(key, ttl = 30 * 60_000) {
  const rows = await api(`blobs?key=eq.${encodeURIComponent(key)}&select=data,updated_at`, { ttl });
  return rows[0] ?? null;
}

const GAME_COLS = 'id,league,season,week,start_time,state,home,away,home_score,away_score,open_spread_home,open_total,open_ml_home,open_ml_away,spread_home,total,ml_home,ml_away,close_spread_home,close_total,close_ml_home,close_ml_away,updated_at,data';
export async function games({ league, from, to, extra = '' , ttl = 60_000}) {
  let q = `games?select=${GAME_COLS}&league=eq.${league}&order=start_time.asc`;
  if (from) q += `&start_time=gte.${encodeURIComponent(from)}`;
  if (to) q += `&start_time=lt.${encodeURIComponent(to)}`;
  return api(q + extra, { ttl });
}
export async function lastSync() {
  const b = await blob('sync:live', 30_000);
  return b?.data?.at ? new Date(b.data.at) : null;
}

// ---------- formatting ----------
export const TZS = { ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', PT: 'America/Los_Angeles', Local: undefined };
export function tzPref() { return store.get('tz', 'CT'); }
export function fmtTime(iso, opts = {}) {
  const tz = TZS[opts.tz ?? tzPref()];
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', ...(opts.f || {}) }).format(new Date(iso));
}
export function fmtDay(iso, opts = {}) {
  const tz = TZS[opts.tz ?? tzPref()];
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
}
export function dayKey(iso, tzName) {
  const tz = TZS[tzName ?? tzPref()];
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export function ago(d) {
  if (!d) return 'never';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}
export const sgn = (n, d = 1) => n === null || n === undefined || Number.isNaN(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d).replace(/\.0$/, '');
export const line = (n) => n === null || n === undefined ? '—' : n === 0 ? 'PK' : sgn(n);
export const odds = (n) => n === null || n === undefined ? '—' : n > 0 ? `+${n}` : `−${Math.abs(n)}`;
export const pct = (x, d = 0) => x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`;
export const decOdds = (a) => a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
export const impProb = (a) => a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
export function rec(w, l, p = 0) { return p ? `${w}–${l}–${p}` : `${w}–${l}`; }
export const unitsAt110 = (w, l) => w * (100 / 110) - l;

// ---------- DOM ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }
export function logo(t, size = 22) {
  if (!t?.logo) return `<span class="logo" style="width:${size}px;height:${size}px"></span>`;
  return `<img class="logo" style="width:${size}px;height:${size}px" src="${esc(t.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
}
export function teamCell(t, { rank = true, nick = false } = {}) {
  const label = nick ? (t.nick || t.short) : (t.short || t.abbr);
  return `<span class="team">${logo(t)}<span>${rank && t.rank ? `<span class="dim">${t.rank}</span> ` : ''}${esc(label)}</span></span>`;
}
export function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 1800);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy blocked by the browser'); }
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem('bd:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bd:' + k, JSON.stringify(v)); } catch {} },
};

export function seg(name, options, current) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(v) === String(current) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
export function onSeg(root, name, fn) {
  root.querySelector(`[data-seg="${name}"]`)?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (b) fn(b.dataset.v);
  });
}
export function howTo(title, bodyHtml, key) {
  const open = store.get('how:' + key, true);
  return `<details class="how" data-how="${key}" ${open ? 'open' : ''}><summary>${esc(title)}</summary>${bodyHtml}</details>`;
}
export function wireHow(root) {
  root.querySelectorAll('details.how').forEach((d) => d.addEventListener('toggle', () => store.set('how:' + d.dataset.how, d.open)));
}
export function footNote(html) { return `<div class="foot-note">${html} Information only, not a sportsbook. 21+. Gambling problem? Call 1-800-GAMBLER.</div>`; }

// Normal CDF
export function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
