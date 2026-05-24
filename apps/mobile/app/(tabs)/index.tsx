import { useEffect, useState } from 'react';

import { SendScreenView } from '../../src/screens/SendScreen.js';
import { OnboardingScreen } from '../../src/screens/OnboardingScreen.js';
import { PermissionScreen } from '../../src/screens/PermissionScreen.js';
import { ScrollView, Text, View } from '../../src/lib/native.js';
import { useConnection } from '../../src/lib/connection.js';

type Step = 'permissions' | 'name' | 'done';

export default function Index() {
  const { onboarded, setDeviceName, markOnboarded, hydrated } = useConnection();
  const [step, setStep] = useState<Step | null>(null);

  // Resolve the initial step only once persisted state has been loaded;
  // before that, render nothing to avoid flashing onboarding for returning users.
  useEffect(() => {
    if (!hydrated) return;
    setStep(onboarded ? 'done' : 'permissions');
  }, [hydrated, onboarded]);

  if (!hydrated || !step) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <View style={{ padding: 16 }}>
          <Text style={{ color: '#7a7a7a' }}>Loading…</Text>
        </View>
      </ScrollView>
    );
  }

  if (step === 'permissions') {
    return <PermissionScreen onContinue={() => setStep('name')} />;
  }
  if (step === 'name') {
    return (
      <OnboardingScreen
        onDone={(name) => {
          setDeviceName(name);
          markOnboarded();
          setStep('done');
        }}
      />
    );
  }
  return <SendScreenView />;
}
