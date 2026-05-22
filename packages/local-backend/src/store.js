import { createWriteStream } from 'node:fs';
import {
  access,
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  createPairingTicket,
  decryptTransferChunk,
  deriveSessionSecret,
  encryptTransferBuffer,
} from './crypto.js';

const QR_TTL_MS = 10 * 60 * 1000;
const GUEST_TTL_MS = 60 * 60 * 1000;
const MAX_PIN_ATTEMPTS = 3;

const DEFAULT_SETTINGS = {
  deviceName: 'DropBeam Desktop',
  deviceIcon: 'desktop',
  preferredMode: 'wifi',
  publicOrigin: process.env.DROPBEAM_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5174',
  downloadFolder: '~/Downloads/DropBeam/',
  connectionMode: 'auto',
  autoCloseAfterDownload: false,
  autoAcceptTrusted: false,
  onboardingComplete: false,
  watchFolders: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SESSION_STATES = {
  pairing: 'pairing',
  awaitingAccept: 'awaiting-accept',
  paired: 'paired',
  transferring: 'transferring',
  completed: 'completed',
  closed: 'closed',
  failed: 'failed',
};

const DIRECTION_VALUES = new Set(['desktop-to-phone', 'phone-to-desktop']);

export class LocalBackendStore {
  constructor({ dataDir, emit }) {
    this.dataDir = dataDir;
    this.emit = emit;
    this.stateFile = join(this.dataDir, 'state.json');
    this.filesDir = join(this.dataDir, 'files');
    this.guestDir = join(this.dataDir, 'guest');
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.clipboard = this.emptyClipboard();
    this.sessions = new Map();
    this.fileIndex = new Map();
    this.uploads = new Map();
    this.sessionSecrets = new Map();
    this.pairingKeys = new Map();
    this.trustedDevices = new Map();
    this.knownDevices = new Map();
    this.guestShares = new Map();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(this.filesDir, { recursive: true });
    await mkdir(this.guestDir, { recursive: true });
    await this.loadState();
  }

  async loadState() {
    try {
      const raw = await readFile(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw);
      this.settings = {
        ...structuredClone(DEFAULT_SETTINGS),
        ...(parsed.settings ?? {}),
      };
      this.clipboard = {
        ...this.emptyClipboard(),
        ...(parsed.clipboard ?? {}),
      };
      this.sessions = new Map(Object.entries(parsed.sessions ?? {}));
      this.uploads = new Map(Object.entries(parsed.uploads ?? {}));
      this.trustedDevices = new Map(Object.entries(parsed.trustedDevices ?? {}));
      this.knownDevices = new Map(Object.entries(parsed.knownDevices ?? {}));
      this.guestShares = new Map(Object.entries(parsed.guestShares ?? {}));
      this.rebuildFileIndex();
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    await this.persist();
  }

  // ─── Settings ─────────────────────────────────────────────

  getSettings() {
    return this.publicSettings();
  }

  async updateSettings(patch) {
    const allowed = [
      'deviceName',
      'deviceIcon',
      'preferredMode',
      'downloadFolder',
      'connectionMode',
      'autoCloseAfterDownload',
      'autoAcceptTrusted',
      'onboardingComplete',
      'watchFolders',
    ];
    for (const key of allowed) {
      if (!(key in patch)) continue;
      if (key === 'deviceIcon') {
        this.settings.deviceIcon = sanitizeDeviceIcon(patch.deviceIcon) ?? DEFAULT_SETTINGS.deviceIcon;
        continue;
      }
      if (key === 'watchFolders') {
        this.settings.watchFolders = Array.isArray(patch.watchFolders) ? patch.watchFolders.slice(0, 16) : [];
        continue;
      }
      this.settings[key] = patch[key];
    }

    this.settings.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('settings-updated', { settings: this.getSettings() });
    return this.getSettings();
  }

  // ─── Clipboard ────────────────────────────────────────────

  getClipboard() {
    return structuredClone(this.clipboard);
  }

  async updateClipboard(patch = {}) {
    this.clipboard = {
      text: typeof patch.text === 'string' ? patch.text.slice(0, 200_000) : '',
      updatedAt: new Date().toISOString(),
      sourceDeviceName: sanitizeText(patch.sourceDeviceName) ?? null,
      sourceRole: patch.sourceRole === 'phone' ? 'phone' : 'desktop',
    };
    await this.persist();
    this.broadcast('clipboard-updated', { clipboard: this.getClipboard() });
    return this.getClipboard();
  }

  // ─── Sessions ─────────────────────────────────────────────

  async createSession(input = {}) {
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const pairingOrigin = normalizeOrigin(input.origin ?? this.settings.publicOrigin);
    const backendOrigin = rewriteLoopbackToLan(normalizeOrigin(input.backendOrigin ?? defaultBackendOrigin()));
    const ticket = await createPairingTicket({
      backendOrigin,
      pairingOrigin,
      sessionId,
      transport: input.mode ?? this.settings.preferredMode,
      ttlMs: QR_TTL_MS,
    });
    const expiresAt = new Date(Date.now() + QR_TTL_MS).toISOString();
    const session = {
      id: sessionId,
      mode: input.mode ?? this.settings.preferredMode,
      state: SESSION_STATES.pairing,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      closedAt: null,
      multiDevice: Boolean(input.multiDevice),
      maxDevices: Number(input.maxDevices) || (input.multiDevice ? 4 : 1),
      localDevice: {
        name: input.deviceName ?? this.settings.deviceName,
        role: 'desktop',
        platform: process.platform,
        icon: sanitizeDeviceIcon(input.deviceIcon) ?? sanitizeDeviceIcon(this.settings.deviceIcon) ?? 'desktop',
      },
      peerDevice: null,
      pairing: {
        guestAllowed: false,
        encrypted: false,
        pairingUrl: ticket.pairingUrl,
        qrPayload: ticket.payload,
        verifiedAt: null,
        acceptedAt: null,
        attempts: 0,
      },
      pendingRequest: null,
      pendingTransfers: [],
      files: { 'desktop-to-phone': [], 'phone-to-desktop': [] },
      queue: this.emptyQueue(),
      summary: this.emptySummary(),
      closedReason: null,
      eventCount: 0,
    };

    this.pairingKeys.set(sessionId, { privateKey: ticket.privateKey, publicKey: ticket.publicKey });
    this.sessions.set(sessionId, session);
    await this.persist();
    this.broadcast('session-created', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  async regenerateSession(sessionId) {
    const session = this.requireSession(sessionId);
    if ([SESSION_STATES.closed, SESSION_STATES.completed].includes(session.state)) {
      throw httpError(409, 'session is closed');
    }
    const ticket = await createPairingTicket({
      backendOrigin: session.pairing.qrPayload?.host
        ? `http://${session.pairing.qrPayload.host}:${session.pairing.qrPayload.port}`
        : 'http://127.0.0.1:17619',
      pairingOrigin: this.settings.publicOrigin,
      sessionId,
      transport: session.mode,
      ttlMs: QR_TTL_MS,
    });
    session.pairing.pairingUrl = ticket.pairingUrl;
    session.pairing.qrPayload = ticket.payload;
    session.pairing.attempts = 0;
    session.expiresAt = new Date(Date.now() + QR_TTL_MS).toISOString();
    session.state = SESSION_STATES.pairing;
    session.pendingRequest = null;
    this.pairingKeys.set(sessionId, { privateKey: ticket.privateKey, publicKey: ticket.publicKey });
    await this.persist();
    this.broadcast('session-updated', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  listSessions() {
    return this.sortedSessions().map((session) => this.publicSession(session));
  }

  getSession(sessionId) {
    return this.publicSession(this.requireSession(sessionId));
  }

  // Phone scans QR and signals "I want to connect". Creates a pending request.
  async requestConnect(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    this.assertNotExpired(session);
    if (![SESSION_STATES.pairing, SESSION_STATES.awaitingAccept].includes(session.state)) {
      throw httpError(409, 'session is not awaiting a connection');
    }

    const now = new Date().toISOString();
    const peerFingerprint = createDeviceFingerprint(input.deviceName ?? 'Phone', input.platform ?? 'ios');
    session.pendingRequest = {
      id: randomUUID(),
      requestedAt: now,
      peer: {
        name: input.deviceName ?? 'Phone',
        platform: input.platform ?? 'ios',
        transport: input.transport ?? session.mode,
        icon: sanitizeDeviceIcon(input.deviceIcon) ?? inferDeviceIcon(input.platform),
        address: input.address ?? null,
        fingerprint: peerFingerprint,
      },
      remotePublicKey: typeof input.remotePublicKey === 'string' ? input.remotePublicKey.trim() : null,
    };
    session.state = SESSION_STATES.awaitingAccept;
    session.updatedAt = now;

    // Auto-accept if device is trusted and policy enabled
    const trusted = this.trustedDevices.get(peerFingerprint);
    if (this.settings.autoAcceptTrusted && trusted) {
      return this.acceptSession(sessionId);
    }

    await this.persist();
    this.broadcast('session-connect-requested', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  // Receiver (desktop) accepts the pending connect request → session becomes paired.
  async acceptSession(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    if (session.state !== SESSION_STATES.awaitingAccept || !session.pendingRequest) {
      throw httpError(409, 'no pending connection to accept');
    }

    const now = new Date().toISOString();
    const peer = session.pendingRequest.peer;
    const remotePublicKey = session.pendingRequest.remotePublicKey;

    session.peerDevice = peer;
    session.pairing.verifiedAt = now;
    session.pairing.acceptedAt = now;
    session.pairing.encrypted = false;
    session.state = SESSION_STATES.paired;
    session.updatedAt = now;
    session.pendingRequest = null;

    if (remotePublicKey) {
      const pairingKey = this.pairingKeys.get(sessionId);
      if (pairingKey?.privateKey) {
        const sessionSecret = await deriveSessionSecret({
          privateKey: pairingKey.privateKey,
          remotePublicKey,
          sessionId,
        });
        this.sessionSecrets.set(sessionId, sessionSecret);
        session.pairing.encrypted = true;
      }
    }

    // Track in known devices for reconnect feature
    if (peer.fingerprint) {
      this.knownDevices.set(peer.fingerprint, {
        fingerprint: peer.fingerprint,
        name: peer.name,
        platform: peer.platform,
        icon: peer.icon,
        lastSeenAt: now,
      });
      if (input.trust) {
        this.trustedDevices.set(peer.fingerprint, {
          fingerprint: peer.fingerprint,
          name: peer.name,
          platform: peer.platform,
          trustedAt: now,
          autoAccept: true,
        });
      }
    }

    session.summary = this.buildSummary(session);
    await this.persist();
    this.broadcast('session-paired', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  async declineSession(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    if (session.state !== SESSION_STATES.awaitingAccept) {
      throw httpError(409, 'no pending request to decline');
    }
    const now = new Date().toISOString();
    session.state = SESSION_STATES.failed;
    session.closedAt = now;
    session.updatedAt = now;
    session.closedReason = input.reason ?? 'declined';
    session.pendingRequest = null;
    await this.persist();
    this.broadcast('session-declined', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  // Legacy pair endpoint kept for backwards compatibility — same as requestConnect + acceptSession when no trust gate.
  async pairSession(sessionId, input = {}) {
    await this.requestConnect(sessionId, input);
    return this.acceptSession(sessionId, input);
  }

  async closeSession(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    const now = new Date().toISOString();
    const hasFiles = this.countFiles(session) > 0;
    session.state = hasFiles ? SESSION_STATES.completed : SESSION_STATES.closed;
    session.updatedAt = now;
    session.closedAt = now;
    session.closedReason = input.reason ?? null;
    session.summary = this.buildSummary(session);
    await this.persist();
    this.broadcast('session-closed', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  // ─── Pending transfers (accept-some flow) ────────────────

  async requestTransferBatch(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    if (![SESSION_STATES.paired, SESSION_STATES.transferring].includes(session.state)) {
      throw httpError(409, 'session is not paired');
    }
    const files = Array.isArray(input.files) ? input.files : [];
    if (!files.length) throw httpError(400, 'files are required');

    const batch = {
      id: randomUUID(),
      direction: this.requireDirection(input.direction ?? 'desktop-to-phone'),
      sourceDeviceName: sanitizeText(input.deviceName) ?? null,
      requestedAt: new Date().toISOString(),
      files: files.map((file) => ({
        id: randomUUID(),
        name: sanitizeFileName(file.name),
        size: Number(file.size) || 0,
        mimeType: sanitizeContentType(file.mimeType),
        relativePath: sanitizeRelativePath(file.relativePath, file.name),
        lastModified: Number.isFinite(Number(file.lastModified)) ? Number(file.lastModified) : null,
      })),
    };

    session.pendingTransfers = session.pendingTransfers ?? [];
    session.pendingTransfers.push(batch);
    session.updatedAt = batch.requestedAt;

    await this.persist();
    this.broadcast('transfer-requested', { sessionId, batch });
    return batch;
  }

  async acceptTransferBatch(sessionId, batchId, input = {}) {
    const session = this.requireSession(sessionId);
    const batches = session.pendingTransfers ?? [];
    const idx = batches.findIndex((b) => b.id === batchId);
    if (idx === -1) throw httpError(404, 'transfer batch not found');
    const acceptedIds = Array.isArray(input.fileIds) && input.fileIds.length
      ? new Set(input.fileIds)
      : null;
    const batch = batches[idx];
    const accepted = batch.files.filter((file) => !acceptedIds || acceptedIds.has(file.id));
    batches.splice(idx, 1);
    session.pendingTransfers = batches;
    session.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('transfer-accepted', { sessionId, batchId, fileIds: accepted.map((f) => f.id) });
    return { batchId, accepted: accepted.map((f) => f.id) };
  }

  async declineTransferBatch(sessionId, batchId, input = {}) {
    const session = this.requireSession(sessionId);
    const batches = session.pendingTransfers ?? [];
    const idx = batches.findIndex((b) => b.id === batchId);
    if (idx === -1) throw httpError(404, 'transfer batch not found');
    batches.splice(idx, 1);
    session.pendingTransfers = batches;
    session.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('transfer-declined', { sessionId, batchId, reason: input.reason ?? null });
    return { batchId };
  }

  // ─── Trusted / known devices ──────────────────────────────

  listTrustedDevices() {
    return [...this.trustedDevices.values()];
  }

  listKnownDevices() {
    return [...this.knownDevices.values()].sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
  }

  async setTrustedDevice(fingerprint, patch = {}) {
    const existing = this.trustedDevices.get(fingerprint) ?? { fingerprint };
    const next = {
      ...existing,
      ...patch,
      fingerprint,
      trustedAt: existing.trustedAt ?? new Date().toISOString(),
      autoAccept: patch.autoAccept ?? existing.autoAccept ?? true,
    };
    this.trustedDevices.set(fingerprint, next);
    await this.persist();
    this.broadcast('trusted-updated', { trustedDevices: this.listTrustedDevices() });
    return next;
  }

  async removeTrustedDevice(fingerprint) {
    this.trustedDevices.delete(fingerprint);
    await this.persist();
    this.broadcast('trusted-updated', { trustedDevices: this.listTrustedDevices() });
    return { ok: true };
  }

  // ─── Guest mode ───────────────────────────────────────────

  // LAN-routable origin (http://192.168.x.x:17619) for clients that need to share URLs
  // with phones / other devices on the network.
  lanOrigin() {
    const lan = pickLanIPv4();
    const port = process.env.DROPBEAM_BACKEND_PORT ?? '17619';
    return lan ? `http://${lan}:${port}` : null;
  }

  async createGuestShare(input = {}) {
    const id = randomUUID();
    const token = randomUUID().replace(/-/g, '').slice(0, 20);
    const ttlMs = Number(input.ttlMs) || GUEST_TTL_MS;
    const maxUses = Number(input.maxUses) || 1;
    // Optional human-readable label for the sharer, displayed in the guest browser. We never
    // fabricate one — if neither the request nor the device settings provides a name, the
    // guest page renders without it. Trusts the caller to supply a real device name only.
    const sharerName = sanitizeText(input.sharerName) ?? sanitizeText(this.settings?.deviceName) ?? null;
    const share = {
      id,
      token,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      maxUses,
      uses: 0,
      files: [],
      sharerName,
    };
    this.guestShares.set(token, share);
    await this.persist();
    return share;
  }

  async addGuestFile(token, file, requestStream) {
    const share = this.guestShares.get(token);
    if (!share) throw httpError(404, 'share not found');
    const id = randomUUID();
    const storagePath = join(this.guestDir, `${id}.bin`);
    await mkdir(dirname(storagePath), { recursive: true });
    const dest = createWriteStream(storagePath);
    const counter = new ByteCounterStream();
    await pipeline(requestStream, counter, dest);
    const record = {
      id,
      name: sanitizeFileName(file.name ?? 'file.bin'),
      size: counter.bytesWritten,
      mimeType: sanitizeContentType(file.mimeType ?? 'application/octet-stream'),
      storagePath: relativeToData(this.dataDir, storagePath),
      addedAt: new Date().toISOString(),
    };
    share.files.push(record);
    await this.persist();
    return record;
  }

  getGuestShare(token) {
    const share = this.guestShares.get(token);
    if (!share) return null;
    if (new Date(share.expiresAt).getTime() < Date.now()) {
      this.guestShares.delete(token);
      return null;
    }
    if (share.uses >= share.maxUses) {
      return null;
    }
    return share;
  }

  async incrementGuestUse(token) {
    const share = this.guestShares.get(token);
    if (!share) return;
    share.uses += 1;
    await this.persist();
  }

  guestFilePath(token, fileId) {
    const share = this.getGuestShare(token);
    if (!share) return null;
    const file = share.files.find((f) => f.id === fileId);
    if (!file) return null;
    return { share, file, path: resolve(this.dataDir, file.storagePath) };
  }

  // ─── Uploads & files ──────────────────────────────────────

  listFiles(sessionId, direction) {
    const session = this.requireSession(sessionId);
    const normalizedDirection = this.requireDirection(direction);
    return {
      sessionId: session.id,
      direction: normalizedDirection,
      files: session.files[normalizedDirection].map((file) => this.publicFile(file)),
    };
  }

  getUpload(uploadId) {
    return this.publicUpload(this.requireUpload(uploadId));
  }

  getLocalDiscoveryDevice() {
    return {
      id: `dropbeam:${sanitizeText(this.settings.deviceName) ?? 'desktop'}:${process.pid}`,
      name: this.settings.deviceName,
      icon: sanitizeDeviceIcon(this.settings.deviceIcon) ?? 'desktop',
      platform: process.platform,
    };
  }

  async startUpload(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    if (![SESSION_STATES.paired, SESSION_STATES.transferring].includes(session.state)) {
      throw httpError(409, 'session must be paired before uploads can start');
    }

    const direction = this.requireDirection(input.direction);
    const name = sanitizeFileName(input.name);
    const relativePath = sanitizeRelativePath(input.relativePath, name);
    const mimeType = sanitizeContentType(input.mimeType);
    const sourceDeviceName = sanitizeText(input.deviceName) ?? null;
    const size = sanitizePositiveNumber(input.size, 'size');
    const chunkSize = sanitizeChunkSize(input.chunkSize);
    const totalChunks = Math.max(1, Number.isFinite(Number(input.totalChunks)) ? Number(input.totalChunks) : Math.ceil(size / chunkSize));
    const lastModified = Number.isFinite(Number(input.lastModified)) ? Number(input.lastModified) : null;
    const fingerprint = createUploadFingerprint({
      sessionId,
      direction,
      name,
      relativePath,
      size,
      lastModified,
      sourceDeviceName,
    });

    const existing = [...this.uploads.values()].find(
      (upload) => upload.status === 'pending' && upload.fingerprint === fingerprint,
    );
    if (existing) {
      // Resume: just return the existing upload pointer so the client picks up at nextChunk.
      return this.publicUpload(existing);
    }

    const now = new Date().toISOString();
    const uploadId = randomUUID();
    const fileRoot = join(this.filesDir, uploadId);
    const tempPath = join(fileRoot, 'upload.bin.part');
    await mkdir(fileRoot, { recursive: true });

    const upload = {
      id: uploadId,
      fingerprint,
      sessionId,
      direction,
      name,
      relativePath,
      mimeType,
      size,
      chunkSize,
      totalChunks,
      nextChunk: 0,
      uploadedBytes: 0,
      lastModified,
      sourceDeviceName,
      tempPath: relativeToData(this.dataDir, tempPath),
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      averageBytesPerSecond: null,
      status: 'pending',
    };

    this.uploads.set(uploadId, upload);
    await this.persist();
    this.broadcast('upload-started', { upload: this.publicUpload(upload) });
    return this.publicUpload(upload);
  }

  async receiveUploadChunk(uploadId, chunkIndex, request) {
    const upload = this.requireUpload(uploadId);
    if (upload.status !== 'pending') {
      await drainRequest(request);
      throw httpError(409, 'upload is no longer writable');
    }
    if (chunkIndex < upload.nextChunk) {
      await drainRequest(request);
      return this.publicUpload(upload);
    }
    if (chunkIndex > upload.nextChunk) {
      await drainRequest(request);
      throw httpError(409, `chunk ${chunkIndex} cannot be accepted before chunk ${upload.nextChunk}`);
    }

    const destinationPath = resolve(this.dataDir, upload.tempPath);
    await mkdir(dirname(destinationPath), { recursive: true });
    const contentType = String(request.headers?.['content-type'] ?? '');
    const bytesWritten = contentType.includes('application/json')
      ? await this.receiveEncryptedChunk(upload, chunkIndex, request, destinationPath)
      : await this.receivePlainChunk(request, destinationPath);

    upload.uploadedBytes += bytesWritten;
    upload.nextChunk += 1;
    upload.updatedAt = new Date().toISOString();
    upload.averageBytesPerSecond = calculateAverageBytesPerSecond(upload.startedAt, upload.uploadedBytes);

    await this.persist();
    this.broadcast('upload-progress', { upload: this.publicUpload(upload) });
    return this.publicUpload(upload);
  }

  async completeUpload(uploadId) {
    const upload = this.requireUpload(uploadId);
    if (upload.status !== 'pending') throw httpError(409, 'upload is already finalized');
    if (upload.uploadedBytes < upload.size || upload.nextChunk < upload.totalChunks) {
      throw httpError(409, 'upload is incomplete and cannot be finalized');
    }

    const session = this.requireSession(upload.sessionId);
    const now = new Date().toISOString();
    const fileRoot = join(this.filesDir, upload.id);
    const tempPath = resolve(this.dataDir, upload.tempPath);
    const storagePath = join(fileRoot, 'blob');
    const metaPath = join(fileRoot, 'meta.json');
    await access(tempPath);
    const checksum = await hashFile(tempPath);
    await rename(tempPath, storagePath);

    const record = {
      id: upload.id,
      sessionId: upload.sessionId,
      direction: upload.direction,
      name: upload.name,
      relativePath: upload.relativePath,
      mimeType: upload.mimeType,
      size: upload.size,
      checksum,
      lastModified: upload.lastModified,
      sourceDeviceName: upload.sourceDeviceName,
      createdAt: upload.createdAt,
      uploadedAt: now,
      downloadedAt: null,
      status: 'ready',
      storagePath: relativeToData(this.dataDir, storagePath),
      metaPath: relativeToData(this.dataDir, metaPath),
      downloadUrl: `/api/files/${upload.id}/download`,
      averageBytesPerSecond: upload.averageBytesPerSecond,
      durationMs: calculateDurationMs(upload.startedAt, now),
    };

    await writeJson(metaPath, { ...record, storagePath: record.storagePath, metaPath: record.metaPath });

    session.files[upload.direction].push(record);
    session.state = SESSION_STATES.transferring;
    session.updatedAt = now;
    session.summary = this.buildSummary(session);
    session.queue = this.buildQueue(session);
    session.eventCount += 1;

    upload.status = 'complete';
    upload.completedAt = now;
    upload.updatedAt = now;

    this.fileIndex.set(upload.id, { sessionId: upload.sessionId, direction: upload.direction, record });
    this.uploads.delete(upload.id);
    await this.persist();
    this.broadcast('file-uploaded', {
      session: this.publicSession(session),
      file: this.publicFile(record),
    });
    return this.publicFile(record);
  }

  async downloadFile(fileId) {
    const entry = this.fileIndex.get(fileId);
    if (!entry) throw httpError(404, 'file not found');
    const session = this.requireSession(entry.sessionId);
    const file = session.files[entry.direction].find((item) => item.id === fileId);
    if (!file) throw httpError(404, 'file not found');
    await this.markFileDownloaded(session, file);
    return { file: this.publicFile(file), path: resolve(this.dataDir, file.storagePath) };
  }

  async downloadSecureFile(fileId, sessionId) {
    const entry = this.fileIndex.get(fileId);
    if (!entry || entry.sessionId !== sessionId) throw httpError(404, 'file not found');
    const session = this.requireSession(entry.sessionId);
    const file = session.files[entry.direction].find((item) => item.id === fileId);
    if (!file) throw httpError(404, 'file not found');
    const sessionSecret = this.sessionSecrets.get(sessionId);
    if (!sessionSecret) throw httpError(409, 'session encryption key is not available');
    const plaintext = new Uint8Array(await readFile(resolve(this.dataDir, file.storagePath)));
    const payload = await encryptTransferBuffer({
      chunkIndex: 0,
      fileId,
      plaintext,
      rawKey: sessionSecret.rawKey,
      sessionId,
    });
    await this.markFileDownloaded(session, file);
    return {
      file: this.publicFile(file),
      encrypted: true,
      keyId: sessionSecret.keyId,
      algorithm: sessionSecret.algorithm,
      payload,
    };
  }

  // ─── Dashboard / history ──────────────────────────────────

  getDashboard() {
    this.pruneExpiredSessions();
    const sessions = this.sortedSessions();
    const activeSessions = sessions.filter((s) => !['closed', 'completed', 'failed'].includes(s.state));
    const history = sessions.filter((s) => ['closed', 'completed', 'failed'].includes(s.state));
    const totals = sessions.reduce(
      (acc, s) => {
        acc.sessions += 1;
        acc.files += this.countFiles(s);
        acc.bytes += s.summary.totalBytes;
        if (s.state === SESSION_STATES.paired) acc.paired += 1;
        if (s.state === SESSION_STATES.transferring) acc.transferring += 1;
        if (s.state === SESSION_STATES.completed) acc.completed += 1;
        if (s.state === SESSION_STATES.awaitingAccept) acc.pending += 1;
        return acc;
      },
      { sessions: 0, files: 0, bytes: 0, paired: 0, transferring: 0, completed: 0, pending: 0 },
    );

    return {
      settings: this.getSettings(),
      clipboard: this.getClipboard(),
      activeUploads: [...this.uploads.values()]
        .map((u) => this.publicUpload(u))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      totals,
      activeSessions: activeSessions.map((s) => this.publicSession(s)),
      history: history.slice(0, 20).map((s) => this.publicSession(s)),
      trustedDevices: this.listTrustedDevices(),
      knownDevices: this.listKnownDevices(),
      guestShares: [...this.guestShares.values()].map((s) => ({ ...s, files: s.files.length })),
    };
  }

  getHistory(query = '') {
    const normalized = sanitizeSearchQuery(query);
    return this.sortedSessions()
      .filter((s) => ['closed', 'completed', 'failed'].includes(s.state))
      .filter((s) => this.matchesHistoryQuery(s, normalized))
      .map((s) => this.sessionHistoryEntry(s));
  }

  // ─── Persistence ──────────────────────────────────────────

  async persist() {
    const snapshot = {
      version: 2,
      settings: this.settings,
      clipboard: this.clipboard,
      sessions: Object.fromEntries(
        [...this.sessions.entries()].map(([id, s]) => [id, this.persistedSession(s)]),
      ),
      uploads: Object.fromEntries([...this.uploads.entries()].map(([id, u]) => [id, u])),
      trustedDevices: Object.fromEntries(this.trustedDevices),
      knownDevices: Object.fromEntries(this.knownDevices),
      guestShares: Object.fromEntries(this.guestShares),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(this.stateFile, snapshot);
  }

  rebuildFileIndex() {
    this.fileIndex.clear();
    for (const session of this.sessions.values()) {
      for (const direction of DIRECTION_VALUES) {
        for (const file of session.files?.[direction] ?? []) {
          this.fileIndex.set(file.id, { sessionId: session.id, direction, record: file });
        }
      }
      session.summary = this.buildSummary(session);
      session.queue = this.buildQueue(session);
    }
  }

  pruneExpiredSessions() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (
        session.expiresAt &&
        session.state === SESSION_STATES.pairing &&
        new Date(session.expiresAt).getTime() < now
      ) {
        session.state = SESSION_STATES.failed;
        session.closedReason = 'expired';
        session.closedAt = new Date().toISOString();
      }
    }
  }

  assertNotExpired(session) {
    if (
      session.expiresAt &&
      session.state === SESSION_STATES.pairing &&
      new Date(session.expiresAt).getTime() < Date.now()
    ) {
      throw httpError(410, 'session QR has expired');
    }
  }

  requireSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) throw httpError(404, `session ${sessionId} not found`);
    return s;
  }

  requireDirection(direction) {
    if (!DIRECTION_VALUES.has(direction)) {
      throw httpError(400, 'direction must be desktop-to-phone or phone-to-desktop');
    }
    return direction;
  }

  requireUpload(uploadId) {
    const u = this.uploads.get(uploadId);
    if (!u) throw httpError(404, `upload ${uploadId} not found`);
    return u;
  }

  // ─── Public projections ───────────────────────────────────

  publicSession(session) {
    return structuredClone({
      ...session,
      localDevice: this.publicDevice(session.localDevice, 'desktop'),
      peerDevice: session.peerDevice ? this.publicDevice(session.peerDevice, 'phone') : session.peerDevice,
      pairing: {
        ticket: {
          sessionId: session.id,
          qrValue: session.pairing.pairingUrl,
          pairingUrl: session.pairing.pairingUrl,
          expiresAt: session.expiresAt,
        },
        encrypted: Boolean(session.pairing.encrypted),
        verifiedAt: session.pairing.verifiedAt ?? null,
        acceptedAt: session.pairing.acceptedAt ?? null,
      },
      pendingRequest: session.pendingRequest ?? null,
      pendingTransfers: session.pendingTransfers ?? [],
      summary: this.buildSummary(session),
      queue: this.buildQueue(session),
      files: {
        'desktop-to-phone': session.files['desktop-to-phone'].map((f) => this.publicFile(f)),
        'phone-to-desktop': session.files['phone-to-desktop'].map((f) => this.publicFile(f)),
      },
    });
  }

  publicFile(file) {
    const { storagePath, metaPath, ...rest } = file;
    return structuredClone(rest);
  }

  publicUpload(upload) {
    const { fingerprint, tempPath, lastModified, sourceDeviceName, completedAt, startedAt, ...rest } = upload;
    return structuredClone({
      ...rest,
      relativePath: upload.relativePath ?? null,
      sourceDeviceName,
      lastModified,
      completedAt,
      startedAt,
      progressPercent: upload.size > 0
        ? Math.max(0, Math.min(100, Math.round((upload.uploadedBytes / upload.size) * 100)))
        : 0,
    });
  }

  publicSettings() {
    const { publicOrigin, ...rest } = this.settings;
    return structuredClone(rest);
  }

  publicDevice(device, fallbackIcon) {
    if (!device) return device;
    return { ...device, icon: sanitizeDeviceIcon(device.icon) ?? fallbackIcon };
  }

  persistedSession(session) {
    return structuredClone({
      ...session,
      files: {
        'desktop-to-phone': session.files['desktop-to-phone'],
        'phone-to-desktop': session.files['phone-to-desktop'],
      },
    });
  }

  sessionHistoryEntry(session) {
    return {
      id: session.id,
      mode: session.mode,
      state: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      closedAt: session.closedAt,
      localDevice: this.publicDevice(session.localDevice, 'desktop'),
      peerDevice: session.peerDevice ? this.publicDevice(session.peerDevice, 'phone') : session.peerDevice,
      summary: this.buildSummary(session),
      fileCount: this.countFiles(session),
      files: this.allFiles(session).map((f) => this.publicFile(f)),
    };
  }

  buildSummary(session) {
    const files = this.allFiles(session);
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    const completedFiles = files.filter((f) => f.status === 'downloaded').length;
    const completedBytes = files.filter((f) => f.status === 'downloaded').reduce((s, f) => s + f.size, 0);
    return {
      totalFiles: files.length,
      completedFiles,
      totalBytes,
      completedBytes,
      state: session.state,
      pairedAt: session.pairing.verifiedAt,
      closedAt: session.closedAt,
    };
  }

  buildQueue(session) {
    const items = this.allFiles(session).map((f) => ({
      id: f.id,
      name: f.name,
      relativePath: f.relativePath ?? null,
      direction: f.direction,
      status: f.status,
      size: f.size,
      progress: f.status === 'downloaded' ? 100 : 0,
    }));
    return {
      items,
      totalFiles: items.length,
      completedFiles: items.filter((i) => i.status === 'downloaded').length,
      totalBytes: items.reduce((s, i) => s + i.size, 0),
    };
  }

  countFiles(session) {
    return this.allFiles(session).length;
  }

  matchesHistoryQuery(session, normalized) {
    if (!normalized) return true;
    const hay = [
      session.id,
      session.localDevice?.name,
      session.peerDevice?.name,
      session.peerDevice?.platform,
      ...this.allFiles(session).flatMap((f) => [f.name, f.relativePath, f.sourceDeviceName]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(normalized);
  }

  allFiles(session) {
    return [...session.files['desktop-to-phone'], ...session.files['phone-to-desktop']];
  }

  sortedSessions() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  broadcast(type, payload) {
    if (typeof this.emit === 'function') this.emit(type, payload);
  }

  emptyQueue() {
    return { items: [], totalFiles: 0, completedFiles: 0, totalBytes: 0 };
  }

  emptySummary() {
    return {
      totalFiles: 0,
      completedFiles: 0,
      totalBytes: 0,
      completedBytes: 0,
      state: SESSION_STATES.pairing,
      pairedAt: null,
      closedAt: null,
    };
  }

  emptyClipboard() {
    return { text: '', updatedAt: null, sourceDeviceName: null, sourceRole: null };
  }

  async receivePlainChunk(request, destinationPath) {
    const counter = new ByteCounterStream();
    const target = createWriteStream(destinationPath, { flags: 'a' });
    await pipeline(request, counter, target);
    return counter.bytesWritten;
  }

  async receiveEncryptedChunk(upload, requestChunkIndex, request, destinationPath) {
    const body = await readJson(request);
    if (!body?.encrypted || !body?.chunk) throw httpError(400, 'encrypted upload chunk payload is invalid');
    const sessionSecret = this.sessionSecrets.get(upload.sessionId);
    if (!sessionSecret) throw httpError(409, 'session encryption key is not available');
    const plaintext = await decryptTransferChunk({
      chunk: body.chunk,
      fileId: body.fileId ?? upload.id,
      rawKey: sessionSecret.rawKey,
      sessionId: upload.sessionId,
    });
    if (body.chunk.chunkIndex !== requestChunkIndex) {
      throw httpError(409, 'encrypted chunk index did not match the upload slot');
    }
    await appendFile(destinationPath, Buffer.from(plaintext));
    return plaintext.byteLength;
  }

  async markFileDownloaded(session, file) {
    if (file.downloadedAt) return;
    file.downloadedAt = new Date().toISOString();
    file.status = 'downloaded';
    session.updatedAt = file.downloadedAt;
    session.summary = this.buildSummary(session);
    session.queue = this.buildQueue(session);
    if (
      this.settings.autoCloseAfterDownload &&
      session.summary.totalFiles > 0 &&
      session.summary.completedFiles === session.summary.totalFiles
    ) {
      session.state = SESSION_STATES.completed;
      session.closedAt = file.downloadedAt;
      session.summary = this.buildSummary(session);
    }
    await this.persist();
    this.broadcast('file-downloaded', {
      session: this.publicSession(session),
      file: this.publicFile(file),
    });
  }
}

class ByteCounterStream extends Transform {
  constructor() {
    super();
    this.bytesWritten = 0;
  }
  _transform(chunk, _encoding, cb) {
    this.bytesWritten += chunk.length;
    cb(null, chunk);
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

function sanitizeFileName(value) {
  const candidate = sanitizeText(value) ?? 'incoming.bin';
  const normalized = candidate.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  return normalized || 'incoming.bin';
}

function sanitizeContentType(value) {
  return sanitizeText(value) || 'application/octet-stream';
}

function sanitizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sanitizeRelativePath(value, fallbackName) {
  const candidate = sanitizeText(value);
  if (!candidate) return null;
  const normalized = candidate
    .split(/[\\/]+/)
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => seg.replace(/[<>:"|?*]/g, '_'))
    .filter((seg) => seg !== '.' && seg !== '..');
  if (!normalized.length) return fallbackName ?? null;
  return normalized.join('/');
}

function sanitizeSearchQuery(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sanitizeDeviceIcon(value) {
  return ['desktop', 'laptop', 'phone', 'tablet'].includes(value) ? value : null;
}

function sanitizePositiveNumber(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, `${fieldName} must be a non-negative number`);
  return n;
}

function sanitizeChunkSize(value) {
  const n = sanitizePositiveNumber(value, 'chunkSize');
  if (n <= 0) throw httpError(400, 'chunkSize must be greater than zero');
  return Math.min(Math.max(Math.floor(n), 64 * 1024), 8 * 1024 * 1024);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return 'http://127.0.0.1:17619';
  return value.replace(/\/+$/, '');
}

// Replace 127.0.0.1 / localhost in an origin URL with the host's LAN IP so QR codes
// generated by the desktop point at an address the phone can actually reach.
function rewriteLoopbackToLan(origin) {
  if (typeof origin !== 'string' || !origin) return origin;
  try {
    const url = new URL(origin);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') {
      const lan = pickLanIPv4();
      if (lan) {
        url.hostname = lan;
        return url.toString().replace(/\/+$/, '');
      }
    }
    return origin;
  } catch {
    return origin;
  }
}

function pickLanIPv4() {
  return listLanIPv4()[0] ?? null;
}

// Return all non-loopback IPv4 addresses sorted with the most likely physical Wi-Fi/Ethernet
// adapter first. VMware / Hyper-V / WSL virtual adapters (192.168.x where x is large like 193)
// and adapter names containing "Virtual", "VMware", "Hyper-V", "WSL", "VPN" are deprioritized.
function listLanIPv4() {
  try {
    const interfaces = networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(interfaces)) {
      const lowerName = name.toLowerCase();
      const isVirtual = /(virtual|vmware|hyper-?v|wsl|vpn|loopback|vethernet)/i.test(lowerName);
      for (const iface of interfaces[name] ?? []) {
        if (iface.family !== 'IPv4' || iface.internal || !iface.address) continue;
        // Subnet preference: 192.168.0/1.x are typical home routers; 10.x corporate;
        // 172.16-31 less common; everything else lower.
        let subnetScore = 9;
        const m = iface.address.match(/^192\.168\.(\d+)\./);
        if (m) {
          const second = Number(m[1]);
          // 192.168.0 and 192.168.1 are the canonical home subnets — strongly prefer.
          subnetScore = second === 0 || second === 1 ? 0 : second < 10 ? 1 : 5;
        } else if (/^10\./.test(iface.address)) {
          subnetScore = 2;
        } else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(iface.address)) {
          subnetScore = 3;
        }
        candidates.push({
          address: iface.address,
          name,
          isVirtual,
          priority: (isVirtual ? 100 : 0) + subnetScore,
        });
      }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.map((c) => c.address);
  } catch {
    return [];
  }
}

// Pick the first non-loopback IPv4 LAN address so QR codes contain a URL the phone can actually reach.
// Falls back to 127.0.0.1 if no LAN address is available (e.g. fully offline).
function defaultBackendOrigin() {
  const port = process.env.DROPBEAM_BACKEND_PORT ?? '17619';
  try {
    const interfaces = networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal && iface.address) {
          // Prefer common private LAN ranges first
          const priority = /^192\.168\./.test(iface.address)
            ? 0
            : /^10\./.test(iface.address)
              ? 1
              : /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(iface.address)
                ? 2
                : 3;
          candidates.push({ address: iface.address, priority });
        }
      }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    if (candidates.length > 0) {
      return `http://${candidates[0].address}:${port}`;
    }
  } catch {
    // Fall through to loopback.
  }
  return `http://127.0.0.1:${port}`;
}

async function drainRequest(request) {
  // eslint-disable-next-line no-unused-vars
  for await (const _chunk of request) {}
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

async function hashFile(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

function createUploadFingerprint(input) {
  return [
    input.sessionId,
    input.direction,
    input.name,
    input.relativePath ?? '',
    input.size,
    input.lastModified ?? '',
    input.sourceDeviceName ?? '',
  ].join('::');
}

function createDeviceFingerprint(name, platform) {
  return `${platform ?? 'unknown'}:${(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function inferDeviceIcon(value) {
  switch (value) {
    case 'iphone':
    case 'ios':
    case 'android':
    case 'phone':
      return 'phone';
    case 'ipad':
    case 'tablet':
      return 'tablet';
    case 'macos':
    case 'windows':
    case 'linux':
      return 'laptop';
    default:
      return 'phone';
  }
}

function calculateDurationMs(startedAt, endedAt = new Date().toISOString()) {
  const a = new Date(startedAt).getTime();
  const b = new Date(endedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return b - a;
}

function calculateAverageBytesPerSecond(startedAt, bytes) {
  const ms = calculateDurationMs(startedAt);
  if (!ms || ms <= 0) return null;
  return Math.round((bytes / ms) * 1000);
}

function relativeToData(dataDir, absolutePath) {
  return absolutePath.startsWith(dataDir) ? absolutePath.slice(dataDir.length + 1) : absolutePath;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
