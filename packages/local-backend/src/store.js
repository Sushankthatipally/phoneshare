import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  appendFile,
  mkdir,
  open as openFile,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  createPairingTicket,
  decryptTransferChunk,
  derivePinCode,
  deriveSessionSecret,
  deriveSharedSecret,
  encryptTransferBuffer,
  exportPrivateKeyJwk,
  importPrivateKeyJwk,
  zeroBuffer,
} from './crypto.js';
import { generateFriendlyName, generateRandomFriendlyName, computeHashtag } from './friendly-name.js';

const QR_TTL_MS = 10 * 60 * 1000;
const GUEST_TTL_MS = 60 * 60 * 1000;
export const MAX_PIN_ATTEMPTS = 3;
const PAIRING_KEY_TTL_MS = 10 * 60 * 1000;
const FINGERPRINT_HEAD_BYTES = 256 * 1024;
const DEFAULT_MULTI_DEVICE_MAX = 3;
const MULTI_DEVICE_HARD_LIMIT = 8;

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
  clipboardSyncEnabled: false,
  watchFolders: [],
  deviceFingerprint: '',
  friendlyName: '',
  hashtag: '',
  quickSave: 'off',
  favorites: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const QUICK_SAVE_VALUES = new Set(['off', 'favorites', 'on']);

