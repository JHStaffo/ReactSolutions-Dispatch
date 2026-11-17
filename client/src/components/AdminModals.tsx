import { useEffect, useState } from 'react';
import type { Crew, CrewMember, Facility, MapConfig, Role, UserInfo } from '../../../shared/types';
import { FACILITY_KINDS } from '../../../shared/types';
import { ApiError, api } from '../api';
import type { Toast } from './Toasts';

type ToastFn = (t: string, k?: Toast['kind']) => void;
const errText = (e: unknown) =>
  e instanceof ApiError
    ? e.body?.issues
      ? e.body.issues.map((i: { path: string; message: string }) => `${i.path || 'field'}: ${i.message}`).join('; ')
      : e.message
    : 'Failed';

function Shell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop">
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// =================== Users ===================

export function UsersModal({ crews, me, onClose, toast }: { crews: Crew[]; me: string; onClose: () => void; toast: ToastFn }) {
  const [users, setUsers] = useState<(UserInfo & { crewId: string | null })[]>([]);
  const [form, setForm] = useState({ username: '', displayName: '', role: 'dispatcher' as Role, crewId: '', password: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ users: typeof users }>('admin/users').then((r) => setUsers(r.users));
  }, []);

  const patch = async (username: string, body: Record<string, unknown>, msg: string) => {
    try {
      const r = await api<{ users: typeof users }>(`admin/users/${encodeURIComponent(username)}`, { method: 'PATCH', body });
      setUsers(r.users);
      toast(msg, 'success');
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  const crewName = (id: string | null) => crews.find((c) => c.id === id)?.unit ?? '';

  return (
    <Shell title="Users" onClose={onClose} wide>
      <table className="trips">
        <thead>
          <tr>
            <th>Username</th>
            <th>Name</th>
            <th>Role</th>
            <th>Crew</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username} className={u.disabled ? 'dim' : ''}>
              <td>{u.username}</td>
              <td>{u.displayName}</td>
              <td>
                <select
                  value={u.role}
                  disabled={u.username === me}
                  onChange={(e) => {
                    const role = e.target.value as Role;
                    if (role === 'crew') return toast('To make a crew account, create a new user and pick the crew.', 'warn');
                    patch(u.username, { role }, `${u.username} is now ${role}`);
                  }}
                >
                  {['dispatcher', 'supervisor', 'viewer', 'crew'].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td>{u.role === 'crew' ? crewName(u.crewId) : ''}</td>
              <td>{u.disabled ? 'Disabled' : 'Active'}</td>
              <td className="row-actions">
                <button
                  className="btn small"
                  onClick={() => {
                    const pw = window.prompt(`New temporary password for ${u.username} (12+ characters):`);
                    if (pw) patch(u.username, { password: pw }, `Password reset for ${u.username}`);
                  }}
                >
                  Reset password
                </button>
                {u.username !== me && (
                  <button className={`btn small ${u.disabled ? '' : 'danger'}`} onClick={() => patch(u.username, { disabled: !u.disabled }, `${u.username} ${u.disabled ? 'enabled' : 'disabled'}`)}>
                    {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="addrow"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            const r = await api<{ users: typeof users }>('admin/users', { body: { ...form, crewId: form.role === 'crew' ? form.crewId : null } });
            setUsers(r.users);
            toast(`${form.username} created`, 'success');
            setForm({ username: '', displayName: '', role: 'dispatcher', crewId: '', password: '' });
          } catch (err) {
            setError(errText(err));
          }
        }}
      >
        <h3>Add user</h3>
        {error && <div className="banner error">{error}</div>}
        <div className="grid g4">
          <label>
            Username
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </label>
          <label>
            Display name
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="dispatcher">Dispatcher</option>
              <option value="supervisor">Supervisor</option>
              <option value="viewer">Read-only viewer</option>
              <option value="crew">Crew (mobile screen)</option>
            </select>
          </label>
          {form.role === 'crew' ? (
            <label>
              Crew
              <select value={form.crewId} onChange={(e) => setForm({ ...form, crewId: e.target.value })} required>
                <option value="">Choose…</option>
                {crews.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.unit}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span />
          )}
          <label>
            Temporary password (12+)
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={12} required autoComplete="new-password" />
          </label>
        </div>
        <div className="actions end">
          <button className="btn primary">Add user</button>
        </div>
        <p className="muted small">Disabling a user or resetting their password signs them out everywhere immediately.</p>
      </form>
    </Shell>
  );
}

// =================== Crews & trucks ===================

const emptyCrew = (): Omit<Crew, 'id' | 'version' | 'outOfService' | 'oosReason'> => ({
  unit: '',
  vehicle: '',
  phone: '',
  level: 'BLS',
  members: [
    { name: '', cert: 'EMT' },
    { name: '', cert: 'EMT' },
  ],
  shiftStart: '07:00',
  shiftEnd: '19:00',
  gpsDeviceId: '',
  active: true,
});

export function RosterModal({ crews, onSaved, onClose, toast }: { crews: Crew[]; onSaved: (c: Crew) => void; onClose: () => void; toast: ToastFn }) {
  const [editing, setEditing] = useState<(ReturnType<typeof emptyCrew> & { id?: string; version?: number }) | null>(null);
  const [error, setError] = useState('');

  const save = async () => {
    if (!editing) return;
    setError('');
    const body = { ...editing, members: editing.members.filter((m) => m.name.trim()) };
    try {
      const r = editing.id
        ? await api<{ crew: Crew; warnings: string[] }>(`admin/crews/${editing.id}`, { method: 'PUT', body: { ...body, expectedVersion: editing.version } })
        : await api<{ crew: Crew; warnings: string[] }>('admin/crews', { body });
      onSaved(r.crew);
      r.warnings.forEach((w) => toast(w, 'warn'));
      toast(`${r.crew.unit} saved`, 'success');
      setEditing(null);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Shell title="Crews & trucks" onClose={onClose} wide>
      {!editing ? (
        <>
          <table className="trips">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Truck</th>
                <th>Level</th>
                <th>Crew</th>
                <th>Shift</th>
                <th>GPS device</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {crews.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'dim'}>
                  <td>{c.unit}</td>
                  <td>{c.vehicle}</td>
                  <td>{c.level}</td>
                  <td>{c.members.map((m) => `${m.name} (${m.cert})`).join(', ')}</td>
                  <td>
                    {c.shiftStart}–{c.shiftEnd}
                  </td>
                  <td>{c.gpsDeviceId || <span className="warn-text">none</span>}</td>
                  <td>{c.active ? (c.outOfService ? 'Out of service' : 'On roster') : 'Off roster'}</td>
                  <td>
                    <button className="btn small" onClick={() => setEditing({ ...c, members: c.members.map((m) => ({ ...m })) })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions end">
            <button className="btn primary" onClick={() => setEditing(emptyCrew())}>
              + Add crew / truck
            </button>
          </div>
        </>
      ) : (
        <div className="crew-form">
          {error && <div className="banner error">{error}</div>}
          <div className="grid g4">
            <label>
              Unit name
              <input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="Medic 12" />
            </label>
            <label>
              Truck
              <input value={editing.vehicle} onChange={(e) => setEditing({ ...editing, vehicle: e.target.value })} placeholder="Truck 412" />
            </label>
            <label>
              Crew phone
              <input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </label>
            <label>
              Level
              <select value={editing.level} onChange={(e) => setEditing({ ...editing, level: e.target.value as 'ALS' | 'BLS' })}>
                <option>BLS</option>
                <option>ALS</option>
              </select>
            </label>
            <label>
              Shift start
              <input type="time" value={editing.shiftStart} onChange={(e) => setEditing({ ...editing, shiftStart: e.target.value })} />
            </label>
            <label>
              Shift end
              <input type="time" value={editing.shiftEnd} onChange={(e) => setEditing({ ...editing, shiftEnd: e.target.value })} />
            </label>
            <label>
              GPS device ID
              <input value={editing.gpsDeviceId} onChange={(e) => setEditing({ ...editing, gpsDeviceId: e.target.value })} placeholder="As your GPS vendor reports it" />
            </label>
            <label className="check">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> On the board (active)
            </label>
          </div>
          <h3>Crew members</h3>
          {editing.members.map((m, i) => (
            <div key={i} className="inline member">
              <input
                value={m.name}
                placeholder="Name"
                onChange={(e) => setEditing({ ...editing, members: editing.members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
              />
              <select
                value={m.cert}
                onChange={(e) =>
                  setEditing({ ...editing, members: editing.members.map((x, j) => (j === i ? { ...x, cert: e.target.value as CrewMember['cert'] } : x)) })
                }
              >
                <option>Paramedic</option>
                <option>AEMT</option>
                <option>EMT</option>
              </select>
              <button className="btn small ghost" onClick={() => setEditing({ ...editing, members: editing.members.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          {editing.members.length < 4 && (
            <button className="btn small" onClick={() => setEditing({ ...editing, members: [...editing.members, { name: '', cert: 'EMT' }] })}>
              + Member
            </button>
          )}
          <div className="actions end">
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// =================== Facilities ===================

const emptyFacility = (): Omit<Facility, 'id'> => ({ name: '', kind: 'Hospital', address: '', phone: '', lat: null, lon: null });

export function FacilitiesModal({
  facilities,
  map: _map,
  onSaved,
  onClose,
  toast,
}: {
  facilities: Facility[];
  map: MapConfig;
  onSaved: (f: Facility[]) => void;
  onClose: () => void;
  toast: ToastFn;
}) {
  const [editing, setEditing] = useState<(Omit<Facility, 'id'> & { id?: string }) | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const list = facilities.filter((f) => !q || `${f.name} ${f.address} ${f.kind}`.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!editing) return;
    setError('');
    try {
      const { id, ...body } = editing;
      const r = id
        ? await api<{ facility: Facility }>(`facilities/${id}`, { method: 'PUT', body })
        : await api<{ facility: Facility }>('facilities', { body });
      onSaved(id ? facilities.map((f) => (f.id === id ? r.facility : f)) : [...facilities, r.facility]);
      toast(`${r.facility.name} saved`, 'success');
      setEditing(null);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Shell title="Facility address book" onClose={onClose} wide>
      {!editing ? (
        <>
          <div className="inline">
            <input className="search" placeholder="Filter facilities" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" onClick={() => setEditing(emptyFacility())}>
              + Add facility
            </button>
          </div>
          <table className="trips">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Address</th>
                <th>Phone</th>
                <th>Map location</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.kind}</td>
                  <td>{f.address}</td>
                  <td>{f.phone}</td>
                  <td>{f.lat != null ? `${f.lat.toFixed(4)}, ${f.lon!.toFixed(4)}` : <span className="warn-text">not set</span>}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => setEditing({ ...f })}>
                      Edit
                    </button>
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        if (!window.confirm(`Remove ${f.name} from the address book?`)) return;
                        await api(`facilities/${f.id}`, { method: 'DELETE' });
                        onSaved(facilities.filter((x) => x.id !== f.id));
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Facilities with a map location appear on the map and are used for closest-unit suggestions and GPS lines.</p>
        </>
      ) : (
        <div>
          {error && <div className="banner error">{error}</div>}
          <div className="grid g3">
            <label className="span2">
              Name
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label>
              Type
              <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Facility['kind'] })}>
                {FACILITY_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="span2">
              Address
              <input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </label>
            <label>
              Phone
              <input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </label>
            <label>
              Latitude
              <input type="number" step="any" value={editing.lat ?? ''} onChange={(e) => setEditing({ ...editing, lat: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label>
              Longitude
              <input type="number" step="any" value={editing.lon ?? ''} onChange={(e) => setEditing({ ...editing, lon: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label>
              &nbsp;
              <span className="muted small">Tip: right-click the place in Google Maps and copy the coordinates.</span>
            </label>
          </div>
          <div className="actions end">
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
