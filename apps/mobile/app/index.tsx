import { useState } from 'react';

import { ConnectScreen } from '../src/screens/ConnectScreen.js';
import { OnboardingScreen } from '../src/screens/OnboardingScreen.js';
import { PermissionScreen } from '../src/screens/PermissionScreen.js';
import { useConnection } from '../src/lib/connection.js';

export default function Index() {
  const { onboarded, setDeviceName, markOnboarded } = useConnection();
  // Two-step onboarding: permissions, then device name. Both happen on first launch only.
  const [step, setStep] = useState<'permissions' | 'name' | 'done'>(onboarded ? 'done' : 'permissions');

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
  return <ConnectScreen />;
}
