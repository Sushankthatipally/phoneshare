import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, ScrollView, Text, TextInput, View } from '../lib/native.js';

export function OnboardingScreen({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState('My Phone');

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>STEP 2 OF 2</Text>
        <Text style={styles.title}>Name this device</Text>
        <Text style={styles.copy}>
          Other devices will see this name when you connect. You can change it later in Settings.
        </Text>

        <TextInput onChangeText={setName} placeholder="My Phone" value={name} />

        <View style={{ marginTop: 12 }}>
          <Button onPress={() => onDone(name.trim() || 'My Phone')}>Continue →</Button>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>NEXT</Text>
        <Text style={styles.title}>You're almost there</Text>
        <Text style={styles.copy}>
          After this, you'll connect to your DropBeam desktop using either a QR scan or by pasting a share URL.
          USB cable and hotspot modes are coming in a future update.
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
