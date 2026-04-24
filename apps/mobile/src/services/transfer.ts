import type { TransportMode } from './crypto.js';

export type TransferDirection = 'desktop-to-phone' | 'phone-to-desktop';
export type TransferState = 'queued' | 'preparing' | 'transferring' | 'complete';

export interface TransferDraft {
  name: string;
  size: number;
  mime?: string;
}

export interface TransferJob {
  id: string;
  name: string;
  size: number;
  sizeLabel: string;
  direction: TransferDirection;
  state: TransferState;
  progress: number;
  chunkSize: number;
  chunkSizeLabel: string;
  mode: TransportMode;
}

export const CHUNK_SIZES = {
  usb: 4 * 1024 * 1024,
  wifi: 1024 * 1024,
  hotspot: 256 * 1024,
} as const;

export function resolveChunkSize(mode: TransportMode) {
  return CHUNK_SIZES[mode];
}

export function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function buildTransferJobs(
  drafts: TransferDraft[],
  direction: TransferDirection,
  mode: TransportMode,
  seed = 0,
): TransferJob[] {
  const chunkSize = resolveChunkSize(mode);

  return drafts.map((draft, index) => ({
    id: `transfer-${seed + index + 1}`,
    name: draft.name,
    size: draft.size,
    sizeLabel: formatBytes(draft.size),
    direction,
    state: 'queued',
    progress: 0,
    chunkSize,
    chunkSizeLabel: formatBytes(chunkSize),
    mode,
  }));
}
