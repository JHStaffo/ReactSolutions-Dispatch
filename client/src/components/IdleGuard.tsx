import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const WARN_MS = 60_000;
const KEEPALIVE_MS = 2 * 60_000;

/**
 * Automatic logoff. Real keyboard/mouse activity keeps the server session alive;
 * background live updates do not. A warning appears one minute before sign-out.
 */
export function IdleGuard({ timeoutMs, onTimeout }: { timeoutMs: number; onTimeout: () => void }) {
  const lastActivity = useRef(Date.now());
  const lastKeepalive = useRef(Date.now());
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'dragstart'];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const t = window.setInterval(() => {
      const now = Date.now();
      const idle = now - lastActivity.current;
      if (idle >= timeoutMs) {
        onTimeout();
        return;
      }
      setRemaining(idle >= timeoutMs - WARN_MS ? Math.ceil((timeoutMs - idle) / 1000) : null);
      if (idle < 60_000 && now - lastKeepalive.current > KEEPALIVE_MS) {
        lastKeepalive.current = now;
        api('auth/keepalive', { body: {} }).catch(() => {});
      }
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(t);
    };
  }, [timeoutMs, onTimeout]);

  if (remaining === null) return null;
  return (
    <div className="modal-backdrop idle">
      <div className="modal small">
        <div className="modal-head">
          <h2>Still there?</h2>
        </div>
        <div className="modal-body">
          <p>For patient privacy you'll be signed out in {remaining} seconds.</p>
        </div>
        <div className="modal-foot">
          <button
            className="btn primary"
            onClick={() => {
              lastActivity.current = Date.now();
              lastKeepalive.current = Date.now();
              api('auth/keepalive', { body: {} }).catch(() => {});
              setRemaining(null);
            }}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
