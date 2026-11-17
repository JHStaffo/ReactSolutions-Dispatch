import { useEffect, useState } from 'react';
import type { Call, Crew, Facility } from '../../../shared/types';
import { EQUIPMENT, TRIP_TYPES, ageFromDob } from '../../../shared/types';
import { api } from '../api';
import { addDays, fmtTime, startOfDay } from '../time';

/** Printable daily run sheet for one crew. Fetching it is audited as a PHI print. */
export function RunSheet({ crew, day, onClose }: { crew: Crew; day: Date; onClose: () => void }) {
  const [data, setData] = useState<{ trips: Call[]; facilities: Facility[] } | null>(null);
  useEffect(() => {
    const from = startOfDay(day);
    api<{ trips: Call[]; facilities: Facility[] }>('runsheet', { body: { crewId: crew.id, from: from.toISOString(), to: addDays(from, 1).toISOString() } }).then(setData);
  }, [crew.id, day]);
  const phone = (place: string) => data?.facilities.find((f) => f.name === place)?.phone;
  return (
    <div className="runsheet-wrap">
      <div className="runsheet-bar no-print">
        <button className="btn primary" onClick={() => window.print()} disabled={!data}>
          Print
        </button>
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
        <span className="muted small">Contains patient information. Collect printed sheets at end of shift for secure disposal.</span>
      </div>
      <div className="runsheet">
        <header>
          <div>
            <h1>
              {crew.unit} <small>({crew.level})</small>
            </h1>
            <div>
              {crew.vehicle} · {crew.phone} · Shift {crew.shiftStart}–{crew.shiftEnd}
            </div>
            <div>Crew: {crew.members.map((m) => `${m.name} (${m.cert})`).join(', ')}</div>
          </div>
          <div className="rs-date">{day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </header>
        {!data && <p>Loading…</p>}
        {data && data.trips.length === 0 && <p>No trips scheduled.</p>}
        {data?.trips.map((c, i) => (
          <section key={c.id} className="rs-trip">
            <div className="rs-head">
              <b>
                {i + 1}. {fmtTime(c.scheduledStart || c.pickupTime)} · {c.callNumber}
              </b>
              <span>
                {c.level} · {TRIP_TYPES[c.tripType]} · est. {c.durationMin} min{c.leg !== 'ONE_WAY' ? ` · ${c.leg.toLowerCase()} leg` : ''}
              </span>
            </div>
            <table>
              <tbody>
                <tr>
                  <th>Patient</th>
                  <td>
                    {c.patient.lastName}, {c.patient.firstName} · DOB {c.patient.dob} ({ageFromDob(c.patient.dob)}y) · {c.patient.weightLbs} lb
                  </td>
                </tr>
                <tr>
                  <th>Pickup</th>
                  <td>
                    {c.pickupLocation}
                    {phone(c.pickupLocation) ? ` · ${phone(c.pickupLocation)}` : ''}
                  </td>
                </tr>
                <tr>
                  <th>Destination</th>
                  <td>
                    {c.destination}
                    {phone(c.destination) ? ` · ${phone(c.destination)}` : ''}
                  </td>
                </tr>
                <tr>
                  <th>Complaint</th>
                  <td>{c.chiefComplaint}</td>
                </tr>
                <tr>
                  <th>Necessity</th>
                  <td>{c.stretcherReason}</td>
                </tr>
                <tr>
                  <th>Equipment</th>
                  <td>{c.equipment.length ? c.equipment.map((e) => EQUIPMENT[e]).join(', ') : 'None'}</td>
                </tr>
                <tr>
                  <th>Insurance</th>
                  <td>
                    {c.insurance.payer}
                    {c.insurance.priorAuth ? ` · Auth ${c.insurance.priorAuth}` : ''} · PCS {c.pcsOnFile ? 'on file' : 'NOT on file'}
                  </td>
                </tr>
                {c.notes && (
                  <tr>
                    <th>Notes</th>
                    <td>{c.notes}</td>
                  </tr>
                )}
                <tr>
                  <th>Times</th>
                  <td className="rs-times">Enroute ____ On scene ____ Transport ____ At dest ____ Clear ____ Loaded mi ____</td>
                </tr>
              </tbody>
            </table>
          </section>
        ))}
        <footer>CONFIDENTIAL: contains protected health information.</footer>
      </div>
    </div>
  );
}
