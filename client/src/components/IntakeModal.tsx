import { useEffect, useMemo, useState } from 'react';
import type { Call, CallSummary, Equipment, Facility, Level, Patient, PatientSummary, PickupMode, TripType } from '../../../shared/types';
import { ALS_EQUIPMENT, BARIATRIC_LBS, DEFAULT_DURATION_MIN, EQUIPMENT, TRIP_TYPES, ageFromDob } from '../../../shared/types';
import { ApiError, api } from '../api';
import { fromLocalInput, toLocalInput } from '../time';

export type IntakeInit = { mode: 'new'; patient?: Patient } | { mode: 'edit'; call: Call };

const PAYERS = ['Medicare Part A', 'Medicare Part B', 'Medicaid', 'Medicare Advantage', 'Commercial / Private', 'VA / Tricare', 'Workers comp', 'Self-pay', 'Facility contract'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Form {
  patientId: string | null;
  firstName: string;
  lastName: string;
  dob: string;
  weight: string;
  weightUnit: 'lb' | 'kg';
  payer: string;
  memberId: string;
  priorAuth: string;
  pcsOnFile: boolean;
  level: Level;
  tripType: TripType;
  pickupMode: PickupMode;
  pickupTime: string; // datetime-local
  pickupLocation: string;
  destination: string;
  durationMin: number;
  chiefComplaint: string;
  stretcherReason: string;
  equipment: Equipment[];
  notes: string;
  returnMode: 'NONE' | 'SCHEDULED' | 'WILL_CALL';
  returnTime: string;
  recurring: boolean;
  weekdays: number[];
  weeks: number;
}

function initial(init: IntakeInit): Form {
  if (init.mode === 'edit') {
    const c = init.call;
    return {
      patientId: c.patientId,
      firstName: c.patient.firstName,
      lastName: c.patient.lastName,
      dob: c.patient.dob,
      weight: String(c.patient.weightLbs),
      weightUnit: 'lb',
      payer: c.insurance.payer,
      memberId: c.insurance.memberId,
      priorAuth: c.insurance.priorAuth,
      pcsOnFile: c.pcsOnFile,
      level: c.level,
      tripType: c.tripType,
      pickupMode: c.pickupMode,
      pickupTime: toLocalInput(c.pickupTime),
      pickupLocation: c.pickupLocation,
      destination: c.destination,
      durationMin: c.durationMin,
      chiefComplaint: c.chiefComplaint,
      stretcherReason: c.stretcherReason,
      equipment: c.equipment,
      notes: c.notes,
      returnMode: 'NONE',
      returnTime: '',
      recurring: false,
      weekdays: [],
      weeks: 4,
    };
  }
  const base: Form = {
    patientId: null,
    firstName: '',
    lastName: '',
    dob: '',
    weight: '',
    weightUnit: 'lb',
    payer: '',
    memberId: '',
    priorAuth: '',
    pcsOnFile: false,
    level: 'BLS',
    tripType: 'DIALYSIS',
    pickupMode: 'SCHEDULED',
    pickupTime: '',
    pickupLocation: '',
    destination: '',
    durationMin: DEFAULT_DURATION_MIN.DIALYSIS,
    chiefComplaint: '',
    stretcherReason: '',
    equipment: [],
    notes: '',
    returnMode: 'NONE',
    returnTime: '',
    recurring: false,
    weekdays: [1, 3, 5],
    weeks: 4,
  };
  return init.patient ? fromPatient(base, init.patient) : base;
}

/** Fill the form from a patient record (the usual details for this patient). */
function fromPatient(f: Form, p: Patient): Form {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...f,
    patientId: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    dob: p.dob,
    weight: String(p.weightLbs),
    weightUnit: 'lb',
    payer: p.insurance.payer,
    memberId: p.insurance.memberId,
    priorAuth: p.priorAuth.number && (!p.priorAuth.expires || p.priorAuth.expires >= today) ? p.priorAuth.number : '',
    pcsOnFile: !!p.pcsExpires && p.pcsExpires >= today,
    level: p.defaultLevel,
    equipment: p.defaultEquipment,
    stretcherReason: p.stretcherReason || f.stretcherReason,
    chiefComplaint: f.chiefComplaint || p.medicalNotes.slice(0, 300),
    pickupLocation: f.pickupLocation || p.address,
  };
}

