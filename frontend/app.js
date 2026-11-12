/* PHC Link: live API-backed administration and facility shell. */
const PAGE = document.body.dataset.page || "home";
const WORKSPACE = document.body.dataset.workspace || "login";
const API_BASE_URL = "";
const STATE = { page:PAGE, admin:null, user:null, facilityId:null, busy:false };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
}
async function api(path, options={}) {
  const method=String(options.method||"GET").toUpperCase(), cacheKey="phclink-cache:"+path, route=path.split("?")[0], cacheable=method==="GET"&&["/api/auth/me","/api/facilities","/api/inventory/items","/api/inventory/balances","/api/patients"].includes(route);
  let response;
  try { response=await fetch(API_BASE_URL+path,{...options,credentials:"include",mode:"cors",headers:{"Content-Type":"application/json",...(options.headers||{})}}); }
  catch(error) {
    if(cacheable){try{const cached=localStorage.getItem(cacheKey);if(cached)return JSON.parse(cached);}catch(_){}}
    throw new Error("Network unavailable. Your action can be saved offline.");
  }
  const payload=response.status===204?{}:await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||"Request failed. Please try again.");
  if(cacheable){try{localStorage.setItem(cacheKey,JSON.stringify(payload));}catch(_){}}
  return payload;
}
function outboxKey(){return "phclink-outbox-v1:"+(STATE.user?.id||"unknown");}
function readOutbox(){try{return JSON.parse(localStorage.getItem(outboxKey())||"[]");}catch(_){return [];}}
function writeOutbox(items){try{localStorage.setItem(outboxKey(),JSON.stringify(items));return true;}catch(_){notify("Device storage is full. Connect and retry to avoid losing this action.",true);return false;}}
function updateSyncIndicator(){
  const node=document.getElementById("networkIndicator");if(!node)return;
  const count=readOutbox().length;
  node.innerHTML='<span class="sync-dot '+(navigator.onLine?"online":"offline")+'"></span>'+(navigator.onLine?"Online":"Offline")+(count?' · Saved: '+count+' waiting':'');
}
function queueOfflineAction(path,payload,error){
  if(navigator.onLine&&!/Network unavailable/i.test(error?.message||""))return false;
  if(!["/api/inventory/movements","/api/patients","/api/referrals"].includes(path))return false;
  const operationId=payload.operationId||crypto.randomUUID();
  const item={id:operationId,path,method:"POST",payload:{...payload,operationId},createdAt:new Date().toISOString()};
  const queue=readOutbox();if(!queue.some(x=>x.id===item.id))queue.push(item);if(!writeOutbox(queue))return false;updateSyncIndicator();return true;
}
async function flushOfflineQueue(){
  if(!navigator.onLine||!STATE.user)return;
  const queue=readOutbox();if(!queue.length){updateSyncIndicator();return;}
  const remaining=[];
  for(let i=0;i<queue.length;i++){
    try{await api(queue[i].path,{method:queue[i].method,body:JSON.stringify(queue[i].payload)});}
    catch(error){remaining.push(...queue.slice(i));break;}
  }
  writeOutbox(remaining);updateSyncIndicator();
  if(queue.length>remaining.length)notify("Offline actions synchronised successfully.");
}
function notify(message, error=false) {
  const toast=document.getElementById("toast");
  if(!toast) return;
  toast.textContent=message; toast.hidden=false;
  toast.style.background=error?"#8b3434":"#142f43";
  clearTimeout(notify.timer); notify.timer=setTimeout(()=>toast.hidden=true,4500);
}
const HAUSA={
"Home":"Gida","Stock":"Hannun Jari","Referrals":"Tura Mara lafiya","Patients":"Marasa lafiya","USSD":"USSD","Sign out":"Fita","Emergency":"Gaggawa","Routine":"Na yau da kullum","Urgent":"Mai gaggawa","Create referral":"Kirkiri tura mara lafiya","Select registered patient":"Zabi mara lafiyar da aka yi rajista","Destination facility":"Asibitin da za a kai","Reason for referral":"Dalilin turawa","Urgency":"Matsayin gaggawa","Register a patient":"Yi rajistar mara lafiya","Register patient":"Yi rajistar mara lafiya","Patient register":"Jerin marasa lafiya","Patient full name":"Cikakken sunan mara lafiya","Date of birth (optional)":"Ranar haihuwa (ba dole ba)","Sex (optional)":"Jinsi (ba dole ba)","Phone number (optional)":"Lambar waya (ba dole ba)","Available stock":"Magunguna da kayan aiki da ake da su","Record stock movement":"Shigar da motsin kaya","Inventory item":"Kayan magani","Movement type":"Nau'in motsi","Quantity":"Adadi","Adjustment direction":"Hanyar gyara","Increase":"Kara","Decrease":"Rage","Batch number (optional)":"Lambar rukuni (ba dole ba)","Expiry date (optional)":"Ranar karewa (ba dole ba)","Reason / note":"Dalili / bayani","Save stock movement":"Ajiye motsin kaya","Select an option":"Zabi","Drug Out of Stock":"Magani Ya Kare","No Worker":"Babu Ma'aikaci","Create account":"Kirkiri asusu","Confirm password":"Tabbatar da kalmar sirri","Password":"Kalmar sirri","Email address":"Adireshin imel","Full name":"Cikakken suna","Facility overview":"Bayanin asibiti","Stock management":"Gudanar da kaya","Patient management":"Gudanar da marasa lafiya","USSD & SMS":"USSD da SMS","Your facility":"Asibitinku","Patient ID":"Lambar mara lafiya","Full name":"Cikakken suna","Patient name":"Sunan mara lafiya","Origin":"Asalin wuri","Destination":"Wurin da za a kai","Status":"Matsayi","Available balance":"Adadin da ake da shi","Stock movement recorded.":"An adana motsin kaya.","Register patient":"Yi rajistar mara lafiya","REF-OK · Accept":"REF-OK · Karɓa","REF-NO · Cannot accept":"REF-NO · Ba za a iya karɓa ba","Awaiting clinician response":"Ana jiran amsar likita","Online":"A kan layi","Offline":"Babu intanet","Saved":"An adana","Save stock movement":"Ajiye motsin kaya","Create referral":"Kirkiri tura mara lafiya","Sign in":"Shiga","Sign in to facility":"Shiga asibiti","Referral accepted. Awaiting patient arrival.":"An karbi turawar. Ana jiran isowar mara lafiya.","Instruction to PHC (optional)":"Umarnin zuwa PHC (ba dole ba)","Emergency referrals":"Turawar gaggawa","Clinical response desk":"Sashen amsar likitoci","Review incoming emergencies and respond to the originating PHC.":"Duba gaggawar da aka aika sannan ka amsa wa PHC.","REF-OK · Accept":"REF-OK · Karɓa","REF-NO · Cannot accept":"REF-NO · Ba za a iya karɓa ba"};
function currentLanguage(){return localStorage.getItem("phclink-language")==="ha"?"ha":"en";}
function applyFacilityLanguage(){
 const lang=currentLanguage(),root=document.getElementById("root");document.documentElement.lang=lang==="ha"?"ha":"en";if(!root)return;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
 while(node=walker.nextNode()){
  if(!node.parentElement||["SCRIPT","STYLE"].includes(node.parentElement.tagName)||node.parentElement.closest("[data-language-switch]"))continue;
  if(node.__phcEnglish===undefined)node.__phcEnglish=node.nodeValue;
  const original=node.__phcEnglish.trim(),translated=HAUSA[original];
  node.nodeValue=lang==="ha"&&translated?node.nodeValue.replace(original,translated):node.__phcEnglish;
 }
 root.querySelectorAll("[placeholder],[aria-label],[title]").forEach(el=>["placeholder","aria-label","title"].forEach(attr=>{
  const value=el.getAttribute(attr);if(!value)return;const key="en"+attr;if(!el.dataset[key])el.dataset[key]=value;
  const original=el.dataset[key];el.setAttribute(attr,lang==="ha"?(HAUSA[original]||original):original);
 }));
 const toggle=root.querySelector("[data-language-switch]");if(toggle)toggle.textContent=lang==="ha"?"Hausa | English":"English | Hausa";
}
function facilityLoginView() {
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">FACILITY WORKSPACE</div><h2>Staff sign in</h2><p class="sub">Registered health workers and clinicians can access their assigned facility after signing in.</p></div></div><div class="panel setup-panel"><form id="loginForm" class="admin-form">'+field("Email address","loginEmail","email",true,'autocomplete="username"')+field("Password","loginPassword","password",true,'autocomplete="current-password"')+'<button class="btn" type="submit">Sign in to facility</button></form></div></section>';
}
async function facilityWorkspace() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Checking your staff session…</p></div>';
  try {
    const me=await api("/api/auth/me"); STATE.user=me.user;
    if(STATE.user.role==="system_admin"){ window.location.replace("admin.html"); return; }
    if(STATE.user.role==="clinician"){window.location.replace("clinician.html");return;}
    if(STATE.user.role!=="health_worker"){
      root.innerHTML='<section class="panel setup-panel"><h2>Workspace not available</h2><p class="sub">Your account role does not have access to the facility workspace. Contact the system administrator.</p><button class="btn sec" id="staffLogout" type="button">Sign out</button></section>'; return;
    }
    const result=await api("/api/facilities"), facilities=result.facilities||[];
    if(!facilities.length){
      root.innerHTML='<section class="panel setup-panel"><h2>No facility assigned</h2><p class="sub">Your account is active, but no facility has been assigned. Contact the system administrator.</p><button class="btn sec" id="staffLogout" type="button">Sign out</button></section>'; return;
    }
    const selected=facilities.find(f=>f.id===STATE.facilityId)||facilities[0]; STATE.facilityId=selected.id;
    let content='<section class="panel"><h2>'+({home:"Facility overview",stock:"Stock management",ref:"Referrals",patients:"Patient management",ussd:"USSD & SMS"}[STATE.page]||"Facility overview")+'</h2><p class="sub">'+escapeHtml(selected.name)+' · '+escapeHtml(selected.lga_name)+', '+escapeHtml(selected.state_name)+'</p>';
    if(STATE.page==="stock"){
      const [data,catalogue]=await Promise.all([
        api("/api/inventory/balances?facilityId="+encodeURIComponent(selected.id)),
        api("/api/inventory/items")
      ]);
      const rows=data.balances||[], items=catalogue.items||[];
      const itemOptions=options(items,"id",r=>r.name+" · "+r.category+" ("+r.unit+")");
      const movementOptions='<option value="RECEIVED">Receive stock</option><option value="DISPENSED">Dispense stock</option><option value="ADJUSTMENT">Adjust balance</option><option value="TRANSFER_IN">Transfer in</option><option value="TRANSFER_OUT">Transfer out</option><option value="EXPIRED">Record expired stock</option><option value="DAMAGED">Record damaged stock</option>';
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Record stock movement</h3><p>Every entry is recorded in the facility stock ledger.</p></div></div>'+(items.length?'<form id="stockMovementForm" class="admin-form">'+selectField("Inventory item","itemId",itemOptions)+selectField("Movement type","movementType",movementOptions)+field("Quantity","quantity","number",true,'min="0.01" step="0.01"')+'<label for="adjustmentDirection">Adjustment direction</label><select id="adjustmentDirection" name="adjustmentDirection"><option value="increase" selected>Increase</option><option value="decrease">Decrease</option></select>'+field("Batch number (optional)","batchNumber","text",false)+field("Expiry date (optional)","expiryDate","date",false)+'<label for="movementNote">Reason / note</label><input id="movementNote" name="note" maxlength="500" placeholder="Required for adjustments; optional otherwise"><button class="btn" type="submit">Save stock movement</button></form>':'<p class="empty-state">No inventory items have been added yet. Ask the system administrator to add items to the catalogue.</p>')+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Available stock</h3><p>Current calculated balances for this facility</p></div><span class="count-label">'+rows.length+' items</span></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Available balance</th><th>Unit</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.category)+'</td><td>'+escapeHtml(r.quantity)+'</td><td>'+escapeHtml(r.unit)+'</td></tr>').join(""):'<tr><td colspan="4">No inventory catalogue items available yet.</td></tr>')+'</tbody></table></div></section>';
    } else if(STATE.page==="ref"){
      const [data,destinations,patientData]=await Promise.all([
        api("/api/referrals?facilityId="+encodeURIComponent(selected.id)),
        api("/api/facilities/referral-destinations?originFacilityId="+encodeURIComponent(selected.id)),
        api("/api/patients?facilityId="+encodeURIComponent(selected.id))
      ]);
      const rows=data.referrals||[], targets=destinations.facilities||[], patients=patientData.patients||[];
      const targetOptions=options(targets,"id",r=>r.name+" · "+r.lga_name);
      const patientOptions=options(patients,"id",p=>p.full_name+" · "+p.patient_code);
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Create referral</h3><p>Send a referral from your assigned facility to another facility.</p></div></div>'+(targets.length&&patients.length?'<form id="referralForm" class="admin-form">'+selectField("Select registered patient","patientId",patientOptions,"Choose a patient")+selectField("Destination facility","destinationFacilityId",targetOptions)+field("Reason for referral","reasonCode","text",true,'maxlength="100" placeholder="e.g. Maternal complication"')+selectField("Urgency","urgency",'<option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>')+'<button class="btn" type="submit">Create referral</button></form>':(!targets.length?'<p class="empty-state">No receiving facility is registered yet. Ask the system administrator to add at least one more active facility.</p>':'<p class="empty-state">No patients are registered at this facility yet. Register the patient in the Patients section before creating a referral.</p>'))+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Referral records</h3><p>Referrals sent from or received by this facility</p></div><span class="count-label">'+rows.length+' records</span></div><div class="table-wrap"><table><thead><tr><th>Referral code</th><th>Patient</th><th>Origin</th><th>Destination</th><th>Urgency</th><th>Clinician response</th><th>Status</th></tr></thead><tbody id="referralRecordsBody">'+(rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.referral_code)+'</td><td>'+escapeHtml(r.patient_name||r.patient_code||"—")+'</td><td>'+escapeHtml(r.origin_facility)+'</td><td>'+escapeHtml(r.destination_facility)+'</td><td>'+escapeHtml(r.urgency)+'</td><td>'+escapeHtml(r.clinician_reply||'Awaiting clinician response')+'</td><td><span class="pill '+(r.status==="completed"?"ok":(r.status==="rejected"||r.status==="cancelled"?"out":"q"))+'">'+escapeHtml(r.status)+'</span></td></tr>').join(""):'<tr><td colspan="7">No referrals recorded for this facility.</td></tr>')+'</tbody></table></div></section>';
    } else if(STATE.page==="patients"){
      const data=await api("/api/patients?facilityId="+encodeURIComponent(selected.id));
      const rows=data.patients||[];
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Register a patient</h3><p>Create a patient record for this facility. Only necessary details are requested.</p></div></div><form id="patientForm" class="admin-form">'+field("Patient full name","patientFullName","text",true,'maxlength="160" autocomplete="name"')+field("Date of birth (optional)","patientDateOfBirth","date",false,'max="'+new Date().toISOString().slice(0,10)+'"')+selectField("Sex (optional)","patientSex",'<option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option>',"Not recorded",false)+field("Phone number (optional)","patientPhone","tel",false,'maxlength="30" autocomplete="tel"')+'<button class="btn" type="submit">Register patient</button></form></section><section class="panel admin-panel"><div class="panel-head"><div><h3>Patient register</h3><p>Records registered at this facility</p></div><span class="count-label">'+rows.length+' patients</span></div><div class="table-wrap"><table><thead><tr><th>Patient ID</th><th>Full name</th><th>Date of birth</th><th>Sex</th><th>Phone</th><th>Date registered</th></tr></thead><tbody>'+(rows.length?rows.map(p=>'<tr><td>'+escapeHtml(p.patient_code)+'</td><td>'+escapeHtml(p.full_name)+'</td><td>'+escapeHtml(p.date_of_birth||"—")+'</td><td>'+escapeHtml(p.sex||"—")+'</td><td>'+escapeHtml(p.phone||"—")+'</td><td>'+escapeHtml(new Date(p.created_at).toLocaleDateString())+'</td></tr>').join(""):'<tr><td colspan="6">No patients registered at this facility yet.</td></tr>')+'</tbody></table></div></section>';
    } else if(STATE.page==="ussd") content+='<p class="sub">USSD and SMS integrations have not yet been configured.</p>';
    else {
      const [stockData,referralData,patientData]=await Promise.all([api("/api/inventory/balances?facilityId="+encodeURIComponent(selected.id)),api("/api/referrals?facilityId="+encodeURIComponent(selected.id)),api("/api/patients?facilityId="+encodeURIComponent(selected.id))]);
      const stockRows=stockData.balances||[], referralRows=referralData.referrals||[], patientRows=patientData.patients||[];
      const openReferrals=referralRows.filter(r=>["submitted","acknowledged","arrived"].includes(String(r.status||"").toLowerCase()));
      const completedReferrals=referralRows.filter(r=>String(r.status||"").toLowerCase()==="completed");
      const icon=(name)=>'<svg class="facility-icon" viewBox="0 0 24 24" aria-hidden="true">'+({patients:'<path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20"/><circle cx="10" cy="7" r="4"/>',stock:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12v9"/>',referrals:'<path d="M4 7h14M14 3l4 4-4 4M20 17H6m4-4-4 4 4 4"/>',completed:'<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'}[name]||'')+'</svg>';
      const recentPatients=[...patientRows].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
      const recentReferrals=[...referralRows].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
      content+='<div class="facility-home"><div class="facility-welcome"><div><span class="facility-kicker">FACILITY DASHBOARD</span><h3>Good day, '+escapeHtml((STATE.user.fullName||"Health worker").split(" ")[0])+'</h3><p>A live snapshot of activity at '+escapeHtml(selected.name)+'.</p></div><span class="facility-role">'+escapeHtml(STATE.user.role==="health_worker"?"Health worker":"Clinician")+'</span></div>'+
      '<div class="facility-metrics"><article class="facility-metric">'+icon("patients")+'<div><span>Registered patients</span><strong>'+patientRows.length+'</strong><small>Patient records at this facility</small></div></article><article class="facility-metric">'+icon("stock")+'<div><span>Stock line items</span><strong>'+stockRows.length+'</strong><small>Items with recorded balances</small></div></article><article class="facility-metric">'+icon("referrals")+'<div><span>Total referrals</span><strong>'+referralRows.length+'</strong><small>'+openReferrals.length+' currently in progress</small></div></article><article class="facility-metric">'+icon("completed")+'<div><span>Completed referrals</span><strong>'+completedReferrals.length+'</strong><small>Marked completed</small></div></article></div>'+
      '<div class="facility-home-grid"><section class="facility-data-card"><div class="facility-card-head"><div><span class="facility-kicker">LATEST REGISTER</span><h3>Recent patients</h3></div><a href="patients.html">View all '+icon("arrow")+'</a></div>'+
      (recentPatients.length?'<div class="facility-record-list">'+recentPatients.map(p=>'<div class="facility-record"><span class="facility-record-avatar">'+escapeHtml(String(p.full_name||"P").trim().charAt(0).toUpperCase())+'</span><div><strong>'+escapeHtml(p.full_name)+'</strong><small>'+escapeHtml(p.patient_code)+' · '+escapeHtml(p.created_at?new Date(p.created_at).toLocaleDateString():"Date unavailable")+'</small></div></div>').join("")+'</div>':'<div class="facility-empty"><strong>No patient records yet</strong><p>Registered patients will appear here.</p><a href="patients.html">Register a patient</a></div>')+'</section>'+
      '<section class="facility-data-card"><div class="facility-card-head"><div><span class="facility-kicker">REFERRAL ACTIVITY</span><h3>Recent referrals</h3></div><a href="referrals.html">View all '+icon("arrow")+'</a></div>'+
      (recentReferrals.length?'<div id="homeRecentReferrals" class="facility-record-list">'+recentReferrals.map(r=>'<div class="facility-record facility-referral-record"><div><strong>'+escapeHtml(r.referral_code||"Referral")+'</strong><small>'+escapeHtml(r.patient_name||r.patient_code||"Patient")+' · '+escapeHtml(r.destination_facility||"Destination pending")+(r.clinician_reply?" · Reply: "+escapeHtml(r.clinician_reply):"")+'</small></div><span class="facility-status '+(String(r.status).toLowerCase()==="completed"?"is-complete":"")+'">'+escapeHtml(r.status||"Unknown")+'</span></div>').join("")+'</div>':'<div class="facility-empty"><strong>No referral records yet</strong><p>New referrals created or received will appear here.</p><a href="referrals.html">Open referrals</a></div>')+'</section></div>'+
      '<section class="facility-data-card facility-stock-summary"><div class="facility-card-head"><div><span class="facility-kicker">INVENTORY SNAPSHOT</span><h3>Available stock</h3></div><a href="stock.html">Manage stock '+icon("arrow")+'</a></div>'+
      (stockRows.length?'<div class="facility-stock-list">'+stockRows.slice(0,6).map(item=>'<div><span>'+escapeHtml(item.name)+'</span><strong>'+escapeHtml(item.quantity)+' <small>'+escapeHtml(item.unit)+'</small></strong></div>').join("")+'</div>':'<div class="facility-empty compact"><strong>No stock balances recorded</strong><p>Stock balances will appear after movements are recorded.</p><a href="stock.html">Open stock management</a></div>')+'</section></div>';
    }
    content+='</section>';
    const nav=[["home","Home","facility.html"],["stock","Stock","stock.html"],["ref","Referrals","referrals.html"],["patients","Patients","patients.html"],["ussd","USSD","ussd.html"]];
    root.innerHTML='<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>Facility workspace</b><small>Signed in as '+escapeHtml(STATE.user.fullName)+' · '+escapeHtml(STATE.user.role)+'</small></div><div class="facility-header-actions"><button class="btn sec sm" data-language-switch type="button">English | Hausa</button><button class="btn sec sm" id="staffLogout" type="button">Sign out</button></div></header><div class="net"><span id="apiStatus">Authenticated session</span><span id="networkIndicator"></span></div>'+(facilities.length>1?'<div class="panel"><label for="facilityPicker">Your facility</label><select id="facilityPicker">'+facilities.map(f=>'<option value="'+escapeHtml(f.id)+'" '+(f.id===selected.id?'selected':'')+'>'+escapeHtml(f.name)+'</option>').join("")+'</select></div>':'')+'<nav class="tabs" aria-label="Facility sections">'+nav.map(([key,label,url])=>'<a href="'+url+'"'+(STATE.page===key?' aria-current="page"':'')+'>'+iconSvg(key)+'<span>'+label+'</span></a>').join("")+'</nav><main class="body">'+content+'</main></div></div>';
    applyFacilityLanguage();updateSyncIndicator();flushOfflineQueue();
    clearInterval(window.phcReferralPoll);if(["ref","home"].includes(STATE.page))window.phcReferralPoll=setInterval(()=>refreshFacilityReferrals(selected.id),5000);
  } catch(error) {
    if(error.message==="Authentication required."){STATE.user=null;window.location.replace("index.html");}
    else root.innerHTML='<section class="panel"><h2>Facility workspace unavailable</h2><p class="sub">'+escapeHtml(error.message)+'</p><button class="btn sec" onclick="render()">Retry</button></section>';
  }
}

