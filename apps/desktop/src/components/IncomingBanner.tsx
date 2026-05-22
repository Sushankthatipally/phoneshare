import { Button } from '@dropbeam/shared-ui';

import type { DesktopBackendState } from '../features/dashboard/useDesktopBackend.js';

export function IncomingBanner({ backend }: { backend: DesktopBackendState }) {
  const pending = backend.sessions
    .filter((session) => session.state === 'awaiting-accept' && session.pendingRequest)
    .map((session) => ({ session, request: session.pendingRequest! }));

  if (!pending.length) return null;

  return (
    <div className="list" style={{ marginBottom: 16 }}>
      {pending.map(({ session, request }) => (
        <div className="banner" key={session.id}>
          <div className="banner__copy">
            <strong>📲 {request.peer.name} wants to connect</strong>
            <span>
              {request.peer.platform} · session {session.id.slice(0, 8)} · {new Date(request.requestedAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="banner__actions">
            <Button onClick={() => void backend.declineIncoming(session.id)} variant="ghost">
              Decline
            </Button>
            <Button onClick={() => void backend.acceptIncoming(session.id, true)} variant="primary">
              Accept
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
