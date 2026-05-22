import { useEffect, useState } from 'react';

export function Countdown({ expiresAt, onExpire }: { expiresAt: string | null | undefined; onExpire?: () => void }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  const target = expiresAt ? new Date(expiresAt).getTime() : 0;
  const remaining = expiresAt ? Math.max(0, target - now) : 0;

  useEffect(() => {
    if (expiresAt && remaining === 0 && onExpire) onExpire();
  }, [expiresAt, remaining, onExpire]);

  if (!expiresAt) return null;

  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);
  const tone = remaining === 0 ? 'chip--warn' : remaining < 60_000 ? 'chip--warn' : 'chip--ok';

  return (
    <span className={`chip ${tone}`}>
      {remaining === 0 ? 'Expired' : `Expires in ${mins}:${String(secs).padStart(2, '0')}`}
    </span>
  );
}
