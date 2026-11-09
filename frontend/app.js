/* PHC Link: live API-backed administration and facility shell. */
const PAGE = document.body.dataset.page || "home";
const API_BASE_URL = "https://phc-link-api.onrender.com";
const STATE = { view:"app", page:PAGE, admin:null, user:null, busy:false };

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
function appView() {
  const pages={
    home:{title:"Home",description:"Your facility overview will appear after an administrator creates your account and assigns a facility."},
    stock:{title:"Stock",description:"Stock recording will be available after you sign in and are assigned to a facility."},
    ref:{title:"Referrals",description:"Referral creation and tracking will be available after you sign in and are assigned to a facility."},
    ussd:{title:"USSD & SMS",description:"USSD and SMS integrations have not yet been configured."}
  };
  const page=pages[STATE.page]||pages.home;
  const links=[["home","Home","index.html"],["stock","Stock","stock.html"],["ref","Referrals","referrals.html"],["ussd","USSD","ussd.html"]];
  const nav=links.map(([key,label,url])=>'<a href="'+url+'"'+(STATE.page===key?' aria-current="page"':'')+'>'+label+'</a>').join("");
  return '<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>Facility workspace</b><small>Sign in through Administration to manage your account</small></div></header><div class="net"><span id="apiStatus">Checking API and database…</span></div><nav class="tabs" aria-label="App sections">'+nav+'</nav><main class="body"><h2>'+page.title+'</h2><p class="sub">PHC Link facility workspace</p><section class="empty-state"><h3>Workspace setup required</h3><p>'+page.description+'</p><div class="stack"><button class="btn" type="button" onclick="setView(\'dash\')">Open administration</button></div></section></main></div></div>';
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
  const roleOpts='<option value="health_worker">Health worker</option><option value="clinician">Clinician</option><option value="lga_officer">LGA officer</option><option value="state_admin">State administrator</option>';
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
    try{await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:d.loginEmail,password:d.loginPassword})});notify("Signed in successfully.");render();}
    catch(error){notify(error.message,true);}return;
  }
  const config=routes[form.id];if(!config)return;
  event.preventDefault();
  try{await api(config[0],{method:"POST",body:JSON.stringify(config[1](formData(form)))});notify("Record saved successfully.");await dashboardView();}
  catch(error){notify(error.message,true);}
}
document.addEventListener("submit",handleSubmit);
document.addEventListener("click",async event=>{
  if(event.target.closest("#logoutButton")){
    try{await api("/api/auth/logout",{method:"POST"});STATE.user=null;notify("Signed out.");render();}
    catch(error){notify(error.message,true);}
  }
});
render();