async function refreshFacilityReferrals(facilityId){
  const body=document.getElementById("referralRecordsBody"),homeList=document.getElementById("homeRecentReferrals");if(!body&&!homeList)return;
  try{
    const data=await api("/api/referrals?facilityId="+encodeURIComponent(facilityId));
    const rows=data.referrals||[];
    if(body)body.innerHTML=rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.referral_code)+'</td><td>'+escapeHtml(r.patient_name||r.patient_code||"—")+'</td><td>'+escapeHtml(r.origin_facility)+'</td><td>'+escapeHtml(r.destination_facility)+'</td><td>'+escapeHtml(r.urgency)+'</td><td>'+escapeHtml(r.clinician_reply||"Awaiting clinician response")+'</td><td><span class="pill '+(r.status==="completed"?"ok":(r.status==="rejected"||r.status==="cancelled"?"out":"q"))+'">'+escapeHtml(r.status)+'</span></td></tr>').join(""):'<tr><td colspan="7">No referrals recorded for this facility.</td></tr>';
    if(homeList)homeList.innerHTML=rows.slice(0,5).map(r=>'<div class="facility-record facility-referral-record"><div><strong>'+escapeHtml(r.referral_code||"Referral")+'</strong><small>'+escapeHtml(r.patient_name||r.patient_code||"Patient")+' · '+escapeHtml(r.destination_facility||"Destination pending")+(r.clinician_reply?" · Reply: "+escapeHtml(r.clinician_reply):"")+'</small></div><span class="facility-status '+(String(r.status).toLowerCase()==="completed"?"is-complete":"")+'">'+escapeHtml(r.status||"Unknown")+'</span></div>').join("");

  }catch(_){}
}

