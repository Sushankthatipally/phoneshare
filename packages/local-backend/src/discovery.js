import net from 'node:net';
import os from 'node:os';

const PEER_TTL_MS = 30_000;
const MANUAL_PROBE_TIMEOUT_MS = 2_000;
const SERVICE_TYPE = 'dropbeam';

export class BackendDiscoveryService {
  constructor({ deviceProvider, emit, host, port, txtProvider }) {
    this.deviceProvider = deviceProvider;
    this.emit = emit;
    this.host = host;
    this.port = port;
    this.txtProvider = typeof txtProvider === 'function' ? txtProvider : null;
    this.advertiseHost = resolveAdvertiseHost(host);
    this.peers = new Map();
    this.pruneTimer = null;
    this.started = false;
    // Lazy mDNS handles — populated on start(), null on platforms that fail.
    this.bonjour = null;
    this.publishedService = null;
    this.browser = null;
    this.mdnsError = null;
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
    try {
      await this.startMdns();
    } catch (error) {
      this.mdnsError = error?.message ?? String(error);
      console.warn(`mDNS publish/browse disabled: ${this.mdnsError}`);
    }
  }

  async startMdns() {
    const module = await import('bonjour-service');
    const Bonjour = module.Bonjour ?? module.default?.Bonjour ?? module.default;
    if (typeof Bonjour !== 'function') {
      throw new Error('bonjour-service did not expose a Bonjour constructor');
    }
    this.bonjour = new Bonjour();
    const txt = this.buildTxtRecord();
    const device = this.deviceProvider();
    this.publishedService = this.bonjour.publish({
      name: device.name || device.id || 'DropBeam',
      type: SERVICE_TYPE,
      port: this.port,
      txt,
    });
    this.publishedService.on?.('error', (err) => {
      console.warn(`mDNS publish error: ${err?.message ?? err}`);
    });
    this.browser = this.bonjour.find({ type: SERVICE_TYPE });
    this.browser.on('up', (service) => this.handleMdnsUp(service));
    this.browser.on('down', (service) => this.handleMdnsDown(service));
  }

  buildTxtRecord() {
    const device = this.deviceProvider();
    const base = {
      v: '1',
      n: device.friendlyName || device.name || '',
      tag: device.hashtag || '',
      p: device.platform || process.platform,
      fp: device.fingerprint || '',
      port: String(this.port),
    };
    if (this.txtProvider) {
      const extras = this.txtProvider() || {};
      if (extras.publicKey) base.pk = extras.publicKey;
      if (extras.sessionId) base.sid = extras.sessionId;
    }
    return base;
  }

  // Re-advertise the local mDNS record with the current TXT data. Call after the
  // discovery session rotates (new pubkey + sid) or settings change.
  async refreshAdvertisement() {
    if (!this.bonjour) return;
    try {
      if (this.publishedService) {
        await new Promise((resolve) => this.publishedService.stop?.(resolve));
        this.publishedService = null;
      }
      const device = this.deviceProvider();
      const txt = this.buildTxtRecord();
      this.publishedService = this.bonjour.publish({
        name: device.name || device.id || 'DropBeam',
        type: SERVICE_TYPE,
        port: this.port,
        txt,
      });
    } catch (error) {
      console.warn(`mDNS re-advertise failed: ${error?.message ?? error}`);
    }
  }

