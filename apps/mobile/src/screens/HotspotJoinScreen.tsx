import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';

interface HotspotJoinScreenProps {
  ssid: string;
  password: string;
  /** Backend host:port to ping once the user has joined the network. */
  host?: string;
  port?: number;
  isIOS?: boolean;
  onJoined: () => void;
}

export function HotspotJoinScreen({ ssid, password, host, port, isIOS, onJoined }: HotspotJoinScreenProps) {
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const openWifiSettings = async () => {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('App-Prefs:root=WIFI');
      } else {
        // sendIntent throws on iOS; only call on Android.
        await Linking.sendIntent('android.settings.WIFI_SETTINGS');
      }
    } catch {
      // Some Android OEMs and iOS 15+ reject the App-Prefs URL; fall back to the generic settings page.
      try {
        await Linking.openSettings();
      } catch {
        Alert.alert('Open settings manually', 'Could not open Wi-Fi settings directly. Open Settings from your home screen.');
      }
    }
  };

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    Alert.alert('Copied', `${label} copied to clipboard.`);
  };

  const startHealthPolling = () => {
    if (!host) {
      onJoined();
      return;
    }
    if (polling) return;
    setPolling(true);
    const target = port ? `http://${host}:${port}/api/health` : `http://${host}/api/health`;
    const attemptStartedAt = Date.now();
    pollTimer.current = setInterval(async () => {
      try {
        const response = await fetch(target, { method: 'GET' });
        if (response.ok) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPolling(false);
          onJoined();
        }
      } catch {
        // network unavailable until the user actually joins; keep polling.
      }
      // Stop after 60s to avoid leaking the timer if the user backgrounds the app.
      if (Date.now() - attemptStartedAt > 60_000) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setPolling(false);
      }
    }, 1500);
  };

  if (!isIOS) {
    return (
      <View style={{ gap: 14 }}>
        <ScreenCard
          eyebrow="Hotspot"
          title="Joining hotspot"
          copy={`Connecting to ${ssid}. If Android opens the system Wi-Fi sheet, tap Connect.`}
        >
          <View style={{ gap: 10, marginTop: 4 }}>
            <View style={styles.credBox}>
              <Text style={styles.credLabel}>SSID</Text>
              <Text style={styles.credValue}>{ssid}</Text>
            </View>
            <View style={styles.credBox}>
              <Text style={styles.credLabel}>Password</Text>
              <Text style={styles.credPassword}>{password}</Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <View style={{ flex: 1 }}>
              <Button onPress={() => void copy('Password', password)}>Copy password</Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button onPress={() => void openWifiSettings()}>Open Wi-Fi settings</Button>
            </View>
          </View>
          <View style={{ marginTop: 8 }}>
            <Button onPress={startHealthPolling}>
              {polling ? 'Waiting for hotspot…' : 'I have joined'}
            </Button>
          </View>
        </ScreenCard>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <ScreenCard
        eyebrow="Hotspot"
        title="Join this Wi-Fi first"
        copy="iOS can't auto-join. Open Settings, connect to the network below, then come back here."
      >
        <View style={{ gap: 10, marginTop: 4 }}>
          <View style={styles.credBox}>
            <Text style={styles.credLabel}>SSID</Text>
            <Text style={styles.credValue}>{ssid}</Text>
          </View>
          <View style={styles.credBox}>
            <Text style={styles.credLabel}>Password</Text>
            <Text style={styles.credPassword}>{password}</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <Button onPress={() => void copy('Password', password)}>Copy password</Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={() => void openWifiSettings()}>Open Wi-Fi settings</Button>
          </View>
        </View>
        <View style={{ marginTop: 8 }}>
          <Button onPress={startHealthPolling}>
            {polling ? 'Waiting for hotspot…' : "I've joined"}
          </Button>
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  credBox: {
    backgroundColor: '#09111c',
    borderColor: '#274860',
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  credLabel: {
    color: '#89b7d1',
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  credValue: {
    color: '#f2f7ff',
    fontSize: 16,
    fontWeight: '800' as const,
  },
  credPassword: {
    color: '#f2f7ff',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginTop: 12,
  },
};
