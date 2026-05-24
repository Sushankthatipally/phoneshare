/**
 * Parse a pairing payload. Two shapes:
 *   1. Direct  — `{ mode: 'wifi'|'usb', sessionId, host, port, publicKey, expiresAt }`
 *   2. Hotspot — `{ mode: 'hotspot', ssid, password, ... }`
 *
 * Guest-share URLs are no longer supported.
 */

import type { DirectPairingPayload, HotspotPairingPayload } from '@dropbeam/protocol';

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

export type ParsedSessionPayload = DirectSessionPayload | HotspotSessionPayload;

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function tryParsePairUrl(raw: string): unknown {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx < 0) return null;
  const fragment = trimmed.slice(hashIdx + 1);
  const eq = fragment.indexOf('=');
  if (eq < 0) return null;
  const encoded = fragment.slice(eq + 1);
  try {
    return JSON.parse(decodeURIComponent(encoded));
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
  return { kind: 'direct', payload, label: `${payload.host}:${payload.port}` };
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
  return { kind: 'hotspot', payload, label: payload.ssid };
}

export function parseSessionPayload(input: string): ParsedSessionPayload | null {
  const candidate = tryParseJson(input) ?? tryParsePairUrl(input);
  if (!candidate || typeof candidate !== 'object') return null;
  const obj = candidate as Record<string, unknown>;
  return parseHotspotJson(obj) ?? parseDirectJson(obj);
}
