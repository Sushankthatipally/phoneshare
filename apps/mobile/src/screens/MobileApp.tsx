import { useMemo, useState } from 'react';

import { Button, Text, View } from '../lib/native.js';
import { LiveBadge } from '../components/LiveBadge.js';
import { ScreenCard } from '../components/ScreenCard.js';
import { useMobileBackend } from '../hooks/useMobileBackend.js';
import { ConnectScreen } from './ConnectScreen.js';
import { ReceiveScreen } from './ReceiveScreen.js';
import { SendScreen } from './SendScreen.js';
import { formatBytes } from '@dropbeam/protocol';

type Screen = 'connect' | 'receive' | 'send';

export function MobileApp({ initialScreen = 'connect' }: { initialScreen?: Screen }) {
  const backend = useMobileBackend();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const session = backend.activeSession;

  const description = useMemo(() => {
    if (backend.loading) {
      return 'Loading live sessions from the local backend.';
    }

    if (backend.error) {
      return backend.error;
    }

    if (!session) {
      return 'Create a session on desktop to get started.';
    }

    return session.pairing.verifiedAt
      ? `Paired with ${session.localDevice.name} and ready for live transfers.`
      : `Enter PIN ${session.pairing.pin} to pair this phone.`;
  }, [backend.error, backend.loading, session]);

  return (
    <View style={{ display: 'grid', gap: 16 }}>
      <ScreenCard>
        <Text style={styles.eyebrow}>DropBeam mobile</Text>
        <Text style={styles.title}>{session ? 'Live transfer lane' : 'Pair to desktop'}</Text>
        <Text style={styles.copy}>{description}</Text>

        <View style={styles.badgeRow}>
          <LiveBadge>{backend.loading ? 'loading' : 'live backend'}</LiveBadge>
          <LiveBadge>{session?.state ?? 'idle'}</LiveBadge>
        </View>

        <View style={styles.summaryGrid}>
          <Summary label="Queue" value={String(session?.queue.totalFiles ?? 0)} />
          <Summary label="Bytes" value={formatBytes(session?.summary.totalBytes ?? 0)} />
          <Summary label="Sessions" value={String(backend.health?.sessions ?? 0)} />
        </View>

        <View style={styles.tabRow}>
          {[
            ['connect', 'Connect'],
            ['receive', 'Receive'],
            ['send', 'Send'],
          ].map(([key, label]) => (
            <Button key={key} onPress={() => setScreen(key as Screen)} style={{ flex: 1 }}>
              {label}
            </Button>
          ))}
        </View>
      </ScreenCard>

      {screen === 'connect' ? <ConnectScreen backend={backend} /> : null}
      {screen === 'receive' ? <ReceiveScreen backend={backend} /> : null}
      {screen === 'send' ? <SendScreen backend={backend} /> : null}
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
  eyebrow: {
    color: '#89b7d1',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  title: {
    color: '#f4f8ff',
    fontSize: 28,
    fontWeight: 800,
    marginTop: 8,
  },
  copy: {
    color: '#b3c8da',
    lineHeight: 1.5,
    marginTop: 10,
  },
  badgeRow: {
    display: 'flex',
    gap: 8,
    marginTop: 14,
    flexWrap: 'wrap' as const,
  },
  summaryGrid: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    marginTop: 16,
  },
  summaryCard: {
    backgroundColor: '#0c1625',
    border: '1px solid #1e2f44',
    borderRadius: 18,
    padding: 12,
  },
  summaryLabel: {
    color: '#8aa6bf',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  summaryValue: {
    color: '#eef6ff',
    fontSize: 16,
    fontWeight: 700,
    marginTop: 6,
  },
  tabRow: {
    display: 'flex',
    gap: 8,
    marginTop: 16,
  },
};
