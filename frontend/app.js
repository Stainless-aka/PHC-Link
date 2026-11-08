/* PHC Link prototype: health worker app + officer dashboard. Demo data only. */
const ITEMS = [
  { id: "act", n: "ACT (malaria treatment)", min: 20, ic: "pill" },
  { id: "ors", n: "ORS sachets", min: 30, ic: "drop" },
  { id: "amx", n: "Amoxicillin", min: 15, ic: "pill" },
  { id: "rdt", n: "Malaria test kits", min: 20, ic: "test" },
  { id: "zn", n: "Zinc tablets", min: 20, ic: "pill" },
  { id: "glv", n: "Gloves (boxes)", min: 5, ic: "shield" }
];
const mk = (id, name, area, x, y, sync, v) => ({ id, name, area, x, y, sync, items: Object.fromEntries(ITEMS.map((t, i) => [t.id, v[i]])) });
const server = [
  mk(0, "Kuje PHC", "Kuje", 150, 230, "Just now", [18, 40, 6, 0, 25, 12]),
  mk(1, "Bwari PHC", "Bwari", 250, 60, "2 hours ago", [55, 12, 30, 25, 40, 8]),
  mk(2, "Gwagwalada PHC", "Gwagwalada", 120, 150, "5 hours ago", [0, 0, 22, 30, 5, 3]),
  mk(3, "Abaji PHC", "Abaji", 60, 262, "3 days ago", [40, 35, 18, 22, 10, 6]),
  mk(4, "Kwali PHC", "Kwali", 70, 200, "Yesterday", [40, 35, 18, 22, 30, 6]),
  mk(5, "Karshi PHC", "AMAC", 290, 130, "1 hour ago", [33, 50, 20, 26, 31, 9])
];
const refs = [
  { id: 1, who: "F, 28", why: "Obstetric emergency", to: "Gwagwalada General Hospital", urg: "Urgent", st: "Arrived", fac: "Kuje PHC" },
  { id: 2, who: "M, 4", why: "Severe malaria", to: "Gwagwalada General Hospital", urg: "Urgent", st: "Sent", fac: "Kuje PHC" },
  { id: 3, who: "F, 61", why: "Hypertension review", to: "Bwari General Hospital", urg: "Routine", st: "Arrived", fac: "Bwari PHC" },
  { id: 4, who: "M, 9", why: "Fracture", to: "Kuje General Hospital", urg: "Urgent", st: "Sent", fac: "Abaji PHC" },
  { id: 5, who: "F, 2", why: "Dehydration", to: "Kuje General Hospital", urg: "Urgent", st: "Arrived", fac: "Kwali PHC" },
  { id: 6, who: "M, 35", why: "Suspected TB", to: "Gwagwalada General Hospital", urg: "Routine", st: "Arrived", fac: "Karshi PHC" }
];
let local = { ...server[0].items };
let queue = 0;
const PAGE = document.body.dataset.page || "home";
const S = { view: "app", screen: PAGE, online: true, form: new URLSearchParams(location.search).get("new") === "1", sel: 0, lang: "en", u: { step: "idle", out: "", item: null, age: null, msgs: [] } };
try { const saved = JSON.parse(sessionStorage.getItem("phc-link-demo-state") || "null"); if (saved) { if (saved.local) local = { ...local, ...saved.local }; if (Number.isFinite(saved.queue)) queue = saved.queue; if (Array.isArray(saved.refs)) refs.splice(0, refs.length, ...saved.refs); if (Array.isArray(saved.server)) saved.server.forEach((f, i) => { if (server[i]) Object.assign(server[i], f); }); if (saved.u) S.u = { ...S.u, ...saved.u }; if (typeof saved.online === "boolean") S.online = saved.online; if (saved.lang) S.lang = saved.lang; } } catch (error) { console.warn("Demo state could not be restored.", error); }

