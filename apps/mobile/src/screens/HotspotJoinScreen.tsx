import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';

interface HotspotJoinScreenProps {
  ssid: string;
  password: string;
  isIOS?: boolean;
  onJoined: () => void;
}

export function HotspotJoinScreen({ ssid, password, isIOS, onJoined }: HotspotJoinScreenProps) {
  if (!isIOS) {
    return (
      <View style={{ gap: 14 }}>
        <ScreenCard
          eyebrow="Hotspot"
          title="Joining hotspot automatically"
          copy={`Connecting to ${ssid} via WifiManager. No action needed.`}
        >
          <Text style={{ color: '#c7ffd4', fontWeight: '700', marginTop: 8 }}>Joining…</Text>
        </ScreenCard>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <ScreenCard
        eyebrow="Hotspot"
        title="Join this WiFi first"
        copy="iOS can't auto-join. Open Settings, connect to the network below, then come back here."
      >
        <View style={{ gap: 10, marginTop: 4 }}>
          <View style={styles.credBox}>
            <Text style={styles.credLabel}>SSID</Text>
            <Text style={styles.credValue}>📶 {ssid}</Text>
          </View>
          <View style={styles.credBox}>
            <Text style={styles.credLabel}>Password</Text>
            <Text style={styles.credPassword}>{password}</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <Button onPress={() => {}}>Open WiFi Settings</Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={onJoined}>I've joined ✓</Button>
          </View>
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
