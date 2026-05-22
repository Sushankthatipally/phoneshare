/**
 * JS bindings to the existing native modules under `apps/mobile/modules/`.
 *
 *   - DropBeamAndroid       (apps/mobile/modules/dropbeam-android)        — Android-only
 *   - DropBeamLiveActivity  (apps/mobile/modules/dropbeam-live-activity)  — iOS-only
 *
 * Each function feature-detects the underlying native module. When the module is
 * absent (running on the wrong platform, or in Expo Go where these custom modules
 * are not linked) the function returns a graceful no-op result and logs a warning
 * exactly once per module. This lets the JS layer call the same API on any host
 * without branching at every call site.
 */
import { NativeModules, Platform } from 'react-native';

type AndroidBridge = {
  joinWifi: (input: { ssid: string; password: string }) => Promise<boolean>;
  showIncomingNotification: (input: {
    title: string;
    body: string;
    sessionId: string;
    batchId?: string;
    files: number;
    totalBytes: number;
  }) => Promise<number>;
  startBackgroundReceive: (input: { sessionId?: string; batchId?: string }) => Promise<boolean>;
  stopBackgroundReceive?: () => Promise<boolean>;
};

type LiveActivityBridge = {
  isSupported?: () => Promise<boolean>;
  start: (input: { fileName: string; peerName: string; totalBytes: number }) => Promise<string>;
  update: (input: { bytesDone: number; speedLabel: string; percent: number }) => Promise<void>;
  end: () => Promise<void>;
};

const warned = new Set<string>();
function warnOnce(name: string, message: string) {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[native] ${name}: ${message}`);
}

function getAndroidBridge(): AndroidBridge | null {
  const mod = (NativeModules as Record<string, unknown>)['DropBeamAndroid'] as AndroidBridge | undefined;
  if (!mod) return null;
  return mod;
}

function getLiveActivityBridge(): LiveActivityBridge | null {
  const mod = (NativeModules as Record<string, unknown>)['DropBeamLiveActivity'] as
    | LiveActivityBridge
    | undefined;
  if (!mod) return null;
  return mod;
}

export interface IncomingNotificationPayload {
  title: string;
  body: string;
  sessionId: string;
  batchId?: string;
  files: number;
  totalBytes: number;
}

export interface LiveActivityStartPayload {
  title: string;
  sessionId: string;
  peerName: string;
  totalBytes: number;
}

export interface LiveActivityUpdatePayload {
  bytesTransferred: number;
  totalBytes: number;
  eta?: number;
}

export async function joinWifi(ssid: string, password: string): Promise<boolean> {
  const bridge = getAndroidBridge();
  if (!bridge) {
    warnOnce('joinWifi', `Native module DropBeamAndroid not available on ${Platform.OS}; no-op.`);
    return false;
  }
  try {
    return await bridge.joinWifi({ ssid, password });
  } catch (error) {
    console.warn('[native] joinWifi failed', error);
    return false;
  }
}

export async function showIncomingNotification(payload: IncomingNotificationPayload): Promise<void> {
  const bridge = getAndroidBridge();
  if (!bridge) {
    warnOnce(
      'showIncomingNotification',
      `Native module DropBeamAndroid not available on ${Platform.OS}; no-op.`,
    );
    return;
  }
  try {
    await bridge.showIncomingNotification({
      title: payload.title,
      body: payload.body,
      sessionId: payload.sessionId,
      batchId: payload.batchId ?? '',
      files: payload.files,
      totalBytes: payload.totalBytes,
    });
  } catch (error) {
    console.warn('[native] showIncomingNotification failed', error);
  }
}

export async function startBackgroundReceive(sessionId?: string, batchId?: string): Promise<boolean> {
  const bridge = getAndroidBridge();
  if (!bridge) {
    warnOnce(
      'startBackgroundReceive',
      `Foreground service is Android-only; iOS background receive is handled by BGTaskScheduler in W16.`,
    );
    return false;
  }
  try {
    return await bridge.startBackgroundReceive({ sessionId, batchId });
  } catch (error) {
    console.warn('[native] startBackgroundReceive failed', error);
    return false;
  }
}

export async function stopBackgroundReceive(): Promise<void> {
  const bridge = getAndroidBridge();
  if (!bridge || typeof bridge.stopBackgroundReceive !== 'function') {
    warnOnce(
      'stopBackgroundReceive',
      `Native module DropBeamAndroid.stopBackgroundReceive not available on ${Platform.OS}; no-op.`,
    );
    return;
  }
  try {
    await bridge.stopBackgroundReceive();
  } catch (error) {
    console.warn('[native] stopBackgroundReceive failed', error);
  }
}

export async function startLiveActivity(payload: LiveActivityStartPayload): Promise<string | null> {
  const bridge = getLiveActivityBridge();
  if (!bridge) {
    warnOnce(
      'startLiveActivity',
      `Native module DropBeamLiveActivity not available on ${Platform.OS}; no-op (Dynamic Island is iOS-only).`,
    );
    return null;
  }
  try {
    const id = await bridge.start({
      fileName: payload.title,
      peerName: payload.peerName,
      totalBytes: payload.totalBytes,
    });
    return id ?? null;
  } catch (error) {
    console.warn('[native] startLiveActivity failed', error);
    return null;
  }
}

export async function updateLiveActivity(
  activityId: string,
  payload: LiveActivityUpdatePayload,
): Promise<void> {
  const bridge = getLiveActivityBridge();
  if (!bridge) {
    warnOnce(
      'updateLiveActivity',
      `Native module DropBeamLiveActivity not available on ${Platform.OS}; no-op.`,
    );
    return;
  }
  const percent =
    payload.totalBytes > 0
      ? Math.max(0, Math.min(100, Math.round((payload.bytesTransferred / payload.totalBytes) * 100)))
      : 0;
  const speedLabel = formatEta(payload.eta);
  try {
    // ActivityKit on iOS keeps a single in-flight activity at a time, so the native
    // side updates by identity (activityId is observed for parity with future N>1 support).
    void activityId;
    await bridge.update({ bytesDone: payload.bytesTransferred, speedLabel, percent });
  } catch (error) {
    console.warn('[native] updateLiveActivity failed', error);
  }
}

export async function endLiveActivity(activityId: string): Promise<void> {
  const bridge = getLiveActivityBridge();
  if (!bridge) {
    warnOnce(
      'endLiveActivity',
      `Native module DropBeamLiveActivity not available on ${Platform.OS}; no-op.`,
    );
    return;
  }
  try {
    void activityId;
    await bridge.end();
  } catch (error) {
    console.warn('[native] endLiveActivity failed', error);
  }
}

function formatEta(etaSeconds?: number): string {
  if (etaSeconds === undefined || !Number.isFinite(etaSeconds) || etaSeconds < 0) return '';
  if (etaSeconds < 1) return 'almost done';
  if (etaSeconds < 60) return `${Math.round(etaSeconds)}s left`;
  const minutes = Math.floor(etaSeconds / 60);
  const seconds = Math.round(etaSeconds % 60);
  return `${minutes}m ${seconds}s left`;
}

export const __test = { formatEta, getAndroidBridge, getLiveActivityBridge };
