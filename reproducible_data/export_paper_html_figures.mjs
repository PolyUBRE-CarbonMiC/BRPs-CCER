import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const OUT_DIR = resolve(ROOT, 'experiments', 'reproducible_data', 'paper_figures');
const REPORT_HTML = resolve(ROOT, 'experiments', 'reproducible_data', 'evidence_dashboard', 'fabric_execution_report.html');
const DAPP_HTML = resolve(ROOT, 'experiments', 'dapp_prototype', 'standalone_prototype.html');

mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

async function waitForChrome() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
    } catch {
      await sleep(150);
    }
  }
  throw new Error('Chrome DevTools endpoint did not start.');
}

function send(ws, method, params = {}) {
  const id = send.nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveSend, rejectSend) => {
    send.pending.set(id, { resolve: resolveSend, reject: rejectSend });
  });
}
send.nextId = 1;
send.pending = new Map();

async function openPage(url) {
  const target = await fetchJson(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && send.pending.has(message.id)) {
      const item = send.pending.get(message.id);
      send.pending.delete(message.id);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    }
  };
  await new Promise((resolveOpen, rejectOpen) => {
    ws.onopen = resolveOpen;
    ws.onerror = rejectOpen;
  });
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.navigate', { url });
  await sleep(700);
  return ws;
}

async function setViewport(ws, width, height) {
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await sleep(250);
}

async function activateDappPage(ws, pageName) {
  if (!pageName) return;
  const expression = `
    (() => {
      const target = ${JSON.stringify(pageName)};
      const buttons = Array.from(document.querySelectorAll('.nav button'));
      const pages = {
        registry: document.getElementById('page-registry'),
        cer: document.getElementById('page-cer'),
        revenue: document.getElementById('page-revenue')
      };
      buttons.forEach((button) => button.classList.toggle('active', button.dataset.page === target));
      Object.entries(pages).forEach(([key, page]) => page && page.classList.toggle('active', key === target));
      document.body.dataset.capturePage = target;
    })()
  `;
  await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true });
  await sleep(300);
}

async function preparePage(ws, expression) {
  if (!expression) return;
  await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true });
  await sleep(300);
}

async function getContentSize(ws) {
  const metrics = await send(ws, 'Page.getLayoutMetrics');
  const width = Math.ceil(metrics.contentSize.width);
  const height = Math.ceil(metrics.contentSize.height);
  return { width, height };
}

async function capturePng(ws, outputPath) {
  const { width, height } = await getContentSize(ws);
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await sleep(250);
  const result = await send(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
  });
  const buffer = Buffer.from(result.data, 'base64');
  writeFileSync(outputPath, buffer);
  return { width, height, buffer };
}

async function capturePdf(ws, outputPath, width, height) {
  const result = await send(ws, 'Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: false,
    paperWidth: width / 96,
    paperHeight: height / 96,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    scale: 1,
  });
  writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

function writeSvg(svgPath, width, height, pngBuffer) {
  const b64 = pngBuffer.toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image width="${width}" height="${height}" href="data:image/png;base64,${b64}"/>
</svg>
`;
  writeFileSync(svgPath, svg, 'utf8');
}

async function exportFigure(item) {
  const ws = await openPage(pathToFileURL(item.html).href);
  await setViewport(ws, item.viewport.width, item.viewport.height);
  await activateDappPage(ws, item.page);
  await preparePage(ws, item.prepare);
  const pngPath = resolve(OUT_DIR, `${item.name}.png`);
  const pdfPath = resolve(OUT_DIR, `${item.name}.pdf`);
  const svgPath = resolve(OUT_DIR, `${item.name}.svg`);
  const { width, height, buffer } = await capturePng(ws, pngPath);
  await capturePdf(ws, pdfPath, width, height);
  writeSvg(svgPath, width, height, buffer);
  ws.close();
  console.log(`${item.name}: ${width} x ${height}`);
}

const captures = [
  {
    name: 'fabric_execution_report_full',
    html: REPORT_HTML,
    viewport: { width: 1860, height: 2600 },
  },
  {
    name: 'fabric_execution_report_project_registry',
    html: REPORT_HTML,
    viewport: { width: 1860, height: 1400 },
    prepare: `
      (() => {
        const groups = Array.from(document.querySelectorAll('.group'));
        groups.forEach((group, index) => {
          group.style.display = index <= 1 ? '' : 'none';
        });
      })()
    `,
  },
  {
    name: 'fabric_execution_report_cer_accounting',
    html: REPORT_HTML,
    viewport: { width: 1860, height: 1100 },
    prepare: `
      (() => {
        document.querySelector('header').style.display = 'none';
        const groups = Array.from(document.querySelectorAll('.group'));
        groups.forEach((group, index) => {
          group.style.display = index === 2 ? '' : 'none';
        });
      })()
    `,
  },
  {
    name: 'fabric_execution_report_revenue_allocation',
    html: REPORT_HTML,
    viewport: { width: 1860, height: 1100 },
    prepare: `
      (() => {
        document.querySelector('header').style.display = 'none';
        const groups = Array.from(document.querySelectorAll('.group'));
        groups.forEach((group, index) => {
          group.style.display = index === 3 ? '' : 'none';
        });
      })()
    `,
  },
  {
    name: 'dapp_project_information',
    html: DAPP_HTML,
    page: 'registry',
    viewport: { width: 1900, height: 980 },
  },
  {
    name: 'dapp_cer_accounting',
    html: DAPP_HTML,
    page: 'cer',
    viewport: { width: 1900, height: 980 },
  },
  {
    name: 'dapp_revenue_allocation',
    html: DAPP_HTML,
    page: 'revenue',
    viewport: { width: 1900, height: 980 },
  },
];

const userDataDir = mkdtempSync(resolve(tmpdir(), 'paper-html-capture-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitForChrome();
  for (const item of captures) {
    await exportFigure(item);
  }
  console.log(`Saved figures to ${OUT_DIR}`);
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(userDataDir, { recursive: true, force: true });
}
