/*
 * DropBeam local backend.
 * This package provides a Node-only session, file transfer, and persistence layer for the desktop and phone apps.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { resolveBackendConfig } from './config.js';
import { BackendDiscoveryService } from './discovery.js';
import { LocalBackendStore } from './store.js';

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

await store.init();
await discovery.start();

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    const status = Number(error?.status ?? 500);
    sendJson(res, status, {
      ok: false,
      error: error?.message ?? 'Internal server error',
    });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const displayPort = typeof address === 'object' && address ? address.port : port;
  console.log(`DropBeam local backend listening on http://${host}:${displayPort}`);
  console.log(`Data directory: ${dataDir}`);
});

async function handleRequest(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const { pathname, searchParams, origin } = parseRequestUrl(req);

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      uptimeSeconds: Math.floor(process.uptime()),
      ...buildHealth(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    sendJson(res, 200, {
      ok: true,
      ...store.getDashboard(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/history') {
    const query = searchParams.get('query') ?? '';
    sendJson(res, 200, {
      ok: true,
      items: store.getHistory(query),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    sendJson(res, 200, {
      ok: true,
      settings: store.getSettings(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/clipboard') {
    sendJson(res, 200, {
      ok: true,
      clipboard: store.getClipboard(),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/settings') {
    const body = await readJson(req);
    const settings = await store.updateSettings(body ?? {});
    sendJson(res, 200, {
      ok: true,
      settings,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/clipboard') {
    const body = await readJson(req);
    const clipboard = await store.updateClipboard(body ?? {});
    sendJson(res, 200, {
      ok: true,
      clipboard,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readJson(req);
    const advertiseHost = discovery.status().advertiseHost;
    const session = await store.createSession({
      ...body,
      origin: rewriteOriginHost(body?.origin ?? origin, advertiseHost),
      backendOrigin: rewriteOriginHost(body?.backendOrigin ?? origin, advertiseHost),
    });
    sendJson(res, 201, {
      ok: true,
      session,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    sendJson(res, 200, {
      ok: true,
      items: store.listSessions(),
    });
    return;
  }

  if (pathname.startsWith('/api/sessions/')) {
    if (pathname.match(/^\/api\/sessions\/[^/]+\/files$/)) {
      const sessionId = decodeURIComponent(pathname.split('/')[3]);
      const direction = searchParams.get('direction') ?? 'desktop-to-phone';
      if (req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          ...store.listFiles(sessionId, direction),
        });
        return;
      }
    }

    if (pathname.match(/^\/api\/sessions\/[^/]+\/uploads\/start$/) && req.method === 'POST') {
      const sessionId = decodeURIComponent(pathname.split('/')[3]);
      const body = await readJson(req);
      const upload = await store.startUpload(sessionId, body ?? {});
      sendJson(res, 200, {
        ok: true,
        upload,
      });
      return;
    }

    if (pathname.match(/^\/api\/sessions\/[^/]+\/pair$/) && req.method === 'POST') {
      const sessionId = decodeURIComponent(pathname.split('/')[3]);
      const body = await readJson(req);
      const session = await store.pairSession(sessionId, body ?? {});
      sendJson(res, 200, {
        ok: true,
        session,
      });
      return;
    }

    if (pathname.match(/^\/api\/sessions\/[^/]+\/close$/) && req.method === 'POST') {
      const sessionId = decodeURIComponent(pathname.split('/')[3]);
      const body = await readJson(req);
      const session = await store.closeSession(sessionId, body ?? {});
      sendJson(res, 200, {
        ok: true,
        session,
      });
      return;
    }

    const match = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (match && req.method === 'GET') {
      const sessionId = decodeURIComponent(match[1]);
      sendJson(res, 200, {
        ok: true,
        session: store.getSession(sessionId),
      });
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/discovery') {
    sendJson(res, 200, {
      ok: true,
      items: discovery.listPeers(),
      status: discovery.status(),
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/files/') && pathname.endsWith('/download')) {
    const fileId = decodeURIComponent(pathname.split('/')[3]);
    const download = await store.downloadFile(fileId);
    res.writeHead(200, {
      'Content-Type': download.file.mimeType,
      'Content-Length': String(download.file.size),
      'Content-Disposition': `attachment; filename="${escapeHeaderValue(download.file.name)}"`,
      'Cache-Control': 'no-store',
    });
    const stream = createReadStream(download.path);
    await pipeline(stream, res);
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/files/') && pathname.endsWith('/payload')) {
    const fileId = decodeURIComponent(pathname.split('/')[3]);
    const sessionId = searchParams.get('sessionId') ?? '';
    const payload = await store.downloadSecureFile(fileId, sessionId);
    sendJson(res, 200, {
      ok: true,
      ...payload,
    });
    return;
  }

  if (pathname.startsWith('/api/uploads/')) {
    const statusMatch = pathname.match(/^\/api\/uploads\/([^/]+)$/);
    if (statusMatch && req.method === 'GET') {
      const uploadId = decodeURIComponent(statusMatch[1]);
      sendJson(res, 200, {
        ok: true,
        upload: store.getUpload(uploadId),
      });
      return;
    }

    const chunkMatch = pathname.match(/^\/api\/uploads\/([^/]+)\/chunks\/(\d+)$/);
    if (chunkMatch && req.method === 'PUT') {
      const uploadId = decodeURIComponent(chunkMatch[1]);
      const chunkIndex = Number.parseInt(chunkMatch[2], 10);
      const upload = await store.receiveUploadChunk(uploadId, chunkIndex, req);
      sendJson(res, 200, {
        ok: true,
        upload,
      });
      return;
    }

    const completeMatch = pathname.match(/^\/api\/uploads\/([^/]+)\/complete$/);
    if (completeMatch && req.method === 'POST') {
      const uploadId = decodeURIComponent(completeMatch[1]);
      const file = await store.completeUpload(uploadId);
      sendJson(res, 200, {
        ok: true,
        file,
      });
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    openEventStream(req, res);
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: 'Route not found',
  });
}

function buildHealth() {
  const dashboard = store.getDashboard();
  return {
    sessions: dashboard.totals.sessions,
    activeSessions: dashboard.activeSessions.length,
    pairedSessions: dashboard.totals.paired,
    transferringSessions: dashboard.totals.transferring,
    fileCount: dashboard.totals.files,
    totalBytes: dashboard.totals.bytes,
    settings: dashboard.settings,
  };
}

function openEventStream(req, res) {
  const client = {
    id: randomUUID(),
    res,
  };

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
    if (!res.writableEnded) {
      res.write(`: ping ${Date.now()}\n\n`);
    }
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
  const protocol = host === '127.0.0.1' || host === 'localhost' ? 'http' : 'http';
  const url = new URL(req.url, `${protocol}://${hostHeader}`);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
    origin: `${protocol}://${hostHeader}`,
  };
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Disposition');
}

function sendJson(res, statusCode, body) {
  if (!res.headersSent) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

function escapeHeaderValue(value) {
  return String(value).replace(/"/g, '\\"');
}

function randomUUID() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rewriteOriginHost(value, hostOverride) {
  if (!hostOverride) {
    return value;
  }

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
