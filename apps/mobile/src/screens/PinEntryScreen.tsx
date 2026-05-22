import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput as RNTextInput,
  View as RNView,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Badge, Button, GlassPanel, SectionHeading, tokens } from '@dropbeam/shared-ui-rn';

import { ScrollView, Text, View } from '../lib/native.js';
import { useConnection } from '../lib/connection.js';

/**
 * Six-digit SAS PIN entry — Flow 2.1 / 4.1.
 *
 * The shared secret has already been derived locally during the ECDH step;
 * the SAS PIN the desktop shows is computed from the same secret, so a
 * correct entry confirms the channel is genuine end-to-end. We only POST
 * the PIN so the backend can run constant-time comparison + track the
 * attempt counter.
 */
export function PinEntryScreen() {
  const { state, verifyPin, attemptsRemaining, disconnect, connection, errorMessage } = useConnection();
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const router = useRouter();
  const inputs = useRef<Array<RNTextInput | null>>([]);

  useEffect(() => {
    if (state === 'paired') {
      router.replace('/send');
    }
  }, [state, router]);

  useEffect(() => {
    // Auto-focus the first box on mount.
    inputs.current[0]?.focus();
  }, []);

  const setDigit = (index: number, value: string) => {
    // Accept only the most recent digit character.
    const digit = value.replace(/\D/g, '').slice(-1);
    setDigits((current) => {
      const next = [...current];
      next[index] = digit;
      return next;
    });
    if (digit && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key !== 'Backspace') return;
    setDigits((current) => {
      const next = [...current];
      if (next[index]) {
        next[index] = '';
        return next;
      }
      if (index > 0) {
        next[index - 1] = '';
        // queue focus after state update
        setTimeout(() => inputs.current[index - 1]?.focus(), 0);
      }
      return next;
    });
  };

  const submit = async () => {
    const pin = digits.join('');
    if (pin.length !== 6) {
      setFeedback('Enter all 6 digits.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    const response = await verifyPin(pin);
    setSubmitting(false);

    if (response.ok) {
      // useEffect on `state` will redirect to /send.
      return;
    }

    if (response.reason === 'locked') {
      setFeedback('Too many wrong attempts. This session is locked.');
    } else if (response.reason === 'expired') {
      setFeedback('Session expired. Generate a new QR.');
    } else if (response.reason === 'invalid-session') {
      setFeedback('No active pairing. Scan a QR first.');
    } else {
      const remaining = response.attemptsRemaining ?? attemptsRemaining;
      setFeedback(remaining > 0 ? `Wrong PIN — ${remaining} ${remaining === 1 ? 'try' : 'tries'} left` : 'Too many wrong attempts.');
      setDigits(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    }
  };

  const startOver = async () => {
    await disconnect();
    router.replace('/');
  };

  if (!connection || (connection.kind !== 'direct' && connection.kind !== 'hotspot')) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
        <GlassPanel>
          <SectionHeading eyebrow="PIN" title="No pairing in progress" description="Scan a desktop QR code to start." />
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
          {locked ? 'Locked' : expired ? 'Expired' : 'Verify'}
        </Badge>
        <RNView style={{ height: tokens.spacing.sm }} />
        <SectionHeading
          eyebrow="PIN"
          title="Enter the 6 digits shown on the desktop"
          description={
            locked
              ? 'This session is closed for security. Generate a new QR on the desktop.'
              : expired
                ? 'The session expired. Generate a new QR on the desktop.'
                : 'Both devices computed the same PIN from the encrypted handshake. Match them to confirm.'
          }
        />
      </GlassPanel>

      <GlassPanel>
        <View style={styles.pinRow}>
          {digits.map((value, index) => (
            <RNTextInput
              key={index}
              ref={(el) => {
                inputs.current[index] = el;
              }}
              accessibilityLabel={`Digit ${index + 1}`}
              autoComplete="off"
              caretHidden
              editable={!locked && !expired && !submitting}
              keyboardType="number-pad"
              maxLength={1}
              onChangeText={(v) => setDigit(index, v)}
              onKeyPress={(e) => handleKeyPress(index, e.nativeEvent.key)}
              selectTextOnFocus
              style={[styles.pinBox, value ? styles.pinBoxFilled : null]}
              textAlign="center"
              value={value}
            />
          ))}
        </View>
        {feedback ? (
          <Text style={[styles.feedback, locked || expired ? styles.feedbackDanger : null]}>{feedback}</Text>
        ) : errorMessage ? (
          <Text style={[styles.feedback, styles.feedbackDanger]}>{errorMessage}</Text>
        ) : null}
        <RNView style={{ height: tokens.spacing.md }} />
        {locked || expired ? (
          <Button variant="primary" onPress={() => void startOver()}>Start over</Button>
        ) : (
          <Button
            variant="primary"
            disabled={submitting || digits.some((d) => !d)}
            onPress={() => void submit()}
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </Button>
        )}
        <RNView style={{ height: tokens.spacing.sm }} />
        <Pressable onPress={() => void startOver()}>
          <Text style={styles.cancelLink}>Cancel</Text>
        </Pressable>
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
  },
  pinRow: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    justifyContent: 'space-between',
  },
  pinBox: {
    backgroundColor: tokens.color.inputBg,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    color: tokens.color.text,
    flex: 1,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.pinDigit,
    fontWeight: tokens.fontWeight.semibold,
    height: 64,
    paddingHorizontal: 0,
    textAlign: 'center',
  },
  pinBoxFilled: {
    borderColor: tokens.color.panelBorderStrong,
  },
  feedback: {
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    marginTop: tokens.spacing.md,
    textAlign: 'center',
  },
  feedbackDanger: {
    color: tokens.color.danger,
  },
  cancelLink: {
    color: tokens.color.textSoft,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    textAlign: 'center',
  },
});
