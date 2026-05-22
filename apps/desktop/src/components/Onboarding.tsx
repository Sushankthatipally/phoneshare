import { useEffect, useState } from 'react';

import { Button } from '@dropbeam/shared-ui';

import { Modal } from './Modal.js';
import { getSystemHostname, openFolderDialog } from '../lib/tauri.js';
import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function Onboarding({ backend }: { backend: DesktopBackendState }) {
  const [step, setStep] = useState(1);
  const [deviceName, setDeviceName] = useState(backend.settings?.deviceName ?? '');
  const [downloadFolder, setDownloadFolder] = useState(backend.settings?.downloadFolder ?? '');
  const [mode, setMode] = useState<'auto' | 'wifi' | 'usb'>(backend.settings?.connectionMode ?? 'auto');
  const [hostnameLoaded, setHostnameLoaded] = useState(false);

  useEffect(() => {
    if (hostnameLoaded) return;
    let cancelled = false;
    (async () => {
      if (!deviceName) {
        const hostname = await getSystemHostname();
        if (!cancelled && hostname) setDeviceName(hostname);
      }
      if (!cancelled) setHostnameLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceName, hostnameLoaded]);

  const canContinue = step === 1 ? deviceName.trim().length > 0 : step === 2 ? downloadFolder.trim().length > 0 : true;

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
          <input
            className="input"
            autoFocus
            onChange={(e) => setDeviceName(e.target.value)}
            value={deviceName}
            placeholder={hostnameLoaded ? '' : 'Loading…'}
          />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="field">
          <span className="field__label">Download folder</span>
          <div className="topbar__actions" style={{ gap: 8 }}>
            <input
              className="input"
              onChange={(e) => setDownloadFolder(e.target.value)}
              value={downloadFolder}
              style={{ flex: 1 }}
            />
            <Button
              variant="secondary"
              onClick={async () => {
                const picked = await openFolderDialog({ defaultPath: downloadFolder, title: 'Choose download folder' });
                if (picked) setDownloadFolder(picked);
              }}
            >
              Browse
            </Button>
          </div>
          <p className="card__copy" style={{ fontSize: '0.85rem' }}>
            Files your phone sends will land here.
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
          disabled={!canContinue}
          onClick={async () => {
            if (step < 3) {
              setStep(step + 1);
              return;
            }
            await backend.updateSettings({
              deviceName: deviceName.trim(),
              downloadFolder: downloadFolder.trim(),
              connectionMode: mode,
              onboardingComplete: true,
            });
          }}
          variant="primary"
        >
          {step < 3 ? 'Continue' : 'Done'}
        </Button>
      </div>
    </Modal>
  );
}
