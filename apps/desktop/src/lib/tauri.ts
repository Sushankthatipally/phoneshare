type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: {
    invoke?: TauriInvoke;
  };
  __TAURI__?: {
    core?: { invoke?: TauriInvoke };
  };
}

function resolveInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') return null;
  const w = window as TauriWindow;
  return w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.core?.invoke ?? null;
}

export function isTauri(): boolean {
  return resolveInvoke() !== null;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = resolveInvoke();
  if (!fn) {
    throw new Error(`Tauri is not available — invoke("${cmd}") failed`);
  }
  return (await fn(cmd, args)) as T;
}

export async function getSystemHostname(): Promise<string | null> {
  try {
    if (!isTauri()) return null;
    const hostname = await invoke<string>('get_system_hostname');
    const trimmed = hostname.trim();
    return trimmed.length ? trimmed : null;
  } catch {
    return null;
  }
}

interface DialogOpenOptions {
  directory?: boolean;
  multiple?: boolean;
  defaultPath?: string;
  title?: string;
}

export async function openFolderDialog(options: Omit<DialogOpenOptions, 'directory' | 'multiple'> = {}): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const result = await invoke<string | string[] | null>('plugin:dialog|open', {
      options: {
        directory: true,
        multiple: false,
        defaultPath: options.defaultPath,
        title: options.title,
      },
    });
    if (!result) return null;
    return Array.isArray(result) ? (result[0] ?? null) : result;
  } catch {
    return null;
  }
}

type TauriListen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

interface TauriEventApi {
  event?: { listen?: TauriListen };
}

function resolveListen(): TauriListen | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { __TAURI__?: TauriEventApi };
  return w.__TAURI__?.event?.listen ?? null;
}

export async function listenTauri<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  const listen = resolveListen();
  if (!listen) return () => {};
  try {
    return await listen<T>(event, handler);
  } catch {
    return () => {};
  }
}

export interface AndroidUsbStatus {
  state: 'absent' | 'detected' | 'authorizing' | 'ready' | 'error';
  deviceLabel?: string;
  error?: string;
}

export async function usbAndroidStatus(): Promise<AndroidUsbStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<AndroidUsbStatus>('usb_android_status');
  } catch {
    return null;
  }
}

export async function usbAndroidEnsureTunnel(): Promise<{ ok: boolean; host: string; port: number; error?: string } | null> {
  if (!isTauri()) return null;
  try {
    return await invoke('usb_android_ensure_tunnel');
  } catch {
    return null;
  }
}

export async function usbAndroidStopTunnel(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('usb_android_stop_tunnel');
  } catch {}
}

export interface ShellIntegrationResult {
  ok: boolean;
  error?: string;
  path?: string;
  platform?: string;
}

export async function registerContextMenu(): Promise<ShellIntegrationResult> {
  if (!isTauri()) return { ok: false, error: 'tauri unavailable' };
  try {
    return await invoke<ShellIntegrationResult>('register_context_menu');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function unregisterContextMenu(): Promise<ShellIntegrationResult> {
  if (!isTauri()) return { ok: false, error: 'tauri unavailable' };
  try {
    return await invoke<ShellIntegrationResult>('unregister_context_menu');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function startWatchFolder(input: { id?: string; path: string; destinationFingerprint?: string }): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke('start_watch_folder', input as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

export async function stopWatchFolder(id: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stop_watch_folder', { id });
  } catch {}
}
