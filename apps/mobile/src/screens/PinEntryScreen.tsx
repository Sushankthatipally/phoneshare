import { useEffect } from 'react';
import { Pressable, StyleSheet, View as RNView } from 'react-native';
import { useRouter } from 'expo-router';

import { Badge, Button, GlassPanel, SectionHeading, tokens } from '@dropbeam/shared-ui-rn';

import { ScrollView, Text } from '../lib/native.js';
import { useConnection } from '../lib/connection.js';

/**
 * Post-scan waiting screen. The phone has POSTed /connect; the desktop now
 * shows an Accept/Decline prompt. We sit here until SSE delivers
 * `session-paired` (state transitions to 'paired') or 'locked' / 'expired'.
 */
export function PinEntryScreen() {
  const { state, disconnect, connection, errorMessage } = useConnection();
  const router = useRouter();

  useEffect(() => {
    if (state === 'paired') {
      router.replace('/send');
    }
  }, [state, router]);

  const startOver = async () => {
    await disconnect();
    router.replace('/');
  };

  if (!connection || (connection.kind !== 'direct' && connection.kind !== 'hotspot')) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <GlassPanel>
          <SectionHeading eyebrow="Connect" title="No pairing in progress" description="Scan a desktop QR code to start." />
          <RNView style={{ height: tokens.spacing.md }} />
          <Button variant="primary" onPress={() => router.replace('/')}>Back to scan</Button>
        </GlassPanel>
      </ScrollView>
    );
  }

  const locked = state === 'locked';
  const expired = state === 'expired';

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <GlassPanel>
        <Badge tone={locked ? 'danger' : expired ? 'amber' : 'blue'}>
          {locked ? 'Declined' : expired ? 'Expired' : 'Waiting'}
        </Badge>
        <RNView style={{ height: tokens.spacing.sm }} />
        <SectionHeading
          eyebrow="Connect"
          title={
            locked
              ? 'Desktop declined the connection'
              : expired
                ? 'Session expired'
                : 'Waiting for desktop to accept…'
          }
          description={
            locked
              ? 'Generate a new QR on the desktop and try again.'
              : expired
                ? 'Generate a new QR on the desktop and try again.'
                : 'Look at the DropBeam window — it should show an Accept button for your phone.'
          }
        />
      </GlassPanel>

      {errorMessage ? (
        <GlassPanel>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </GlassPanel>
      ) : null}

      <GlassPanel>
        {locked || expired ? (
          <Button variant="primary" onPress={() => void startOver()}>Start over</Button>
        ) : (
          <Pressable onPress={() => void startOver()}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        )}
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
  },
  errorText: {
    color: tokens.color.danger,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.lineHeight.body,
  },
  cancelLink: {
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    textAlign: 'center',
  },
});
