import { useEffect, useState } from 'react';
import type { CallSummary, Equipment, Patient, PatientSummary } from '../../../shared/types';
import { ALS_EQUIPMENT, EQUIPMENT, STATUSES, TRIP_TYPES, ageFromDob, paperworkAlerts } from '../../../shared/types';
import { ApiError, api } from '../api';
import { fmtDateTime } from '../time';
import type { Toast } from './Toasts';

interface Props {
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onOpenCall: (c: CallSummary) => void;
  onNewTrip: (p: Patient) => void;
  toast: (t: string, k?: Toast['kind']) => void;
}

const blank = (): Omit<Patient, 'id' | 'patientNumber' | 'version' | 'createdAt' | 'updatedAt' | 'updatedBy'> => ({
  firstName: '',
  lastName: '',
  dob: '',
  sex: 'U',
  weightLbs: 0,
  phone: '',
  address: '',
  insurance: { payer: '', memberId: '' },
  pcsExpires: null,
  priorAuth: { number: '', expires: null, tripsAuthorized: null },
  defaultLevel: 'BLS',
  defaultEquipment: [],
  stretcherReason: '',
  medicalNotes: '',
  active: true,
});

/** Patient database: search, demographics, paperwork, and every past and upcoming trip. */
export function PatientsView({ openId, setOpenId, onOpenCall, onNewTrip, toast }: Props) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<PatientSummary[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      api<{ patients: PatientSummary[] }>('patients/search', { body: { q } })
        .then((r) => setList(r.patients))
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, openId]);

  return (
    <div className="patients">
      <aside className="plist">
        <div className="plist-head">
          <input className="search" placeholder="Search name, patient #, DOB, member ID" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button
            className="btn primary"
            onClick={() => {
              setCreating(true);
              setOpenId(null);
            }}
          >
            + New
          </button>
        </div>
        <div className="plist-items">
          {list.map((p) => (
            <button key={p.id} className={`prow ${openId === p.id ? 'on' : ''}`} onClick={() => (setCreating(false), setOpenId(p.id))}>
              <div>
                <b>{p.name}</b> <span className="muted">{p.age}y</span>
              </div>
              <div className="muted small">
                {p.patientNumber} · DOB {p.dob} · {p.payer || 'No payer'}
              </div>
              <div className="small">
                {p.nextTrip ? <span>Next: {fmtDateTime(p.nextTrip)}</span> : <span className="muted">No upcoming trips</span>}
                {p.alerts.map((a) => (
                  <span key={a} className="chip warn">
                    {a}
                  </span>
                ))}
              </div>
            </button>
          ))}
          {list.length === 0 && <div className="empty">No patients found.</div>}
        </div>
      </aside>
      <section className="pdetail">
        {creating ? (
          <PatientForm
            key="new"
            initial={blank()}
            onCancel={() => setCreating(false)}
            onSave={async (data) => {
              try {
                const r = await api<{ patient: Patient }>('patients', { body: data });
                toast(`${r.patient.patientNumber} created`, 'success');
                setCreating(false);
                setOpenId(r.patient.id);
              } catch (e) {
                if (e instanceof ApiError && e.status === 409 && e.body.patientId) {
                  toast(e.body.message, 'warn');
                  setCreating(false);
                  setOpenId(e.body.patientId);
                } else throw e;
              }
            }}
          />
        ) : openId ? (
          <PatientDetail key={openId} id={openId} onOpenCall={onOpenCall} onNewTrip={onNewTrip} toast={toast} />
        ) : (
          <div className="empty big">Select a patient to see their record and trip history, or add a new one.</div>
        )}
      </section>
    </div>
  );
}

