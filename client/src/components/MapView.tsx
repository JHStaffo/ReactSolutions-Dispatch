import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CallSummary, Crew } from '../../../shared/types';
import { ACTIVE_STATUSES, STATUSES } from '../../../shared/types';
import type { Board } from '../App';
import { fmtTime } from '../time';
import { gpsLabel } from './Scheduler';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function currentTrip(crew: Crew, calls: CallSummary[]) {
  const mine = calls.filter((c) => c.crewId === crew.id);
  const active = mine.find((c) => ACTIVE_STATUSES.includes(c.status));
  if (active) return active;
  const now = Date.now();
  return mine
    .filter((c) => c.status === 'ASSIGNED' && c.scheduledStart && Date.parse(c.scheduledStart) > now - 3600_000)
    .sort((a, b) => a.scheduledStart!.localeCompare(b.scheduledStart!))[0];
}

/** Live map of every truck, fed by the trucks' GPS units. */
export function MapView({ board, onOpenCall }: { board: Board; onOpenCall: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ trucks: Map<string, L.Marker>; lines: L.LayerGroup; facilities: L.LayerGroup } | null>(null);
  const [follow, setFollow] = useState<string | null>(null);
  const [showFacilities, setShowFacilities] = useState(true);
  const crews = board.crews.filter((c) => c.active);
  const calls = useMemo(() => Object.values(board.calls), [board.calls]);
  const now = Date.now();

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView(board.map.center, board.map.zoom);
    L.tileLayer(board.map.tileUrl, { attribution: board.map.attribution, maxZoom: 19 }).addTo(m);
    map.current = m;
    layers.current = { trucks: new Map(), lines: L.layerGroup().addTo(m), facilities: L.layerGroup().addTo(m) };
    const onOpen = (e: Event) => onOpenCall((e as CustomEvent).detail);
    el.current.addEventListener('opencall', onOpen);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Facilities
  useEffect(() => {
    const ly = layers.current;
    if (!ly) return;
    ly.facilities.clearLayers();
    if (!showFacilities) return;
    for (const f of board.facilities) {
      if (f.lat == null || f.lon == null) continue;
      L.marker([f.lat, f.lon], {
        icon: L.divIcon({ className: 'fac-icon', html: `<span>${f.kind === 'Hospital' ? 'H' : f.kind === 'Dialysis' ? 'D' : f.kind === 'SNF' ? 'N' : '+'}</span>`, iconSize: [18, 18] }),
        zIndexOffset: -100,
      })
        .bindTooltip(`${esc(f.name)}<br><small>${esc(f.address)}</small>`)
        .addTo(ly.facilities);
    }
  }, [board.facilities, showFacilities]);

  // Trucks and their current-trip lines
  useEffect(() => {
    const ly = layers.current;
    const m = map.current;
    if (!ly || !m) return;
    ly.lines.clearLayers();
    const seen = new Set<string>();
    for (const crew of crews) {
      const pos = crew.gpsDeviceId ? board.gps[crew.gpsDeviceId] : undefined;
      if (!pos) continue;
      seen.add(crew.id);
      const trip = currentTrip(crew, calls);
      const g = gpsLabel(pos, board.gpsStaleMinutes, now);
      const cls = `truck-icon ${crew.level.toLowerCase()} ${g.stale ? 'stale' : ''} ${crew.outOfService ? 'oos' : ''} ${trip && ACTIVE_STATUSES.includes(trip.status) ? 'busy' : ''}`;
      const icon = L.divIcon({
        className: cls,
        html: `<div class="ti-arrow" style="transform:rotate(${pos.heading}deg)"></div><div class="ti-label">${esc(crew.unit)}</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const popup = `<b>${esc(crew.unit)}</b> (${crew.level}) · ${esc(crew.vehicle)}<br>${esc(g.text)}${crew.outOfService ? '<br><b>Out of service</b>' : ''}${
        trip
          ? `<br>${esc(trip.callNumber)}: ${esc(STATUSES[trip.status])} ${trip.scheduledStart ? fmtTime(trip.scheduledStart) : ''}<br><button class="popup-open" data-id="${trip.id}">Open trip</button>`
          : '<br>No current trip'
      }`;
      let mk = ly.trucks.get(crew.id);
      if (!mk) {
        mk = L.marker([pos.lat, pos.lon], { icon }).addTo(m);
        mk.on('popupopen', (e) => {
          const btn = (e.popup.getElement() as HTMLElement | undefined)?.querySelector('.popup-open') as HTMLButtonElement | null;
          btn?.addEventListener('click', () => el.current?.dispatchEvent(new CustomEvent('opencall', { detail: btn.dataset.id })));
        });
        ly.trucks.set(crew.id, mk);
      } else {
        mk.setLatLng([pos.lat, pos.lon]);
        mk.setIcon(icon);
      }
      mk.bindPopup(popup);
      // Line to where the truck is heading.
      if (trip && (trip.status === 'ENROUTE' || trip.status === 'TRANSPORTING')) {
        const target = board.facilities.find((f) => f.name === (trip.status === 'ENROUTE' ? trip.pickupLocation : trip.destination));
        if (target?.lat != null && target.lon != null)
          L.polyline(
            [
              [pos.lat, pos.lon],
              [target.lat, target.lon!],
            ],
            { color: trip.status === 'ENROUTE' ? '#f5a524' : '#30a46c', dashArray: '6 6', weight: 3 },
          ).addTo(ly.lines);
      }
    }
    for (const [id, mk] of ly.trucks) if (!seen.has(id)) (mk.remove(), ly.trucks.delete(id));
    if (follow) {
      const crew = crews.find((c) => c.id === follow);
      const pos = crew?.gpsDeviceId ? board.gps[crew.gpsDeviceId] : undefined;
      if (pos) m.panTo([pos.lat, pos.lon], { animate: true });
    }
  }, [board.gps, crews, calls, board.facilities, follow]);

  const fitAll = () => {
    const pts = crews.map((c) => (c.gpsDeviceId ? board.gps[c.gpsDeviceId] : undefined)).filter(Boolean) as { lat: number; lon: number }[];
    if (pts.length && map.current) map.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [40, 40] });
  };

  return (
    <div className="mapview">
      <aside className="unitlist">
        <div className="unitlist-head">
          <h2>Units</h2>
          <button className="btn small ghost" onClick={fitAll}>
            Show all
          </button>
          <label className="check small">
            <input type="checkbox" checked={showFacilities} onChange={(e) => setShowFacilities(e.target.checked)} /> Facilities
          </label>
        </div>
        {crews.map((crew) => {
          const pos = crew.gpsDeviceId ? board.gps[crew.gpsDeviceId] : undefined;
          const g = gpsLabel(pos, board.gpsStaleMinutes, now);
          const trip = currentTrip(crew, calls);
          return (
            <button
              key={crew.id}
              className={`unitrow ${follow === crew.id ? 'on' : ''}`}
              onClick={() => {
                setFollow(follow === crew.id ? null : crew.id);
                if (pos && map.current) map.current.setView([pos.lat, pos.lon], 15);
                layers.current?.trucks.get(crew.id)?.openPopup();
              }}
            >
              <div className="ur-top">
                <b>{crew.unit}</b> <span className={`lvl ${crew.level.toLowerCase()}`}>{crew.level}</span>
                {crew.outOfService && <span className="oos-tag">OOS</span>}
                <span className={`ur-gps ${g.stale ? 'stale' : ''}`}>{g.text}</span>
              </div>
              <div className="ur-trip muted">
                {trip ? `${trip.callNumber} · ${STATUSES[trip.status]}${trip.status === 'ASSIGNED' ? ` ${fmtTime(trip.scheduledStart)}` : ''}` : 'Available'}
              </div>
            </button>
          );
        })}
        <p className="muted small pad">Click a unit to follow it. Positions come from each truck's GPS unit; grey means no fix in the last {board.gpsStaleMinutes} minutes.</p>
      </aside>
      <div className="map" ref={el} />
    </div>
  );
}
