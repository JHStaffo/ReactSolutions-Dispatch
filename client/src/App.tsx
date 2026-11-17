import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssignWarning, CallSummary, Crew, Facility, GpsPosition, MapConfig, ServerEvent, SessionUser } from '../../shared/types';
import { STATUSES } from '../../shared/types';
import { raiseAlert } from './alerts';
import { ApiError, api, setUnauthorizedHandler } from './api';
import { FacilitiesModal, RosterModal, UsersModal } from './components/AdminModals';
import { AuditModal } from './components/AuditModal';
import { CallDrawer } from './components/CallDrawer';
import { CrewApp } from './components/CrewApp';
import { IdleGuard } from './components/IdleGuard';
import { IntakeModal, type IntakeInit } from './components/IntakeModal';
import { Login } from './components/Login';
import { MapView } from './components/MapView';
import { ConfirmModal, PasswordModal, type ConfirmState } from './components/Modals';
import { PatientsView } from './components/PatientsView';
import { QueuePanel } from './components/QueuePanel';
import { ReportsView } from './components/ReportsView';
import { RunSheet } from './components/RunSheet';
import { Scheduler } from './components/Scheduler';
import { Toasts, type Toast } from './components/Toasts';
import { TopBar, type View } from './components/TopBar';
import { useLiveSync } from './liveSync';
import { addDays, startOfDay } from './time';

interface Session {
  user: SessionUser;
  idleTimeoutMs: number;
}

