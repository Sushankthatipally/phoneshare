import net from 'node:net';
import os from 'node:os';

const PEER_TTL_MS = 30_000;
const MANUAL_PROBE_TIMEOUT_MS = 2_000;

export class BackendDiscoveryService {
  constructor({ deviceProvider, emit, host, port }) {
    this.deviceProvider = deviceProvider;
    this.emit = emit;
    this.host = host;
    this.port = port;
    this.advertiseHost = resolveAdvertiseHost(host);
    this.peers = new Map();
    this.pruneTimer = null;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.pruneTimer = setInterval(() => {
      if (this.pruneExpired() > 0) {
        this.broadcastUpdate();
      }
    }, 5_000);
    this.pruneTimer.unref?.();
  }

  async stop() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.peers.clear();
    this.started = false;
  }

  status() {
    this.pruneExpired();
    return {
      enabled: this.started,
      serviceType: '_dropbeam._tcp.local.',
      advertiseHost: this.advertiseHost,
      servicePort: this.port,
      peerCount: this.peers.size,
    };
  }

  listPeers({ includeLocal = true } = {}) {
    this.pruneExpired();
    const peers = [...this.peers.values()].sort((left, right) => right.seenAt.localeCompare(left.seenAt));
    if (!includeLocal) return peers;
    return [this.localRecord(), ...peers];
  }

  recordPeerSeen(input = {}) {
    const id = sanitizeText(input.id) ?? sanitizeText(input.fullname);
    if (!id) {
      const error = new Error('peer-seen requires id or fullname');
      error.status = 400;
      throw error;
    }
    const local = this.deviceProvider();
    if (id === local.id) {
      return null;
    }

    const host = sanitizeText(input.host) ?? (input.addresses?.find(Boolean) ?? '');
    if (!host) {
      const error = new Error('peer-seen requires host');
      error.status = 400;
      throw error;
    }
    const port = Number.isFinite(Number(input.port)) ? Number(input.port) : this.port;
    const transports = Array.isArray(input.transports)
      ? input.transports.map((t) => String(t)).filter(Boolean)
      : [];
    const transport = transports.includes('wifi') ? 'wifi' : transports[0] ?? 'wifi';
    const now = new Date();
    const record = {
      id,
      name: sanitizeText(input.name) ?? id,
      icon: sanitizeIcon(input.icon),
      platform: sanitizeText(input.platform) ?? 'unknown',
      host,
      port,
      serviceOrigin: `http://${host}:${port}`,
      transport,
      transports,
      version: sanitizeText(input.version) ?? null,
      source: 'mdns',
      seenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PEER_TTL_MS).toISOString(),
      local: false,
    };
    this.peers.set(id, record);
    this.broadcastUpdate();
    return record;
  }

  recordPeerGone(input = {}) {
    const id = sanitizeText(input.id) ?? sanitizeText(input.fullname);
    if (!id) return false;
    const removed = this.peers.delete(id);
    if (removed) this.broadcastUpdate();
    return removed;
  }

  async addManualPeer(input = {}) {
    const host = sanitizeText(input.host);
    const port = Number(input.port);
    if (!host) {
      const error = new Error('host is required');
      error.status = 400;
      throw error;
    }
    if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
      const error = new Error('port must be a valid TCP port');
      error.status = 400;
      throw error;
    }

    await probeTcp(host, port, MANUAL_PROBE_TIMEOUT_MS);

    const label = sanitizeText(input.label) ?? `${host}:${port}`;
    const id = `manual:${host}:${port}`;
    const now = new Date();
    const record = {
      id,
      name: label,
      icon: 'desktop',
      platform: 'unknown',
      host,
      port,
      serviceOrigin: `http://${host}:${port}`,
      transport: 'wifi',
      transports: ['wifi'],
      version: null,
      source: 'manual',
      seenAt: now.toISOString(),
      expiresAt: new Date(8_640_000_000_000_000).toISOString(),
      local: false,
      label,
    };
    this.peers.set(id, record);
    this.broadcastUpdate();
    return record;
  }

  pruneExpired() {
    const now = Date.now();
    let removed = 0;
    for (const [id, peer] of this.peers.entries()) {
      if (peer.source === 'manual') continue;
      if (Date.parse(peer.expiresAt) <= now) {
        this.peers.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  broadcastUpdate() {
    this.emit?.('discovery-update', {
      items: this.listPeers(),
      status: this.status(),
    });
  }

  localRecord() {
    const device = this.deviceProvider();
    const now = new Date().toISOString();
    return {
      id: device.id,
      name: device.name,
      icon: device.icon ?? 'desktop',
      platform: device.platform ?? process.platform,
      host: this.advertiseHost,
      port: this.port,
      serviceOrigin: `http://${this.advertiseHost}:${this.port}`,
      transport: 'wifi',
      transports: ['wifi', 'usb'],
      version: null,
      source: 'self',
      seenAt: now,
      expiresAt: new Date(Date.now() + PEER_TTL_MS).toISOString(),
      local: true,
    };
  }
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) {
        const wrapped = new Error(`TCP probe failed for ${host}:${port}: ${err.message ?? err}`);
        wrapped.status = 502;
        reject(wrapped);
      } else {
        resolve();
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error('timeout')));
    socket.once('error', (err) => finish(err));
    socket.connect(port, host);
  });
}

function sanitizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeIcon(value) {
  const allowed = new Set(['desktop', 'laptop', 'phone', 'tablet']);
  if (typeof value === 'string' && allowed.has(value)) return value;
  return 'desktop';
}

function resolveAdvertiseHost(bindAddress) {
  if (
    bindAddress &&
    bindAddress !== '0.0.0.0' &&
    bindAddress !== '::' &&
    bindAddress !== '127.0.0.1' &&
    bindAddress !== 'localhost'
  ) {
    return bindAddress;
  }

  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, items] of Object.entries(interfaces)) {
    for (const item of items ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      candidates.push({ name, address: item.address, score: scoreInterface(name, item.address) });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.address ?? '127.0.0.1';
}

function scoreInterface(name, address) {
  const normalized = name.toLowerCase();
  let score = 0;
  if (/wi-?fi|wireless|wlan/.test(normalized)) score += 100;
  if (/ethernet/.test(normalized)) score += 40;
  if (/vmware|virtual|vbox|hyper-v|vethernet|docker|wsl|tailscale|loopback/.test(normalized)) score -= 100;
  if (/^192\.168\.1\./.test(address) || /^10\./.test(address)) score += 10;
  if (/^192\.168\.(93|193)\./.test(address)) score -= 20;
  return score;
}
