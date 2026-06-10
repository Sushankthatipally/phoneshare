// Headless-Edge screenshot tool driven over the Chrome DevTools Protocol.
// Usage: node scripts/screenshot.mjs <url> <outfile.png> [width] [height] [clickJs] [settleMs]
//   clickJs: optional JS evaluated after load (e.g. click a nav tab), '' to skip.
// Used for the desktop-vs-mobile design parity loop (DROPBEAM_REDESIGN_V2_PLAN §3.4).

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const [url, outfile, widthArg, heightArg, clickJs = '', settleArg] = process.argv.slice(2);
if (!url || !outfile) {
  console.error('usage: node scripts/screenshot.mjs <url> <outfile.png> [width] [height] [clickJs] [settleMs]');
  process.exit(2);
}
const width = Number(widthArg) || 1280;
const height = Number(heightArg) || 800;
const settleMs = Number(settleArg) || 2500;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9777;

const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  `--window-size=${width},${height}`,
  '--user-data-dir=' + resolve(process.env.TEMP ?? '.', 'dropbeam-shot-profile'),
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      // Edge not ready yet.
    }
    await sleep(250);
  }
  throw new Error('Edge DevTools endpoint never came up');
}

let nextId = 1;
function send(ws, method, params = {}) {
  const id = nextId += 1;
  return new Promise((resolveCmd, reject) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        ws.off('message', onMessage);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolveCmd(msg.result);
      }
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

  await send(ws, 'Page.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 600,
  });
  await send(ws, 'Page.navigate', { url });
  await sleep(settleMs);
  if (clickJs) {
    await send(ws, 'Runtime.evaluate', { expression: clickJs, awaitPromise: true });
    await sleep(900);
  }
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  await mkdir(dirname(resolve(outfile)), { recursive: true });
  await writeFile(resolve(outfile), Buffer.from(shot.data, 'base64'));
  console.log(`saved ${outfile}`);
  ws.close();
} finally {
  edge.kill();
}
