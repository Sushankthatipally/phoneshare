// Thin wrappers around Tauri's `invoke` that degrade gracefully when the app
// is loaded in a plain browser (e.g. `pnpm dev` in Chrome without `tauri dev`).
// Returns `null` / sentinel values instead of throwing so the UI can render an
// "Tauri-only feature" notice.

export interface TauriInternals {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

export interface TauriEventBridge {
  listen?: <T>(
    name: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<() => void>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
  __TAURI__?: { event?: TauriEventBridge };
}

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as TauriWindow).__TAURI_INTERNALS__?.invoke);
}

export async function invokeTauri<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  const internals = (window as TauriWindow).__TAURI_INTERNALS__;
  if (!internals?.invoke) return null;
  try {
    return await internals.invoke<T>(cmd, args);
  } catch (error) {
    console.error(`tauri invoke '${cmd}' failed`, error);
    return null;
  }
}

export async function listenTauri<T>(
  name: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (typeof window === 'undefined') return () => undefined;
  const bridge = (window as TauriWindow).__TAURI__?.event;
  if (!bridge?.listen) return () => undefined;
  return bridge.listen<T>(name, handler);
}

export interface AndroidUsbStatus {
  state: 'absent' | 'detected' | 'authorizing' | 'ready' | 'error';
  deviceLabel?: string;
  error?: string;
}

export interface UsbTunnelResult {
  ok: boolean;
  host: string;
  port: number;
  error?: string;
}

export interface IosUsbStatus {
  state: 'unsupported';
}

export interface ShellIntegrationResult {
  ok: boolean;
  platform: string;
  path?: string;
  error?: string;
}

export async function usbAndroidStatus(): Promise<AndroidUsbStatus> {
  const result = await invokeTauri<AndroidUsbStatus>('usb_android_status');
  return result ?? { state: 'absent', error: 'Tauri runtime unavailable' };
}

export async function usbAndroidEnsureTunnel(): Promise<UsbTunnelResult> {
  const result = await invokeTauri<UsbTunnelResult>('usb_android_ensure_tunnel');
  return (
    result ?? {
      ok: false,
      host: '127.0.0.1',
      port: 17619,
      error: 'Tauri runtime unavailable',
    }
  );
}

export async function usbAndroidStopTunnel(): Promise<{ ok: boolean }> {
  const result = await invokeTauri<{ ok: boolean }>('usb_android_stop_tunnel');
  return result ?? { ok: false };
}

export async function usbIosStatus(): Promise<IosUsbStatus> {
  const result = await invokeTauri<IosUsbStatus>('usb_ios_status');
  return result ?? { state: 'unsupported' };
}

export async function registerContextMenu(): Promise<ShellIntegrationResult> {
  const result = await invokeTauri<ShellIntegrationResult>('register_context_menu');
  return (
    result ?? {
      ok: false,
      platform: 'unknown',
      error: 'Tauri runtime unavailable',
    }
  );
}

export async function unregisterContextMenu(): Promise<ShellIntegrationResult> {
  const result = await invokeTauri<ShellIntegrationResult>('unregister_context_menu');
  return (
    result ?? {
      ok: false,
      platform: 'unknown',
      error: 'Tauri runtime unavailable',
    }
  );
}

export async function startWatchFolder(input: {
  id: string;
  path: string;
  destinationFingerprint?: string;
}): Promise<string | null> {
  return invokeTauri<string>('start_watch_folder', input);
}

export async function stopWatchFolder(id: string): Promise<void> {
  await invokeTauri('stop_watch_folder', { id });
}

export async function openFolderDialog(): Promise<string | null> {
  if (!isTauri()) return null;
  // Goes through the Rust `pick_folder` command (see main.rs). Avoids depending
  // on the @tauri-apps/plugin-dialog JS package which isn't in node_modules.
  const result = await invokeTauri<{ path: string | null }>('pick_folder');
  return result?.path ?? null;
}
