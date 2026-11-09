/* PHC Link: live API-backed administration and facility shell. */
const PAGE = document.body.dataset.page || "home";
const API_BASE_URL = "";
const STATE = { view:"app", page:PAGE, admin:null, user:null, facilityId:null, busy:false };

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
function setView(view) {
  STATE.view=view;
  document.getElementById("vApp")?.setAttribute("aria-pressed",String(view==="app"));
  document.getElementById("vDash")?.setAttribute("aria-pressed",String(view==="dash"));
  render();
}
function facilityLoginView() {
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">FACILITY WORKSPACE</div><h2>Staff sign in</h2><p class="sub">Registered health workers and clinicians can access their assigned facility after signing in.</p></div></div><div class="panel setup-panel"><form id="loginForm" class="admin-form">'+field("Email address","loginEmail","email",true,'autocomplete="username"')+field("Password","loginPassword","password",true,'autocomplete="current-password"')+'<button class="btn" type="submit">Sign in to facility</button></form></div></section>';
}
async function facilityWorkspace() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Checking your staff session…</p></div>';
  try {
    const me=await api("/api/auth/me"); STATE.user=me.user;
    if(STATE.user.role==="system_admin"){
      root.innerHTML='<section class="panel setup-panel"><h2>Administrator account</h2><p class="sub">This account manages PHC Link administration. Facility tools are reserved for registered health workers and clinicians.</p><button class="btn" type="button" onclick="setView(\'dash\')">Open administration</button></section>'; return;
    }
    if(!["health_worker","clinician"].includes(STATE.user.role)){
      root.innerHTML='<section class="panel setup-panel"><h2>Workspace not available</h2><p class="sub">Your account role does not have access to the facility workspace. Contact the system administrator.</p><button class="btn sec" id="staffLogout" type="button">Sign out</button></section>'; return;
    }
    const result=await api("/api/facilities"), facilities=result.facilities||[];
    if(!facilities.length){
      root.innerHTML='<section class="panel setup-panel"><h2>No facility assigned</h2><p class="sub">Your account is active, but no facility has been assigned. Contact the system administrator.</p><button class="btn sec" id="staffLogout" type="button">Sign out</button></section>'; return;
    }
    const selected=facilities.find(f=>f.id===STATE.facilityId)||facilities[0]; STATE.facilityId=selected.id;
    let content='<section class="panel"><h2>'+({home:"Facility overview",stock:"Stock management",ref:"Referrals",ussd:"USSD & SMS"}[STATE.page]||"Facility overview")+'</h2><p class="sub">'+escapeHtml(selected.name)+' · '+escapeHtml(selected.lga_name)+', '+escapeHtml(selected.state_name)+'</p>';
    if(STATE.page==="stock"){
      const data=await api("/api/inventory/balances?facilityId="+encodeURIComponent(selected.id)), rows=data.balances||[];
      content+='<div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Available balance</th><th>Unit</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.category)+'</td><td>'+escapeHtml(r.quantity)+'</td><td>'+escapeHtml(r.unit)+'</td></tr>').join(""):'<tr><td colspan="4">No inventory catalogue items available yet.</td></tr>')+'</tbody></table></div>';
    } else if(STATE.page==="ref"){
      const data=await api("/api/referrals?facilityId="+encodeURIComponent(selected.id)), rows=data.referrals||[];
      content+='<div class="table-wrap"><table><thead><tr><th>Referral code</th><th>Origin</th><th>Destination</th><th>Urgency</th><th>Status</th></tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.referral_code)+'</td><td>'+escapeHtml(r.origin_facility)+'</td><td>'+escapeHtml(r.destination_facility)+'</td><td>'+escapeHtml(r.urgency)+'</td><td>'+escapeHtml(r.status)+'</td></tr>').join(""):'<tr><td colspan="5">No referrals recorded for this facility.</td></tr>')+'</tbody></table></div>';
    } else if(STATE.page==="ussd") content+='<p class="sub">USSD and SMS integrations have not yet been configured.</p>';
    else content+='<div class="kpis"><article class="kpi"><div class="kpi-copy"><span>Assigned facilities</span><b>'+facilities.length+'</b><small>Facilities linked to your account</small></div></article><article class="kpi"><div class="kpi-copy"><span>Workspace role</span><b>'+escapeHtml(STATE.user.role==="health_worker"?"Health worker":"Clinician")+'</b><small>Access is limited to assigned facilities</small></div></article></div><p class="sub">Use the navigation to view stock balances and referrals for your assigned facility.</p>';
    content+='</section>';
    const nav=[["home","Home","index.html"],["stock","Stock","stock.html"],["ref","Referrals","referrals.html"],["ussd","USSD","ussd.html"]];
    root.innerHTML='<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>Facility workspace</b><small>Signed in as '+escapeHtml(STATE.user.fullName)+' · '+escapeHtml(STATE.user.role)+'</small></div><button class="btn sec sm" id="staffLogout" type="button">Sign out</button></header><div class="net"><span id="apiStatus">Authenticated session</span></div>'+(facilities.length>1?'<div class="panel"><label for="facilityPicker">Your facility</label><select id="facilityPicker">'+facilities.map(f=>'<option value="'+escapeHtml(f.id)+'" '+(f.id===selected.id?'selected':'')+'>'+escapeHtml(f.name)+'</option>').join("")+'</select></div>':'')+'<nav class="tabs" aria-label="Facility sections">'+nav.map(([key,label,url])=>'<a href="'+url+'"'+(STATE.page===key?' aria-current="page"':'')+'>'+label+'</a>').join("")+'</nav><main class="body">'+content+'</main></div></div>';
  } catch(error) {
    if(error.message==="Authentication required."){STATE.user=null;root.innerHTML=facilityLoginView();}
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
function loginView() {
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">SECURE ADMINISTRATION</div><h2>Sign in</h2><p class="sub">Sign in with your PHC Link administrator account.</p></div></div><div class="panel setup-panel"><form id="loginForm" class="admin-form">'+field("Email address","loginEmail","email",true,'autocomplete="username"')+field("Password","loginPassword","password",true,'autocomplete="current-password"')+'<button class="btn" type="submit">Sign in</button></form></div></section>';
}
function adminWorkspace(data) {
  const stateOpts=options(data.states,"id",r=>r.name);
  const lgaOpts=options(data.lgas,"id",r=>r.name+" — "+r.state_name);
  const facilityOpts=options(data.facilities,"id",r=>r.name+" — "+r.lga_name);
  const roleOpts='<option value="health_worker">Health worker</option><option value="clinician">Clinician</option><option value="lga_officer">LGA officer</option>';
  const cards=[["States",data.states.length],["LGAs",data.lgas.length],["Facilities",data.facilities.length],["Users",data.users.length],["Inventory items",data.items.length]];
  const kpis=cards.map(([label,count])=>'<article class="kpi"><div class="kpi-copy"><span>'+label+'</span><b>'+count+'</b><small>Live database records</small></div></article>').join("");
  const list=(rows,columns)=>rows.length?'<div class="table-wrap"><table><thead><tr>'+columns.map(c=>'<th>'+c[0]+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(c=>'<td>'+escapeHtml(c[1](row))+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>':'<p class="empty-state">No records have been added yet.</p>';
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">SYSTEM ADMINISTRATION</div><h2>Administration</h2><p class="sub">Signed in as '+escapeHtml(STATE.user.fullName)+' · '+escapeHtml(STATE.user.role)+'</p></div><button class="btn sec sm" id="logoutButton" type="button">Sign out</button></div><div class="kpis">'+kpis+'</div><div class="admin-grid">'+
    formPanel("Add state","Create a state record.","stateForm",field("State name","name")+field("State code (optional)","code", "text",false),"Add state")+
    formPanel("Add LGA","Select its parent state.","lgaForm",selectField("State","stateId",stateOpts)+field("LGA name","name"),"Add LGA")+
    formPanel("Register facility","Create a healthcare facility under an LGA.","facilityForm",selectField("LGA","lgaId",lgaOpts)+field("Facility name","name")+field("Facility code","code")+field("Address (optional)","address","text",false),"Register facility")+
    formPanel("Create user account","Create a staff account and assign its scope.","userForm",field("Full name","fullName")+field("Email","email","email")+field("Temporary password (minimum 12 characters)","password","password",true,'minlength="12"')+selectField("Role","role",roleOpts)+selectField("Facility (health worker / clinician)","facilityId",facilityOpts,"Select facility — if applicable",false)+selectField("LGA (LGA officer)","lgaId",lgaOpts,"Select LGA — if applicable",false)+field("Phone (optional)","phone","tel",false),"Create account")+
    formPanel("Add inventory item","Create a reusable stock catalogue item.","itemForm",field("Item name","name")+field("Category","category")+field("Unit (e.g. packs, doses, boxes)","unit")+field("Minimum stock alert level","minimumStock","number",true,'min="0" step="0.01" value="0"'),"Add item")+
    '</div><section class="panel admin-panel"><div class="panel-head"><div><h3>Registered facilities</h3><p>Current facility directory</p></div></div>'+list(data.facilities,[["Facility",r=>r.name],["Code",r=>r.code],["LGA",r=>r.lga_name],["State",r=>r.state_name]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>User accounts</h3><p>Staff and administration accounts</p></div></div>'+list(data.users,[["Name",r=>r.full_name],["Email",r=>r.email],["Role",r=>r.role],["Status",r=>r.is_active?"Active":"Disabled"]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Inventory catalogue</h3><p>Items available for facility stock recording</p></div></div>'+list(data.items,[["Item",r=>r.name],["Category",r=>r.category],["Unit",r=>r.unit],["Minimum",r=>r.default_minimum_stock]])+'</section><section class="panel admin-panel"><div class="panel-head"><div><h3>Local government areas</h3><p>Registered LGAs and their states</p></div></div>'+list(data.lgas,[["LGA",r=>r.name],["State",r=>r.state_name]])+'</section></section>';
}
async function dashboardView() {
  const root=document.getElementById("root");
  root.innerHTML='<div class="dashboard"><p class="sub">Loading administration…</p></div>';
  try {
    const setup=await api("/api/setup/status",{headers:{}});
    if(!setup.initialized){root.innerHTML=setupView(setup.bootstrapConfigured);return;}
    try {
      const me=await api("/api/auth/me");
      STATE.user=me.user;
      if(STATE.user.role!=="system_admin"){
        root.innerHTML='<section class="panel setup-panel"><h2>Administration access restricted</h2><p class="sub">Only the system administrator can manage states, LGAs, facilities, staff accounts and the inventory catalogue.</p><button class="btn sec" type="button" onclick="setView(\'app\')">Return to facility workspace</button></section>'; return;
      }
      const data=await api("/api/admin/overview");
      STATE.admin=data;
      root.innerHTML=adminWorkspace(data);
    } catch(error) {
      if(error.message==="Authentication required."){STATE.user=null;root.innerHTML=loginView();}
      else throw error;
    }
  } catch(error) {
    root.innerHTML='<section class="panel"><h2>Administration unavailable</h2><p class="sub">'+escapeHtml(error.message)+'</p><button class="btn sec" onclick="setView(\'dash\')">Retry</button></section>';
  }
}
async function checkApiConnection() {
  const node=document.getElementById("apiStatus"); if(!node)return;
  try {
    const result=await api("/api/health",{headers:{}});
    node.textContent=result.status==="ok"&&result.database==="connected"?"API connected · Database connected":"API reachable";
  } catch(error) { node.textContent="Backend unavailable"; }
}
function render() {
  const root=document.getElementById("root"); if(!root)return;
  if(STATE.view==="app"){root.innerHTML=appView();checkApiConnection();}
  else dashboardView();
}
function formData(form){return Object.fromEntries(new FormData(form).entries());}
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
    try{await api("/api/setup/bootstrap",{method:"POST",headers:{"x-bootstrap-secret":d.bootstrapSecret},body:JSON.stringify({fullName:d.fullName,email:d.email,password:d.password,stateName:d.stateName,lgaName:d.lgaName})});notify("Administrator created. Sign in now.");render();}
    catch(error){notify(error.message,true);}return;
  }
  if(form.id==="loginForm"){
    event.preventDefault();const d=formData(form);
    try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:d.loginEmail,password:d.loginPassword})});STATE.user=result.user;notify("Signed in successfully.");render();}
    catch(error){notify(error.message,true);}return;
  }
  const config=routes[form.id];if(!config)return;
  event.preventDefault();
  try{await api(config[0],{method:"POST",body:JSON.stringify(config[1](formData(form)))});notify("Record saved successfully.");await dashboardView();}
  catch(error){notify(error.message,true);}
}
document.addEventListener("submit",handleSubmit);
document.addEventListener("click",async event=>{
  if(event.target.closest("#logoutButton")||event.target.closest("#staffLogout")){
    try{await api("/api/auth/logout",{method:"POST"});STATE.user=null;STATE.facilityId=null;notify("Signed out.");render();}
    catch(error){notify(error.message,true);}
  }
});
render();
