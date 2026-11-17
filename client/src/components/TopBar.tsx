import { useEffect, useState } from 'react';
import type { CallSummary, Crew, SessionUser } from '../../../shared/types';
import { ACTIVE_STATUSES } from '../../../shared/types';
import type { SyncStatus } from '../liveSync';
import { addDays, fmtWait, minutesSince, sameDay, startOfDay } from '../time';

interface Props {
  user: SessionUser;
  day: Date;
  setDay: (d: Date) => void;
  calls: CallSummary[];
  crews: Crew[];
  sync: SyncStatus;
  presence: { displayName: string; role: string }[];
  filter: string;
  setFilter: (s: string) => void;
  onNewCall?: () => void;
  onAudit?: () => void;
  onResetSample?: () => void;
  onPassword: () => void;
  onSignOut: () => void;
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function TopBar(p: Props) {
  const now = useNow();
  const [menu, setMenu] = useState(false);
  const queued = p.calls.filter((c) => c.status === 'QUEUED');
  const asap = queued.filter((c) => c.pickupMode === 'ASAP');
  const oldestAsap = asap.reduce((m, c) => Math.max(m, minutesSince(c.createdAt, now)), 0);
  const willCall = queued.filter((c) => c.pickupMode === 'WILL_CALL');
  const late = p.calls.filter((c) => c.status === 'ASSIGNED' && c.scheduledStart && Date.parse(c.scheduledStart) < now - 5 * 60_000);
  const active = p.calls.filter((c) => ACTIVE_STATUSES.includes(c.status));
  const inService = p.crews.filter((c) => !c.outOfService).length;

  const syncLabel = { live: 'Live', polling: 'Polling', connecting: 'Connecting' }[p.sync];

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">✚</span> ReactSolutions <b>Dispatch</b>
      </div>

      <div className="daynav">
        <button className="btn ghost" onClick={() => p.setDay(addDays(p.day, -1))} aria-label="Previous day">
          ‹
        </button>
        <button className="btn ghost today" onClick={() => p.setDay(startOfDay(new Date()))} disabled={sameDay(p.day, new Date())}>
          Today
        </button>
        <button className="btn ghost" onClick={() => p.setDay(addDays(p.day, 1))} aria-label="Next day">
          ›
        </button>
        <span className="dayname">{p.day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>

      <div className="metrics">
        <Metric label="Queued" value={queued.length} />
        <Metric label="ASAP waiting" value={asap.length} tone={asap.length ? 'red' : undefined} sub={asap.length ? `oldest ${fmtWait(oldestAsap)}` : undefined} />
        <Metric label="Will-call" value={willCall.length} />
        <Metric label="Late" value={late.length} tone={late.length ? 'amber' : undefined} />
        <Metric label="Active" value={active.length} />
        <Metric label="Units in service" value={`${inService}/${p.crews.length}`} />
      </div>

      <input className="search" placeholder="Filter: call #, patient, place, status" value={p.filter} onChange={(e) => p.setFilter(e.target.value)} />

      {p.onNewCall && (
        <button className="btn primary" onClick={p.onNewCall}>
          + New call
        </button>
      )}

      <div className={`sync ${p.sync}`} title={p.sync === 'polling' ? 'Live connection unavailable; checking for updates every few seconds' : 'Receiving live updates'}>
        <span className="dot" /> {syncLabel}
      </div>

      <div className="presence" title={p.presence.map((u) => u.displayName).join(', ')}>
        {p.presence.slice(0, 5).map((u) => (
          <span key={u.displayName} className="avatar">
            {u.displayName
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)}
          </span>
        ))}
        {p.presence.length > 0 && <span className="muted small">{p.presence.length} online</span>}
      </div>

      <div className="usermenu">
        <button className="btn ghost" onClick={() => setMenu((m) => !m)}>
          {p.user.displayName} <span className="role">{p.user.role}</span> ▾
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            {p.onAudit && <button onClick={() => (setMenu(false), p.onAudit!())}>Audit log</button>}
            {p.onResetSample && <button onClick={() => (setMenu(false), p.onResetSample!())}>Reset sample data</button>}
            <button onClick={() => (setMenu(false), p.onPassword())}>Change password</button>
            <button onClick={p.onSignOut}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'red' | 'amber' }) {
  return (
    <div className={`metric ${tone || ''}`}>
      <div className="mv">{value}</div>
      <div className="ml">{label}</div>
      {sub && <div className="ms">{sub}</div>}
    </div>
  );
}