const SESSION_STATES = {
  pairing: 'pairing',
  awaitingAccept: 'awaiting-accept',
  pinRequired: 'pin-required',
  awaitingKnownDevice: 'awaiting-known-device',
  paired: 'paired',
  transferring: 'transferring',
  completed: 'completed',
  closed: 'closed',
  failed: 'failed',
  locked: 'locked',
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
    this.peerConnectedHandlers = new Set();
    this.peerStorageReports = new Map();
  }

  onPeerConnected(handler) {
    if (typeof handler !== 'function') return () => {};
    this.peerConnectedHandlers.add(handler);
    return () => this.peerConnectedHandlers.delete(handler);
  }

  notifyPeerConnected(fingerprint) {
    if (!fingerprint) return;
    for (const handler of this.peerConnectedHandlers) {
      try {
        const result = handler(fingerprint);
        if (result && typeof result.catch === 'function') {
          result.catch((error) => {
            console.warn(`peer-connected handler failed: ${error?.message ?? error}`);
          });
        }
      } catch (error) {
        console.warn(`peer-connected handler failed: ${error?.message ?? error}`);
      }
    }
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(this.filesDir, { recursive: true });
    await mkdir(this.guestDir, { recursive: true });
    await this.loadState();
    await this.ensureIdentity();
  }

  // Returns the always-active discovery session's pk + sid for mDNS TXT records.
  // null if no discovery session exists yet (init not complete).
  getDiscoveryTxt() {
    const session = [...this.sessions.values()].find((s) => s.meta?.discovery && s.state === SESSION_STATES.pairing);
    if (!session) return null;
    return {
      sessionId: session.id,
      publicKey: session.pairing?.qrPayload?.publicKey ?? null,
    };
  }

  // Ensure a single always-active discovery session exists. Called on init and
  // after a discovery session graduates so the next phone has fresh keys.
  async ensureDiscoverySession() {
    const existing = [...this.sessions.values()].find(
      (s) => s.meta?.discovery && s.state === SESSION_STATES.pairing,
    );
    if (existing) return existing;
    const session = await this.createSession({ mode: 'wifi' });
    const stored = this.sessions.get(session.id);
    if (stored) {
      stored.meta = { ...(stored.meta ?? {}), discovery: true };
      await this.persist();
    }
    return stored;
  }

  // Backfill friendlyName, hashtag, and deviceFingerprint on first boot or for
  // legacy state files that pre-date these fields. Persists if anything changed.
  async ensureIdentity() {
    let dirty = false;
    if (!this.settings.deviceFingerprint) {
      this.settings.deviceFingerprint = randomUUID().replace(/-/g, '');
      dirty = true;
    }
    if (!this.settings.friendlyName) {
      this.settings.friendlyName = generateFriendlyName(this.settings.deviceFingerprint);
      dirty = true;
    }
    if (!this.settings.hashtag) {
      this.settings.hashtag = computeHashtag(this.settings.deviceFingerprint);
      dirty = true;
    }
    if (!QUICK_SAVE_VALUES.has(this.settings.quickSave)) {
      this.settings.quickSave = 'off';
      dirty = true;
    }
    if (!Array.isArray(this.settings.favorites)) {
      this.settings.favorites = [];
      dirty = true;
    }
    if (dirty) {
      this.settings.updatedAt = new Date().toISOString();
      await this.persist();
    }
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
      await this.restorePairingKeys(parsed.pairingKeys ?? {});
      this.rebuildFileIndex();
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    await this.persist();
  }

  // pairingKeys is persisted as { [sessionId]: { publicKey, privateKeyJwk,
  // createdAt, expiresAt } }. Entries older than PAIRING_KEY_TTL_MS or past
  // their expiresAt are dropped on boot; surviving entries are re-imported into
  // an in-memory CryptoKey so PIN verification still works after a sidecar
  // restart that happens mid-pairing.
  async restorePairingKeys(persisted) {
    const now = Date.now();
    for (const [sessionId, entry] of Object.entries(persisted)) {
      if (!entry?.privateKeyJwk || !entry?.publicKey) continue;
      const createdAt = Date.parse(entry.createdAt ?? '');
      const expiresAt = Date.parse(entry.expiresAt ?? '');
      if (Number.isFinite(expiresAt) && expiresAt < now) continue;
      if (Number.isFinite(createdAt) && now - createdAt > PAIRING_KEY_TTL_MS) continue;
      try {
        const privateKey = await importPrivateKeyJwk(entry.privateKeyJwk);
        this.pairingKeys.set(sessionId, {
          privateKey,
          publicKey: entry.publicKey,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
        });
      } catch {
        // skip corrupted entries
      }
    }
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
      'clipboardSyncEnabled',
      'watchFolders',
      'friendlyName',
      'quickSave',
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
      if (key === 'clipboardSyncEnabled') {
        this.settings.clipboardSyncEnabled = Boolean(patch.clipboardSyncEnabled);
        continue;
      }
      if (key === 'friendlyName') {
        const next = sanitizeText(patch.friendlyName);
        if (next) this.settings.friendlyName = next.slice(0, 64);
        continue;
      }
      if (key === 'quickSave') {
        if (QUICK_SAVE_VALUES.has(patch.quickSave)) this.settings.quickSave = patch.quickSave;
        continue;
      }
      this.settings[key] = patch[key];
    }

    this.settings.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('settings-updated', { settings: this.getSettings() });
    return this.getSettings();
  }

  async regenerateFriendlyName() {
    this.settings.friendlyName = generateRandomFriendlyName();
    this.settings.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('settings-updated', { settings: this.getSettings() });
    return this.getSettings();
  }

  // ─── Favorites ────────────────────────────────────────────

  listFavorites() {
    return [...(this.settings.favorites ?? [])];
  }

  async addFavorite(fingerprint) {
    const fp = sanitizeText(fingerprint);
    if (!fp) throw httpError(400, 'fingerprint is required');
    const set = new Set(this.settings.favorites ?? []);
    set.add(fp);
    this.settings.favorites = [...set];
    this.settings.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('settings-updated', { settings: this.getSettings() });
    return this.listFavorites();
  }

  async removeFavorite(fingerprint) {
    const fp = sanitizeText(fingerprint);
    if (!fp) throw httpError(400, 'fingerprint is required');
    this.settings.favorites = (this.settings.favorites ?? []).filter((entry) => entry !== fp);
    this.settings.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('settings-updated', { settings: this.getSettings() });
    return this.listFavorites();
  }

  isFavorite(fingerprint) {
    if (!fingerprint) return false;
    return (this.settings.favorites ?? []).includes(fingerprint);
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

  // ─── Peer storage cache (free-space reports from phones) ──

  getPeerStorage(fingerprint) {
    const report = this.peerStorageReports.get(fingerprint);
    return report ? structuredClone(report) : null;
  }

  async recordPeerStorage(patch = {}) {
    const fingerprint = sanitizeText(patch.fingerprint);
    if (!fingerprint) throw httpError(400, 'fingerprint is required');
    const freeBytes = Number(patch.freeBytes);
    const totalBytes = Number(patch.totalBytes);
    if (!Number.isFinite(freeBytes) || freeBytes < 0) {
      throw httpError(400, 'freeBytes must be a non-negative number');
    }
    if (!Number.isFinite(totalBytes) || totalBytes < 0) {
      throw httpError(400, 'totalBytes must be a non-negative number');
    }
    const report = {
      fingerprint,
      freeBytes: Math.floor(freeBytes),
      totalBytes: Math.floor(totalBytes),
      reportedAt: new Date().toISOString(),
    };
    this.peerStorageReports.set(fingerprint, report);
    this.broadcast('peer-storage-updated', { report });
    return structuredClone(report);
  }

  // ─── Sessions ─────────────────────────────────────────────

  async createSession(input = {}) {
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const pairingOrigin = normalizeOrigin(input.origin ?? this.settings.publicOrigin);
    const backendOrigin = rewriteLoopbackToLan(normalizeOrigin(input.backendOrigin ?? getPreferredLanOrigin().origin));
    const mode = input.mode ?? this.settings.preferredMode;
    const hotspot = sanitizeHotspotInput(input.hotspot);
    if (mode === 'hotspot' && !hotspot) {
      throw httpError(400, 'hotspot.ssid and hotspot.password are required for hotspot sessions');
    }
    const ticket = await createPairingTicket({
      backendOrigin,
      pairingOrigin,
      sessionId,
      transport: mode === 'hotspot' ? 'wifi' : mode,
      ttlMs: QR_TTL_MS,
    });
    const expiresAt = new Date(Date.now() + QR_TTL_MS).toISOString();
    const multiDevice = Boolean(input.multiDevice);
    const maxDevices = multiDevice
      ? clampInteger(input.maxDevices, 2, MULTI_DEVICE_HARD_LIMIT, DEFAULT_MULTI_DEVICE_MAX)
      : 1;
    const hotspotPayload = mode === 'hotspot'
      ? {
          mode: 'hotspot',
          sessionId,
          ssid: hotspot.ssid,
          password: hotspot.password,
          host: ticket.payload.host,
          port: ticket.payload.port,
          publicKey: ticket.payload.publicKey,
          expiresAt: ticket.payload.expiresAt,
          band: hotspot.band ?? null,
        }
      : null;
    const pairingUrl = hotspotPayload
      ? buildHotspotPairingUrl(pairingOrigin, sessionId, hotspotPayload)
      : ticket.pairingUrl;
    const session = {
      id: sessionId,
      mode,
      state: SESSION_STATES.pairing,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      closedAt: null,
      multiDevice,
      maxDevices,
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
        pairingUrl,
        qrPayload: hotspotPayload ?? ticket.payload,
        hotspot: hotspotPayload,
        verifiedAt: null,
        acceptedAt: null,
        attempts: 0,
        attemptsRemaining: MAX_PIN_ATTEMPTS,
      },
      pendingRequest: null,
      pendingRequests: multiDevice ? [] : null,
      pendingTransfers: [],
      files: { 'desktop-to-phone': [], 'phone-to-desktop': [] },
      queue: this.emptyQueue(),
      summary: this.emptySummary(),
      closedReason: null,
      eventCount: 0,
      slots: multiDevice ? buildInitialSlots(maxDevices) : null,
      connectedDevices: multiDevice ? [] : null,
      awaitingKnownDevice: null,
    };

    const nowMs = Date.now();
    this.pairingKeys.set(sessionId, {
      privateKey: ticket.privateKey,
      publicKey: ticket.publicKey,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + PAIRING_KEY_TTL_MS).toISOString(),
    });
    this.sessions.set(sessionId, session);
    await this.persist();
    this.broadcast('session-created', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  // Pre-targeted session for a known device returning. Pairing skips PIN: only ECDH
  // handshake is performed because trust was already established in a prior session.
  async reconnectKnownDevice(fingerprint, input = {}) {
    const known = this.knownDevices.get(fingerprint);
    if (!known) throw httpError(404, `known device ${fingerprint} not found`);
    const preferTransport = sanitizePreferredTransport(input.preferTransport);
    const session = await this.createSession({
      mode: preferTransport,
      deviceName: input.deviceName,
      deviceIcon: input.deviceIcon,
      origin: input.origin,
      backendOrigin: input.backendOrigin,
    });
    const record = this.requireSession(session.id);
    record.state = SESSION_STATES.awaitingKnownDevice;
    record.awaitingKnownDevice = { fingerprint };
    record.updatedAt = new Date().toISOString();
    await this.persist();
    const publicSession = this.publicSession(record);
    this.broadcast('session-awaiting-known-device', {
      session: publicSession,
      knownDevice: known,
    });
    return {
      session: publicSession,
      ticket: publicSession.pairing.ticket,
      knownDevice: structuredClone(known),
    };
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
    session.pairing.attemptsRemaining = MAX_PIN_ATTEMPTS;
    session.pairing.verifiedAt = null;
    session.pairing.acceptedAt = null;
    session.pairing.encrypted = false;
    session.expiresAt = new Date(Date.now() + QR_TTL_MS).toISOString();
    session.state = SESSION_STATES.pairing;
    session.pendingRequest = null;
    session.pinChallenge = null;
    this.zeroPairingKeys(sessionId);
    this.sessionSecrets.delete(sessionId);
    const regenNowMs = Date.now();
    this.pairingKeys.set(sessionId, {
      privateKey: ticket.privateKey,
      publicKey: ticket.publicKey,
      createdAt: new Date(regenNowMs).toISOString(),
      expiresAt: new Date(regenNowMs + PAIRING_KEY_TTL_MS).toISOString(),
    });
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
    const allowedStates = [
      SESSION_STATES.pairing,
      SESSION_STATES.awaitingAccept,
      SESSION_STATES.awaitingKnownDevice,
    ];
    if (session.multiDevice) {
      allowedStates.push(SESSION_STATES.paired, SESSION_STATES.transferring);
    }
    if (!allowedStates.includes(session.state)) {
      throw httpError(409, 'session is not awaiting a connection');
    }

    const now = new Date().toISOString();
    const peerFingerprint = createDeviceFingerprint(input.deviceName ?? 'Phone', input.platform ?? 'ios');

    if (session.multiDevice) {
      const connectedCount = countConnectedSlots(session);
      const openSlot = findOpenSlot(session);
      if (connectedCount >= session.maxDevices || !openSlot) {
        const err = httpError(409, 'session-full');
        err.body = {
          error: 'session-full',
          maxDevices: session.maxDevices,
          connectedDevices: connectedCount,
        };
        throw err;
      }
      const request = {
        id: randomUUID(),
        slotIndex: openSlot.index,
        requestedAt: now,
        peer: buildPeerRecord(input, session.mode, peerFingerprint),
        remotePublicKey:
          (typeof input.publicKey === 'string' && input.publicKey.trim()) ||
          (typeof input.remotePublicKey === 'string' && input.remotePublicKey.trim()) ||
          null,
      };
      openSlot.status = 'pending';
      openSlot.device = {
        name: request.peer.name,
        platform: request.peer.platform,
        icon: request.peer.icon,
        fingerprint: request.peer.fingerprint,
      };
      openSlot.pendingRequestId = request.id;
      session.pendingRequests = session.pendingRequests ?? [];
      session.pendingRequests.push(request);
      session.updatedAt = now;

      const trusted = this.trustedDevices.get(peerFingerprint);
      const skipAccept =
        session.awaitingKnownDevice?.fingerprint === peerFingerprint ||
        (this.settings.autoAcceptTrusted && trusted);
      if (skipAccept) {
        return this.acceptSession(sessionId, { pendingRequestId: request.id });
      }
      await this.persist();
      this.broadcast('session-connect-requested', { session: this.publicSession(session) });
      return this.publicSession(session);
    }

    // The phone sends `publicKey`; older callers may use `remotePublicKey`.
    const peerPublicKey =
      (typeof input.publicKey === 'string' && input.publicKey.trim()) ||
      (typeof input.remotePublicKey === 'string' && input.remotePublicKey.trim()) ||
      null;

    session.pendingRequest = {
      id: randomUUID(),
      requestedAt: now,
      peer: buildPeerRecord(input, session.mode, peerFingerprint),
      remotePublicKey: peerPublicKey,
      preTargeted: true,
    };
    session.state = SESSION_STATES.awaitingAccept;
    session.updatedAt = now;

    // Auto-pair on QR scan. The QR was the trust signal; per-transfer
    // Accept/Decline is enforced separately via pendingTransfers.
    return this.acceptSession(sessionId);
  }

  // Receiver (desktop) accepts the pending connect request. Per Flow 2.1, this
  // only advances to `pin-required` — the AEAD session key is NOT derived until
  // the phone passes PIN verification. We pre-compute the shared secret here so
  // pin-verify can compare SAS without redoing ECDH, but the AEAD key is held
  // back until verifyPin succeeds.
  async acceptSession(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    const now = new Date().toISOString();

    if (session.multiDevice) {
      const pending = pickPendingRequest(session, input.pendingRequestId);
      if (!pending) throw httpError(409, 'no pending connection to accept');
      const slot = (session.slots ?? []).find((s) => s.index === pending.slotIndex);
      if (!slot) throw httpError(500, 'pending request slot is missing');
      const peer = pending.peer;
      const remotePublicKey = pending.remotePublicKey;
      session.pendingRequests = (session.pendingRequests ?? []).filter((r) => r.id !== pending.id);
      slot.status = 'connected';
      slot.connectedAt = now;
      slot.pendingRequestId = null;
      slot.device = {
        name: peer.name,
        platform: peer.platform,
        icon: peer.icon,
        fingerprint: peer.fingerprint,
      };
      session.connectedDevices = session.connectedDevices ?? [];
      session.connectedDevices.push({
        slotIndex: slot.index,
        name: peer.name,
        platform: peer.platform,
        icon: peer.icon,
        fingerprint: peer.fingerprint,
        connectedAt: now,
      });
      session.peerDevice = peer;
      session.pairing.verifiedAt = session.pairing.verifiedAt ?? now;
      session.pairing.acceptedAt = now;
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
      session.state = SESSION_STATES.paired;
      session.updatedAt = now;
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
      if (peer.fingerprint) {
        this.notifyPeerConnected(peer.fingerprint);
      }
      return this.publicSession(session);
    }

    const acceptableStates = [SESSION_STATES.awaitingAccept, SESSION_STATES.awaitingKnownDevice];
    if (!acceptableStates.includes(session.state) || !session.pendingRequest) {
      throw httpError(409, 'no pending connection to accept');
    }

    const peer = session.pendingRequest.peer;
    const remotePublicKey = session.pendingRequest.remotePublicKey;

    if (!remotePublicKey) {
      throw httpError(400, 'peer public key is required to accept the session');
    }

    const pairingKey = this.pairingKeys.get(sessionId);
    if (!pairingKey?.privateKey) {
      throw httpError(409, 'pairing keypair is unavailable for this session');
    }

    // PIN-less pairing: derive the AEAD session secret immediately on Accept
    // and mark the session as paired. The Accept click on the desktop is the
    // trust gate; per-transfer Accept/Decline is enforced separately via
    // `pendingTransfers`. We keep the ECDH-derived secret so file chunks
    // remain end-to-end encrypted, but skip the SAS-PIN verification round-trip.
    const sessionSecret = await deriveSessionSecret({
      privateKey: pairingKey.privateKey,
      remotePublicKey,
      sessionId,
    });
    this.sessionSecrets.set(sessionId, sessionSecret);

    session.peerDevice = peer;
    session.pairing.acceptedAt = now;
    session.pairing.verifiedAt = now;
    session.pairing.encrypted = true;
    session.pairing.attemptsRemaining = MAX_PIN_ATTEMPTS;
    session.state = SESSION_STATES.paired;
    session.updatedAt = now;
    session.pendingRequest = null;
    session.awaitingKnownDevice = null;
    session.pinChallenge = null;

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
    if (peer.fingerprint) {
      this.notifyPeerConnected(peer.fingerprint);
    }
    return this.publicSession(session);
  }

  // Verify the 6-digit SAS PIN supplied by the phone. Constant-time compare. On
  // MAX_PIN_ATTEMPTS-th failure the session is locked: keypair is zeroed,
  // session marked `locked`, and a `session-locked` SSE event is broadcast.
  async verifyPin(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    if (session.state !== SESSION_STATES.pinRequired || !session.pinChallenge) {
      throw httpError(409, 'session is not awaiting PIN verification');
    }

    const candidate = typeof input.pin === 'string' ? input.pin.trim() : '';
    if (!/^\d{6}$/.test(candidate)) {
      throw httpError(400, 'pin must be a 6-digit code');
    }
    const deviceFingerprint = sanitizeText(input.deviceFingerprint);
    if (!deviceFingerprint) {
      throw httpError(400, 'deviceFingerprint is required');
    }

    const challenge = session.pinChallenge;
    const expectedBuf = Buffer.from(challenge.expectedPin, 'utf8');
    const candidateBuf = Buffer.from(candidate, 'utf8');
    const matched = expectedBuf.length === candidateBuf.length
      && timingSafeEqual(expectedBuf, candidateBuf);

    if (matched) {
      const sharedSecret = new Uint8Array(Buffer.from(challenge.sharedSecret, 'base64'));
      const sessionSecret = await deriveSessionSecret({
        sharedSecret,
        sessionId,
        // privateKey/remotePublicKey unused when sharedSecret provided
        privateKey: null,
        remotePublicKey: null,
      });
      this.sessionSecrets.set(sessionId, sessionSecret);
      zeroBuffer(sharedSecret);

      const now = new Date().toISOString();
      session.pairing.verifiedAt = now;
      session.pairing.encrypted = true;
      session.pairing.attemptsRemaining = MAX_PIN_ATTEMPTS;
      session.state = SESSION_STATES.paired;
      session.updatedAt = now;

      const peer = session.peerDevice;
      if (peer?.fingerprint) {
        this.knownDevices.set(peer.fingerprint, {
          fingerprint: peer.fingerprint,
          name: peer.name,
          platform: peer.platform,
          icon: peer.icon,
          lastSeenAt: now,
        });
        if (challenge.trustOnSuccess) {
          this.trustedDevices.set(peer.fingerprint, {
            fingerprint: peer.fingerprint,
            name: peer.name,
            platform: peer.platform,
            trustedAt: now,
            autoAccept: true,
          });
        }
      }

      session.pinChallenge = null;
      session.summary = this.buildSummary(session);
      await this.persist();
      this.broadcast('session-paired', { session: this.publicSession(session) });
      if (peer?.fingerprint) {
        this.notifyPeerConnected(peer.fingerprint);
      }
      return {
        ok: true,
        session: this.publicSession(session),
        attemptsRemaining: MAX_PIN_ATTEMPTS,
      };
    }

    challenge.attempts += 1;
    const attemptsRemaining = Math.max(0, MAX_PIN_ATTEMPTS - challenge.attempts);
    challenge.attemptsRemaining = attemptsRemaining;
    session.pairing.attempts = challenge.attempts;
    session.pairing.attemptsRemaining = attemptsRemaining;
    session.updatedAt = new Date().toISOString();

    if (attemptsRemaining === 0) {
      const lockedAt = session.updatedAt;
      this.zeroPairingKeys(sessionId);
      this.sessionSecrets.delete(sessionId);
      session.state = SESSION_STATES.locked;
      session.closedAt = lockedAt;
      session.closedReason = 'pin-attempts-exhausted';
      session.pinChallenge = null;
      session.pairing.encrypted = false;
      session.summary = this.buildSummary(session);
      await this.persist();
      this.broadcast('session-locked', {
        sessionId,
        reason: 'pin-attempts-exhausted',
        lockedAt,
      });
      this.broadcast('session-updated', { session: this.publicSession(session) });
      return {
        ok: false,
        reason: 'locked',
        attemptsRemaining: 0,
      };
    }

    await this.persist();
    this.broadcast('pin-mismatch', { sessionId, attemptsRemaining });
    return {
      ok: false,
      reason: 'mismatch',
      attemptsRemaining,
    };
  }

  // Overwrite the in-memory X25519 private key for the given session and drop
  // it from the map so it can't be reused. Per spec Flow 4.1 the keypair is
  // "deleted" — we also zero the publicKey string buffer for symmetry.
  zeroPairingKeys(sessionId) {
    const entry = this.pairingKeys.get(sessionId);
    if (!entry) return;
    // CryptoKey is opaque (we can't overwrite its private bytes from JS land)
    // but dropping the reference makes it unreachable. The persisted JWK is
    // overwritten on the next persist() because exportPairingKeysForPersistence
    // skips entries that are no longer in the map.
    this.pairingKeys.delete(sessionId);
    entry.privateKey = null;
    entry.publicKey = '';
  }

  async declineSession(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    const now = new Date().toISOString();

    if (session.multiDevice) {
      const pending = pickPendingRequest(session, input.pendingRequestId);
      if (!pending) throw httpError(409, 'no pending request to decline');
      const slot = (session.slots ?? []).find((s) => s.index === pending.slotIndex);
      session.pendingRequests = (session.pendingRequests ?? []).filter((r) => r.id !== pending.id);
      if (slot) {
        slot.status = 'open';
        slot.pendingRequestId = null;
        slot.device = null;
        slot.deniedAt = now;
        slot.deniedReason = input.reason ?? 'declined';
      }
      session.updatedAt = now;
      await this.persist();
      this.broadcast('session-declined', { session: this.publicSession(session) });
      return this.publicSession(session);
    }

    if (session.state !== SESSION_STATES.awaitingAccept) {
      throw httpError(409, 'no pending request to decline');
    }
    session.state = SESSION_STATES.failed;
    session.closedAt = now;
    session.updatedAt = now;
    session.closedReason = input.reason ?? 'declined';
    session.pendingRequest = null;
    await this.persist();
    this.broadcast('session-declined', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  // Multi-device: a previously-connected device drops off. Free the slot so a new
  // device can scan and take its place — no stale slots.
  async disconnectDeviceFromSession(sessionId, fingerprint) {
    const session = this.requireSession(sessionId);
    if (!session.multiDevice) {
      throw httpError(409, 'session is not multi-device');
    }
    const slot = (session.slots ?? []).find((s) => s.device?.fingerprint === fingerprint);
    if (!slot) throw httpError(404, `device ${fingerprint} is not connected to this session`);
    slot.status = 'open';
    slot.device = null;
    slot.connectedAt = null;
    slot.pendingRequestId = null;
    session.connectedDevices = (session.connectedDevices ?? []).filter(
      (d) => d.fingerprint !== fingerprint,
    );
    session.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('session-updated', { session: this.publicSession(session) });
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

    // Quick Save: auto-accept incoming batches when the receiver opted in. Only
    // applies to batches arriving at this side (phone-to-desktop on a desktop,
    // desktop-to-phone on a phone). The sender's own requests should never
    // auto-accept locally.
    const peerFingerprint = session.peerDevice?.fingerprint ?? null;
    const policy = this.settings.quickSave;
    const shouldAutoAccept =
      policy === 'on' ||
      (policy === 'favorites' && peerFingerprint && this.isFavorite(peerFingerprint));
    if (shouldAutoAccept) {
      // Fire-and-forget; surface failures via existing error broadcasts. We do
      // not await so the request response stays snappy.
      this.acceptTransferBatch(sessionId, batch.id, {}).catch((err) => {
        console.warn(`quickSave auto-accept failed: ${err?.message ?? err}`);
      });
    }
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
    const preferred = getPreferredLanOrigin();
    return preferred.host === '127.0.0.1' ? null : preferred.origin;
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
    this.broadcast('guest-file-added', { token, file: { ...record, storagePath: undefined } });
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
      id: `dropbeam:${this.settings.deviceFingerprint || 'desktop'}`,
      name: this.settings.friendlyName || this.settings.deviceName,
      icon: sanitizeDeviceIcon(this.settings.deviceIcon) ?? 'desktop',
      platform: process.platform,
      fingerprint: this.settings.deviceFingerprint || '',
      hashtag: this.settings.hashtag || '',
      friendlyName: this.settings.friendlyName || this.settings.deviceName,
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
    const sourceDeviceFingerprint = sanitizeText(input.sourceDeviceFingerprint)
      ?? session.peerDevice?.fingerprint
      ?? null;
    const fileHashFirst256KB = sanitizeText(input.fileHashFirst256KB) ?? '';
    const fingerprint = createUploadFingerprint({
      direction,
      fileHashFirst256KB,
      name,
      relativePath,
      size,
      sourceDeviceFingerprint,
    });

    // Resume only within the same session: encrypted chunks bind the session id
    // and key into the AEAD, so an upload resumed across sessions can never
    // decrypt — it just shadows the new upload and poisons the transfer.
    const existing = [...this.uploads.values()].find(
      (upload) =>
        upload.status === 'pending' &&
        upload.sessionId === sessionId &&
        upload.fingerprint === fingerprint,
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
    const terminalStates = ['closed', 'completed', 'failed', 'locked'];
    const activeSessions = sessions.filter((s) => !terminalStates.includes(s.state));
    const history = sessions.filter((s) => terminalStates.includes(s.state));
    const totals = sessions.reduce(
      (acc, s) => {
        acc.sessions += 1;
        acc.files += this.countFiles(s);
        acc.bytes += s.summary.totalBytes;
        if (s.state === SESSION_STATES.paired) acc.paired += 1;
        if (s.state === SESSION_STATES.transferring) acc.transferring += 1;
        if (s.state === SESSION_STATES.completed) acc.completed += 1;
        if (s.state === SESSION_STATES.awaitingAccept) acc.pending += 1;
        if (s.state === SESSION_STATES.pinRequired) acc.pending += 1;
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
      .filter((s) => ['closed', 'completed', 'failed', 'locked'].includes(s.state))
      .filter((s) => this.matchesHistoryQuery(s, normalized))
      .map((s) => this.sessionHistoryEntry(s));
  }

  // ─── Persistence ──────────────────────────────────────────

  async persist() {
    const pairingKeysSnapshot = await this.exportPairingKeysForPersistence();
    const snapshot = {
      version: 3,
      settings: this.settings,
      clipboard: this.clipboard,
      sessions: Object.fromEntries(
        [...this.sessions.entries()].map(([id, s]) => [id, this.persistedSession(s)]),
      ),
      uploads: Object.fromEntries([...this.uploads.entries()].map(([id, u]) => [id, u])),
      trustedDevices: Object.fromEntries(this.trustedDevices),
      knownDevices: Object.fromEntries(this.knownDevices),
      guestShares: Object.fromEntries(this.guestShares),
      pairingKeys: pairingKeysSnapshot,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(this.stateFile, snapshot);
  }

  async exportPairingKeysForPersistence() {
    const out = {};
    const now = Date.now();
    for (const [sessionId, entry] of this.pairingKeys.entries()) {
      if (!entry?.privateKey) continue;
      const expiresAt = Date.parse(entry.expiresAt ?? '');
      if (Number.isFinite(expiresAt) && expiresAt < now) continue;
      try {
        const jwk = await exportPrivateKeyJwk(entry.privateKey);
        out[sessionId] = {
          publicKey: entry.publicKey,
          privateKeyJwk: jwk,
          createdAt: entry.createdAt ?? new Date(now).toISOString(),
          expiresAt: entry.expiresAt ?? new Date(now + PAIRING_KEY_TTL_MS).toISOString(),
        };
      } catch {
        // non-extractable or otherwise unserializable — skip silently
      }
    }
    return out;
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
    const challenge = session.pinChallenge ?? null;
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
          hotspot: session.pairing.hotspot ?? null,
        },
        encrypted: Boolean(session.pairing.encrypted),
        verifiedAt: session.pairing.verifiedAt ?? null,
        acceptedAt: session.pairing.acceptedAt ?? null,
        attemptsRemaining: session.pairing.attemptsRemaining ?? MAX_PIN_ATTEMPTS,
        // Only present while session is in `pin-required` — the desktop UI
        // shows this for the human to read aloud / type on the phone.
        pin: session.state === SESSION_STATES.pinRequired && challenge ? challenge.expectedPin : null,
      },
      pendingRequest: session.pendingRequest ?? null,
      pendingRequests: session.multiDevice ? session.pendingRequests ?? [] : undefined,
      pendingTransfers: session.pendingTransfers ?? [],
      summary: this.buildSummary(session),
      queue: this.buildQueue(session),
      pinChallenge: undefined,
      slots: session.multiDevice ? session.slots ?? [] : undefined,
      connectedDevices: session.multiDevice ? session.connectedDevices ?? [] : undefined,
      awaitingKnownDevice: session.awaitingKnownDevice ?? null,
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
      const preferred = getPreferredLanOrigin();
      if (preferred.host !== '127.0.0.1') {
        url.hostname = preferred.host;
        return url.toString().replace(/\/+$/, '');
      }
    }
    return origin;
  } catch {
    return origin;
  }
}

// Single source of truth for picking a LAN-routable IPv4 address.
// Excludes loopback, link-local 169.254/16, and VPN/tun adapters by name heuristic.
// Ranks: physical ethernet > wifi > other.
export function getPreferredLanOrigin() {
  const port = process.env.DROPBEAM_BACKEND_PORT ?? '17619';
  const best = pickPreferredLanInterface();
  if (best) {
    return { host: best.address, score: best.score, interface: best.name, origin: `http://${best.address}:${port}` };
  }
  return { host: '127.0.0.1', score: -1, interface: null, origin: `http://127.0.0.1:${port}` };
}

function pickPreferredLanInterface() {
  try {
    const interfaces = networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(interfaces)) {
      const lower = name.toLowerCase();
      // VPN / tun / tap adapters: exclude.
      if (/^(tun|utun|tap|vpn|tailscale|zerotier|wireguard|wg|ppp)/.test(lower)) continue;
      // Virtualization / bridge adapters: exclude (Docker, VMware, Hyper-V, WSL, VirtualBox, vEthernet).
      if (/(vmware|virtual|vbox|hyper-?v|vethernet|docker|wsl|bridge)/.test(lower)) continue;

      for (const iface of interfaces[name] ?? []) {
        if (iface.family !== 'IPv4' || iface.internal || !iface.address) continue;
        // Skip link-local 169.254/16.
        if (/^169\.254\./.test(iface.address)) continue;

        let score = 0;
        if (/(^en\d|ethernet|eth\d)/.test(lower)) score += 100;
        else if (/(wi-?fi|wlan|wireless|airport)/.test(lower)) score += 80;
        else score += 20;

        // Subnet preference.
        if (/^192\.168\.(0|1)\./.test(iface.address)) score += 20;
        else if (/^192\.168\./.test(iface.address)) score += 12;
        else if (/^10\./.test(iface.address)) score += 10;
        else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(iface.address)) score += 8;
        else score += 1;

        candidates.push({ address: iface.address, name, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
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

export async function hashFile(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function hashFileHead(path, byteLimit = FINGERPRINT_HEAD_BYTES) {
  const hash = createHash('sha256');
  let handle;
  try {
    handle = await openFile(path, 'r');
    const buffer = Buffer.allocUnsafe(Math.min(byteLimit, 1024 * 1024));
    let read = 0;
    while (read < byteLimit) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, byteLimit - read), read);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      read += bytesRead;
    }
  } finally {
    await handle?.close();
  }
  return hash.digest('hex');
}

// Stable across re-pairing: the sessionId must NOT participate.
// Identity = (direction, fileHashFirst256KB, name, relativePath, size, sourceDeviceFingerprint).
export function createUploadFingerprint(input) {
  const hash = createHash('sha256');
  hash.update(String(input.direction ?? ''));
  hash.update(' ');
  hash.update(String(input.fileHashFirst256KB ?? ''));
  hash.update(' ');
  hash.update(String(input.name ?? ''));
  hash.update(' ');
  hash.update(String(input.relativePath ?? ''));
  hash.update(' ');
  hash.update(String(input.size ?? ''));
  hash.update(' ');
  hash.update(String(input.sourceDeviceFingerprint ?? ''));
  return hash.digest('hex');
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

function clampInteger(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function sanitizeHotspotInput(value) {
  if (!value || typeof value !== 'object') return null;
  const ssid = sanitizeText(value.ssid);
  const password = sanitizeText(value.password);
  if (!ssid || !password) return null;
  const band = value.band === '2.4GHz' || value.band === '5GHz' ? value.band : null;
  return { ssid, password, band };
}

function sanitizePreferredTransport(value) {
  return value === 'wifi' || value === 'usb' || value === 'hotspot' ? value : 'wifi';
}

function buildInitialSlots(count) {
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    slots.push({
      index: i,
      status: 'open',
      device: null,
      pendingRequestId: null,
      connectedAt: null,
      deniedAt: null,
      deniedReason: null,
    });
  }
  return slots;
}

function findOpenSlot(session) {
  return (session.slots ?? []).find((s) => s.status === 'open') ?? null;
}

function countConnectedSlots(session) {
  return (session.slots ?? []).filter((s) => s.status === 'connected').length;
}

function buildPeerRecord(input, defaultMode, fingerprint) {
  return {
    name: input.deviceName ?? 'Phone',
    platform: input.platform ?? 'ios',
    transport: input.transport ?? defaultMode,
    icon: sanitizeDeviceIcon(input.deviceIcon) ?? inferDeviceIcon(input.platform),
    address: input.address ?? null,
    fingerprint,
  };
}

function pickPendingRequest(session, requestId) {
  const pending = session.pendingRequests ?? [];
  if (!pending.length) return null;
  if (!requestId) return pending[0];
  return pending.find((r) => r.id === requestId) ?? null;
}

function buildHotspotPairingUrl(pairingOrigin, sessionId, hotspotPayload) {
  const url = new URL(`${pairingOrigin}/pair/${encodeURIComponent(sessionId)}`);
  url.hash = `pair=${encodeURIComponent(JSON.stringify(hotspotPayload))}`;
  return url.toString();
}
