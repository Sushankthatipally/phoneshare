import { useState } from 'react';
import { StyleSheet } from 'react-native';
import * as Device from 'expo-device';
import { GlassPanel, tokens } from '@dropbeam/shared-ui-rn';

import { Button, ScrollView, Text, TextInput, View } from '../lib/native.js';

export function OnboardingScreen({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState(() => Device.deviceName ?? '');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: tokens.color.bg }} contentContainerStyle={styles.scroll}>
      <GlassPanel style={styles.card}>
        <Text style={styles.eyebrow}>STEP 2 OF 2</Text>
        <Text style={styles.title}>Name this device</Text>
        <Text style={styles.copy}>
          Other devices will see this name when you connect. You can change it later in Settings.
        </Text>

        <TextInput onChangeText={setName} placeholder="My phone" value={name} />

        <View style={{ marginTop: tokens.spacing.sm }}>
          <Button onPress={() => onDone(name.trim() || Device.deviceName || 'My phone')}>Continue</Button>
        </View>
      </GlassPanel>

      <GlassPanel style={styles.card}>
        <Text style={styles.eyebrow}>NEXT</Text>
        <Text style={styles.title}>You're almost there</Text>
        <Text style={styles.copy}>
          After this, you'll connect to your DropBeam desktop using either a QR scan or by pasting a share URL.
          USB cable and hotspot modes are coming in a future update.
        </Text>
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: tokens.spacing.md, padding: tokens.spacing.lg },
  card: {
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
  },
  eyebrow: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.textDim,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.text,
    fontSize: tokens.fontSize.xl,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.tight,
  },
  copy: {
    fontFamily: tokens.fontFamily.sans,
    color: tokens.color.textSoft,
    fontSize: tokens.fontSize.body,
    lineHeight: tokens.fontSize.body * tokens.lineHeight.normal,
  },
});
