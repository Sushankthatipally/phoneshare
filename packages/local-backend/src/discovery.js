import dgram from 'node:dgram';
import os from 'node:os';

const DEFAULT_DISCOVERY_PORT = 38_251;
const DISCOVERY_PROTOCOL = 'dropbeam.discovery.v1';
const DISCOVERY_TTL_SECONDS = 12;
const ANNOUNCE_INTERVAL_MS = 3_000;

export class BackendDiscoveryService {
  constructor({
    deviceProvider,
    emit,
    host,
    port,
    discoveryPort = DEFAULT_DISCOVERY_PORT,
  }) {
    this.deviceProvider = deviceProvider;
    this.emit = emit;
    this.host = host;
    this.port = port;
    this.discoveryPort = discoveryPort;
    this.advertiseHost = resolveAdvertiseHost(host);
    this.peers = new Map();
    this.announcementTimer = null;
    this.broadcaster = null;
    this.listener = null;
  }

  async start() {
    if (this.broadcaster || this.listener) {
      return;
    }

    this.broadcaster = dgram.createSocket('udp4');
    this.listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.broadcaster.on('error', () => {});
    this.listener.on('error', () => {});
    this.listener.on('message', (message, remoteInfo) => {
      void this.recordPeerPacket(message, remoteInfo);
    });

    await bindSocket(this.broadcaster, 0);
    this.broadcaster.setBroadcast(true);
    await bindSocket(this.listener, this.discoveryPort);

    this.announcementTimer = setInterval(() => {
      void this.broadcastAdvertisement();
    }, ANNOUNCE_INTERVAL_MS);
    this.announcementTimer.unref?.();
    await this.broadcastAdvertisement();
  }

  async stop() {
    if (this.announcementTimer) {
      clearInterval(this.announcementTimer);
      this.announcementTimer = null;
    }

    if (this.broadcaster) {
      this.broadcaster.close();
      this.broadcaster = null;
    }

    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }
  }

  status() {
    this.pruneExpired();

    return {
      enabled: Boolean(this.broadcaster && this.listener),
      bindAddress: this.host,
      advertiseHost: this.advertiseHost,
      discoveryPort: this.discoveryPort,
      servicePort: this.port,
      peerCount: this.peers.size,
    };
  }

  listPeers({ includeLocal = true } = {}) {
    this.pruneExpired();

    const peers = [...this.peers.values()].sort((left, right) => right.seenAt.localeCompare(left.seenAt));
    if (!includeLocal) {
      return peers;
    }

    return [this.localRecord(), ...peers];
  }

  async broadcastAdvertisement() {
    if (!this.broadcaster) {
      return;
    }

    const payload = Buffer.from(JSON.stringify(this.buildAdvertisement()), 'utf8');
    await new Promise((resolve) => {
      this.broadcaster.send(payload, this.discoveryPort, '255.255.255.255', () => resolve());
    });
  }

  buildAdvertisement() {
    const device = this.deviceProvider();
    return {
      protocol: DISCOVERY_PROTOCOL,
      device,
      host: this.advertiseHost,
      servicePort: this.port,
      transport: 'wifi',
      generatedAt: new Date().toISOString(),
      ttlSeconds: DISCOVERY_TTL_SECONDS,
    };
  }

  async recordPeerPacket(packet, remoteInfo) {
    let advertisement;

    try {
      advertisement = JSON.parse(packet.toString('utf8'));
    } catch {
      return;
    }

    if (advertisement?.protocol !== DISCOVERY_PROTOCOL) {
      return;
    }

    const local = this.deviceProvider();
    if (advertisement.device?.id === local.id) {
      return;
    }

    const seenAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (Number(advertisement.ttlSeconds) || DISCOVERY_TTL_SECONDS) * 1000).toISOString();
    const host = typeof advertisement.host === 'string' && advertisement.host.trim() ? advertisement.host.trim() : remoteInfo.address;

    this.peers.set(advertisement.device.id, {
      id: advertisement.device.id,
      name: advertisement.device.name,
      icon: advertisement.device.icon ?? 'desktop',
      platform: advertisement.device.platform ?? 'unknown',
      host,
      port: Number(advertisement.servicePort) || this.port,
      serviceOrigin: `http://${host}:${Number(advertisement.servicePort) || this.port}`,
      transport: advertisement.transport ?? 'wifi',
      source: remoteInfo.address,
      seenAt,
      expiresAt,
      local: false,
    });

    this.emit?.('discovery-updated', {
      items: this.listPeers(),
      status: this.status(),
    });
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

function bindSocket(socket, port) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, () => {
      socket.off('error', reject);
      resolve();
    });
  });
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
      if (item.family !== 'IPv4' || item.internal) {
        continue;
      }

      candidates.push({
        name,
        address: item.address,
        score: scoreInterface(name, item.address),
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  if (candidates.length) {
    return candidates[0].address;
  }

  return '127.0.0.1';
}

function scoreInterface(name, address) {
  const normalized = name.toLowerCase();
  let score = 0;

  if (/wi-?fi|wireless|wlan/.test(normalized)) {
    score += 100;
  }

  if (/ethernet/.test(normalized)) {
    score += 40;
  }

  if (/vmware|virtual|vbox|hyper-v|vethernet|docker|wsl|tailscale|loopback/.test(normalized)) {
    score -= 100;
  }

  if (/^192\.168\.1\./.test(address) || /^10\./.test(address)) {
    score += 10;
  }

  if (/^192\.168\.(93|193)\./.test(address)) {
    score -= 20;
  }

  return score;
}
