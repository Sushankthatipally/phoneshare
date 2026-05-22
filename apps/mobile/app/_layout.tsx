import { useEffect } from 'react';
import { Slot } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

import { ConnectionProvider } from '../src/lib/connection.js';
import { MobileChrome } from '../src/screens/MobileChrome.js';

const BACKGROUND_TASK = 'dropbeam-background-receive';

// Foreground display + sound; do not bump badge counts because they imply unread.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// The background task checks a user-controlled toggle in AsyncStorage. When
// enabled and a session exists, it kicks the Android foreground service. iOS
// has no equivalent path — the task no-ops on iOS.
if (!TaskManager.isTaskDefined(BACKGROUND_TASK)) {
  TaskManager.defineTask(BACKGROUND_TASK, async () => {
    try {
      const [enabled, connection] = await Promise.all([
        AsyncStorage.getItem('dropbeam.settings'),
        AsyncStorage.getItem('dropbeam.connection'),
      ]);
      const settings = enabled ? safeJson<{ backgroundReceiveEnabled?: boolean }>(enabled) : null;
      if (!settings?.backgroundReceiveEnabled || !connection) {
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }
      if (Platform.OS === 'android') {
        const native = NativeModules?.DropBeamAndroid as
          | { startBackgroundReceive?: (input: Record<string, unknown>) => Promise<unknown> }
          | undefined;
        const session = safeJson<{ sessionId?: string }>(connection);
        await native?.startBackgroundReceive?.({ sessionId: session?.sessionId ?? '' });
        return BackgroundFetch.BackgroundFetchResult.NewData;
      }
      return BackgroundFetch.BackgroundFetchResult.NoData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function Layout() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
      } catch {
        // permission API may be unavailable on web
      }
      try {
        // Best-effort: register the background task even when disabled by user,
        // since the task itself bails when the toggle is off.
        const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
        if (!registered && !cancelled) {
          await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
            minimumInterval: 15 * 60,
            stopOnTerminate: false,
            startOnBoot: true,
          });
        }
      } catch {
        // Some platforms reject background task registration; ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ConnectionProvider>
      <MobileChrome>
        <Slot />
      </MobileChrome>
    </ConnectionProvider>
  );
}
