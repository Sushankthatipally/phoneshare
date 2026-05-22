import { useState } from 'react';

import { LiveBadge } from '../components/LiveBadge.js';
import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import { useMobileBackend } from '../hooks/useMobileBackend.js';
import { HistoryScreen } from './HistoryScreen.js';
import { HomeScreen } from './HomeScreen.js';
import { ReceiveScreen } from './ReceiveScreen.js';
import { ScanScreen } from './ScanScreen.js';
import { SendScreen } from './SendScreen.js';
import { PermissionScreen } from './PermissionScreen.js';
import { OnboardingScreen } from './OnboardingScreen.js';
import { IncomingScreen } from './IncomingScreen.js';
import { HotspotJoinScreen } from './HotspotJoinScreen.js';
import { ShareSheetScreen } from './ShareSheetScreen.js';

type Screen =
  | 'permissions'
  | 'onboarding'
  | 'home'
  | 'scan'
  | 'receive'
  | 'send'
  | 'history'
  | 'incoming'
  | 'hotspot'
  | 'share-sheet';

const SAMPLE_INCOMING_FILES = [
  { id: '1', name: 'vacation.jpg', sizeLabel: '2.4 MB' },
  { id: '2', name: 'video.mp4', sizeLabel: '847 MB' },
  { id: '3', name: 'report.pdf', sizeLabel: '1.1 MB' },
];

const SAMPLE_TARGETS = [
  { id: 'mac', name: 'MacBook Pro', lastUsed: '2 minutes ago' },
  { id: 'pixel', name: 'Pixel 8 Pro', lastUsed: 'yesterday' },
];

export function MobileApp({ initialScreen = 'home' }: { initialScreen?: Screen }) {
  const backend = useMobileBackend();
  const [screen, setScreen] = useState<Screen>(initialScreen);

  return (
    <View style={{ gap: 16 }}>
      <ScreenCard
        eyebrow="DropBeam mobile"
        title="Native transfer lane"
        copy="QR discovery, LAN visibility, hotspot scaffolding, accept-on-receive verification — every spec flow has a screen."
      >
        <View style={styles.badgeRow}>
          <LiveBadge tone={backend.loading ? 'amber' : 'blue'}>{backend.loading ? 'booting' : 'native ready'}</LiveBadge>
          <LiveBadge tone="green">{backend.connectionLabel}</LiveBadge>
          <LiveBadge tone="slate">{backend.chunkSizeLabel}</LiveBadge>
        </View>

        <View style={styles.summaryGrid}>
          <Summary label="Hosts" value={String(backend.beacons.length)} />
          <Summary label="Jobs" value={String(backend.transfers.length)} />
          <Summary label="History" value={String(backend.history.length)} />
        </View>

        <View style={styles.tabRow}>
          {[
            ['permissions', 'Perm'],
            ['onboarding', 'Setup'],
            ['home', 'Home'],
            ['scan', 'Scan'],
            ['receive', 'Receive'],
            ['send', 'Send'],
            ['incoming', 'Incoming'],
            ['hotspot', 'Hotspot'],
            ['share-sheet', 'Share'],
            ['history', 'History'],
          ].map(([key, label]) => (
            <View key={key} style={{ width: '48%' }}>
              <Button onPress={() => setScreen(key as Screen)}>{label}</Button>
            </View>
          ))}
        </View>
      </ScreenCard>

      {screen === 'permissions' ? <PermissionScreen onContinue={() => setScreen('onboarding')} /> : null}
      {screen === 'onboarding' ? <OnboardingScreen onDone={() => setScreen('home')} /> : null}
      {screen === 'home' ? <HomeScreen backend={backend} /> : null}
      {screen === 'scan' ? <ScanScreen backend={backend} /> : null}
      {screen === 'receive' ? <ReceiveScreen backend={backend} /> : null}
      {screen === 'send' ? <SendScreen backend={backend} /> : null}
      {screen === 'history' ? <HistoryScreen backend={backend} /> : null}
      {screen === 'incoming' ? (
        <IncomingScreen
          sender="MacBook Pro"
          files={SAMPLE_INCOMING_FILES}
          onAcceptAll={() => setScreen('home')}
          onAcceptSome={() => setScreen('home')}
          onDecline={() => setScreen('home')}
        />
      ) : null}
      {screen === 'hotspot' ? (
        <HotspotJoinScreen
          ssid="DropBeam-K7MX2P"
          password="hq8n3rjwtz5m"
          isIOS
          onJoined={() => setScreen('home')}
        />
      ) : null}
      {screen === 'share-sheet' ? (
        <ShareSheetScreen
          fileName="Camera roll export.jpg"
          fileSize="8.6 MB"
          targets={SAMPLE_TARGETS}
          onSend={() => setScreen('home')}
          onCancel={() => setScreen('home')}
        />
      ) : null}
    </View>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = {
  badgeRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  summaryGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  summaryCard: {
    backgroundColor: '#0c1625',
    borderColor: '#1e2f44',
    borderRadius: 18,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: 100,
    gap: 6,
    padding: 12,
  },
  summaryLabel: {
    color: '#89b7d1',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  summaryValue: { color: '#eef6ff', fontSize: 16, fontWeight: '700' as const },
  tabRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginTop: 16,
  },
};
