#!/usr/bin/env node
// Generate src/tokens.css :root variable block from src/tokens.json.
//
// - Reads tokens.json (camelCase keys grouped by category).
// - Emits CSS custom properties using a kebab-case `--<category>-<key>` name.
// - Also emits legacy `--db-*` aliases so existing component CSS keeps
//   resolving without a separate codemod (W3 must not touch unrelated files).
// - Preserves any CSS that lives after the `:root { ... }` block in the
//   existing tokens.css (component classes belong to W9+).
//
// Run via: node scripts/tokens.css.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(here, '..');
const JSON_PATH = resolve(PKG_ROOT, 'src/tokens.json');
const CSS_PATH = resolve(PKG_ROOT, 'src/tokens.css');

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');";

// Maps a camelCase JSON key inside a category to the legacy `--db-*` name.
// Keys not in this table fall back to `--db-<kebab(key)>`.
const LEGACY_ALIASES = {
  color: {
    bg: '--db-bg',
    panelBg: '--db-panel-bg',
    panelBgStrong: '--db-panel-bg-strong',
    panelBorder: '--db-panel-border',
    panelBorderStrong: '--db-panel-border-strong',
    text: '--db-text',
    textSoft: '--db-text-soft',
    textDim: '--db-text-dim',
    blue: '--db-blue',
    green: '--db-green',
    amber: '--db-amber',
  },
  radius: {
    xl: '--db-radius-xl',
    lg: '--db-radius-lg',
    md: '--db-radius-md',
    sm: '--db-radius-sm',
  },
  shadow: {
    default: '--db-shadow',
  },
  font: {
    sans: '--db-font',
    mono: '--db-font-mono',
  },
};

function camelToKebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function buildRootBlock(tokens) {
  const lines = [];
  const categories = Object.keys(tokens);
  for (const category of categories) {
    const group = tokens[category];
    if (!group || typeof group !== 'object') continue;
    const entries = Object.entries(group);
    if (entries.length === 0) continue;
    lines.push(`  /* ${category} */`);
    for (const [key, value] of entries) {
      if (typeof value !== 'string') continue;
      const canonical = `--${camelToKebab(category)}-${camelToKebab(key)}`;
      lines.push(`  ${canonical}: ${value};`);
      const legacy = LEGACY_ALIASES[category]?.[key];
      if (legacy && legacy !== canonical) {
        lines.push(`  ${legacy}: ${value};`);
      }
    }
  }
  return `:root {\n${lines.join('\n')}\n}`;
}

function extractTrailingCss(existing) {
  if (!existing) return '';
  // Find the FIRST :root { ... } block (matching balanced braces, naive but
  // sufficient for our hand-written tokens.css).
  const start = existing.indexOf(':root');
  if (start === -1) return existing.startsWith(FONT_IMPORT) ? existing.slice(FONT_IMPORT.length) : existing;
  const braceStart = existing.indexOf('{', start);
  if (braceStart === -1) return '';
  let depth = 0;
  for (let i = braceStart; i < existing.length; i++) {
    const ch = existing[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return existing.slice(i + 1);
      }
    }
  }
  return '';
}

async function main() {
  const raw = await readFile(JSON_PATH, 'utf8');
  const tokens = JSON.parse(raw);
  const rootBlock = buildRootBlock(tokens);

  let trailing = '';
  if (existsSync(CSS_PATH)) {
    const existing = readFileSync(CSS_PATH, 'utf8');
    trailing = extractTrailingCss(existing);
  }

  const output = `${FONT_IMPORT}\n\n${rootBlock}${trailing}`;
  await writeFile(CSS_PATH, output, 'utf8');
  process.stdout.write(`Wrote ${CSS_PATH}\n`);
}

main().catch((err) => {
  process.stderr.write(`tokens.css.mjs failed: ${err.message}\n`);
  process.exit(1);
});