async function clinicianWorkspace(){
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Loading emergency referrals…</p></div>';
  try{
    const me=await api("/api/auth/me");STATE.user=me.user;
    if(STATE.user.role!=="clinician"){window.location.replace(STATE.user.role==="system_admin"?"admin.html":"facility.html");return;}
    const data=await api("/api/referrals/clinician/inbox");
    const rows=data.referrals||[];
    const cards=rows.length?rows.map(r=>'<article class="clinician-referral"><div class="clinician-referral-top"><div><span class="clinician-emergency-label">EMERGENCY REFERRAL</span><h3>'+escapeHtml(r.referral_code)+'</h3><p>'+escapeHtml(r.origin_facility)+' · '+escapeHtml(r.origin_lga)+', '+escapeHtml(r.origin_state)+'</p></div><span class="clinician-status">'+escapeHtml(r.status)+'</span></div><div class="clinician-patient"><strong>'+escapeHtml(r.patient_name||"Patient details unavailable")+'</strong><span>'+escapeHtml(r.patient_code||"")+' · '+escapeHtml(r.sex||"Sex not recorded")+'</span><small>'+escapeHtml(r.reason_code||"Emergency")+' · '+escapeHtml(new Date(r.created_at).toLocaleString())+'</small></div><form class="clinician-response-form" data-referral-id="'+escapeHtml(r.id)+'"><label for="instruction-'+escapeHtml(r.id)+'">Instruction to PHC (optional)</label><textarea id="instruction-'+escapeHtml(r.id)+'" name="notes" rows="2" maxlength="500" placeholder="e.g. Give IV fluids, refer now"></textarea><div><button class="btn clinician-accept" type="button" data-clinician-action="acknowledged" data-referral-id="'+escapeHtml(r.id)+'">REF-OK · Accept</button><button class="btn sec clinician-reject" type="button" data-clinician-action="rejected" data-referral-id="'+escapeHtml(r.id)+'">REF-NO · Cannot accept</button></div></form></article>').join(""):'<section class="clinician-empty"><span>✓</span><h3>No active emergency referrals</h3><p>New emergency referrals from PHCs will appear here automatically.</p></section>';
    root.innerHTML='<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>PHC Link · Clinician</b><small>'+escapeHtml(STATE.user.fullName)+' · '+escapeHtml(STATE.user.designation||"Clinician")+'</small></div><div class="clinician-header-actions"><button class="btn sec sm" data-language-switch type="button">English | Hausa</button><span class="clinician-live"><i></i> Live emergency queue</span><button class="btn sec sm" id="clinicianLogout" type="button">Sign out</button></div></header><div class="net"><span>Emergency referrals across PHC Link</span><span id="networkIndicator"></span><span>'+rows.length+' active</span></div><main class="body"><section class="clinician-heading"><div><span class="eyebrow">CLINICAL RESPONSE DESK</span><h2>Emergency referrals</h2><p>Review incoming emergencies and respond to the originating PHC.</p></div></section><div class="clinician-referral-list">'+cards+'</div></main></div></div>';
    applyFacilityLanguage();updateSyncIndicator();
    clearInterval(window.phcClinicianPoll);
    window.phcClinicianPoll=setInterval(async()=>{if(document.hidden)return;try{const latest=await api("/api/referrals/clinician/inbox");if((latest.referrals||[]).map(x=>x.id+":"+x.updated_at).join("|")!==rows.map(x=>x.id+":"+x.updated_at).join("|"))clinicianWorkspace();}catch(_){}},5000);
  }catch(error){root.innerHTML='<section class="panel"><h2>Clinician workspace unavailable</h2><p class="sub">'+escapeHtml(error.message)+'</p><button class="btn sec" onclick="clinicianWorkspace()">Retry</button></section>';}
}