export function IntakeModal({
  init,
  facilities,
  onClose,
  onSaved,
  onConflict,
}: {
  init: IntakeInit;
  facilities: Facility[];
  onClose: () => void;
  onSaved: (calls: CallSummary[], msg: string) => void;
  onConflict: (e: unknown) => boolean;
}) {
  const [f, setF] = useState<Form>(() => initial(init));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const editing = init.mode === 'edit';
  const [pq, setPq] = useState('');
  const [matches, setMatches] = useState<PatientSummary[]>([]);
  useEffect(() => {
    if (pq.trim().length < 2) {
      setMatches([]);
      return;
    }
    const t = window.setTimeout(() => {
      api<{ patients: PatientSummary[] }>('patients/search', { body: { q: pq } })
        .then((r) => setMatches(r.patients.slice(0, 8)))
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [pq]);
  const pickPatient = async (id: string) => {
    const r = await api<{ patient: Patient }>(`patients/${id}`);
    setF((x) => fromPatient(x, r.patient));
    setPq('');
    setMatches([]);
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const weightLbs = useMemo(() => {
    const n = Number(f.weight);
    if (!n) return 0;
    return Math.round(f.weightUnit === 'kg' ? n * 2.2046 : n);
  }, [f.weight, f.weightUnit]);
  const age = f.dob && !Number.isNaN(Date.parse(f.dob)) ? ageFromDob(f.dob) : null;
  const alsEquip = f.equipment.filter((e) => ALS_EQUIPMENT.includes(e));

  const hints: string[] = [];
  if (f.level === 'BLS' && alsEquip.length) hints.push(`${alsEquip.map((e) => EQUIPMENT[e]).join(', ')} normally requires an ALS crew.`);
  if (weightLbs >= BARIATRIC_LBS && !f.equipment.includes('BARIATRIC_STRETCHER')) hints.push(`Patient is ${weightLbs} lb: consider a bariatric stretcher.`);
  if (!f.pcsOnFile && f.tripType !== 'SNF_TO_ER') hints.push('No PCS (Physician Certification Statement) on file yet.');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError('');
    const body: Record<string, unknown> = {
      level: f.level,
      tripType: f.tripType,
      patient: { firstName: f.firstName, lastName: f.lastName, dob: f.dob, weightLbs },
      insurance: { payer: f.payer, memberId: f.memberId, priorAuth: f.priorAuth },
      pcsOnFile: f.pcsOnFile,
      equipment: f.equipment,
      chiefComplaint: f.chiefComplaint,
      stretcherReason: f.stretcherReason,
      pickupMode: f.pickupMode,
      pickupTime: f.pickupMode === 'SCHEDULED' ? fromLocalInput(f.pickupTime) : null,
      pickupLocation: f.pickupLocation,
      destination: f.destination,
      durationMin: Number(f.durationMin),
      notes: f.notes,
    };
    try {
      if (editing) {
        const r = await api<{ call: Call; summary: CallSummary }>(`calls/${init.call.id}`, {
          method: 'PATCH',
          body: { ...body, expectedVersion: init.call.version },
        });
        onSaved([r.summary], `${r.call.callNumber} updated`);
      } else {
        body.returnTrip = f.returnMode === 'NONE' ? null : { mode: f.returnMode, pickupTime: f.returnMode === 'SCHEDULED' ? fromLocalInput(f.returnTime) : null };
        body.recurrence = f.recurring ? { weekdays: f.weekdays, weeks: Number(f.weeks) } : null;
        body.patientId = f.patientId;
        const r = await api<{ calls: CallSummary[] }>('calls', { body });
        onSaved(r.calls, r.calls.length === 1 ? `${r.calls[0].callNumber} created and queued` : `${r.calls.length} trips created and queued`);
      }
    } catch (err) {
      if (onConflict(err)) {
        onClose();
        return;
      }
      if (err instanceof ApiError && err.body?.issues) {
        const m: Record<string, string> = {};
        for (const i of err.body.issues) m[i.path] = i.message;
        setErrors(m);
        setFormError('Please fix the highlighted fields.');
      } else setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => (errors[k] ? <span className="field-err">{errors[k]}</span> : null);

  return (
    <div className="modal-backdrop">
      <form className="modal intake" onSubmit={submit} autoComplete="off">
        <div className="modal-head">
          <h2>{editing ? `Edit ${init.call.callNumber}` : 'New call'}</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {formError && <div className="banner error">{formError}</div>}

          <fieldset>
            <legend>Service</legend>
            <div className="grid g3">
              <label>
                Level of care
                <div className="seg">
                  {(['BLS', 'ALS'] as Level[]).map((l) => (
                    <button type="button" key={l} className={f.level === l ? `on ${l.toLowerCase()}` : ''} onClick={() => set('level', l)}>
                      {l}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                Trip type
                <select
                  value={f.tripType}
                  onChange={(e) => {
                    const t = e.target.value as TripType;
                    setF((x) => ({ ...x, tripType: t, durationMin: DEFAULT_DURATION_MIN[t] }));
                  }}
                >
                  {Object.entries(TRIP_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Est. duration (min)
                <input type="number" min={15} max={720} step={15} value={f.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} required />
                {err('durationMin')}
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Patient</legend>
            {!editing &&
              (f.patientId ? (
                <div className="patient-linked">
                  Linked to existing patient record.{' '}
                  <button type="button" className="link" onClick={() => set('patientId', null)}>
                    Treat as a new patient
                  </button>
                </div>
              ) : (
                <div className="psearch">
                  <input placeholder="Find existing patient: name, patient #, DOB or member ID" value={pq} onChange={(e) => setPq(e.target.value)} />
                  {matches.length > 0 && (
                    <div className="psearch-results">
                      {matches.map((m) => (
                        <button type="button" key={m.id} onClick={() => pickPatient(m.id)}>
                          <b>{m.name}</b> <span className="muted">· {m.dob} · {m.patientNumber} · {m.payer}</span>
                          {m.alerts.map((a) => (
                            <span key={a} className="chip warn">
                              {a}
                            </span>
                          ))}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            <div className="grid g4">
              <label>
                Last name
                <input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} required maxLength={50} />
                {err('patient.lastName')}
              </label>
              <label>
                First name
                <input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} required maxLength={50} />
                {err('patient.firstName')}
              </label>
              <label>
                Date of birth {age !== null && age >= 0 && <span className="muted">({age}y)</span>}
                <input type="date" value={f.dob} onChange={(e) => set('dob', e.target.value)} required max={new Date().toISOString().slice(0, 10)} />
                {err('patient.dob')}
              </label>
              <label>
                Weight
                <div className="inline">
                  <input type="number" min={1} max={1500} value={f.weight} onChange={(e) => set('weight', e.target.value)} required />
                  <select value={f.weightUnit} onChange={(e) => set('weightUnit', e.target.value as 'lb' | 'kg')}>
                    <option value="lb">lb</option>
                    <option value="kg">kg</option>
                  </select>
                </div>
                {f.weightUnit === 'kg' && weightLbs > 0 && <span className="muted small">= {weightLbs} lb</span>}
                {err('patient.weightLbs')}
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Insurance &amp; medical necessity</legend>
            <div className="grid g4">
              <label>
                Insurance / payer
                <input list="payers" value={f.payer} onChange={(e) => set('payer', e.target.value)} required maxLength={80} />
                <datalist id="payers">
                  {PAYERS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                {err('insurance.payer')}
              </label>
              <label>
                Member / policy ID
                <input value={f.memberId} onChange={(e) => set('memberId', e.target.value)} maxLength={40} />
              </label>
              <label>
                Prior authorization #
                <input value={f.priorAuth} onChange={(e) => set('priorAuth', e.target.value)} maxLength={40} />
              </label>
              <label className="check">
                <input type="checkbox" checked={f.pcsOnFile} onChange={(e) => set('pcsOnFile', e.target.checked)} />
                PCS on file
              </label>
            </div>
            <label>
              Chief complaint / diagnosis
              <input value={f.chiefComplaint} onChange={(e) => set('chiefComplaint', e.target.value)} required maxLength={300} />
              {err('chiefComplaint')}
            </label>
            <label>
              Reason for stretcher (medical necessity)
              <textarea
                rows={2}
                value={f.stretcherReason}
                onChange={(e) => set('stretcherReason', e.target.value)}
                required
                maxLength={500}
                placeholder="e.g. Bed-confined: unable to get up from bed without assistance, unable to ambulate, unable to sit in a chair or wheelchair"
              />
              {err('stretcherReason')}
            </label>
            <div className="equip">
              <span className="lbl">Equipment needed</span>
              {(Object.keys(EQUIPMENT) as Equipment[]).map((k) => (
                <label key={k} className={`check chipcheck ${ALS_EQUIPMENT.includes(k) ? 'als' : ''}`}>
                  <input
                    type="checkbox"
                    checked={f.equipment.includes(k)}
                    onChange={(e) => set('equipment', e.target.checked ? [...f.equipment, k] : f.equipment.filter((x) => x !== k))}
                  />
                  {EQUIPMENT[k]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Pickup &amp; destination</legend>
            <datalist id="facilities">
              {facilities.map((fac) => (
                <option key={fac.id} value={fac.name}>
                  {fac.kind} · {fac.address}
                </option>
              ))}
            </datalist>
            <div className="grid g2">
              <label>
                Pickup location
                <input list="facilities" value={f.pickupLocation} onChange={(e) => set('pickupLocation', e.target.value)} required maxLength={200} placeholder="Facility or address, room/unit" />
                {err('pickupLocation')}
              </label>
              <label>
                Destination
                <input list="facilities" value={f.destination} onChange={(e) => set('destination', e.target.value)} required maxLength={200} />
                {err('destination')}
              </label>
            </div>
            <div className="grid g2">
              <label>
                Pickup time
                <div className="seg">
                  {(['ASAP', 'SCHEDULED', 'WILL_CALL'] as PickupMode[]).map((m) => (
                    <button type="button" key={m} className={f.pickupMode === m ? 'on' : ''} onClick={() => set('pickupMode', m)}>
                      {{ ASAP: 'ASAP', SCHEDULED: 'Scheduled', WILL_CALL: 'Will-call' }[m]}
                    </button>
                  ))}
                </div>
              </label>
              {f.pickupMode === 'SCHEDULED' && (
                <label>
                  Pickup date &amp; time
                  <input type="datetime-local" step={900} value={f.pickupTime} onChange={(e) => set('pickupTime', e.target.value)} required />
                  {err('pickupTime')}
                </label>
              )}
            </div>

            {!editing && (
              <div className="grid g2">
                <label>
                  Return trip
                  <select value={f.returnMode} onChange={(e) => set('returnMode', e.target.value as Form['returnMode'])}>
                    <option value="NONE">One way</option>
                    <option value="SCHEDULED">Round trip, scheduled return</option>
                    <option value="WILL_CALL">Round trip, will-call return</option>
                  </select>
                </label>
                {f.returnMode === 'SCHEDULED' && (
                  <label>
                    Return pickup time
                    <input type="datetime-local" step={900} value={f.returnTime} onChange={(e) => set('returnTime', e.target.value)} required />
                    {err('returnTrip.pickupTime')}
                  </label>
                )}
              </div>
            )}

            {!editing && f.pickupMode === 'SCHEDULED' && (
              <div className="recur">
                <label className="check">
                  <input type="checkbox" checked={f.recurring} onChange={(e) => set('recurring', e.target.checked)} />
                  Recurring standing order (e.g. dialysis)
                </label>
                {f.recurring && (
                  <div className="inline">
                    {WEEKDAYS.map((d, i) => (
                      <label key={d} className="check chipcheck">
                        <input
                          type="checkbox"
                          checked={f.weekdays.includes(i)}
                          onChange={(e) => set('weekdays', e.target.checked ? [...f.weekdays, i] : f.weekdays.filter((x) => x !== i))}
                        />
                        {d}
                      </label>
                    ))}
                    <span>for</span>
                    <select value={f.weeks} onChange={(e) => set('weeks', Number(e.target.value))}>
                      {[1, 2, 3, 4, 6, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} week{n > 1 ? 's' : ''}
                        </option>
                      ))}
                    </select>
                    {err('recurrence')}
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <label>
            Dispatch notes (access codes, contacts, special instructions)
            <textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />
          </label>

          {hints.length > 0 && (
            <div className="banner warn">
              {hints.map((h) => (
                <div key={h}>⚠ {h}</div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Discard
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create & queue call'}
          </button>
        </div>
      </form>
    </div>
  );
}
