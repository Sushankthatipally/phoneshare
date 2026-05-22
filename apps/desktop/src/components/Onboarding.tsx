import { useState } from 'react';

import { Button } from '@dropbeam/shared-ui';

import { Modal } from './Modal.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Onboarding({ backend }: { backend: DesktopBackendState }) {
  const [step, setStep] = useState(1);
  const [deviceName, setDeviceName] = useState(backend.settings?.deviceName ?? 'My Desktop');
  const [downloadFolder, setDownloadFolder] = useState(backend.settings?.downloadFolder ?? '~/Downloads/DropBeam/');
  const [mode, setMode] = useState<'auto' | 'wifi' | 'usb'>(backend.settings?.connectionMode ?? 'auto');

  return (
    <Modal>
      <div className="modal__header">
        <span className="modal__step">Setup · Step {step} of 3</span>
        <h2 className="modal__title">
          {step === 1 ? 'What should we call this device?' : step === 2 ? 'Where should received files go?' : 'Preferred connection mode?'}
        </h2>
      </div>

      {step === 1 ? (
        <div className="field">
          <span className="field__label">Device name</span>
          <input className="input" autoFocus onChange={(e) => setDeviceName(e.target.value)} value={deviceName} />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="field">
          <span className="field__label">Download folder</span>
          <input className="input" onChange={(e) => setDownloadFolder(e.target.value)} value={downloadFolder} />
          <p className="card__copy" style={{ fontSize: '0.85rem' }}>
            Files your phone sends will land here. Path is recorded as a preference — actual saves still go through your browser's download prompt.
          </p>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="list">
          {(['auto', 'wifi', 'usb'] as const).map((m) => (
            <button
              key={m}
              className={`row row--selectable${mode === m ? ' row--selected' : ''}`}
              onClick={() => setMode(m)}
              type="button"
            >
              <div className="row__copy">
                <strong>{m === 'auto' ? 'Auto (recommended)' : m === 'wifi' ? 'Always WiFi' : 'Always USB'}</strong>
                <span>
                  {m === 'auto'
                    ? 'USB if plugged in, WiFi otherwise.'
                    : m === 'wifi'
                      ? 'Pair via QR or LAN discovery.'
                      : 'Always use USB cable when available.'}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <div className="modal__actions">
        {step > 1 ? (
          <Button onClick={() => setStep(step - 1)} variant="ghost">
            Back
          </Button>
        ) : null}
        <Button
          onClick={async () => {
            if (step < 3) {
              setStep(step + 1);
              return;
            }
            await backend.updateSettings({
              deviceName,
              downloadFolder,
              connectionMode: mode,
              onboardingComplete: true,
            });
          }}
          variant="primary"
        >
          {step < 3 ? 'Continue →' : 'Done — Open App'}
        </Button>
      </div>
    </Modal>
  );
}
