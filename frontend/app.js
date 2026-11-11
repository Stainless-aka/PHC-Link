/* PHC Link: live API-backed administration and facility shell. */
const PAGE = document.body.dataset.page || "home";
const WORKSPACE = document.body.dataset.workspace || "login";
const API_BASE_URL = "";
const STATE = { page:PAGE, admin:null, user:null, facilityId:null, busy:false };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
}
async function api(path, options={}) {
  const response = await fetch(API_BASE_URL + path, {
    ...options, credentials:"include", mode:"cors",
    headers:{ "Content-Type":"application/json", ...(options.headers||{}) }
  });
  const payload = response.status === 204 ? {} : await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(payload.error || "Request failed. Please try again.");
  return payload;
}
function notify(message, error=false) {
  const toast=document.getElementById("toast");
  if(!toast) return;
  toast.textContent=message; toast.hidden=false;
  toast.style.background=error?"#8b3434":"#142f43";
  clearTimeout(notify.timer); notify.timer=setTimeout(()=>toast.hidden=true,4500);
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
    if(!["health_worker","clinician"].includes(STATE.user.role)){
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
      const [data,destinations]=await Promise.all([
        api("/api/referrals?facilityId="+encodeURIComponent(selected.id)),
        api("/api/facilities/referral-destinations?originFacilityId="+encodeURIComponent(selected.id))
      ]);
      const rows=data.referrals||[], targets=destinations.facilities||[];
      const targetOptions=options(targets,"id",r=>r.name+" · "+r.lga_name);
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Create referral</h3><p>Send a referral from your assigned facility to another facility.</p></div></div>'+(targets.length?'<form id="referralForm" class="admin-form">'+selectField("Destination facility","destinationFacilityId",targetOptions)+field("Reason for referral","reasonCode","text",true,'maxlength="100" placeholder="e.g. Maternal complication"')+selectField("Urgency","urgency",'<option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>')+field("Patient age in years (optional)","patientAgeYears","number",false,'min="0" max="120" step="1"')+selectField("Patient sex (optional)","patientSex",'<option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option>',"Not recorded",false)+'<button class="btn" type="submit">Create referral</button></form>':'<p class="empty-state">No receiving facility is registered yet. Ask the system administrator to add at least one more active facility. It can be in any LGA or state.</p>')+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Referral records</h3><p>Referrals sent from or received by this facility</p></div><span class="count-label">'+rows.length+' records</span></div><div class="table-wrap"><table><thead><tr><th>Referral code</th><th>Origin</th><th>Destination</th><th>Urgency</th><th>Status</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.referral_code)+'</td><td>'+escapeHtml(r.origin_facility)+'</td><td>'+escapeHtml(r.destination_facility)+'</td><td>'+escapeHtml(r.urgency)+'</td><td><span class="pill '+(r.status==="completed"?"ok":(r.status==="rejected"||r.status==="cancelled"?"out":"q"))+'">'+escapeHtml(r.status)+'</span></td></tr>').join(""):'<tr><td colspan="5">No referrals recorded for this facility.</td></tr>')+'</tbody></table></div></section>';
    } else if(STATE.page==="patients"){
      const data=await api("/api/patients?facilityId="+encodeURIComponent(selected.id));
      const rows=data.patients||[];
      content+='<section class="panel admin-panel"><div class="panel-head"><div><h3>Register a patient</h3><p>Create a patient record for this facility. Only necessary details are requested.</p></div></div><form id="patientForm" class="admin-form">'+field("Patient full name","patientFullName","text",true,'maxlength="160" autocomplete="name"')+field("Date of birth (optional)","patientDateOfBirth","date",false,'max="'+new Date().toISOString().slice(0,10)+'"')+selectField("Sex (optional)","patientSex",'<option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option>',"Not recorded",false)+field("Phone number (optional)","patientPhone","tel",false,'maxlength="30" autocomplete="tel"')+'<button class="btn" type="submit">Register patient</button></form></section><section class="panel admin-panel"><div class="panel-head"><div><h3>Patient register</h3><p>Records registered at this facility</p></div><span class="count-label">'+rows.length+' patients</span></div><div class="table-wrap"><table><thead><tr><th>Patient ID</th><th>Full name</th><th>Date of birth</th><th>Sex</th><th>Phone</th><th>Date registered</th></tr></thead><tbody>'+(rows.length?rows.map(p=>'<tr><td>'+escapeHtml(p.patient_code)+'</td><td>'+escapeHtml(p.full_name)+'</td><td>'+escapeHtml(p.date_of_birth||"—")+'</td><td>'+escapeHtml(p.sex||"—")+'</td><td>'+escapeHtml(p.phone||"—")+'</td><td>'+escapeHtml(new Date(p.created_at).toLocaleDateString())+'</td></tr>').join(""):'<tr><td colspan="6">No patients registered at this facility yet.</td></tr>')+'</tbody></table></div></section>';
    } else if(STATE.page==="ussd") content+='<p class="sub">USSD and SMS integrations have not yet been configured.</p>';
    else content+='<div class="kpis"><article class="kpi"><div class="kpi-copy"><span>Assigned facilities</span><b>'+facilities.length+'</b><small>Facilities linked to your account</small></div></article><article class="kpi"><div class="kpi-copy"><span>Workspace role</span><b>'+escapeHtml(STATE.user.role==="health_worker"?"Health worker":"Clinician")+'</b><small>Access is limited to assigned facilities</small></div></article></div><p class="sub">Use the navigation to view stock balances and referrals for your assigned facility.</p>';
    content+='</section>';
    const nav=[["home","Home","facility.html"],["stock","Stock","stock.html"],["ref","Referrals","referrals.html"],["patients","Patients","patients.html"],["ussd","USSD","ussd.html"]];
    root.innerHTML='<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>Facility workspace</b><small>Signed in as '+escapeHtml(STATE.user.fullName)+' · '+escapeHtml(STATE.user.role)+'</small></div><button class="btn sec sm" id="staffLogout" type="button">Sign out</button></header><div class="net"><span id="apiStatus">Authenticated session</span></div>'+(facilities.length>1?'<div class="panel"><label for="facilityPicker">Your facility</label><select id="facilityPicker">'+facilities.map(f=>'<option value="'+escapeHtml(f.id)+'" '+(f.id===selected.id?'selected':'')+'>'+escapeHtml(f.name)+'</option>').join("")+'</select></div>':'')+'<nav class="tabs" aria-label="Facility sections">'+nav.map(([key,label,url])=>'<a href="'+url+'"'+(STATE.page===key?' aria-current="page"':'')+'>'+label+'</a>').join("")+'</nav><main class="body">'+content+'</main></div></div>';
  } catch(error) {
    if(error.message==="Authentication required."){STATE.user=null;window.location.replace("index.html");}
    else root.innerHTML='<section class="panel"><h2>Facility workspace unavailable</h2><p class="sub">'+escapeHtml(error.message)+'</p><button class="btn sec" onclick="render()">Retry</button></section>';
  }
}
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
function adminWorkspace(data) {
  const stateOpts=options(data.states,"id",r=>r.name);
  const lgaOpts=options(data.lgas,"id",r=>r.name+" — "+r.state_name);
  const facilityOpts=options(data.facilities,"id",r=>r.name+" — "+r.lga_name);
  const cards=[["States",data.states.length,"Geographic coverage","state"],["LGAs",data.lgas.length,"Local government areas","lga"],["Facilities",data.facilities.length,"Registered care locations","facility"],["User accounts",data.users.length,"Staff and administrators","users"],["Stock catalogue",data.items.length,"Reusable inventory items","items"],["Referrals",data.referralCount||0,"Patient transfers recorded","referrals"]];
  const kpis=cards.map(([label,count,detail,key])=>'<article class="admin-kpi"><div class="admin-kpi-top"><span>'+label+'</span><span class="admin-kpi-mark">'+({state:"◎",lga:"⌖",facility:"▦",users:"♙",items:"▤"}[key])+'</span></div><strong>'+count+'</strong><small>'+detail+'</small></article>').join("");
  const list=(rows,columns)=>rows.length?'<div class="table-wrap"><table><thead><tr>'+columns.map(c=>'<th>'+c[0]+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(c=>'<td>'+escapeHtml(c[1](row))+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>':'<div class="admin-empty"><span class="admin-empty-icon">＋</span><strong>Nothing here yet</strong><p>Records will appear here once they have been added.</p></div>';
  const userRows=data.users.length?'<div class="table-wrap"><table><thead><tr><th>User</th><th>Current role</th><th>Account status</th><th>Assigned facilities</th><th>Assign facility</th><th>Update role</th></tr></thead><tbody>'+data.users.map(user=>{
    const canAssign=["health_worker","clinician"].includes(user.role);
    const assigned=(user.assigned_facilities||[]).length?user.assigned_facilities.map(name=>'<span class="admin-facility-chip">'+escapeHtml(name)+'</span>').join(""):'<span class="admin-unassigned">No facility assigned</span>';
    return '<tr><td><div class="admin-user-cell"><span class="admin-avatar">'+escapeHtml((user.full_name||"U").trim().charAt(0).toUpperCase())+'</span><span><strong>'+escapeHtml(user.full_name)+'</strong><small>'+escapeHtml(user.email)+'</small></span></div></td><td><span class="admin-role">'+escapeHtml(user.role.replace(/_/g," "))+'</span></td><td><span class="admin-status '+(user.is_active?"active":"inactive")+'">'+(user.is_active?"Active":"Disabled")+'</span></td><td><div class="admin-assigned-facilities">'+assigned+'</div></td><td>'+(canAssign?'<div class="role-edit admin-assign-control"><select aria-label="Facility for '+escapeHtml(user.full_name)+'" data-user-facility="'+escapeHtml(user.id)+'"><option value="">Select facility</option>'+options(data.facilities,"id",r=>r.name+" — "+r.lga_name)+'</select><button class="btn sec sm" type="button" data-assign-facility="'+escapeHtml(user.id)+'">Assign</button></div>':'<span class="admin-muted">Not applicable</span>')+'</td><td><div class="role-edit"><select aria-label="Role for '+escapeHtml(user.full_name)+'" data-user-role="'+escapeHtml(user.id)+'"><option value="health_worker" '+(user.role==="health_worker"?"selected":"")+'>Health worker</option><option value="clinician" '+(user.role==="clinician"?"selected":"")+'>Clinician</option><option value="lga_officer" '+(user.role==="lga_officer"?"selected":"")+'>LGA officer</option><option value="state_admin" '+(user.role==="state_admin"?"selected":"")+'>State admin</option><option value="system_admin" '+(user.role==="system_admin"?"selected":"")+'>System admin</option></select><button class="btn sec sm" type="button" data-save-user-role="'+escapeHtml(user.id)+'">Save</button></div></td></tr>';
  }).join("")+'</tbody></table></div>':'<div class="admin-empty"><span class="admin-empty-icon">♙</span><strong>No user accounts yet</strong><p>Create accounts for staff and administrators to get started.</p></div>';
  return '<div class="admin-app"><aside class="admin-sidebar"><a class="admin-side-brand" href="admin.html"><span class="admin-brand-mark">＋</span><span><strong>PHC Link</strong><small>ADMIN CONSOLE</small></span></a><div class="admin-side-label">WORKSPACE</div><nav class="admin-nav" aria-label="Administration navigation"><a class="active" href="#adminOverview"><span>⌂</span>Overview</a><a href="#adminSetup"><span>＋</span>Set up system</a><a href="#adminUsers"><span>♙</span>User accounts</a><a href="#adminReferrals"><span>⇄</span>Referrals</a><a href="#adminDirectory"><span>▦</span>Directories</a></nav><div class="admin-sidebar-bottom"><div class="admin-security-note"><span>◈</span><div><strong>Secure workspace</strong><small>System administrator access</small></div></div><button class="admin-logout" id="logoutButton" type="button"><span>↪</span> Sign out</button></div></aside><div class="admin-main"><header class="admin-topbar"><div><span class="admin-breadcrumb">PHC LINK</span><span class="admin-breadcrumb-sep">/</span><strong>Administration</strong></div><div class="admin-account"><span class="admin-avatar">'+escapeHtml((STATE.user.fullName||"A").trim().charAt(0).toUpperCase())+'</span><span><strong>'+escapeHtml(STATE.user.fullName)+'</strong><small>System administrator</small></span></div></header><div class="admin-content"><section id="adminOverview" class="admin-welcome"><div><div class="eyebrow">SYSTEM OVERVIEW</div><h2>Good day, '+escapeHtml((STATE.user.fullName||"Administrator").split(" ")[0])+'</h2><p>Manage your healthcare network, staff access and inventory catalogue from one place.</p></div><span class="admin-live-label"><i></i> Live database</span></section><section class="admin-kpis">'+kpis+'</section><section id="adminSetup" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">CONFIGURATION</span><h3>Set up your network</h3><p>Build the geographic structure and register the resources PHC Link needs.</p></div><span class="admin-section-count">5 management tools</span></div><div class="admin-forms-grid">'+
    formPanel("Add a state","Create a state in your service network.","stateForm",field("State name","name")+field("State code (optional)","code","text",false),"Add state")+
    formPanel("Add an LGA","Place a local government area under a state.","lgaForm",selectField("Parent state","stateId",stateOpts)+field("LGA name","name"),"Add LGA")+
    formPanel("Register a facility","Add a primary healthcare facility to an LGA.","facilityForm",selectField("Local government area","lgaId",lgaOpts)+field("Facility name","name")+field("Facility code","code")+field("Address (optional)","address","text",false),"Register facility")+
    formPanel("Create a user account","Create staff access and assign the appropriate scope.","userForm",field("Full name","fullName")+field("Email address","email","email")+field("Temporary password (minimum 12 characters)","password","password",true,'minlength="12"')+selectField("Account role","role",'<option value="health_worker">Health worker</option><option value="clinician">Clinician</option><option value="lga_officer">LGA officer</option>')+selectField("Assigned facility","facilityId",facilityOpts,"Choose a facility — if applicable",false)+selectField("Assigned LGA","lgaId",lgaOpts,"Choose an LGA — if applicable",false)+field("Phone number (optional)","phone","tel",false),"Create account")+
    formPanel("Add an inventory item","Create a catalogue item that facilities can track.","itemForm",field("Item name","name")+field("Category","category")+field("Unit of measure","unit")+field("Minimum stock alert level","minimumStock","number",true,'min="0" step="0.01" value="0"'),"Add inventory item")+
    '</div></section><section id="adminUsers" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">ACCESS CONTROL</span><h3>User accounts</h3><p>Review staff accounts, assign one or more facilities, and manage user roles.</p></div><span class="admin-section-count">'+data.users.length+' accounts</span></div><section class="panel admin-panel admin-table-panel">'+userRows+'</section></section><section id="adminReferrals" class="admin-section">'+
'<div class="admin-section-heading"><div><span class="eyebrow">PATIENT TRANSFERS</span><h3>Referral records</h3><p>All referrals submitted across registered facilities, including their origin, destination and current status.</p></div><span class="admin-section-count">'+(data.referralCount||0)+' total referrals</span></div>'+
'<section class="panel admin-panel admin-table-panel"><div class="table-wrap"><table>'+
'<thead><tr><th>Referral code</th><th>Origin facility</th><th>Destination facility</th><th>Created by</th><th>Reason</th><th>Urgency</th><th>Status</th><th>Date created</th></tr></thead>'+
'<tbody>'+((data.referrals||[]).length?(data.referrals||[]).map(r=>'<tr><td><strong>'+escapeHtml(r.referral_code)+'</strong></td><td>'+escapeHtml(r.origin_facility)+' <small>'+escapeHtml(r.origin_lga)+'</small></td><td>'+escapeHtml(r.destination_facility)+' <small>'+escapeHtml(r.destination_lga)+'</small></td><td>'+escapeHtml(r.created_by_name||"Unavailable")+'</td><td>'+escapeHtml(r.reason_code)+'</td><td>'+escapeHtml(r.urgency)+'</td><td><span class="pill '+(r.status==="completed"?"ok":(r.status==="rejected"||r.status==="cancelled"?"out":"q"))+'">'+escapeHtml(r.status)+'</span></td><td>'+escapeHtml(new Date(r.created_at).toLocaleString())+'</td></tr>').join(""):'<tr><td colspan="8">No referrals have been submitted yet.</td></tr>')+'</tbody></table></div></section></section><section id="adminDirectory" class="admin-section"><div class="admin-section-heading"><div><span class="eyebrow">NETWORK DIRECTORY</span><h3>Registered records</h3><p>Review the locations and catalogue entries currently in the system.</p></div></div><div class="admin-directory-grid"><section class="panel admin-panel"><div class="panel-head"><div><h3>Healthcare facilities</h3><p>Registered service locations</p></div><span class="count-label">'+data.facilities.length+'</span></div>'+list(data.facilities,[["Facility",r=>r.name],["Code",r=>r.code||"—"],["LGA",r=>r.lga_name],["State",r=>r.state_name]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Inventory catalogue</h3><p>Items available for stock tracking</p></div><span class="count-label">'+data.items.length+'</span></div>'+list(data.items,[["Item",r=>r.name],["Category",r=>r.category],["Unit",r=>r.unit],["Minimum",r=>r.default_minimum_stock]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Local government areas</h3><p>Registered LGAs and their states</p></div><span class="count-label">'+data.lgas.length+'</span></div>'+list(data.lgas,[["LGA",r=>r.name],["State",r=>r.state_name]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>States</h3><p>States in the network</p></div><span class="count-label">'+data.states.length+'</span></div>'+list(data.states,[["State",r=>r.name],["Code",r=>r.code||"—"]])+'</section></div></section><footer class="admin-footer">PHC Link · Administration <span>Secure healthcare operations</span></footer></div></div></div>';
}
async function dashboardView() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Loading administration…</p></div>';
  try {
    const me=await api("/api/auth/me"); STATE.user=me.user;
    if(STATE.user.role!=="system_admin"){
      if(["health_worker","clinician"].includes(STATE.user.role)) window.location.replace("facility.html");
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
      else if(["health_worker","clinician"].includes(role)) window.location.replace("facility.html");
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
  if(form.id==="bootstrapForm"){
    event.preventDefault();const d=formData(form);
    try{await api("/api/setup/bootstrap",{method:"POST",headers:{"x-bootstrap-secret":d.bootstrapSecret},body:JSON.stringify({fullName:d.fullName,email:d.email,password:d.password,stateName:d.stateName,lgaName:d.lgaName})});notify("Administrator created. Sign in now.");loginPageView();}
    catch(error){notify(error.message,true);}return;
  }
  if(form.id==="signupForm"){event.preventDefault();const d=formData(form);if(d.signupPassword!==d.signupPasswordConfirm){notify("The passwords do not match.",true);return;}if(!/^(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{8,}$/.test(d.signupPassword)){notify("Password must be at least 8 characters and contain letters and numbers only.",true);return;}try{await api("/api/auth/signup",{method:"POST",body:JSON.stringify({fullName:d.signupFullName,email:d.signupEmail,password:d.signupPassword})});notify("Account created. You can now sign in.");rootAuthLogin();}catch(error){notify(error.message,true);}return;}
  if(form.id==="loginForm"){
    event.preventDefault();const d=formData(form);
    try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:d.loginEmail,password:d.loginPassword})});STATE.user=result.user;notify("Signed in successfully.");window.location.assign(result.user.role==="system_admin"?"admin.html":(["health_worker","clinician"].includes(result.user.role)?"facility.html":"index.html"));}
    catch(error){notify(error.message,true);}return;
  }
  if(form.id==="stockMovementForm"){
    event.preventDefault();
    const d=formData(form);
    const payload={operationId:crypto.randomUUID(),facilityId:STATE.facilityId,itemId:d.itemId,movementType:d.movementType,quantity:Number(d.quantity),adjustmentDirection:d.adjustmentDirection||"increase",batchNumber:d.batchNumber||null,expiryDate:d.expiryDate||null,note:d.note||null};
    try{await api("/api/inventory/movements",{method:"POST",body:JSON.stringify(payload)});notify("Stock movement recorded.");await facilityWorkspace();}
    catch(error){notify(error.message,true);}
    return;
  }
  if(form.id==="patientForm"){
    event.preventDefault();
    const d=formData(form);
    try{
      const result=await api("/api/patients",{method:"POST",body:JSON.stringify({facilityId:STATE.facilityId,fullName:d.patientFullName,dateOfBirth:d.patientDateOfBirth||null,sex:d.patientSex||null,phone:d.patientPhone||null})});
      notify("Patient registered: "+result.patient.patient_code);
      await facilityWorkspace();
    }catch(error){notify(error.message,true);}
    return;
  }
  if(form.id==="referralForm"){
    event.preventDefault();
    const d=formData(form);
    const payload={operationId:crypto.randomUUID(),originFacilityId:STATE.facilityId,destinationFacilityId:d.destinationFacilityId,reasonCode:d.reasonCode.trim(),urgency:d.urgency,patientAgeYears:d.patientAgeYears===""?null:Number(d.patientAgeYears),patientSex:d.patientSex||null};
    try{const result=await api("/api/referrals",{method:"POST",body:JSON.stringify(payload)});notify("Referral created: "+result.referral.referral_code);await facilityWorkspace();}
    catch(error){notify(error.message,true);}
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
document.addEventListener("change",event=>{if(event.target.id==="facilityPicker"){STATE.facilityId=event.target.value;facilityWorkspace();}});
document.addEventListener("click",async event=>{
  if(event.target.closest("#logoutButton")||event.target.closest("#staffLogout")){
    try{await api("/api/auth/logout",{method:"POST"});STATE.user=null;STATE.facilityId=null;notify("Signed out.");window.location.assign("index.html");}
    catch(error){notify(error.message,true);}
  }
});
render();

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
