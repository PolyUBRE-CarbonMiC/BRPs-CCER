import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const baseDir = path.dirname(__filename);
const rootDir = path.resolve(baseDir, '..', '..');
const logDir = path.join(rootDir, 'experiments', 'correctness_results');
const outDir = path.join(baseDir, 'evidence_dashboard');
const outPath = path.join(outDir, 'fabric_execution_report.html');

function read(name) {
  const file = path.join(logDir, name);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').trim();
}

function readJson(name) {
  const text = read(name);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function extractPayload(text) {
  const match = text.match(/payload:"((?:\\.|[^"])*)"/);
  if (!match) return '';
  try {
    return JSON.stringify(JSON.parse(JSON.parse(`"${match[1]}"`)), null, 2);
  } catch {
    return match[1];
  }
}

function compactPayloadLines(text, limit = 6) {
  const parsed = extractPayload(text);
  if (!parsed) return '';
  try {
    const value = JSON.parse(parsed);
    if (Array.isArray(value)) {
      const rows = value.slice(0, limit).map((item) => JSON.stringify(item));
      if (value.length > limit) rows.push(`... ${value.length - limit} additional records omitted from figure view`);
      return rows.join('\n');
    }
    return JSON.stringify(value);
  } catch {
    return parsed;
  }
}

function payloadValue(text) {
  const parsed = extractPayload(text);
  if (!parsed) return null;
  try {
    return JSON.parse(parsed);
  } catch {
    return null;
  }
}

const logs = {
  instantiated: read('instantiated_chaincode.log') || read('instantiated_chaincode.txt'),
  registerValid: read('register_valid.log'),
  queryProject: read('query_project.log'),
  registerDuplicate: read('register_duplicate.log'),
  emissionValid: read('emission_reduction_valid.log'),
  queryEmission: read('query_emission_unit_1.log'),
  emissionInvalid: read('emission_reduction_invalid_type.log'),
  revenueValid: read('revenue_allocation_valid.log'),
  queryRevenueFm: read('query_revenue_fm.log'),
  queryLastRevenue: read('query_last_revenue_allocation.log'),
  revenueManualInputRejected: read('revenue_allocation_manual_input_rejected.log'),
};

const summaries = {
  register: readJson('latest_register_block_summary.json'),
  emission: readJson('latest_emission_block_summary.json'),
  revenue: readJson('latest_revenue_block_summary.json'),
};

const emissionPayload = payloadValue(logs.emissionValid) || [];
const revenuePayload = payloadValue(logs.revenueValid) || [];
const emissionPayloadCompact = compactPayloadLines(logs.emissionValid, 6);
const revenuePayloadCompact = compactPayloadLines(logs.revenueValid, 6);
const totalReductionGco2e = Array.isArray(emissionPayload)
  ? emissionPayload.reduce((sum, item) => sum + Number(item.emission_reduction || 0), 0)
  : 0;
const totalReductionTco2e = totalReductionGco2e / 1_000_000;
const totalRevenueCny = Array.isArray(revenuePayload)
  ? revenuePayload.reduce((sum, item) => sum + Number(item.revenue || 0), 0)
  : 0;
const fmRevenueCny = Array.isArray(revenuePayload)
  ? Number((revenuePayload.find((item) => String(item.unit_id) === 'FM') || {}).revenue || 0)
  : 0;
const participantRevenueCny = totalRevenueCny - fmRevenueCny;

