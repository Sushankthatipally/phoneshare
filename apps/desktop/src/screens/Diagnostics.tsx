import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge, Button } from '@dropbeam/shared-ui';
import type { BackendHealth, LanIpsResponse, PreferredOrigin } from '@dropbeam/protocol';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace';

interface LogRecord {
  ts: string;
  level: string;
  target: string;
  message: string;
}

interface MdnsState {
  running: boolean;
  publishedService: string | null;
  publishedPort: number | null;
  lastError: string | null;
  peers: Array<{
    service: string;
    host: string;
    port: number;
    txt: Array<[string, string]>;
  }>;
}

interface UsbAndroidStatus {
  adbRequired: boolean;
  adbBinary: string;
  available: boolean;
  connectedDevices: string[];
  hostPort: number;
  devicePort: number;
  tunnelState: string;
}

interface FirewallStatus {
  port: number;
  bindable: boolean;
  error: string | null;
}

interface DiagnoseResult {
  script: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

type TauriBridge = {
  __TAURI_INTERNALS__?: {
    invoke?: <T = unknown>(cmd: string, args?: unknown) => Promise<T>;
  };
  __TAURI__?: {
    event?: {
      listen: (name: string, handler: (event: { payload: LogRecord }) => void) => Promise<() => void>;
    };
  };
};

const FIREWALL_PORTS = [17619, 38_251, 5353];

function getTauri(): TauriBridge | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & TauriBridge;
  if (!win.__TAURI_INTERNALS__ && !win.__TAURI__) return null;
  return win;
}

async function invokeTauri<T>(cmd: string, args?: unknown): Promise<T | null> {
  const bridge = getTauri();
  if (!bridge?.__TAURI_INTERNALS__?.invoke) return null;
  return bridge.__TAURI_INTERNALS__.invoke<T>(cmd, args);
}

