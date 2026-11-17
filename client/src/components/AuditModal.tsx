import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtDateTime } from '../time';

interface Entry {
  ts: string;
  user: string;
  role: string;
  action: string;
  callNumber?: string;
  entityType?: string;
  entityId?: string;
  outcome: string;
  ip?: string;
  detail?: string;
}

export function AuditModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<{ entries: Entry[] }>('audit').then((r) => setEntries(r.entries));
  }, []);
  const shown = (entries || []).filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <div className="modal-head">
          <h2>Audit log</h2>
          <input className="search" placeholder="Filter by user, action, call #" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="muted small">Most recent 500 entries. Who accessed or changed which record, and when. Patient details are never written to this log.</p>
          <table className="audit">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Record</th>
                <th>Outcome</th>
                <th>Detail</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={i} className={e.outcome !== 'success' ? 'bad' : ''}>
                  <td>{fmtDateTime(e.ts)}</td>
                  <td>
                    {e.user} <span className="muted">({e.role})</span>
                  </td>
                  <td>{e.action}</td>
                  <td>{e.callNumber || (e.entityId ? `${e.entityType}:${e.entityId.slice(0, 8)}` : '')}</td>
                  <td>{e.outcome}</td>
                  <td>{e.detail}</td>
                  <td>{e.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries && <div className="muted">Loading…</div>}
        </div>
      </div>
    </div>
  );
}