function PatientDetail({ id, onOpenCall, onNewTrip, toast }: { id: string; onOpenCall: (c: CallSummary) => void; onNewTrip: (p: Patient) => void; toast: Props['toast'] }) {
  const [data, setData] = useState<{ patient: Patient; trips: CallSummary[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const load = () =>
    api<{ patient: Patient; trips: CallSummary[] }>(`patients/${id}`)
      .then(setData)
      .catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
  }, [id]);

  if (!data) return <div className="muted pad">Loading…</div>;
  const p = data.patient;
  if (editing)
    return (
      <PatientForm
        initial={p}
        onCancel={() => setEditing(false)}
        onSave={async (changes) => {
          try {
            const r = await api<{ patient: Patient }>(`patients/${p.id}`, { method: 'PATCH', body: { ...changes, expectedVersion: p.version } });
            setData({ ...data, patient: r.patient });
            setEditing(false);
            toast('Patient record saved', 'success');
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
              toast(e.body.message, 'warn');
              setData({ ...data, patient: e.body.patient });
              setEditing(false);
            } else throw e;
          }
        }}
      />
    );

  const now = Date.now();
  const when = (c: CallSummary) => c.scheduledStart || c.pickupTime || c.createdAt;
  const upcoming = data.trips.filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status)).sort((a, b) => when(a).localeCompare(when(b)));
  const past = data.trips.filter((c) => ['COMPLETED', 'CANCELLED'].includes(c.status));
  const alerts = paperworkAlerts(p, new Date());
  const pcsDays = p.pcsExpires ? Math.ceil((Date.parse(p.pcsExpires + 'T23:59:59') - now) / 86400000) : null;

  return (
    <div className="pcard">
      <div className="pcard-head">
        <div>
          <h2>
            {p.lastName}, {p.firstName} {!p.active && <span className="tag">Inactive</span>}
          </h2>
          <div className="muted">
            {p.patientNumber} · DOB {p.dob} ({ageFromDob(p.dob)}y) · {{ F: 'Female', M: 'Male', X: 'Other', U: 'Sex not recorded' }[p.sex]}
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => onNewTrip(p)}>
            Book trip
          </button>
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      </div>
      {alerts.length > 0 && <div className="banner warn">⚠ {alerts.join(' · ')}</div>}
      <div className="pgrid">
        <div className="dsec">
          <h3>Contact</h3>
          <Row k="Phone" v={p.phone || '—'} />
          <Row k="Address / residence" v={p.address || '—'} />
          <Row k="Weight" v={`${p.weightLbs} lb (${Math.round(p.weightLbs / 2.2046)} kg)`} />
        </div>
        <div className="dsec">
          <h3>Insurance &amp; paperwork</h3>
          <Row k="Payer" v={p.insurance.payer || '—'} />
          <Row k="Member ID" v={p.insurance.memberId || '—'} />
          <Row
            k="PCS expires"
            v={p.pcsExpires ? <span className={pcsDays! < 0 ? 'bad-text' : pcsDays! < 7 ? 'warn-text' : ''}>{p.pcsExpires} ({pcsDays! < 0 ? `expired ${-pcsDays!}d ago` : `${pcsDays}d left`})</span> : <span className="warn-text">None on file</span>}
          />
          <Row k="Prior auth" v={p.priorAuth.number ? `${p.priorAuth.number}${p.priorAuth.expires ? `, expires ${p.priorAuth.expires}` : ''}${p.priorAuth.tripsAuthorized != null ? `, ${p.priorAuth.tripsAuthorized} trips` : ''}` : '—'} />
        </div>
        <div className="dsec">
          <h3>Transport defaults</h3>
          <Row k="Level" v={p.defaultLevel} />
          <Row k="Equipment" v={p.defaultEquipment.length ? p.defaultEquipment.map((e) => EQUIPMENT[e]).join(', ') : 'None'} />
          <Row k="Medical necessity" v={p.stretcherReason || '—'} />
          <Row k="Medical notes" v={p.medicalNotes || '—'} />
        </div>
      </div>

      <div className="tabs ptabs">
        <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>
          Upcoming &amp; open <span>{upcoming.length}</span>
        </button>
        <button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>
          Past <span>{past.length}</span>
        </button>
      </div>
      <table className="trips">
        <thead>
          <tr>
            <th>When</th>
            <th>Call #</th>
            <th>Type</th>
            <th>Level</th>
            <th>From → To</th>
            <th>Status</th>
            <th>Miles</th>
          </tr>
        </thead>
        <tbody>
          {(tab === 'upcoming' ? upcoming : past).map((c) => (
            <tr key={c.id} onClick={() => onOpenCall(c)} className="click">
              <td>{c.pickupMode === 'WILL_CALL' && !c.scheduledStart ? 'Will-call' : c.pickupMode === 'ASAP' && !c.scheduledStart ? 'ASAP' : fmtDateTime(when(c))}</td>
              <td>{c.callNumber}</td>
              <td>{TRIP_TYPES[c.tripType]}</td>
              <td>{c.level}</td>
              <td>
                {c.pickupLocation} → {c.destination}
              </td>
              <td>
                {STATUSES[c.status]}
                {c.alerts.length > 0 && <span className="chip warn">{c.alerts.join(', ')}</span>}
              </td>
              <td>{c.loadedMiles ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(tab === 'upcoming' ? upcoming : past).length === 0 && <div className="empty">No trips.</div>}
      <p className="muted small">Last updated by {p.updatedBy}, {fmtDateTime(p.updatedAt)}.</p>
    </div>
  );
}

type FormData = ReturnType<typeof blank>;

function PatientForm({ initial, onSave, onCancel }: { initial: FormData; onSave: (d: FormData) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState<FormData>({
    ...initial,
    insurance: { ...initial.insurance },
    priorAuth: { ...initial.priorAuth },
    defaultEquipment: [...initial.defaultEquipment],
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="pcard pform"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await onSave({ ...f, weightLbs: Number(f.weightLbs) });
        } catch (err) {
          setError(
            err instanceof ApiError && err.body?.issues ? err.body.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ') : (err as Error).message,
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{'patientNumber' in initial ? 'Edit patient' : 'New patient'}</h2>
      {error && <div className="banner error">{error}</div>}
      <div className="grid g4">
        <label>
          Last name
          <input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} required maxLength={50} />
        </label>
        <label>
          First name
          <input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} required maxLength={50} />
        </label>
        <label>
          Date of birth
          <input type="date" value={f.dob} onChange={(e) => set('dob', e.target.value)} required />
        </label>
        <label>
          Sex
          <select value={f.sex} onChange={(e) => set('sex', e.target.value as FormData['sex'])}>
            <option value="U">Not recorded</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="X">Other</option>
          </select>
        </label>
        <label>
          Weight (lb)
          <input type="number" min={1} max={1500} value={f.weightLbs || ''} onChange={(e) => set('weightLbs', Number(e.target.value))} required />
        </label>
        <label>
          Phone
          <input value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} />
        </label>
        <label className="span2">
          Address / residence
          <input value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={200} />
        </label>
        <label>
          Insurance / payer
          <input value={f.insurance.payer} onChange={(e) => set('insurance', { ...f.insurance, payer: e.target.value })} maxLength={80} />
        </label>
        <label>
          Member ID
          <input value={f.insurance.memberId} onChange={(e) => set('insurance', { ...f.insurance, memberId: e.target.value })} maxLength={40} />
        </label>
        <label>
          PCS expires
          <input type="date" value={f.pcsExpires ?? ''} onChange={(e) => set('pcsExpires', e.target.value || null)} />
        </label>
        <label>
          Prior auth #
          <input value={f.priorAuth.number} onChange={(e) => set('priorAuth', { ...f.priorAuth, number: e.target.value })} maxLength={40} />
        </label>
        <label>
          Auth expires
          <input type="date" value={f.priorAuth.expires ?? ''} onChange={(e) => set('priorAuth', { ...f.priorAuth, expires: e.target.value || null })} />
        </label>
        <label>
          Trips authorized
          <input
            type="number"
            min={0}
            value={f.priorAuth.tripsAuthorized ?? ''}
            onChange={(e) => set('priorAuth', { ...f.priorAuth, tripsAuthorized: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
        <label>
          Usual level
          <select value={f.defaultLevel} onChange={(e) => set('defaultLevel', e.target.value as 'ALS' | 'BLS')}>
            <option>BLS</option>
            <option>ALS</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active patient
        </label>
      </div>
      <div className="equip">
        <span className="lbl">Usual equipment</span>
        {(Object.keys(EQUIPMENT) as Equipment[]).map((k) => (
          <label key={k} className={`check chipcheck ${ALS_EQUIPMENT.includes(k) ? 'als' : ''}`}>
            <input
              type="checkbox"
              checked={f.defaultEquipment.includes(k)}
              onChange={(e) => set('defaultEquipment', e.target.checked ? [...f.defaultEquipment, k] : f.defaultEquipment.filter((x) => x !== k))}
            />
            {EQUIPMENT[k]}
          </label>
        ))}
      </div>
      <label>
        Usual reason for stretcher (medical necessity)
        <textarea rows={2} value={f.stretcherReason} onChange={(e) => set('stretcherReason', e.target.value)} maxLength={500} />
      </label>
      <label>
        Medical notes (diagnoses, allergies, isolation history)
        <textarea rows={2} value={f.medicalNotes} onChange={(e) => set('medicalNotes', e.target.value)} maxLength={1000} />
      </label>
      <div className="actions end">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save patient'}
        </button>
      </div>
    </form>
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
