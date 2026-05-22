import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as Device from 'expo-device';

import { Button, ScrollView, Text, TextInput, View } from '../lib/native.js';

export function OnboardingScreen({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  // Seed the input with the OS-reported device name (e.g. "Sushank's iPhone")
  // unless the user has already started typing.
  useEffect(() => {
    if (touched) return;
    const fallback = Device.deviceName?.trim();
    if (fallback) {
      setName(fallback);
    } else {
      setName('My Phone');
    }
  }, [touched]);

  const submit = () => {
    const final = name.trim() || Device.deviceName?.trim() || 'My Phone';
    onDone(final);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>STEP 2 OF 2</Text>
        <Text style={styles.title}>Name this device</Text>
        <Text style={styles.copy}>
          Other devices will see this name when you connect. You can change it later in Settings.
        </Text>

        <TextInput
          onChangeText={(value) => {
            setTouched(true);
            setName(value);
          }}
          placeholder="My Phone"
          value={name}
        />

        <View style={{ marginTop: 12 }}>
          <Button onPress={submit}>Continue →</Button>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>NEXT</Text>
        <Text style={styles.title}>You're almost there</Text>
        <Text style={styles.copy}>
          After this, you'll connect to your DropBeam desktop using either a QR scan or by pasting a share URL.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 14, padding: 16 },
  card: {
    backgroundColor: '#0a0a0a',
    borderColor: '#1f1f1f',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
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
});
