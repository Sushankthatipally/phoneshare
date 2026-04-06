declare module 'react' {
  export type ReactNode = any;
  export type PropsWithChildren<P = {}> = P & { children?: ReactNode };
  export type SetStateAction<T> = T | ((previous: T) => T);
  export type Dispatch<T> = (value: T) => void;
  export type CSSProperties = Record<string, unknown>;
  export type HTMLAttributes<T> = Record<string, unknown> & {
    className?: string;
    style?: any;
  };
  export type InputHTMLAttributes<T> = Record<string, unknown> & { ref?: any };
  export type ButtonHTMLAttributes<T> = Record<string, unknown> & {
    ref?: any;
    className?: string;
    type?: 'button' | 'submit' | 'reset';
  };

  export function useState<T>(initial: T): [T, Dispatch<SetStateAction<T>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useRef<T>(initial: T | null): { current: T | null };
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: readonly unknown[]): T;
}

declare module 'react/jsx-runtime' {
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
}

declare module '@dropbeam/shared-ui' {
  import type { PropsWithChildren } from 'react';

  export function Badge(props: PropsWithChildren<{ key?: any; tone?: string }>): any;
  export function Button(props: PropsWithChildren<{ key?: any; onClick?: () => void; onPress?: () => void; variant?: string; disabled?: boolean; style?: any }>): any;
  export function GlassPanel(props: PropsWithChildren<{ key?: any; style?: any }>): any;
}

declare module '@dropbeam/protocol' {
  export interface BackendHealth {
    sessions: number;
    totalBytes: number;
  }

  export interface LiveFileRecord {
    id: string;
    name: string;
    size: number;
  }

  export interface TransferItem {
    name: string;
    progress: number;
    sizeLabel: string;
    kind: string;
    status: string;
    speedLabel?: string;
    etaLabel?: string;
  }

  export interface ClipboardState {
    text: string;
    sourceDeviceName?: string | null;
    sourceRole?: 'desktop' | 'phone' | null;
    updatedAt?: string | null;
  }

  export interface UploadSessionRecord {
    id: string;
    sessionId: string;
    direction: 'desktop-to-phone' | 'phone-to-desktop';
    name: string;
    size: number;
    uploadedBytes: number;
    progressPercent: number;
  }

  export interface DashboardResponse {
    clipboard: ClipboardState;
    activeUploads: UploadSessionRecord[];
  }

  export interface LiveSessionRecord {
    id: string;
    mode: string;
    state: string;
    localDevice: { name: string; icon?: string };
    peerDevice?: { name: string; icon?: string } | null;
    pairing: { pin: string; verifiedAt?: string | null };
    queue: { totalFiles: number };
    summary: { totalBytes: number };
    files: Record<'desktop-to-phone' | 'phone-to-desktop', LiveFileRecord[]>;
  }

  export function formatBytes(value: number): string;
  export function resolveBackendOrigin(): string;

  export class DropbeamBackendClient {
    constructor(origin: string);
    health(): Promise<BackendHealth>;
    dashboard(): Promise<DashboardResponse>;
    sessions(): Promise<LiveSessionRecord[]>;
    pairSession(
      sessionId: string,
      payload: {
        pin: string;
        deviceName: string;
        deviceIcon?: string;
        kind: string;
        platform: string;
        transport?: string;
      },
    ): Promise<void>;
    updateClipboard(payload: {
      text: string;
      sourceDeviceName?: string;
      sourceRole?: 'desktop' | 'phone';
    }): Promise<void>;
    uploadFile(
      sessionId: string,
      direction: 'desktop-to-phone' | 'phone-to-desktop',
      file: File,
      options?: { deviceName?: string },
    ): Promise<void>;
    downloadUrl(fileId: string): string;
    subscribe(onChange: () => void): () => void;
  }
}

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: any;
  }

  interface ElementChildrenAttribute {
    children: {};
  }

  interface IntrinsicElements {
    [elementName: string]: any;
  }
}