  handleMdnsUp(service) {
    try {
      const local = this.deviceProvider();
      const fp = service.txt?.fp ?? '';
      // Ignore our own advertisement.
      if (fp && local.fingerprint && fp === local.fingerprint) return;
      const host = pickAddress(service.addresses) ?? service.host ?? '';
      if (!host) return;
      const id = `mdns:${service.fqdn ?? service.name}`;
      const now = new Date();
      const record = {
        id,
        name: service.txt?.n || service.name || id,
        icon: 'desktop',
        platform: service.txt?.p || 'unknown',
        host,
        port: Number(service.port) || this.port,
        serviceOrigin: `http://${host}:${Number(service.port) || this.port}`,
        transport: 'wifi',
        transports: ['wifi'],
        version: service.txt?.v || null,
        source: 'mdns',
        seenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PEER_TTL_MS).toISOString(),
        local: false,
        fingerprint: fp || null,
        hashtag: service.txt?.tag || null,
        friendlyName: service.txt?.n || null,
        publicKey: service.txt?.pk || null,
        sessionId: service.txt?.sid || null,
      };
      this.peers.set(id, record);
      this.broadcastUpdate();
    } catch (error) {
      console.warn(`mDNS up handler failed: ${error?.message ?? error}`);
    }
  }

  handleMdnsDown(service) {
    const id = `mdns:${service.fqdn ?? service.name}`;
    if (this.peers.delete(id)) this.broadcastUpdate();
  }

  async stop() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    if (this.browser) {
      try { this.browser.stop?.(); } catch {}
      this.browser = null;
    }
    if (this.publishedService) {
      await new Promise((resolve) => this.publishedService.stop?.(resolve)).catch(() => {});
      this.publishedService = null;
    }
    if (this.bonjour) {
      try { this.bonjour.destroy?.(); } catch {}
      this.bonjour = null;
    }
    this.peers.clear();
    this.started = false;
  }

  injectSyntheticPeer(record) {
    if (!record?.id) return null;
    const stored = {
      icon: 'phone',
      platform: 'unknown',
      transport: record.transport || 'usb',
      transports: [record.transport || 'usb'],
      source: 'usb',
      local: false,
      preferred: true,
      seenAt: new Date().toISOString(),
      expiresAt: new Date(8_640_000_000_000_000).toISOString(),
      serviceOrigin: `http://${record.host}:${record.port}`,
      ...record,
    };
    this.peers.set(record.id, stored);
    this.broadcastUpdate();
    return stored;
  }

  removeSyntheticPeer(id) {
    if (this.peers.delete(id)) this.broadcastUpdate();
  }

  status() {
    this.pruneExpired();
    return {
      enabled: this.started,
      serviceType: '_dropbeam._tcp.local.',
      advertiseHost: this.advertiseHost,
      servicePort: this.port,
      peerCount: this.peers.size,
      mdns: {
        publishing: Boolean(this.publishedService),
        browsing: Boolean(this.browser),
        error: this.mdnsError,
      },
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
      fingerprint: device.fingerprint ?? null,
      hashtag: device.hashtag ?? null,
      friendlyName: device.friendlyName ?? device.name,
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

function pickAddress(addresses) {
  if (!Array.isArray(addresses)) return null;
  const ipv4 = addresses.find((addr) => typeof addr === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(addr));
  if (ipv4) return ipv4;
  const first = addresses.find((addr) => typeof addr === 'string' && addr.length);
  return first ?? null;
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

// Rank every non-internal IPv4 candidate and return both the winner and the full
// sorted list. Each entry is shaped so the Diagnostics UI can show why a
// particular IP was picked (interface name + numeric score).
export function getPreferredLanOrigin({ port } = {}) {
  const advertisePort = Number(port) || Number(process.env.DROPBEAM_BACKEND_PORT) || 17619;
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, items] of Object.entries(interfaces)) {
    for (const item of items ?? []) {
      if (item.family !== 'IPv4' || item.internal || !item.address) continue;
      candidates.push({
        host: item.address,
        interface: name,
        score: scoreInterface(name, item.address),
        origin: `http://${item.address}:${advertisePort}`,
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const fallback = {
    host: '127.0.0.1',
    interface: 'loopback',
    score: -1000,
    origin: `http://127.0.0.1:${advertisePort}`,
  };

  return {
    preferred: candidates[0] ?? fallback,
    candidates: candidates.length ? candidates : [fallback],
  };
}
