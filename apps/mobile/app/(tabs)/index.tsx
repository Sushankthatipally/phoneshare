import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { tokens } from '@dropbeam/shared-ui-rn';

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
  // On web the camera/notification permissions are meaningless, so skip that
  // step entirely and land returning-or-new users straight on naming/Send.
  useEffect(() => {
    if (!hydrated) return;
    if (onboarded) {
      setStep('done');
    } else {
      setStep(Platform.OS === 'web' ? 'name' : 'permissions');
    }
  }, [hydrated, onboarded]);

  if (!hydrated || !step) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: tokens.color.bg }} contentContainerStyle={{ padding: tokens.spacing.lg }}>
        <View style={{ padding: tokens.spacing.lg }}>
          <Text style={{ color: tokens.color.textDim, fontFamily: tokens.fontFamily.sans }}>Loading…</Text>
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
