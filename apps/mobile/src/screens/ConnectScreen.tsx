import { useEffect, useState } from 'react';

import { Badge, Button, GlassPanel } from '@dropbeam/shared-ui';

import type { ReturnTypeOfUseMobileBackend } from './types.js';
import { Text, TextInput, View } from '../lib/native.js';

export function ConnectScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  const active = backend.activeSession;
  const [pin, setPin] = useState('');
  const [clipboardText, setClipboardText] = useState('');

  useEffect(() => {
    setClipboardText(backend.clipboard?.text ?? '');
  }, [backend.clipboard?.text]);

  return (
    <GlassPanel>
      <View style={{ display: 'grid', gap: 12 }}>
        <Text style={styles.title}>Connect</Text>
        <Text style={styles.copy}>Choose a desktop session and pair using the PIN shown on the desktop app.</Text>
        <View style={styles.row}>
          <Badge tone={active?.pairing.verifiedAt ? 'green' : 'amber'}>
            {active?.pairing.verifiedAt ? 'paired' : 'pin required'}
          </Badge>
          <Button onClick={() => void backend.refresh()} variant="secondary">
            Refresh
          </Button>
        </View>

        <View style={styles.sessionList}>
          {backend.sessions.length ? (
            backend.sessions.map((session) => (
              <Button key={session.id} onClick={() => backend.setSelectedSessionId(session.id)} variant="ghost">
                {session.localDevice.name} - {session.mode}
              </Button>
            ))
          ) : (
            <Text style={styles.copy}>No session is available yet. Create one from the desktop app first.</Text>
          )}
        </View>

        <View style={{ display: 'grid', gap: 10 }}>
          <TextInput
            onChangeText={setPin}
            placeholder="Enter PIN"
            value={pin}
          />
          <Button disabled={!active || !pin || backend.busy === 'pair-session'} onClick={() => void backend.pairSession(pin)}>
            Pair this phone
          </Button>
        </View>

        <View style={{ display: 'grid', gap: 10 }}>
          <Text style={styles.label}>Shared clipboard</Text>
          <TextInput
            onChangeText={setClipboardText}
            placeholder="Share a note or link"
            value={clipboardText}
          />
          <Button disabled={backend.busy === 'update-clipboard'} onClick={() => void backend.updateClipboard(clipboardText)}>
            {backend.busy === 'update-clipboard' ? 'Syncing...' : 'Sync clipboard'}
          </Button>
        </View>
      </View>
    </GlassPanel>
  );
}

const styles = {
  title: {
    color: '#f2f7ff',
    fontSize: 22,
    fontWeight: 800,
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 1.5,
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  sessionList: {
    display: 'grid',
    gap: 8,
  },
  label: {
    color: '#89b7d1',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
};