export function Diagnostics({ backend }: { backend: DesktopBackendState }) {
  const [mdns, setMdns] = useState<MdnsState | null>(null);
  const [usb, setUsb] = useState<UsbAndroidStatus | null>(null);
  const [lan, setLan] = useState<LanIpsResponse | null>(null);
  const [firewall, setFirewall] = useState<Record<number, FirewallStatus> | null>(null);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(null);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logScrollerRef = useRef<HTMLDivElement | null>(null);

  const refreshLanIps = useCallback(async () => {
    try {
      const res = await fetch('/api/discovery/lan-ips');
      const body = (await res.json()) as LanIpsResponse;
      setLan(body);
    } catch {
      setLan(null);
    }
  }, []);

  const refreshFirewall = useCallback(async () => {
    const result = await invokeTauri<Record<string, FirewallStatus>>('firewall_check_ports', { ports: FIREWALL_PORTS });
    if (!result) {
      setFirewall(null);
      return;
    }
    const numeric: Record<number, FirewallStatus> = {};
    for (const [key, value] of Object.entries(result)) {
      numeric[Number(key)] = value;
    }
    setFirewall(numeric);
  }, []);

  const refreshMdns = useCallback(async () => {
    setMdns(await invokeTauri<MdnsState>('mdns_status'));
  }, []);

  const refreshUsb = useCallback(async () => {
    setUsb(await invokeTauri<UsbAndroidStatus>('usb_android_status'));
  }, []);

  useEffect(() => {
    void refreshLanIps();
    void refreshFirewall();
    void refreshMdns();
    void refreshUsb();
  }, [refreshFirewall, refreshLanIps, refreshMdns, refreshUsb]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshUsb();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refreshUsb]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void invokeTauri<LogRecord[]>('diagnostics_log_snapshot').then((snapshot) => {
      if (!cancelled && snapshot) setLogs(snapshot.slice(-500));
    });

    const bridge = getTauri();
    if (bridge?.__TAURI__?.event?.listen) {
      void bridge.__TAURI__.event
        .listen('dropbeam:log', (event) => {
          setLogs((current) => {
            const next = [...current, event.payload];
            return next.length > 500 ? next.slice(next.length - 500) : next;
          });
        })
        .then((dispose) => {
          if (cancelled) {
            dispose();
          } else {
            unlisten = dispose;
          }
        });
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    const scroller = logScrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [logs, autoScroll]);

  const firewallWarnings = useMemo(() => {
    if (!firewall) return [] as FirewallStatus[];
    return Object.values(firewall).filter((entry) => !entry.bindable);
  }, [firewall]);

  const copyLogs = useCallback(async () => {
    const payload = logs.map((line) => `${line.ts} ${line.level.toUpperCase()} [${line.target}] ${line.message}`).join('\n');
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Browser-level rejection (e.g. permissions) — silently swallow.
    }
  }, [logs]);

  const saveLogs = useCallback(() => {
    const payload = logs.map((line) => `${line.ts} ${line.level.toUpperCase()} [${line.target}] ${line.message}`).join('\n');
    if (!payload) return;
    const blob = new Blob([payload], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dropbeam-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [logs]);

  const runDiagnose = useCallback(async () => {
    setDiagnoseBusy(true);
    setDiagnoseError(null);
    try {
      const result = await invokeTauri<DiagnoseResult>('run_diagnose_script');
      if (result) {
        setDiagnoseResult(result);
      } else {
        setDiagnoseError('Tauri bridge unavailable — open the desktop app to run diagnostics.');
      }
    } catch (error) {
      setDiagnoseError(error instanceof Error ? error.message : String(error));
    } finally {
      setDiagnoseBusy(false);
    }
  }, []);

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <p className="card__eyebrow">Diagnostics</p>
        <h2 className="card__title">Live system state</h2>
        <p className="card__copy">
          Every value below is pulled straight from the running Tauri shell and the local backend — nothing is mocked.
        </p>
      </header>

      <BackendHealthSection health={backend.health} error={backend.error} loading={backend.loading} />
      <MdnsSection state={mdns} onRefresh={refreshMdns} />
      <UsbSection state={usb} onRefresh={refreshUsb} />
      <LanIpsSection state={lan} onRefresh={refreshLanIps} />
      <FirewallSection state={firewall} warnings={firewallWarnings} onRefresh={refreshFirewall} />

      <div className="card" style={{ background: 'rgba(0,0,0,0.02)', padding: 16 }}>
        <div className="topbar" style={{ marginBottom: 12 }}>
          <h3 className="card__title" style={{ fontSize: '1.05rem', margin: 0 }}>
            Live logs ({logs.length})
          </h3>
          <div className="topbar__actions">
            <label className="checkbox" style={{ marginRight: 12 }}>
              <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
              Auto-scroll
            </label>
            <Button onClick={() => void copyLogs()} variant="ghost" disabled={!logs.length}>
              Copy
            </Button>
            <Button onClick={saveLogs} variant="ghost" disabled={!logs.length}>
              Save to file
            </Button>
          </div>
        </div>
        <div
          ref={logScrollerRef}
          style={{
            height: 280,
            overflowY: 'auto',
            background: '#0b0d12',
            color: '#dbe1ea',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.5,
            padding: '8px 12px',
            borderRadius: 6,
          }}
        >
          {logs.length === 0 ? (
            <div style={{ opacity: 0.65 }}>Waiting for log events — interact with the app to populate this view.</div>
          ) : (
            logs.map((line, index) => (
              <div key={`${line.ts}-${index}`} style={{ whiteSpace: 'pre-wrap' }}>
                <span style={{ opacity: 0.55 }}>{line.ts.slice(11, 23)}</span>{' '}
                <span style={{ color: levelColor(line.level) }}>{line.level.toUpperCase().padEnd(5, ' ')}</span>{' '}
                <span style={{ opacity: 0.7 }}>{line.target}</span> {line.message}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ background: 'rgba(0,0,0,0.02)', padding: 16 }}>
        <div className="topbar" style={{ marginBottom: 8 }}>
          <h3 className="card__title" style={{ fontSize: '1.05rem', margin: 0 }}>
            Diagnose script
          </h3>
          <div className="topbar__actions">
            <Button onClick={() => void runDiagnose()} disabled={diagnoseBusy} variant="primary">
              {diagnoseBusy ? 'Running…' : 'Run diagnose script'}
            </Button>
          </div>
        </div>
        <p className="card__copy" style={{ marginTop: 0 }}>
          Runs the bundled <code>diagnose-mac.sh</code> / <code>diagnose-windows.ps1</code> and captures stdout + stderr.
        </p>
        {diagnoseError ? <p style={{ color: 'var(--db-red, #b91c1c)' }}>{diagnoseError}</p> : null}
        {diagnoseResult ? <DiagnoseModal result={diagnoseResult} onClose={() => setDiagnoseResult(null)} /> : null}
      </div>
    </section>
  );
}

function BackendHealthSection({
  health,
  error,
  loading,
}: {
  health: (BackendHealth & { uptimeSeconds: number }) | null;
  error: string | null;
  loading: boolean;
}) {
  return (
    <div className="card" style={{ background: 'rgba(0,0,0,0.02)', padding: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="row__copy">
          <strong>Backend health</strong>
          <span>/api/health (refreshed by SSE)</span>
        </div>
        {error ? (
          <Badge tone="amber">offline</Badge>
        ) : loading ? (
          <Badge tone="neutral">loading</Badge>
        ) : (
          <Badge tone="green">online</Badge>
        )}
      </div>
      {error ? <p style={{ color: 'var(--db-red, #b91c1c)' }}>{error}</p> : null}
      {health ? (
        <div className="stats">
          <StatPair label="Uptime" value={`${Math.round(health.uptimeSeconds)}s`} />
          <StatPair label="Sessions" value={`${health.sessions}`} />
          <StatPair label="Active" value={`${health.activeSessions}`} />
          <StatPair label="Paired" value={`${health.pairedSessions}`} />
          <StatPair label="Files" value={`${health.fileCount}`} />
          <StatPair label="Bytes" value={`${health.totalBytes}`} />
        </div>
      ) : null}
    </div>
  );
}

function MdnsSection({ state, onRefresh }: { state: MdnsState | null; onRefresh: () => void }) {
  return (
    <div className="card" style={{ background: 'rgba(0,0,0,0.02)', padding: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="row__copy">
          <strong>mDNS service</strong>
          <span>_dropbeam._tcp.local. — managed by Tauri</span>
        </div>
        <div className="topbar__actions">
          {state ? (
            <Badge tone={state.running ? 'green' : 'neutral'}>{state.running ? 'running' : 'idle'}</Badge>
          ) : (
            <Badge tone="neutral">unavailable</Badge>
          )}
          <Button variant="ghost" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>
      {state ? (
        <>
          <div className="stats">
            <StatPair label="Service" value={state.publishedService ?? '—'} />
            <StatPair label="Port" value={state.publishedPort ? String(state.publishedPort) : '—'} />
            <StatPair label="Peers" value={String(state.peers.length)} />
          </div>
          {state.lastError ? <p style={{ color: 'var(--db-red, #b91c1c)' }}>{state.lastError}</p> : null}
          {state.peers.length ? (
            <div className="list" style={{ marginTop: 8 }}>
              {state.peers.map((peer) => (
                <div className="row" key={`${peer.host}:${peer.port}`}>
                  <div className="row__copy">
                    <strong>{peer.host}:{peer.port}</strong>
                    <span>{peer.service}</span>
                  </div>
                  <code style={{ fontSize: 11, opacity: 0.7 }}>{peer.txt.map(([k, v]) => `${k}=${v}`).join(' ')}</code>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="card__copy">Tauri command <code>mdns_status</code> not reachable. Open this view from the desktop shell to see real data.</p>
      )}
    </div>
  );
}

function UsbSection({ state, onRefresh }: { state: UsbAndroidStatus | null; onRefresh: () => void }) {
  return (
    <div className="card" style={{ background: 'rgba(0,0,0,0.02)', padding: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="row__copy">
          <strong>USB tunnel (Android · adb)</strong>
          <span>polled every 5s</span>
        </div>
        <div className="topbar__actions">
          {state ? (
            <Badge tone={usbTone(state.tunnelState)}>{state.tunnelState}</Badge>
          ) : (
            <Badge tone="neutral">unavailable</Badge>
          )}
          <Button variant="ghost" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>
      {state ? (
        <div className="stats">
          <StatPair label="adb binary" value={state.adbBinary} />
          <StatPair label="Detected" value={state.available ? 'yes' : 'no'} />
          <StatPair label="Devices" value={state.connectedDevices.length ? state.connectedDevices.join(', ') : '—'} />
          <StatPair label="Host port" value={String(state.hostPort)} />
          <StatPair label="Device port" value={String(state.devicePort)} />
        </div>
      ) : (
        <p className="card__copy">Tauri command <code>usb_android_status</code> not reachable.</p>
      )}
    </div>
  );
}

function LanIpsSection({ state, onRefresh }: { state: LanIpsResponse | null; onRefresh: () => void }) {
  return (
    <div className="card" style={{ background: 'rgba(0,0,0,0.02)', padding: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="row__copy">
          <strong>LAN IP candidates</strong>
          <span>/api/discovery/lan-ips — ranked</span>
        </div>
        <Button variant="ghost" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      {state ? (
        <div className="list">
          {state.candidates.map((candidate) => (
            <CandidateRow
              key={`${candidate.host}-${candidate.interface}`}
              candidate={candidate}
              preferred={state.preferred.host === candidate.host && state.preferred.interface === candidate.interface}
            />
          ))}
        </div>
      ) : (
        <p className="card__copy">Backend did not return LAN candidates yet.</p>
      )}
    </div>
  );
}

function FirewallSection({
  state,
  warnings,
  onRefresh,
}: {
  state: Record<number, FirewallStatus> | null;
  warnings: FirewallStatus[];
  onRefresh: () => void;
}) {
  return (
    <div className="card" style={{ background: 'rgba(0,0,0,0.02)', padding: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="row__copy">
          <strong>Firewall probes</strong>
          <span>0.0.0.0 bind test per port</span>
        </div>
        <Button variant="ghost" onClick={onRefresh}>
          Re-probe
        </Button>
      </div>
      {warnings.length ? (
        <div className="card" style={{ borderColor: 'var(--db-amber, #b45309)', padding: 12, marginBottom: 12 }}>
          {warnings.map((entry) => (
            <p key={entry.port} className="card__copy" style={{ margin: 0 }}>
              Firewall may be blocking {entry.port} ({entry.error ?? 'bind failed'})
            </p>
          ))}
        </div>
      ) : null}
      {state ? (
        <div className="list">
          {Object.values(state).map((entry) => (
            <div className="row" key={entry.port}>
              <div className="row__copy">
                <strong>Port {entry.port}</strong>
                <span>{entry.bindable ? 'bindable on 0.0.0.0' : entry.error ?? 'bind failed'}</span>
              </div>
              <Badge tone={entry.bindable ? 'green' : 'amber'}>{entry.bindable ? 'OK' : 'BLOCKED'}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="card__copy">Tauri command <code>firewall_check_ports</code> not reachable.</p>
      )}
    </div>
  );
}

function CandidateRow({ candidate, preferred }: { candidate: PreferredOrigin; preferred: boolean }) {
  return (
    <div className="row">
      <div className="row__copy">
        <strong>{candidate.host}</strong>
        <span>
          {candidate.interface} · score {candidate.score} · {candidate.origin}
        </span>
      </div>
      {preferred ? <Badge tone="green">preferred</Badge> : <Badge tone="neutral">fallback</Badge>}
    </div>
  );
}

function StatPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
    </div>
  );
}

function DiagnoseModal({ result, onClose }: { result: DiagnoseResult; onClose: () => void }) {
  const combined = `# ${result.script}\n# exit=${result.exitCode ?? 'unknown'}\n\n${result.stdout}${
    result.stderr ? `\n--- stderr ---\n${result.stderr}` : ''
  }`;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 17, 22, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 720, width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <p className="card__eyebrow">Diagnose script output</p>
          <h2 className="card__title">{result.script}</h2>
          <p className="card__copy">Exit code: {result.exitCode ?? 'unknown'}</p>
        </header>
        <pre
          style={{
            background: '#0b0d12',
            color: '#dbe1ea',
            padding: 12,
            borderRadius: 6,
            overflow: 'auto',
            flex: 1,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {combined}
        </pre>
        <div className="topbar__actions" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(combined).catch(() => undefined);
            }}
          >
            Copy
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const blob = new Blob([combined], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `dropbeam-diagnose-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              URL.revokeObjectURL(url);
            }}
          >
            Save to file
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function levelColor(level: string): string {
  switch (level.toLowerCase() as LogLevel) {
    case 'error':
      return '#f87171';
    case 'warn':
      return '#fbbf24';
    case 'info':
      return '#60a5fa';
    case 'debug':
      return '#a3a3a3';
    case 'trace':
      return '#6b7280';
    default:
      return '#cbd5e1';
  }
}

function usbTone(state: string): 'green' | 'amber' | 'neutral' {
  switch (state) {
    case 'ready':
    case 'reverse-active':
      return 'green';
    case 'adb-unavailable':
    case 'no-device':
      return 'amber';
    default:
      return 'neutral';
  }
}
