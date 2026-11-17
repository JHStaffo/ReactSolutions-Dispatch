import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallStatus, CallSummary, Crew, SessionUser } from '../../../shared/types';
import { ACTIVE_STATUSES, EQUIPMENT, STATUSES, STATUS_FLOW, TRIP_TYPES } from '../../../shared/types';
import { ApiError, api, wsUrl } from '../api';
import { fmtDateTime, fmtTime } from '../time';

type CrewTrip = CallSummary & {
  patientName: string;
  chiefComplaint: string;
  stretcherReason: string;
  notes: string;
  pickupPhone: string;
  destinationPhone: string;
};

const NEXT_LABEL: Partial<Record<CallStatus, string>> = {
  ASSIGNED: 'En route',
  ENROUTE: 'On scene',
  ON_SCENE: 'Patient loaded / transporting',
  TRANSPORTING: 'At destination',
  AT_DESTINATION: 'Clear (trip complete)',
};

/** Phone-sized screen for crews: today's trips and one-tap status updates. */
export function CrewApp({ user, onSignOut, onExpired }: { user: SessionUser; onSignOut: () => void; onExpired: () => void }) {
  const [crew, setCrew] = useState<Crew | null>(null);
  const [trips, setTrips] = useState<CrewTrip[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [live, setLive] = useState(false);
  const watch = useRef<number | null>(null);
  const lastSent = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api<{ crew: Crew; trips: CrewTrip[] }>('crew/my-trips');
      setCrew(r.crew);
      setTrips(r.trips);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load trips');
    }
  }, []);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 60_000);
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => setLive(true);
      ws.onmessage = (m) => {
        try {
          if (JSON.parse(m.data).type === 'crew-refresh') load();
        } catch {
          /* ignore */
        }
      };
      ws.onclose = (ev) => {
        setLive(false);
        if (closed) return;
        if (ev.code === 4401) return onExpired();
        retry = window.setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearInterval(poll);
      window.clearTimeout(retry);
      ws?.close();
    };
  }, [load]);

  useEffect(
    () => () => {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );

  const toggleSharing = () => {
    if (sharing) {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
      setSharing(false);
      return;
    }
    if (!('geolocation' in navigator)) return setError('This device cannot share its location.');
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastSent.current < 10_000) return;
        lastSent.current = Date.now();
        api('crew/location', {
          body: {
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            speedMph: p.coords.speed != null ? p.coords.speed * 2.23694 : null,
            heading: p.coords.heading,
          },
        }).catch(() => {});
      },
      () => setError('Location permission was denied.'),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    setSharing(true);
  };

  const advance = async (t: CrewTrip) => {
    const idx = STATUS_FLOW.indexOf(t.status);
    const next = STATUS_FLOW[idx + 1];
    if (!next) return;
    setBusy(true);
    try {
      await api(`calls/${t.id}/status`, { body: { status: next, expectedVersion: t.version } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const open = trips.filter((t) => t.status !== 'COMPLETED');
  const current = open.find((t) => ACTIVE_STATUSES.includes(t.status)) ?? open[0];
  const rest = trips.filter((t) => t !== current);

  return (
    <div className="crewapp">
      <header className="crew-top">
        <div>
          <b>{crew?.unit ?? user.displayName}</b> {crew && <span className={`lvl ${crew.level.toLowerCase()}`}>{crew.level}</span>}
          <div className="muted small">
            {crew?.vehicle} · <span className={live ? 'ok-text' : 'warn-text'}>{live ? 'Live' : 'Reconnecting'}</span>
          </div>
        </div>
        <button className="btn ghost small" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      {error && <div className="banner error">{error}</div>}
      <button className={`btn share ${sharing ? 'on' : ''}`} onClick={toggleSharing}>
        📍 {sharing ? 'Sharing location with dispatch (tap to stop)' : 'Share phone location (if truck GPS is down)'}
      </button>

      {current ? (
        <section className="crew-current">
          <div className="cc-head">
            <span className="muted">{ACTIVE_STATUSES.includes(current.status) ? 'Current trip' : 'Next trip'}</span>
            <span className={`status-pill st-${current.status.toLowerCase()}`}>{STATUSES[current.status]}</span>
          </div>
          <h2>
            {fmtTime(current.scheduledStart || current.pickupTime)} · {current.callNumber}
          </h2>
          <div className="cc-pt">
            {current.patientName} · {current.age}y · {current.weightLbs} lb
          </div>
          <div className="cc-meta">
            <span className={`lvl ${current.level.toLowerCase()}`}>{current.level}</span> {TRIP_TYPES[current.tripType]}
          </div>
          <Place label="Pickup" name={current.pickupLocation} phone={current.pickupPhone} />
          <Place label="Destination" name={current.destination} phone={current.destinationPhone} />
          <dl>
            <dt>Complaint</dt>
            <dd>{current.chiefComplaint}</dd>
            <dt>Necessity</dt>
            <dd>{current.stretcherReason}</dd>
            <dt>Equipment</dt>
            <dd>{current.equipment.length ? current.equipment.map((e) => EQUIPMENT[e]).join(', ') : 'None'}</dd>
            {current.notes && (
              <>
                <dt>Notes</dt>
                <dd>{current.notes}</dd>
              </>
            )}
            {current.alerts.length > 0 && (
              <>
                <dt>Paperwork</dt>
                <dd className="warn-text">{current.alerts.join(', ')}</dd>
              </>
            )}
          </dl>
          {NEXT_LABEL[current.status] && (
            <button className="btn primary big" disabled={busy} onClick={() => advance(current)}>
              {NEXT_LABEL[current.status]}
            </button>
          )}
          <div className="cc-times muted small">
            {(Object.keys(STATUSES) as CallStatus[])
              .filter((k) => current.statusTimes[k] && k !== 'QUEUED')
              .map((k) => `${STATUSES[k]} ${fmtTime(current.statusTimes[k])}`)
              .join(' · ')}
          </div>
        </section>
      ) : (
        <div className="empty big">No trips assigned right now.</div>
      )}

      {rest.length > 0 && (
        <section className="crew-list">
          <h3>Recent &amp; upcoming</h3>
          {rest.map((t) => (
            <div key={t.id} className={`crew-row ${t.status === 'COMPLETED' ? 'done' : ''}`}>
              <div>
                <b>{fmtDateTime(t.scheduledStart || t.pickupTime)}</b> · {t.callNumber} <span className={`lvl ${t.level.toLowerCase()}`}>{t.level}</span>
              </div>
              <div className="small">
                {t.patientName} · {t.pickupLocation} → {t.destination}
              </div>
              <div className="muted small">{STATUSES[t.status]}</div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Place({ label, name, phone }: { label: string; name: string; phone: string }) {
  return (
    <div className="cc-place">
      <span className="muted small">{label}</span>
      <div>
        <b>{name}</b>
      </div>
      {phone && (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="small">
          Call {phone}
        </a>
      )}
    </div>
  );
}