export interface Board {
  bootId: string;
  seq: number;
  crews: Crew[];
  facilities: Facility[];
  calls: Record<string, CallSummary>;
  gps: Record<string, GpsPosition>;
  gpsStaleMinutes: number;
  map: MapConfig;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  const [signedOutReason, setSignedOutReason] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;
  const [view, setView] = useState<View>('board');
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [intake, setIntake] = useState<IntakeInit | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [modal, setModal] = useState<'audit' | 'password' | 'users' | 'roster' | 'facilities' | null>(null);
  const [runSheet, setRunSheet] = useState<Crew | null>(null);
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
    setPatientId(null);
    setIntake(null);
    setConfirm(null);
    setModal(null);
    setRunSheet(null);
    setView('board');
  }, []);

  const sessionRef = useRef(session);
  sessionRef.current = session;

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

  const isCrew = session?.user.role === 'crew';

  const loadBoard = useCallback(async () => {
    const from = startOfDay(day);
    const to = addDays(from, 1);
    const r = await api<Omit<Board, 'calls' | 'gps'> & { calls: CallSummary[]; gps: GpsPosition[] }>('board', {
      body: { from: from.toISOString(), to: to.toISOString() },
    });
    const calls: Record<string, CallSummary> = {};
    for (const c of r.calls) calls[c.id] = c;
    const gps: Record<string, GpsPosition> = {};
    for (const p of r.gps) gps[p.deviceId] = p;
    setBoard((prev) => ({ ...r, calls: prev && prev.bootId === r.bootId ? { ...keepOtherDays(prev.calls, from), ...calls } : calls, gps }));
  }, [day]);

  useEffect(() => {
    if (session && !isCrew) loadBoard().catch((e) => toast(e.message, 'error'));
  }, [session, isCrew, loadBoard, toast]);

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
        let { calls, crews, facilities } = prev;
        for (const e of events) {
          if (e.seq <= prev.seq) continue;
          if (e.type === 'call') {
            const cur = calls[e.call.id];
            if (!cur || cur.version <= e.call.version) calls = { ...calls, [e.call.id]: e.call };
          }
          if (e.type === 'crew') crews = crews.some((c) => c.id === e.crew.id) ? crews.map((c) => (c.id === e.crew.id ? e.crew : c)) : [...crews, e.crew];
          if (e.type === 'facilities') facilities = e.facilities;
        }
        return { ...prev, calls, crews, facilities, seq: Math.max(prev.seq, seq) };
      });
      for (const e of events) {
        if (e.seq <= b.seq) continue;
        if (e.type === 'call' && e.actor !== me && e.action !== 'paperwork updated') toast(`${e.actor}: ${e.call.callNumber} ${e.action.toLowerCase()}`);
        if (e.type === 'call' && e.action === 'created' && e.call.pickupMode === 'ASAP')
          raiseAlert('asap', `New ASAP call ${e.call.callNumber} (${e.call.level})`);
        if (e.type === 'crew' && e.actor !== me) toast(`${e.actor}: ${e.crew.unit} ${e.action}`);
        if (e.type === 'reset') toast(`${e.actor} reset the sample data`, 'warn');
      }
      if (events.some((e) => e.type === 'reset' && e.seq > b.seq)) loadBoard();
    },
    [toast, loadBoard],
  );

  const onGps = useCallback((positions: GpsPosition[]) => {
    setBoard((b) => {
      if (!b) return b;
      const gps = { ...b.gps };
      for (const p of positions) gps[p.deviceId] = p;
      return { ...b, gps };
    });
  }, []);

  const sync = useLiveSync({
    enabled: !!session && !isCrew && !!board,
    cursor: () => (boardRef.current ? { bootId: boardRef.current.bootId, seq: boardRef.current.seq } : null),
    onEvents: applyEvents,
    onReset: () => loadBoard().catch(() => {}),
    onSessionEnded: () => signOut('expired'),
    onGps,
  });

  // Late-trip alert: once per trip when it becomes 5+ minutes late.
  const lateSeen = useRef(new Set<string>());
  useEffect(() => {
    if (!board) return;
    const check = () => {
      const now = Date.now();
      for (const c of Object.values(boardRef.current?.calls || {})) {
        if (c.status === 'ASSIGNED' && c.scheduledStart && Date.parse(c.scheduledStart) < now - 5 * 60_000 && Date.parse(c.scheduledStart) > now - 6 * 3600_000) {
          if (!lateSeen.current.has(c.id)) {
            lateSeen.current.add(c.id);
            if (lateSeen.current.size > 1 || Date.parse(c.scheduledStart) > now - 15 * 60_000) raiseAlert('late', `${c.callNumber} is late`);
          }
        }
      }
    };
    const t = window.setInterval(check, 30_000);
    return () => window.clearInterval(t);
  }, [!!board]);

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

  const setCrew = useCallback((crew: Crew) => {
    setBoard((b) => (b ? { ...b, crews: b.crews.some((c) => c.id === crew.id) ? b.crews.map((c) => (c.id === crew.id ? crew : c)) : [...b.crews, crew] } : b));
  }, []);

  const toggleCrew = useCallback(
    async (crew: Crew, reason: string) => {
      try {
        const r = await api<{ crew: Crew }>(`crews/${crew.id}`, {
          method: 'PATCH',
          body: { expectedVersion: crew.version, outOfService: !crew.outOfService, oosReason: reason },
        });
        setCrew(r.crew);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setCrew(e.body.crew);
          toast(e.body.message, 'warn');
        } else toast(e instanceof Error ? e.message : 'Failed', 'error');
      }
    },
    [toast, setCrew],
  );

  const resetSample = useCallback(() => {
    setConfirm({
      title: 'Reset sample data?',
      body: 'This replaces every call, patient and crew with fresh sample data for today, for all dispatchers.',
      confirmLabel: 'Reset',
      danger: true,
      onConfirm: async () => {
        await api('admin/reset-sample', { body: {} });
        await loadBoard();
      },
    });
  }, [loadBoard]);

  const openCall = useCallback(
    (c: CallSummary) => {
      upsert(c);
      setSelectedId(c.id);
    },
    [upsert],
  );

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

  if (isCrew)
    return (
      <>
        <IdleGuard timeoutMs={session.idleTimeoutMs} onTimeout={() => signOut('timeout')} />
        <CrewApp user={session.user} onSignOut={() => signOut('user')} onExpired={() => signOut('expired')} />
      </>
    );

  const role = session.user.role;
  const canEdit = role !== 'viewer';
  const today = view === 'board' && board;

  return (
    <div className="app">
      <IdleGuard timeoutMs={session.idleTimeoutMs} onTimeout={() => signOut('timeout')} />
      <TopBar
        user={session.user}
        view={view}
        setView={setView}
        day={day}
        setDay={setDay}
        calls={calls}
        crews={(board?.crews || []).filter((c) => c.active)}
        sync={sync.status}
        presence={sync.presence}
        filter={filter}
        setFilter={setFilter}
        onNewCall={canEdit ? () => setIntake({ mode: 'new' }) : undefined}
        onMenu={(m) => (m === 'reset' ? resetSample() : setModal(m))}
        onSignOut={() => signOut('user')}
      />
      {!board ? (
        <div className="loading">Loading board…</div>
      ) : view === 'map' ? (
        <MapView board={board} onOpenCall={setSelectedId} />
      ) : view === 'patients' && canEdit ? (
        <PatientsView
          onOpenCall={openCall}
          onNewTrip={(patient) => setIntake({ mode: 'new', patient })}
          openId={patientId}
          setOpenId={setPatientId}
          toast={toast}
        />
      ) : view === 'reports' && canEdit ? (
        <ReportsView role={role} crews={board.crews} toast={toast} />
      ) : (
        today && (
          <div className="main">
            <QueuePanel
              calls={filtered.filter(
                (c) => c.status === 'QUEUED' && (c.pickupMode !== 'SCHEDULED' || !c.pickupTime || Date.parse(c.pickupTime) < addDays(day, 1).getTime()),
              )} canEdit={canEdit} onOpen={setSelectedId} onDropCall={unassign} />
            <Scheduler
              day={day}
              crews={board.crews.filter((c) => c.active)}
              calls={filtered}
              gps={board.gps}
              staleMinutes={board.gpsStaleMinutes}
              canEdit={canEdit}
              selectedId={selectedId}
              onOpen={setSelectedId}
              onAssign={assign}
              onToggleCrew={toggleCrew}
              onPrint={canEdit ? setRunSheet : undefined}
            />
          </div>
        )
      )}
      {selectedId && board?.calls[selectedId] && (
        <CallDrawer
          key={selectedId}
          summary={board.calls[selectedId]}
          board={board}
          role={role}
          onClose={() => setSelectedId(null)}
          onOpen={setSelectedId}
          onOpenPatient={(id) => {
            setPatientId(id);
            setView('patients');
            setSelectedId(null);
          }}
          onChanged={upsert}
          onConflict={handleConflict}
          onEdit={(call) => setIntake({ mode: 'edit', call })}
          onAssign={assign}
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
      {runSheet && board && <RunSheet crew={runSheet} day={day} onClose={() => setRunSheet(null)} />}
      {confirm && <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />}
      {modal === 'audit' && <AuditModal onClose={() => setModal(null)} />}
      {modal === 'password' && <PasswordModal onClose={() => setModal(null)} toast={toast} />}
      {modal === 'users' && board && <UsersModal crews={board.crews} me={session.user.username} onClose={() => setModal(null)} toast={toast} />}
      {modal === 'roster' && board && <RosterModal crews={board.crews} onSaved={setCrew} onClose={() => setModal(null)} toast={toast} />}
      {modal === 'facilities' && board && (
        <FacilitiesModal
          facilities={board.facilities}
          map={board.map}
          onSaved={(facilities) => setBoard((b) => (b ? { ...b, facilities } : b))}
          onClose={() => setModal(null)}
          toast={toast}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

/** Keep calls from other days that were opened from patient history, so their drawers still work. */
function keepOtherDays(calls: Record<string, CallSummary>, from: Date) {
  const a = from.getTime();
  const b = a + 86_400_000;
  const out: Record<string, CallSummary> = {};
  for (const c of Object.values(calls)) {
    const t = Date.parse(c.scheduledStart || c.pickupTime || c.createdAt);
    if (c.status !== 'QUEUED' && (t < a || t >= b)) out[c.id] = c;
  }
  return out;
}
