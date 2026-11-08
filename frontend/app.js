/* PHC Link frontend shell. No sample or placeholder operational records are loaded. */
const PAGE = document.body.dataset.page || "home";
const STATE = { view: "app", page: PAGE };

try { sessionStorage.removeItem("phc-link-demo-state"); } catch (error) {}

function setView(view) {
  STATE.view = view;
  document.getElementById("vApp").setAttribute("aria-pressed", String(view === "app"));
  document.getElementById("vDash").setAttribute("aria-pressed", String(view === "dash"));
  render();
}

function appView() {
  const pages = {
    home: { title: "Home", description: "No facility has been assigned to this account." },
    stock: { title: "Stock", description: "No inventory records have been added." },
    ref: { title: "Referrals", description: "No referral records have been created." },
    ussd: { title: "USSD & SMS", description: "No USSD code or SMS gateway has been configured." }
  };
  const page = pages[STATE.page] || pages.home;
  const links = [["home", "Home", "index.html"], ["stock", "Stock", "stock.html"], ["ref", "Referrals", "referrals.html"], ["ussd", "USSD", "ussd.html"]];
  const nav = links.map(function (link) {
    const active = STATE.page === link[0] ? ' aria-current="page"' : "";
    return '<a href="' + link[2] + '"' + active + '>' + link[1] + '</a>';
  }).join("");
  return '<div class="stage"><div class="screen-wrap"><header class="hdr"><div><b>Facility workspace</b><small>Facility not configured</small></div></header><div class="net"><span>Backend not connected</span><span>No operational records</span></div><nav class="tabs" aria-label="App sections">' + nav + '</nav><main class="body"><h2>' + page.title + '</h2><p class="sub">PHC Link facility workspace</p><section class="empty-state"><h3>No data available</h3><p>' + page.description + '</p><p>Records will appear here after the facility is configured and connected to the PHC Link API.</p></section></main></div></div>';
}

function dashView() {
  return '<section class="dashboard"><div class="dash-head"><div><div class="eyebrow">HEALTH SYSTEM MONITORING</div><h2>Operations overview</h2><p class="sub">Operational metrics will appear when real records are connected.</p></div><div class="report-date">Backend not connected</div></div><div class="kpis"><article class="kpi"><div class="kpi-copy"><span>Facilities</span><b>0</b><small>No facility records</small></div></article><article class="kpi"><div class="kpi-copy"><span>Stock-out incidents</span><b>0</b><small>No inventory records</small></div></article><article class="kpi"><div class="kpi-copy"><span>Low-stock warnings</span><b>0</b><small>No inventory records</small></div></article><article class="kpi"><div class="kpi-copy"><span>Referrals</span><b>0</b><small>No referral records</small></div></article></div><section class="panel empty-state"><h3>No facility records</h3><p>The administration dashboard is empty. Register facilities and connect the backend before operational data is displayed.</p></section></section>';
}

function render() {
  document.getElementById("root").innerHTML = STATE.view === "app" ? appView() : dashView();
}

render();