function iconSvg(name){const paths={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',stock:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12v9"/>',ref:'<path d="M4 7h14m-4-4 4 4-4 4M20 17H6m4-4-4 4 4 4"/>',patients:'<circle cx="10" cy="8" r="4"/><path d="M3 21v-1a7 7 0 0 1 14 0v1M18 8h4m-2-2v4"/>',ussd:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'};return '<svg class="facility-nav-icon" viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||'')+'</svg>';}
function field(label,name,type="text",required=true,extra="") {
  return '<label for="'+name+'">'+label+'</label><input id="'+name+'" name="'+name+'" type="'+type+'" '+(required?'required':'')+' '+extra+'>';
}
function selectField(label,name,options,placeholder="Select an option",required=true) {
  return '<label for="'+name+'">'+label+'</label><select id="'+name+'" name="'+name+'" '+(required?"required":"")+'><option value="">'+placeholder+'</option>'+options+'</select>';
}
function formPanel(title,description,formId,fields,button) {
  return '<section class="panel admin-panel"><div class="panel-head"><div><h3>'+title+'</h3><p>'+description+'</p></div></div><form id="'+formId+'" class="admin-form">'+fields+'<button class="btn" type="submit">'+button+'</button></form></section>';
}
function options(rows,valueKey,labelFn) {
  return rows.map(row=>'<option value="'+escapeHtml(row[valueKey])+'">'+escapeHtml(labelFn(row))+'</option>').join("");
}
function setupView(bootstrapConfigured) {
  const setupMessage = bootstrapConfigured ? "Setup key is configured. Complete the form below to create the first administrator." : "Add BOOTSTRAP_SECRET to Render → phc-link-api → Environment. Generate it with openssl rand -hex 32, then use the same value below.";
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">FIRST-TIME CONFIGURATION</div><h2>Set up PHC Link</h2><p class="sub">Create the first system administrator and your initial state and LGA.</p></div></div><div class="panel setup-panel"><div class="banner">'+setupMessage+'</div><form id="bootstrapForm" class="admin-form">'+field("Bootstrap secret","bootstrapSecret","password",true,'autocomplete="off"')+field("Administrator full name","fullName")+field("Administrator email","email","email")+field("Administrator password (minimum 12 characters)","password","password",true,'minlength="12" autocomplete="new-password"')+field("State","stateName")+field("Local Government Area (LGA)","lgaName")+'<button class="btn" type="submit">Create system administrator</button></form></div></section>';
}
function passwordField(label,name,autocomplete,signup=false) {
  return '<label for="'+name+'">'+label+'</label><div class="password-wrap"><input id="'+name+'" name="'+name+'" type="password" required autocomplete="'+autocomplete+'" '+(signup?'minlength="8" pattern="[A-Za-z0-9]{8,}" title="Use at least 8 letters and numbers only"':'')+'><button class="password-toggle" type="button" data-toggle-password="'+name+'" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button></div>';
}
function loginView() {
  return '<section class="auth-shell"><div class="auth-card"><div class="auth-mark">+</div><div class="eyebrow">SECURE ACCESS</div><h2>Welcome to PHC Link</h2><p class="sub">Sign in with your registered account. Your role determines which workspace opens.</p><form id="loginForm" class="admin-form">'+field("Email address","loginEmail","email",true,'autocomplete="username"')+passwordField("Password","loginPassword","current-password")+'<button class="btn" type="submit">Sign in</button></form><p class="auth-switch">New to PHC Link? <button type="button" data-auth-view="signup">Create an account</button></p><p class="auth-note">New registrations start as health workers. An administrator must assign your facility before you can use the facility workspace.</p></div></section>';
}
function signupView() {
  return '<section class="auth-shell"><div class="auth-card"><div class="auth-mark">+</div><div class="eyebrow">CREATE YOUR ACCOUNT</div><h2>Join PHC Link</h2><p class="sub">Register your staff account. Your default role will be Health worker.</p><form id="signupForm" class="admin-form">'+field("Full name","signupFullName","text",true,'autocomplete="name" maxlength="160"')+field("Email address","signupEmail","email",true,'autocomplete="email"')+passwordField("Password (at least 8 letters and numbers)","signupPassword","new-password",true)+passwordField("Confirm password","signupPasswordConfirm","new-password",true)+'<button class="btn" type="submit">Create account</button></form><p class="auth-switch">Already registered? <button type="button" data-auth-view="login">Sign in</button></p><p class="auth-note">Your account is created with the Health worker role. Contact your administrator to change your role or assign a facility.</p></div></section>';
}
function adminPatientDirectory(data) {
  const filters=STATE.adminPatientFilters||{state:"",lga:"",facility:"",search:""};
  const patients=data.patients||[];
  const filtered=patients.filter(patient=>{
    if(filters.state&&patient.state_name!==filters.state)return false;
    if(filters.lga&&patient.lga_name!==filters.lga)return false;
    if(filters.facility&&patient.facility_id!==filters.facility)return false;
    const term=filters.search.trim().toLowerCase();
    return !term||[patient.full_name,patient.patient_code,patient.facility_name,patient.lga_name,patient.state_name].some(value=>String(value||"").toLowerCase().includes(term));
  });
  const grouped=new Map();
  filtered.forEach(patient=>{
    if(!grouped.has(patient.facility_id))grouped.set(patient.facility_id,{name:patient.facility_name,lga:patient.lga_name,state:patient.state_name,patients:[]});
    grouped.get(patient.facility_id).patients.push(patient);
  });
  const groups=Array.from(grouped.values()).map(group=>'<section class="panel admin-panel admin-patient-facility"><div class="panel-head"><div><h3>'+escapeHtml(group.name)+'</h3><p>'+escapeHtml(group.lga)+' · '+escapeHtml(group.state)+'</p></div><span class="count-label">'+group.patients.length+' patients</span></div><div class="table-wrap"><table><thead><tr><th>Patient code</th><th>Patient name</th><th>Sex</th><th>Date registered</th></tr></thead><tbody>'+group.patients.map(patient=>'<tr><td><strong>'+escapeHtml(patient.patient_code)+'</strong></td><td>'+escapeHtml(patient.full_name)+'</td><td>'+escapeHtml(patient.sex||"Not recorded")+'</td><td>'+escapeHtml(new Date(patient.created_at).toLocaleDateString())+'</td></tr>').join("")+'</tbody></table></div></section>').join("");
  const stateOptions='<option value="">All states</option>'+Array.from(new Set(patients.map(p=>p.state_name))).sort().map(name=>'<option value="'+escapeHtml(name)+'" '+(filters.state===name?'selected':'')+'>'+escapeHtml(name)+'</option>').join("");
  const lgaOptions='<option value="">All LGAs</option>'+Array.from(new Set(patients.filter(p=>!filters.state||p.state_name===filters.state).map(p=>p.lga_name))).sort().map(name=>'<option value="'+escapeHtml(name)+'" '+(filters.lga===name?'selected':'')+'>'+escapeHtml(name)+'</option>').join("");
  const facilityOptions='<option value="">All facilities</option>'+Array.from(new Map(patients.filter(p=>(!filters.state||p.state_name===filters.state)&&(!filters.lga||p.lga_name===filters.lga)).map(p=>[p.facility_id,p.facility_name])).entries()).sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>'<option value="'+escapeHtml(id)+'" '+(filters.facility===id?'selected':'')+'>'+escapeHtml(name)+'</option>').join("");
  return '<section id="adminPatients" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">PATIENT DIRECTORY</span><h3>Registered patients</h3><p>View patient registrations grouped by their registered healthcare facility.</p></div><span class="admin-section-count">'+patients.length+' total patients</span></div><section class="panel admin-panel admin-patient-filters"><div class="admin-patient-filter-grid"><input id="adminPatientSearch" type="search" placeholder="Search name, patient code or facility" value="'+escapeHtml(filters.search)+'" aria-label="Search patients"><select id="adminPatientStateFilter" aria-label="Filter by state">'+stateOptions+'</select><select id="adminPatientLgaFilter" aria-label="Filter by LGA">'+lgaOptions+'</select><select id="adminPatientFacilityFilter" aria-label="Filter by facility">'+facilityOptions+'</select></div><p class="admin-muted">Showing '+filtered.length+' of '+patients.length+' registered patients</p></section>'+(groups||'<section class="panel admin-panel"><div class="admin-empty"><span class="admin-empty-icon">♙</span><strong>No patient records found</strong><p>Patient registrations will appear here, grouped by facility.</p></div></section>')+'</section>';
}

