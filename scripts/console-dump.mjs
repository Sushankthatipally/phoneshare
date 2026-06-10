// Dump browser console + page errors for a URL via headless Edge over CDP.
// Usage: node scripts/console-dump.mjs <url> [settleMs]
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const [url, settleArg] = process.argv.slice(2);
const settleMs = Number(settleArg) || 7000;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9788;

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--window-size=400,800',
  '--user-data-dir=' + resolve(process.env.TEMP ?? '.', 'dropbeam-console-profile'),
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const t = (await res.json()).find((x) => x.type === 'page');
      if (t) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error('no devtools');
}

let id = 1;
function send(ws, method, params = {}) {
  const myId = id++;
  ws.send(JSON.stringify({ id: myId, method, params }));
  return new Promise((res) => {
    const h = (raw) => { const m = JSON.parse(raw.toString()); if (m.id === myId) { ws.off('message', h); res(m.result); } };
    ws.on('message', h);
  });
}

try {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
      console.log(`[console.${m.params.type}] ${text}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      console.log(`[exception] ${e.exception?.description ?? e.text}`);
    }
  });
  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.enable');
  await send(ws, 'Page.navigate', { url });
  await sleep(settleMs);
  const body = await send(ws, 'Runtime.evaluate', { expression: 'document.getElementById("root")?.innerText?.slice(0,200) ?? document.body.innerText.slice(0,200)' });
  console.log(`[root.innerText] ${JSON.stringify(body.result?.value ?? '')}`);
  ws.close();
} finally {
  edge.kill();
}
