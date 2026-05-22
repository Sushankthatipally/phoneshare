import { useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Badge, Button, GlassPanel, SectionHeading, tokens } from '@dropbeam/shared-ui-rn';

import { Pressable, ScrollView, Text, TextInput, View } from '../lib/native.js';
import { parseSessionPayload, useConnection } from '../lib/connection.js';
import { probeHealth } from '../lib/api.js';
import { useDiscovery } from '../lib/discovery.js';

export function ConnectScreen() {
  const {
    connection,
    state,
    disconnect,
    attachGuestSession,
    startDirectHandshake,
    startHotspotHandshake,
  } = useConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const discovery = useDiscovery();

  const handleParsed = async (raw: string, source: 'qr' | 'manual') => {
    setError(null);
    const parsed = parseSessionPayload(raw);
    if (!parsed) {
      setError(
        'Unrecognized code. Expected a DropBeam pairing QR or a guest share URL like http://192.168.x.x:17619/guest/<token>.',
      );
      return;
    }

    if (parsed.kind === 'guest') {
      setVerifying(true);
      const reachable = await probeHealth({ origin: parsed.origin });
      setVerifying(false);
      if (!reachable) {
        setError(
          `Couldn't reach ${parsed.label}. Make sure DropBeam desktop is running and you're on the same Wi-Fi.`,
        );
        return;
      }
      await attachGuestSession(parsed);
      setScanning(false);
      setManualUrl('');
      if (source === 'qr') {
        Alert.alert('Connected', `Linked to ${parsed.label}`);
      }
      router.replace('/send');
      return;
    }

    if (parsed.kind === 'hotspot') {
      await startHotspotHandshake(parsed);
      setScanning(false);
      router.replace('/pin');
      return;
    }

    // direct
    await startDirectHandshake(parsed);
    setScanning(false);
    router.replace('/pin');
  };

  const onScan = ({ data }: { data: string }) => {
    if (!scanning) return;
    setScanning(false);
    void handleParsed(data, 'qr');
  };

  if (connection) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <GlassPanel>
          <Badge tone="green">Paired</Badge>
          <View style={styles.spacer} />
          <SectionHeading
            eyebrow={connection.kind === 'guest' ? 'Guest session' : 'Encrypted session'}
            title={connection.label}
            description={
              connection.kind === 'guest'
                ? 'Uploads stream to the desktop via the guest share. Open Send to pick files.'
                : 'End-to-end encrypted. Resume on reconnect.'
            }
          />
          <View style={styles.actionRow}>
            <View style={styles.actionItem}>
              <Button variant="primary" onPress={() => router.push('/send')}>
                Send files
              </Button>
            </View>
            <View style={styles.actionItem}>
              <Button variant="ghost" onPress={() => void disconnect()}>
                Disconnect
              </Button>
            </View>
          </View>
        </GlassPanel>
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
          <Button variant="ghost" onPress={() => setScanning(false)}>Cancel</Button>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.bg }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={onScan}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
        <View style={styles.scannerHud}>
          <Text style={styles.scannerHudText}>Point at the QR shown by the desktop</Text>
          <Button variant="ghost" onPress={() => setScanning(false)}>Cancel</Button>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <GlassPanel>
        <SectionHeading
          eyebrow="Connect"
          title="Pair with a desktop"
          description="Scan the QR shown by the desktop app, paste a guest URL, or pick a discovered device."
        />
      </GlassPanel>

      <GlassPanel>
        <Badge tone="blue">Same Wi-Fi · QR</Badge>
        <View style={styles.spacer} />
        <Text style={styles.copy}>Recommended path. Decrypts the pairing payload locally and runs a six-digit PIN handshake.</Text>
        <View style={styles.spacerLg} />
        <Button
          variant="primary"
          onPress={async () => {
            if (!permission?.granted) {
              const result = await requestPermission();
              if (!result.granted) return;
            }
            setScanning(true);
          }}
        >
          Open scanner
        </Button>
        <View style={styles.spacer} />
        <TextInput
          onChangeText={setManualUrl}
          placeholder="http://192.168.1.x:17619/guest/<token>"
          value={manualUrl}
        />
        <View style={styles.spacer} />
        <Button
          disabled={!manualUrl.trim() || verifying}
          onPress={() => void handleParsed(manualUrl, 'manual')}
        >
          {verifying ? 'Checking…' : 'Connect via URL'}
        </Button>
      </GlassPanel>

      <GlassPanel>
        <Badge tone={discovery.available ? 'amber' : 'neutral'}>
          {discovery.available ? `Nearby · ${discovery.peers.length}` : 'mDNS unavailable'}
        </Badge>
        <View style={styles.spacer} />
        <SectionHeading
          title="Nearby devices"
          description={
            discovery.available
              ? 'Devices advertising _dropbeam._tcp on this network.'
              : 'react-native-zeroconf needs a native build. Run `expo prebuild` and rebuild the app.'
          }
        />
        <View style={styles.spacerLg} />
        {discovery.peers.length === 0 ? (
          <Text style={styles.copyDim}>No nearby devices.</Text>
        ) : (
          <View style={{ gap: tokens.spacing.sm }}>
            {discovery.peers.map((peer) => (
              <Pressable
                key={peer.id}
                onPress={() => {
                  setManualUrl(`http://${peer.host}:${peer.port}`);
                }}
                style={styles.peerRow}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.peerName}>{peer.name}</Text>
                  <Text style={styles.peerMeta}>{peer.host}:{peer.port}</Text>
                </View>
                {peer.fingerprint ? <Text style={styles.peerMeta}>{peer.fingerprint.slice(0, 6)}</Text> : null}
              </Pressable>
            ))}
          </View>
        )}
      </GlassPanel>

      {error || state === 'error' ? (
        <GlassPanel>
          <Badge tone="danger">Error</Badge>
          <View style={styles.spacer} />
          <Text style={styles.errorText}>{error ?? 'Connection failed.'}</Text>
        </GlassPanel>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
  },
  spacer: { height: tokens.spacing.sm },
  spacerLg: { height: tokens.spacing.md },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: tokens.spacing.md,
    justifyContent: 'center',
    padding: tokens.spacing.xl,
    backgroundColor: tokens.color.bg,
  },
  title: {
    color: tokens.color.text,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.title,
    fontWeight: tokens.fontWeight.bold,
  },
  copy: {
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.lineHeight.body,
  },
  copyDim: {
    color: tokens.color.textDim,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
  },
  actionRow: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    marginTop: tokens.spacing.md,
  },
  actionItem: { flex: 1 },
  scannerHud: {
    alignItems: 'center',
    backgroundColor: tokens.color.overlay,
    bottom: 0,
    gap: tokens.spacing.md,
    left: 0,
    padding: tokens.spacing.lg,
    position: 'absolute',
    right: 0,
  },
  scannerHudText: {
    color: tokens.color.text,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    textAlign: 'center',
  },
  peerRow: {
    alignItems: 'center',
    backgroundColor: tokens.color.inputBg,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    padding: tokens.spacing.md,
  },
  peerName: {
    color: tokens.color.text,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.bodyLg,
    fontWeight: tokens.fontWeight.semibold,
  },
  peerMeta: {
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.caption,
  },
  errorText: {
    color: tokens.color.danger,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.lineHeight.body,
  },
});
