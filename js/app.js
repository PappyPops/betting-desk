import { lastSync, ago, esc } from './core.js?v=202611171320';

const TOOLS = [
  { id: 'desk', name: 'Today', grp: 'Desk', load: () => import('./desk.js?v=202611171320') },
  { id: 'juice', name: 'The Juice', grp: 'Market', load: () => import('./juice.js?v=202611171320') },
  { id: 'linelife', name: 'Line Life', grp: 'Market', load: () => import('./linelife.js?v=202611171320') },
  { id: 'matrix', name: 'Matrix', grp: 'Models', load: () => import('./matrix.js?v=202611171320') },
  { id: 'tease', name: 'Tease Me', grp: 'Models', load: () => import('./tease.js?v=202611171320') },
  { id: 'paint', name: 'In the Paint', grp: 'Models', load: () => import('./paint.js?v=202611171320') },
  { id: 'redzone', name: 'Redzone', grp: 'Models', load: () => import('./redzone.js?v=202611171320') },
  { id: 'slant', name: 'Slant', grp: 'Models', tag: 'soon', load: () => import('./pending.js?v=202611171320') },
  { id: 'capn', name: "Cap'n Cash", grp: 'Crowd', load: () => import('./capn.js?v=202611171320') },
  { id: 'eye', name: 'Eye in the Sky', grp: 'Watch', load: () => import('./eye.js?v=202611171320') },
];
export const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

const side = document.querySelector('.side');
const main = document.querySelector('.main');
let cleanup = null;

function navHtml(active) {
  let html = '', grp = '';
  for (const t of TOOLS) {
    if (t.grp !== grp) { grp = t.grp; html += `<div class="grp">${esc(grp)}</div>`; }
    html += `<a href="#${t.id}" class="${t.id === active ? 'on' : ''}"><span>${esc(t.name)}</span>${t.tag ? `<span class="tag">${t.tag}</span>` : ''}</a>`;
  }
  return html;
}

async function route() {
  const id = (location.hash || '#desk').slice(1).split('-')[0];
  const tool = toolById[id] ?? toolById.desk;
  side.querySelector('.nav').innerHTML = navHtml(tool.id);
  document.querySelector('.topbar b').textContent = tool.name;
  document.title = `${tool.name} · Betting Desk`;
  closeMenu();
  if (typeof cleanup === 'function') { try { cleanup(); } catch {} }
  cleanup = null;
  main.innerHTML = '<div class="loading">Loading…</div>';
  window.scrollTo(0, 0);
  try {
    const mod = await tool.load();
    cleanup = await mod.render(main, { tool, toolById });
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="err">This page hit a snag: ${esc(e.message)}. Try the refresh button, or come back in a few minutes.</div>`;
  }
}

function closeMenu() { side.classList.remove('open'); document.querySelector('.scrim')?.remove(); }
document.querySelector('.burger').addEventListener('click', () => {
  side.classList.add('open');
  const s = document.createElement('div'); s.className = 'scrim'; s.onclick = closeMenu; document.body.appendChild(s);
});

async function freshness() {
  const el = side.querySelector('.foot');
  try { const d = await lastSync(); el.innerHTML = `Data synced ${ago(d)}<br>Lines: DraftKings via ESPN`; }
  catch { el.textContent = 'Data status unavailable'; }
}

window.addEventListener('hashchange', route);
route();
freshness();
setInterval(freshness, 60_000);