const H = {
  "Home": "Gida", "Stock": "Kayan magani", "Referrals": "Turawa", "USSD": "USSD",
  "Online": "Kan layi", "Offline": "Ba layi", "waiting": "a jira", "Sync now": "Aika yanzu",
  "Everything is synced": "Komai ya hadu", "Working offline": "Ana aiki ba layi",
  "No signal. You can keep working. Changes save on this phone.": "Babu hanyar sadarwa. Kuna iya ci gaba da aiki. Ana ajiye canje-canje a wayarku.",
  "Good morning, Nurse Amina": "Barka da safe, Nas Amina", "All stock levels look healthy.": "Duk kayan magani suna nan lafiya.",
  "Items tracked": "Kayan da ake bibiya", "Low": "Kadan", "Out": "Ya kare", "OK": "Lafiya", "Needs attention": "Na bukatar kulawa",
  "Count stock": "Kidaya kayan magani", "Refer a patient": "Tura majiyyaci",
  "Today\u2019s stock count": "Kidayar kayan magani na yau", "Tap + or \u2212 to match what is on the shelf.": "Danna + ko \u2212 don dacewa da abin da ke kan shiryayye.",
  "Save stock count": "Ajiye kidayar", "New referral": "Sabon turawa", "Patient age and sex": "Shekaru da jinsin majiyyaci",
  "Reason": "Dalili", "Send to": "Tura zuwa", "Urgency": "Matakin gaggawa", "Urgent": "Gaggawa", "Routine": "Na yau da kullum",
  "Send referral": "Tura yanzu", "Cancel": "Soke",
  "Only age and sex are collected in this demo. No names, to protect patient privacy.": "A wannan samfurin ana tattara shekaru da jinsi kawai. Ba sunaye, don kare sirrin majiyyaci.",
  "Referrals from Kuje PHC": "Turawa daga Kuje PHC", "Mark arrived": "Alama: ya isa",
  "Sent": "An tura", "Arrived": "Ya isa", "Queued": "A jira",
  "ACT (malaria treatment)": "ACT (maganin zazzabin cizon sauro)", "ORS sachets": "Jakunkunan ORS", "Malaria test kits": "Kayan gwajin zazzabin cizon sauro",
  "Zinc tablets": "Kwayoyin Zinc", "Gloves (boxes)": "Safar hannu (akwatuna)",
  "Severe malaria": "Zazzabin cizon sauro mai tsanani", "Obstetric emergency": "Gaggawar haihuwa", "Fracture": "Karyewar kashi",
  "Dehydration": "Rashin ruwa a jiki", "Hypertension review": "Duba hawan jini", "Suspected TB": "Zargin tarin fuka", "Urgent referral": "Turawar gaggawa",
  "Stock count saved and synced": "An ajiye kidayar kuma an aika", "Saved on this phone. Will sync when online.": "An ajiye a wayar. Za a aika idan layi ya dawo.",
  "Referral sent. Receiving facility notified by SMS.": "An tura. An sanar da asibitin ta SMS.", "Referral queued. It will send when online.": "An saka a jerin jira. Za a tura idan layi ya dawo.",
  "Add patient age and sex first": "Da farko a sa shekaru da jinsi", "Marked as arrived": "An yi alamar ya isa",
  "Synced. Officers can now see your update.": "An aika. Jami\u2019ai za su iya ganin sabuntawar ku.", "Go online to sync": "Koma kan layi domin aikawa",
  "Back online. Tap Sync now to upload.": "Layi ya dawo. Danna Aika yanzu.",
  "USSD and SMS fallback": "Layin USSD da SMS", "Works on any phone, no data needed.": "Yana aiki a kowace waya, ba sai da data ba.",
  "Dial": "Kira", "Send": "Aika", "Or send an SMS": "Ko ka aika SMS", "Messages": "Sakonni", "Send SMS": "Aika SMS", "Reply": "Amsa",
  "Report stock": "Bayar da rahoton kayan magani", "Refer patient": "Tura majiyyaci", "Stock alerts": "Gargadin karancin kaya", "Exit": "Fita",
  "Session ended.": "An kammala.", "Choose item": "Zabi kaya", "Patient age and sex, e.g. F34": "Shekaru da jinsi, misali F34",
  "Enter quantity left:": "Shigar da adadin da ya rage:", "Saved": "An ajiye", "Enter a number": "Shigar da lamba",
  "Referral sent": "An tura majiyyaci", "Invalid choice": "Zabin bai dace ba", "No alerts": "Babu gargadi", "Format": "Tsari"
};
const tr = s => (S.lang === "ha" && H[s]) || s;
const ic = (n, c = "") => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const lab = { ok: "OK", low: "Low", out: "Out" };
const st = (q, m) => (q <= 0 ? "out" : q < m ? "low" : "ok");
const fst = f => { let o = 0, l = 0; ITEMS.forEach(t => { const s = st(f.items[t.id], t.min); if (s === "out") o++; if (s === "low") l++; }); return { o, l, s: o ? "out" : l ? "low" : "ok" }; };
const pill = s => `<span class="pill ${s}">${tr(lab[s])}</span>`;
const rpill = s => `<span class="pill ${s === "Arrived" ? "ok" : s === "Queued" ? "q" : "low"}">${tr(s)}</span>`;
const COL = { ok: "var(--ok)", low: "var(--low)", out: "var(--out)" };

