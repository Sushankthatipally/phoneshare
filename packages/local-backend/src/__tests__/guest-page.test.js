/*
 * Tests for the guest browser page renderer (`/guest/:token` HTML view).
 *
 * Verifies the requirements from W17:
 *  - No `127.0.0.1` or other loopback URLs leak into the rendered page.
 *  - "Uses left" reflects (maxUses - uses) accurately.
 *  - Files ≥ 500 MB display the storage caution badge.
 *  - Mandatory accessibility / safety markers are present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderGuestPageHtml, renderGuestExpiredHtml, __test } from '../guest-page.js';

function makeShare(overrides = {}) {
  return {
    id: 'share-id',
    token: 'abc123',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    maxUses: 1,
    uses: 0,
    files: [
      { id: 'f1', name: 'vacation.jpg', size: 2_400_000, mimeType: 'image/jpeg' },
    ],
    sharerName: null,
    ...overrides,
  };
}

test('renderGuestPageHtml: no loopback URLs leak into rendered page', () => {
  const html = renderGuestPageHtml(makeShare());
  assert.ok(!html.includes('127.0.0.1'), 'expected no 127.0.0.1 in HTML');
  assert.ok(!html.includes('localhost'), 'expected no localhost in HTML');
  assert.ok(!html.includes('0.0.0.0'), 'expected no 0.0.0.0 in HTML');
  // All asset URLs must be relative so the page works whether served over http or https.
  assert.ok(!/href="http:\/\//.test(html), 'expected no absolute http:// URLs');
  assert.ok(!/src="http:\/\//.test(html), 'expected no absolute http:// src URLs');
});

test('renderGuestPageHtml: shows correct "uses left" when maxUses=2, uses=1', () => {
  const html = renderGuestPageHtml(makeShare({ maxUses: 2, uses: 1 }));
  assert.match(html, /Uses left[\s\S]*?1 of 2/);
});

test('renderGuestPageHtml: shows large-file warning for >= 500 MB files', () => {
  const html = renderGuestPageHtml(
    makeShare({
      files: [{ id: 'big', name: 'movie.mkv', size: 600 * 1024 * 1024, mimeType: 'video/x-matroska' }],
    })
  );
  assert.match(html, /Large file/);
  assert.match(html, /make sure you have enough storage/);
});

test('renderGuestPageHtml: small files do not get the warning', () => {
  const html = renderGuestPageHtml(makeShare());
  assert.ok(!html.includes('Large file'), 'small file should not show warning');
});

test('renderGuestPageHtml: aria-label is set on every download button', () => {
  const html = renderGuestPageHtml(
    makeShare({
      files: [
        { id: 'a', name: 'one.txt', size: 100, mimeType: 'text/plain' },
        { id: 'b', name: 'two.txt', size: 200, mimeType: 'text/plain' },
      ],
    })
  );
  const matches = html.match(/aria-label="Download [^"]+"/g) ?? [];
  // Two per-file buttons + the bulk button when >1 file.
  assert.ok(matches.length >= 3, `expected ≥3 aria-label downloads, got ${matches.length}`);
});

test('renderGuestPageHtml: shows sharerName when present, never hardcodes a default', () => {
  const html = renderGuestPageHtml(makeShare({ sharerName: 'Nihesh\'s MacBook' }));
  assert.match(html, /Nihesh&#39;s MacBook/);
  assert.match(html, /wants to share 1 file with you/);
  // No "John's iPhone" or "Welcome to DropBeam" anywhere.
  assert.ok(!html.includes("John's iPhone"));
  assert.ok(!html.includes('Welcome'));
});

test('renderGuestPageHtml: omits sharerName line when unknown', () => {
  const html = renderGuestPageHtml(makeShare({ sharerName: null }));
  assert.match(html, /1 file shared with you/);
  assert.ok(!html.includes('wants to share'));
});

test('renderGuestPageHtml: escapes hostile filenames', () => {
  const html = renderGuestPageHtml(
    makeShare({
      files: [{ id: 'x', name: '<script>alert(1)</script>.txt', size: 5, mimeType: 'text/plain' }],
    })
  );
  assert.ok(!html.includes('<script>alert(1)</script>.txt'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;\.txt/);
});

test('renderGuestPageHtml: shows bulk "Download all" only with multiple files', () => {
  const singleHtml = renderGuestPageHtml(makeShare());
  assert.ok(!singleHtml.includes('Download all'));

  const multiHtml = renderGuestPageHtml(
    makeShare({
      files: [
        { id: 'a', name: 'a.txt', size: 1, mimeType: 'text/plain' },
        { id: 'b', name: 'b.txt', size: 2, mimeType: 'text/plain' },
      ],
    })
  );
  assert.match(multiHtml, /Download all \(2\)/);
});

test('renderGuestPageHtml: includes prefers-color-scheme media query', () => {
  const html = renderGuestPageHtml(makeShare());
  assert.match(html, /prefers-color-scheme: light/);
  assert.match(html, /color-scheme.*dark light/);
});

test('renderGuestPageHtml: download href is relative + uses the API contract', () => {
  const html = renderGuestPageHtml(makeShare());
  assert.match(html, /href="\/api\/guest\/abc123\/files\/download\?fileId=f1"/);
});

test('renderGuestExpiredHtml: minimal expired view, no emoji, no loopback', () => {
  const html = renderGuestExpiredHtml();
  assert.match(html, /Link expired/);
  assert.ok(!html.includes('127.0.0.1'));
  assert.ok(!html.includes('localhost'));
  // No emoji shrapnel.
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(html));
});

test('LARGE_FILE_BYTES threshold matches spec (500 MB)', () => {
  assert.equal(__test.LARGE_FILE_BYTES, 500 * 1024 * 1024);
});

test('kindLabel returns short uppercase tags', () => {
  assert.equal(__test.kindLabel('image/jpeg'), 'IMG');
  assert.equal(__test.kindLabel('video/mp4'), 'VID');
  assert.equal(__test.kindLabel('application/pdf'), 'PDF');
  assert.equal(__test.kindLabel('application/zip'), 'ZIP');
  assert.equal(__test.kindLabel('application/octet-stream'), 'FILE');
});

test('rendered page does NOT contain emojis (UI rule)', () => {
  const html = renderGuestPageHtml(
    makeShare({
      sharerName: 'Test Device',
      files: [
        { id: 'a', name: 'a.txt', size: 1, mimeType: 'text/plain' },
        { id: 'b', name: 'b.bin', size: 600 * 1024 * 1024, mimeType: 'application/octet-stream' },
      ],
    })
  );
  // Match any emoji from the Unicode emoji extended-pictographic ranges.
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.ok(!emojiRe.test(html), 'rendered HTML must not contain emoji');
});
