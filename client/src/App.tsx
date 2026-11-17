import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssignWarning, CallSummary, Crew, Facility, ServerEvent, SessionUser } from '../../shared/types';
import { STATUSES } from '../../shared/types';
import { ApiError, api, setUnauthorizedHandler } from './api';
import { AuditModal } from './components/AuditModal';
import { CallDrawer } from './components/CallDrawer';
import { IdleGuard } from './components/IdleGuard';
import { IntakeModal, type IntakeInit } from './components/IntakeModal';
import { Login } from './components/Login';
import { ConfirmModal, PasswordModal, type ConfirmState } from './components/Modals';
import { QueuePanel } from './components/QueuePanel';
import { Scheduler } from './components/Scheduler';
import { Toasts, type Toast } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { useLiveSync } from './liveSync';
import { addDays, startOfDay } from './time';

interface Session {
  user: SessionUser;
  idleTimeoutMs: number;
}

interface Board {
  bootId: string;
  seq: number;
  crews: Crew[];
  facilities: Facility[];
  calls: Record<string, CallSummary>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  const [signedOutReason, setSignedOutReason] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intake, setIntake] = useState<IntakeInit | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [filter, setFilter] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-4), { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 5000);
  }, []);

  /** Drop every piece of patient data from memory. */
  const clearAll = useCallback(() => {
    setBoard(null);
    setSelectedId(null);
    setIntake(null);
    setConfirm(null);
    setShowAudit(false);
  }, []);

  const signOut = useCallback(
    async (reason: 'user' | 'timeout' | 'expired') => {
      if (reason !== 'expired') {
        try {
          await api('auth/logout', { body: { reason } });
        } catch {
          /* ignore */
        }
      }
      clearAll();
      setSession(null);
      setSignedOutReason(
        reason === 'timeout' ? 'You were signed out after a period of inactivity.' : reason === 'expired' ? 'Your session ended. Please sign in again.' : '',
      );
    },
    [clearAll],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (sessionRef.current) signOut('expired');
    });
    api<Session>('auth/me')
      .then((s) => s.user && setSession(s))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const loadBoard = useCallback(async () => {
    const from = startOfDay(day);
    const to = addDays(from, 1);
    const r = await api<{ bootId: string; seq: number; crews: Crew[]; facilities: Facility[]; calls: CallSummary[] }>('board', {
      body: { from: from.toISOString(), to: to.toISOString() },
    });
    const calls: Record<string, CallSummary> = {};
    for (const c of r.calls) calls[c.id] = c;
    setBoard({ bootId: r.bootId, seq: r.seq, crews: r.crews, facilities: r.facilities, calls });
  }, [day]);

  useEffect(() => {
    if (session) loadBoard().catch((e) => toast(e.message, 'error'));
  }, [session, loadBoard, toast]);

  const upsert = useCallback((c: CallSummary) => {
    setBoard((b) => {
      if (!b) return b;
      const cur = b.calls[c.id];
      if (cur && cur.version > c.version) return b;
      return { ...b, calls: { ...b.calls, [c.id]: c } };
    });
  }, []);

  const applyEvents = useCallback(
    (events: ServerEvent[], seq: number) => {
      const me = sessionRef.current?.user.displayName;
      const b = boardRef.current;
      if (!b) return;
      setBoard((prev) => {
        if (!prev) return prev;
        let calls = prev.calls;
        let crews = prev.crews;
        for (const e of events) {
          if (e.seq <= prev.seq) continue;
          if (e.type === 'call') {
            const cur = calls[e.call.id];
            if (!cur || cur.version <= e.call.version) calls = { ...calls, [e.call.id]: e.call };
          }
          if (e.type === 'crew') crews = crews.map((c) => (c.id === e.crew.id ? e.crew : c));
        }
        return { ...prev, calls, crews, seq: Math.max(prev.seq, seq) };
      });
      for (const e of events) {
        if (e.seq <= b.seq) continue;
        if (e.type === 'call' && e.actor !== me) toast(`${e.actor}: ${e.call.callNumber} ${e.action.toLowerCase()}`);
        if (e.type === 'crew' && e.actor !== me) toast(`${e.actor}: ${e.crew.unit} ${e.action}`);
        if (e.type === 'reset') toast(`${e.actor} reset the sample data`, 'warn');
      }
      if (events.some((e) => e.type === 'reset' && e.seq > b.seq)) loadBoard();
    },
    [toast, loadBoard],
  );

  const sync = useLiveSync({
    enabled: !!session && !!board,
    cursor: () => (boardRef.current ? { bootId: boardRef.current.bootId, seq: boardRef.current.seq } : null),
    onEvents: applyEvents,
    onReset: () => loadBoard().catch(() => {}),
    onSessionEnded: () => signOut('expired'),
  });

  // ---------- Commands ----------

  const handleConflict = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 409) {
        if (e.body?.call) upsert(e.body.call);
        toast(e.body?.message || 'Someone else changed this call first.', 'warn');
        return true;
      }
      return false;
    },
    [upsert, toast],
  );

  const assign = useCallback(
    async (callId: string, crewId: string, start: Date, acknowledge: string[] = []) => {
      const call = boardRef.current?.calls[callId];
      if (!call) return;
      try {
        const r = await api<{ call: CallSummary }>(`calls/${callId}/assign`, {
          body: { crewId, start: start.toISOString(), expectedVersion: call.version, acknowledge },
        });
        upsert(r.call);
      } catch (e) {
        if (handleConflict(e)) return;
        if (e instanceof ApiError && e.status === 422) {
          const warnings: AssignWarning[] = e.body.warnings;
          setConfirm({
            title: 'Check this assignment',
            warnings,
            confirmLabel: 'Assign anyway',
            danger: warnings.some((w) => w.code === 'ALS_TO_BLS'),
            onConfirm: () => assign(callId, crewId, start, [...acknowledge, ...warnings.map((w) => w.code)]),
          });
          return;
        }
        toast(e instanceof Error ? e.message : 'Assignment failed', 'error');
      }
    },
    [upsert, handleConflict, toast],
  );

  const unassign = useCallback(
    async (callId: string) => {
      const call = boardRef.current?.calls[callId];
      if (!call || call.status === 'QUEUED') return;
      try {
        const r = await api<{ call: CallSummary }>(`calls/${callId}/unassign`, { body: { expectedVersion: call.version } });
        upsert(r.call);
      } catch (e) {
        if (!handleConflict(e)) toast(e instanceof Error ? e.message : 'Failed', 'error');
      }
    },
    [upsert, handleConflict, toast],
  );

  const toggleCrew = useCallback(
    async (crew: Crew, reason: string) => {
      try {
        const r = await api<{ crew: Crew }>(`crews/${crew.id}`, {
          method: 'PATCH',
          body: { expectedVersion: crew.version, outOfService: !crew.outOfService, oosReason: reason },
        });
        setBoard((b) => (b ? { ...b, crews: b.crews.map((c) => (c.id === crew.id ? r.crew : c)) } : b));
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setBoard((b) => (b ? { ...b, crews: b.crews.map((c) => (c.id === crew.id ? e.body.crew : c)) } : b));
          toast(e.body.message, 'warn');
        } else toast(e instanceof Error ? e.message : 'Failed', 'error');
      }
    },
    [toast],
  );

  const resetSample = useCallback(() => {
    setConfirm({
      title: 'Reset sample data?',
      body: 'This replaces every call and crew with fresh sample data for today, for all dispatchers.',
      confirmLabel: 'Reset',
      danger: true,
      onConfirm: async () => {
        await api('admin/reset-sample', { body: {} });
        await loadBoard();
      },
    });
  }, [loadBoard]);

  const calls = useMemo(() => Object.values(board?.calls || {}), [board]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return calls;
    return calls.filter(
      (c) =>
        c.callNumber.toLowerCase().includes(q) ||
        c.patientDisplay.toLowerCase().includes(q) ||
        c.pickupLocation.toLowerCase().includes(q) ||
        c.destination.toLowerCase().includes(q) ||
        STATUSES[c.status].toLowerCase().includes(q),
    );
  }, [calls, filter]);

  if (!checked) return null;
  if (!session)
    return (
      <Login
        notice={signedOutReason}
        onLogin={(s) => {
          setSignedOutReason('');
          setSession(s);
        }}
      />
    );

  const canEdit = session.user.role !== 'viewer';

  return (
    <div className="app">
      <IdleGuard timeoutMs={session.idleTimeoutMs} onTimeout={() => signOut('timeout')} />
      <TopBar
        user={session.user}
        day={day}
        setDay={setDay}
        calls={calls}
        crews={board?.crews || []}
        sync={sync.status}
        presence={sync.presence}
        filter={filter}
        setFilter={setFilter}
        onNewCall={canEdit ? () => setIntake({ mode: 'new' }) : undefined}
        onAudit={session.user.role === 'supervisor' ? () => setShowAudit(true) : undefined}
        onResetSample={session.user.role === 'supervisor' ? resetSample : undefined}
        onPassword={() => setShowPassword(true)}
        onSignOut={() => signOut('user')}
      />
      {board ? (
        <div className="main">
          <QueuePanel
            calls={filtered.filter((c) => c.status === 'QUEUED')}
            canEdit={canEdit}
            onOpen={setSelectedId}
            onDropCall={unassign}
          />
          <Scheduler
            day={day}
            crews={board.crews}
            calls={filtered}
            canEdit={canEdit}
            selectedId={selectedId}
            onOpen={setSelectedId}
            onAssign={assign}
            onToggleCrew={toggleCrew}
          />
        </div>
      ) : (
        <div className="loading">Loading board…</div>
      )}
      {selectedId && board?.calls[selectedId] && (
        <CallDrawer
          key={selectedId}
          summary={board.calls[selectedId]}
          crews={board.crews}
          role={session.user.role}
          onClose={() => setSelectedId(null)}
          onOpen={setSelectedId}
          onChanged={upsert}
          onConflict={handleConflict}
          onEdit={(call) => setIntake({ mode: 'edit', call })}
          onConfirm={setConfirm}
          toast={toast}
        />
      )}
      {intake && board && (
        <IntakeModal
          init={intake}
          facilities={board.facilities}
          onClose={() => setIntake(null)}
          onSaved={(saved, msg) => {
            saved.forEach(upsert);
            setIntake(null);
            toast(msg, 'success');
          }}
          onConflict={handleConflict}
        />
      )}
      {confirm && <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />}
      {showAudit && <AuditModal onClose={() => setShowAudit(false)} />}
      {showPassword && <PasswordModal onClose={() => setShowPassword(false)} toast={toast} />}
      <Toasts toasts={toasts} />
    </div>
  );
}