function toast(m) {
  const t = document.getElementById("toast");
  t.textContent = tr(m); t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
}
function setView(v) {
  S.view = v;
  document.getElementById("vApp").setAttribute("aria-pressed", v === "app");
  document.getElementById("vDash").setAttribute("aria-pressed", v === "dash");
  render();
}
const go = (s, isNew = false) => { const pages = { home: "index.html", stock: "stock.html", ref: "referrals.html", ussd: "ussd.html" }; const target = pages[s]; if (target) location.href = target + (isNew ? "?new=1" : ""); };
const setLang = l => { S.lang = l; render(); };
function toggleNet() { S.online = !S.online; if (S.online && (queue || refs.some(r => r.st === "Queued"))) toast("Back online. Tap Sync now to upload."); render(); }
function sync() { server[0].items = { ...local }; server[0].sync = "Just now"; refs.forEach(r => { if (r.st === "Queued") r.st = "Sent"; }); queue = 0; toast("Synced. Officers can now see your update."); render(); }
const adj = (id, d) => { local[id] = Math.max(0, local[id] + d); render(); };
function save() {
  if (S.online) { server[0].items = { ...local }; server[0].sync = "Just now"; toast("Stock count saved and synced"); }
  else { queue++; toast("Saved on this phone. Will sync when online."); }
  render();
}
function addRef() {
  const g = k => document.getElementById(k).value;
  if (!g("rw").trim()) { toast("Add patient age and sex first"); return; }
  refs.unshift({ id: Date.now(), who: g("rw"), why: g("rr"), to: g("rt"), urg: g("ru"), st: S.online ? "Sent" : "Queued", fac: "Kuje PHC" });
  S.form = false;
  toast(S.online ? "Referral sent. Receiving facility notified by SMS." : "Referral queued. It will send when online.");
  render();
}
function arrive(id) { refs.find(x => x.id === id).st = "Arrived"; toast("Marked as arrived"); render(); }
const sms = n => toast("SMS alert sent to " + n + " LGA health officer (simulated)");
const selF = i => { S.sel = i; render(); };

