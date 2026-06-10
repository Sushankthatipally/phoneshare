/*
 * DropBeam web-share browser page.
 *
 * Renders the HTML/CSS/JS served at `/guest/:token` to a phone on the same LAN.
 * Every visible value comes from the share record — no hardcoded device names,
 * no marketing copy, no emoji. The CSS mirrors the desktop tokens
 * (`packages/shared-ui/src/tokens.css`) so the web-share page matches the rest of
 * DropBeam. Inlined into one HTML document — no external assets, no CDN fonts.
 */

const LARGE_FILE_BYTES = 500 * 1024 * 1024; // 500 MB threshold for the storage caution.

/**
 * Render the web-share browser HTML for a share record.
 *
 * @param {{ token: string, files: Array<{id:string,name:string,size:number,mimeType:string}>, expiresAt: string, maxUses: number, uses: number, sharerName?: string|null }} share
 * @returns {string} self-contained HTML document
 */
export function renderGuestPageHtml(share) {
  const sharerName = sanitize(share.sharerName);
  const files = Array.isArray(share.files) ? share.files : [];
  const fileCount = files.length;
  const usesLeft = Math.max(0, (Number(share.maxUses) || 0) - (Number(share.uses) || 0));
  const expiresAt = String(share.expiresAt ?? '');

  const heading = sharerName
    ? `${escapeHtml(sharerName)} wants to share ${fileCount} file${fileCount === 1 ? '' : 's'} with you`
    : `${fileCount} file${fileCount === 1 ? '' : 's'} shared with you`;

  const fileRows = files
    .map((file) => {
      const id = String(file.id ?? '');
      const name = String(file.name ?? '');
      const size = Number(file.size) || 0;
      const mime = String(file.mimeType ?? 'application/octet-stream');
      const isLarge = size >= LARGE_FILE_BYTES;
      const downloadHref = `/api/guest/${encodeURIComponent(share.token)}/files/download?fileId=${encodeURIComponent(id)}`;
      return `
      <li class="db-file" data-file-id="${escapeAttr(id)}" data-file-size="${size}" data-file-name="${escapeAttr(name)}">
        <div class="db-file__icon" aria-hidden="true">${kindLabel(mime)}</div>
        <div class="db-file__meta">
          <p class="db-file__name">${escapeHtml(name)}</p>
          <p class="db-file__sub">
            <span>${formatBytes(size)}</span>
            <span>${escapeHtml(mime)}</span>
          </p>
          ${
            isLarge
              ? `<p class="db-file__warn" role="note">Large file &mdash; make sure you have enough storage</p>`
              : ''
          }
          <div class="db-file__track" aria-hidden="true"><div class="db-file__fill" data-fill></div></div>
          <p class="db-file__status" data-status></p>
        </div>
        <a class="db-file__download db-button db-button--primary"
           href="${downloadHref}"
           download="${escapeAttr(name)}"
           data-download
           aria-label="Download ${escapeAttr(name)}">
          Download
        </a>
      </li>`;
    })
    .join('');

  // Inline runtime constants the page-side JS needs. JSON.stringify is safe for embedding
  // inside a <script> tag because all dynamic strings are also re-escaped via escapeJson.
  const inlineConfig = escapeJson({
    expiresAt,
    token: String(share.token ?? ''),
    files: files.map((f) => ({
      id: String(f.id ?? ''),
      name: String(f.name ?? ''),
      size: Number(f.size) || 0,
    })),
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DropBeam &mdash; Web Share</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <meta name="referrer" content="no-referrer" />
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main class="db-shell">
    <header class="db-header">
      <div class="db-header__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="2" width="12" height="20" rx="2.2" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
      </div>
      <div class="db-header__text">
        <p class="db-header__eyebrow">DropBeam &middot; Web Share</p>
        <h1 class="db-header__title">${heading}</h1>
      </div>
    </header>

    ${
      fileCount > 1
        ? `
    <section class="db-bulk">
      <button class="db-button db-button--secondary" type="button" data-download-all aria-label="Download all ${fileCount} files">
        Download all (${fileCount})
      </button>
      <div class="db-bulk__progress" data-bulk-progress hidden>
        <div class="db-bulk__track"><div class="db-bulk__fill" data-bulk-fill></div></div>
        <p class="db-bulk__status" data-bulk-status></p>
      </div>
    </section>`
        : ''
    }

    <ul class="db-files" role="list">${fileRows || '<li class="db-empty">No files in this share.</li>'}</ul>

    <footer class="db-footer">
      <p class="db-footer__line">
        <span class="db-footer__label">Expires</span>
        <span data-expires>&hellip;</span>
      </p>
      <p class="db-footer__line">
        <span class="db-footer__label">Uses left</span>
        <span>${usesLeft} of ${Number(share.maxUses) || 0}</span>
      </p>
    </footer>
  </main>

  <script>${PAGE_JS}</script>
  <script>window.__DB_SHARE__ = ${inlineConfig}; window.__DB_BOOT__ && window.__DB_BOOT__();</script>
</body>
</html>`;
}

/**
 * Render the 404 page shown when a share is missing or already used up. Same design
 * language as the main page but stripped down to the minimum.
 */
export function renderGuestExpiredHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DropBeam &mdash; Link expired</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main class="db-shell db-shell--center">
    <header class="db-header db-header--solo">
      <div class="db-header__text">
        <p class="db-header__eyebrow">DropBeam</p>
        <h1 class="db-header__title">Link expired</h1>
        <p class="db-header__sub">This share is no longer available. Ask the sender for a new link.</p>
      </div>
    </header>
  </main>
</body>
</html>`;
}

// ─── HTML/CSS/JS pieces ────────────────────────────────────────────────────────

const PAGE_CSS = `
:root {
  --db-bg: #000000;
  --db-panel-bg: rgba(12, 12, 12, 0.96);
  --db-panel-border: rgba(255, 255, 255, 0.12);
  --db-panel-border-strong: rgba(255, 255, 255, 0.18);
  --db-text: #f4f4f4;
  --db-text-soft: rgba(255, 255, 255, 0.68);
  --db-text-dim: rgba(255, 255, 255, 0.48);
  --db-blue: #c6e3ff;
  --db-green: #c7ffd4;
  --db-amber: #ffe2a8;
  --db-track: rgba(255, 255, 255, 0.09);
  --db-fill: linear-gradient(90deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.55));
  --db-radius: 10px;
  --db-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  --db-font: "Inter", "Segoe UI", "Helvetica Neue", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

@media (prefers-color-scheme: light) {
  :root {
    --db-bg: #f7f7f8;
    --db-panel-bg: #ffffff;
    --db-panel-border: rgba(0, 0, 0, 0.10);
    --db-panel-border-strong: rgba(0, 0, 0, 0.18);
    --db-text: #0c0c0c;
    --db-text-soft: rgba(0, 0, 0, 0.66);
    --db-text-dim: rgba(0, 0, 0, 0.48);
    --db-track: rgba(0, 0, 0, 0.08);
    --db-fill: linear-gradient(90deg, #0c0c0c, rgba(12, 12, 12, 0.6));
    --db-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--db-bg);
  color: var(--db-text);
  font-family: var(--db-font);
  font-size: 16px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  padding: clamp(16px, 4vw, 32px);
}

.db-shell {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  display: grid;
  gap: 20px;
}
.db-shell--center {
  min-height: calc(100vh - 64px);
  align-content: center;
}

.db-header {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  align-items: center;
  padding: 18px;
  border: 1px solid var(--db-panel-border);
  border-radius: var(--db-radius);
  background: var(--db-panel-bg);
  box-shadow: var(--db-shadow);
}
.db-header--solo {
  grid-template-columns: 1fr;
  text-align: center;
}
.db-header__icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  border: 1px solid var(--db-panel-border);
  background: rgba(127, 127, 127, 0.05);
  color: var(--db-blue);
}
.db-header__eyebrow {
  margin: 0 0 4px;
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--db-text-soft);
}
.db-header__title {
  margin: 0;
  font-size: clamp(1.05rem, 4.5vw, 1.35rem);
  line-height: 1.25;
  letter-spacing: -0.02em;
  font-weight: 600;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.db-header__sub {
  margin: 8px 0 0;
  color: var(--db-text-soft);
  font-size: 0.92rem;
}

.db-bulk {
  display: grid;
  gap: 12px;
}
.db-bulk__progress { display: grid; gap: 6px; }
.db-bulk__track {
  height: 6px;
  border-radius: 999px;
  background: var(--db-track);
  overflow: hidden;
}
.db-bulk__fill {
  height: 100%;
  width: 0;
  background: var(--db-fill);
  transition: width 160ms linear;
}
.db-bulk__status {
  margin: 0;
  font-size: 0.78rem;
  color: var(--db-text-soft);
}

.db-files {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}

.db-file {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--db-panel-border);
  border-radius: var(--db-radius);
  background: var(--db-panel-bg);
  box-shadow: var(--db-shadow);
}
.db-file__icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid var(--db-panel-border);
  background: rgba(127, 127, 127, 0.05);
  color: var(--db-text-soft);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.db-file__meta { min-width: 0; display: grid; gap: 6px; }
.db-file__name {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.db-file__sub {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
  color: var(--db-text-soft);
  font-size: 0.82rem;
}
.db-file__sub span { white-space: nowrap; }
.db-file__warn {
  margin: 4px 0 0;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--db-panel-border);
  color: var(--db-amber);
  background: rgba(255, 226, 168, 0.08);
  font-size: 0.78rem;
  line-height: 1.35;
}
.db-file__track {
  height: 4px;
  border-radius: 999px;
  background: var(--db-track);
  overflow: hidden;
  margin-top: 4px;
}
.db-file__fill {
  height: 100%;
  width: 0;
  background: var(--db-fill);
  transition: width 160ms linear;
}
.db-file__status {
  margin: 0;
  font-size: 0.75rem;
  color: var(--db-text-soft);
  min-height: 1em;
}

.db-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid var(--db-panel-border);
  background: rgba(127, 127, 127, 0.04);
  color: var(--db-text);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
  user-select: none;
}
.db-button:hover:not(:disabled) {
  border-color: var(--db-panel-border-strong);
  transform: translateY(-1px);
}
.db-button:focus-visible {
  outline: 2px solid var(--db-blue);
  outline-offset: 2px;
}
.db-button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.db-button--primary {
  background: var(--db-text);
  color: var(--db-bg);
  border-color: var(--db-text);
}
.db-button--secondary { background: rgba(127, 127, 127, 0.08); }

.db-footer {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--db-panel-border);
  border-radius: var(--db-radius);
  background: var(--db-panel-bg);
  font-size: 0.85rem;
  color: var(--db-text-soft);
}
.db-footer__line {
  margin: 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.db-footer__label {
  color: var(--db-text-dim);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 0.7rem;
}

.db-empty {
  padding: 18px;
  text-align: center;
  color: var(--db-text-soft);
  border: 1px dashed var(--db-panel-border);
  border-radius: var(--db-radius);
}
`;

// Page-side runtime: per-file streamed download with progress, sequential bulk download,
// human-relative expiry, and accessible status text. Plain JS (no module imports) so it
// runs on any modern browser including iOS Safari and Android Chrome.
const PAGE_JS = `
(function () {
  function fmtBytes(n) {
    if (!isFinite(n) || n <= 0) return '0 B';
    var u = ['B','KB','MB','GB','TB'], i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function fmtRelative(target) {
    var diff = target - Date.now();
    var abs = Math.abs(diff);
    var sign = diff < 0 ? 'ago' : '';
    var prefix = diff < 0 ? '' : 'in ';
    var min = 60 * 1000, hour = 60 * min, day = 24 * hour;
    var text;
    if (abs < min) text = Math.max(1, Math.round(abs / 1000)) + ' sec';
    else if (abs < hour) text = Math.round(abs / min) + ' min';
    else if (abs < day) text = Math.round(abs / hour) + ' hour' + (Math.round(abs/hour)===1?'':'s');
    else text = Math.round(abs / day) + ' day' + (Math.round(abs/day)===1?'':'s');
    return diff < 0 ? text + ' ago' : prefix + text;
  }
  function safeName(name) {
    return String(name || 'file.bin').replace(/[^\\w.\\-]+/g, '_').slice(0, 200) || 'file.bin';
  }

  async function streamDownload(file, opts) {
    var url = '/api/guest/' + encodeURIComponent(window.__DB_SHARE__.token) +
              '/files/download?fileId=' + encodeURIComponent(file.id);
    var res = await fetch(url, { credentials: 'omit' });
    if (!res.ok || !res.body) throw new Error('Download failed (' + res.status + ')');
    var total = Number(res.headers.get('Content-Length')) || file.size || 0;
    var received = 0;
    var reader = res.body.getReader();
    var chunks = [];
    while (true) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      received += step.value.length;
      if (opts && opts.onProgress) opts.onProgress(received, total);
    }
    var blob = new Blob(chunks, { type: 'application/octet-stream' });
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = safeName(file.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
  }

  function wireRow(li) {
    var fileId = li.getAttribute('data-file-id');
    var fileName = li.getAttribute('data-file-name');
    var fileSize = Number(li.getAttribute('data-file-size')) || 0;
    var link = li.querySelector('[data-download]');
    var fill = li.querySelector('[data-fill]');
    var status = li.querySelector('[data-status]');
    if (!link) return;
    link.addEventListener('click', async function (event) {
      // Use the streaming path so we can show progress. Fall back to the native
      // anchor if anything goes wrong (offline, fetch unavailable, etc.).
      if (!window.fetch || !window.ReadableStream) return;
      event.preventDefault();
      link.setAttribute('aria-disabled', 'true');
      try {
        await streamDownload({ id: fileId, name: fileName, size: fileSize }, {
          onProgress: function (n, total) {
            var pct = total > 0 ? Math.min(100, Math.round((n / total) * 100)) : 0;
            if (fill) fill.style.width = pct + '%';
            if (status) status.textContent = fmtBytes(n) + (total > 0 ? ' of ' + fmtBytes(total) + ' (' + pct + '%)' : '');
          }
        });
        if (status) status.textContent = 'Downloaded';
      } catch (err) {
        if (status) status.textContent = 'Failed: ' + (err && err.message ? err.message : 'unknown error');
      } finally {
        link.removeAttribute('aria-disabled');
      }
    });
  }

  function wireBulk() {
    var btn = document.querySelector('[data-download-all]');
    if (!btn) return;
    var progress = document.querySelector('[data-bulk-progress]');
    var fill = document.querySelector('[data-bulk-fill]');
    var status = document.querySelector('[data-bulk-status]');
    var files = (window.__DB_SHARE__.files || []);
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      if (progress) progress.hidden = false;
      var totalBytes = files.reduce(function (s, f) { return s + (f.size || 0); }, 0);
      var transferred = 0;
      var doneCount = 0;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var pre = transferred;
        try {
          await streamDownload(f, {
            onProgress: function (n) {
              var p = totalBytes > 0 ? Math.min(100, Math.round(((pre + n) / totalBytes) * 100)) : 0;
              if (fill) fill.style.width = p + '%';
              if (status) status.textContent = (doneCount + 1) + ' of ' + files.length + ' — ' + p + '%';
            }
          });
        } catch (err) {
          if (status) status.textContent = 'Failed on file ' + (i + 1) + ': ' + (err && err.message ? err.message : '');
          btn.disabled = false;
          return;
        }
        transferred += (f.size || 0);
        doneCount++;
      }
      if (fill) fill.style.width = '100%';
      if (status) status.textContent = 'All ' + files.length + ' downloads complete';
    });
  }

  function wireExpiry() {
    var expEl = document.querySelector('[data-expires]');
    if (!expEl) return;
    var iso = window.__DB_SHARE__.expiresAt;
    if (!iso) { expEl.textContent = 'never'; return; }
    var target = Date.parse(iso);
    if (!isFinite(target)) { expEl.textContent = String(iso); return; }
    function tick() { expEl.textContent = fmtRelative(target); }
    tick();
    setInterval(tick, 30000);
  }

  window.__DB_BOOT__ = function () {
    var rows = document.querySelectorAll('.db-file');
    for (var i = 0; i < rows.length; i++) wireRow(rows[i]);
    wireBulk();
    wireExpiry();
  };
})();
`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

// JSON embedded inside a <script> tag must never contain `</script>` or `<!--`
// raw — escape the slashes so the parser doesn't bail out.
const LINE_SEP_RE = new RegExp('\\u2028', 'g');
const PARA_SEP_RE = new RegExp('\\u2029', 'g');
function escapeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEP_RE, '\\u2028')
    .replace(PARA_SEP_RE, '\\u2029');
}

function sanitize(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function kindLabel(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'IMG';
  if (m.startsWith('video/')) return 'VID';
  if (m.startsWith('audio/')) return 'AUD';
  if (m.startsWith('text/')) return 'TXT';
  if (m === 'application/pdf') return 'PDF';
  if (m.includes('zip') || m.includes('compressed') || m.includes('tar')) return 'ZIP';
  if (m.includes('json') || m.includes('xml')) return 'DOC';
  return 'FILE';
}

export const __test = { LARGE_FILE_BYTES, escapeHtml, formatBytes, kindLabel };
