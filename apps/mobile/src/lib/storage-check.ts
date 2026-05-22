import * as FileSystem from 'expo-file-system';

import { reportStorage } from './api.js';
import type { ConnectionInfo } from './connection.js';

export interface StorageReport {
  freeBytes: number;
  totalBytes: number;
  /** True when the proposed transfer fits. */
  fits: boolean;
  /** Available headroom after the transfer, in bytes. */
  headroom: number;
}

/**
 * Compute free + total bytes via expo-file-system. Both calls fall through to
 * Number.MAX_SAFE_INTEGER on platforms where the native module isn't wired up
 * (e.g. web), which makes the `fits` check fail-open in those environments.
 */
export async function checkLocalStorage(payloadBytes: number): Promise<StorageReport> {
  let freeBytes = 0;
  let totalBytes = 0;
  try {
    freeBytes = await FileSystem.getFreeDiskStorageAsync();
  } catch {
    freeBytes = Number.MAX_SAFE_INTEGER;
  }
  try {
    totalBytes = await FileSystem.getTotalDiskCapacityAsync();
  } catch {
    totalBytes = Number.MAX_SAFE_INTEGER;
  }
  return {
    freeBytes,
    totalBytes,
    fits: payloadBytes <= freeBytes,
    headroom: freeBytes - payloadBytes,
  };
}

/**
 * Threshold above which we proactively check storage and notify the desktop.
 * 500 MB matches the W16 spec.
 */
export const LARGE_TRANSFER_BYTES = 500 * 1024 * 1024;

/**
 * Fire-and-forget POST to the desktop so the desktop side can render a
 * "phone has X GB free" preflight panel.
 */
export async function publishStorageToDesktop(connection: ConnectionInfo): Promise<StorageReport | null> {
  try {
    const report = await checkLocalStorage(0);
    await reportStorage({
      connection,
      freeBytes: report.freeBytes,
      totalBytes: report.totalBytes,
    });
    return report;
  } catch {
    return null;
  }
}
