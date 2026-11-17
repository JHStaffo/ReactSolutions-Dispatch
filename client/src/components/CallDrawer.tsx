import { useEffect, useState } from 'react';
import type { Call, CallStatus, CallSummary, Crew, Role } from '../../../shared/types';
import { ALS_EQUIPMENT, BARIATRIC_LBS, EQUIPMENT, STATUSES, STATUS_FLOW, TRIP_TYPES, ageFromDob } from '../../../shared/types';
import { ApiError, api } from '../api';
import { fmtDateTime, fmtTime } from '../time';
import type { ConfirmState } from './Modals';
import type { Toast } from './Toasts';

interface Props {
  summary: CallSummary;
  crews: Crew[];
  role: Role;
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: (c: CallSummary) => void;
  onConflict: (e: unknown) => boolean;
  onEdit: (c: Call) => void;
  onConfirm: (s: ConfirmState) => void;
  toast: (t: string, k?: Toast['kind']) => void;
}

export function CallDrawer(p: Props) {
  const [call, setCall] = useState<Call | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = p.role !== 'viewer';
  const s = p.summary;

  // Load the full (PHI) record only while the drawer is open; it is discarded on close.
  // Re-fetch when someone else changes the call so the details never go stale.
  useEffect(() => {
    if (!canEdit) return;
    if (call && call.version >= s.version) return;
    api<{ call: Call }>(`calls/${s.id}`)
      .then((r) => setCall(r.call))
      .catch((e) => setError(e.message));
  }, [s.id, s.version, canEdit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.onClose]);

  const run = async (fn: () => Promise<{ call: CallSummary | Call }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if ('patient' in r.call) {
        setCall(r.call as Call);
      }
      p.onChanged('patient' in r.call ? summaryOf(r.call as Call, s) : (r.call as CallSummary));
    } catch (e) {
      if (!p.onConflict(e)) p.toast(e instanceof ApiError ? e.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: CallStatus, reason = '') =>
    run(() => api(`calls/${s.id}/status`, { body: { status, expectedVersion: s.version, reason } }));

  const crew = p.crews.find((c) => c.id === s.crewId);
  const idx = STATUS_FLOW.indexOf(s.status);
  const next = idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
  const closed = s.status === 'COMPLETED' || s.status === 'CANCELLED';

  return (
    <aside className="drawer" role="dialog" aria-label={`Call ${s.callNumber}`}>
      <div className="drawer-head">
        <div>
          <div className="dh-title">
            <span className={`lvl ${s.level.toLowerCase()}`}>{s.level}</span> {s.callNumber}
            <span className={`status-pill st-${s.status.toLowerCase()}`}>{STATUSES[s.status]}</span>
          </div>
          <div className="muted small">
            {TRIP_TYPES[s.tripType]}
            {s.leg !== 'ONE_WAY' && ` · ${s.leg === 'OUTBOUND' ? 'outbound leg' : 'return leg'}`}
            {s.seriesId && ' · recurring'}
          </div>
        </div>
        <button className="btn ghost" onClick={p.onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="drawer-body">
        {error && <div className="banner error">{error}</div>}
        {!canEdit && <div className="banner">Read-only access: patient details are hidden.</div>}

        {canEdit && !closed && (
          <div className="actions">
            {s.pickupMode === 'WILL_CALL' && s.status === 'QUEUED' && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => run(() => api(`calls/${s.id}`, { method: 'PATCH', body: { pickupMode: 'ASAP', expectedVersion: s.version } }))}
              >
                Patient ready → ASAP
              </button>
            )}
            {next && (
              <button className="btn primary" disabled={busy} onClick={() => setStatus(next)}>
                Mark {STATUSES[next]}
              </button>
            )}
            {s.status === 'ASSIGNED' && (
              <button className="btn" disabled={busy} onClick={() => run(() => api(`calls/${s.id}/unassign`, { body: { expectedVersion: s.version } }))}>
                Return to queue
              </button>
            )}
            {call && (
              <button className="btn" disabled={busy} onClick={() => p.onEdit(call)}>
                Edit
              </button>
            )}
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                p.onConfirm({
                  title: `Cancel ${s.callNumber}?`,
                  body: s.linkedCallId ? 'This trip has a linked leg. Cancel it separately if it is no longer needed.' : undefined,
                  input: { label: 'Cancellation reason', placeholder: 'e.g. Patient refused, facility cancelled', required: true },
                  confirmLabel: 'Cancel trip',
                  danger: true,
                  onConfirm: (reason) => setStatus('CANCELLED', reason || ''),
                })
              }
            >
              Cancel trip
            </button>
          </div>
        )}
        {canEdit && closed && p.role === 'supervisor' && (
          <div className="actions">
            <button className="btn" disabled={busy || !s.crewId} onClick={() => setStatus('ASSIGNED')}>
              Reopen (supervisor)
            </button>
          </div>
        )}

        <Section title="Assignment">
          <Row k="Crew" v={crew ? `${crew.unit} (${crew.level}) · ${crew.vehicle}` : 'Unassigned'} />
          {crew && <Row k="Crew phone" v={<a href={`tel:${crew.phone.replace(/[^\d+]/g, '')}`}>{crew.phone}</a>} />}
          <Row k="Scheduled" v={s.scheduledStart ? `${fmtDateTime(s.scheduledStart)} · ${s.durationMin} min` : '—'} />
          {crew && s.level === 'ALS' && crew.level === 'BLS' && <div className="banner error">ALS call assigned to a BLS unit.</div>}
          {s.linkedCallId && (
            <Row
              k={s.leg === 'OUTBOUND' ? 'Return leg' : 'Outbound leg'}
              v={
                <button className="link" onClick={() => p.onOpen(s.linkedCallId!)}>
                  Open linked trip
                </button>
              }
            />
          )}
        </Section>

        {call ? (
          <>
            <Section title="Patient">
              <Row k="Name" v={`${call.patient.lastName}, ${call.patient.firstName}`} />
              <Row k="DOB" v={`${call.patient.dob} (${ageFromDob(call.patient.dob)}y)`} />
              <Row k="Weight" v={`${call.patient.weightLbs} lb (${Math.round(call.patient.weightLbs / 2.2046)} kg)${call.patient.weightLbs >= BARIATRIC_LBS ? ' · BARIATRIC' : ''}`} />
            </Section>
            <Section title="Insurance & necessity">
              <Row k="Payer" v={call.insurance.payer} />
              <Row k="Member ID" v={call.insurance.memberId || '—'} />
              <Row k="Prior auth #" v={call.insurance.priorAuth || '—'} />
              <Row k="PCS on file" v={call.pcsOnFile ? 'Yes' : <span className="warn-text">No: obtain before transport</span>} />
            </Section>
            <Section title="Trip">
              <Row
                k="Pickup"
                v={call.pickupMode === 'SCHEDULED' ? fmtDateTime(call.pickupTime) : call.pickupMode === 'ASAP' ? 'ASAP' : 'Will-call'}
              />
              <Row k="From" v={call.pickupLocation} />
              <Row k="To" v={call.destination} />
            </Section>
            <Section title="Clinical">
              <Row k="Chief complaint" v={call.chiefComplaint} />
              <Row k="Reason for stretcher" v={call.stretcherReason} />
              <Row
                k="Equipment"
                v={
                  call.equipment.length
                    ? call.equipment.map((e) => (
                        <span key={e} className={`chip ${ALS_EQUIPMENT.includes(e) ? 'als' : ''}`}>
                          {EQUIPMENT[e]}
                        </span>
                      ))
                    : 'None'
                }
              />
              {call.notes && <Row k="Notes" v={call.notes} />}
              {call.cancelReason && <Row k="Cancel reason" v={call.cancelReason} />}
            </Section>
            <Section title="Status times">
              <div className="timeline">
                {(Object.keys(STATUSES) as CallStatus[])
                  .filter((k) => call.statusTimes[k])
                  .map((k) => (
                    <div key={k}>
                      <span>{STATUSES[k]}</span>
                      <span>{fmtTime(call.statusTimes[k])}</span>
                    </div>
                  ))}
              </div>
            </Section>
            <Section title="Activity">
              <ul className="history">
                {[...call.history].reverse().map((h, i) => (
                  <li key={i}>
                    <span className="muted">{fmtDateTime(h.ts)}</span> <b>{h.actor}</b> {h.action}
                    {h.detail && <span className="muted"> · {h.detail.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, (m) => fmtDateTime(m))}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          </>
        ) : (
          canEdit && !error && <div className="muted">Loading details…</div>
        )}
        {!canEdit && (
          <Section title="Trip">
            <Row k="Patient" v={s.patientDisplay} />
            <Row k="From" v={s.pickupLocation} />
            <Row k="To" v={s.destination} />
          </Section>
        )}
      </div>
    </aside>
  );
}

function summaryOf(c: Call, prev: CallSummary): CallSummary {
  return {
    ...prev,
    version: c.version,
    status: c.status,
    statusTimes: c.statusTimes,
    level: c.level,
    tripType: c.tripType,
    patientDisplay: `${c.patient.lastName}, ${c.patient.firstName.charAt(0)}.`,
    age: ageFromDob(c.patient.dob),
    weightLbs: c.patient.weightLbs,
    equipment: c.equipment,
    pcsOnFile: c.pcsOnFile,
    pickupMode: c.pickupMode,
    pickupTime: c.pickupTime,
    pickupLocation: c.pickupLocation,
    destination: c.destination,
    durationMin: c.durationMin,
    crewId: c.crewId,
    scheduledStart: c.scheduledStart,
    updatedAt: c.updatedAt,
    updatedBy: c.updatedBy,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="dsec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="drow">
      <div className="dk">{k}</div>
      <div className="dv">{v}</div>
    </div>
  );
}
