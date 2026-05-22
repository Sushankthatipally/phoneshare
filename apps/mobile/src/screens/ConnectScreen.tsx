import { useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, ScrollView, Text, TextInput, View } from '../lib/native.js';
import { parseShareUrl, useConnection } from '../lib/connection.js';
import { probeHealth } from '../lib/api.js';

export function ConnectScreen() {
  const { connection, setConnection } = useConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const tryConnect = async (raw: string, source: 'qr' | 'manual') => {
    setError(null);
    const parsed = parseShareUrl(raw);
    if (!parsed) {
      setError("Couldn't parse that URL. It should look like http://192.168.x.x:17619/guest/<token>");
      return;
    }
    setVerifying(true);
    const reachable = await probeHealth(parsed);
    setVerifying(false);
    if (!reachable) {
      setError(`Couldn't reach ${parsed.label}. Make sure DropBeam desktop is running and you're on the same Wi-Fi.`);
      return;
    }
    setConnection(parsed);
    setScanning(false);
    setManualUrl('');
    if (source === 'qr') {
      Alert.alert('Connected', `Linked to ${parsed.label}`);
    }
    router.replace('/send');
  };

  const onScan = ({ data }: { data: string }) => {
    if (!scanning) return;
    setScanning(false);
    void tryConnect(data, 'qr');
  };

  if (connection) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>CONNECTED</Text>
          <Text style={styles.title}>{connection.label}</Text>
          <Text style={styles.copy}>You're paired with this desktop. Open the Send tab to upload files.</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button onPress={() => router.push('/send')}>Send files →</Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button onPress={() => setConnection(null)}>Disconnect</Button>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  if (scanning) {
    if (!permission) {
      return (
        <View style={styles.center}>
          <Text style={styles.copy}>Loading camera…</Text>
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.center}>
          <Text style={styles.title}>Camera permission needed</Text>
          <Text style={styles.copy}>DropBeam uses the camera only to scan the pairing QR code.</Text>
          <Button onPress={() => void requestPermission()}>Grant camera</Button>
          <Button onPress={() => setScanning(false)}>Cancel</Button>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={onScan}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
        <View style={styles.scannerHud}>
          <Text style={styles.scannerHudText}>Point at the QR shown by the desktop app's Guest share</Text>
          <Button onPress={() => setScanning(false)}>Cancel</Button>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>HOW DO YOU WANT TO CONNECT?</Text>
        <Text style={styles.title}>Choose a mode</Text>
        <Text style={styles.copy}>
          On the desktop app, open the <Text style={styles.copyBold}>Guest</Text> tab and tap{' '}
          <Text style={styles.copyBold}>Create share</Text>. You'll get a QR code and a link.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.modeHeader}>
          <Text style={styles.modeIcon}>📶</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.modeLabel}>Same Wi-Fi · QR</Text>
            <Text style={styles.modeCopy}>Recommended. Scan the desktop's QR or paste its URL.</Text>
          </View>
          <Text style={[styles.modeBadge, styles.modeBadgeOn]}>READY</Text>
        </View>
        <Button onPress={async () => {
          if (!permission?.granted) {
            const result = await requestPermission();
            if (!result.granted) return;
          }
          setScanning(true);
        }}>
          Open scanner
        </Button>
        <TextInput
          onChangeText={setManualUrl}
          placeholder="…or paste http://192.168.1.x:17619/guest/<token>"
          value={manualUrl}
        />
        <Button disabled={!manualUrl.trim() || verifying} onPress={() => void tryConnect(manualUrl, 'manual')}>
          {verifying ? 'Checking…' : 'Connect via URL'}
        </Button>
      </View>

      <View style={[styles.card, styles.cardDisabled]}>
        <View style={styles.modeHeader}>
          <Text style={styles.modeIcon}>🔌</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.modeLabel}>USB cable</Text>
            <Text style={styles.modeCopy}>Plug your phone in via USB-C for fastest transfer.</Text>
          </View>
          <Text style={[styles.modeBadge, styles.modeBadgeOff]}>NOT BUILT</Text>
        </View>
        <Text style={styles.disabledNote}>
          Native ADB / usbmuxd integration on the desktop is currently a stub. This will land in a future update —
          tracked in DROPBEAM_USER_FLOWS.md Flow 2.2.
        </Text>
      </View>

      <View style={[styles.card, styles.cardDisabled]}>
        <View style={styles.modeHeader}>
          <Text style={styles.modeIcon}>📡</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.modeLabel}>Hotspot (no Wi-Fi)</Text>
            <Text style={styles.modeCopy}>Phone creates a private hotspot when there's no shared network.</Text>
          </View>
          <Text style={[styles.modeBadge, styles.modeBadgeOff]}>NOT BUILT</Text>
        </View>
        <Text style={styles.disabledNote}>
          Programmatic hotspot creation needs the Android WifiManager LOHS API (8.0+) and a permissioned native module.
          Currently the in-tree module only opens the Wi-Fi settings panel. Flow 2.4.
        </Text>
      </View>

      {error ? (
        <View style={[styles.card, styles.errorCard]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: 14,
    padding: 16,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#0a0a0a',
    borderColor: '#1f1f1f',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  errorCard: {
    backgroundColor: '#2a0e0e',
    borderColor: '#6b1e1e',
  },
  errorText: {
    color: '#ffd4d4',
    lineHeight: 20,
  },
  eyebrow: {
    color: '#7a7a7a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  copy: {
    color: '#b8b8b8',
    lineHeight: 20,
  },
  copyBold: {
    color: '#ffffff',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  scannerHud: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    bottom: 0,
    gap: 12,
    left: 0,
    padding: 18,
    position: 'absolute',
    right: 0,
  },
  scannerHudText: {
    color: '#ffffff',
    fontSize: 13,
    textAlign: 'center',
  },
  cardDisabled: {
    opacity: 0.55,
  },
  modeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  modeIcon: { fontSize: 22 },
  modeLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  modeCopy: {
    color: '#8a8a8a',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  modeBadge: {
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    textTransform: 'uppercase',
  },
  modeBadgeOn: { backgroundColor: '#0e2a14', color: '#9ee0a8' },
  modeBadgeOff: { backgroundColor: '#2a1f0e', color: '#ffd29a' },
  disabledNote: {
    color: '#9a9a9a',
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
  },
});
