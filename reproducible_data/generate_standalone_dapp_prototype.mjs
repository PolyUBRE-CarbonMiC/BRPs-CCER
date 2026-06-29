import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const baseDir = path.dirname(__filename);
const rootDir = path.resolve(baseDir, '..', '..');
const summaryPath = path.join(baseDir, 'evidence_dashboard', 'evidence_summary.json');
const energyPayloadPath = path.join(baseDir, 'correctness_payloads', 'energy_valid.json');
const outPath = path.join(rootDir, 'experiments', 'dapp_prototype', 'standalone_prototype.html');

const data = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const energyPayload = fs.existsSync(energyPayloadPath)
  ? JSON.parse(fs.readFileSync(energyPayloadPath, 'utf8'))
  : [];
const { project, network, metrics, emissions, revenue } = data;
const evidence = data.evidence || {};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function n(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function width(value, max) {
  return max ? `${Math.max(6, Number(value) / max * 100).toFixed(1)}%` : '0%';
}

function ev(label) {
  return evidence[label] || {};
}

function tx(label) {
  return ev(label).transaction_id || 'not captured';
}

function evidencePanel(label) {
  const item = ev(label);
  return `
            <div class="ledger-two">
              <div class="field"><span>Block height</span><strong class="mono">${esc(item.after_height || 'not captured')}</strong></div>
              <div class="field"><span>Block number</span><strong class="mono">${esc(item.block_number || 'not captured')}</strong></div>
            </div>
            <div class="field hash"><span>Current block hash</span><strong class="mono">${esc(item.current_block_hash || 'not captured')}</strong></div>
            <div class="field hash"><span>Previous block hash</span><strong class="mono">${esc(item.previous_block_hash || 'not captured')}</strong></div>
            <div class="field hash"><span>Transaction ID</span><strong class="mono">${esc(tx(label))}</strong></div>
            <div class="field timestamp"><span>Timestamp</span><strong class="mono">${esc(item.timestamp || 'not captured')}</strong></div>`;
}

const energyByUnit = new Map(
  energyPayload.map((item) => [`${item.unit_id}:${String(item.energy_type).toLowerCase()}`, item]),
);
const participantRevenueRecords = revenue.filter((item) => String(item.unit_id) !== 'FM');
const gasTotal = emissions
  .filter((item) => item.energy_type === 'gas')
  .reduce((sum, item) => sum + Number(item.emission_reduction || 0), 0);
const electricityTotal = emissions
  .filter((item) => item.energy_type === 'electricity')
  .reduce((sum, item) => sum + Number(item.emission_reduction || 0), 0);
const participantRevenue = revenue
  .filter((item) => String(item.unit_id) !== 'FM')
  .reduce((sum, item) => sum + Number(item.revenue || 0), 0);
const previewPageSize = 8;
const displayedEmissions = emissions.slice(0, previewPageSize).map((item) => {
  const payload = energyByUnit.get(`${item.unit_id}:${String(item.energy_type).toLowerCase()}`) || {};
  return {
    ...item,
    baseline: Number(payload.baseline || 0),
    actual: Number(payload.energy_consumption || 0),
  };
});
const maxBaselineByType = displayedEmissions.reduce((acc, item) => {
  const type = String(item.energy_type).toLowerCase();
  acc[type] = Math.max(acc[type] || 0, Number(item.baseline || 0));
  return acc;
}, {});
const displayedRevenue = participantRevenueRecords.slice(0, previewPageSize);
const maxRevenue = Math.max(...participantRevenueRecords.map((item) => Number(item.revenue || 0)));
const displayProjectName = 'Energy Retrofit Project for 20 Residential Buildings';
const accountingPeriod = '2025-10-15 - 2025-11-15';
const carbonPriceCny = 68;
const gasTotalTco2e = gasTotal / 1_000_000;
const electricityTotalTco2e = electricityTotal / 1_000_000;
const emissionPageCount = Math.ceil(emissions.length / previewPageSize);
const revenuePageCount = Math.ceil(participantRevenueRecords.length / previewPageSize);

function energyUnit(type) {
  return String(type).toLowerCase() === 'gas' ? 'Nm3' : 'kWh';
}

function energyRow(item) {
  const type = String(item.energy_type).toLowerCase();
  const maxBaseline = maxBaselineByType[type] || item.baseline || 1;
  return `<div class="energy-row">
                <span class="mono">Unit ${esc(item.unit_id)}</span>
                <span class="energy-type">${esc(type.toUpperCase())}</span>
                <div class="energy-values">
                  <b>${n(item.baseline, 0)} -> ${n(item.actual, 0)}</b>
                  <small>${energyUnit(type)}</small>
                </div>
                <div class="energy-bars">
                  <div class="bar-line"><div class="bar base"><i style="width:${width(item.baseline, maxBaseline)}"></i></div></div>
                  <div class="bar-line"><div class="bar project"><i style="width:${width(item.actual, maxBaseline)}"></i></div></div>
                </div>
                <strong>${(Number(item.emission_reduction || 0) / 1_000_000).toFixed(4)} tCO2e</strong>
              </div>`;
}

function revenueRow(item) {
  const revenueValue = Number(item.revenue || 0);
  const share = participantRevenue ? revenueValue / participantRevenue * 100 : 0;
  return `<div class="allocation-row">
                <span class="mono">Unit ${esc(item.unit_id)}</span>
                <strong>${n(revenueValue, 2)} CNY</strong>
                <span>${share.toFixed(2)}%</span>
                <span class="status-dot">Allocated</span>
              </div>`;
}

const css = `
:root{--ink:#102033;--muted:#627386;--line:#d6e0e8;--page:#edf3f6;--panel:#fff;--nav:#102033;--nav2:#23405f;--green:#12805c;--blue:#256aa8;--amber:#b67919;--soft:#f7fafc}
*{box-sizing:border-box}
body{margin:0;background:var(--page);font-family:Inter,Segoe UI,Arial,sans-serif;color:var(--ink);letter-spacing:0;overflow:hidden}
.app{width:1900px;height:980px;margin:0 auto;padding:22px;display:grid;grid-template-columns:245px 1fr;gap:22px}
.sidebar{background:var(--nav);color:#e8eef5;border-radius:10px;padding:22px;display:flex;flex-direction:column}
.brand{display:flex;gap:13px;align-items:center;margin-bottom:30px}
.mark{width:48px;height:48px;border-radius:8px;background:#1c8a64;display:grid;place-items:center;font-weight:900;font-size:24px}
.brand h1{font-size:23px;line-height:1.1;margin:0}.brand p{font-size:15px;color:#a8b6c5;margin:5px 0 0}
.nav{display:grid;gap:13px}.nav button{width:100%;border:0;text-align:left;border-radius:8px;padding:17px 15px;color:#cfdae4;background:transparent;font-size:18px;font-weight:900;cursor:pointer}.nav button.active{background:var(--nav2);color:#fff}
.node{margin-top:auto;border-top:1px solid #2d425b;padding-top:16px}.node p{margin:0 0 8px;color:#a8b6c5;font-size:15px}.node strong{display:block;font-size:16px;line-height:1.55}
.main{min-width:0;display:grid;grid-template-rows:auto auto 1fr;gap:16px}
.top{display:flex;align-items:center;justify-content:space-between;gap:18px}
.title h2{margin:0;font-size:42px;line-height:1.05}.title p{margin:7px 0 0;color:var(--muted);font-size:20px}
.actions{display:flex;gap:10px}.btn{border:1px solid var(--line);background:#fff;border-radius:7px;padding:13px 19px;font-weight:900;font-size:17px}.btn.primary{background:var(--green);color:#fff;border-color:var(--green)}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}.metric{background:#fff;border:1px solid var(--line);border-radius:9px;padding:16px 18px}.metric label{display:block;color:var(--muted);font-size:14px;font-weight:900;text-transform:uppercase}.metric strong{display:block;font-size:31px;margin:8px 0 0;line-height:1.08;white-space:nowrap}.metric.period strong{font-size:24px}.metric span{display:block;margin-top:6px;font-size:16px;color:var(--muted)}
.page{display:none;min-height:0}.page.active{display:block}
.page-title{display:flex;align-items:flex-end;justify-content:space-between;margin:2px 0 12px}.screen-label{color:var(--muted);font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}.page-title h2{font-size:36px;margin:0}.page-title p{font-size:19px;color:var(--muted);margin:5px 0 0}
.pill{display:inline-flex;align-items:center;border-radius:999px;padding:6px 12px;background:#e8f7ef;color:#0d684b;border:1px solid #bfe7d3;font-size:15px;font-weight:900}
.workspace{display:grid;grid-template-columns:.99fr 1.01fr;gap:16px;align-items:start}
.stack{display:grid;gap:16px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:9px;overflow:hidden}
.head{min-height:52px;padding:0 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;background:#fbfcfd}.head h3{font-size:24px;margin:0}.head-tools{display:flex;align-items:center;gap:16px}
.body{padding:14px 16px}.field-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.field{border:1px solid #e1e8ef;border-radius:8px;background:#fff;padding:14px 15px;min-width:0}.field span{display:block;color:var(--muted);font-size:15px;font-weight:900;text-transform:uppercase}.field strong{display:block;margin-top:7px;font-size:21px;line-height:1.25}.field.big strong{font-size:26px}
.mono{font-family:Consolas,Menlo,monospace;overflow-wrap:anywhere}.hash strong{font-size:20px;line-height:1.45}.timestamp{grid-column:1/-1}.timestamp strong{white-space:normal;font-size:22px}.ledger-two{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.ledger-panel .body{display:grid;gap:12px}.ledger-panel .field{padding:15px 17px}.ledger-panel .field span{font-size:16px}.ledger-panel .field strong{font-size:22px}.ledger-panel .hash strong{font-size:20px}
.state-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.state{border:1px solid #e1e8ef;border-radius:8px;padding:13px 14px}.state b{font-size:19px}.state p{font-size:16px;color:var(--muted);line-height:1.35;margin:6px 0 0}
.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.summary{border:1px solid #e1e8ef;border-radius:8px;padding:14px 15px}.summary span{display:block;color:var(--muted);font-size:15px;font-weight:900;text-transform:uppercase}.summary strong{display:block;margin-top:7px;font-size:30px;white-space:nowrap}.summary small{display:block;margin-top:5px;color:var(--muted);font-size:15px;line-height:1.3}
.pager{display:flex;align-items:center;gap:8px;font-size:15px;color:var(--muted)}.pager button{height:28px;min-width:30px;border:1px solid var(--line);background:#fff;border-radius:7px;font-weight:900;color:var(--ink)}.pager button.active{background:var(--nav2);border-color:var(--nav2);color:#fff}
.rows{display:grid;gap:6px}.compact-ledger{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.compact-ledger .ledger-two,.compact-ledger .hash{grid-column:1/-1}
.energy-legend{display:flex;gap:12px;align-items:center;color:var(--muted);font-size:15px;font-weight:900}.key{display:inline-flex;align-items:center;gap:6px}.key i{width:28px;height:9px;border-radius:99px;display:inline-block}.key .base-key{background:#91CEEC}.key .project-key{background:#12805c}
.energy-row{display:grid;grid-template-columns:74px 104px 104px 1fr 126px;gap:12px;align-items:center;font-size:16px;padding:4px 0}.energy-type{font-weight:800;color:#1f3650}.energy-values b{display:block;font-size:16px;white-space:nowrap}.energy-values small{display:block;font-size:12px;color:var(--muted);white-space:nowrap}.energy-bars{display:grid;gap:6px}.bar-line{display:block}.bar{height:10px;background:#e8eef3;border-radius:999px;overflow:hidden}.bar i{display:block;height:100%;border-radius:999px}.bar.base i{background:#91CEEC}.bar.project i{background:linear-gradient(90deg,var(--green),var(--blue))}.energy-row strong{font-size:16px;white-space:nowrap}
.allocation-flow{display:grid;grid-template-columns:1fr 30px 1fr 30px 1fr;gap:9px;align-items:stretch}.flow-card{border:1px solid #dce6ee;background:var(--soft);border-radius:8px;padding:11px 13px}.flow-card span{display:block;color:var(--muted);font-size:13px;font-weight:900;text-transform:uppercase}.flow-card strong{display:block;margin-top:6px;font-size:25px}.flow-card small{display:block;margin-top:5px;color:var(--muted);font-size:14px;line-height:1.25}.flow-arrow{display:grid;place-items:center;color:var(--muted);font-weight:900;font-size:22px}.allocation-head,.allocation-row{display:grid;grid-template-columns:96px 145px 100px 1fr;gap:12px;align-items:center}.allocation-head{color:var(--muted);font-size:14px;font-weight:900;text-transform:uppercase;padding:0 0 7px;border-bottom:1px solid #e1e8ef}.allocation-row{font-size:16px;padding:6px 0;border-bottom:1px solid #eef3f6}.allocation-row:last-child{border-bottom:0}.allocation-row strong{font-size:17px}.status-dot{justify-self:start;border:1px solid #bfe7d3;background:#e8f7ef;color:#0d684b;border-radius:999px;padding:3px 10px;font-size:13px;font-weight:900}
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BRP-CCER DApp Prototype Interface</title>
<style>${css}</style>
</head>
<body>
<main class="app">
  <aside class="sidebar">
    <div class="brand"><div class="mark">C</div><div><h1>BRP-CCER DApp</h1><p>Prototype interface</p></div></div>
    <nav class="nav" aria-label="DApp modules">
      <button class="active" data-page="registry">Project Information</button>
      <button data-page="cer">CER Accounting</button>
      <button data-page="revenue">Revenue Allocation</button>
    </nav>
    <div class="node">
      <p>Fabric evidence source</p>
      <strong>Channel: ${esc(network.channel)}</strong>
      <strong>Chaincode: ${esc(network.chaincode)}</strong>
      <strong>Orderer: PBFT network</strong>
    </div>
  </aside>
  <section class="main">
    <header class="top">
      <div class="title"><h2>${esc(displayProjectName)}</h2><p>BRP-CCER carbon-credit prototype populated from recorded Fabric smart-contract outputs</p></div>
      <div class="actions"><button class="btn">Export</button><button class="btn primary">Submit to Ledger</button></div>
    </header>
    <section class="metrics">
      <div class="metric"><label>Project ID</label><strong class="mono">${esc(project.project_id)}</strong><span>${esc(project.status)}</span></div>
      <div class="metric"><label>Carbon emission reduction</label><strong>${n(metrics.total_reduction_tco2e, 2)} tCO2e</strong></div>
      <div class="metric"><label>Revenue</label><strong>${n(metrics.total_revenue_cny, 2)} CNY</strong><span>carbon price ${carbonPriceCny} CNY/credit</span></div>
      <div class="metric period"><label>Accounting period</label><strong>${esc(accountingPeriod)}</strong></div>
    </section>

    <section class="page active" id="page-registry">
      <div class="page-title"><div><div class="screen-label">Module 1</div><h2>Registry Information</h2><p>Project metadata recorded by the deployed chaincode and retrieved from ledger state.</p></div><span class="pill">Registered</span></div>
      <div class="workspace">
        <div class="stack">
          <article class="panel">
            <div class="head"><h3>Registered Project Record</h3><span class="pill">QueryProject</span></div>
            <div class="body field-grid">
              <div class="field big"><span>Project name</span><strong>${esc(displayProjectName)}</strong></div>
              <div class="field big"><span>Project ID</span><strong class="mono">${esc(project.project_id)}</strong></div>
              <div class="field"><span>Facility manager</span><strong>${esc(project.facility_manager)}</strong></div>
              <div class="field"><span>Verifier</span><strong>${esc(project.verifier)}</strong></div>
              <div class="field"><span>Registration date</span><strong>${esc(project.registration_time)}</strong></div>
              <div class="field"><span>Credit status</span><strong>${esc(project.status)}</strong></div>
            </div>
          </article>
          <article class="panel">
            <div class="head"><h3>Participation State</h3><span>BRP-CCER workflow</span></div>
            <div class="body state-row">
              <div class="state"><b>Registered</b><p>Project identity and verifier metadata are stored on-chain.</p></div>
              <div class="state"><b>Accounting ready</b><p>Energy records can be submitted for CER calculation.</p></div>
              <div class="state"><b>Revenue ready</b><p>Allocation can be executed after carbon emission reduction is available.</p></div>
            </div>
          </article>
        </div>
        <article class="panel ledger-panel">
          <div class="head"><h3>Project Registry Ledger Confirmation</h3><span class="pill">Committed</span></div>
          <div class="body">${evidencePanel('register')}</div>
        </article>
      </div>
    </section>

    <section class="page" id="page-cer">
      <div class="page-title"><div><div class="screen-label">Module 2</div><h2>CER Accounting</h2><p>Baseline and post-retrofit energy records are compared to calculate unit-level CER.</p></div><span class="pill">EmissionReduction</span></div>
      <div class="workspace">
        <div class="stack">
          <article class="panel">
            <div class="head"><h3>Accounting Summary</h3><span class="pill">Calculated</span></div>
            <div class="body">
              <div class="summary-grid">
                <div class="summary"><span>Gas reduction</span><strong>${n(gasTotalTco2e, 2)} tCO2e</strong><small>2.10 kgCO2e/Nm3 saved</small></div>
                <div class="summary"><span>Electricity reduction</span><strong>${n(electricityTotalTco2e, 2)} tCO2e</strong><small>0.146 kgCO2e/kWh saved</small></div>
                <div class="summary"><span>Total reduction</span><strong>${n(metrics.total_reduction_tco2e, 2)} tCO2e</strong></div>
              </div>
            </div>
          </article>
          <article class="panel">
            <div class="head"><h3>Unit-level CER Results</h3><div class="head-tools"><div class="energy-legend"><span class="key"><i class="base-key"></i>Baseline</span><span class="key"><i class="project-key"></i>Post-retrofit</span></div><div class="pager"><span>Page 1 / ${emissionPageCount}</span></div></div></div>
            <div class="body rows">
              ${displayedEmissions.map(energyRow).join('')}
            </div>
          </article>
        </div>
        <article class="panel ledger-panel">
          <div class="head"><h3>CER Ledger Confirmation</h3><span class="pill">Committed</span></div>
          <div class="body compact-ledger">${evidencePanel('emission')}</div>
        </article>
      </div>
    </section>

    <section class="page" id="page-revenue">
      <div class="page-title"><div><div class="screen-label">Module 3</div><h2>Revenue Allocation</h2><p>Carbon-credit revenue distributed according to the predefined allocation rule.</p></div><span class="pill">RevenueAllocation</span></div>
      <div class="workspace">
        <div class="stack">
          <article class="panel">
            <div class="head"><h3>Allocation Flow</h3><span class="pill">Distributed</span></div>
            <div class="body">
              <div class="allocation-flow">
                <div class="flow-card"><span>Total revenue</span><strong>${n(metrics.total_revenue_cny, 2)} CNY</strong><small>${n(metrics.total_reduction_tco2e, 2)} credits at ${carbonPriceCny} CNY/credit</small></div>
                <div class="flow-arrow">=</div>
                <div class="flow-card"><span>FM fee</span><strong>${n(metrics.fm_revenue_cny, 2)} CNY</strong><small>10% service fee</small></div>
                <div class="flow-arrow">+</div>
                <div class="flow-card"><span>Participant pool</span><strong>${n(participantRevenue, 2)} CNY</strong><small>Proportional to unit-level CER</small></div>
              </div>
            </div>
          </article>
          <article class="panel">
            <div class="head"><h3>Participant Allocation Preview</h3><div class="pager"><span>Page 1 / ${revenuePageCount}</span><button class="active">1</button><button>2</button><button>3</button><button>...</button><button>${revenuePageCount}</button></div></div>
            <div class="body rows">
              <div class="allocation-head"><span>Unit</span><span>Revenue</span><span>Share</span><span>Status</span></div>
              ${displayedRevenue.map(revenueRow).join('')}
            </div>
          </article>
        </div>
        <article class="panel ledger-panel">
          <div class="head"><h3>Revenue Ledger Confirmation</h3><span class="pill">Committed</span></div>
          <div class="body compact-ledger">${evidencePanel('revenue')}</div>
        </article>
      </div>
    </section>
  </section>
</main>
<script>
const buttons = Array.from(document.querySelectorAll('.nav button'));
const pages = new Map([
  ['registry', document.getElementById('page-registry')],
  ['cer', document.getElementById('page-cer')],
  ['revenue', document.getElementById('page-revenue')],
]);
buttons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.page;
    buttons.forEach((item) => item.classList.toggle('active', item === button));
    pages.forEach((page, key) => page.classList.toggle('active', key === target));
  });
});
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Wrote ${outPath}`);
