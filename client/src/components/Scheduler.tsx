import { useEffect, useMemo, useRef, useState } from 'react';
import type { CallSummary, Crew } from '../../../shared/types';
import { ACTIVE_STATUSES, STATUSES, TRIP_TYPES } from '../../../shared/types';
import { SLOT_MIN, SLOT_PX, SLOTS, fmtTime, sameDay, startOfDay } from '../time';
import { DRAG_TYPE, dragState } from './CallCard';

interface Props {
  day: Date;
  crews: Crew[];
  calls: CallSummary[];
  canEdit: boolean;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onAssign: (callId: string, crewId: string, start: Date) => void;
  onToggleCrew: (crew: Crew, reason: string) => void;
}

const DAY_PX = SLOTS * SLOT_PX;
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Off-shift ranges in minutes-of-day, for shading. */
function offShift(crew: Crew): [number, number][] {
  const s = hhmm(crew.shiftStart);
  const e = hhmm(crew.shiftEnd);
  if (e > s) return [[0, s], [e, 1440]].filter(([a, b]) => b > a) as [number, number][];
  return [[e, s]];
}

/** Put overlapping trips side by side. */
function layout(calls: CallSummary[]) {
  const sorted = [...calls].sort((a, b) => a.scheduledStart!.localeCompare(b.scheduledStart!));
  const lanes: number[] = []; // end time per lane
  const out: { c: CallSummary; lane: number; lanes: number }[] = [];
  let group: typeof out = [];
  let groupEnd = 0;
  for (const c of sorted) {
    const s = Date.parse(c.scheduledStart!);
    const e = s + c.durationMin * 60_000;
    if (s >= groupEnd && group.length) {
      group.forEach((g) => (g.lanes = lanes.length));
      group = [];
      lanes.length = 0;
    }
    let lane = lanes.findIndex((end) => end <= s);
    if (lane === -1) lane = lanes.push(e) - 1;
    else lanes[lane] = e;
    const item = { c, lane, lanes: 1 };
    group.push(item);
    out.push(item);
    groupEnd = Math.max(groupEnd, e);
  }
  group.forEach((g) => (g.lanes = lanes.length));
  return out;
}