function adminIcon(name) {
  const paths = {
    overview:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9 21v-7h6v7"/>',
    setup:'<path d="M12 5v14M5 12h14"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    referrals:'<path d="M17 3h4v4"/><path d="M3 7V5a2 2 0 0 1 2-2h16"/><path d="m21 3-7 7"/><path d="M7 21H3v-4"/><path d="M21 17v2a2 2 0 0 1-2 2H3"/><path d="m3 21 7-7"/>',
    patients:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    directory:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M9 21V9h6v12M3 9h18"/>',
    shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    logout:'<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/>',
    map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
    pin:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    facility:'<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5M9 9h.01M15 9h.01M9 12h.01M15 12h.01"/>',
    stock:'<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'
  };
  return '<svg class="admin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(paths[name]||paths.overview)+'</svg>';
}

function adminWorkspace(data) {
  const stateOpts=options(data.states,"id",r=>r.name);
  const lgaOpts=options(data.lgas,"id",r=>r.name+" — "+r.state_name);
  const facilityOpts=options(data.facilities,"id",r=>r.name+" — "+r.lga_name);
  const networkCards=[["States",data.states.length,"Geographic coverage","map"],["LGAs",data.lgas.length,"Local government areas","pin"],["Facilities",data.facilities.length,"Registered care locations","facility"]];
  const operationsCards=[["User accounts",data.users.length,"Staff and administrators","users"],["Stock catalogue",data.items.length,"Reusable inventory items","stock"],["Referrals",data.referralCount??(data.referrals||[]).length,"Patient transfers recorded","referrals"],["Patients",(data.patients||[]).length,"Registered across facilities","patients"]];
  const renderKpis=cards=>cards.map(([label,count,detail,mark])=>'<article class="admin-kpi"><div class="admin-kpi-top"><span>'+label+'</span><span class="admin-kpi-mark">'+adminIcon(mark)+'</span></div><strong>'+count+'</strong><small>'+detail+'</small></article>').join("");
  const kpis='<section class="admin-metric-group"><div class="admin-metric-heading"><div><span class="eyebrow">NETWORK</span><h3>Geographic coverage</h3></div><span>Service structure</span></div><div class="admin-kpis admin-kpis-network">'+renderKpis(networkCards)+'</div></section><section class="admin-metric-group admin-metric-group-operations"><div class="admin-metric-heading"><div><span class="eyebrow">OPERATIONS</span><h3>Platform activity</h3></div><span>Live records</span></div><div class="admin-kpis admin-kpis-operations">'+renderKpis(operationsCards)+'</div></section>';
  const list=(rows,columns)=>rows.length?'<div class="table-wrap"><table><thead><tr>'+columns.map(c=>'<th>'+c[0]+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(c=>'<td>'+escapeHtml(c[1](row))+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>':'<div class="admin-empty"><span class="admin-empty-icon">＋</span><strong>Nothing here yet</strong><p>Records will appear here once they have been added.</p></div>';
  const userRows=data.users.length?'<div class="table-wrap"><table><thead><tr><th>User</th><th>Current role</th><th>Account status</th><th>Assigned facility</th><th>Assign / change facility</th><th>Update role</th></tr></thead><tbody>'+data.users.map(user=>{
    const canAssign=["health_worker","clinician"].includes(user.role);
    const assigned=(user.assigned_facilities||[]).length?'<span class="admin-facility-chip">'+escapeHtml(user.assigned_facilities[0])+'</span>':'<span class="admin-unassigned">No facility assigned</span>';
    return '<tr><td><div class="admin-user-cell"><span class="admin-avatar">'+escapeHtml((user.full_name||"U").trim().charAt(0).toUpperCase())+'</span><span><strong>'+escapeHtml(user.full_name)+'</strong><small>'+escapeHtml(user.email)+'</small></span></div></td><td><span class="admin-role">'+escapeHtml(user.role.replace(/_/g," ")+(user.designation?" · "+user.designation.replace(/_/g," "):""))+'</span></td><td><span class="admin-status '+(user.is_active?"active":"inactive")+'">'+(user.is_active?"Active":"Disabled")+'</span></td><td><div class="admin-assigned-facilities">'+assigned+'</div></td><td>'+(canAssign?'<div class="role-edit admin-assign-control"><select aria-label="Facility for '+escapeHtml(user.full_name)+'" data-user-facility="'+escapeHtml(user.id)+'"><option value="">Select facility</option>'+options(data.facilities,"id",r=>r.name+" — "+r.lga_name)+'</select><button class="btn sec sm" type="button" data-assign-facility="'+escapeHtml(user.id)+'">Assign</button></div>':'<span class="admin-muted">Not applicable</span>')+'</td><td><div class="role-edit"><select aria-label="Role for '+escapeHtml(user.full_name)+'" data-user-role="'+escapeHtml(user.id)+'"><option value="health_worker" '+(user.role==="health_worker"?"selected":"")+'>Health worker</option><option value="clinician" '+(user.role==="clinician"?"selected":"")+'>Clinician</option><option value="lga_officer" '+(user.role==="lga_officer"?"selected":"")+'>LGA officer</option><option value="state_admin" '+(user.role==="state_admin"?"selected":"")+'>State admin</option><option value="system_admin" '+(user.role==="system_admin"?"selected":"")+'>System admin</option></select><button class="btn sec sm" type="button" data-save-user-role="'+escapeHtml(user.id)+'">Save</button></div></td></tr>';
  }).join("")+'</tbody></table></div>':'<div class="admin-empty"><span class="admin-empty-icon">♙</span><strong>No user accounts yet</strong><p>Create accounts for staff and administrators to get started.</p></div>';
  return '<div class="admin-app"><aside class="admin-sidebar"><a class="admin-side-brand" href="admin.html"><span class="admin-brand-mark">'+adminIcon("setup")+'</span><span><strong>PHC Link</strong><small>ADMIN CONSOLE</small></span></a><div class="admin-side-label">WORKSPACE</div><nav class="admin-nav" aria-label="Administration navigation"><a class="active" href="#adminOverview">'+adminIcon("overview")+'Overview</a><a href="#adminSetup">'+adminIcon("setup")+'Set up system</a><a href="#adminUsers">'+adminIcon("users")+'User accounts</a><a href="#adminReferrals">'+adminIcon("referrals")+'Referrals</a><a href="#adminPatients">'+adminIcon("patients")+'Patients</a><a href="#adminDirectory">'+adminIcon("directory")+'Directories</a></nav><div class="admin-sidebar-bottom"><div class="admin-security-note">'+adminIcon("shield")+'<div><strong>Secure workspace</strong><small>System administrator access</small></div></div><button class="admin-logout" id="logoutButton" type="button">'+adminIcon("logout")+'<span>Sign out</span></button></div></aside><div class="admin-main"><header class="admin-topbar"><div><span class="admin-breadcrumb">PHC LINK</span><span class="admin-breadcrumb-sep">/</span><strong>Administration</strong></div><div class="admin-account"><span class="admin-avatar">'+escapeHtml((STATE.user.fullName||"A").trim().charAt(0).toUpperCase())+'</span><span><strong>'+escapeHtml(STATE.user.fullName)+'</strong><small>System administrator</small></span></div></header><div class="admin-content"><section id="adminOverview" class="admin-welcome"><div><div class="eyebrow">SYSTEM OVERVIEW</div><h2>Good day, '+escapeHtml((STATE.user.fullName||"Administrator").split(" ")[0])+'</h2><p>Manage your healthcare network, staff access and inventory catalogue from one place.</p></div><span class="admin-live-label"><i></i> Live database</span></section><section class="admin-overview-metrics">'+kpis+'</section><section id="adminSetup" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">CONFIGURATION</span><h3>Set up your network</h3><p>Build the geographic structure and register the resources PHC Link needs.</p></div><span class="admin-section-count">3-step workflow</span></div><div class="admin-forms-grid">'+
    '<section class="panel admin-panel network-setup-panel"><div class="panel-head"><div><h3>Set up your network</h3><p>Create the state, its LGA and the facility together in one submission.</p></div><span class="count-label">One form</span></div><form id="networkSetupForm" class="network-setup-form">'+
      '<div class="network-form-section"><div class="network-form-heading"><span>01</span><div><strong>State details</strong><small>Top level of your service network</small></div></div><div class="network-form-fields">'+field("State name","stateName")+field("State code (optional)","stateCode","text",false)+'</div></div>'+
      '<div class="network-form-section"><div class="network-form-heading"><span>02</span><div><strong>Local government area</strong><small>Belongs to the state entered above</small></div></div><div class="network-form-fields">'+field("LGA name","lgaName")+'</div></div>'+
      '<div class="network-form-section"><div class="network-form-heading"><span>03</span><div><strong>Healthcare facility</strong><small>Belongs to the LGA entered above</small></div></div><div class="network-form-fields">'+field("Facility name","facilityName")+field("Facility code","facilityCode")+field("Address (optional)","facilityAddress","text",false)+'</div></div>'+
      '<div class="network-form-actions"><p>All three records will be created in sequence.</p><button class="btn" type="submit">Create network</button></div></form></section>'+
    formPanel("Create a user account","Create staff access and assign the appropriate scope.","userForm",field("Full name","fullName")+field("Email address","email","email")+field("Temporary password (minimum 12 characters)","password","password",true,'minlength="12"')+selectField("Account role","role",'<option value="health_worker">Health worker</option><option value="clinician">Clinician</option><option value="lga_officer">LGA officer</option>')+selectField("Assigned facility","facilityId",facilityOpts,"Choose a facility — if applicable",false)+selectField("Assigned LGA","lgaId",lgaOpts,"Choose an LGA — if applicable",false)+selectField("Clinician designation","designation",'<option value="">Not applicable — health workers and LGA officers</option><option value="doctor">Doctor</option><option value="medical_officer">Medical Officer</option><option value="nurse">Nurse</option><option value="midwife">Midwife</option><option value="chew">CHEW</option><option value="cho">CHO</option>',"Select designation — clinicians only",false)+field("Phone number (optional)","phone","tel",false),"Create account")+
    formPanel("Add an inventory item","Create a catalogue item that facilities can track.","itemForm",field("Item name","name")+field("Category","category")+field("Unit of measure","unit")+field("Minimum stock alert level","minimumStock","number",true,'min="0" step="0.01" value="0"'),"Add inventory item")+
    '</div></section><section id="adminUsers" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">ACCESS CONTROL</span><h3>User accounts</h3><p>Review staff accounts, assign one facility to each health worker, and manage user roles.</p></div><span class="admin-section-count">'+data.users.length+' accounts</span></div><section class="panel admin-panel admin-table-panel">'+userRows+'</section></section><div id="adminPatientDirectory"> '+adminPatientDirectory(data)+ '</div><section id="adminReferrals" class="admin-section">'+
'<div class="admin-section-heading"><div><span class="eyebrow">PATIENT TRANSFERS</span><h3>Referral records</h3><p>All referrals submitted across registered facilities, including their origin, destination and current status.</p></div><span class="admin-section-count">'+(data.referralCount||0)+' total referrals</span></div>'+
'<section class="panel admin-panel admin-table-panel"><div class="table-wrap"><table>'+
'<thead><tr><th>Referral code</th><th>Origin facility</th><th>Destination facility</th><th>Created by</th><th>Reason</th><th>Urgency</th><th>Status</th><th>Date created</th></tr></thead>'+
'<tbody>'+((data.referrals||[]).length?(data.referrals||[]).map(r=>'<tr><td><strong>'+escapeHtml(r.referral_code)+'</strong></td><td>'+escapeHtml(r.origin_facility)+' <small>'+escapeHtml(r.origin_lga)+'</small></td><td>'+escapeHtml(r.destination_facility)+' <small>'+escapeHtml(r.destination_lga)+'</small></td><td>'+escapeHtml(r.created_by_name||"Unavailable")+'</td><td>'+escapeHtml(r.reason_code)+'</td><td>'+escapeHtml(r.urgency)+'</td><td><span class="pill '+(r.status==="completed"?"ok":(r.status==="rejected"||r.status==="cancelled"?"out":"q"))+'">'+escapeHtml(r.status)+'</span></td><td>'+escapeHtml(new Date(r.created_at).toLocaleString())+'</td></tr>').join(""):'<tr><td colspan="8">No referrals have been submitted yet.</td></tr>')+'</tbody></table></div></section></section><section id="adminDirectory" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">NETWORK DIRECTORY</span><h3>Registered records</h3><p>Review the locations and catalogue entries currently in the system.</p></div></div><div class="admin-directory-grid"><section class="panel admin-panel"><div class="panel-head"><div><h3>Healthcare facilities</h3><p>Registered service locations</p></div><span class="count-label">'+data.facilities.length+'</span></div>'+list(data.facilities,[["Facility",r=>r.name],["Code",r=>r.code||"—"],["LGA",r=>r.lga_name],["State",r=>r.state_name]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Inventory catalogue</h3><p>Items available for stock tracking</p></div><span class="count-label">'+data.items.length+'</span></div>'+list(data.items,[["Item",r=>r.name],["Category",r=>r.category],["Unit",r=>r.unit],["Minimum",r=>r.default_minimum_stock]])+'</section></div></section><footer class="admin-footer">PHC Link · Administration <span>Secure healthcare operations</span></footer></div></div></div>';
}
async function dashboardView() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Loading administration…</p></div>';
  try {
    const me=await api("/api/auth/me"); STATE.user=me.user;
    if(STATE.user.role!=="system_admin"){
      if(STATE.user.role==="health_worker") window.location.replace("facility.html");
      else if(STATE.user.role==="clinician") window.location.replace("clinician.html");
      else root.innerHTML='<section class="panel setup-panel"><h2>Access denied</h2><p class="sub">This account is not authorised to use system administration.</p><button class="btn sec" id="logoutButton" type="button">Sign out</button></section>';
      return;
    }
    const data=await api("/api/admin/overview"); STATE.admin=data; root.innerHTML=adminWorkspace(data);
  } catch(error) {
    if(error.message==="Authentication required.") window.location.replace("index.html");
    else root.innerHTML='<section class="panel"><h2>Administration unavailable</h2><p class="sub">'+escapeHtml(error.message)+'</p><button class="btn sec" onclick="dashboardView()">Retry</button></section>';
  }
}
async function loginPageView() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Checking account access…</p></div>';
  try {
    const setup=await api("/api/setup/status",{headers:{}});
    if(!setup.initialized){root.innerHTML=setupView(setup.bootstrapConfigured);return;}
    try {
      const me=await api("/api/auth/me"), role=me.user.role;
      if(role==="system_admin") window.location.replace("admin.html");
      else if(role==="health_worker") window.location.replace("facility.html");
      else if(role==="clinician") window.location.replace("clinician.html");
      else root.innerHTML='<section class="panel setup-panel"><h2>Workspace unavailable</h2><p class="sub">Your account role does not have a workspace yet. Contact the system administrator.</p><button class="btn sec" id="logoutButton" type="button">Sign out</button></section>';
    } catch(error) {
      if(error.message==="Authentication required.") root.innerHTML=loginView();
      else throw error;
    }
  } catch(error) {
    root.innerHTML='<section class="panel"><h2>Sign in unavailable</h2><p class="sub">'+escapeHtml(error.message)+'</p><button class="btn sec" onclick="loginPageView()">Retry</button></section>';
  }
}
function render() {
  if(WORKSPACE==="admin") dashboardView();
  else if(WORKSPACE==="facility") facilityWorkspace();
  else if(WORKSPACE==="clinician") clinicianWorkspace();
  else loginPageView();
}
async function checkApiConnection() {
  const node=document.getElementById("apiStatus"); if(!node)return;
  try {
    const result=await api("/api/health",{headers:{}});
    node.textContent=result.status==="ok"&&result.database==="connected"?"API connected · Database connected":"API reachable";
  } catch(error) { node.textContent="Backend unavailable"; }
}
function formData(form){return Object.fromEntries(new FormData(form).entries());}
function rootAuthLogin(){const root=document.getElementById("root");if(root)root.innerHTML=loginView();}
async function handleSubmit(event) {
  const form=event.target; if(!(form instanceof HTMLFormElement))return;
  const routes={
    stateForm:["/api/admin/states",d=>({name:d.name,code:d.code||null})],
    lgaForm:["/api/admin/lgas",d=>d],
    facilityForm:["/api/admin/facilities",d=>d],
    userForm:["/api/admin/users",d=>d],
    itemForm:["/api/admin/inventory-items",d=>({name:d.name,category:d.category,unit:d.unit,minimumStock:Number(d.minimumStock)})]
  };
  if(form.id==="networkSetupForm"){
    event.preventDefault();
    const d=formData(form);
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true;button.textContent="Creating network…";
    try{
      const stateResult=await api("/api/admin/states",{method:"POST",body:JSON.stringify({name:d.stateName,code:d.stateCode||null})});
      const lgaResult=await api("/api/admin/lgas",{method:"POST",body:JSON.stringify({stateId:stateResult.state.id,name:d.lgaName})});
      await api("/api/admin/facilities",{method:"POST",body:JSON.stringify({lgaId:lgaResult.lga.id,name:d.facilityName,code:d.facilityCode,address:d.facilityAddress||null})});
      notify("Network created: state, LGA and facility added.");
      await dashboardView();
    }catch(error){
      notify("Network setup stopped: "+error.message+" Earlier steps may already have been saved. Check the directories before retrying.",true);
      button.disabled=false;button.textContent="Retry network setup";
    }
    return;
  }
  if(form.id==="bootstrapForm"){
    event.preventDefault();const d=formData(form);
    try{await api("/api/setup/bootstrap",{method:"POST",headers:{"x-bootstrap-secret":d.bootstrapSecret},body:JSON.stringify({fullName:d.fullName,email:d.email,password:d.password,stateName:d.stateName,lgaName:d.lgaName})});notify("Administrator created. Sign in now.");loginPageView();}
    catch(error){notify(error.message,true);}return;
  }
  if(form.id==="signupForm"){event.preventDefault();const d=formData(form);if(d.signupPassword!==d.signupPasswordConfirm){notify("The passwords do not match.",true);return;}if(!/^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{8,}$/.test(d.signupPassword)){notify("Password must be at least 8 characters and contain letters and numbers only.",true);return;}try{await api("/api/auth/signup",{method:"POST",body:JSON.stringify({fullName:d.signupFullName,email:d.signupEmail,password:d.signupPassword})});notify("Account created. You can now sign in.");rootAuthLogin();}catch(error){notify(error.message,true);}return;}
  if(form.id==="loginForm"){
    event.preventDefault();const d=formData(form);
    try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:d.loginEmail,password:d.loginPassword})});STATE.user=result.user;notify("Signed in successfully.");window.location.assign(result.user.role==="system_admin"?"admin.html":(result.user.role==="clinician"?"clinician.html":(result.user.role==="health_worker"?"facility.html":"index.html")));}
    catch(error){notify(error.message,true);}return;
  }
  if(form.id==="stockMovementForm"){
    event.preventDefault();
    const d=formData(form);
    const payload={operationId:crypto.randomUUID(),facilityId:STATE.facilityId,itemId:d.itemId,movementType:d.movementType,quantity:Number(d.quantity),adjustmentDirection:d.adjustmentDirection||"increase",batchNumber:d.batchNumber||null,expiryDate:d.expiryDate||null,note:d.note||null};
    try{await api("/api/inventory/movements",{method:"POST",body:JSON.stringify(payload)});notify("Stock movement recorded.");await facilityWorkspace();}
    catch(error){if(queueOfflineAction("/api/inventory/movements",payload,error))notify("Saved Offline — Will Send When Network Comes");else notify(error.message,true);}
    return;
  }
  if(form.id==="patientForm"){
    event.preventDefault();
    const d=formData(form);
    const payload={operationId:crypto.randomUUID(),facilityId:STATE.facilityId,fullName:d.patientFullName,dateOfBirth:d.patientDateOfBirth||null,sex:d.patientSex||null,phone:d.patientPhone||null};
    try{
      const result=await api("/api/patients",{method:"POST",body:JSON.stringify(payload)});
      notify("Patient registered: "+result.patient.patient_code);await facilityWorkspace();
    }catch(error){if(queueOfflineAction("/api/patients",payload,error))notify("Saved Offline — Will Send When Network Comes");else notify(error.message,true);}
    return;
  }
  if(form.id==="referralForm"){
    event.preventDefault();
    const d=formData(form);
    const payload={operationId:crypto.randomUUID(),originFacilityId:STATE.facilityId,destinationFacilityId:d.destinationFacilityId,patientId:d.patientId,reasonCode:d.reasonCode.trim(),urgency:d.urgency};
    try{const result=await api("/api/referrals",{method:"POST",body:JSON.stringify(payload)});notify("Referral created: "+result.referral.referral_code);await facilityWorkspace();}
    catch(error){if(queueOfflineAction("/api/referrals",payload,error))notify("Saved Offline — Will Send When Network Comes");else notify(error.message,true);}
    return;
  }
  const config=routes[form.id];if(!config)return;
  event.preventDefault();
  try{await api(config[0],{method:"POST",body:JSON.stringify(config[1](formData(form)))});notify("Record saved successfully.");await dashboardView();}
  catch(error){notify(error.message,true);}
}
document.addEventListener("submit",handleSubmit);
document.addEventListener("click",event=>{
  const switcher=event.target.closest("[data-auth-view]");
  if(switcher){document.getElementById("root").innerHTML=switcher.dataset.authView==="signup"?signupView():loginView();return;}
  const toggle=event.target.closest("[data-toggle-password]");
  if(toggle){const input=document.getElementById(toggle.dataset.togglePassword);if(input){const show=input.type==="password";input.type=show?"text":"password";toggle.setAttribute("aria-label",show?"Hide password":"Show password");toggle.title=show?"Hide password":"Show password";toggle.classList.toggle("is-visible",show);}return;}
  const assign=event.target.closest("[data-assign-facility]");
  if(assign){
    const userId=assign.dataset.assignFacility;
    const select=document.querySelector('[data-user-facility="'+userId+'"]');
    if(!select||!select.value){notify("Select a facility first.",true);return;}
    assign.disabled=true;
    api("/api/admin/users/"+encodeURIComponent(userId)+"/facilities",{method:"POST",body:JSON.stringify({facilityId:select.value})})
      .then(()=>{notify("Facility assigned successfully.");dashboardView();})
      .catch(error=>{notify(error.message,true);assign.disabled=false;});
    return;
  }
  const save=event.target.closest("[data-save-user-role]");
  if(save){const id=save.dataset.saveUserRole;const select=document.querySelector('[data-user-role="'+id+'"]');save.disabled=true;api("/api/admin/users/"+encodeURIComponent(id)+"/role",{method:"PATCH",body:JSON.stringify({role:select.value})}).then(()=>{notify("User role updated.");dashboardView();}).catch(error=>{notify(error.message,true);save.disabled=false;});}
});
document.addEventListener("change",event=>{
  if(event.target.id==="facilityPicker"){STATE.facilityId=event.target.value;facilityWorkspace();return;}
  if(["adminPatientStateFilter","adminPatientLgaFilter","adminPatientFacilityFilter"].includes(event.target.id)){
    STATE.adminPatientFilters=STATE.adminPatientFilters||{state:"",lga:"",facility:"",search:""};
    if(event.target.id==="adminPatientStateFilter"){STATE.adminPatientFilters.state=event.target.value;STATE.adminPatientFilters.lga="";STATE.adminPatientFilters.facility="";}
    if(event.target.id==="adminPatientLgaFilter"){STATE.adminPatientFilters.lga=event.target.value;STATE.adminPatientFilters.facility="";}
    if(event.target.id==="adminPatientFacilityFilter")STATE.adminPatientFilters.facility=event.target.value;
    const container=document.getElementById("adminPatientDirectory");if(container)container.innerHTML=adminPatientDirectory(STATE.admin);
  }
});
document.addEventListener("input",event=>{
  if(event.target.id==="adminPatientSearch"){
    STATE.adminPatientFilters=STATE.adminPatientFilters||{state:"",lga:"",facility:"",search:""};
    STATE.adminPatientFilters.search=event.target.value;
    const container=document.getElementById("adminPatientDirectory");if(container)container.innerHTML=adminPatientDirectory(STATE.admin);
    const search=document.getElementById("adminPatientSearch");if(search){search.focus();search.setSelectionRange(search.value.length,search.value.length);}
  }
});
document.addEventListener("click",async event=>{
  const language=event.target.closest("[data-language-switch]");
  if(language){localStorage.setItem("phclink-language",currentLanguage()==="ha"?"en":"ha");applyFacilityLanguage();return;}
  const clinicianAction=event.target.closest("[data-clinician-action]");
  if(clinicianAction){
    const id=clinicianAction.dataset.referralId;
    const form=document.querySelector('.clinician-response-form[data-referral-id="'+id+'"]');
    const notes=form?.querySelector("textarea")?.value.trim()||null;
    clinicianAction.disabled=true;
    try{await api("/api/referrals/"+encodeURIComponent(id)+"/status",{method:"PATCH",body:JSON.stringify({status:clinicianAction.dataset.clinicianAction,notes})});notify(clinicianAction.dataset.clinicianAction==="acknowledged"?"Referral accepted. PHC has been notified.":"Referral declined. PHC has been notified.");clinicianWorkspace();}
    catch(error){notify(error.message,true);clinicianAction.disabled=false;}
    return;
  }
  if(event.target.closest("#logoutButton")||event.target.closest("#staffLogout")||event.target.closest("#clinicianLogout")){
    try{await api("/api/auth/logout",{method:"POST"});}catch(_){}finally{Object.keys(localStorage).filter(key=>key.startsWith("phclink-cache:")).forEach(key=>localStorage.removeItem(key));STATE.user=null;STATE.facilityId=null;notify("Signed out. Pending offline actions remain saved on this device.");window.location.assign("index.html");}
    catch(error){notify(error.message,true);}
  }
});
render();
window.addEventListener("online",flushOfflineQueue);
window.addEventListener("offline",updateSyncIndicator);
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js").catch(()=>{}));

function initTheme() {
  const stored = localStorage.getItem("phc-link-theme");
  const preferred = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const apply = theme => {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById("themeToggle");
    if (button) {
      button.innerHTML = theme === "dark" ? '<span aria-hidden="true">☀</span><span>Light mode</span>' : '<span aria-hidden="true">☾</span><span>Dark mode</span>';
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      button.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#101b25" : "#ffffff";
  };
  const initial = stored === "dark" || stored === "light" ? stored : preferred;
  apply(initial);
  if (!document.getElementById("themeToggle")) {
    const button = document.createElement("button");
    button.id = "themeToggle";
    button.className = "theme-toggle";
    button.type = "button";
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem("phc-link-theme", next);
      apply(next);
    });
    document.body.appendChild(button);
    apply(initial);
  }
}

initTheme();
