import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WatchFolderDriver, fileAllowedByConfig } from '../watch-folders.js';

function createStub({ watchFolders, sessions = [], onStartUpload } = {}) {
  return {
    getSettings: () => ({ deviceName: 'desktop-stub', watchFolders }),
    listSessions: () => sessions,
    startUpload: async (sessionId, payload) => {
      onStartUpload?.({ sessionId, payload });
      return { id: `upload-${payload.name}` };
    },
  };
}

async function makeFolder(prefix) {
  return mkdtemp(join(tmpdir(), `dropbeam-watch-${prefix}-`));
}

describe('WatchFolderDriver.notePeerConnected', () => {
  it('fires an upload for a new file when the destination peer connects', async () => {
    const folderPath = await makeFolder('connect');
    try {
      const filePath = join(folderPath, 'photo.jpg');
      await writeFile(filePath, Buffer.alloc(2048, 7));
      const watchFolder = {
        id: 'wf-1',
        path: folderPath,
        destinationFingerprint: 'ios:phone-a',
        destinationLabel: 'iPhone',
        trigger: 'on-connect',
        fileTypes: 'all',
      };
      const sessions = [
        {
          id: 'session-1',
          state: 'paired',
          peerDevice: { fingerprint: 'ios:phone-a' },
        },
      ];
      const uploads = [];
      const broadcasts = [];
      const driver = new WatchFolderDriver({
        store: createStub({
          watchFolders: [watchFolder],
          sessions,
          onStartUpload: (call) => uploads.push(call),
        }),
        broadcast: (type, payload) => broadcasts.push({ type, payload }),
      });

      const fired = await driver.notePeerConnected('ios:phone-a');

      assert.equal(fired.length, 1);
      assert.equal(fired[0].uploadId, 'upload-photo.jpg');
      assert.equal(fired[0].file.name, 'photo.jpg');
      assert.equal(fired[0].destinationFingerprint, 'ios:phone-a');
      assert.equal(fired[0].file.size, 2048);
      assert.match(fired[0].file.sha256Prefix, /^[0-9a-f]{64}$/);
      assert.equal(uploads.length, 1);
      assert.equal(uploads[0].sessionId, 'session-1');
      assert.equal(uploads[0].payload.direction, 'desktop-to-phone');
      assert.equal(broadcasts.length, 1);
      assert.equal(broadcasts[0].type, 'watch-folder-fired');

      const second = await driver.notePeerConnected('ios:phone-a');
      assert.equal(second.length, 0, 'cursor should prevent re-firing on the same file');
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it('does nothing when no watch-folder matches the fingerprint', async () => {
    const driver = new WatchFolderDriver({
      store: createStub({ watchFolders: [] }),
    });
    const fired = await driver.notePeerConnected('unknown:device');
    assert.deepEqual(fired, []);
  });
});

describe('fileAllowedByConfig', () => {
  it("rejects .exe when fileTypes is 'images'", () => {
    const folder = { fileTypes: 'images' };
    assert.equal(fileAllowedByConfig(folder, '/tmp/malware.exe'), false);
    assert.equal(fileAllowedByConfig(folder, '/tmp/photo.JPG'), true);
    assert.equal(fileAllowedByConfig(folder, '/tmp/clip.heic'), true);
  });

  it("accepts everything when fileTypes is 'all' or undefined", () => {
    assert.equal(fileAllowedByConfig({ fileTypes: 'all' }, '/tmp/file.exe'), true);
    assert.equal(fileAllowedByConfig({}, '/tmp/file.exe'), true);
  });

  it('honors custom extension allow-lists', () => {
    const folder = { fileTypes: ['pdf', '.txt'] };
    assert.equal(fileAllowedByConfig(folder, '/tmp/note.txt'), true);
    assert.equal(fileAllowedByConfig(folder, '/tmp/doc.PDF'), true);
    assert.equal(fileAllowedByConfig(folder, '/tmp/run.exe'), false);
  });
});

describe('WatchFolderDriver.noteFileDetected', () => {
  it('fires for an out-of-cursor file path', async () => {
    const folderPath = await makeFolder('detected');
    try {
      const filePath = join(folderPath, 'snap.png');
      await writeFile(filePath, Buffer.alloc(512, 3));
      const watchFolder = {
        id: 'wf-detect',
        path: folderPath,
        destinationFingerprint: 'android:phone-b',
        destinationLabel: 'Pixel',
        trigger: 'on-connect',
        fileTypes: 'images',
      };
      const broadcasts = [];
      const driver = new WatchFolderDriver({
        store: createStub({
          watchFolders: [watchFolder],
          sessions: [{ id: 's1', state: 'paired', peerDevice: { fingerprint: 'android:phone-b' } }],
        }),
        broadcast: (type, payload) => broadcasts.push({ type, payload }),
      });
      const fired = await driver.noteFileDetected({ watchFolderId: 'wf-detect', path: filePath });
      assert.ok(fired);
      assert.equal(fired.file.name, 'snap.png');
      assert.equal(broadcasts.length, 1);
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it('returns null when the file extension fails the filter', async () => {
    const folderPath = await makeFolder('reject');
    try {
      const filePath = join(folderPath, 'tool.exe');
      await writeFile(filePath, Buffer.alloc(16, 1));
      const watchFolder = {
        id: 'wf-reject',
        path: folderPath,
        destinationFingerprint: 'ios:phone-c',
        destinationLabel: 'iPad',
        trigger: 'on-connect',
        fileTypes: 'images',
      };
      const driver = new WatchFolderDriver({
        store: createStub({ watchFolders: [watchFolder] }),
      });
      const fired = await driver.noteFileDetected({ watchFolderId: 'wf-reject', path: filePath });
      assert.equal(fired, null);
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });
});
