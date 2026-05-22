import { useState } from 'react';

import { LiveBadge } from '../components/LiveBadge.js';
import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import { useMobileBackend } from '../hooks/useMobileBackend.js';
import { HistoryScreen } from './HistoryScreen.js';
import { HomeScreen } from './HomeScreen.js';
import { ReceiveScreen } from './ReceiveScreen.js';
import { ScanScreen } from './ScanScreen.js';
import { SendScreenView } from './SendScreen.js';
import { PermissionScreen } from './PermissionScreen.js';
import { OnboardingScreen } from './OnboardingScreen.js';
import { IncomingScreen } from './IncomingScreen.js';
import { HotspotJoinScreen } from './HotspotJoinScreen.js';
import { ShareSheetScreen } from './ShareSheetScreen.js';

/**
 * Dev harness — lets a developer flip between every screen in one root.
 * Not mounted by Expo Router. Replaced by `/` and friends at runtime.
 *
 * Every value rendered here either comes from a real hook or is left as
 * an explicit empty state. No fake device names, no fake transfers.
 */

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

export function MobileApp({ initialScreen = 'home' }: { initialScreen?: Screen }) {
  const backend = useMobileBackend();
  const [screen, setScreen] = useState<Screen>(initialScreen);

  return (
    <View style={{ gap: 16 }}>
      <ScreenCard
        eyebrow="DropBeam mobile"
        title="Dev harness"
        copy="Flip between screens. Discovery, sessions, and history pull from the live context — empty states are real."
      >
        <View style={styles.badgeRow}>
          <LiveBadge tone={backend.loading ? 'amber' : 'blue'}>{backend.loading ? 'connecting' : 'idle'}</LiveBadge>
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
      {screen === 'send' ? <SendScreenView /> : null}
      {screen === 'history' ? <HistoryScreen /> : null}
      {screen === 'incoming' ? <IncomingScreen /> : null}
      {screen === 'hotspot' ? (
        <HotspotJoinScreen
          ssid="—"
          password="—"
          isIOS
          onJoined={() => setScreen('home')}
        />
      ) : null}
      {screen === 'share-sheet' ? (
        <ShareSheetScreen
          fileName="—"
          fileSize="—"
          targets={[]}
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
