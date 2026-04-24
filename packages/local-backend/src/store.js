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
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  createPairingTicket,
  decryptTransferChunk,
  deriveSessionSecret,
  encryptTransferBuffer,
} from './crypto.js';

const DEFAULT_SETTINGS = {
  deviceName: 'DropBeam Desktop',
  deviceIcon: 'desktop',
  preferredMode: 'wifi',
  publicOrigin: process.env.DROPBEAM_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5174',
  autoCloseAfterDownload: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SESSION_STATES = {
  pairing: 'pairing',
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
    this.snapshotsDir = join(this.dataDir, 'snapshots');
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.clipboard = this.emptyClipboard();
    this.sessions = new Map();
    this.fileIndex = new Map();
    this.uploads = new Map();
    this.sessionSecrets = new Map();
    this.pairingKeys = new Map();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(this.filesDir, { recursive: true });
    await mkdir(this.snapshotsDir, { recursive: true });
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
      this.sessions = new Map(
        Object.entries(parsed.sessions ?? {}).map(([id, session]) => [id, session]),
      );
      this.uploads = new Map(
        Object.entries(parsed.uploads ?? {}).map(([id, upload]) => [id, upload]),
      );
      this.rebuildFileIndex();
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    await this.persist();
  }

  getSettings() {
    return this.publicSettings();
  }

  getClipboard() {
    return structuredClone(this.clipboard);
  }

  async updateSettings(patch) {
    const allowed = ['deviceName', 'deviceIcon', 'preferredMode', 'autoCloseAfterDownload'];
    for (const key of allowed) {
      if (key in patch) {
        if (key === 'deviceIcon') {
          this.settings.deviceIcon = sanitizeDeviceIcon(patch.deviceIcon) ?? DEFAULT_SETTINGS.deviceIcon;
          continue;
        }

        this.settings[key] = patch[key];
      }
    }

    this.settings.updatedAt = new Date().toISOString();
    await this.persist();
    this.broadcast('settings-updated', { settings: this.getSettings() });
    return this.getSettings();
  }

  async updateClipboard(patch = {}) {
    const nextClipboard = {
      text: typeof patch.text === 'string' ? patch.text.slice(0, 200_000) : '',
      updatedAt: new Date().toISOString(),
      sourceDeviceName: sanitizeText(patch.sourceDeviceName) ?? null,
      sourceRole: patch.sourceRole === 'phone' ? 'phone' : 'desktop',
    };

    this.clipboard = nextClipboard;
    await this.persist();
    this.broadcast('clipboard-updated', { clipboard: this.getClipboard() });
    return this.getClipboard();
  }

  async createSession(input = {}) {
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const pairingOrigin = normalizeOrigin(input.origin ?? this.settings.publicOrigin);
    const backendOrigin = normalizeOrigin(input.backendOrigin ?? 'http://127.0.0.1:17619');
    const ticket = await createPairingTicket({
      backendOrigin,
      pairingOrigin,
      sessionId,
      transport: input.mode ?? this.settings.preferredMode,
    });
    const session = {
      id: sessionId,
      mode: input.mode ?? this.settings.preferredMode,
      state: SESSION_STATES.pairing,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      localDevice: {
        name: input.deviceName ?? this.settings.deviceName,
        role: 'desktop',
        platform: process.platform,
        icon: sanitizeDeviceIcon(input.deviceIcon) ?? sanitizeDeviceIcon(this.settings.deviceIcon) ?? 'desktop',
      },
      peerDevice: null,
      pairing: {
        pin: null,
        guestAllowed: false,
        encrypted: false,
        pairingUrl: ticket.pairingUrl,
        qrPayload: ticket.payload,
        verifiedAt: null,
      },
      files: {
        'desktop-to-phone': [],
        'phone-to-desktop': [],
      },
      queue: this.emptyQueue(),
      summary: this.emptySummary(),
      closedReason: null,
      eventCount: 0,
    };

    this.pairingKeys.set(sessionId, {
      privateKey: ticket.privateKey,
      publicKey: ticket.publicKey,
    });
    this.sessions.set(sessionId, session);
    await this.persist();
    this.broadcast('session-created', { session: this.publicSession(session) });
    return this.publicSession(session);
  }

  listSessions() {
    return this.sortedSessions().map((session) => this.publicSession(session));
  }

  getSession(sessionId) {
    const session = this.requireSession(sessionId);
    return this.publicSession(session);
  }

  async pairSession(sessionId, input = {}) {
    const session = this.requireSession(sessionId);
    if (session.state === SESSION_STATES.closed || session.state === SESSION_STATES.completed) {
      throw httpError(409, 'session is already closed');
    }

    const now = new Date().toISOString();
    session.state = SESSION_STATES.paired;
    session.updatedAt = now;
    session.peerDevice = {
      name: input.deviceName ?? 'Phone',
      platform: input.platform ?? 'ios',
      transport: input.transport ?? 'wifi',
      address: input.address ?? null,
      icon: sanitizeDeviceIcon(input.deviceIcon) ?? inferDeviceIcon(input.platform ?? input.kind),
    };
    session.pairing.verifiedAt = now;
    session.pairing.encrypted = false;

    if (typeof input.remotePublicKey === 'string' && input.remotePublicKey.trim()) {
      const pairingKey = this.pairingKeys.get(sessionId);
      if (!pairingKey?.privateKey) {
        throw httpError(409, 'session encryption is not available for this pairing ticket');
      }

      const sessionSecret = await deriveSessionSecret({
        privateKey: pairingKey.privateKey,
        remotePublicKey: input.remotePublicKey.trim(),
        sessionId,
      });
      this.sessionSecrets.set(sessionId, sessionSecret);
      session.pairing.encrypted = true;
    }

    session.summary = this.buildSummary(session);

    await this.persist();
    this.broadcast('session-paired', { session: this.publicSession(session) });
    return this.publicSession(session);
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
    const upload = this.requireUpload(uploadId);
    return this.publicUpload(upload);
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
    if (upload.status !== 'pending') {
      throw httpError(409, 'upload is already finalized');
    }

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

    await writeJson(metaPath, {
      ...record,
      storagePath: record.storagePath,
      metaPath: record.metaPath,
    });

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
    if (!entry) {
      throw httpError(404, 'file not found');
    }

    const session = this.requireSession(entry.sessionId);
    const file = session.files[entry.direction].find((item) => item.id === fileId);
    if (!file) {
      throw httpError(404, 'file not found');
    }

    await this.markFileDownloaded(session, file);

    return {
      file: this.publicFile(file),
      path: resolve(this.dataDir, file.storagePath),
    };
  }

  async downloadSecureFile(fileId, sessionId) {
    const entry = this.fileIndex.get(fileId);
    if (!entry || entry.sessionId !== sessionId) {
      throw httpError(404, 'file not found');
    }

    const session = this.requireSession(entry.sessionId);
    const file = session.files[entry.direction].find((item) => item.id === fileId);
    if (!file) {
      throw httpError(404, 'file not found');
    }

    const sessionSecret = this.sessionSecrets.get(sessionId);
    if (!sessionSecret) {
      throw httpError(409, 'session encryption key is not available');
    }

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

  getDashboard() {
    const sessions = this.sortedSessions();
    const activeSessions = sessions.filter((session) => !['closed', 'completed', 'failed'].includes(session.state));
    const history = sessions.filter((session) => ['closed', 'completed', 'failed'].includes(session.state));
    const totals = sessions.reduce(
      (accumulator, session) => {
        accumulator.sessions += 1;
        accumulator.files += this.countFiles(session);
        accumulator.bytes += session.summary.totalBytes;
        if (session.state === SESSION_STATES.paired) {
          accumulator.paired += 1;
        }
        if (session.state === SESSION_STATES.transferring) {
          accumulator.transferring += 1;
        }
        if (session.state === SESSION_STATES.completed) {
          accumulator.completed += 1;
        }
        return accumulator;
      },
      { sessions: 0, files: 0, bytes: 0, paired: 0, transferring: 0, completed: 0 },
    );

    return {
      settings: this.getSettings(),
      clipboard: this.getClipboard(),
      activeUploads: [...this.uploads.values()]
        .map((upload) => this.publicUpload(upload))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      totals,
      activeSessions: activeSessions.map((session) => this.publicSession(session)),
      history: history.slice(0, 20).map((session) => this.publicSession(session)),
    };
  }

  getHistory(query = '') {
    const normalizedQuery = sanitizeSearchQuery(query);

    return this.sortedSessions()
      .filter((session) => ['closed', 'completed', 'failed'].includes(session.state))
      .filter((session) => this.matchesHistoryQuery(session, normalizedQuery))
      .map((session) => this.sessionHistoryEntry(session));
  }

  async persist() {
    const snapshot = {
      version: 1,
      settings: this.settings,
      clipboard: this.clipboard,
      sessions: Object.fromEntries(
        [...this.sessions.entries()].map(([sessionId, session]) => [
          sessionId,
          this.persistedSession(session),
        ]),
      ),
      uploads: Object.fromEntries(
        [...this.uploads.entries()].map(([uploadId, upload]) => [uploadId, upload]),
      ),
      updatedAt: new Date().toISOString(),
    };

    await writeJson(this.stateFile, snapshot);
    await writeJson(join(this.snapshotsDir, `state-${Date.now()}.json`), snapshot);
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

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw httpError(404, `session ${sessionId} not found`);
    }
    return session;
  }

  requireDirection(direction) {
    if (!DIRECTION_VALUES.has(direction)) {
      throw httpError(400, 'direction must be desktop-to-phone or phone-to-desktop');
    }
    return direction;
  }

  requireUpload(uploadId) {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw httpError(404, `upload ${uploadId} not found`);
    }
    return upload;
  }

  publicSession(session) {
    return structuredClone({
      ...session,
      localDevice: this.publicDevice(session.localDevice, 'desktop'),
      peerDevice: session.peerDevice ? this.publicDevice(session.peerDevice, 'phone') : session.peerDevice,
      pairing: {
        pin: session.pairing.pin,
        ticket: {
          sessionId: session.id,
          pin: null,
          qrValue: session.pairing.pairingUrl,
          pairingUrl: session.pairing.pairingUrl,
          guestAllowed: false,
        },
        guestAllowed: false,
        encrypted: Boolean(session.pairing.encrypted),
        verifiedAt: session.pairing.verifiedAt ?? null,
      },
      summary: this.buildSummary(session),
      queue: this.buildQueue(session),
      files: {
        'desktop-to-phone': session.files['desktop-to-phone'].map((file) => this.publicFile(file)),
        'phone-to-desktop': session.files['phone-to-desktop'].map((file) => this.publicFile(file)),
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
      progressPercent: upload.size > 0 ? Math.max(0, Math.min(100, Math.round((upload.uploadedBytes / upload.size) * 100))) : 0,
    });
  }

  publicSettings() {
    const { publicOrigin, ...rest } = this.settings;
    return structuredClone(rest);
  }

  publicDevice(device, fallbackIcon) {
    if (!device) {
      return device;
    }

    return {
      ...device,
      icon: sanitizeDeviceIcon(device.icon) ?? fallbackIcon,
    };
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
      pin: null,
      localDevice: this.publicDevice(session.localDevice, 'desktop'),
      peerDevice: session.peerDevice ? this.publicDevice(session.peerDevice, 'phone') : session.peerDevice,
      summary: this.buildSummary(session),
      fileCount: this.countFiles(session),
      files: this.allFiles(session).map((file) => this.publicFile(file)),
    };
  }

  buildSummary(session) {
    const files = this.allFiles(session);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const completedFiles = files.filter((file) => file.status === 'downloaded').length;
    const completedBytes = files
      .filter((file) => file.status === 'downloaded')
      .reduce((sum, file) => sum + file.size, 0);

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
    const items = this.allFiles(session).map((file) => ({
      id: file.id,
      name: file.name,
      relativePath: file.relativePath ?? null,
      direction: file.direction,
      status: file.status,
      size: file.size,
      progress: file.status === 'downloaded' ? 100 : 0,
    }));

    return {
      items,
      totalFiles: items.length,
      completedFiles: items.filter((item) => item.status === 'downloaded').length,
      totalBytes: items.reduce((sum, item) => sum + item.size, 0),
    };
  }

  countFiles(session) {
    return this.allFiles(session).length;
  }

  matchesHistoryQuery(session, normalizedQuery) {
    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      session.id,
      session.localDevice?.name,
      session.peerDevice?.name,
      session.peerDevice?.platform,
      ...this.allFiles(session).flatMap((file) => [file.name, file.relativePath, file.sourceDeviceName]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  }

  allFiles(session) {
    return [...session.files['desktop-to-phone'], ...session.files['phone-to-desktop']];
  }

  sortedSessions() {
    return [...this.sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  broadcast(type, payload) {
    if (typeof this.emit === 'function') {
      this.emit(type, payload);
    }
  }

  emptyQueue() {
    return {
      items: [],
      totalFiles: 0,
      completedFiles: 0,
      totalBytes: 0,
    };
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
    return {
      text: '',
      updatedAt: null,
      sourceDeviceName: null,
      sourceRole: null,
    };
  }

  async receivePlainChunk(request, destinationPath) {
    const counter = new ByteCounterStream();
    const target = createWriteStream(destinationPath, { flags: 'a' });
    await pipeline(request, counter, target);
    return counter.bytesWritten;
  }

  async receiveEncryptedChunk(upload, requestChunkIndex, request, destinationPath) {
    const body = await readJson(request);
    if (!body?.encrypted || !body?.chunk) {
      throw httpError(400, 'encrypted upload chunk payload is invalid');
    }

    const sessionSecret = this.sessionSecrets.get(upload.sessionId);
    if (!sessionSecret) {
      throw httpError(409, 'session encryption key is not available');
    }

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
    if (file.downloadedAt) {
      return;
    }

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

  _transform(chunk, encoding, callback) {
    this.bytesWritten += chunk.length;
    callback(null, chunk);
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
  const normalized = candidate
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || 'incoming.bin';
}

function sanitizeContentType(value) {
  const candidate = sanitizeText(value);
  return candidate || 'application/octet-stream';
}

function sanitizeText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function sanitizeRelativePath(value, fallbackName) {
  const candidate = sanitizeText(value);
  if (!candidate) {
    return null;
  }

  const normalized = candidate
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001f]/g, '_'))
    .filter((segment) => segment !== '.' && segment !== '..');

  if (!normalized.length) {
    return fallbackName ?? null;
  }

  return normalized.join('/');
}

function sanitizeSearchQuery(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sanitizeDeviceIcon(value) {
  return ['desktop', 'laptop', 'phone', 'tablet'].includes(value) ? value : null;
}

function sanitizePositiveNumber(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw httpError(400, `${fieldName} must be a non-negative number`);
  }

  return numeric;
}

function sanitizeChunkSize(value) {
  const numeric = sanitizePositiveNumber(value, 'chunkSize');
  if (numeric <= 0) {
    throw httpError(400, 'chunkSize must be greater than zero');
  }

  return Math.min(Math.max(Math.floor(numeric), 64 * 1024), 8 * 1024 * 1024);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 'http://127.0.0.1:17619';
  }

  return value.replace(/\/+$/, '');
}

async function drainRequest(request) {
  for await (const _chunk of request) {
    // Intentionally discard already-received request bodies.
  }
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
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

async function hashFile(path) {
  const hash = createHash('sha256');
  const source = await readFile(path);
  hash.update(source);
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
  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) {
    return null;
  }

  return ended - started;
}

function calculateAverageBytesPerSecond(startedAt, uploadedBytes) {
  const durationMs = calculateDurationMs(startedAt);
  if (!durationMs || durationMs <= 0) {
    return null;
  }

  return Math.round((uploadedBytes / durationMs) * 1000);
}

function relativeToData(dataDir, absolutePath) {
  return absolutePath.startsWith(dataDir) ? absolutePath.slice(dataDir.length + 1) : absolutePath;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
