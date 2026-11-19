// Betting Council: Grok, Muse, Gemini and Claude post daily picks, cross-examine each other,
// and the Final Card is what 3 of 4 back. Claude's scheduled tasks copy each day's files and the
// ledger from Google Drive into blobs (council:day:YYYY-MM-DD, council:ledger); this page only reads them.
import { blob, ago } from './core.js?v=202611190035';

const CSS = '.council{\n    --panel:var(--surface); --panel2:var(--surface2); --line:var(--line2);\n    --ink:#e8ecf1; --mute:#8a95a5; --dim:#5d6876;\n    --win:#2fbf71; --loss:#e5484d; --push:#d1a23b; --pend:#5d6876;\n    --grok:#e8ecf1; --muse:#4f8cff; --gemini:#34c3a0; --claude:#d97757; --card:#f5c542;\n  }\n.council .wrap{max-width:1180px;margin:0 auto;padding:18px 16px 40px}\n.council header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between;margin-bottom:16px}\n.council .datebar{display:flex;align-items:center;gap:6px}\n.council button{background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 11px;font:600 13px Inter,sans-serif;cursor:pointer}\n.council button:hover{border-color:var(--mute)}\n.council input[type=date]{background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:500 13px Inter,sans-serif;color-scheme:dark}\n.council .status{font-size:12px;color:var(--mute);min-height:18px;margin:-6px 0 12px}\n.council .status.err{color:var(--loss)}\n.council .records{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}\n.council .rec{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;border-top:3px solid var(--c)}\n.council .rec .who{font:700 15px "Barlow Condensed",sans-serif;text-transform:uppercase;color:var(--c)}\n.council .rec .units{font:700 28px "Barlow Condensed",sans-serif}\n.council .rec .units.pos{color:var(--win)}\n.council .rec .units.neg{color:var(--loss)}\n.council .rec .sub{font-size:12px;color:var(--mute)}\n.council section.final{background:linear-gradient(180deg,#221f12,var(--panel));border:1px solid #4a4020;border-radius:14px;padding:14px 16px;margin-bottom:18px}\n.council section.final h2{font-size:22px;text-transform:uppercase;color:var(--card);margin-bottom:10px}\n.council .finalgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}\n.council .cols{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}\n.council .col{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px;border-top:3px solid var(--c)}\n.council .col h2{font-size:21px;text-transform:uppercase;color:var(--c);display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}\n.council .col h2 small{font:500 12px Inter,sans-serif;color:var(--mute);text-transform:none}\n.council .pick{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:10px;border-left:4px solid var(--rc,var(--pend))}\n.council .pick .top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}\n.council .sel{font:700 19px "Barlow Condensed",sans-serif;line-height:1.15}\n.council .badge{font:700 12px Inter,sans-serif;padding:3px 8px;border-radius:6px;white-space:nowrap;background:var(--rc,var(--pend));color:#0f1216}\n.council .meta{font-size:12px;color:var(--mute);margin-top:3px}\n.council .meta b{color:var(--ink);font-weight:600}\n.council .tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}\n.council .tag{font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--line);color:var(--mute)}\n.council .tag.alt{border-color:var(--push);color:var(--push)}\n.council .tag.fc{border-color:var(--card);color:var(--card)}\n.council .verdicts{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}\n.council .v{font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;cursor:pointer;border:1px solid transparent}\n.council .v.agree{background:#173826;color:var(--win)}\n.council .v.disagree{background:#3a1b1d;color:var(--loss)}\n.council .v.pass{background:#262b33;color:var(--mute)}\n.council details{margin-top:7px}\n.council summary{font-size:12px;color:var(--mute);cursor:pointer}\n.council details p{margin:6px 0 0;font-size:13px;color:#c5ccd6}\n.council .why{font-size:12.5px;color:#c5ccd6;margin-top:6px;padding:7px 9px;background:#14181d;border-radius:7px;display:none}\n.council .why.show{display:block}\n.council .empty{color:var(--dim);font-size:13px;padding:14px 4px;text-align:center}\n.council .changes{font-size:12px;color:var(--mute);margin-top:6px;border-top:1px dashed var(--line);padding-top:8px}\n.council .backed{font-size:12px;color:var(--card);margin-top:5px}\n.council footer{margin-top:22px;font-size:12px;color:var(--dim);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}\n.council footer a{color:var(--mute)}\n.council .gate{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px;display:none}\n@media (max-width:1100px){.council .cols{grid-template-columns:repeat(2,1fr)}.council .records{grid-template-columns:repeat(3,1fr)}}\n@media (max-width:700px){.council .cols{grid-template-columns:1fr}.council .records{grid-template-columns:repeat(2,1fr)}}';
const SCHED_KEY = "__schedule";
const MEMBERS = [
  {key:"Grok",   color:"var(--grok)"},
  {key:"Muse",   color:"var(--muse)"},
  {key:"Gemini", color:"var(--gemini)"},
  {key:"Claude", color:"var(--claude)"},
];

