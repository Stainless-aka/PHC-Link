/* PHC Link: live API-backed administration and facility shell. */
const PAGE = document.body.dataset.page || "home";
const WORKSPACE = document.body.dataset.workspace || "login";
const API_BASE_URL = "";
const STATE = { page:PAGE, admin:null, user:null, facilityId:null, busy:false, offlineMode:false };
const OFFLINE_PROFILE_KEY="phclink-offline-profile-v1";
const OFFLINE_ACCESS_DAYS=7;
function readOfflineProfile(){try{const value=JSON.parse(localStorage.getItem(OFFLINE_PROFILE_KEY)||"null");return value&&Date.now()<value.expiresAt?value:null;}catch(_){return null;}}
function bytesToBase64(bytes){return btoa(String.fromCharCode(...bytes));}
function base64ToBytes(value){return Uint8Array.from(atob(value),char=>char.charCodeAt(0));}
async function deriveOfflinePin(pin,salt){const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);return new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:310000,hash:"SHA-256"},material,256));}
async function saveOfflineProfile(user,facilities,pin){
  if(!window.crypto?.subtle)throw new Error("Secure offline PIN storage is not supported by this browser.");
  const salt=crypto.getRandomValues(new Uint8Array(16)),verifier=await deriveOfflinePin(pin,salt);
  const profile={user,facilities,salt:bytesToBase64(salt),verifier:bytesToBase64(verifier),createdAt:Date.now(),expiresAt:Date.now()+OFFLINE_ACCESS_DAYS*86400000,failedAttempts:0,lockedUntil:0};
  localStorage.setItem(OFFLINE_PROFILE_KEY,JSON.stringify(profile));
  localStorage.setItem("phclink-cache:/api/auth/me",JSON.stringify({user}));
  localStorage.setItem("phclink-cache:/api/facilities",JSON.stringify({facilities}));
}
async function verifyOfflinePin(pin){
  const profile=readOfflineProfile();if(!profile)throw new Error("Offline access has expired. Connect and sign in again.");
  if(profile.lockedUntil>Date.now())throw new Error("Offline access is temporarily locked. Try again in 5 minutes.");
  const attempt=await deriveOfflinePin(pin,base64ToBytes(profile.salt)),expected=base64ToBytes(profile.verifier);
  const matches=attempt.length===expected.length&&attempt.every((value,index)=>value===expected[index]);
  if(!matches){profile.failedAttempts=Number(profile.failedAttempts||0)+1;if(profile.failedAttempts>=5){profile.failedAttempts=0;profile.lockedUntil=Date.now()+300000;}localStorage.setItem(OFFLINE_PROFILE_KEY,JSON.stringify(profile));throw new Error(profile.lockedUntil>Date.now()?"Too many incorrect PIN attempts. Try again in 5 minutes.":"Incorrect offline PIN.");}
  profile.failedAttempts=0;localStorage.setItem(OFFLINE_PROFILE_KEY,JSON.stringify(profile));return profile;
}
function offlinePinSetupView(user,facilities){
  const context=btoa(unescape(encodeURIComponent(JSON.stringify({user,facilities}))));
  document.getElementById("root").innerHTML='<section class="auth-shell"><div class="auth-card"><div class="auth-mark">+</div><div class="eyebrow">ENABLE OFFLINE ACCESS</div><h2>Create your offline PIN</h2><p class="sub">Choose a 6-digit PIN to unlock this previously authorised device when the network is unavailable. It does not replace your account password.</p><form id="offlinePinSetupForm" class="admin-form"><input type="hidden" name="offlineContext" value="'+context+'"><label for="offlinePin">6-digit PIN</label><input id="offlinePin" name="offlinePin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required><label for="offlinePinConfirm">Confirm PIN</label><input id="offlinePinConfirm" name="offlinePinConfirm" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required><button class="btn" type="submit">Save PIN and continue</button></form><p class="auth-note">Offline access expires after 7 days. Use this only on a trusted device.</p></div></section>';
}
function offlineLoginMarkup(){
  const profile=readOfflineProfile();
  const name=profile?.user?.fullName||profile?.user?.full_name||"Registered staff";
  return '<section class="offline-login-panel"><div class="eyebrow">NO NETWORK? USE OFFLINE ACCESS</div><h3>Welcome back, '+escapeHtml(name)+'</h3><p class="sub">Enter your saved 6-digit PIN to unlock this device.</p>'+(profile?'':'<p class="auth-note">No valid offline profile was found on this device. If you have not signed in online and created a PIN here before, offline access cannot be verified.</p>')+'<form id="offlineLoginForm" class="admin-form"><label for="offlineLoginPin">6-digit Offline PIN</label><input id="offlineLoginPin" name="offlineLoginPin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" placeholder="Enter your 6-digit PIN" required autofocus><button class="btn" type="submit">Unlock offline workspace</button></form><small>Offline access expires 7 days after your last online sign-in.</small></section>';
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
}
async function api(path, options={}) {
  const method=String(options.method||"GET").toUpperCase(), cacheKey="phclink-cache:"+path, route=path.split("?")[0], cacheable=method==="GET"&&(["/api/auth/me","/api/facilities","/api/facilities/referral-destinations","/api/inventory/items","/api/inventory/balances","/api/patients","/api/referrals","/api/alerts","/api/health-tips","/api/health-assistant/knowledge"].includes(route)||route==="/api/anc"||route.startsWith("/api/anc/"));
  if(STATE.offlineMode){
    if(method!=="GET")throw new Error("Network unavailable. Your action can be saved offline.");
    if(cacheable){try{const cached=localStorage.getItem(cacheKey);if(cached)return JSON.parse(cached);}catch(_){}}
    throw new Error("This information has not been saved on this device yet. Connect to the network and try again.");
  }
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
async function offlineSafeApi(path,fallback){
  try{return await api(path);}
  catch(error){
    if(!STATE.offlineMode)throw error;
    return {...fallback,_offlineUnavailable:true};
  }
}
function outboxKey(){return "phclink-outbox-v1:"+(STATE.user?.id||"unknown");}
function readOutbox(){try{return JSON.parse(localStorage.getItem(outboxKey())||"[]");}catch(_){return [];}}
function writeOutbox(items){try{localStorage.setItem(outboxKey(),JSON.stringify(items));return true;}catch(_){notify("Device storage is full. Connect and retry to avoid losing this action.",true);return false;}}
function updateSyncIndicator(){
  const node=document.getElementById("networkIndicator");if(!node)return;
  const count=readOutbox().length;
  node.innerHTML='<span class="sync-dot '+(navigator.onLine?"online":"offline")+'"></span>'+(navigator.onLine?"Online":"Offline")+(count?' · Saved: '+count+' waiting':'');
}
function queueOfflineAction(path,payload,error,method="POST"){
  if(navigator.onLine&&!/Network unavailable/i.test(error?.message||""))return false;
  const isPatientEdit=path.startsWith("/api/patients/")&&!path.endsWith("/visits")&&path.split("/").length===4;
  if(!["/api/inventory/movements","/api/patients","/api/referrals"].includes(path)&&!(path.startsWith("/api/patients/")&&path.endsWith("/visits"))&&!isPatientEdit&&!path.startsWith("/api/anc/"))return false;
  const operationId=payload.operationId||crypto.randomUUID();
  const item={id:operationId,path,method:isPatientEdit?"PATCH":method,payload:{...payload,operationId},createdAt:new Date().toISOString()};
  const queue=readOutbox();if(!queue.some(x=>x.id===item.id))queue.push(item);if(!writeOutbox(queue))return false;updateSyncIndicator();return true;
}
async function flushOfflineQueue(){
  if(!navigator.onLine||!STATE.user)return;
  const queue=readOutbox();if(!queue.length){updateSyncIndicator();return;}
  const remaining=[];
  let patientVisitSynced=false;
  for(let i=0;i<queue.length;i++){
    try{const synced=await api(queue[i].path,{method:queue[i].method,body:JSON.stringify(queue[i].payload)});if(queue[i].path==="/api/patients"&&synced.patientPin&&synced.qrCode)showPatientCard(synced);if(queue[i].path.startsWith("/api/patients/")&&(queue[i].path.endsWith("/visits")||queue[i].method==="PATCH")){const payload=queue[i].payload;const record=await api("/api/patients/lookup",{method:"POST",body:JSON.stringify({patientCode:payload.patientCode,pin:payload.pin})});await saveOfflinePatientRecord(record.patient.patient_code,payload.pin,{patient:record.patient,visits:record.visits||[]});if(STATE.openPatient?.patient_code===record.patient.patient_code){STATE.openPatient=record.patient;STATE.openPatientVisits=record.visits||[];}patientVisitSynced=true;}}
    catch(error){remaining.push(...queue.slice(i));break;}
  }
  writeOutbox(remaining);updateSyncIndicator();if(patientVisitSynced&&STATE.page==="patients")facilityWorkspace();
  if(queue.length>remaining.length)notify("Offline actions synchronised successfully.");
}
function showPatientCard(result){
  const patient=result.patient||{},pin=String(result.patientPin||"");
  const modal=document.createElement("div");modal.className="patient-card-modal";
  modal.innerHTML='<section class="patient-card-print"><div class="patient-card-brand">PHC LINK · PATIENT CARD</div><h3>'+escapeHtml(patient.full_name||"Patient")+'</h3><h2>'+escapeHtml(patient.patient_code)+'</h2><p>'+escapeHtml(patient.full_name||"Patient")+'</p><p>'+escapeHtml(patient.age_years??"—")+' years · '+escapeHtml(patient.sex||"")+'</p><img class="patient-card-qr" src="'+escapeHtml(result.qrCode||"")+'" alt="Patient QR code"><p class="patient-card-warning">Keep this PIN secret. Do not give it to strangers.</p><div class="patient-card-pin">PIN: <strong>'+escapeHtml(pin)+'</strong></div><div class="patient-card-actions"><button type="button" class="btn sec" data-print-patient-card>Print card</button><button type="button" class="btn" data-close-patient-card>Done</button></div></section>';
  document.body.appendChild(modal);
}
async function saveOfflinePatientRecord(patientCode,pin,record){
  if(!window.crypto?.subtle)return;
  const encoder=new TextEncoder(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const material=await crypto.subtle.importKey("raw",encoder.encode(String(pin)),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt"]);
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(JSON.stringify(record)));
  const encode=bytes=>btoa(String.fromCharCode(...bytes));
  localStorage.setItem("phclink-patient-cache:"+patientCode,JSON.stringify({salt:encode(salt),iv:encode(iv),data:encode(new Uint8Array(encrypted)),failed:0,lockedUntil:null,updatedAt:new Date().toISOString()}));
}
async function readOfflinePatientRecord(patientCode,pin){
  const keyName="phclink-patient-cache:"+String(patientCode||"").trim().toUpperCase(),stored=localStorage.getItem(keyName);
  if(!stored)throw new Error("No saved offline record for this Patient ID. Connect to the network and try again.");
  const cache=JSON.parse(stored);
  if(cache.lockedUntil&&Date.now()<cache.lockedUntil)throw new Error("Wrong PIN. Access is locked for 5 minutes.");
  const decode=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  try{
    const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(pin)),"PBKDF2",false,["deriveKey"]);
    const derived=await crypto.subtle.deriveKey({name:"PBKDF2",salt:decode(cache.salt),iterations:250000,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["decrypt"]);
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(cache.iv)},derived,decode(cache.data));
    cache.failed=0;cache.lockedUntil=null;localStorage.setItem(keyName,JSON.stringify(cache));
    return JSON.parse(new TextDecoder().decode(plain));
  }catch(error){
    cache.failed=Number(cache.failed||0)+1;
    if(cache.failed>=3){cache.failed=0;cache.lockedUntil=Date.now()+5*60*1000;}
    localStorage.setItem(keyName,JSON.stringify(cache));
    throw new Error(cache.lockedUntil?"Wrong PIN. Access is locked for 5 minutes.":"Wrong PIN.");
  }
}
function stopPatientQrScanner(){if(window.phcQrFrame)cancelAnimationFrame(window.phcQrFrame);window.phcQrFrame=null;if(window.phcQrStream){window.phcQrStream.getTracks().forEach(track=>track.stop());window.phcQrStream=null;}const video=document.getElementById("patientQrVideo");if(video)video.srcObject=null;const panel=document.getElementById("patientQrScanner");if(panel)panel.hidden=true;}
function notify(message, error=false) {
  const toast=document.getElementById("toast");
  if(!toast) return;
  toast.textContent=currentLanguage()==="ha"?(HAUSA[message]||message):message; toast.hidden=false;
  toast.style.background=error?"#8b3434":"#142f43";
  clearTimeout(notify.timer); notify.timer=setTimeout(()=>toast.hidden=true,4500);
}
const HAUSA={"Register patient and create card":"Yi rajistar mara lafiya da katin sa","Find patient":"Nemo mara lafiya","Search patient":"Nemo mara lafiya","Search":"Nema","4-digit patient PIN":"PIN mai lamba 4","Verify PIN and open record":"Tabbatar da PIN sannan bude bayanai","Patient history":"Tarihin mara lafiya","New visit":"Sabuwar ziyara","Complaint":"Korafi","Treatment / action taken":"Magani / matakin da aka dauka","Referral status":"Matsayin turawa","Clinician note (optional)":"Bayanin likita (ba dole ba)","Save new visit":"Ajiye sabuwar ziyara","Close record":"Rufe bayanai","Full name":"Cikakken suna","Age in years":"Shekaru","Next of kin name (optional)":"Sunan makusanci (ba dole ba)","Next of kin phone (optional)":"Wayar makusanci (ba dole ba)","Blood group (if known)":"Rukunin jini (idan an sani)","Known sickness (optional)":"Sanannun cututtuka (ba dole ba)","Allergies (optional)":"Abubuwan da ke jawo rashin lafiya (ba dole ba)","Not recorded":"Ba a rubuta ba","Not referred":"Ba a tura ba","Referred":"An tura","Accepted":"An karba","Completed":"An kammala","No previous visits recorded.":"Ba a samu tarihin ziyara ba.","Saved Offline — Will Send When Network Comes":"An ajiye ba tare da intanet ba — za a aika idan an samu hanyar sadarwa.","Wrong PIN.":"PIN ba daidai ba.","Wrong PIN. Access is locked for 5 minutes.":"PIN ba daidai ba. An kulle shiga na minti 5.", "Alert message testing":"Gwajin sakon gargadi", "Ask Health Assistant":"Tambayi Mataimakin Lafiya","Ask a short health question...":"Rubuta gajeriyar tambayar lafiya...","Ask":"Tambaya","I am a Health Assistant, for guidance only. Choose a topic or type a question.":"Ni Mataimakin Lafiya ne don jagora kawai. Zabi batu ko rubuta tambaya.","Checking saved guidance…":"Ana duba jagorar da aka ajiye…","Guidance only":"Jagora kawai","OFFLINE HEALTH SUPPORT":"TAIMAKON LAFIYA BA TARE DA INTANET BA","Alert type":"Nau'in gargadi","Short details":"Takaitaccen bayani","Simulate LoRa Message":"Gwada sakon LoRa","Simulate SMS Message":"Gwada sakon SMS","REF-OK · Referral Accepted · Send Patient Now":"REF-OK · An karbi turawa · A turo mara lafiya yanzu","REF-NO · No Bed / Cannot Accept":"REF-NO · Babu gado / Ba za a iya karba ba","Supported alert codes":"Lambobin gargadi da ake amfani da su","RED: emergency · YELLOW: warning · GREEN: normal activity":"JA: gaggawa · RAWAYA: gargadi · KORE: al'ada","PHC code:":"Lambar PHC:","Keep this PIN secret. Do not give it to strangers.":"A boye wannan PIN. Kada a ba wanda ba a sani ba.","Scan QR code":"Duba QR code","Save patient details":"Ajiye bayanan mara lafiya","Edit patient details":"Gyara bayanan mara lafiya","Patient details updated.":"An gyara bayanan mara lafiya.","Visit saved.":"An ajiye ziyarar.","QR code scanned. Enter the patient PIN.":"An duba QR code. Shigar da PIN na mara lafiya.","Unable to open the camera. Check camera permission or enter the Patient ID manually.":"Ba a iya bude kyamara ba. Duba izini ko shigar da lambar mara lafiya da hannu.","Patient details updated.":"An gyara bayanan mara lafiya.","Visit saved.":"An ajiye ziyarar.","Edit patient details":"Gyara bayanan mara lafiya","Save patient details":"Ajiye bayanan mara lafiya","Date of birth (optional)":"Ranar haihuwa (ba dole ba)","Known sickness":"Sanannun cututtuka","Allergies":"Abubuwan da ke jawo rashin lafiya","Next of kin":"Makusanci","Blood group":"Rukunin jini","Registered facility":"Asibitin rajista","No phone recorded":"Ba a rubuta lambar waya ba","Stop camera":"Kashe kyamara","Patient ID":"Lambar mara lafiya","Patient records":"Bayanan marasa lafiya","Stop camera":"Dakatar da kyamara","Date of birth (optional)":"Ranar haihuwa (ba dole ba)","Sex":"Jinsi","Blood group (if known)":"Rukunin jini (idan an sani)","Known sickness":"Sanannun cututtuka","Allergies":"Abubuwan da ke jawo rashin lafiya","Patient details updated.":"An gyara bayanan mara lafiya.","Scan QR code":"Duba QR code","Edit patient details":"Gyara bayanan mara lafiya","Save patient details":"Ajiye bayanan mara lafiya","Wrong PIN":"PIN ba daidai ba","Enter the patient PIN.":"Shigar da PIN na mara lafiya.",
"Scan QR code":"Duba QR code","Save patient details":"Ajiye bayanan mara lafiya","Edit patient details":"Gyara bayanan mara lafiya","Patient details updated.":"An gyara bayanan mara lafiya.","Visit saved.":"An ajiye ziyarar.","QR code scanned. Enter the patient PIN.":"An duba QR code. Shigar da PIN na mara lafiya.","Unable to open the camera. Check camera permission or enter the Patient ID manually.":"Ba a iya bude kyamara ba. Duba izini ko shigar da lambar mara lafiya da hannu.","Patient ID":"Lambar mara lafiya","Date":"Rana","PHC":"Cibiyar lafiya","Age":"Shekaru","Female":"Mace","Male":"Namiji","Home":"Gida","Stock":"Hannun Jari","Referrals":"Tura Mara lafiya","Patients":"Marasa lafiya","USSD":"USSD","Sign out":"Fita","Emergency":"Gaggawa","Routine":"Na yau da kullum","Urgent":"Mai gaggawa","Create referral":"Kirkiri tura mara lafiya","Select registered patient":"Zabi mara lafiyar da aka yi rajista","Destination facility":"Asibitin da za a kai","Reason for referral":"Dalilin turawa","Urgency":"Matsayin gaggawa","Register a patient":"Yi rajistar mara lafiya","Register patient":"Yi rajistar mara lafiya","Patient register":"Jerin marasa lafiya","Patient full name":"Cikakken sunan mara lafiya","Date of birth (optional)":"Ranar haihuwa (ba dole ba)","Sex (optional)":"Jinsi (ba dole ba)","Phone number (optional)":"Lambar waya (ba dole ba)","Available stock":"Magunguna da kayan aiki da ake da su","Record stock movement":"Shigar da motsin kaya","Inventory item":"Kayan magani","Movement type":"Nau'in motsi","Quantity":"Adadi","Adjustment direction":"Hanyar gyara","Increase":"Kara","Decrease":"Rage","Batch number (optional)":"Lambar rukuni (ba dole ba)","Expiry date (optional)":"Ranar karewa (ba dole ba)","Reason / note":"Dalili / bayani","Save stock movement":"Ajiye motsin kaya","Select an option":"Zabi","Drug Out of Stock":"Magani Ya Kare","No Worker":"Babu Ma'aikaci","Create account":"Kirkiri asusu","Confirm password":"Tabbatar da kalmar sirri","Password":"Kalmar sirri","Email address":"Adireshin imel","Full name":"Cikakken suna","Facility overview":"Bayanin asibiti","Stock management":"Gudanar da kaya","Patient management":"Gudanar da marasa lafiya","USSD & SMS":"USSD da SMS","Your facility":"Asibitinku","Patient ID":"Lambar mara lafiya","Full name":"Cikakken suna","Patient name":"Sunan mara lafiya","Origin":"Asalin wuri","Destination":"Wurin da za a kai","Status":"Matsayi","Available balance":"Adadin da ake da shi","Stock movement recorded.":"An adana motsin kaya.","Register patient":"Yi rajistar mara lafiya","REF-OK · Accept":"REF-OK · Karɓa","REF-NO · Cannot accept":"REF-NO · Ba za a iya karɓa ba","Awaiting clinician response":"Ana jiran amsar likita","Online":"A kan layi","Offline":"Babu intanet","Saved":"An adana","Save stock movement":"Ajiye motsin kaya","Create referral":"Kirkiri tura mara lafiya","Sign in":"Shiga","Sign in to facility":"Shiga asibiti","Referral accepted. Awaiting patient arrival.":"An karbi turawar. Ana jiran isowar mara lafiya.","Instruction to PHC (optional)":"Umarnin zuwa PHC (ba dole ba)","Emergency referrals":"Turawar gaggawa","Clinical response desk":"Sashen amsar likitoci","Review incoming emergencies and respond to the originating PHC.":"Duba gaggawar da aka aika sannan ka amsa wa PHC.","REF-OK · Accept":"REF-OK · Karɓa","REF-NO · Cannot accept":"REF-NO · Ba za a iya karɓa ba"};
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
  const value=el.getAttribute(attr);if(!value)return;const key="en"+attr.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());if(!el.dataset[key])el.dataset[key]=value;
  const original=el.dataset[key];el.setAttribute(attr,lang==="ha"?(HAUSA[original]||original):original);
 }));
 root.querySelectorAll("[data-en][data-ha]").forEach(el=>{el.textContent=lang==="ha"?(el.dataset.ha||el.dataset.en):(el.dataset.en||"");});
 const toggle=root.querySelector("[data-language-switch]");if(toggle)toggle.textContent=lang==="ha"?"Hausa | English":"English | Hausa";
}
function facilityLoginView() {
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">FACILITY WORKSPACE</div><h2>Staff sign in</h2><p class="sub">Registered health workers can access their assigned facility after signing in.</p></div></div><div class="panel setup-panel"><form id="loginForm" class="admin-form">'+field("Email address","loginEmail","email",true,'autocomplete="username"')+field("Password","loginPassword","password",true,'autocomplete="current-password"')+'<button class="btn" type="submit">Sign in to facility</button></form></div></section>';
}
async function antenatalWorkspaceMarkup(facility){
  const facilityId=facility.id;
  const overview=await offlineSafeApi("/api/anc?facilityId="+encodeURIComponent(facilityId),{pregnancies:[],analytics:{registered:0,active:0,visits:0,high_risk:0,missed:0,deliveries:0}});
  STATE.ancPregnancies=overview.pregnancies||[];
  let selected=null,detail=null;
  if(STATE.openAncPregnancyId){
    try{detail=await api("/api/anc/"+encodeURIComponent(STATE.openAncPregnancyId));selected=detail.pregnancy;STATE.openAncDetail=detail;}
    catch(error){if(STATE.offlineMode){detail=STATE.openAncDetail||null;selected=detail?.pregnancy||null;}else throw error;}
  }
  const a=overview.analytics||{};
  const stats=[["Registered women",a.registered||0],["Active pregnancies",a.active||0],["ANC visits",a.visits||0],["High-risk cases",a.high_risk||0],["Missed appointments",a.missed||0],["Completed deliveries",a.deliveries||0]];
  const cards=stats.map(([label,value])=>'<div class="stat"><b>'+escapeHtml(value)+'</b><span>'+label+'</span></div>').join("");
  const rows=STATE.ancPregnancies.map(p=>{
    const weeks=Math.floor(Number(p.gestational_days||0)/7),days=Number(p.gestational_days||0)%7;
    return '<tr><td><strong>'+escapeHtml(p.full_name)+'</strong><small>'+escapeHtml(p.patient_code)+'</small></td><td>'+weeks+'w '+days+'d</td><td>'+escapeHtml(String(p.edd).slice(0,10))+'</td><td>'+escapeHtml(p.status)+'</td><td>'+(p.high_risk?'<span class="pill out">Review required</span>':'<span class="pill ok">No open flags</span>')+'</td><td><button class="btn sec sm" type="button" data-open-anc="'+escapeHtml(p.id)+'">Open record</button></td></tr>';
  }).join("");
  let html='<section class="panel admin-panel"><div class="panel-head"><div><div class="eyebrow">MATERNITY SERVICES</div><h3>Antenatal care overview</h3><p>Pregnancy registration, clinical visits and maternal follow-up for '+escapeHtml(facility.name)+'.</p></div><button class="btn sec sm" type="button" data-print-anc>Print</button></div><div class="stats">'+cards+'</div><p class="hint">Gestational age is calculated from the recorded LMP. EDD uses the standard 280-day estimate and must be clinically confirmed.</p></section>';
  if(STATE.offlineMode&&overview._offlineUnavailable)html+='<div class="offline-data-note">ANC lists are not cached on this device yet. Connect once to load existing pregnancy records. New entries can be saved to the pending sync queue.</div>';
  if(!selected){
    html+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Register pregnant woman</h3><p>Creates a linked patient record and pregnancy episode. The generated patient PIN must be handed to the woman securely.</p></div></div><form id="ancRegistrationForm" class="admin-form">'+
      field("Full name","fullName","text",true,'maxlength="160" autocomplete="name"')+
      field("Age in years","ageYears","number",true,'min="10" max="60" step="1"')+
      field("Phone number","phone","tel",true,'maxlength="30" autocomplete="tel"')+
      '<label for="address">Residential address</label><textarea id="address" name="address" rows="2" maxlength="500" required></textarea>'+
      field("Next of kin name","nextOfKinName","text",true,'maxlength="160"')+
      field("Next of kin phone","nextOfKinPhone","tel",true,'maxlength="30"')+
      field("Last menstrual period (LMP)","lmp","date",true,'max="'+new Date().toISOString().slice(0,10)+'"')+
      '<label for="previousPregnancyHistory">Previous pregnancy history</label><textarea id="previousPregnancyHistory" name="previousPregnancyHistory" rows="3" maxlength="3000" placeholder="Gravida/para, previous outcomes, complications or relevant history"></textarea>'+
      '<p class="hint">EDD will be calculated automatically as LMP + 280 days. Confirm dates with the woman and clinical records.</p><button class="btn" type="submit">Register woman and start ANC record</button></form></section>';
  }else{
    const weeks=selected.gestational_weeks??Math.floor(Number(selected.gestational_days||0)/7),days=selected.gestational_remainder??(Number(selected.gestational_days||0)%7);
    const riskRows=(detail.risks||[]).map(r=>'<tr><td>'+escapeHtml(r.category.replace(/_/g," "))+'</td><td>'+escapeHtml(r.severity)+'</td><td>'+escapeHtml(r.notes||"—")+'</td><td>'+escapeHtml(r.status)+'</td><td>'+(r.status==="open"?'<button class="btn sec sm" type="button" data-review-anc-risk="'+escapeHtml(r.id)+'" data-risk-status="reviewed">Mark reviewed</button>':'')+'</td></tr>').join("");
    const visitRows=(detail.visits||[]).map(v=>'<tr><td>'+escapeHtml(String(v.visit_date).slice(0,10))+'</td><td>'+escapeHtml(v.weight_kg??"—")+'</td><td>'+escapeHtml(v.systolic_bp??"—")+'/'+escapeHtml(v.diastolic_bp??"—")+'</td><td>'+escapeHtml(v.temperature_c??"—")+'</td><td>'+escapeHtml(v.clinical_observations||"—")+'</td></tr>').join("");
    const testRows=(detail.tests||[]).map(t=>'<tr><td>'+escapeHtml(t.test_type.replace(/_/g," "))+'</td><td>'+escapeHtml(t.result)+'</td><td>'+escapeHtml(String(t.tested_at).slice(0,10))+'</td><td>'+(t.consent_obtained?"Recorded":"—")+'</td></tr>').join("");
    const medRows=(detail.medications||[]).map(m=>'<tr><td>'+escapeHtml(m.medication_name)+'</td><td>'+escapeHtml(m.dose||"—")+'</td><td>'+escapeHtml(m.frequency||"—")+'</td><td>'+escapeHtml(String(m.start_date).slice(0,10))+'</td></tr>').join("");
    const apptRows=(detail.appointments||[]).map(v=>'<tr><td>'+escapeHtml(String(v.appointment_date).slice(0,10))+'</td><td>'+escapeHtml(v.purpose||"ANC follow-up")+'</td><td><span class="pill '+(v.status==="missed"?"out":v.status==="completed"?"ok":"q")+'">'+escapeHtml(v.status)+'</span></td></tr>').join("");
    const postRows=(detail.postnatal||[]).map(v=>'<tr><td>'+escapeHtml(String(v.visit_date).slice(0,10))+'</td><td>'+escapeHtml(v.follow_up_for)+'</td><td>'+escapeHtml(v.observations||"—")+'</td><td>'+escapeHtml(v.danger_signs||"—")+'</td></tr>').join("");
    html+='<section class="panel admin-panel anc-record"><div class="panel-head"><div><div class="eyebrow">PREGNANCY RECORD · '+escapeHtml(selected.patient_code)+'</div><h3>'+escapeHtml(selected.full_name)+'</h3><p>'+escapeHtml(selected.age_years)+' years · '+escapeHtml(selected.phone||"No phone")+' · '+escapeHtml(selected.address||"No address")+'</p></div><button class="btn sec sm" type="button" data-close-anc>Back to ANC list</button></div><div class="stats"><div class="stat"><b>'+weeks+'w '+days+'d</b><span>Gestational age today</span></div><div class="stat"><b>'+escapeHtml(String(selected.edd).slice(0,10))+'</b><span>Estimated delivery date</span></div><div class="stat"><b>'+escapeHtml(selected.pregnancy_number)+'</b><span>Pregnancy number</span></div><div class="stat"><b>'+escapeHtml(selected.status)+'</b><span>Pregnancy status</span></div></div><p class="sub">LMP: '+escapeHtml(String(selected.lmp).slice(0,10))+' · Next of kin: '+escapeHtml(selected.next_of_kin_name||"—")+' · '+escapeHtml(selected.next_of_kin_phone||"—")+'</p><p class="hint">Clinical documentation support only. Confirm gestational age, EDD and all findings with a qualified healthcare professional.</p></section>';
    html+='<section class="panel admin-panel"><h3>ANC visit history</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Weight kg</th><th>Blood pressure</th><th>Temp °C</th><th>Observations</th></tr></thead><tbody>'+(visitRows||'<tr><td colspan="5">No ANC visits recorded.</td></tr>')+'</tbody></table></div><form id="ancVisitForm" class="admin-form"><input type="hidden" name="pregnancyId" value="'+escapeHtml(selected.id)+'"><h4>Record ANC visit</h4>'+field("Visit date","visitDate","date",true,'value="'+new Date().toISOString().slice(0,10)+'"')+field("Weight (kg)","weightKg","number",false,'min="1" max="350" step="0.1"')+field("Systolic BP (mmHg)","systolicBp","number",false,'min="40" max="300"')+field("Diastolic BP (mmHg)","diastolicBp","number",false,'min="20" max="200"')+field("Temperature (°C)","temperatureC","number",false,'min="30" max="45" step="0.1"')+'<label for="ancVisitObservations">Clinical observations</label><textarea id="ancVisitObservations" name="observations" rows="2" maxlength="3000"></textarea><button class="btn" type="submit">Save ANC visit</button></form></section>';
    html+='<section class="panel admin-panel"><h3>Medical tests</h3><p class="hint">HIV and hepatitis B screening require documented informed consent. Results are restricted to authorised clinical staff and are not included in summary reports.</p><div class="table-wrap"><table><thead><tr><th>Test</th><th>Result</th><th>Date</th><th>Consent</th></tr></thead><tbody>'+(testRows||'<tr><td colspan="4">No tests recorded.</td></tr>')+'</tbody></table></div><form id="ancTestForm" class="admin-form"><input type="hidden" name="pregnancyId" value="'+escapeHtml(selected.id)+'">'+selectField("Test type","testType",'<option value="blood_group">Blood group</option><option value="genotype">Genotype</option><option value="hiv">HIV screening</option><option value="hepatitis_b">Hepatitis B screening</option><option value="malaria">Malaria test</option><option value="urine">Urine test</option><option value="blood_sugar">Blood sugar</option><option value="haemoglobin">Haemoglobin</option><option value="other">Other</option>')+field("Result","result","text",true,'maxlength="1000"')+field("Test date","testedAt","date",true,'value="'+new Date().toISOString().slice(0,10)+'"')+'<label><input type="checkbox" name="consentObtained" value="true"> Informed consent documented (required for HIV/Hep B)</label><label><input type="checkbox" name="confidential" value="true" checked> Keep result confidential</label><button class="btn" type="submit">Save test result</button></form></section>';
    html+='<section class="panel admin-panel"><h3>Risk assessment and review</h3><p class="hint">Flags are prompts for qualified staff review, not automated diagnoses.</p><div class="table-wrap"><table><thead><tr><th>Risk</th><th>Severity</th><th>Notes</th><th>Status</th><th></th></tr></thead><tbody>'+(riskRows||'<tr><td colspan="5">No risk flags recorded.</td></tr>')+'</tbody></table></div><form id="ancRiskForm" class="admin-form"><input type="hidden" name="pregnancyId" value="'+escapeHtml(selected.id)+'">'+selectField("Risk category","category",'<option value="hypertension">Hypertension</option><option value="severe_anemia">Severe anaemia</option><option value="previous_complication">Previous pregnancy complication</option><option value="bleeding">Bleeding</option><option value="severe_headache">Severe headache</option><option value="visual_changes">Visual changes</option><option value="fever">Fever</option><option value="reduced_fetal_movement">Reduced fetal movement</option><option value="other">Other danger sign</option>')+selectField("Review priority","severity",'<option value="moderate">Moderate</option><option value="high" selected>High</option><option value="urgent">Urgent</option>')+'<label for="ancRiskNotes">Clinical notes</label><textarea id="ancRiskNotes" name="notes" rows="2" maxlength="2000"></textarea><button class="btn" type="submit">Flag for clinical review</button></form></section>';
    html+='<section class="panel admin-panel"><h3>Medication and supplements</h3><div class="table-wrap"><table><thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th><th>Start date</th></tr></thead><tbody>'+(medRows||'<tr><td colspan="4">No medication entries.</td></tr>')+'</tbody></table></div><form id="ancMedicationForm" class="admin-form"><input type="hidden" name="pregnancyId" value="'+escapeHtml(selected.id)+'">'+field("Prescribed medication / supplement","medicationName","text",true,'maxlength="160" placeholder="e.g. Iron, folic acid"')+field("Dose","dose","text",false,'maxlength="160"')+field("Frequency","frequency","text",false,'maxlength="160"')+field("Start date","startDate","date",true,'value="'+new Date().toISOString().slice(0,10)+'"')+field("End date (optional)","endDate","date",false)+'<label for="ancMedicationInstructions">Instructions</label><textarea id="ancMedicationInstructions" name="instructions" rows="2" maxlength="1000"></textarea><button class="btn" type="submit">Save prescription record</button></form></section>';
    html+='<section class="panel admin-panel"><h3>Appointments</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Purpose</th><th>Status</th></tr></thead><tbody>'+(apptRows||'<tr><td colspan="3">No follow-up appointments.</td></tr>')+'</tbody></table></div><form id="ancAppointmentForm" class="admin-form"><input type="hidden" name="pregnancyId" value="'+escapeHtml(selected.id)+'">'+field("Follow-up date","appointmentDate","date",true)+field("Purpose","purpose","text",false,'maxlength="500" placeholder="Routine ANC follow-up"')+'<button class="btn" type="submit">Schedule appointment</button></form></section>';
    if(!detail.delivery)html+='<section class="panel admin-panel"><h3>Delivery record</h3><form id="ancDeliveryForm" class="admin-form"><input type="hidden" name="pregnancyId" value="'+escapeHtml(selected.id)+'">'+field("Delivery date","deliveryDate","date",true)+selectField("Delivery method","deliveryMethod",'<option value="vaginal">Vaginal</option><option value="assisted_vaginal">Assisted vaginal</option><option value="caesarean">Caesarean</option><option value="other">Other</option>')+selectField("Birth outcome","birthOutcome",'<option value="live_birth">Live birth</option><option value="stillbirth">Stillbirth</option><option value="neonatal_death">Neonatal death</option><option value="other">Other</option>')+'<label for="babyCondition">Baby condition</label><textarea id="babyCondition" name="babyCondition" rows="2"></textarea><label for="deliveryComplications">Complications</label><textarea id="deliveryComplications" name="complications" rows="2"></textarea><label for="deliveryNotes">Notes</label><textarea id="deliveryNotes" name="notes" rows="2"></textarea><button class="btn" type="submit">Save delivery outcome</button></form></section>';
    else html+='<section class="panel admin-panel"><h3>Delivery recorded</h3><p>'+escapeHtml(String(detail.delivery.delivery_date).slice(0,10))+' · '+escapeHtml(detail.delivery.delivery_method)+' · '+escapeHtml(detail.delivery.birth_outcome)+'</p></section>';
    html+='<section class="panel admin-panel"><h3>Postnatal follow-up</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Follow-up</th><th>Observations</th><th>Danger signs</th></tr></thead><tbody>'+(postRows||'<tr><td colspan="4">No postnatal visits recorded.</td></tr>')+'</tbody></table></div><form id="ancPostnatalForm" class="admin-form"><input type="hidden" name="pregnancyId" value="'+escapeHtml(selected.id)+'">'+field("Follow-up date","visitDate","date",true)+selectField("Follow-up for","followUpFor",'<option value="mother">Mother</option><option value="newborn">Newborn</option><option value="both">Mother and newborn</option>')+'<label for="postnatalObservations">Observations</label><textarea id="postnatalObservations" name="observations" rows="2"></textarea><label for="postnatalDangerSigns">Danger signs / concerns</label><textarea id="postnatalDangerSigns" name="dangerSigns" rows="2"></textarea>'+field("Next follow-up date","nextVisitDate","date",false)+'<button class="btn" type="submit">Save postnatal visit</button></form></section>';
  }
  html+='<section class="panel admin-panel"><h3>Pregnancy register</h3><div class="table-wrap"><table><thead><tr><th>Woman / Patient ID</th><th>Gestation</th><th>EDD</th><th>Status</th><th>Risk</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="6">No pregnant women registered at this facility yet.</td></tr>')+'</tbody></table></div></section>';
  html+='<section class="panel admin-panel"><h3>Health education</h3><div class="anc-education-grid"><article><b>Nutrition</b><p>Encourage varied meals, clean drinking water and prescribed supplements. Follow local clinical guidance on food safety and nutrition needs.</p></article><article><b>Personal hygiene</b><p>Handwashing, safe food handling, clean clothing and appropriate sanitation help reduce infection risks.</p></article><article><b>Pregnancy danger signs</b><p>Urgently seek qualified care for bleeding, severe headache, visual changes, fever, convulsions, severe abdominal pain, difficulty breathing or reduced fetal movement.</p></article><article><b>Birth preparedness</b><p>Discuss a skilled birth attendant, planned delivery facility, transport, emergency contacts and funds before labour.</p></article></div></section>';
  return html;
}
async function facilityWorkspace() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Checking your staff session…</p></div>';
  try {
    let me=null;
    if(navigator.onLine&&sessionStorage.getItem("phclink-offline-unlocked")!=="1"){try{me=await api("/api/auth/me");}catch(error){if(!/Network unavailable/i.test(error.message))throw error;}}
    if(me){STATE.user=me.user;STATE.offlineMode=false;}
    else{if(sessionStorage.getItem("phclink-offline-unlocked")!=="1"){window.location.replace("index.html");return;}const profile=readOfflineProfile();if(!profile)throw new Error("Offline access has expired. Connect and sign in again.");STATE.user=profile.user;STATE.offlineMode=true;}
    if(STATE.user.role==="system_admin"){ window.location.replace("admin.html"); return; }
    if(STATE.user.role==="clinician"&&STATE.page!=="patients"&&!STATE.offlineMode){window.location.replace("clinician.html");return;}
    if(!["health_worker","clinician","lga_officer"].includes(STATE.user.role)){
      root.innerHTML='<section class="panel setup-panel"><h2>Workspace not available</h2><p class="sub">Your account role does not have access to the facility workspace. Contact the system administrator.</p><button class="btn sec" id="staffLogout" type="button">Sign out</button></section>'; return;
    }
    const result=STATE.offlineMode?{facilities:readOfflineProfile()?.facilities||[]}:await api("/api/facilities"), facilities=result.facilities||[];
    if(!facilities.length){
      root.innerHTML='<section class="panel setup-panel"><h2>No facility assigned</h2><p class="sub">Your account is active, but no facility has been assigned. Contact the system administrator.</p><button class="btn sec" id="staffLogout" type="button">Sign out</button></section>'; return;
    }
    const selected=facilities.find(f=>f.id===STATE.facilityId)||facilities[0]; STATE.facilityId=selected.id;STATE.facilityCode=selected.code;
    let content='<section class="panel"><h2>'+({home:"Facility overview",stock:"Stock management",ref:"Referrals",patients:"Patient management",maternity:"Maternity / Antenatal Care",ussd:"USSD & SMS"}[STATE.page]||"Facility overview")+'</h2><p class="sub">'+escapeHtml(selected.name)+' · '+escapeHtml(selected.lga_name)+', '+escapeHtml(selected.state_name)+'</p>';
    if(STATE.page==="maternity"){content+=await antenatalWorkspaceMarkup(selected);}
    if(STATE.page==="stock"){
      const [data,catalogue]=await Promise.all([
        offlineSafeApi("/api/inventory/balances?facilityId="+encodeURIComponent(selected.id),{balances:[]}),
        offlineSafeApi("/api/inventory/items",{items:[]})
      ]);
      const rows=data.balances||[], items=catalogue.items||[];
      const itemOptions=options(items,"id",r=>r.name+" · "+r.category+" ("+r.unit+")");
      const movementOptions='<option value="RECEIVED">Receive stock</option><option value="DISPENSED">Dispense stock</option><option value="ADJUSTMENT">Adjust balance</option><option value="TRANSFER_IN">Transfer in</option><option value="TRANSFER_OUT">Transfer out</option><option value="EXPIRED">Record expired stock</option><option value="DAMAGED">Record damaged stock</option>';
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Record stock movement</h3><p>Every entry is recorded in the facility stock ledger.</p></div></div>'+(catalogue._offlineUnavailable?'<p class="offline-data-note">The inventory catalogue has not been saved on this device. Connect once to load item names before recording stock offline.</p>':(items.length?'<form id="stockMovementForm" class="admin-form">'+selectField("Inventory item","itemId",itemOptions)+selectField("Movement type","movementType",movementOptions)+field("Quantity","quantity","number",true,'min="0.01" step="0.01"')+'<label for="adjustmentDirection">Adjustment direction</label><select id="adjustmentDirection" name="adjustmentDirection"><option value="increase" selected>Increase</option><option value="decrease">Decrease</option></select>'+field("Batch number (optional)","batchNumber","text",false)+field("Expiry date (optional)","expiryDate","date",false)+'<label for="movementNote">Reason / note</label><input id="movementNote" name="note" maxlength="500" placeholder="Required for adjustments; optional otherwise"><button class="btn" type="submit">Save stock movement</button></form>':'<p class="empty-state">No inventory items have been added yet. Ask the system administrator to add items to the catalogue.</p>'))+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Available stock</h3><p>Current calculated balances for this facility</p></div><span class="count-label">'+rows.length+' items</span></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Available balance</th><th>Unit</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.category)+'</td><td>'+escapeHtml(r.quantity)+'</td><td>'+escapeHtml(r.unit)+'</td></tr>').join(""):'<tr><td colspan="4">'+(data._offlineUnavailable?'Stock balances have not been cached on this device.':'No inventory catalogue items available yet.')+'</td></tr>')+'</tbody></table></div></section>';
    } else if(STATE.page==="ref"){
      const [data,destinations,patientData]=await Promise.all([
        offlineSafeApi("/api/referrals?facilityId="+encodeURIComponent(selected.id),{referrals:[]}),
        offlineSafeApi("/api/facilities/referral-destinations?originFacilityId="+encodeURIComponent(selected.id),{facilities:[]}),
        offlineSafeApi("/api/patients?facilityId="+encodeURIComponent(selected.id),{patients:[]})
      ]);
      const rows=data.referrals||[], targets=destinations.facilities||[], patients=patientData.patients||[];
      const targetOptions=options(targets,"id",r=>r.name+" · "+r.lga_name);
      const patientOptions=options(patients,"id",p=>p.patient_code+" · "+(p.age_years??"—")+" · "+(p.sex||"—"));
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Create referral</h3><p>Send a referral from your assigned facility to another facility.</p></div></div>'+(STATE.offlineMode&&(destinations._offlineUnavailable||patientData._offlineUnavailable)?'<p class="offline-data-note">Referral destinations or patient records are not cached on this device. Connect once to load them before creating an offline referral.</p>':(targets.length&&patients.length?'<form id="referralForm" class="admin-form">'+selectField("Select registered patient","patientId",patientOptions,"Choose a patient")+selectField("Destination facility","destinationFacilityId",targetOptions)+field("Reason for referral","reasonCode","text",true,'maxlength="100" placeholder="e.g. Maternal complication"')+selectField("Urgency","urgency",'<option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>')+'<button class="btn" type="submit">Create referral</button></form>':(!targets.length?'<p class="empty-state">No receiving facility is registered yet. Ask the system administrator to add at least one more active facility.</p>':'<p class="empty-state">No patients are registered at this facility yet. Register the patient in the Patients section before creating a referral.</p>')))+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Referral records</h3><p>Referrals sent from or received by this facility</p></div><span class="count-label">'+rows.length+' records</span></div><div class="table-wrap"><table><thead><tr><th>Referral code</th><th>Patient</th><th>Origin</th><th>Destination</th><th>Urgency</th><th>Clinician response</th><th>Status</th></tr></thead><tbody id="referralRecordsBody">'+(rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.referral_code)+'</td><td>'+escapeHtml(r.patient_code||"—")+'</td><td>'+escapeHtml(r.origin_facility)+'</td><td>'+escapeHtml(r.destination_facility)+'</td><td>'+escapeHtml(r.urgency)+'</td><td>'+escapeHtml(r.clinician_reply||'Awaiting clinician response')+'</td><td><span class="pill '+(r.status==="completed"?"ok":(r.status==="rejected"||r.status==="cancelled"?"out":"q"))+'">'+escapeHtml(r.status)+'</span></td></tr>').join(""):'<tr><td colspan="7">No referrals recorded for this facility.</td></tr>')+'</tbody></table></div></section>';
    } else if(STATE.page==="patients"){
      const data=await offlineSafeApi("/api/patients?facilityId="+encodeURIComponent(selected.id),{patients:[]});
      const rows=data.patients||[], searchRows=STATE.patientSearchResults||[], patient=STATE.openPatient||null;
      const canManagePatient=["health_worker","clinician"].includes(STATE.user.role);
      const history=patient?(STATE.openPatientVisits||[]).map(v=>'<tr><td>'+escapeHtml(new Date(v.created_at).toLocaleString())+'</td><td>'+escapeHtml(v.facility_name)+' · '+escapeHtml(v.lga_name)+'</td><td>'+escapeHtml(v.complaint)+'</td><td>'+escapeHtml(v.treatment||"—")+'</td><td>'+escapeHtml(v.referral_status)+'</td><td>'+escapeHtml(v.clinician_note||"—")+'</td></tr>').join(""):"";
      content+=(STATE.user.role==="lga_officer"?"":'<section class="panel admin-panel"><div class="panel-head"><div><h3>Register a patient</h3><p>Quick first-visit registration. A Patient ID, private PIN and QR card are generated automatically.</p><p class="sub">Facility: '+escapeHtml(selected.name)+' · '+escapeHtml(selected.lga_name)+', '+escapeHtml(selected.state_name)+' · '+escapeHtml(selected.code||"No PHC code")+'</p></div></div><form id="patientForm" class="admin-form">'+field("Full name","patientFullName","text",true,'maxlength="160" autocomplete="name"')+field("Age in years","patientAge","number",true,'min="0" max="120" step="1"')+selectField("Sex","patientSex",'<option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option>')+field("Phone number (optional)","patientPhone","tel",false,'maxlength="30" autocomplete="tel"')+field("Next of kin name (optional)","nextOfKinName","text",false,'maxlength="160"')+field("Next of kin phone (optional)","nextOfKinPhone","tel",false,'maxlength="30"')+selectField("Blood group (if known)","bloodGroup",'<option value="A+">A+</option><option value="A-">A-</option><option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option><option value="O+">O+</option><option value="O-">O-</option><option value="unknown">Unknown</option>',"Not recorded",false)+'<label for="knownConditions">Known sickness (optional)</label><textarea id="knownConditions" name="knownConditions" rows="2" maxlength="1000" placeholder="e.g. Hypertension, Diabetes, Asthma, None"></textarea><label for="patientAllergies">Allergies (optional)</label><textarea id="patientAllergies" name="allergies" rows="2" maxlength="1000" placeholder="e.g. Penicillin"></textarea><button class="btn" type="submit">Register patient and create card</button></form></section>')+
      '<section class="panel admin-panel"><div class="panel-head"><div><h3>Find patient</h3><p>Search by Patient ID, name or phone. A correct PIN is always required to open the record.</p></div></div><form id="patientSearchForm" class="admin-form">'+field("Search patient","patientSearchQuery","search",true,'minlength="2" autocomplete="off"')+'<button class="btn sec" type="submit">Search</button></form>'+(searchRows.length?'<div class="table-wrap"><table><thead><tr><th>Patient ID</th><th>Age / Sex</th><th>Registered facility</th><th></th></tr></thead><tbody>'+searchRows.map(p=>'<tr><td>'+escapeHtml(p.patient_code)+'</td><td>'+escapeHtml(p.age_years??"—")+' / '+escapeHtml(p.sex||"—")+'</td><td>'+escapeHtml(p.registered_facility)+'</td><td>'+(p.pin_setup_required?'<button class="btn sec sm" type="button" data-initialize-patient="'+escapeHtml(p.id)+'">Create PIN card</button>':'<button class="btn sec sm" type="button" data-lookup-code="'+escapeHtml(p.patient_code)+'">Enter PIN</button>')+'</td></tr>').join("")+'</tbody></table></div>':'')+'<form id="patientLookupForm" class="admin-form">'+field("Patient ID","lookupPatientCode","text",true,'maxlength="80" autocomplete="off"')+field("4-digit patient PIN","lookupPatientPin","password",true,'inputmode="numeric" pattern="[0-9]{4}" maxlength="4"')+'<button class="btn sec" type="button" data-start-qr-scan>Scan QR code</button><div id="patientQrScanner" hidden><video id="patientQrVideo" playsinline autoplay muted></video><button class="btn sec" type="button" data-stop-qr-scan>Stop camera</button></div><button class="btn" type="submit">Verify PIN and open record</button></form></section>'+
      (patient?'<section class="panel admin-panel patient-record-panel"><div class="panel-head"><div><h3>Patient history</h3><p>PIN verified · '+escapeHtml(patient.patient_code)+'</p></div><button class="btn sec sm" type="button" data-close-patient-record>Close record</button></div><div class="patient-record-summary"><strong>'+escapeHtml(patient.full_name)+'</strong><span>'+escapeHtml(patient.age_years??"—")+' years · '+escapeHtml(patient.sex||"Not recorded")+'</span><span>'+escapeHtml(patient.phone||"No phone recorded")+'</span><span>'+escapeHtml(patient.registered_facility)+' · '+escapeHtml(patient.registered_lga)+', '+escapeHtml(patient.registered_state)+'</span><span>Next of kin: '+escapeHtml(patient.next_of_kin_name||"—")+' · '+escapeHtml(patient.next_of_kin_phone||"—")+'</span><span>Blood group: '+escapeHtml(patient.blood_group||"—")+'</span><span>Known sickness: '+escapeHtml(patient.known_conditions||"—")+'</span><span>Allergies: '+escapeHtml(patient.allergies||"—")+'</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>PHC</th><th>Complaint</th><th>Treatment</th><th>Referral</th><th>Clinician note</th></tr></thead><tbody>'+(history||'<tr><td colspan="6">No previous visits recorded.</td></tr>')+'</tbody></table></div>'+(canManagePatient?'<form id="patientVisitForm" class="admin-form"><input type="hidden" name="patientId" value="'+escapeHtml(patient.id)+'"><input type="hidden" name="pin" value="'+escapeHtml(STATE.openPatientPin||"")+'"><h4>New visit</h4><label for="visitComplaint">Complaint</label><textarea id="visitComplaint" name="complaint" rows="2" maxlength="1000" required></textarea><label for="visitTreatment">Treatment / action taken</label><textarea id="visitTreatment" name="treatment" rows="2" maxlength="2000"></textarea>'+selectField("Referral status","referralStatus",'<option value="not_referred">Not referred</option><option value="referred">Referred</option><option value="accepted">Accepted</option><option value="completed">Completed</option>')+(STATE.user.role==="clinician"?'<label for="visitClinicianNote">Clinician note (optional)</label><textarea id="visitClinicianNote" name="clinicianNote" rows="2" maxlength="2000"></textarea>':'')+'<button class="btn" type="submit">Save new visit</button></form>':'')+(canManagePatient?'<details class="patient-edit-details"><summary>Edit patient details</summary><form id="patientEditForm" class="admin-form"><input type="hidden" name="patientId" value="'+escapeHtml(patient.id)+'"><input type="hidden" name="pin" value="'+escapeHtml(STATE.openPatientPin||"")+'"><label for="editPatientName">Full name</label><input id="editPatientName" name="fullName" maxlength="160" required value="'+escapeHtml(patient.full_name)+'"><label for="editPatientAge">Age</label><input id="editPatientAge" name="ageYears" type="number" min="0" max="120" required value="'+escapeHtml(patient.age_years??"")+'"><label for="editPatientDob">Date of birth (optional)</label><input id="editPatientDob" name="dateOfBirth" type="date" value="'+escapeHtml(patient.date_of_birth?String(patient.date_of_birth).slice(0,10):"")+'"><label for="editPatientSex">Sex</label><select id="editPatientSex" name="sex"><option value="female" '+(patient.sex==="female"?"selected":"")+' >Female</option><option value="male" '+(patient.sex==="male"?"selected":"")+' >Male</option><option value="unknown" '+(patient.sex==="unknown"?"selected":"")+' >Unknown</option></select><label for="editPatientPhone">Phone number</label><input id="editPatientPhone" name="phone" value="'+escapeHtml(patient.phone||"")+'"><label for="editNextOfKin">Next of kin name</label><input id="editNextOfKin" name="nextOfKinName" value="'+escapeHtml(patient.next_of_kin_name||"")+'"><label for="editNextOfKinPhone">Next of kin phone</label><input id="editNextOfKinPhone" name="nextOfKinPhone" value="'+escapeHtml(patient.next_of_kin_phone||"")+'"><label for="editBloodGroup">Blood group</label><select id="editBloodGroup" name="bloodGroup"><option value="">Not recorded</option><option value="A+" '+(patient.blood_group==="A+"?"selected":"")+' >A+</option><option value="A-" '+(patient.blood_group==="A-"?"selected":"")+' >A-</option><option value="B+" '+(patient.blood_group==="B+"?"selected":"")+' >B+</option><option value="B-" '+(patient.blood_group==="B-"?"selected":"")+' >B-</option><option value="AB+" '+(patient.blood_group==="AB+"?"selected":"")+' >AB+</option><option value="AB-" '+(patient.blood_group==="AB-"?"selected":"")+' >AB-</option><option value="O+" '+(patient.blood_group==="O+"?"selected":"")+' >O+</option><option value="O-" '+(patient.blood_group==="O-"?"selected":"")+' >O-</option><option value="unknown" '+(patient.blood_group==="unknown"?"selected":"")+' >Unknown</option></select><label for="editConditions">Known sickness</label><textarea id="editConditions" name="knownConditions" rows="2">'+escapeHtml(patient.known_conditions||"")+'</textarea><label for="editAllergies">Allergies</label><textarea id="editAllergies" name="allergies" rows="2">'+escapeHtml(patient.allergies||"")+'</textarea><button class="btn" type="submit">Save patient details</button></form></details>':'')+'</section>':'')+
      '<section class="panel admin-panel"><div class="panel-head"><div><h3>Patient register</h3><p>Only the minimum identification details are shown here. Open a record with its PIN to view private details.</p></div><span class="count-label">'+rows.length+' patients</span></div><div class="table-wrap"><table><thead><tr><th>Patient ID</th><th>Age</th><th>Sex</th></tr></thead><tbody>'+(rows.length?rows.map(p=>'<tr><td>'+escapeHtml(p.patient_code)+'</td><td>'+escapeHtml(p.age_years??"—")+'</td><td>'+escapeHtml(p.sex||"—")+'</td></tr>').join(""):'<tr><td colspan="3">'+(data._offlineUnavailable?'Patient list has not been cached on this device.':'No patients registered at this facility yet.')+'</td></tr>')+'</tbody></table></div></section>';
     } else if(STATE.page==="ussd"){
      const alertOptions=Object.entries(ALERT_CODE_LABELS).map(([code,label])=>'<option value="'+code+'">'+escapeHtml(label)+' · '+code+'</option>').join("");
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Alert message testing</h3><p>Send a test alert through the same API used by web, LoRa gateways and SMS/USSD providers.</p></div></div><form id="alertSimulationForm" class="admin-form">'+selectField("Alert type","alertCode",alertOptions)+ '<label for="alertDetails">Short details</label><textarea id="alertDetails" name="details" rows="2" maxlength="1000" placeholder="e.g. 1 Male · urgent response required"></textarea><p class="sub">PHC code: <strong>'+escapeHtml(selected.code||"Not assigned")+'</strong></p><div class="alert-simulation-actions"><button class="btn" type="button" data-alert-source="lora">Simulate LoRa Message</button><button class="btn sec" type="button" data-alert-source="sms">Simulate SMS Message</button></div></form></section><section class="panel admin-panel"><h3>Supported alert codes</h3><p class="sub">RED: emergency · YELLOW: warning · GREEN: normal activity</p><div class="alert-code-list">'+Object.entries(ALERT_CODE_LABELS).map(([code,label])=>'<span><i style="background:'+alertColor(alertSeverityForCode(code))+'"></i><strong>'+alertSeverityForCode(code).toUpperCase()+'</strong> · '+escapeHtml(label)+' <small>('+code+')</small></span>').join("")+'</div></section>';
    }
    else {
      const [stockData,referralData,patientData,alertData,tipsData,knowledgeData]=await Promise.all([offlineSafeApi("/api/inventory/balances?facilityId="+encodeURIComponent(selected.id),{balances:[]}),offlineSafeApi("/api/referrals?facilityId="+encodeURIComponent(selected.id),{referrals:[]}),offlineSafeApi("/api/patients?facilityId="+encodeURIComponent(selected.id),{patients:[]}),STATE.user.role==="lga_officer"?api("/api/alerts"):Promise.resolve({facilities:[]}),STATE.user.role==="health_worker"?api("/api/health-tips").catch(()=>({tips:readLocalJSON("phclink-health-tips",[])})):Promise.resolve({tips:[]}),STATE.user.role==="health_worker"?api("/api/health-assistant/knowledge").catch(()=>({knowledge:readLocalJSON("phclink-health-knowledge",[])})):Promise.resolve({knowledge:[]})]);STATE.alertFacilities=alertData.facilities||[];STATE.healthTips=tipsData.tips||[];STATE.healthKnowledge=knowledgeData.knowledge||[];if(STATE.user.role==="health_worker"){localStorage.setItem("phclink-health-tips",JSON.stringify(STATE.healthTips));localStorage.setItem("phclink-health-knowledge",JSON.stringify(STATE.healthKnowledge));}
      const stockRows=stockData.balances||[], referralRows=referralData.referrals||[], patientRows=patientData.patients||[];
      const openReferrals=referralRows.filter(r=>["submitted","acknowledged","arrived"].includes(String(r.status||"").toLowerCase()));
      const completedReferrals=referralRows.filter(r=>String(r.status||"").toLowerCase()==="completed");
      const icon=(name)=>'<svg class="facility-icon" viewBox="0 0 24 24" aria-hidden="true">'+({patients:'<path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20"/><circle cx="10" cy="7" r="4"/>',stock:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12v9"/>',referrals:'<path d="M4 7h14M14 3l4 4-4 4M20 17H6m4-4-4 4 4 4"/>',completed:'<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'}[name]||'')+'</svg>';
      const recentPatients=[...patientRows].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
      const recentReferrals=[...referralRows].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
      content+='<div class="facility-home"><div class="facility-welcome"><div><span class="facility-kicker">FACILITY DASHBOARD</span><h3>Good day, '+escapeHtml((STATE.user.fullName||"Health worker").split(" ")[0])+'</h3><p>A live snapshot of activity at '+escapeHtml(selected.name)+'.</p></div><span class="facility-role">'+escapeHtml(STATE.user.role==="health_worker"?"Health worker":(STATE.user.role==="clinician"?"Clinician":"LGA officer"))+'</span></div>'+
      '<div class="facility-metrics"><article class="facility-metric">'+icon("patients")+'<div><span>Registered patients</span><strong>'+patientRows.length+'</strong><small>Patient records at this facility</small></div></article><article class="facility-metric">'+icon("stock")+'<div><span>Stock line items</span><strong>'+stockRows.length+'</strong><small>Items with recorded balances</small></div></article><article class="facility-metric">'+icon("referrals")+'<div><span>Total referrals</span><strong>'+referralRows.length+'</strong><small>'+openReferrals.length+' currently in progress</small></div></article><article class="facility-metric">'+icon("completed")+'<div><span>Completed referrals</span><strong>'+completedReferrals.length+'</strong><small>Marked completed</small></div></article></div>'+
      '<div class="facility-home-grid"><section class="facility-data-card"><div class="facility-card-head"><div><span class="facility-kicker">LATEST REGISTER</span><h3>Recent patients</h3></div><a href="patients.html">View all '+icon("arrow")+'</a></div>'+
      (recentPatients.length?'<div class="facility-record-list">'+recentPatients.map(p=>'<div class="facility-record"><span class="facility-record-avatar">'+escapeHtml(String(p.patient_code||"P").trim().charAt(0).toUpperCase())+'</span><div><strong>'+escapeHtml(p.patient_code)+'</strong><small>'+(p.age_years??'—')+' years · '+escapeHtml(p.sex||'—')+'</small></div></div>').join("")+'</div>':'<div class="facility-empty"><strong>No patient records yet</strong><p>Registered patients will appear here.</p><a href="patients.html">Register a patient</a></div>')+'</section>'+
      '<section class="facility-data-card"><div class="facility-card-head"><div><span class="facility-kicker">REFERRAL ACTIVITY</span><h3>Recent referrals</h3></div><a href="referrals.html">View all '+icon("arrow")+'</a></div>'+
      (recentReferrals.length?'<div id="homeRecentReferrals" class="facility-record-list">'+recentReferrals.map(r=>'<div class="facility-record facility-referral-record"><div><strong>'+escapeHtml(r.referral_code||"Referral")+'</strong><small>'+escapeHtml(r.patient_code||"Patient")+' · '+escapeHtml(r.destination_facility||"Destination pending")+(r.clinician_reply?" · Reply: "+escapeHtml(r.clinician_reply):"")+'</small></div><span class="facility-status '+(String(r.status).toLowerCase()==="completed"?"is-complete":"")+'">'+escapeHtml(r.status||"Unknown")+'</span></div>').join("")+'</div>':'<div class="facility-empty"><strong>No referral records yet</strong><p>New referrals created or received will appear here.</p><a href="referrals.html">Open referrals</a></div>')+'</section></div>'+
      '<section class="facility-data-card facility-stock-summary"><div class="facility-card-head"><div><span class="facility-kicker">INVENTORY SNAPSHOT</span><h3>Available stock</h3></div><a href="stock.html">Manage stock '+icon("arrow")+'</a></div>'+
      (stockRows.length?'<div class="facility-stock-list">'+stockRows.slice(0,6).map(item=>'<div><span>'+escapeHtml(item.name)+'</span><strong>'+escapeHtml(item.quantity)+' <small>'+escapeHtml(item.unit)+'</small></strong></div>').join("")+'</div>':'<div class="facility-empty compact"><strong>No stock balances recorded</strong><p>Stock balances will appear after movements are recorded.</p><a href="stock.html">Open stock management</a></div>')+'</section></div>'+(STATE.user.role==="health_worker"?healthAssistantMarkup()+healthTipsTickerMarkup(STATE.healthTips||[]):"")+(STATE.user.role==="lga_officer"?alertMapPanelMarkup("lgaAlertMap",STATE.alertFacilities,"LGA PHC Alert Map"):"");
    }
    if(STATE.offlineMode)content='<div class="offline-mode-banner">Offline access · Showing saved data. New records remain pending until you reconnect.</div>'+content;
    content+='</section>';
    const nav=STATE.user.role==="clinician"?[["patients","Patient records","patients.html"],["maternity","Maternity / ANC","maternity.html"]]:(STATE.user.role==="lga_officer"?[["home","LGA overview","facility.html"],["ref","Referrals","referrals.html"],["patients","Patients","patients.html"]]:[["home","Home","facility.html"],["stock","Stock","stock.html"],["ref","Referrals","referrals.html"],["patients","Patients","patients.html"],["maternity","Maternity / ANC","maternity.html"],["ussd","USSD","ussd.html"]]);
    root.innerHTML='<div class="stage"><div class="screen-wrap"><header class="hdr"><div class="staff-identity"><span class="staff-designation-label">PROFESSIONAL DESIGNATION</span><strong class="staff-designation">'+escapeHtml(STATE.user.designation?STATE.user.designation.replace(/_/g," "):"Not specified")+'</strong></div><div class="facility-header-actions">'+((STATE.user.role==="clinician"||STATE.user.canRespondEmergency)?'<a class="btn sec sm" href="clinician.html">Clinical response desk</a>':'')+'<button class="btn sec sm" data-language-switch type="button">English | Hausa</button><button class="btn sec sm" id="staffLogout" type="button">Sign out</button></div></header><div class="net"><span id="apiStatus">Authenticated session</span><span id="networkIndicator"></span></div>'+(facilities.length>1?'<div class="panel"><label for="facilityPicker">Your facility</label><select id="facilityPicker">'+facilities.map(f=>'<option value="'+escapeHtml(f.id)+'" '+(f.id===selected.id?'selected':'')+'>'+escapeHtml(f.name)+'</option>').join("")+'</select></div>':'')+'<nav class="tabs" aria-label="Facility sections">'+nav.map(([key,label,url])=>'<a href="'+url+'"'+(STATE.page===key?' aria-current="page"':'')+'>'+iconSvg(key)+'<span>'+label+'</span></a>').join("")+'</nav><main class="body">'+content+'</main></div></div><div id="patientEditor" class="patient-editor" hidden><section class="patient-editor-card" role="dialog" aria-modal="true" aria-labelledby="patientEditorTitle"><div class="panel-head"><div><h3 id="patientEditorTitle">Edit patient details</h3><p>Update the selected patient record.</p></div><button class="btn sec sm" type="button" data-close-patient-editor>Close</button></div><form id="patientEditForm" class="admin-form"><input type="hidden" name="patientId" id="editPatientId">'+field("Patient full name","editPatientFullName","text",true,'maxlength="160" autocomplete="name"')+field("Date of birth (optional)","editPatientDateOfBirth","date",false,'max="'+new Date().toISOString().slice(0,10)+'"')+selectField("Sex (optional)","editPatientSex",'<option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option>',"Not recorded",false)+field("Phone number (optional)","editPatientPhone","tel",false,'maxlength="30" autocomplete="tel"')+'<div class="patient-editor-actions"><button class="btn sec" type="button" data-close-patient-editor>Cancel</button><button class="btn" type="submit">Save changes</button></div></form></section></div>';
    applyFacilityLanguage();if(STATE.user.role==="lga_officer"){renderAlertMap("lgaAlertMap",STATE.alertFacilities||[]);clearInterval(window.phcLgaAlertPoll);window.phcLgaAlertPoll=setInterval(()=>refreshAlertMap("lgaAlertMap","LGA PHC Alert Map"),10000);}updateSyncIndicator();flushOfflineQueue();
    clearInterval(window.phcReferralPoll);if(["ref","home"].includes(STATE.page))window.phcReferralPoll=setInterval(()=>refreshFacilityReferrals(selected.id),3000);
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
    if(!(STATE.user.role==="clinician"||(STATE.user.role==="health_worker"&&STATE.user.canRespondEmergency))){window.location.replace(STATE.user.role==="system_admin"?"admin.html":"facility.html");return;}
    const data=await api("/api/referrals/clinician/inbox");
    const rows=data.referrals||[];
    const cards=rows.length?rows.map(r=>'<article class="clinician-referral"><div class="clinician-referral-top"><div><span class="clinician-emergency-label">EMERGENCY REFERRAL</span><h3>'+escapeHtml(r.referral_code)+'</h3><p>'+escapeHtml(r.origin_facility)+' · '+escapeHtml(r.origin_lga)+', '+escapeHtml(r.origin_state)+'</p></div><span class="clinician-status">'+escapeHtml(r.status)+'</span></div><div class="clinician-patient"><strong>'+escapeHtml(r.patient_code||"Patient ID unavailable")+'</strong><span>Enter the patient PIN to view the clinical record</span><small>'+alertCodeDisplayMarkup(r.reason_code)+' · '+escapeHtml(new Date(r.created_at).toLocaleString())+'</small></div><form class="clinician-response-form" data-referral-id="'+escapeHtml(r.id)+'"><label for="instruction-'+escapeHtml(r.id)+'">Instruction to PHC (optional)</label><textarea id="instruction-'+escapeHtml(r.id)+'" name="notes" rows="2" maxlength="500" placeholder="e.g. Give IV fluids, refer now"></textarea><div><button class="btn clinician-accept" type="button" data-clinician-action="acknowledged" data-referral-id="'+escapeHtml(r.id)+'">REF-OK · Referral Accepted · Send Patient Now</button><button class="btn sec clinician-reject" type="button" data-clinician-action="rejected" data-referral-id="'+escapeHtml(r.id)+'">REF-NO · No Bed / Cannot Accept</button></div></form></article>').join(""):'<section class="clinician-empty"><span>✓</span><h3>No active emergency referrals</h3><p>New emergency referrals from PHCs will appear here automatically.</p></section>';
    root.innerHTML='<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>PHC Link · Clinical response desk</b><small>'+escapeHtml(STATE.user.fullName)+' · '+escapeHtml(STATE.user.designation||"Clinician")+'</small></div><div class="clinician-header-actions"><button class="btn sec sm" data-language-switch type="button">English | Hausa</button><span class="clinician-live"><i></i> Live emergency queue</span><a class="btn sec sm" href="patients.html">Patient records</a><a class="btn sec sm" href="facility.html">Facility workspace</a><button class="btn sec sm" id="clinicianLogout" type="button">Sign out</button></div></header><div class="net"><span>Emergency referrals across PHC Link</span><span id="networkIndicator"></span><span>'+rows.length+' active</span></div><main class="body"><section class="clinician-heading"><div><span class="eyebrow">CLINICAL RESPONSE DESK</span><h2>Emergency referrals</h2><p>Review incoming emergencies and respond to the originating PHC.</p></div></section><div class="clinician-referral-list">'+cards+'</div></main></div></div>';
    applyFacilityLanguage();updateSyncIndicator();
    clearInterval(window.phcClinicianPoll);
    window.phcClinicianPoll=setInterval(async()=>{if(document.hidden)return;try{const latest=await api("/api/referrals/clinician/inbox");if((latest.referrals||[]).map(x=>x.id+":"+x.updated_at).join("|")!==rows.map(x=>x.id+":"+x.updated_at).join("|"))clinicianWorkspace();}catch(_){}},3000);
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
  return '<section class="auth-shell"><div class="auth-card"><div class="auth-mark">+</div><div class="eyebrow">SECURE ACCESS</div><h2>Welcome to PHC Link</h2><p class="sub">Sign in with your registered account. Your role determines which workspace opens.</p><form id="loginForm" class="admin-form">'+field("Email address","loginEmail","email",true,'autocomplete="username"')+passwordField("Password","loginPassword","current-password")+'<button class="btn" type="submit">Sign in</button></form><p class="auth-switch">New to PHC Link? <button type="button" data-auth-view="signup">Create an account</button></p><p class="auth-note">New registrations start as health workers. An administrator must assign your facility before you can use the facility workspace.</p></div>'+offlineLoginMarkup()+'</section>';
}
function signupView() {
  return '<section class="auth-shell"><div class="auth-card"><div class="auth-mark">+</div><div class="eyebrow">CREATE YOUR ACCOUNT</div><h2>Join PHC Link</h2><p class="sub">Register your staff account. Your default role will be Health worker.</p><form id="signupForm" class="admin-form">'+field("Full name","signupFullName","text",true,'autocomplete="name" maxlength="160"')+field("Email address","signupEmail","email",true,'autocomplete="email"')+passwordField("Password (at least 8 letters and numbers)","signupPassword","new-password",true)+passwordField("Confirm password","signupPasswordConfirm","new-password",true)+'<button class="btn" type="submit">Create account</button></form><p class="auth-switch">Already registered? <button type="button" data-auth-view="login">Sign in</button></p><p class="auth-note">Your account is created with the Health worker role. Contact your administrator to change your role or assign a facility.</p></div></section>';
}
function adminPatientDirectory(data) {
  const facilities=data.patientCounts||[];
  const total=Number(data.patientCount||0);
  const groups=facilities.map(row=>'<section class="panel admin-panel admin-patient-facility"><div class="panel-head"><div><h3>'+escapeHtml(row.facility_name)+'</h3><p>'+escapeHtml(row.lga_name)+' · '+escapeHtml(row.state_name)+'</p></div><span class="count-label">'+Number(row.patient_count||0)+' patients</span></div></section>').join("");
  return '<section id="adminPatients" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">PATIENT DIRECTORY</span><h3>Patient registration totals</h3><p>For privacy, administrators can see registration counts only. Patient details require a verified patient PIN.</p></div><span class="admin-section-count">'+total+' total patients</span></div>'+(groups||'<section class="panel admin-panel"><div class="admin-empty"><strong>No patient registrations yet</strong></div></section>')+'</section>';
}

const ALERT_CODE_LABELS={
  "MAT-LAB":"Emergency Labour","MAT-BLEED":"Maternal Bleeding Emergency","MAT-ECL":"Eclampsia Emergency",
  "EM-GUN":"Emergency Gunshot Wound","EM-CUT":"Emergency Cutlass Wound","EM-RTA":"Road Traffic Accident Emergency",
  "EM-CLASH":"Community Clash / Violence Emergency","BLD-NEED":"Urgent Blood Needed","SEC-THREAT":"Security Threat",
  "DRG-OUT":"Drug Out of Stock","DRG-LOW":"Low Drug Stock","IMM-OUT":"Immunisation Stock Out",
  "KIT-OUT":"Medical Kit Out of Stock","KIT-LOW":"Low Medical Kit Stock","STAFF-NONE":"No Worker",
  "PWR-OUT":"Power Outage","MAT-ANC":"Antenatal Care","IMM-DAY":"Immunisation Day"
};
const ALERT_RED_CODES=["MAT-LAB","MAT-BLEED","MAT-ECL","EM-GUN","EM-CUT","EM-RTA","EM-CLASH","BLD-NEED","SEC-THREAT"];
const ALERT_YELLOW_CODES=["DRG-OUT","DRG-LOW","IMM-OUT","KIT-OUT","KIT-LOW","STAFF-NONE","PWR-OUT"];
function alertSeverityForCode(code){return ALERT_RED_CODES.includes(code)?"red":(ALERT_YELLOW_CODES.includes(code)?"yellow":"green");}
function alertColor(severity){return severity==="red"?"#dc2626":severity==="yellow"?"#d69e12":"#16a34a";}
function alertCodeDisplayMarkup(value){
  const code=String(value||"").trim().toUpperCase(),label=ALERT_CODE_LABELS[code];
  if(!label)return escapeHtml(value||"Emergency");
  const severity=alertSeverityForCode(code);
  return '<span class="alert-code-badge alert-code-'+severity+'"><strong>'+severity.toUpperCase()+'</strong> · '+escapeHtml(label)+' <small>('+escapeHtml(code)+')</small></span>';
}
function alertFacilityDisplayCode(row){
  const code=String(row.phc_code||"").trim().toUpperCase();
  if(!code)return "Yobe PHC";
  return code.startsWith("YB-")?code:"YB-"+code;
}
function alertTimeLabel(value){
  if(!value)return "No recent alert";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Time unavailable":date.toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:true});
}
function alertMapPanelMarkup(id,facilities,title="Yobe PHC Network"){
  const rows=[...(facilities||[])].sort((a,b)=>({red:0,yellow:1,green:2}[a.severity]??2)-({red:0,yellow:1,green:2}[b.severity]??2)||new Date(b.latest_at||0)-new Date(a.latest_at||0)),counts={red:0,yellow:0,green:0};
  rows.forEach(row=>{const level=["red","yellow","green"].includes(row.severity)?row.severity:"green";counts[level]++;});
  const items=rows.map(row=>{
    const severity=["red","yellow","green"].includes(row.severity)?row.severity:"green";
    const code=String(row.latest_code||"").toUpperCase();
    const label=code?(ALERT_CODE_LABELS[code]||"Facility alert"):"Normal operations";
    const phc=alertFacilityDisplayCode(row),place=[row.facility_name,row.lga_name].filter(Boolean).join(" · ");
    const detail=String(row.latest_details||"").trim();
    const time=alertTimeLabel(row.latest_at);
    const description=(code?code+" · ":"")+phc+" · "+place+(detail?" · "+detail:"");
    return '<article class="phc-alert-row" data-severity="'+severity+'"><span class="phc-alert-dot" style="background:'+alertColor(severity)+'"></span><div><strong>'+severity.toUpperCase()+' · '+escapeHtml(label)+'</strong><small>'+escapeHtml(description)+'</small></div><time>'+escapeHtml(time)+'</time></article>';
  }).join("");
  return '<section class="panel admin-panel phc-alert-map-panel"><div class="panel-head"><div><span class="eyebrow">FACILITY STATUS</span><h3>'+escapeHtml(title)+'</h3><p>Every registered PHC is marked RED for emergencies, YELLOW for warnings or GREEN for normal activity. Approximate pins are labelled.</p></div><span class="count-label">'+rows.length+' PHCs</span></div><div class="phc-alert-map-legend"><span><i style="background:#dc2626"></i>RED · Emergency ('+counts.red+')</span><span><i style="background:#d69e12"></i>YELLOW · Warning ('+counts.yellow+')</span><span><i style="background:#16a34a"></i>GREEN · Normal ('+counts.green+')</span></div><div id="'+id+'" class="phc-alert-map" role="region" aria-label="Yobe State map showing PHC alert status"></div><div class="phc-alert-list">'+(items||'<p class="empty-state">No PHC facilities are registered in Yobe State yet.</p>')+'</div></section>';
}
function renderAlertMap(id,facilities){
  const node=document.getElementById(id);if(!node)return;
  window.phcAlertMaps=window.phcAlertMaps||{};if(window.phcAlertMaps[id]){window.phcAlertMaps[id].remove();delete window.phcAlertMaps[id];}
  if(!window.L){node.innerHTML='<div class="phc-map-fallback">Map tiles are unavailable. The colour-coded PHC status list remains available below.</div>';return;}
  const map=L.map(node,{scrollWheelZoom:false}).setView([12.15,11.35],8);window.phcAlertMaps[id]=map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:17,attribution:'© OpenStreetMap'}).addTo(map);
  const points=(facilities||[]).filter(row=>{
    if(row.latitude===null||row.latitude===undefined||row.latitude===""||row.longitude===null||row.longitude===undefined||row.longitude==="")return false;
    const lat=Number(row.latitude),lng=Number(row.longitude);
    return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
  });
  points.forEach(row=>{
    const severity=["red","yellow","green"].includes(row.severity)?row.severity:"green";
    const color=alertColor(severity),code=String(row.latest_code||"").toUpperCase();
    const label=code?(ALERT_CODE_LABELS[code]||"Facility alert"):"Normal operations";
    const detail=String(row.latest_details||"").trim(),time=alertTimeLabel(row.latest_at);
    const marker=L.circleMarker([Number(row.latitude),Number(row.longitude)],{radius:9,color:"#fff",weight:2,fillColor:color,fillOpacity:1}).addTo(map);
    marker.bindPopup('<strong>'+escapeHtml(row.facility_name)+'</strong><br><b>'+severity.toUpperCase()+' · '+escapeHtml(label)+'</b><br>'+escapeHtml(code?code+" · ":"")+escapeHtml(alertFacilityDisplayCode(row))+' · '+escapeHtml(row.lga_name||"Yobe State")+(detail?'<br>'+escapeHtml(detail):"")+'<br><small>'+escapeHtml(time)+(row.coordinates_are_approximate?' · Approximate town-centre pin':"")+'</small>');
  });
  if(points.length){const bounds=L.latLngBounds(points.map(row=>[Number(row.latitude),Number(row.longitude)]));map.fitBounds(bounds.pad(.25),{maxZoom:10});}
  else node.insertAdjacentHTML("beforeend",'<div class="phc-map-fallback">Facility coordinates have not been recorded yet. Add verified PHC coordinates to place map dots; the full colour-coded status list is shown below.</div>');
  setTimeout(()=>map.invalidateSize(),80);
}
async function refreshAlertMap(id,title){
  if(document.hidden)return;
  try{
    const data=await api("/api/alerts");STATE.alertFacilities=data.facilities||[];
    const mapNode=document.getElementById(id),panel=mapNode?.closest(".phc-alert-map-panel");
    if(panel){panel.outerHTML=alertMapPanelMarkup(id,STATE.alertFacilities,title);renderAlertMap(id,STATE.alertFacilities);}
  }catch(_){}
}
function readLocalJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||"null")||fallback;}catch(_){return fallback;}}
function healthAssistantMarkup(){
  const quick=[["bleeding","Bleeding","Zubar jini"],["labour","Labour","Nakuda"],["eclampsia","Eclampsia","Eclampsia"],["gunshot","Gunshot","Harbin bindiga"],["cutlass","Cutlass wound","Raunin adda"],["rta","Road accident","Hadarin mota"],["malaria","Malaria","Zazzabin cizon sauro"],["diarrhoea","Diarrhoea","Gudawa"],["snake bite","Snake bite","Saran maciji"]];
  return '<section class="panel health-assistant-panel"><div class="panel-head"><div><span class="eyebrow">OFFLINE HEALTH SUPPORT</span><h3>Ask Health Assistant</h3><p>Short protocol-based guidance. Not a doctor or a replacement for a Clinician.</p></div><span class="health-assistant-status">Guidance only</span></div><div class="health-quick-questions">'+quick.map(([value,en,ha])=>'<button class="btn sec sm" type="button" data-health-question="'+value+'" data-en="'+en+'" data-ha="'+ha+'">'+(currentLanguage()==="ha"?ha:en)+'</button>').join("")+'</div><div id="healthAssistantMessages" class="health-assistant-messages" aria-live="polite"><p class="health-assistant-welcome" data-en="I am a Health Assistant, for guidance only. Choose a topic or type a question." data-ha="Ni Mataimakin Lafiya ne don jagora kawai. Zabi batu ko rubuta tambaya.">'+(currentLanguage()==="ha"?"Ni Mataimakin Lafiya ne don jagora kawai. Zabi batu ko rubuta tambaya.":"I am a Health Assistant, for guidance only. Choose a topic or type a question.")+'</p></div><form id="healthAssistantForm" class="health-assistant-form"><input name="question" type="text" maxlength="600" placeholder="'+(currentLanguage()==="ha"?"Rubuta tambayar lafiya...":"Ask a short health question...")+'" required><button class="btn" type="submit">'+(currentLanguage()==="ha"?"Aika":"Ask")+'</button></form></section>';
}
function healthTipsTickerMarkup(tips){
  const rows=(tips||[]).filter(t=>t.is_active!==false);
  const fallback=[{english_text:"Wash hands with soap and safe water before and after every patient contact.",hausa_text:"Wanke hannu da sabulu da ruwa mai tsafta kafin da bayan kula da mara lafiya."},{english_text:"For diarrhoea, give ORS according to PHC protocol.",hausa_text:"Idan gudawa ta faru, ba da ORS bisa tsarin PHC."}];
  const items=(rows.length?rows:fallback).map(t=>'<span class="health-tip-item" data-en="'+escapeHtml(t.english_text)+'" data-ha="'+escapeHtml(t.hausa_text||t.english_text)+'">'+escapeHtml(currentLanguage()==="ha"?(t.hausa_text||t.english_text):t.english_text)+'</span>').join('<b aria-hidden="true"> • </b>');
  return '<section class="health-tips-ticker" aria-label="Health tips ticker"><strong data-en="HEALTH TIPS" data-ha="NASIHAR LAFIYA">'+(currentLanguage()==="ha"?"NASIHAR LAFIYA":"HEALTH TIPS")+'</strong><div class="health-ticker-window"><div class="health-ticker-track">'+items+ '<span aria-hidden="true"> • PHC Link • </span>'+items+'</div></div></section>';
}
function offlineHealthAnswer(question,language){
  const knowledge=STATE.healthKnowledge||[],q=String(question||"").toLowerCase();
  const match=knowledge.find(row=>(row.keywords||[]).some(keyword=>q.includes(String(keyword).toLowerCase())));
  if(!match){const emergency=/gunshot|bullet|heavy bleeding|bleeding after birth|eclampsia|convulsion|seizure|snake ?bite|road traffic|rta|cutlass wound|zubar jini|farfadiya|saran maciji|hadarin mota|harbin bindiga/i.test(q);const parts=[];if(emergency)parts.push("This is RED. Send RED alert now and refer.");parts.push("I am a Health Assistant, for guidance only.",language==="ha"?"Ban tabbata ba. A aika gargadi ga Likita kuma a bi tsarin PHC.":"I am not sure. Send alert to Clinician and follow PHC protocol.","This is guidance only. Follow PHC protocol. If serious, send RED alert and refer now.");return {answer:parts.join("\\n"),emergency};}
  let answer=language==="ha"?match.hausa_answer:match.english_answer;
  const emergency=/^This is RED|^Wannan JA ne/i.test(answer)||/gunshot|bleeding|eclampsia|snake|rta|cutlass|zubar jini|farfadiya|saran maciji|hadarin mota|harbin bindiga/i.test(q);
  answer=answer.replace(/^Wannan JA ne\. A aika gargadin JA yanzu kuma a tura mara lafiya\.?\s*/i,"").replace(/^This is RED\. Send RED alert now and refer\.?\s*/i,"").replace(/Ni Mataimakin Lafiya ne, don jagora kawai\./gi,"").replace(/I am a Health Assistant, for guidance only\./gi,"").replace(/This is guidance only\. Follow PHC protocol\. If serious, send RED alert and refer now\./gi,"").trim();
  const lines=answer.split(/\n+/).map(line=>line.trim()).filter(Boolean);
  const steps=lines.filter(line=>/^\d+[.)]/.test(line)).slice(0,5);
  const output=[];if(emergency)output.push("This is RED. Send RED alert now and refer.");output.push("I am a Health Assistant, for guidance only.");output.push(...(steps.length?steps:lines.slice(0,5)));output.push("This is guidance only. Follow PHC protocol. If serious, send RED alert and refer now.");
  return {answer:output.join("\n"),emergency};
}
async function askHealthAssistant(question){
  const messages=document.getElementById("healthAssistantMessages");if(!messages)return;
  const clean=String(question||"").trim().slice(0,600);if(!clean)return;
  messages.insertAdjacentHTML("beforeend",'<div class="health-chat-user">'+escapeHtml(clean)+'</div><div class="health-chat-answer" data-health-loading>Checking saved guidance…</div>');
  messages.scrollTop=messages.scrollHeight;
  const loading=messages.querySelector("[data-health-loading]");
  try{
    let result;
    if(navigator.onLine)result=await api("/api/health-assistant",{method:"POST",body:JSON.stringify({question:clean,language:currentLanguage()})});
    else result=offlineHealthAnswer(clean,currentLanguage());
    if(loading){loading.removeAttribute("data-health-loading");loading.textContent=result.answer;}
  }catch(error){
    const result=offlineHealthAnswer(clean,currentLanguage());
    if(loading){loading.removeAttribute("data-health-loading");loading.textContent=result.answer;}
  }
  messages.scrollTop=messages.scrollHeight;
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

function cleanHealthTipText(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  let text=raw;
  if(/<\/?[a-z][\s\S]*?>/i.test(raw)){
    const parsed=new DOMParser().parseFromString(raw,"text/html");
    parsed.querySelectorAll("script,style,noscript,iframe,svg,ul.links").forEach(node=>node.remove());
    text=parsed.body.textContent||"";
  }else{
    const decoder=document.createElement("textarea");
    decoder.innerHTML=raw;
    text=decoder.value;
  }
  text=text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi," ")
    .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\/\d{1,2}\/\d{4}(?:\s*[·-]\s*\d{1,2}:\d{2})?\b/gi," ")
    .replace(/\bRead more\b/gi," ")
    .replace(/\s+/g," ").trim();
  const duplicate=text.match(/^(.{8,180}?)[.!?]?\s+\1[.!?]?$/i);
  if(duplicate)text=duplicate[1].trim();
  return text;
}
function adminHealthTipsPanel(tips){
  const rows=(tips||[]).map(t=>{
    const english=cleanHealthTipText(t.english_text),hausa=cleanHealthTipText(t.hausa_text);
    const preview=english.length>420?english.slice(0,417).trimEnd()+"…":english;
    return '<div class="admin-health-tip-row"><div class="admin-health-tip-copy"><strong>'+escapeHtml(preview)+'</strong><small>'+(hausa?escapeHtml(hausa):'<span class="translation-pending">Hausa translation pending</span>')+' · '+escapeHtml(t.source_name||"PHC Link")+'</small>'+(t.source_url?'<a href="'+escapeHtml(t.source_url)+'" target="_blank" rel="noopener">Open source</a>':'')+'</div><div class="admin-health-tip-actions"><button class="btn sec sm" type="button" data-edit-health-tip="'+escapeHtml(t.id)+'" data-english="'+escapeHtml(english)+'" data-hausa="'+escapeHtml(hausa)+'" data-source="'+escapeHtml(t.source_name||"PHC Link")+'" data-url="'+escapeHtml(t.source_url||"")+'">Edit</button><button class="btn danger sm" type="button" data-delete-health-tip="'+escapeHtml(t.id)+'">Delete</button></div></div>';
  }).join("");
  return '<section id="adminHealthTips" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">WORKER DASHBOARD CONTENT</span><h3>Health tips and official updates</h3><p>Add bilingual tips, edit imported updates and remove outdated content.</p></div><button class="btn sec sm" type="button" data-refresh-health-tips>Refresh official news</button></div><section class="panel admin-panel"><form id="adminHealthTipForm" class="admin-form"><input type="hidden" name="tipId"><label for="healthTipEnglish">English tip / update</label><textarea id="healthTipEnglish" name="english_text" rows="2" maxlength="1000" required></textarea><label for="healthTipHausa">Hausa translation</label><textarea id="healthTipHausa" name="hausa_text" rows="2" maxlength="1000"></textarea>'+field("Source name","source_name","text",false,'maxlength="120" value="PHC Link"')+field("Source URL (optional)","source_url","url",false,'maxlength="500"')+'<div class="admin-health-tip-actions"><button class="btn" type="submit">Save health tip</button><button class="btn sec" type="reset">Clear form</button></div></form><div class="admin-health-tip-list">'+(rows||'<p class="sub">No health tips have been saved yet.</p>')+'</div></section></section>';
}
function adminWorkspace(data) {
  const stateOpts=options(data.states,"id",r=>r.name);
  const lgaOpts=options(data.lgas,"id",r=>r.name+" — "+r.state_name);
  const facilityOpts=options(data.facilities,"id",r=>r.name+" — "+r.lga_name);
  const networkCards=[["States",data.states.length,"Geographic coverage","map"],["LGAs",data.lgas.length,"Local government areas","pin"],["Facilities",data.facilities.length,"Registered care locations","facility"]];
  const operationsCards=[["User accounts",data.users.length,"Staff and administrators","users"],["Stock catalogue",data.items.length,"Reusable inventory items","stock"],["Referrals",data.referralCount??(data.referrals||[]).length,"Patient transfers recorded","referrals"],["Patients",Number(data.patientCount||0),"Registered across facilities","patients"]];
  const renderKpis=cards=>cards.map(([label,count,detail,mark])=>'<article class="admin-kpi"><div class="admin-kpi-top"><span>'+label+'</span><span class="admin-kpi-mark">'+adminIcon(mark)+'</span></div><strong>'+count+'</strong><small>'+detail+'</small></article>').join("");
  const kpis='<section class="admin-metric-group"><div class="admin-metric-heading"><div><span class="eyebrow">NETWORK</span><h3>Geographic coverage</h3></div><span>Service structure</span></div><div class="admin-kpis admin-kpis-network">'+renderKpis(networkCards)+'</div></section><section class="admin-metric-group admin-metric-group-operations"><div class="admin-metric-heading"><div><span class="eyebrow">OPERATIONS</span><h3>Platform activity</h3></div><span>Live records</span></div><div class="admin-kpis admin-kpis-operations">'+renderKpis(operationsCards)+'</div></section>';
  const list=(rows,columns)=>rows.length?'<div class="table-wrap"><table><thead><tr>'+columns.map(c=>'<th>'+c[0]+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(c=>'<td>'+escapeHtml(c[1](row))+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>':'<div class="admin-empty"><span class="admin-empty-icon">＋</span><strong>Nothing here yet</strong><p>Records will appear here once they have been added.</p></div>';
  const userRows=data.users.length?'<div class="table-wrap"><table><thead><tr><th>User</th><th>Account role</th><th>Designation</th><th>Emergency desk</th><th>Status</th><th>Facility</th><th>Assign facility</th><th>Update role</th></tr></thead><tbody>'+data.users.map(user=>{
    const canAssign=["health_worker","clinician"].includes(user.role); const canToggleEmergency=user.role==="health_worker";
    const assigned=(user.assigned_facilities||[]).length?'<span class="admin-facility-chip">'+escapeHtml(user.assigned_facilities[0])+'</span>':'<span class="admin-unassigned">No facility assigned</span>';
    const designations=['doctor','medical_officer','nurse','midwife','chew','cho'];
    const designationOptions='<option value="">Not set</option>'+designations.map(value=>'<option value="'+value+'" '+(user.designation===value?'selected':'')+'>'+value.replace(/_/g,' ')+'</option>').join('');
    return '<tr><td><div class="admin-user-cell"><span class="admin-avatar">'+escapeHtml((user.full_name||"U").trim().charAt(0).toUpperCase())+'</span><span><strong>'+escapeHtml(user.full_name)+'</strong><small>'+escapeHtml(user.email)+'</small></span></div></td><td><span class="admin-role">'+escapeHtml(user.role.replace(/_/g," "))+'</span></td><td>'+(canAssign?'<div class="role-edit"><select aria-label="Designation for '+escapeHtml(user.full_name)+'" data-user-designation="'+escapeHtml(user.id)+'">'+designationOptions+'</select><button class="btn sec sm" type="button" data-save-user-designation="'+escapeHtml(user.id)+'">Save</button></div>':(user.designation?escapeHtml(user.designation.replace(/_/g," ")):'—'))+'</td><td>'+(canToggleEmergency?'<label class="admin-clinical-access"><input type="checkbox" data-user-clinical-access="'+escapeHtml(user.id)+'" '+(user.can_respond_emergency?'checked':'')+' '+(!user.designation?'disabled':'')+'> Clinical response</label><button class="btn sec sm" type="button" data-save-clinical-access="'+escapeHtml(user.id)+'">Save</button>':'—')+'</td><td><span class="admin-status '+(user.is_active?"active":"inactive")+'">'+(user.is_active?"Active":"Disabled")+'</span></td><td><div class="admin-assigned-facilities">'+assigned+'</div></td><td>'+(canAssign?'<div class="role-edit admin-assign-control"><select aria-label="Facility for '+escapeHtml(user.full_name)+'" data-user-facility="'+escapeHtml(user.id)+'"><option value="">Select facility</option>'+options(data.facilities,"id",r=>r.name+" — "+r.lga_name)+'</select><button class="btn sec sm" type="button" data-assign-facility="'+escapeHtml(user.id)+'">Assign</button></div>':'—')+'</td><td><div class="role-edit"><select aria-label="Role for '+escapeHtml(user.full_name)+'" data-user-role="'+escapeHtml(user.id)+'"><option value="health_worker" '+(user.role==="health_worker"?"selected":"")+'>PHC Worker</option><option value="clinician" '+(user.role==="clinician"?"selected":"")+'>Clinician</option><option value="lga_officer" '+(user.role==="lga_officer"?"selected":"")+'>LGA officer</option><option value="state_admin" '+(user.role==="state_admin"?"selected":"")+'>State admin</option><option value="system_admin" '+(user.role==="system_admin"?"selected":"")+'>System admin</option></select><button class="btn sec sm" type="button" data-save-user-role="'+escapeHtml(user.id)+'">Save</button></div></td></tr>';
  }).join("")+'</tbody></table></div>':'<div class="admin-empty"><span class="admin-empty-icon">♙</span><strong>No user accounts yet</strong><p>Create accounts for staff and administrators to get started.</p></div>';
  return '<div class="admin-app"><aside class="admin-sidebar"><a class="admin-side-brand" href="admin.html"><span class="admin-brand-mark">'+adminIcon("setup")+'</span><span><strong>PHC Link</strong><small>ADMIN CONSOLE</small></span></a><div class="admin-side-label">WORKSPACE</div><nav class="admin-nav" aria-label="Administration navigation"><a class="active" href="#adminOverview">'+adminIcon("overview")+'Overview</a><a href="#adminSetup">'+adminIcon("setup")+'Set up system</a><a href="#adminUsers">'+adminIcon("users")+'User accounts</a><a href="#adminReferrals">'+adminIcon("referrals")+'Referrals</a><a href="#adminPatients">'+adminIcon("patients")+'Patients</a><a href="#adminDirectory">'+adminIcon("directory")+'Directories</a></nav><div class="admin-sidebar-bottom"><div class="admin-security-note">'+adminIcon("shield")+'<div><strong>Secure workspace</strong><small>System administrator access</small></div></div><button class="admin-logout" id="logoutButton" type="button">'+adminIcon("logout")+'<span>Sign out</span></button></div></aside><div class="admin-main"><header class="admin-topbar"><div><span class="admin-breadcrumb">PHC LINK</span><span class="admin-breadcrumb-sep">/</span><strong>Administration</strong></div><div class="admin-topbar-actions"><div class="admin-account"><span class="admin-avatar">'+escapeHtml((STATE.user.fullName||"A").trim().charAt(0).toUpperCase())+'</span><span><strong>'+escapeHtml(STATE.user.fullName)+'</strong><small>System administrator</small></span></div><button class="admin-topbar-logout" type="button" data-admin-logout><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></svg><span>Sign out</span></button></div></header><div class="admin-content"><section id="adminOverview" class="admin-welcome"><div><div class="eyebrow">SYSTEM OVERVIEW</div><h2>Good day, '+escapeHtml((STATE.user.fullName||"Administrator").split(" ")[0])+'</h2><p>Manage your healthcare network, staff access and inventory catalogue from one place.</p></div><span class="admin-live-label"><i></i> Live database</span></section><section class="admin-overview-metrics">'+kpis+'</section>'+alertMapPanelMarkup("adminAlertMap",STATE.alertFacilities||[],"Yobe State PHC Alert Map")+'<section id="adminSetup" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">CONFIGURATION</span><h3>Set up your network</h3><p>Build the geographic structure and register the resources PHC Link needs.</p></div><span class="admin-section-count">3-step workflow</span></div><div class="admin-forms-grid">'+
    '<section class="panel admin-panel network-setup-panel"><div class="panel-head"><div><h3>Set up your network</h3><p>Create the state, its LGA and the facility together in one submission.</p></div><span class="count-label">One form</span></div><form id="networkSetupForm" class="network-setup-form">'+
      '<div class="network-form-section"><div class="network-form-heading"><span>01</span><div><strong>State details</strong><small>Top level of your service network</small></div></div><div class="network-form-fields">'+field("State name","stateName")+field("State code (optional)","stateCode","text",false)+'</div></div>'+
      '<div class="network-form-section"><div class="network-form-heading"><span>02</span><div><strong>Local government area</strong><small>Belongs to the state entered above</small></div></div><div class="network-form-fields">'+field("LGA name","lgaName")+'</div></div>'+
      '<div class="network-form-section"><div class="network-form-heading"><span>03</span><div><strong>Healthcare facility</strong><small>Belongs to the LGA entered above</small></div></div><div class="network-form-fields">'+field("Facility name","facilityName")+field("Facility code","facilityCode")+field("Address (optional)","facilityAddress","text",false)+field("Latitude (optional)","facilityLatitude","number",false,'min="-90" max="90" step="any" placeholder="e.g. 12.8729"')+field("Longitude (optional)","facilityLongitude","number",false,'min="-180" max="180" step="any" placeholder="e.g. 11.0388"')+'<label class="admin-clinical-access"><input type="checkbox" name="coordinatesAreApproximate" value="true" checked> Coordinates are approximate (town-centre pin)</label>'+'</div></div>'+
      '<div class="network-form-actions"><p>All three records will be created in sequence.</p><button class="btn" type="submit">Create network</button></div></form></section>'+
    formPanel("Create a user account","Create staff access and assign the appropriate scope.","userForm",field("Full name","fullName")+field("Email address","email","email")+field("Temporary password (minimum 12 characters)","password","password",true,'minlength="12"')+selectField("Account role","role",'<option value="health_worker">PHC Worker</option><option value="clinician">Clinician</option><option value="lga_officer">LGA Admin</option>')+selectField("Assigned facility","facilityId",facilityOpts,"Choose a facility — if applicable",false)+selectField("Assigned LGA","lgaId",lgaOpts,"Choose an LGA — if applicable",false)+selectField("Professional designation","designation",'<option value="">Not specified</option><option value="doctor">Doctor</option><option value="medical_officer">Medical Officer</option><option value="nurse">Nurse</option><option value="midwife">Midwife</option><option value="chew">CHEW</option><option value="cho">CHO</option>',"Select professional designation",false)+'<label class="admin-clinical-access"><input type="checkbox" name="canRespondEmergency" value="true"> Enable emergency referral response desk</label>'+field("Phone number (optional)","phone","tel",false),"Create account")+
    formPanel("Add an inventory item","Create a catalogue item that facilities can track.","itemForm",field("Item name","name")+field("Category","category")+field("Unit of measure","unit")+field("Minimum stock alert level","minimumStock","number",true,'min="0" step="0.01" value="0"'),"Add inventory item")+
    '</div></section><section id="adminUsers" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">ACCESS CONTROL</span><h3>User accounts</h3><p>Review staff accounts, assign one facility to each health worker, and manage user roles.</p></div><span class="admin-section-count">'+data.users.length+' accounts</span></div><section class="panel admin-panel admin-table-panel">'+userRows+'</section></section><div id="adminPatientDirectory"> '+adminPatientDirectory(data)+ '</div><section id="adminReferrals" class="admin-section">'+
'<div class="admin-section-heading"><div><span class="eyebrow">PATIENT TRANSFERS</span><h3>Referral records</h3><p>All referrals submitted across registered facilities, including their origin, destination and current status.</p></div><span class="admin-section-count">'+(data.referralCount||0)+' total referrals</span></div>'+
'<section class="panel admin-panel admin-table-panel"><div class="table-wrap"><table>'+
'<thead><tr><th>Referral code</th><th>Origin facility</th><th>Destination facility</th><th>Created by</th><th>Reason</th><th>Urgency</th><th>Status</th><th>Date created</th></tr></thead>'+
'<tbody>'+((data.referrals||[]).length?(data.referrals||[]).map(r=>'<tr><td><strong>'+escapeHtml(r.referral_code)+'</strong></td><td>'+escapeHtml(r.origin_facility)+' <small>'+escapeHtml(r.origin_lga)+'</small></td><td>'+escapeHtml(r.destination_facility)+' <small>'+escapeHtml(r.destination_lga)+'</small></td><td>'+escapeHtml(r.created_by_name||"Unavailable")+'</td><td>'+alertCodeDisplayMarkup(r.reason_code)+'</td><td>'+escapeHtml(r.urgency)+'</td><td><span class="pill '+(r.status==="completed"?"ok":(r.status==="rejected"||r.status==="cancelled"?"out":"q"))+'">'+escapeHtml(r.status)+'</span></td><td>'+escapeHtml(new Date(r.created_at).toLocaleString())+'</td></tr>').join(""):'<tr><td colspan="8">No referrals have been submitted yet.</td></tr>')+'</tbody></table></div></section></section><section id="adminDirectory" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">NETWORK DIRECTORY</span><h3>Registered records</h3><p>Review the locations and catalogue entries currently in the system.</p></div></div><div class="admin-directory-grid"><section class="panel admin-panel"><div class="panel-head"><div><h3>Healthcare facilities</h3><p>Registered service locations</p></div><span class="count-label">'+data.facilities.length+'</span></div>'+list(data.facilities,[["Facility",r=>r.name],["Code",r=>r.code||"—"],["LGA",r=>r.lga_name],["State",r=>r.state_name]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Inventory catalogue</h3><p>Items available for stock tracking</p></div><span class="count-label">'+data.items.length+'</span></div>'+list(data.items,[["Item",r=>r.name],["Category",r=>r.category],["Unit",r=>r.unit],["Minimum",r=>r.default_minimum_stock]])+'</section></div></section>'+adminHealthTipsPanel(data.healthTips||[])+'<footer class="admin-footer">PHC Link · Administration <span>Secure healthcare operations</span></footer></div></div></div>';
}
async function dashboardView() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Loading administration…</p></div>';
  try {
    const me=await api("/api/auth/me"); STATE.user=me.user;
    if(STATE.user.role!=="system_admin"){
      if(["health_worker","lga_officer"].includes(STATE.user.role)) window.location.replace("facility.html");
      else if(STATE.user.role==="clinician") window.location.replace("clinician.html");
      
      else root.innerHTML='<section class="panel setup-panel"><h2>Access denied</h2><p class="sub">This account is not authorised to use system administration.</p><button class="btn sec" id="logoutButton" type="button">Sign out</button></section>';
      return;
    }
    const [data,alerts,tips]=await Promise.all([api("/api/admin/overview"),api("/api/alerts"),api("/api/admin/health-tips").catch(()=>({tips:[]}))]);STATE.admin=data;STATE.alertFacilities=alerts.facilities||[];data.healthTips=tips.tips||[];root.innerHTML=adminWorkspace(data);renderAlertMap("adminAlertMap",STATE.alertFacilities);clearInterval(window.phcAdminAlertPoll);window.phcAdminAlertPoll=setInterval(()=>refreshAlertMap("adminAlertMap","Yobe State PHC Alert Map"),10000);
  } catch(error) {
    if(error.message==="Authentication required.") window.location.replace("index.html");
    else root.innerHTML='<section class="panel"><h2>Administration unavailable</h2><p class="sub">'+escapeHtml(error.message)+'</p><button class="btn sec" onclick="dashboardView()">Retry</button></section>';
  }
}
function offlineAccessView(){
  const root=document.getElementById("root");
  if(!root)return;
  root.innerHTML='<section class="auth-shell"><div class="auth-card"><div class="auth-mark">+</div><div class="eyebrow">PHC LINK · OFFLINE ACCESS</div><h2>Sign in with your offline PIN</h2>'+offlineLoginMarkup()+'</div></section>';
  const pin=root.querySelector("#offlineLoginPin");
  if(pin)pin.focus();
}
async function loginPageView() {
  const root=document.getElementById("root");
  if(!navigator.onLine){offlineAccessView();return;}
  root.innerHTML='<div class="dashboard"><p class="sub">Checking account access…</p></div>';
  try {
    const setup=await api("/api/setup/status",{headers:{}});
    if(!setup.initialized){root.innerHTML=setupView(setup.bootstrapConfigured);return;}
    try {
      const me=await api("/api/auth/me"), role=me.user.role;
      if(role==="system_admin") window.location.replace("admin.html");
      else if(role==="health_worker"||role==="lga_officer") window.location.replace("facility.html");
      else if(role==="clinician") window.location.replace("clinician.html");
      else root.innerHTML='<section class="panel setup-panel"><h2>Workspace unavailable</h2><p class="sub">Your account role does not have a workspace yet. Contact the system administrator.</p><button class="btn sec" id="logoutButton" type="button">Sign out</button></section>';
    } catch(error) {
      if(error.message==="Authentication required.") root.innerHTML=loginView();
      else throw error;
    }
  } catch(error) {
    // navigator.onLine can remain true when the backend or internet connection is unreachable.
    // A failed network request must show PIN-only access, never the email/password form.
    if(!navigator.onLine||/network unavailable|failed to fetch|load failed|networkerror/i.test(error.message||"")){
      offlineAccessView();
      return;
    }
    root.innerHTML=loginView();
  }
}
function render() {
  // A disconnected device must always start at the PIN gate, never reveal a saved workspace.
  if(!navigator.onLine&&sessionStorage.getItem("phclink-offline-unlocked")!=="1"){offlineAccessView();return;}
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
  if(form.id==="healthAssistantForm"){event.preventDefault();const d=formData(form);await askHealthAssistant(d.question);form.reset();return;}
  const ancRoutes={
    ancRegistrationForm:()=>({path:"/api/anc/registrations",payload:{...d,facilityId:STATE.facilityId}}),
    ancVisitForm:()=>({path:"/api/anc/"+encodeURIComponent(d.pregnancyId)+"/visits",payload:d}),
    ancTestForm:()=>({path:"/api/anc/"+encodeURIComponent(d.pregnancyId)+"/tests",payload:d}),
    ancRiskForm:()=>({path:"/api/anc/"+encodeURIComponent(d.pregnancyId)+"/risks",payload:d}),
    ancMedicationForm:()=>({path:"/api/anc/"+encodeURIComponent(d.pregnancyId)+"/medications",payload:d}),
    ancAppointmentForm:()=>({path:"/api/anc/"+encodeURIComponent(d.pregnancyId)+"/appointments",payload:d}),
    ancDeliveryForm:()=>({path:"/api/anc/"+encodeURIComponent(d.pregnancyId)+"/delivery",payload:d}),
    ancPostnatalForm:()=>({path:"/api/anc/"+encodeURIComponent(d.pregnancyId)+"/postnatal",payload:d})
  };
  if(ancRoutes[form.id]){
    event.preventDefault();
    if(form.dataset.submitting==="true")return;
    form.dataset.submitting="true";
    const buttons=[...form.querySelectorAll('button[type="submit"]')];
    buttons.forEach(b=>{b.disabled=true;b.dataset.label=b.textContent;b.textContent="Saving…";});
    const d=formData(form),route=ancRoutes[form.id]();
    const payload={...route.payload,operationId:form.dataset.operationId||(form.dataset.operationId=crypto.randomUUID())};
    try{
      await api(route.path,{method:"POST",body:JSON.stringify(payload)});
      notify("Antenatal record saved.");
      if(form.id==="ancRegistrationForm")STATE.openAncPregnancyId=null;
      await facilityWorkspace();
    }catch(error){
      if(queueOfflineAction(route.path,payload,error)){
        notify("Saved offline. This ANC entry is pending synchronisation.");
        form.reset();delete form.dataset.operationId;form.dataset.submitting="false";
        buttons.forEach(b=>{b.disabled=false;b.textContent=b.dataset.label||"Save";});
        updateSyncIndicator();
      }else{
        form.dataset.submitting="false";
        buttons.forEach(b=>{b.disabled=false;b.textContent=b.dataset.label||"Save";});
        notify(error.message,true);
      }
    }
    return;
  }
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
      await api("/api/admin/facilities",{method:"POST",body:JSON.stringify({lgaId:lgaResult.lga.id,name:d.facilityName,code:d.facilityCode,address:d.facilityAddress||null,latitude:d.facilityLatitude===""?null:Number(d.facilityLatitude),longitude:d.facilityLongitude===""?null:Number(d.facilityLongitude),coordinatesAreApproximate:d.coordinatesAreApproximate==="true"})});
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
    try{
      const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:d.loginEmail,password:d.loginPassword})});STATE.user=result.user;sessionStorage.removeItem("phclink-offline-unlocked");
      if(["health_worker","clinician","lga_officer"].includes(result.user.role)){
        const facilityResult=await api("/api/facilities"),facilities=facilityResult.facilities||[];
        if(!facilities.length)throw new Error("Your account has no assigned facility. Contact the administrator.");
        const existing=readOfflineProfile();
        if(existing){existing.user=result.user;existing.facilities=facilities;existing.expiresAt=Date.now()+OFFLINE_ACCESS_DAYS*86400000;existing.failedAttempts=0;existing.lockedUntil=0;localStorage.setItem(OFFLINE_PROFILE_KEY,JSON.stringify(existing));localStorage.setItem("phclink-cache:/api/auth/me",JSON.stringify({user:result.user}));localStorage.setItem("phclink-cache:/api/facilities",JSON.stringify({facilities}));window.location.assign(result.user.role==="clinician"?"clinician.html":"facility.html");}
        else offlinePinSetupView(result.user,facilities);
      }else{localStorage.removeItem(OFFLINE_PROFILE_KEY);notify("Signed in successfully.");window.location.assign("admin.html");}
    }catch(error){notify(error.message,true);}return;
  }
  if(form.id==="offlinePinSetupForm"){
    event.preventDefault();const d=formData(form);
    if(!/^[0-9]{6}$/.test(d.offlinePin)){notify("PIN must contain exactly 6 digits.",true);return;}
    if(d.offlinePin!==d.offlinePinConfirm){notify("The PINs do not match.",true);return;}
    try{const context=JSON.parse(decodeURIComponent(escape(atob(d.offlineContext))));await saveOfflineProfile(context.user,context.facilities,d.offlinePin);notify("Offline PIN saved on this device.");window.location.assign(context.user.role==="clinician"?"clinician.html":"facility.html");}catch(error){notify(error.message,true);}return;
  }
  if(form.id==="offlineLoginForm"){
    event.preventDefault();const d=formData(form);
    try{const profile=await verifyOfflinePin(d.offlineLoginPin);STATE.user=profile.user;STATE.facilityId=profile.facilities?.[0]?.id||null;STATE.offlineMode=true;sessionStorage.setItem("phclink-offline-unlocked","1");localStorage.setItem("phclink-cache:/api/facilities",JSON.stringify({facilities:profile.facilities||[]}));localStorage.setItem("phclink-cache:/api/auth/me",JSON.stringify({user:profile.user}));window.location.assign(profile.user.role==="clinician"?"clinician.html":"facility.html");}catch(error){notify(error.message,true);}return;
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
    // Lock synchronously before the first await so rapid/double taps cannot submit twice.
    if(form.dataset.submitting==="true")return;
    form.dataset.submitting="true";
    const submitButtons=Array.from(form.querySelectorAll('button[type="submit"],button:not([type])'));
    submitButtons.forEach(button=>{button.disabled=true;button.dataset.originalText=button.textContent;button.textContent="Saving patient…";});
    const d=formData(form);
    // Keep the same id and PIN if the user retries after a network failure.
    const payload={
      operationId:form.dataset.operationId||(form.dataset.operationId=crypto.randomUUID()),
      facilityId:STATE.facilityId,
      patientPin:form.dataset.patientPin||(form.dataset.patientPin=String(crypto.getRandomValues(new Uint32Array(1))[0]%9000+1000)),
      fullName:d.patientFullName,ageYears:Number(d.patientAge),sex:d.patientSex,
      phone:d.patientPhone||null,nextOfKinName:d.nextOfKinName||null,nextOfKinPhone:d.nextOfKinPhone||null,
      bloodGroup:d.bloodGroup||null,knownConditions:d.knownConditions||null,allergies:d.allergies||null
    };
    try{
      const result=await api("/api/patients",{method:"POST",body:JSON.stringify(payload)});
      STATE.patientSearchResults=[];STATE.openPatient=null;
      await facilityWorkspace();showPatientCard(result);
    }catch(error){
      if(queueOfflineAction("/api/patients",payload,error)){
        notify("Saved Offline — Will Send When Network Comes");
        // Keep the form locked: this registration is already in the pending queue.
      }else{
        form.dataset.submitting="false";
        submitButtons.forEach(button=>{button.disabled=false;button.textContent=button.dataset.originalText||"Register patient and create card";});
        notify(error.message,true);
      }
    }
    return;
  }
  if(form.id==="patientSearchForm"){
    event.preventDefault();const d=formData(form);
    try{const result=await api("/api/patients/search?q="+encodeURIComponent(d.patientSearchQuery));STATE.patientSearchResults=result.patients||[];await facilityWorkspace();}
    catch(error){notify(error.message,true);}return;
  }
  if(form.id==="patientLookupForm"){
    event.preventDefault();const d=formData(form);
    try{const result=await api("/api/patients/lookup",{method:"POST",body:JSON.stringify({patientCode:d.lookupPatientCode,pin:d.lookupPatientPin})});STATE.openPatient=result.patient;STATE.openPatientVisits=result.visits||[];STATE.openPatientPin=d.lookupPatientPin;await saveOfflinePatientRecord(result.patient.patient_code,d.lookupPatientPin,{patient:result.patient,visits:result.visits||[]});await facilityWorkspace();}
    catch(error){if(/Network unavailable/i.test(error.message)){try{const cached=await readOfflinePatientRecord(d.lookupPatientCode,d.lookupPatientPin);STATE.openPatient=cached.patient;STATE.openPatientVisits=cached.visits||[];STATE.openPatientPin=d.lookupPatientPin;notify("Offline patient record opened.");await facilityWorkspace();}catch(cacheError){notify(cacheError.message,true);}}else notify(error.message,true);}return;
  }
  if(form.id==="patientVisitForm"){
    event.preventDefault();const d=formData(form);
    const payload={...d,patientCode:STATE.openPatient.patient_code,operationId:crypto.randomUUID()};
    try{await api("/api/patients/"+encodeURIComponent(d.patientId)+"/visits",{method:"POST",body:JSON.stringify(payload)});const result=await api("/api/patients/lookup",{method:"POST",body:JSON.stringify({patientCode:STATE.openPatient.patient_code,pin:d.pin})});STATE.openPatient=result.patient;STATE.openPatientVisits=result.visits||[];await saveOfflinePatientRecord(result.patient.patient_code,d.pin,{patient:result.patient,visits:result.visits||[]});notify("Visit saved.");await facilityWorkspace();}
    catch(error){if(queueOfflineAction("/api/patients/"+encodeURIComponent(d.patientId)+"/visits",payload,error))notify("Saved Offline — Will Send When Network Comes");else notify(error.message,true);}return;
  }
  if(form.id==="patientEditForm"){
    event.preventDefault();const d=formData(form),path="/api/patients/"+encodeURIComponent(d.patientId),payload={...d,ageYears:Number(d.ageYears),pin:d.pin,patientCode:STATE.openPatient.patient_code};
    try{
      await api(path,{method:"PATCH",body:JSON.stringify(payload)});
      const result=await api("/api/patients/lookup",{method:"POST",body:JSON.stringify({patientCode:STATE.openPatient.patient_code,pin:d.pin})});
      STATE.openPatient=result.patient;STATE.openPatientVisits=result.visits||[];await saveOfflinePatientRecord(result.patient.patient_code,d.pin,{patient:result.patient,visits:result.visits||[]});notify("Patient details updated.");await facilityWorkspace();
    }catch(error){
      if(queueOfflineAction(path,payload,error,"PATCH")){
        const updated={...STATE.openPatient,full_name:d.fullName,age_years:Number(d.ageYears),date_of_birth:d.dateOfBirth||null,sex:d.sex,phone:d.phone||null,next_of_kin_name:d.nextOfKinName||null,next_of_kin_phone:d.nextOfKinPhone||null,blood_group:d.bloodGroup||null,known_conditions:d.knownConditions||null,allergies:d.allergies||null};
        STATE.openPatient=updated;await saveOfflinePatientRecord(updated.patient_code,d.pin,{patient:updated,visits:STATE.openPatientVisits||[]});notify("Saved Offline — Will Send When Network Comes");await facilityWorkspace();
      }else notify(error.message,true);
    }
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
document.addEventListener("click",async event=>{
  const openAnc=event.target.closest("[data-open-anc]");
  if(openAnc){STATE.openAncPregnancyId=openAnc.dataset.openAnc;try{STATE.openAncDetail=await api("/api/anc/"+encodeURIComponent(STATE.openAncPregnancyId));await facilityWorkspace();}catch(error){notify(error.message,true);}return;}
  if(event.target.closest("[data-close-anc]")){STATE.openAncPregnancyId=null;STATE.openAncDetail=null;facilityWorkspace();return;}
  if(event.target.closest("[data-print-anc]")){window.print();return;}
  const reviewAnc=event.target.closest("[data-review-anc-risk]");
  if(reviewAnc){try{await api("/api/anc/"+encodeURIComponent(STATE.openAncPregnancyId)+"/risks/"+encodeURIComponent(reviewAnc.dataset.reviewAncRisk),{method:"PATCH",body:JSON.stringify({status:reviewAnc.dataset.riskStatus||"reviewed"})});STATE.openAncDetail=await api("/api/anc/"+encodeURIComponent(STATE.openAncPregnancyId));notify("Risk flag review updated.");facilityWorkspace();}catch(error){notify(error.message,true);}return;}
  const healthQuestion=event.target.closest("[data-health-question]");if(healthQuestion){askHealthAssistant(healthQuestion.dataset.healthQuestion);return;}
  if(event.target.closest("[data-close-patient-card]")){event.target.closest(".patient-card-modal")?.remove();return;}
  if(event.target.closest("[data-print-patient-card]")){window.print();return;}
  const initializePatient=event.target.closest("[data-initialize-patient]");
  if(initializePatient){api("/api/patients/"+encodeURIComponent(initializePatient.dataset.initializePatient)+"/initialize-pin",{method:"POST",body:"{}"}).then(showPatientCard).catch(error=>notify(error.message,true));return;}
  if(event.target.closest("[data-start-qr-scan]")){
    const panel=document.getElementById("patientQrScanner"),video=document.getElementById("patientQrVideo");
    if(!("BarcodeDetector" in window)||!navigator.mediaDevices?.getUserMedia){notify("QR scanning is not supported on this browser. Enter the Patient ID manually.",true);return;}
    try{
      const detector=new BarcodeDetector({formats:["qr_code"]});
      window.phcQrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      video.srcObject=window.phcQrStream;panel.hidden=false;await video.play();
      const scan=async()=>{if(!window.phcQrStream||panel.hidden)return;try{const codes=await detector.detect(video);if(codes.length){const input=document.getElementById("lookupPatientCode");if(input){input.value=codes[0].rawValue;document.getElementById("lookupPatientPin")?.focus();}stopPatientQrScanner();notify("QR code scanned. Enter the patient's PIN.");return;}}catch(_){}window.phcQrFrame=requestAnimationFrame(scan);};
      scan();
    }catch(error){notify("Unable to open the camera. Check camera permission or enter the Patient ID manually.",true);stopPatientQrScanner();}
    return;
  }
  if(event.target.closest("[data-stop-qr-scan]")){stopPatientQrScanner();return;}
  const lookupCode=event.target.closest("[data-lookup-code]");
  if(lookupCode){const input=document.getElementById("lookupPatientCode");if(input){input.value=lookupCode.dataset.lookupCode;input.focus();}return;}
  if(event.target.closest("[data-close-patient-record]")){STATE.openPatient=null;STATE.openPatientVisits=[];STATE.openPatientPin=null;facilityWorkspace();return;}
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
  const saveDesignation=event.target.closest("[data-save-user-designation]");
  if(saveDesignation){
    const id=saveDesignation.dataset.saveUserDesignation;
    const select=document.querySelector('[data-user-designation="'+id+'"]');
    saveDesignation.disabled=true;
    api("/api/admin/users/"+encodeURIComponent(id)+"/designation",{method:"PATCH",body:JSON.stringify({designation:select.value||null})})
      .then(()=>{notify("Professional designation updated.");dashboardView();})
      .catch(error=>{notify(error.message,true);saveDesignation.disabled=false;});
    return;
  }
  const saveClinical=event.target.closest("[data-save-clinical-access]");
  if(saveClinical){
    const id=saveClinical.dataset.saveClinicalAccess;
    const input=document.querySelector('[data-user-clinical-access="'+id+'"]');
    saveClinical.disabled=true;
    api("/api/admin/users/"+encodeURIComponent(id)+"/clinical-access",{method:"PATCH",body:JSON.stringify({canRespondEmergency:input.checked})})
      .then(()=>{notify("Clinical response access updated.");dashboardView();})
      .catch(error=>{notify(error.message,true);saveClinical.disabled=false;});
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
  const editPatient=event.target.closest("[data-edit-patient]");
  if(editPatient){
    const modal=document.getElementById("patientEditor");
    if(modal){
      document.getElementById("editPatientId").value=editPatient.dataset.editPatient;
      document.getElementById("editPatientFullName").value=editPatient.dataset.name||"";
      document.getElementById("editPatientDateOfBirth").value=editPatient.dataset.dob||"";
      document.getElementById("editPatientSex").value=editPatient.dataset.sex||"";
      document.getElementById("editPatientPhone").value=editPatient.dataset.phone||"";
      modal.hidden=false;document.getElementById("editPatientFullName").focus();
    }
    return;
  }
  if(event.target.closest("[data-close-patient-editor]")){const modal=document.getElementById("patientEditor");if(modal)modal.hidden=true;return;}
  if(event.target.id==="patientEditor"){event.target.hidden=true;return;}
  const language=event.target.closest("[data-language-switch]");
  if(language){localStorage.setItem("phclink-language",currentLanguage()==="ha"?"en":"ha");applyFacilityLanguage();return;}
  const alertSimulation=event.target.closest("[data-alert-source]");
  if(alertSimulation){
    const form=document.getElementById("alertSimulationForm"),code=form?.elements.alertCode?.value,details=form?.elements.details?.value||"";
    if(!code){notify("Select an alert type first.",true);return;}
    alertSimulation.disabled=true;
    try{const result=await api("/api/alert",{method:"POST",body:JSON.stringify({code,phc_code:STATE.facilityCode||document.querySelector(".facility-code")?.textContent||"",details,source:alertSimulation.dataset.alertSource})});notify("Alert received: "+(ALERT_CODE_LABELS[result.alert.code]||result.alert.code));}
    catch(error){notify(error.message,true);}
    finally{alertSimulation.disabled=false;}
    return;
  }
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
  if(event.target.closest("#logoutButton")||event.target.closest("[data-admin-logout]")||event.target.closest("#staffLogout")||event.target.closest("#clinicianLogout")){
    try{await api("/api/auth/logout",{method:"POST"});}catch(_){}finally{sessionStorage.removeItem("phclink-offline-unlocked");localStorage.removeItem(OFFLINE_PROFILE_KEY);Object.keys(localStorage).filter(key=>key.startsWith("phclink-cache:")).forEach(key=>localStorage.removeItem(key));STATE.user=null;STATE.facilityId=null;notify("Signed out. Pending offline actions remain saved on this device.");window.location.assign("index.html");}
  }
});
render();
window.addEventListener("online",async()=>{
  updateSyncIndicator();
  try{
    const response=await fetch("/api/auth/me",{credentials:"include"});
    if(!response.ok){notify("Reconnect with your account password before pending records can sync.",true);return;}
    const data=await response.json();STATE.user=data.user;STATE.offlineMode=false;sessionStorage.removeItem("phclink-offline-unlocked");
    localStorage.setItem("phclink-cache:/api/auth/me",JSON.stringify({user:data.user}));
    await flushOfflineQueue();
    if(WORKSPACE==="facility")facilityWorkspace();
  }catch(_){}
});
window.addEventListener("offline",()=>{
  updateSyncIndicator();
  // Require the staff member to unlock with their PIN whenever connectivity is lost.
  sessionStorage.removeItem("phclink-offline-unlocked");
  STATE.user=null;STATE.facilityId=null;STATE.offlineMode=false;
  offlineAccessView();
});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js").catch(()=>{}));
let phcDeferredInstall=null;
function phcIsStandalone(){
  return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;
}
function phcInstallButton(){
  const header=document.querySelector(".top");
  if(!header||document.getElementById("phcInstallButton")||phcIsStandalone())return;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(!phcDeferredInstall&&!ios)return;
  const button=document.createElement("button");
  button.id="phcInstallButton";
  button.type="button";
  button.className="phc-install-button";
  button.textContent=ios?"Add to Home Screen":"Install App";
  button.addEventListener("click",async()=>{
    if(phcDeferredInstall){
      phcDeferredInstall.prompt();
      const choice=await phcDeferredInstall.userChoice;
      if(choice?.outcome==="accepted")button.remove();
      phcDeferredInstall=null;
      return;
    }
    if(ios)notify('To install PHC Link: tap Share, then "Add to Home Screen".');
  });
  header.appendChild(button);
}
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  phcDeferredInstall=event;
  phcInstallButton();
});
window.addEventListener("appinstalled",()=>{
  phcDeferredInstall=null;
  document.getElementById("phcInstallButton")?.remove();
});
window.addEventListener("load",phcInstallButton);


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