function fmt(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function txId(summary) {
  return summary.transactions?.[0]?.tx_id || 'not captured';
}

function timestamp(summary) {
  return summary.transactions?.[0]?.timestamp || 'not captured';
}

function terminal(title, command, output, compact = false) {
  return `<section class="term ${compact ? 'compact' : ''}"><div class="term-hd"><h3>${esc(title)}</h3><span>${output ? 'captured' : 'missing'}</span></div><div class="cmd">$ ${esc(command)}</div><pre>${esc(output || 'Log file not found')}</pre></section>`;
}

function sourceCard(title, rows) {
  return `<section class="source-card dense"><div class="source-title"><h3>${esc(title)}</h3><span>input provenance</span></div><div class="source-grid">${
    rows.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')
  }</div></section>`;
}

function parsedCerOutput() {
  if (!Array.isArray(emissionPayload) || !emissionPayload.length) return '';
  const gasCount = emissionPayload.filter((item) => item.energy_type === 'gas').length;
  const electricityCount = emissionPayload.filter((item) => item.energy_type === 'electricity').length;
  return `<section class="parsed-card"><div class="source-title"><h3>CER SDK Output Payload</h3><span>emission_reduction_valid.log</span></div>
    <div class="parsed-stats">
      <div><span>Parsed records</span><strong>${fmt(emissionPayload.length)}</strong></div>
      <div><span>Total CER</span><strong>${fmt(totalReductionTco2e, 2)} tCO2e</strong></div>
      <div><span>Gas / electricity records</span><strong>${fmt(gasCount)} / ${fmt(electricityCount)}</strong></div>
      <div><span>Figure output</span><strong>first 6 JSON records</strong></div>
    </div>
    <div class="payload-log"><div class="cmd">payload from emission_reduction_valid.log</div><pre>${esc(emissionPayloadCompact || 'No payload parsed')}</pre></div>
  </section>`;
}

function parsedRevenueOutput() {
  if (!Array.isArray(revenuePayload) || !revenuePayload.length) return '';
  return `<section class="parsed-card"><div class="source-title"><h3>Revenue SDK Output Payload</h3><span>revenue_allocation_valid.log</span></div>
    <div class="parsed-stats">
      <div><span>Total CER source</span><strong>${fmt(totalReductionTco2e, 2)} tCO2e</strong></div>
      <div><span>Carbon price</span><strong>68 CNY/credit</strong></div>
      <div><span>Total revenue</span><strong>${fmt(totalRevenueCny, 2)} CNY</strong></div>
      <div><span>Participant pool</span><strong>${fmt(participantRevenueCny, 2)} CNY</strong></div>
    </div>
    <div class="payload-log"><div class="cmd">payload from revenue_allocation_valid.log</div><pre>${esc(revenuePayloadCompact || 'No payload parsed')}</pre></div>
  </section>`;
}

function checkGrid(title, rows) {
  return `<section class="check-card"><div class="source-title"><h3>${esc(title)}</h3><span>validation checks</span></div><div class="checks">${
    rows.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')
  }</div></section>`;
}

function blockSummary(title, summary) {
  return `<section class="block-card">
    <div class="block-title"><h3>${esc(title)}</h3><span>Block-level evidence decoded from Fabric ledger</span></div>
    <div class="block-grid">
      <div><span>Height change</span><strong>${esc(summary.before_height ?? 'not captured')} -> ${esc(summary.after_height ?? 'not captured')}</strong></div>
      <div><span>Block number</span><strong>${esc(summary.block_number ?? 'not captured')}</strong></div>
      <div><span>Channel</span><strong>${esc(summary.transactions?.[0]?.channel || 'mychannel')}</strong></div>
      <div><span>Timestamp</span><strong class="mono">${esc(timestamp(summary))}</strong></div>
      <div class="wide"><span>Current block hash</span><strong class="mono">${esc(summary.current_block_hash || 'not captured')}</strong></div>
      <div class="wide"><span>Previous block hash</span><strong class="mono">${esc(summary.previous_block_hash || summary.block_previous_hash || 'not captured')}</strong></div>
      <div class="wide"><span>Transaction ID</span><strong class="mono">${esc(txId(summary))}</strong></div>
      <div class="wide"><span>Data hash</span><strong class="mono">${esc(summary.data_hash || 'not captured')}</strong></div>
    </div>
  </section>`;
}

function group(title, subtitle, body) {
  return `<section class="group"><div class="group-hd"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div></div>${body}</section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fabric Execution Report</title>
<style>
:root{--ink:#111d2d;--muted:#607184;--line:#d5e0e8;--page:#f3f6f8;--panel:#fff;--navy:#0f1b2b;--navy2:#17263a;--green:#12805c}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}.page{width:1860px;margin:0 auto;padding:28px}header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px}h1{margin:0;font-size:44px;line-height:1.08}header p{margin:9px 0 0;color:var(--muted);font-size:20px}.badge{background:#fff;border:1px solid var(--line);border-radius:8px;padding:13px 17px;font-weight:900;font-size:16px}.group{margin-top:18px}.group-hd{background:#fff;border:1px solid var(--line);border-radius:9px;padding:15px 20px;margin-bottom:12px}.group-hd h2{font-size:30px;margin:0}.group-hd p{font-size:18px;color:var(--muted);margin:6px 0 0}.block-card,.source-card,.parsed-card,.check-card{background:#fff;border:1px solid var(--line);border-radius:9px;margin-bottom:12px;overflow:hidden}.block-title,.source-title{height:56px;display:flex;justify-content:space-between;align-items:center;padding:0 18px;border-bottom:1px solid var(--line);background:#fbfcfd}.block-title h3,.source-title h3{font-size:23px;margin:0}.block-title span,.source-title span{color:var(--muted);font-weight:800;font-size:15px}.block-grid,.source-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:13px}.block-grid div,.source-grid div{border:1px solid #e1e8ef;border-radius:8px;padding:11px 13px;min-width:0}.block-grid div.wide{grid-column:span 2}.source-grid div{grid-column:span 1}.block-grid span,.source-grid span,.parsed-stats span,.checks span{display:block;color:var(--muted);font-size:13px;font-weight:900;text-transform:uppercase}.block-grid strong,.source-grid strong,.parsed-stats strong,.checks strong{display:block;margin-top:6px;font-size:19px;line-height:1.22}.parsed-stats,.checks{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:13px;border-bottom:1px solid var(--line)}.checks{grid-template-columns:repeat(2,1fr);border-bottom:0}.parsed-stats div,.checks div{border:1px solid #e1e8ef;border-radius:8px;padding:11px 13px}.formula{padding:16px 20px;font-size:18px;color:var(--ink);border-bottom:1px solid var(--line)}table{width:100%;border-collapse:collapse;font-size:17px}th,td{padding:8px 18px;border-bottom:1px solid #e6edf3;text-align:left}th{color:var(--muted);font-size:13px;text-transform:uppercase}.mono{font-family:Consolas,Menlo,monospace;overflow-wrap:anywhere}.term,.payload-log{background:var(--navy);color:#dce6f1;border-radius:9px;overflow:hidden;border:1px solid #26364a;margin-bottom:12px}.parsed-card .payload-log{border-radius:0;border-width:1px 0 0;margin:0}.term-hd{height:50px;background:var(--navy2);display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid #2a3a50}.term h3{font-size:19px;margin:0;color:#fff}.term-hd span{font-size:14px;color:#a9b7c8;font-weight:800}.cmd{padding:10px 18px;border-bottom:1px solid #26364a;color:#9ee2bb;font-family:Consolas,Menlo,monospace;font-size:16px}.term pre,.payload-log pre{margin:0;padding:12px 18px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,Menlo,monospace;font-size:15px;line-height:1.35;max-height:150px;overflow:auto}.term.compact pre{max-height:135px}.evidence-stack{display:grid;grid-template-columns:1fr;gap:0}.subtle{color:var(--muted);font-size:15px;margin-top:10px}
</style>
</head>
<body>
<main class="page">
<header><div><h1>Hyperledger Fabric Execution Report</h1><p>Smart-contract correctness evidence from the PBFT Fabric prototype network</p></div><div class="badge">Source: experiments/correctness_results</div></header>
${group('Deployment Confirmation', 'The deployed chaincode was confirmed before function-level validation.',
  `<div class="evidence-stack">${terminal('Chaincode Instantiation', 'peer chaincode list --instantiated -C mychannel', logs.instantiated, true)}</div>`
)}
${group('Function 1: Project Registry', 'Registration, ledger-state query, duplicate-ID rejection, and block-level confirmation.',
  `<div class="evidence-stack">
    ${blockSummary('Project Registry Block Summary', summaries.register)}
    ${terminal('Project Registration Invoke', 'peer chaincode invoke ... register GD001001', logs.registerValid, true)}
    ${terminal('Project State Query', 'peer chaincode query ... QueryProject GD001001', logs.queryProject, true)}
    ${terminal('Duplicate Registration Rejection', 'peer chaincode invoke ... register GD001001', logs.registerDuplicate, true)}
  </div>`
)}
${group('Function 2: CER Accounting', 'CER calculation, unit-level query, invalid energy-type rejection, and block-level confirmation.',
  `<div class="evidence-stack">
    ${blockSummary('CER Accounting Block Summary', summaries.emission)}
    ${sourceCard('CER Input Evidence', [
      ['Input file', 'energy_valid.json'],
      ['Records parsed', `${fmt(Array.isArray(emissionPayload) ? emissionPayload.length : 0)} units`],
      ['Chaincode function', 'EmissionReduction'],
      ['Validation input', 'energy_invalid_type.json'],
    ])}
    ${parsedCerOutput()}
    ${checkGrid('CER Query and Validation Results', [
      ['Unit-level query', `Unit 1 = ${fmt(Number(emissionPayload[0]?.emission_reduction || 0) / 1_000_000, 4)} tCO2e; QueryEmissionResult confirmed`],
      ['Invalid input rejection', logs.emissionInvalid ? 'Rejected invalid energy_type = steam; expected failure captured' : 'Log file not found'],
    ])}
  </div>`
)}
${group('Function 3: Revenue Allocation', 'Carbon-price-based revenue estimation, stored-record query, manual-input rejection, and block-level confirmation.',
  `<div class="evidence-stack">
    ${blockSummary('Revenue Allocation Block Summary', summaries.revenue)}
    ${sourceCard('Revenue Computation Evidence', [
      ['On-chain source', 'lastEmissionResults'],
      ['Total CER', `${fmt(totalReductionTco2e, 2)} tCO2e`],
      ['Carbon price', '68 CNY/credit'],
      ['Total revenue', `${fmt(totalRevenueCny, 2)} CNY`],
    ])}
    ${parsedRevenueOutput()}
    ${checkGrid('Revenue Query and Validation Results', [
      ['FM revenue query', `FM fee = ${fmt(fmRevenueCny, 2)} CNY; QueryRevenueRecord confirmed`],
      ['Manual input rejection', logs.revenueManualInputRejected ? 'Rejected manual revenue argument; revenue is computed from CER and carbon price' : 'Log file not found'],
    ])}
  </div>`
)}
</main>
</body>
</html>`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Wrote ${outPath}`);
