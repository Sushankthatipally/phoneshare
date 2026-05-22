import os from 'node:os';

const DISCOVERY_TTL_SECONDS = 12;

// UDP broadcast discovery has been removed (was unreliable across guest WiFi / firewalls).
// W6 replaces this with mDNS via the Tauri side. Until then, this service is a passive
// peer registry that exposes the local advertise host so the rest of the backend
// (QR generation, /api/discovery responses) keeps working.
export class BackendDiscoveryService {
  constructor({
    deviceProvider,
    emit,
    host,
    port,
  }) {
    this.deviceProvider = deviceProvider;
    this.emit = emit;
    this.host = host;
    this.port = port;
    this.advertiseHost = resolveAdvertiseHost(host);
    this.peers = new Map();
  }

  async start() {
    // Intentional no-op; mDNS lives in the Tauri layer (W6).
  }

  async stop() {
    this.peers.clear();
  }

  status() {
    this.pruneExpired();
    return {
      enabled: false,
      bindAddress: this.host,
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

  // Inbound mDNS / manual-add will populate the registry via this method (wired in W6).
  recordPeer(peer) {
    if (!peer?.id) return;
    const seenAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + DISCOVERY_TTL_SECONDS * 1000).toISOString();
    this.peers.set(peer.id, {
      id: peer.id,
      name: peer.name,
      icon: peer.icon ?? 'desktop',
      platform: peer.platform ?? 'unknown',
      host: peer.host,
      port: Number(peer.port) || this.port,
      serviceOrigin: peer.serviceOrigin ?? (peer.host ? `http://${peer.host}:${Number(peer.port) || this.port}` : null),
      transport: peer.transport ?? 'wifi',
      source: peer.source ?? 'mdns',
      seenAt,
      expiresAt,
      local: false,
    });
    this.emit?.('discovery-updated', { items: this.listPeers(), status: this.status() });
  }

  pruneExpired() {
    const now = Date.now();
    for (const [id, peer] of this.peers.entries()) {
      if (Date.parse(peer.expiresAt) <= now) {
        this.peers.delete(id);
      }
    }
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
      source: 'self',
      seenAt: now,
      expiresAt: new Date(Date.now() + DISCOVERY_TTL_SECONDS * 1000).toISOString(),
      local: true,
    };
  }
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
    const lower = name.toLowerCase();
    if (/^(tun|utun|tap|vpn|tailscale|zerotier|wireguard|wg|ppp)/.test(lower)) continue;
    if (/(vmware|virtual|vbox|hyper-?v|vethernet|docker|wsl|bridge)/.test(lower)) continue;
    for (const item of items ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (/^169\.254\./.test(item.address)) continue;
      candidates.push({
        name,
        address: item.address,
        score: scoreInterface(lower, item.address),
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  if (candidates.length) return candidates[0].address;
  return '127.0.0.1';
}

function scoreInterface(lowerName, address) {
  let score = 0;
  if (/(^en\d|ethernet|eth\d)/.test(lowerName)) score += 100;
  else if (/(wi-?fi|wlan|wireless|airport)/.test(lowerName)) score += 80;
  if (/^192\.168\.(0|1)\./.test(address)) score += 20;
  else if (/^192\.168\./.test(address)) score += 12;
  else if (/^10\./.test(address)) score += 10;
  else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(address)) score += 8;
  return score;
}
