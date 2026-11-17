import { useEffect, useState } from 'react';
import type { Crew, Role } from '../../../shared/types';
import { api } from '../api';
import { addDays, startOfDay } from '../time';
import type { Toast } from './Toasts';

interface Report {
  total: number;
  completed: number;
  cancelled: number;
  open: number;
  onTimePct: number | null;
  onTimeBase: number;
  asapAvgMin: number | null;
  loadedMiles: number;
  byTripType: { key: string; count: number }[];
  byLevel: { key: string; count: number }[];
  byPayer: { key: string; count: number }[];
  byStatus: { key: string; count: number }[];
  cancelReasons: { key: string; count: number }[];
  units: { crewId: string; unit: string; level: string; trips: number; busyHours: number; loadedMiles: number }[];
}

const presets = {
  today: () => [startOfDay(new Date()), addDays(startOfDay(new Date()), 1)],
  week: () => [addDays(startOfDay(new Date()), -6), addDays(startOfDay(new Date()), 1)],
  month: () => [addDays(startOfDay(new Date()), -29), addDays(startOfDay(new Date()), 1)],
} as const;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csv = (rows: (string | number | null)[][]) =>
  rows.map((r) => r.map((v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n');

/** Operational reports (no patient details) plus the supervisor-only billing export. */
export function ReportsView({ role, crews: _crews, toast }: { role: Role; crews: Crew[]; toast: (t: string, k?: Toast['kind']) => void }) {
  const [from, setFrom] = useState(ymd(presets.week()[0]));
  const [to, setTo] = useState(ymd(addDays(presets.week()[1], -1)));
  const [r, setR] = useState<Report | null>(null);
  const range = () => ({ from: new Date(from + 'T00:00:00').toISOString(), to: addDays(new Date(to + 'T00:00:00'), 1).toISOString() });

  useEffect(() => {
    if (!from || !to) return;
    api<Report>('reports/summary', { body: range() })
      .then(setR)
      .catch((e) => toast(e.message, 'error'));
  }, [from, to]);

  const setPreset = (k: keyof typeof presets) => {
    const [a, b] = presets[k]();
    setFrom(ymd(a));
    setTo(ymd(addDays(b, -1)));
  };

  const exportSummary = () => {
    if (!r) return;
    const rows: (string | number | null)[][] = [
      ['Report', `${from} to ${to}`],
      [],
      ['Metric', 'Value'],
      ['Total trips', r.total],
      ['Completed', r.completed],
      ['Cancelled', r.cancelled],
      ['Open', r.open],
      ['On-time pickups %', r.onTimePct],
      ['ASAP average response (min)', r.asapAvgMin],
      ['Loaded miles', r.loadedMiles],
      [],
      ['Unit', 'Level', 'Trips', 'Busy hours', 'Loaded miles'],
      ...r.units.map((u) => [u.unit, u.level, u.trips, u.busyHours, u.loadedMiles]),
      [],
      ['Trip type', 'Trips'],
      ...r.byTripType.map((x) => [x.key, x.count]),
      [],
      ['Payer', 'Trips'],
      ...r.byPayer.map((x) => [x.key, x.count]),
      [],
      ['Cancellation reason', 'Trips'],
      ...r.cancelReasons.map((x) => [x.key, x.count]),
    ];
    download(`dispatch-report-${from}-to-${to}.csv`, csv(rows));
  };

  const exportBilling = async () => {
    const res = await fetch('api/exports/billing', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch' },
      body: JSON.stringify(range()),
    });
    if (!res.ok) return toast('Billing export failed', 'error');
    download(`billing-${from}-to-${to}.csv`, await res.text());
    toast('Billing export downloaded. It contains patient information: store it securely.', 'warn');
  };

  const max = (xs: { count: number }[]) => Math.max(1, ...xs.map((x) => x.count));

  return (
    <div className="reports">
      <div className="reports-head">
        <h2>Reports</h2>
        <div className="seg small-seg">
          <button onClick={() => setPreset('today')}>Today</button>
          <button onClick={() => setPreset('week')}>Last 7 days</button>
          <button onClick={() => setPreset('month')}>Last 30 days</button>
        </div>
        <label className="inline">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inline">
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span className="spacer" />
        <button className="btn" onClick={exportSummary} disabled={!r}>
          Export report (CSV)
        </button>
        {role === 'supervisor' && (
          <button className="btn" onClick={exportBilling} title="Completed trips with patient, payer, PCS, loaded miles. Audited.">
            Billing export (CSV)
          </button>
        )}
      </div>
      {r && (
        <>
          <div className="kpis">
            <Kpi label="Trips" value={r.total} />
            <Kpi label="Completed" value={r.completed} />
            <Kpi label="Cancelled" value={r.cancelled} tone={r.cancelled ? 'amber' : undefined} />
            <Kpi label="Still open" value={r.open} />
            <Kpi label="On-time pickups" value={r.onTimePct == null ? '—' : `${r.onTimePct}%`} sub={r.onTimeBase ? `of ${r.onTimeBase} scheduled` : 'no scheduled trips'} />
            <Kpi label="ASAP avg response" value={r.asapAvgMin == null ? '—' : `${r.asapAvgMin} min`} sub="call to on scene" />
            <Kpi label="Loaded miles" value={r.loadedMiles} />
          </div>
          <div className="report-grid">
            <Bars title="Trips by type" rows={r.byTripType} max={max(r.byTripType)} />
            <Bars title="Trips by payer" rows={r.byPayer} max={max(r.byPayer)} />
            <Bars title="Level of care" rows={r.byLevel} max={max(r.byLevel)} />
            <Bars title="Cancellation reasons" rows={r.cancelReasons} max={max(r.cancelReasons)} empty="No cancellations" />
            <div className="rcard wide">
              <h3>Unit utilization (completed trips)</h3>
              <table className="trips">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Level</th>
                    <th>Trips</th>
                    <th>Busy hours</th>
                    <th>Loaded miles</th>
                  </tr>
                </thead>
                <tbody>
                  {r.units.map((u) => (
                    <tr key={u.crewId}>
                      <td>{u.unit}</td>
                      <td>{u.level}</td>
                      <td>{u.trips}</td>
                      <td>{u.busyHours}</td>
                      <td>{u.loadedMiles}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="muted small">
            On time = crew on scene within 15 minutes of the scheduled pickup. Loaded miles come from truck GPS between "Transporting" and "At
            destination", or as entered by a dispatcher.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'amber' }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kv">{value}</div>
      <div className="kl">{label}</div>
      {sub && <div className="ks">{sub}</div>}
    </div>
  );
}

function Bars({ title, rows, max, empty }: { title: string; rows: { key: string; count: number }[]; max: number; empty?: string }) {
  return (
    <div className="rcard">
      <h3>{title}</h3>
      {rows.length === 0 && <div className="muted">{empty || 'No data'}</div>}
      {rows.map((x) => (
        <div key={x.key} className="bar">
          <span className="bl">{x.key}</span>
          <span className="bt">
            <span style={{ width: `${(x.count / max) * 100}%` }} />
          </span>
          <span className="bn">{x.count}</span>
        </div>
      ))}
    </div>
  );
}