const $ = id => document.getElementById(id);
const ctToday = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago"}).format(new Date());
function shiftDate(d, n){ const t = new Date(d+"T12:00:00Z"); t.setUTCDate(t.getUTCDate()+n); return t.toISOString().slice(0,10); }
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm = s => String(s||"").toLowerCase().replace(/[^a-z0-9.+\-]/g,"");


function slateFor(date, text){
  const line = clean(text||"").split(/\n/).find(l => l.trim().startsWith(date));
  if (!line) return null;
  return /EARLY SLATE/i.test(line) ? "early" : "late";
}
function slateNote(slate, date){
  const today = date === ctToday();
  if (slate === "early") return {
    banner: "Early slate: picks ~8:00 AM, rebuttals ~9:30 AM, Final Card ~10:50 AM, Late Check update ~3:50 PM CT",
    card: today ? "Early slate today. Final Card posts around 10:50 AM CT, with a Late Check update around 3:50 PM." : "No Final Card for this date."};
  if (slate === "late") return {
    banner: "Late slate: picks ~1:00 PM, rebuttals ~2:30 PM, Final Card ~3:50 PM CT",
    card: today ? "Late slate today. Final Card posts around 3:50 PM CT." : "No Final Card for this date."};
  return {banner: "", card: today ? "No council schedule for today yet." : "No Final Card for this date."};
}

