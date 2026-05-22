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