/* USSD + SMS simulator */
const UM = () => "PHC Link\n1. " + tr("Report stock") + "\n2. " + tr("Refer patient") + "\n3. " + tr("Stock alerts") + "\n0. " + tr("Exit");
function focusU() { setTimeout(() => { const e = document.getElementById("ui"); if (e) e.focus(); }); }
function dial() { S.u.step = "menu"; S.u.out = UM(); render(); focusU(); }
function uSend() {
  const el = document.getElementById("ui"), v = el.value.trim(), u = S.u;
  if (u.step === "idle") return;
  if (v === "0") { u.step = "idle"; u.out = tr("Session ended."); return render(); }
  if (u.step === "menu") {
    if (v === "1") { u.step = "item"; u.out = tr("Choose item") + "\n" + ITEMS.map((t, i) => (i + 1) + ". " + tr(t.n)).join("\n"); }
    else if (v === "2") { u.step = "age"; u.out = tr("Patient age and sex, e.g. F34"); }
    else if (v === "3") {
      const b = ITEMS.filter(t => st(local[t.id], t.min) !== "ok");
      u.out = (b.length ? b.map(t => tr(t.n) + ": " + local[t.id] + " (" + tr(lab[st(local[t.id], t.min)]) + ")").join("\n") : tr("No alerts")) + "\n\n" + UM();
    } else u.out = tr("Invalid choice") + "\n" + UM();
  } else if (u.step === "item") {
    const t = ITEMS[v - 1];
    if (t) { u.item = t; u.step = "qty"; u.out = tr(t.n) + "\n" + tr("Enter quantity left:"); } else u.out = tr("Invalid choice");
  } else if (u.step === "qty") {
    if (/^\d+$/.test(v)) {
      local[u.item.id] = +v; server[0].items = { ...local }; server[0].sync = "Just now";
      u.step = "menu"; u.out = tr("Saved") + ": " + tr(u.item.n) + " = " + v + "\n\n" + UM();
    } else u.out = tr("Enter a number");
  } else if (u.step === "age") {
    u.age = v.toUpperCase(); u.step = "dest"; u.out = tr("Send to") + "\n1. Gwagwalada\n2. Kuje\n3. Bwari";
  } else if (u.step === "dest") {
    const d = ["Gwagwalada", "Kuje", "Bwari"][v - 1];
    if (d) {
      refs.unshift({ id: Date.now(), who: u.age, why: "Urgent referral", to: d + " General Hospital", urg: "Urgent", st: "Sent", fac: "Kuje PHC" });
      u.msgs.unshift("To " + d + " General Hospital: URGENT referral from Kuje PHC, patient " + u.age + ". Please prepare.");
      u.step = "menu"; u.out = tr("Referral sent") + "\n\n" + UM();
    } else u.out = tr("Invalid choice");
  }
  render(); focusU();
}
function smsSend() {
  const v = document.getElementById("si").value.trim(), m = v.match(/^STOCK\s+(ACT|ORS|AMX|RDT|ZN|GLV)\s+(\d+)$/i);
  if (m) {
    const t = ITEMS.find(x => x.id === m[1].toLowerCase());
    local[t.id] = +m[2]; server[0].items = { ...local }; server[0].sync = "Just now";
    S.u.msgs.unshift("Reply: " + t.n + " = " + m[2] + " recorded for Kuje PHC.");
  } else S.u.msgs.unshift("Reply: " + tr("Format") + ": STOCK ACT 12");
  render();
}

