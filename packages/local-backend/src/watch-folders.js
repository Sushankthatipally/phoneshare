import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve as resolvePath } from 'node:path';

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'avif',
]);

const HASH_PREFIX_BYTES = 256 * 1024;
const DEFAULT_MIME = 'application/octet-stream';

const MIME_BY_EXTENSION = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['heic', 'image/heic'],
  ['avif', 'image/avif'],
  ['mp4', 'video/mp4'],
  ['mov', 'video/quicktime'],
  ['mkv', 'video/x-matroska'],
  ['pdf', 'application/pdf'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['json', 'application/json'],
  ['zip', 'application/zip'],
]);

export class WatchFolderDriver {
  constructor({ store, broadcast, sessionFactory, now = () => new Date(), log = () => {} } = {}) {
    if (!store) throw new Error('WatchFolderDriver requires a store');
    this.store = store;
    this.broadcast = typeof broadcast === 'function' ? broadcast : () => {};
    this.sessionFactory = typeof sessionFactory === 'function'
      ? sessionFactory
      : null;
    this.now = now;
    this.log = log;
    this.cursors = new Map();
  }

  cursorKey(watchFolderId, peerFingerprint) {
    return `${watchFolderId}::${peerFingerprint ?? 'unknown'}`;
  }

  getCursor(watchFolderId, peerFingerprint) {
    return this.cursors.get(this.cursorKey(watchFolderId, peerFingerprint)) ?? 0;
  }

  setCursor(watchFolderId, peerFingerprint, mtimeMs) {
    this.cursors.set(this.cursorKey(watchFolderId, peerFingerprint), mtimeMs);
  }

  listWatchFolders() {
    const settings = this.store.getSettings?.() ?? {};
    return Array.isArray(settings.watchFolders) ? settings.watchFolders : [];
  }

  watchFoldersFor(fingerprint) {
    return this.listWatchFolders().filter(
      (folder) => folder?.destinationFingerprint === fingerprint && folder?.trigger === 'on-connect',
    );
  }

  async notePeerConnected(fingerprint) {
    if (!fingerprint || typeof fingerprint !== 'string') return [];
    const folders = this.watchFoldersFor(fingerprint);
    const fired = [];
    for (const folder of folders) {
      try {
        const folderFired = await this.scanFolder(folder, fingerprint);
        fired.push(...folderFired);
      } catch (error) {
        this.log(`watch-folder scan failed for ${folder.id}: ${error?.message ?? error}`);
      }
    }
    return fired;
  }

  async noteFileDetected({ watchFolderId, path }) {
    if (!watchFolderId || typeof path !== 'string') {
      throw httpError(400, 'watchFolderId and path are required');
    }
    const folder = this.listWatchFolders().find((f) => f?.id === watchFolderId);
    if (!folder) throw httpError(404, `watch folder ${watchFolderId} not found`);
    const fingerprint = folder.destinationFingerprint;
    try {
      const fileStat = await stat(path);
      if (!fileStat.isFile()) return null;
      if (!fileAllowedByConfig(folder, path)) return null;
      const cursor = this.getCursor(folder.id, fingerprint);
      if (fileStat.mtimeMs <= cursor) return null;
      const result = await this.fireFile(folder, path, fileStat, fingerprint);
      if (result) this.setCursor(folder.id, fingerprint, fileStat.mtimeMs);
      return result;
    } catch (error) {
      this.log(`watch-folder file-detected failed: ${error?.message ?? error}`);
      throw error;
    }
  }

  async scanFolder(folder, fingerprint) {
    const fired = [];
    const root = folder.path;
    if (!root) return fired;
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      this.log(`watch-folder readdir failed for ${root}: ${error?.message ?? error}`);
      return fired;
    }
    const cursor = this.getCursor(folder.id, fingerprint);
    let highest = cursor;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = join(root, entry.name);
      if (!fileAllowedByConfig(folder, filePath)) continue;
      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        continue;
      }
      if (fileStat.mtimeMs <= cursor) continue;
      try {
        const result = await this.fireFile(folder, filePath, fileStat, fingerprint);
        if (result) {
          fired.push(result);
          if (fileStat.mtimeMs > highest) highest = fileStat.mtimeMs;
        }
      } catch (error) {
        this.log(`watch-folder fireFile failed for ${filePath}: ${error?.message ?? error}`);
      }
    }
    if (highest > cursor) this.setCursor(folder.id, fingerprint, highest);
    return fired;
  }

  async fireFile(folder, filePath, fileStat, fingerprint) {
    const sha256Prefix = await hashFilePrefix(filePath, HASH_PREFIX_BYTES);
    const sessionId = await this.resolveSessionForFingerprint(fingerprint);
    const name = basenameOf(filePath);
    const mimeType = inferMime(filePath);
    let uploadId = null;
    if (sessionId && typeof this.store.startUpload === 'function') {
      const chunkSize = 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(fileStat.size / chunkSize));
      const upload = await this.store.startUpload(sessionId, {
        direction: 'desktop-to-phone',
        name,
        relativePath: name,
        mimeType,
        size: fileStat.size,
        chunkSize,
        totalChunks,
        lastModified: Math.round(fileStat.mtimeMs),
        deviceName: this.store.getSettings?.()?.deviceName ?? null,
      });
      uploadId = upload?.id ?? null;
    }
    const payload = {
      watchFolderId: folder.id,
      watchFolderPath: folder.path,
      destinationFingerprint: fingerprint,
      destinationLabel: folder.destinationLabel ?? '',
      sessionId: sessionId ?? null,
      uploadId: uploadId ?? '',
      file: {
        name,
        relativePath: name,
        size: fileStat.size,
        mimeType,
        lastModified: Math.round(fileStat.mtimeMs),
        sha256Prefix,
      },
      firedAt: this.now().toISOString(),
    };
    this.broadcast('watch-folder-fired', payload);
    return payload;
  }

  async resolveSessionForFingerprint(fingerprint) {
    const sessions = typeof this.store.listSessions === 'function' ? this.store.listSessions() : [];
    const active = sessions.find(
      (s) => s?.peerDevice?.fingerprint === fingerprint && ['paired', 'transferring'].includes(s.state),
    );
    if (active) return active.id;
    if (this.sessionFactory) {
      try {
        const created = await this.sessionFactory({ fingerprint });
        return created?.id ?? null;
      } catch (error) {
        this.log(`watch-folder sessionFactory failed: ${error?.message ?? error}`);
      }
    }
    return null;
  }
}

export function fileAllowedByConfig(folder, filePath) {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  const types = folder?.fileTypes;
  if (!types || types === 'all') return true;
  if (types === 'images') return IMAGE_EXTENSIONS.has(ext);
  if (Array.isArray(types)) {
    const normalized = types
      .map((value) => String(value).replace(/^\./, '').toLowerCase())
      .filter(Boolean);
    return normalized.length === 0 || normalized.includes(ext);
  }
  return true;
}

export async function hashFilePrefix(filePath, byteLimit = HASH_PREFIX_BYTES) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(byteLimit);
    const { bytesRead } = await handle.read(buffer, 0, byteLimit, 0);
    const hash = createHash('sha256');
    hash.update(buffer.subarray(0, bytesRead));
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

function basenameOf(filePath) {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || 'incoming.bin';
}

function inferMime(filePath) {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  return MIME_BY_EXTENSION.get(ext) ?? DEFAULT_MIME;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function resolveWatchFolderPath(path) {
  return resolvePath(path);
}