// Bots sometimes add Markdown bold/italics (**Sport:** CFB) — strip it before parsing.
const clean = t => String(t||"").replace(/\\([\-~*_#.()\[\]])/g,"$1").replace(/^\s*#{1,6}\s*/gm,"").replace(/\*\*/g,"").replace(/^(\s*)\*(?!\s)(.*?)\*\s*$/gm,"$1$2").replace(/^\s*[-•]\s+/gm,"");
const isPlaceholder = t => !t || (!/PICK\s*\d+/i.test(t) && !/^\s*RE:/im.test(t));

function fields(block){
  const o = {};
  block.split(/\n/).forEach(line=>{
    const m = line.match(/^\s*([A-Za-z][A-Za-z ]{1,20}):\s*(.*)$/);
    if (m) o[m[1].trim().toLowerCase()] = m[2].trim();
  });
  return o;
}
function parsePicks(text){
  text = clean(text);
  if (isPlaceholder(text)) return null;
  const parts = text.split(/^\s*PICK\s*(\d+)\b.*$/im);
  const picks = [];
  for (let i=1;i<parts.length;i+=2){
    const f = fields(parts[i+1]||"");
    picks.push({num:+parts[i], ...f});
  }
  return picks;
}
function parseRebuttal(text){
  text = clean(text);
  if (isPlaceholder(text)) return null;
  const out = {verdicts:[], changes:""};
  const ch = text.match(/CHANGES TO MY CARD:\s*(.*)/i);
  if (ch) out.changes = ch[1].trim();
  const parts = text.split(/^\s*RE:\s*/im).slice(1);
  parts.forEach(p=>{
    const head = p.split(/\n/)[0];
    const hm = head.match(/(Grok|Muse|Gemini|Claude)\s*PICK\s*(\d+)/i);
    const f = fields(p);
    if (hm) out.verdicts.push({target:cap(hm[1]), num:+hm[2], verdict:(f.verdict||"").split(/\s/)[0], why:f.why||"", head:head.trim()});
  });
  return out;
}
function parseLate(text){
  text = clean(text);
  if (!text || !/^\s*RE:/im.test(text)) return {};
  const out = {};
  text.split(/^\s*RE:\s*/im).slice(1).forEach(p=>{
    const m = p.split(/\n/)[0].match(/PICK\s*(\d+)/i);
    const f = fields(p);
    if (m) out[+m[1]] = {action:(f.action||"").toUpperCase(), line:f["new line"]||"", why:f.why||""};
  });
  return out;
}
const cap = s => s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();

function parseLedger(text){
  const rec = {}, acc = {}, rows = [];
  let section = "";
  (text||"").split(/\n/).forEach(line=>{
    const L = line.trim();
    if (/^RECORDS/i.test(L)) section="rec";
    else if (/^REBUTTAL ACCURACY/i.test(L)) section="acc";
    else if (/^DAILY RESULTS/i.test(L) || /^CONTEST/i.test(L)) section="";
    const m = L.match(/^(Grok|Muse|Gemini|Claude|FINAL CARD):\s*(.+)$/i);
    if (m && section==="rec") rec[m[1].toUpperCase()] = m[2];
    if (m && section==="acc") acc[m[1].toUpperCase()] = m[2];
    if (/^\d{4}-\d{2}-\d{2}\s*\|/.test(L)){
      const c = L.split("|").map(s=>s.trim());
      rows.push({date:c[0], member:c[1], pick:c[2], odds:c[3], result:(c[4]||"").toUpperCase(), units:c[5], fc:/^y/i.test(c[6]||"")});
    }
  });
  return {rec, acc, rows};
}
function findResult(rows, date, member, sel){
  const n = norm(sel);
  return rows.find(r => r.date===date && r.member.toLowerCase()===member.toLowerCase() &&
    (norm(r.pick)===n || norm(r.pick).includes(n) || n.includes(norm(r.pick))));
}

/* ---------- rendering ---------- */
const RC = {W:"var(--win)", L:"var(--loss)", P:"var(--push)"};
function rc(res){
  if (!res) return "";
  const x = res.result.trim().toUpperCase();
  if (x==="W"||x==="WIN") return "W";
  if (x==="L"||x==="LOSS") return "L";
  if (x==="P"||x==="PUSH") return "P";
  return "";
}
function badge(res){
  const r = rc(res);
  if (!r) return `<span class="badge" style="--rc:var(--pend)">Pending</span>`;
  const label = r==="W"?"WIN":r==="L"?"LOSS":r==="P"?"PUSH":res.result||"Pending";
  const u = res.units ? ` ${res.units}u` : "";
  return `<span class="badge" style="--rc:${RC[r]||"var(--pend)"}">${esc(label)}${r in RC?esc(u):""}</span>`;
}

function renderRecords(ledger){
  const tiles = [...MEMBERS.map(m=>({key:m.key, label:m.key, color:m.color})), {key:"FINAL CARD", label:"Final Card", color:"var(--card)"}];
  $("records").innerHTML = tiles.map(t=>{
    const raw = ledger.rec[t.key.toUpperCase()] || "0-0-0, 0.00u";
    const um = raw.match(/([+\-]?\d+(\.\d+)?)\s*u/i);
    const units = um ? parseFloat(um[1]) : 0;
    const wl = (raw.match(/\d+-\d+(-\d+)?/)||["0-0-0"])[0];
    const acc = ledger.acc[t.key.toUpperCase()];
    return `<div class="rec" style="--c:${t.color}">
      <div class="who">${esc(t.label)}</div>
      <div class="units ${units>0?"pos":units<0?"neg":""}">${units>0?"+":""}${units.toFixed(2)}u</div>
      <div class="sub">${esc(wl)} W-L-P${acc?` · rebuttals ${esc(acc)}`:""}</div>
    </div>`;
  }).join("");
}

function pickCard(p, member, date, ledger, verdicts, late){
  const res = findResult(ledger.rows, date, member, p.selection);
  const r = rc(res);
  const isAlt = /\bALT\b/i.test(p.bet||"");
  const prop = p.player ? `<div class="meta"><b>${esc(p.player)}</b> · ${esc(p.prop||"")}</div>` : "";
  const vh = verdicts.map((v,i)=>{
    const cls = /^agree/i.test(v.verdict)?"agree":/^disagree/i.test(v.verdict)?"disagree":"pass";
    const id = `w-${member}-${p.num}-${i}`;
    return `<span class="v ${cls}" data-why="${id}">${esc(v.from)}: ${esc(v.verdict||"?")}</span>`;
  }).join("");
  const whys = verdicts.map((v,i)=>`<div class="why" id="w-${member}-${p.num}-${i}"><b>${esc(v.from)}:</b> ${esc(v.why)}</div>`).join("");
  return `<div class="pick" style="--rc:${RC[r]||"var(--pend)"}">
    <div class="top"><div class="sel">${esc(p.selection||"(no selection)")}</div>${badge(res)}</div>
    ${prop}
    <div class="meta">${esc(p.sport||"")} · ${esc(p.game||"")}${p.start?` · ${esc(p.start)}`:""}</div>
    <div class="meta"><b>${esc(p.odds||"")}</b> ${esc(p.book||"")} · ${esc(p.bet||"")} · Conf ${esc(p.confidence||"–")}</div>
    <div class="tags">${late&&late.action?`<span class="tag alt" title="${esc(late.why)}">LATE: ${esc(late.action)}${late.line?" → "+esc(late.line):""}</span>`:""}${isAlt?'<span class="tag alt">ALT line</span>':""}${res&&res.fc?'<span class="tag fc">Final Card</span>':""}</div>
    ${vh?`<div class="verdicts">${vh}</div>${whys}`:""}
    ${p.reasoning?`<details><summary>Reasoning</summary><p>${esc(p.reasoning)}</p></details>`:""}
  </div>`;
}

function render_(date, files, ledger){
  $("slate").textContent = slateNote(slateFor(date, files[SCHED_KEY]), date).banner;
  renderRecords(ledger);
  const picks = {}, rebut = {};
  MEMBERS.forEach(m=>{
    picks[m.key] = parsePicks(files[`${date} ${m.key} Picks`]);
    rebut[m.key] = parseRebuttal(files[`${date} ${m.key} Rebuttal`]);
  });
  // verdicts aimed at each member's picks
  const aimed = {};
  MEMBERS.forEach(m=>{ const rb = rebut[m.key]; if (rb) rb.verdicts.forEach(v=>{ (aimed[v.target+"#"+v.num] ||= []).push({...v, from:m.key}); }); });

  $("cols").innerHTML = MEMBERS.map(m=>{
    const list = picks[m.key];
    const fileExists = (`${date} ${m.key} Picks`) in files;
    let body;
    const late = parseLate(files[`${date} ${m.key} Late Check`]);
    if (list && list.length) body = list.map(p=>pickCard(p, m.key, date, ledger, aimed[m.key+"#"+p.num]||[], late[p.num])).join("");
    else body = `<div class="empty">${fileExists ? "No picks posted yet." : "No file for this date."}</div>`;
    const rb = rebut[m.key];
    const changes = rb && rb.changes ? `<div class="changes">Changes to card: ${esc(rb.changes)}</div>` : "";
    return `<div class="col" style="--c:${m.color}"><h2>${m.key}<small>${list?list.length:0} pick${list&&list.length===1?"":"s"}</small></h2>${body}${changes}</div>`;
  }).join("");

  // A weekend Late Check can revise the card; show the update once it's posted.
  const upd = files[`${date} Final Card Update`];
  const updp = parsePicks(upd);
  const fc = (updp && updp.length) || (upd && /no consensus/i.test(upd)) ? upd : files[`${date} Final Card`];
  const fcp = fc === upd ? updp : parsePicks(fc);
  if (fc === upd) $("slate").textContent = "Updated after the Late Check.";
  if (fcp && fcp.length){
    $("finalgrid").innerHTML = fcp.map(p=>{
      const res = ledger.rows.find(r=>r.date===date && r.fc && norm(r.pick)===norm(p.selection)) ||
                  ledger.rows.find(r=>r.date===date && /final/i.test(r.member) && norm(r.pick)===norm(p.selection));
      const r = rc(res);
      return `<div class="pick" style="--rc:${RC[r]||"var(--card)"}">
        <div class="top"><div class="sel">${esc(p.selection)}</div>${badge(res)}</div>
        <div class="meta">${esc(p.sport||"")} · ${esc(p.game||"")}${p.start?` · ${esc(p.start)}`:""}</div>
        <div class="meta"><b>${esc(p.odds||"")}</b> ${esc(p.book||"")} · ${esc(p.bet||"")}</div>
        ${p["backed by"]?`<div class="backed">Backed by ${esc(p["backed by"])}</div>`:""}
        ${p.case?`<details><summary>Case</summary><p>${esc(p.case)}</p></details>`:""}
      </div>`;
    }).join("");
  } else if (fc && /no consensus/i.test(fc)) {
    $("finalgrid").innerHTML = `<div class="empty">No consensus plays today.</div>`;
  } else {
    $("finalgrid").innerHTML = `<div class="empty">${esc(slateNote(slateFor(date, files[SCHED_KEY]), date).card)}</div>`;
  }
}



document.addEventListener("click", e=>{
  const v = e.target.closest(".council .v"); if (!v) return;
  const w = document.getElementById(v.dataset.why); if (w) w.classList.toggle("show");
});

export async function render(el){
  if (!document.getElementById("council-css")){ const st=document.createElement("style"); st.id="council-css"; st.textContent=CSS; document.head.appendChild(st); }
  el.innerHTML = `<div class="council">
    <div class="row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div class="muted" style="font-size:13px;max-width:560px">Four AIs pick blind, then argue. A bet makes the Final Card when 3 of the 4 back it. Season 1 runs 60 days from Nov 17; most net units wins.</div>
      <div class="datebar"><button id="prev">◀</button><input type="date" id="date"><button id="next">▶</button><button id="today">Today</button></div>
    </div>
    <div class="status" id="status"></div>
    <div class="records" id="records"></div>
    <section class="final" id="final"><h2>Final Card</h2><div class="meta" id="slate" style="margin:-4px 0 10px"></div><div class="finalgrid" id="finalgrid"></div></section>
    <div class="cols" id="cols"></div>
    <div class="muted" style="font-size:12px;margin-top:16px">Flat 1 unit per pick. Results update after the nightly grading. Information only, not betting advice. 21+. 1-800-GAMBLER.</div>
  </div>`;
  let seq = 0;
  async function load(){
    const date = $("date").value, my = ++seq;
    setStatus("Loading " + date + "…");
    try {
      const [day, led, sch] = await Promise.all([blob("council:day:"+date, 60_000), blob("council:ledger", 60_000), blob("council:schedule", 60_000)]);
      if (my !== seq) return;
      const files = Object.assign({}, day?.data?.files || {});
      files[SCHED_KEY] = day?.data?.schedule || sch?.data?.text || "";
      render_(date, files, parseLedger(led?.data?.text || ""));
      setStatus(day ? `Updated ${ago(new Date(day.updated_at))}` : `Nothing posted for ${date} yet.`);
    } catch(e) { if (my===seq) setStatus("Couldn't load the council: " + e.message, true); }
  }
  const go = d => { $("date").value = d; load(); };
  $("prev").onclick = ()=>go(shiftDate($("date").value,-1));
  $("next").onclick = ()=>go(shiftDate($("date").value, 1));
  $("today").onclick = ()=>go(ctToday());
  $("date").onchange = load;
  $("date").value = ctToday();
  await load();
  const t = setInterval(load, 5*60_000);
  return () => clearInterval(t);
}
function setStatus(msg, err){ const s=$("status"); if (s){ s.textContent=msg; s.className="status"+(err?" err":""); } }