/* Views */
function appView() {
  const ha = S.lang === "ha";
  const sts = ITEMS.map(t => st(local[t.id], t.min));
  const nOut = sts.filter(s => s === "out").length, nLow = sts.filter(s => s === "low").length;
  const bad = ITEMS.filter((t, i) => sts[i] !== "ok");
  const row = (t, right) => {
    const q = local[t.id], s = st(q, t.min);
    return `<div class="item"><div class="ico ${s === "ok" ? "" : s}">${ic(t.ic)}</div><div class="grow"><b>${tr(t.n)}</b>
      <small>${ha ? `${q} ya rage, a kara idan ya yi kasa da ${t.min}` : `${q} left, restock below ${t.min}`}</small>
      <div class="bar"><i style="width:${Math.min(100, (q / (t.min * 2)) * 100)}%;background:${COL[s]}"></i></div></div>${right}</div>`;
  };
  let body = "";
  if (S.screen === "home") {
    body = `<h2>${tr("Good morning, Nurse Amina")}</h2>
    <p class="sub">${bad.length ? (ha ? `Akwai abubuwa ${bad.length} da ke bukatar kulawa a asibitinku.` : `${bad.length} item${bad.length > 1 ? "s" : ""} need attention at your clinic.`) : tr("All stock levels look healthy.")}</p>
    <div class="stats"><div class="stat"><b>${ITEMS.length}</b><span>${tr("Items tracked")}</span></div><div class="stat low"><b>${nLow}</b><span>${tr("Low")}</span></div><div class="stat out"><b>${nOut}</b><span>${tr("Out")}</span></div></div>
    <h3>${tr("Needs attention")}</h3>` + (bad.length ? bad.map(t => row(t, pill(st(local[t.id], t.min)))).join("") : `<p class="sub">${tr("All stock levels look healthy.")}</p>`) +
    `<div class="stack"><button class="btn" onclick="go('stock')">${ic("box", "sm")}${tr("Count stock")}</button><button class="btn sec" onclick="go('ref',true)">${ic("swap", "sm")}${tr("Refer a patient")}</button></div>`;
  }
  if (S.screen === "stock") {
    body = `<h2>${tr("Today\u2019s stock count")}</h2><p class="sub">${tr("Tap + or \u2212 to match what is on the shelf.")}</p>` +
      ITEMS.map(t => row(t, `<div class="step"><button aria-label="Remove one ${t.n}" onclick="adj('${t.id}',-1)">\u2212</button><output>${local[t.id]}</output><button aria-label="Add one ${t.n}" onclick="adj('${t.id}',1)">+</button></div>`)).join("") +
      `<div class="stack"><button class="btn" onclick="save()">${ic("check", "sm")}${tr("Save stock count")}</button></div>`;
  }
  if (S.screen === "ref") {
    const op = a => a.map(x => `<option value="${x}">${tr(x)}</option>`).join("");
    if (S.form) body = `<h2>${tr("New referral")}</h2>
      <label for="rw">${tr("Patient age and sex")}</label><input id="rw" placeholder="F, 34">
      <label for="rr">${tr("Reason")}</label><select id="rr">${op(["Severe malaria", "Obstetric emergency", "Fracture", "Dehydration", "Hypertension review"])}</select>
      <label for="rt">${tr("Send to")}</label><select id="rt">${op(["Gwagwalada General Hospital", "Kuje General Hospital", "Bwari General Hospital"])}</select>
      <label for="ru">${tr("Urgency")}</label><select id="ru">${op(["Urgent", "Routine"])}</select>
      <div class="stack"><button class="btn" onclick="addRef()">${ic("send", "sm")}${tr("Send referral")}</button><button class="btn sec" onclick="S.form=false;render()">${tr("Cancel")}</button></div>
      <p class="hint" style="margin-top:14px">${tr("Only age and sex are collected in this demo. No names, to protect patient privacy.")}</p>`;
    else body = `<h2>${tr("Referrals from Kuje PHC")}</h2><div style="margin:12px 0 6px"><button class="btn" onclick="S.form=true;render()">${ic("swap", "sm")}${tr("New referral")}</button></div>` +
      refs.filter(r => r.fac === "Kuje PHC").map(r => `<div class="item"><div class="ico">${ic("swap")}</div><div class="grow"><b>${tr(r.why)}, ${r.who}</b><small>${r.to} (${tr(r.urg)})</small></div><div style="text-align:right">${rpill(r.st)}${r.st === "Sent" ? `<br><button class="btn sm sec" style="margin-top:6px" onclick="arrive(${r.id})">${tr("Mark arrived")}</button>` : ""}</div></div>`).join("");
  }
  if (S.screen === "ussd") {
    body = `<h2>${tr("USSD and SMS fallback")}</h2><p class="sub">${tr("Works on any phone, no data needed.")}</p>
      <div class="lcd"><div>*384*77#</div><pre>${S.u.out}</pre></div>` +
      (S.u.step === "idle" ? `<button class="btn" onclick="dial()">${ic("phone", "sm")}${tr("Dial")} *384*77#</button>`
        : `<div class="row2"><input id="ui" inputmode="numeric" aria-label="${tr("Reply")}" onkeydown="if(event.key==='Enter')uSend()"><button class="btn sm" onclick="uSend()">${tr("Send")}</button></div>`) +
      `<h3>${tr("Or send an SMS")}</h3><div class="row2"><input id="si" value="STOCK ACT 12" aria-label="SMS to 38477"><button class="btn sm" onclick="smsSend()">${tr("Send SMS")}</button></div>` +
      (S.u.msgs.length ? `<h3>${tr("Messages")}</h3>` + S.u.msgs.slice(0, 4).map(m => `<div class="msg">${m}</div>`).join("") : "");
  }
  const pend = queue + refs.filter(r => r.st === "Queued").length;
  const tabs = [["home", "Home", "home", "index.html"], ["stock", "Stock", "box", "stock.html"], ["ref", "Referrals", "swap", "referrals.html"], ["ussd", "USSD", "phone", "ussd.html"]];
  return `<div class="stage"><div class="device"><div class="screen-wrap">
    <div class="sb"><span>09:41</span><span>${ic("wifi", "sm")}</span></div>
    <div class="hdr"><div><b>Kuje PHC</b><small>Kuje Area Council, FCT</small></div>
      <div class="lang" role="group" aria-label="Language"><button aria-pressed="${!ha}" onclick="setLang('en')">EN</button><button aria-pressed="${ha}" onclick="setLang('ha')">HA</button></div></div>
    <div class="net"><button class="chip ${S.online ? "" : "off"}" onclick="toggleNet()" aria-label="Toggle connection for demo"><span class="d"></span>${tr(S.online ? "Online" : "Offline")}</button>
      ${pend ? `<span>${pend} ${tr("waiting")}</span><button class="btn sm" onclick="${S.online ? "sync()" : "toast('Go online to sync')"}">${tr("Sync now")}</button>` : `<span style="color:var(--mute)">${tr(S.online ? "Everything is synced" : "Working offline")}</span>`}</div>
    <div class="body">${S.online ? "" : `<div class="banner">${ic("alert", "sm")}<span>${tr("No signal. You can keep working. Changes save on this phone.")}</span></div>`}${body}</div>
    <nav class="tabs" aria-label="App sections">${${tabs.map(([k, v, i, href]) => `<a ${S.screen === k ? 'aria-current="page"' : ""} href="${href}">${ic(i)}${tr(v)}</a>`).join("")}}</nav>
  </div></div></div>
  <p class="note">Try it: switch to HA for Hausa. On the USSD tab, dial the code, reply 1, pick an item and enter a number. Then open the Officer dashboard.</p>`;
}

