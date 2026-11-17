import type { CallSummary } from '../../../shared/types';
import { ALS_EQUIPMENT, BARIATRIC_LBS, EQUIPMENT, STATUSES, TRIP_TYPES } from '../../../shared/types';
import { fmtTime, fmtWait, minutesSince } from '../time';

export const DRAG_TYPE = 'application/x-dispatch-call';

/** What is being dragged (dataTransfer can't be read during dragover). */
export const dragState = { id: '', durationMin: 60, grabOffsetPx: 0 };

export function callFlags(c: CallSummary) {
  const f: string[] = [];
  if (c.weightLbs >= BARIATRIC_LBS) f.push('Bariatric');
  if (c.equipment.includes('VENTILATOR')) f.push('Vent');
  if (c.equipment.includes('ISOLATION')) f.push('Isolation');
  if (c.equipment.includes('OXYGEN')) f.push('O₂');
  if (!c.pcsOnFile && c.tripType !== 'SNF_TO_ER') f.push('No PCS');
  if (c.level === 'BLS' && c.equipment.some((e) => ALS_EQUIPMENT.includes(e))) f.push('ALS equip.');
  return f;
}

export function pickupLabel(c: CallSummary) {
  if (c.pickupMode === 'ASAP') return `ASAP · waiting ${fmtWait(minutesSince(c.createdAt))}`;
  if (c.pickupMode === 'WILL_CALL') return 'Will-call (awaiting ready call)';
  return `Pickup ${fmtTime(c.pickupTime)}`;
}

/** Card shown in the unassigned queue. Shows minimum necessary info only. */
export function QueueCard({ c, canEdit, onOpen }: { c: CallSummary; canEdit: boolean; onOpen: (id: string) => void }) {
  return (
    <div
      className={`qcard ${c.level.toLowerCase()} ${c.pickupMode === 'ASAP' ? 'asap' : ''} ${c.pickupMode === 'WILL_CALL' ? 'willcall' : ''}`}
      draggable={canEdit && c.pickupMode !== 'WILL_CALL'}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, c.id);
        e.dataTransfer.effectAllowed = 'move';
        Object.assign(dragState, { id: c.id, durationMin: c.durationMin, grabOffsetPx: 0 });
      }}
      onClick={() => onOpen(c.id)}
      title={c.pickupMode === 'WILL_CALL' ? 'Open the call and mark the patient ready before scheduling' : 'Drag onto a crew to assign'}
    >
      <div className="qrow">
        <span className={`lvl ${c.level.toLowerCase()}`}>{c.level}</span>
        <b>{c.callNumber}</b>
        <span className="ttype">{TRIP_TYPES[c.tripType]}</span>
        {c.leg === 'RETURN' && <span className="tag">Return</span>}
        {c.seriesId && <span className="tag" title="Recurring standing order">↻</span>}
      </div>
      <div className="qrow pt">
        {c.patientDisplay} <span className="muted">· {c.age}y · {c.weightLbs} lb</span>
      </div>
      <div className="qrow route">
        {c.pickupLocation} → {c.destination}
      </div>
      <div className="qrow">
        <span className={`when ${c.pickupMode.toLowerCase()}`}>{pickupLabel(c)}</span>
        <span className="muted">{c.durationMin}m</span>
      </div>
      {(c.equipment.length > 0 || callFlags(c).length > 0) && (
        <div className="qrow chips">
          {callFlags(c).map((f) => (
            <span key={f} className={`chip ${f === 'No PCS' || f === 'ALS equip.' ? 'warn' : ''}`}>
              {f}
            </span>
          ))}
          {c.equipment
            .filter((e) => !['OXYGEN', 'VENTILATOR', 'ISOLATION'].includes(e))
            .map((e) => (
              <span key={e} className="chip dim">
                {EQUIPMENT[e]}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export function statusClass(c: CallSummary) {
  return `st-${c.status.toLowerCase()}`;
}

export { STATUSES };
