/**
 * Parse the QR text the phone receives. Three shapes are supported, in this
 * order of fallback:
 *
 *   1. Guest HTTP URL — the historical "/guest/<token>" share link. Phone
 *      uploads files via the guest endpoint, no PIN required (browser-style
 *      pairing). Matches the desktop's GuestShareSummary flow.
 *   2. Direct pairing JSON — `{ mode: 'wifi'|'usb', sessionId, transport,
 *      host, port, publicKey, expiresAt }` produced by `createSession()`.
 *      Triggers the full ECDH + PIN handshake (Flow 2.1).
 *   3. Hotspot pairing JSON — `{ mode: 'hotspot', ssid, password, host,
 *      port, publicKey, sessionId, expiresAt }`. Phone joins the SSID first,
 *      then runs the same ECDH/PIN handshake.
 *
 * Returns a discriminated union; the caller branches on `kind`.
 */

import type {
  DirectPairingPayload,
  HotspotPairingPayload,
} from '@dropbeam/protocol';

export interface GuestSessionPayload {
  kind: 'guest';
  origin: string;
  token: string;
  label: string;
}

export interface DirectSessionPayload {
  kind: 'direct';
  payload: DirectPairingPayload;
  label: string;
}

export interface HotspotSessionPayload {
  kind: 'hotspot';
  payload: HotspotPairingPayload;
  label: string;
}

export type ParsedSessionPayload =
  | GuestSessionPayload
  | DirectSessionPayload
  | HotspotSessionPayload;

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Desktop emits `http://host:port/pair/<id>#pair=<URL-encoded JSON>`. Extract the JSON. */
function tryParsePairUrl(raw: string): unknown {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx < 0) return null;
  const fragment = trimmed.slice(hashIdx + 1);
  // Fragment is `pair=<encoded>` or `hotspot=<encoded>`; accept either key.
  const eq = fragment.indexOf('=');
  if (eq < 0) return null;
  const encoded = fragment.slice(eq + 1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseGuestUrl(raw: string): GuestSessionPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const match = url.pathname.match(/\/(?:api\/)?guest\/([^/]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return {
    kind: 'guest',
    origin: `${url.protocol}//${url.host}`,
    token,
    label: `${url.hostname}:${port}`,
  };
}

function parseDirectJson(value: Record<string, unknown>): DirectSessionPayload | null {
  const mode = value.mode;
  const transport = value.transport;
  if (mode !== 'wifi' && mode !== 'usb' && mode !== undefined) return null;
  if (transport !== 'wifi' && transport !== 'usb') return null;
  if (
    !isString(value.sessionId) ||
    !isString(value.host) ||
    !isNumber(value.port) ||
    !isString(value.publicKey) ||
    !isString(value.expiresAt)
  ) {
    return null;
  }
  const payload: DirectPairingPayload = {
    mode: mode ?? transport,
    sessionId: value.sessionId,
    transport,
    host: value.host,
    port: value.port,
    publicKey: value.publicKey,
    expiresAt: value.expiresAt,
  };
  return {
    kind: 'direct',
    payload,
    label: `${payload.host}:${payload.port}`,
  };
}

function parseHotspotJson(value: Record<string, unknown>): HotspotSessionPayload | null {
  if (value.mode !== 'hotspot') return null;
  if (
    !isString(value.ssid) ||
    !isString(value.password) ||
    !isString(value.sessionId) ||
    !isString(value.host) ||
    !isNumber(value.port) ||
    !isString(value.publicKey) ||
    !isString(value.expiresAt)
  ) {
    return null;
  }
  const payload: HotspotPairingPayload = {
    mode: 'hotspot',
    sessionId: value.sessionId,
    ssid: value.ssid,
    password: value.password,
    host: value.host,
    port: value.port,
    publicKey: value.publicKey,
    expiresAt: value.expiresAt,
  };
  return {
    kind: 'hotspot',
    payload,
    label: payload.ssid,
  };
}

export function parseSessionPayload(input: string): ParsedSessionPayload | null {
  console.info('[dropbeam] parseSessionPayload input (first 200 chars):', input.slice(0, 200));

  // Try raw JSON first, then the pair-URL fragment format used by the desktop.
  const candidate = tryParseJson(input) ?? tryParsePairUrl(input);
  if (candidate && typeof candidate === 'object') {
    const obj = candidate as Record<string, unknown>;
    const hotspot = parseHotspotJson(obj);
    if (hotspot) {
      console.info('[dropbeam] parsed as HOTSPOT', { sessionId: hotspot.payload.sessionId, host: hotspot.payload.host });
      return hotspot;
    }
    const direct = parseDirectJson(obj);
    if (direct) {
      console.info('[dropbeam] parsed as DIRECT', { sessionId: direct.payload.sessionId, host: direct.payload.host, port: direct.payload.port });
      return direct;
    }
    console.warn('[dropbeam] JSON parsed but neither hotspot nor direct shape matched. Keys:', Object.keys(obj));
  }
  const guest = parseGuestUrl(input);
  if (guest) {
    console.info('[dropbeam] parsed as GUEST URL', { origin: guest.origin });
  } else {
    console.warn('[dropbeam] parseSessionPayload — no shape matched, returning null');
  }
  return guest;
}
