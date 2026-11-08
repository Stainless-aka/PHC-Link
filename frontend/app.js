/* PHC Link frontend. No sample facilities, stock quantities, or referral records are preloaded. */
const ITEMS = [];
const server = [];
const refs = [];
let local = {};
let queue = 0;
const PAGE = document.body.dataset.page || "home";
const S = { view: "app", screen: PAGE, online: navigator.onLine, form: false, sel: 0, lang: "en", u: { step: "idle", out: "", item: null, age: null, msgs: [] } };
try { sessionStorage.removeItem("phc-link-demo-state"); } catch (error) {}

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
  const titles = { home: "Facility overview", stock: "Stock", ref: "Referrals", ussd: "USSD & SMS" };
  const descriptions = { home: "No facility has been assigned to this account.", stock: "No inventory records have been added.", ref: "No referral records have been created.", ussd: "No USSD code or SMS gateway has been configured." };
  const title = titles[S.screen] || titles.home;
  const body = '<section class="empty-state"><h3>No data available</h3><p>' + descriptions[S.screen] + '</p></section>';
  const tabs = [["home","Home","index.html"],["stock","Stock","stock.html"],["ref","Referrals","referrals.html"],["ussd","USSD","ussd.html"]];
  return '<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>Facility not configured</b><small>No facility assigned</small></div></header><div class="net"><span class="chip off"><span class="d"></span>Not connected</span><span>No records are stored in this workspace.</span></div><nav class="tabs" aria-label="App sections">' + tabs.map(function(t){return '<a '+(S.screen===t[0]?'aria-current="page"':'')+' href="'+t[2]+'">'+t[1]+'</a>';}).join("") + '</nav><main class="body"><h2>'+title+'</h2><p class="sub">PHC Link workspace</p>'+body+'</main></div></div>';
}
function dashView() {
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">HEALTH SYSTEM MONITORING</div><h2>Operations overview</h2><p class="sub">Facility and referral metrics will appear when real records are connected.</p></div><div class="report-date">No data configured</div></div><div class="kpis"><article class="kpi"><div class="kpi-copy"><span>Reporting facilities</span><b>0</b><small>No facilities registered</small></div></article><article class="kpi"><div class="kpi-copy"><span>Stock-out incidents</span><b>0</b><small>No inventory records</small></div></article><article class="kpi"><div class="kpi-copy"><span>Low-stock warnings</span><b>0</b><small>No inventory records</small></div></article><article class="kpi"><div class="kpi-copy"><span>Referrals</span><b>0</b><small>No referral records</small></div></article></div><section class="panel empty-state"><h3>No facility records yet</h3><p>Register facilities and connect the backend before operational data is displayed.</p></section></section>';
}

function render() { document.getElementById("root").innerHTML = S.view === "app" ? appView() : dashView(); }
render();