function dashView() {
  const F = server, sums = F.map(fst);
  const outs = sums.reduce((a, s) => a + s.o, 0), lows = sums.reduce((a, s) => a + s.l, 0);
  const done = refs.filter(r => r.st === "Arrived").length, pct = refs.length ? Math.round((done / refs.length) * 100) : 0;
  const f = F[S.sel];
  const alerts = [];
  F.forEach(x => ITEMS.forEach(t => { if (x.items[t.id] <= 0) alerts.push({facility:x.name,item:t.n}); }));
  const kpi = (icon, cls, label, val, meta) => `<article class="kpi"><div class="ico ${cls}">${ic(icon, "lg")}</div><div class="kpi-copy"><span>${label}</span><b>${val}</b><small>${meta}</small></div></article>`;
  return `<section class="dashboard">
    <div class="dash-head"><div><div class="eyebrow">FCT / HEALTH SYSTEM MONITORING</div><h2>Operations overview</h2><p class="sub">Monitor facility stock levels and referral activity across the network.</p></div><div class="report-date"><span class="live-dot"></span> Demo environment <span class="date-sep">·</span> Sample data</div></div>
    <div class="kpis">
      ${kpi("building","","Reporting facilities",F.length,"Facilities in this demo network")}
      ${kpi("alert","out","Stock-out incidents",outs,"Items currently at zero")}
      ${kpi("trend","low","Low-stock warnings",lows,"Items below minimum level")}
      ${kpi("check","","Referral arrival rate",pct+"%",done+" of "+refs.length+" referrals marked arrived")}
    </div>
    <div class="dash-layout">
      <div class="dash-main">
        <section class="panel facilities-panel">
          <div class="panel-head"><div><div class="eyebrow">NETWORK STATUS</div><h3>Facility inventory</h3><p>Choose a facility to inspect its current stock position.</p></div><span class="count-label">${F.length} facilities</span></div>
          <div class="table-wrap"><table><thead><tr><th>Facility</th><th>Area</th><th>Stock condition</th><th>Last update</th><th></th></tr></thead><tbody>
          ${F.map((x,i)=>`<tr tabindex="0" class="${i===S.sel?"sel":""}" onclick="selF(${i})" onkeydown="if(event.key==='Enter'||event.key===' ')selF(${i})"><td><span class="facility-mark">${ic("building","sm")}</span><strong>${x.name}</strong></td><td>${x.area}</td><td><span class="status-wrap">${pill(sums[i].s)}<span class="status-detail">${sums[i].o} out · ${sums[i].l} low</span></span></td><td>${x.sync}</td><td class="table-arrow">›</td></tr>`).join("")}
          </tbody></table></div>
          <div class="table-foot"><span>Inventory status is based on the configured minimum stock level.</span><span>Selected: <strong>${f.name}</strong></span></div>
        </section>
        <section class="panel referral-panel">
          <div class="panel-head"><div><div class="eyebrow">PATIENT MOVEMENT</div><h3>Recent referrals</h3><p>Referral progress recorded by facilities.</p></div><span class="count-label">${refs.length} records</span></div>
          <div class="referral-list">${refs.slice(0,6).map(r=>`<div class="referral-row"><div class="ref-icon">${ic("swap")}</div><div class="ref-details"><strong>${r.why}</strong><small>${r.fac} <span>→</span> ${r.to}</small></div><div class="ref-age">${r.who}</div>${rpill(r.st)}</div>`).join("")}</div>
        </section>
      </div>
      <aside class="dash-side">
        <section class="panel selected-panel">
          <div class="panel-head compact"><div><div class="eyebrow">FACILITY DETAIL</div><h3>${f.name}</h3><p>${f.area} · Updated ${f.sync}</p></div><span class="detail-mark">${ic("building")}</span></div>
          <div class="stock-summary"><span>Tracked commodities</span><strong>${ITEMS.length}</strong></div>
          <div class="detail-stock">${ITEMS.map(t=>{const q=f.items[t.id],s=st(q,t.min);return `<div class="detail-stock-row"><div class="detail-stock-top"><span>${t.n}</span><strong>${q} <small>units</small></strong></div><div class="detail-track"><i class="${s}" style="width:${Math.min(100,(q/(t.min*2))*100)}%"></i></div><div class="detail-stock-meta"><span>Minimum ${t.min}</span>${pill(s)}</div></div>`;}).join("")}</div>
          <button class="btn sec alert-action" onclick="sms('${f.area}')">${ic("send","sm")}Notify LGA officer</button>
        </section>
        <section class="panel alerts-panel"><div class="panel-head compact"><div><div class="eyebrow">ACTION REQUIRED</div><h3>Stock-out alerts</h3></div><span class="alert-count">${alerts.length}</span></div>
          ${alerts.length?alerts.slice(0,7).map(a=>`<div class="alert-row"><span class="alert-symbol">${ic("alert","sm")}</span><div><strong>${a.item}</strong><small>${a.fac}</small></div><span class="pill out">Out</span></div>`).join(""):'<p class="empty-state">No stock-out alerts at this time.</p>'}
          ${alerts.length>7?'<p class="more-alerts">+'+(alerts.length-7)+' more alerts</p>':""}
        </section>
      </aside>
    </div>
    <p class="demo-disclaimer">PHC Link demonstration · All facilities, stock quantities and referral records shown here are sample data, not live health-system records.</p>
  </section>`;
}

function render() { try { sessionStorage.setItem("phc-link-demo-state", JSON.stringify({ local, queue, refs, server, online: S.online, lang: S.lang, u: S.u })); } catch (error) { console.warn("Demo state could not be saved.", error); } document.getElementById("root").innerHTML = S.view === "app" ? appView() : dashView(); }
render();