export function Scheduler(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ crewId: string; slot: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const dayStart = startOfDay(p.day).getTime();
  const isToday = sameDay(p.day, new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Scroll to the current time (today) or 06:00.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mins = isToday ? Math.max(0, (Date.now() - dayStart) / 60000 - 90) : 6 * 60;
    el.scrollTop = (mins / SLOT_MIN) * SLOT_PX;
  }, [dayStart, isToday]);

  const byCrew = useMemo(() => {
    const m: Record<string, CallSummary[]> = {};
    for (const c of p.calls) {
      if (!c.crewId || !c.scheduledStart || c.status === 'CANCELLED') continue;
      const t = Date.parse(c.scheduledStart);
      if (t < dayStart || t >= dayStart + 86_400_000) continue;
      (m[c.crewId] ||= []).push(c);
    }
    return m;
  }, [p.calls, dayStart]);

  const slotFromEvent = (e: React.DragEvent, el: HTMLElement) => {
    const y = e.clientY - el.getBoundingClientRect().top - dragState.grabOffsetPx;
    return Math.max(0, Math.min(SLOTS - 1, Math.floor(y / SLOT_PX)));
  };

  const nowTop = ((now - dayStart) / 60000 / SLOT_MIN) * SLOT_PX;

  return (
    <section className="sched" ref={scroller}>
      <div className="sched-inner">
        <div className="sched-head">
          <div className="corner">{p.crews.length} units</div>
          {p.crews.map((crew) => (
            <CrewHeader key={crew.id} crew={crew} trips={(byCrew[crew.id] || []).length} canEdit={p.canEdit} onToggle={p.onToggleCrew} />
          ))}
        </div>
        <div className="sched-body" style={{ height: DAY_PX }}>
          <div className="gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour" style={{ top: h * 4 * SLOT_PX }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {p.crews.map((crew) => (
            <div
              key={crew.id}
              className={`col ${crew.outOfService ? 'oos' : ''}`}
              onDragOver={(e) => {
                if (!p.canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const slot = slotFromEvent(e, e.currentTarget);
                if (hover?.crewId !== crew.id || hover.slot !== slot) setHover({ crewId: crew.id, slot });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData(DRAG_TYPE);
                const slot = slotFromEvent(e, e.currentTarget);
                setHover(null);
                if (id) p.onAssign(id, crew.id, new Date(dayStart + slot * SLOT_MIN * 60_000));
              }}
            >
              {offShift(crew).map(([a, b]) => (
                <div key={a} className="offshift" style={{ top: (a / SLOT_MIN) * SLOT_PX, height: ((b - a) / SLOT_MIN) * SLOT_PX }} />
              ))}
              {hover?.crewId === crew.id && (
                <div
                  className="drop-ghost"
                  style={{ top: hover.slot * SLOT_PX, height: Math.max(1, Math.round(dragState.durationMin / SLOT_MIN)) * SLOT_PX }}
                >
                  {fmtTime(new Date(dayStart + hover.slot * SLOT_MIN * 60_000).toISOString())}
                </div>
              )}
              {layout(byCrew[crew.id] || []).map(({ c, lane, lanes }) => (
                <TripBlock
                  key={c.id}
                  c={c}
                  top={((Date.parse(c.scheduledStart!) - dayStart) / 60000 / SLOT_MIN) * SLOT_PX}
                  lane={lane}
                  lanes={lanes}
                  now={now}
                  selected={p.selectedId === c.id}
                  canDrag={p.canEdit && (c.status === 'ASSIGNED')}
                  onOpen={p.onOpen}
                />
              ))}
            </div>
          ))}
          {isToday && <div className="nowline" style={{ top: nowTop }} />}
        </div>
      </div>
    </section>
  );
}

function CrewHeader({ crew, trips, canEdit, onToggle }: { crew: Crew; trips: number; canEdit: boolean; onToggle: (c: Crew, r: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className={`crew-head ${crew.level.toLowerCase()} ${crew.outOfService ? 'oos' : ''}`}>
      <div className="ch-top">
        <span className="unit">{crew.unit}</span>
        <span className={`lvl ${crew.level.toLowerCase()}`}>{crew.level}</span>
      </div>
      <div className="ch-line">
        🚑 {crew.vehicle} · <a href={`tel:${crew.phone.replace(/[^\d+]/g, '')}`}>{crew.phone}</a>
      </div>
      <div className="ch-members">
        {crew.members.map((m) => (
          <div key={m.name}>
            {m.name} <span className="cert">{m.cert === 'Paramedic' ? 'Medic' : m.cert}</span>
          </div>
        ))}
      </div>
      <div className="ch-line muted">
        Shift {crew.shiftStart}–{crew.shiftEnd} · {trips} trip{trips === 1 ? '' : 's'}
      </div>
      {crew.outOfService && <div className="oos-tag">OUT OF SERVICE{crew.oosReason ? `: ${crew.oosReason}` : ''}</div>}
      {canEdit &&
        (editing ? (
          <div className="oos-edit">
            <input autoFocus placeholder="Reason (e.g. fuel, maintenance)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
            <button
              className="btn small danger"
              onClick={() => {
                onToggle(crew, reason);
                setEditing(false);
                setReason('');
              }}
            >
              Set OOS
            </button>
            <button className="btn small ghost" onClick={() => setEditing(false)}>
              ✕
            </button>
          </div>
        ) : (
          <button className="btn small ghost oos-btn" onClick={() => (crew.outOfService ? onToggle(crew, '') : setEditing(true))}>
            {crew.outOfService ? 'Return to service' : 'Mark out of service'}
          </button>
        ))}
    </div>
  );
}

function TripBlock({
  c,
  top,
  lane,
  lanes,
  now,
  selected,
  canDrag,
  onOpen,
}: {
  c: CallSummary;
  top: number;
  lane: number;
  lanes: number;
  now: number;
  selected: boolean;
  canDrag: boolean;
  onOpen: (id: string) => void;
}) {
  const height = Math.max(SLOT_PX, (c.durationMin / SLOT_MIN) * SLOT_PX) - 2;
  const late = c.status === 'ASSIGNED' && Date.parse(c.scheduledStart!) < now - 5 * 60_000;
  const end = new Date(Date.parse(c.scheduledStart!) + c.durationMin * 60_000).toISOString();
  return (
    <div
      className={`trip st-${c.status.toLowerCase()} ${c.level.toLowerCase()} ${selected ? 'selected' : ''} ${late ? 'late' : ''} ${ACTIVE_STATUSES.includes(c.status) ? 'active' : ''}`}
      style={{ top: top + 1, height, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, c.id);
        e.dataTransfer.effectAllowed = 'move';
        Object.assign(dragState, { id: c.id, durationMin: c.durationMin, grabOffsetPx: e.clientY - e.currentTarget.getBoundingClientRect().top });
      }}
      onDragEnd={() => (dragState.grabOffsetPx = 0)}
      onClick={() => onOpen(c.id)}
      title={`${c.callNumber} · ${TRIP_TYPES[c.tripType]} · ${STATUSES[c.status]}`}
    >
      <div className="tb-row">
        <b>{c.callNumber}</b>
        <span className={`lvl ${c.level.toLowerCase()}`}>{c.level}</span>
        <span className="tb-status">{late ? 'LATE' : STATUSES[c.status]}</span>
      </div>
      <div className="tb-row">
        {fmtTime(c.scheduledStart)}–{fmtTime(end)} · {c.patientDisplay}
      </div>
      {height > 60 && (
        <div className="tb-row route">
          {c.pickupLocation} → {c.destination}
        </div>
      )}
      {height > 80 && <div className="tb-row muted">{TRIP_TYPES[c.tripType]}{c.leg === 'RETURN' ? ' · return' : ''}</div>}
    </div>
  );
}
