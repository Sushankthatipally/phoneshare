/*
 * DropBeam local backend.
 * Provides session, file-transfer, trusted-device, guest-share, and benchmark services
 * for the desktop and mobile apps.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomBytes, randomUUID } from 'node:crypto';

import { resolveBackendConfig } from './config.js';
import { BackendDiscoveryService } from './discovery.js';
import { LocalBackendStore } from './store.js';
import { WatchFolderDriver } from './watch-folders.js';
import { renderGuestPageHtml, renderGuestExpiredHtml } from './guest-page.js';

const { dataDir, host, port } = resolveBackendConfig();

const sseClients = new Set();
let eventId = 0;

const store = new LocalBackendStore({
  dataDir,
  emit: (type, payload) => broadcast(type, payload),
});
const discovery = new BackendDiscoveryService({
  deviceProvider: () => store.getLocalDiscoveryDevice(),
  emit: (type, payload) => broadcast(type, payload),
  host,
  port,
});
const watchFolders = new WatchFolderDriver({
  store,
  broadcast: (type, payload) => broadcast(type, payload),
  log: (message) => console.warn(`[watch-folder] ${message}`),
});
store.onPeerConnected((fingerprint) => watchFolders.notePeerConnected(fingerprint));

// Boot asynchronously so the source compiles to CJS (no top-level await).
void (async function bootBackend() {
  await store.init();
  // Discovery (UDP mDNS) is best-effort — if the port is busy or blocked we
  // still want HTTP available so the desktop UI loads.
  try {
    await discovery.start();
  } catch (error) {
    console.warn(`DropBeam discovery disabled: ${error?.message ?? error}`);
  }

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      const status = Number(error?.status ?? 500);
      const body = error?.body
        ? { ok: false, ...error.body }
        : { ok: false, error: error?.message ?? 'Internal server error' };
      sendJson(res, status, body);
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    const displayPort = typeof address === 'object' && address ? address.port : port;
    console.log(`DropBeam local backend listening on http://${host}:${displayPort}`);
    console.log(`Data directory: ${dataDir}`);
  });
})().catch((error) => {
  console.error('DropBeam backend failed to start', error);
  process.exit(1);
});

async function handleRequest(req, res) {
  setCorsHeaders(res, req);
  if (req.method === 'OPTIONS') {
    // Preflight (including Chrome Private Network Access preflight from tauri.localhost
    // to 127.0.0.1) — answer with the matching PNA header so the webview accepts.
    res.writeHead(204);
    res.end();
    return;
  }

  const { pathname, searchParams, origin } = parseRequestUrl(req);

  // ─── Guest mode (browser-facing HTML) ───────────────────
  if (req.method === 'GET' && pathname.startsWith('/guest/')) {
    const token = decodeURIComponent(pathname.split('/')[2] ?? '');
    return renderGuestPage(res, token);
  }
  if (req.method === 'GET' && pathname.startsWith('/api/guest/')) {
    const parts = pathname.split('/');
    if (parts.length === 6 && parts[4] === 'files' && parts[5] === 'download') {
      const token = decodeURIComponent(parts[3]);
      const fileId = searchParams.get('fileId') ?? '';
      return serveGuestFile(res, token, fileId);
    }
  }

  // ─── Health / dashboard / history ───────────────────────
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, uptimeSeconds: Math.floor(process.uptime()), ...buildHealth() });
  }
  if (req.method === 'GET' && pathname === '/api/dashboard') {
    return sendJson(res, 200, { ok: true, ...store.getDashboard() });
  }
  if (req.method === 'GET' && pathname === '/api/history') {
    return sendJson(res, 200, { ok: true, items: store.getHistory(searchParams.get('query') ?? '') });
  }

  // ─── Settings ───────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/settings') {
    return sendJson(res, 200, { ok: true, settings: store.getSettings() });
  }
  if (req.method === 'POST' && pathname === '/api/settings') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, settings: await store.updateSettings(body ?? {}) });
  }

  // ─── Clipboard ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/clipboard') {
    return sendJson(res, 200, { ok: true, clipboard: store.getClipboard() });
  }
  if (req.method === 'POST' && pathname === '/api/clipboard') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, clipboard: await store.updateClipboard(body ?? {}) });
  }

  // ─── Trusted / known devices ────────────────────────────
  if (req.method === 'GET' && pathname === '/api/trusted-devices') {
    return sendJson(res, 200, { ok: true, items: store.listTrustedDevices() });
  }
  if (req.method === 'GET' && pathname === '/api/known-devices') {
    return sendJson(res, 200, { ok: true, items: store.listKnownDevices() });
  }
  if (pathname.startsWith('/api/known-devices/') && req.method === 'POST') {
    const reconnectMatch = pathname.match(/^\/api\/known-devices\/([^/]+)\/reconnect$/);
    if (reconnectMatch) {
      const fp = decodeURIComponent(reconnectMatch[1]);
      const body = await readJson(req);
      const advertiseHost = discovery.status().advertiseHost;
      const result = await store.reconnectKnownDevice(fp, {
        ...(body ?? {}),
        origin: rewriteOriginHost(body?.origin ?? origin, advertiseHost),
        backendOrigin: rewriteOriginHost(body?.backendOrigin ?? origin, advertiseHost),
      });
      return sendJson(res, 201, { ok: true, ...result });
    }
  }
  if (pathname.startsWith('/api/trusted-devices/')) {
    const fp = decodeURIComponent(pathname.slice('/api/trusted-devices/'.length));
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, trusted: await store.setTrustedDevice(fp, body ?? {}) });
    }
    if (req.method === 'DELETE') {
      return sendJson(res, 200, { ok: true, ...(await store.removeTrustedDevice(fp)) });
    }
  }

  // ─── Sessions ───────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readJson(req);
    const advertiseHost = discovery.status().advertiseHost;
    const session = await store.createSession({
      ...body,
      origin: rewriteOriginHost(body?.origin ?? origin, advertiseHost),
      backendOrigin: rewriteOriginHost(body?.backendOrigin ?? origin, advertiseHost),
    });
    return sendJson(res, 201, { ok: true, session });
  }
  if (req.method === 'GET' && pathname === '/api/sessions') {
    return sendJson(res, 200, { ok: true, items: store.listSessions() });
  }

  if (pathname.startsWith('/api/sessions/')) {
    const segments = pathname.split('/');
    const sessionId = decodeURIComponent(segments[3] ?? '');
    const tail = segments.slice(4).join('/');

    if (!tail && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, session: store.getSession(sessionId) });
    }
    if (tail === 'files' && req.method === 'GET') {
      const direction = searchParams.get('direction') ?? 'desktop-to-phone';
      return sendJson(res, 200, { ok: true, ...store.listFiles(sessionId, direction) });
    }
    if (tail === 'uploads/start' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, upload: await store.startUpload(sessionId, body ?? {}) });
    }
    if (tail === 'pair' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, session: await store.pairSession(sessionId, body ?? {}) });
    }
    if (tail === 'connect' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, session: await store.requestConnect(sessionId, body ?? {}) });
    }
    if (tail === 'accept' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, session: await store.acceptSession(sessionId, body ?? {}) });
    }
    if (tail === 'pin-verify' && req.method === 'POST') {
      const body = await readJson(req);
      const result = await store.verifyPin(sessionId, body ?? {});
      const status = result.ok ? 200 : result.reason === 'locked' ? 423 : 401;
      return sendJson(res, status, result);
    }
    if (tail === 'decline' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, session: await store.declineSession(sessionId, body ?? {}) });
    }
    if (tail === 'regenerate' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, session: await store.regenerateSession(sessionId) });
    }
    if (tail === 'close' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, session: await store.closeSession(sessionId, body ?? {}) });
    }
    if (tail === 'pin-verify' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, {
        ok: true,
        session: await store.verifyPin(sessionId, String(body?.pin ?? '')),
      });
    }
    const disconnectMatch = tail.match(/^devices\/([^/]+)\/disconnect$/);
    if (disconnectMatch && req.method === 'POST') {
      const fp = decodeURIComponent(disconnectMatch[1]);
      return sendJson(res, 200, {
        ok: true,
        session: await store.disconnectDeviceFromSession(sessionId, fp),
      });
    }
    if (tail === 'transfers' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, batch: await store.requestTransferBatch(sessionId, body ?? {}) });
    }
    const transferMatch = tail.match(/^transfers\/([^/]+)\/(accept|decline)$/);
    if (transferMatch && req.method === 'POST') {
      const [, batchId, action] = transferMatch;
      const body = await readJson(req);
      const fn = action === 'accept' ? 'acceptTransferBatch' : 'declineTransferBatch';
      return sendJson(res, 200, { ok: true, result: await store[fn](sessionId, batchId, body ?? {}) });
    }
  }

  // ─── Discovery ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/discovery') {
    return sendJson(res, 200, { ok: true, items: discovery.listPeers(), status: discovery.status() });
  }
  if (req.method === 'POST' && pathname === '/api/discovery/manual-add') {
    const body = await readJson(req);
    const peer = await discovery.addManualPeer(body ?? {});
    return sendJson(res, 201, { ok: true, peer });
  }
  if (req.method === 'POST' && pathname === '/api/discovery/peer-seen') {
    const body = await readJson(req);
    const peer = discovery.recordPeerSeen(body ?? {});
    return sendJson(res, 200, { ok: true, peer });
  }
  if (req.method === 'POST' && pathname === '/api/discovery/peer-gone') {
    const body = await readJson(req);
    const removed = discovery.recordPeerGone(body ?? {});
    return sendJson(res, 200, { ok: true, removed });
  }

  // ─── Files ──────────────────────────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/api/files/') && pathname.endsWith('/download')) {
    const fileId = decodeURIComponent(pathname.split('/')[3]);
    const dl = await store.downloadFile(fileId);
    res.writeHead(200, {
      'Content-Type': dl.file.mimeType,
      'Content-Length': String(dl.file.size),
      'Content-Disposition': `attachment; filename="${escapeHeaderValue(dl.file.name)}"`,
      'Cache-Control': 'no-store',
    });
    return pipeline(createReadStream(dl.path), res);
  }
  if (req.method === 'GET' && pathname.startsWith('/api/files/') && pathname.endsWith('/payload')) {
    const fileId = decodeURIComponent(pathname.split('/')[3]);
    const sessionId = searchParams.get('sessionId') ?? '';
    return sendJson(res, 200, { ok: true, ...(await store.downloadSecureFile(fileId, sessionId)) });
  }

  // ─── Uploads ────────────────────────────────────────────
  if (pathname.startsWith('/api/uploads/')) {
    const statusMatch = pathname.match(/^\/api\/uploads\/([^/]+)$/);
    if (statusMatch && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, upload: store.getUpload(decodeURIComponent(statusMatch[1])) });
    }
    const chunkMatch = pathname.match(/^\/api\/uploads\/([^/]+)\/chunks\/(\d+)$/);
    if (chunkMatch && req.method === 'PUT') {
      const uploadId = decodeURIComponent(chunkMatch[1]);
      const chunkIndex = Number.parseInt(chunkMatch[2], 10);
      return sendJson(res, 200, { ok: true, upload: await store.receiveUploadChunk(uploadId, chunkIndex, req) });
    }
    const completeMatch = pathname.match(/^\/api\/uploads\/([^/]+)\/complete$/);
    if (completeMatch && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, file: await store.completeUpload(decodeURIComponent(completeMatch[1])) });
    }
  }

  // ─── Guest shares (host-side admin) ─────────────────────
  if (req.method === 'POST' && pathname === '/api/guest') {
    const body = await readJson(req);
    const share = await store.createGuestShare(body ?? {});
    // Include lanUrl so the desktop UI / phone can show a URL reachable from the LAN
    // instead of the loopback-bound 127.0.0.1 the desktop's webview client knows.
    const lanOrigin = store.lanOrigin();
    return sendJson(res, 201, {
      ok: true,
      share,
      lanUrl: lanOrigin ? `${lanOrigin}/guest/${encodeURIComponent(share.token)}` : null,
      lanOrigin,
    });
  }
  if (pathname.startsWith('/api/guest/')) {
    const parts = pathname.split('/');
    if (parts.length === 5 && parts[4] === 'files' && req.method === 'PUT') {
      const token = decodeURIComponent(parts[3]);
      const fileMeta = JSON.parse(decodeURIComponent(req.headers['x-file-meta'] ?? '{}'));
      const record = await store.addGuestFile(token, fileMeta, req);
      return sendJson(res, 201, { ok: true, file: record });
    }
  }

  // ─── Benchmark ──────────────────────────────────────────
  if (req.method === 'PUT' && pathname === '/api/benchmark/echo') {
    return runBenchmarkEcho(req, res);
  }
  if (req.method === 'GET' && pathname === '/api/benchmark/blob') {
    return runBenchmarkBlob(req, res, searchParams);
  }

  // ─── System notify (forwarded to Tauri renderer via SSE) ──
  if (req.method === 'POST' && pathname === '/api/notify/system') {
    const body = await readJson(req);
    const payload = buildSystemNotifyPayload(body ?? {});
    broadcast('system-notify', payload);
    return sendJson(res, 200, { ok: true, notify: payload });
  }

  // ─── Watch folder ───────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/watch-folder/file-detected') {
    const body = await readJson(req);
    if (!body?.watchFolderId || typeof body?.path !== 'string') {
      return sendJson(res, 400, { ok: false, error: 'watchFolderId and path are required' });
    }
    const result = await watchFolders.noteFileDetected({
      watchFolderId: String(body.watchFolderId),
      path: String(body.path),
    });
    return sendJson(res, 200, { ok: true, fired: result });
  }

  // ─── Event stream ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/events') {
    return openEventStream(req, res);
  }

  return sendJson(res, 404, { ok: false, error: 'Route not found' });
}

function buildHealth() {
  const d = store.getDashboard();
  return {
    sessions: d.totals.sessions,
    activeSessions: d.activeSessions.length,
    pairedSessions: d.totals.paired,
    transferringSessions: d.totals.transferring,
    pendingSessions: d.totals.pending,
    fileCount: d.totals.files,
    totalBytes: d.totals.bytes,
    trustedDeviceCount: d.trustedDevices.length,
    knownDeviceCount: d.knownDevices.length,
    settings: d.settings,
  };
}

async function renderGuestPage(res, token) {
  const share = store.getGuestShare(token);
  if (!share) {
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(renderGuestExpiredHtml());
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(renderGuestPageHtml({ ...share, token }));
  // Increment once per token-load (HTML page render), NOT per file download.
  await store.incrementGuestUse(token);
}

async function serveGuestFile(res, token, fileId) {
  const found = store.guestFilePath(token, fileId);
  if (!found) return sendJson(res, 404, { ok: false, error: 'Share or file not found' });
  res.writeHead(200, {
    'Content-Type': found.file.mimeType,
    'Content-Length': String(found.file.size),
    'Content-Disposition': `attachment; filename="${escapeHeaderValue(found.file.name)}"`,
    'Cache-Control': 'no-store',
  });
  return pipeline(createReadStream(found.path), res);
}

async function runBenchmarkEcho(req, res) {
  const startedAt = Date.now();
  let total = 0;
  for await (const chunk of req) total += chunk.length;
  const ms = Date.now() - startedAt;
  const bytesPerSecond = ms > 0 ? Math.round((total / ms) * 1000) : 0;
  return sendJson(res, 200, { ok: true, bytes: total, durationMs: ms, bytesPerSecond });
}

function runBenchmarkBlob(_req, res, params) {
  const size = Math.min(Math.max(Number(params.get('bytes') ?? 1024 * 1024), 1024), 64 * 1024 * 1024);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(size),
    'Cache-Control': 'no-store',
  });
  const chunkSize = 64 * 1024;
  let remaining = size;
  const stream = randomBytes(chunkSize);
  function pump() {
    while (remaining > 0) {
      const next = remaining >= chunkSize ? stream : stream.subarray(0, remaining);
      const ok = res.write(next);
      remaining -= next.length;
      if (!ok && remaining > 0) {
        res.once('drain', pump);
        return;
      }
    }
    res.end();
  }
  pump();
}

function openEventStream(req, res) {
  const client = { id: randomUUID(), res };
  sseClients.add(client);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: snapshot\ndata: ${JSON.stringify({ ok: true, dashboard: store.getDashboard() })}\n\n`);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: ping ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
}

function broadcast(type, payload) {
  eventId += 1;
  const message = [
    `id: ${eventId}`,
    `event: ${type}`,
    `data: ${JSON.stringify({ ok: true, type, payload })}`,
    '',
  ].join('\n');
  for (const client of sseClients) {
    try {
      client.res.write(`${message}\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function parseRequestUrl(req) {
  const hostHeader = req.headers.host ?? `${host}:${port}`;
  const protocol = 'http';
  const url = new URL(req.url, `${protocol}://${hostHeader}`);
  return { pathname: url.pathname, searchParams: url.searchParams, origin: `${protocol}://${hostHeader}` };
}

function setCorsHeaders(res, req) {
  // Echo the origin so credentialed / PNA preflights pass; fall back to * for plain hosts.
  const origin = req?.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', origin && origin !== 'null' ? origin : '*');
  if (origin && origin !== 'null') {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-File-Meta');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type,Content-Length,Content-Disposition');
  // Private Network Access (CORS-RFC1918). Required for the Tauri webview to fetch
  // 127.0.0.1 from a public-ish origin like http://tauri.localhost.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, statusCode, body) {
  if (!res.headersSent) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function escapeHeaderValue(value) {
  return String(value).replace(/"/g, '\\"');
}

const SYSTEM_NOTIFY_KINDS = new Set(['incoming', 'paired', 'pin', 'error', 'transfer-complete']);

function buildSystemNotifyPayload(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  const kind = SYSTEM_NOTIFY_KINDS.has(input?.kind) ? input.kind : null;
  if (!title) throw httpError(400, 'title is required');
  if (!body) throw httpError(400, 'body is required');
  if (!kind) throw httpError(400, 'kind must be one of incoming|paired|pin|error|transfer-complete');
  const sessionId = typeof input?.sessionId === 'string' && input.sessionId.trim() ? input.sessionId.trim() : null;
  return {
    title: title.slice(0, 200),
    body: body.slice(0, 1000),
    sessionId,
    kind,
    emittedAt: new Date().toISOString(),
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}


function rewriteOriginHost(value, hostOverride) {
  if (!hostOverride) return value;
  try {
    const url = new URL(String(value));
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0') {
      url.hostname = hostOverride;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return value;
  }
}
