@extends('layouts.app')

{{-- Dispatch > Trip Map: trucks from their GPS units, facilities, and trips waiting for a truck. --}}
@section('bare')
<div class="tm-layout">
    <div id="tm-map" class="tm-map"></div>
    <aside class="tm-list">
        <strong>Trucks</strong> <span class="hint" id="tm-live">Connecting…</span>
        <ul id="tm-trucks"></ul>
        <p class="hint"><span class="pill pill-green">Free</span> <span class="pill" style="background:var(--blue);color:#fff">On a trip</span> <span class="pill" style="background:var(--gray);color:#fff">No recent GPS</span></p>
        <strong>Waiting for a truck</strong>
        <ul id="tm-queue"></ul>
    </aside>
</div>
@endsection

@push('scripts')
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
(function () {
    'use strict';
    var C = @json($constants), U = { data: @json(route('trips.data')), changes: @json(route('trips.changes')), login: @json(url('/login')) };
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function get(url) {
        return fetch(url, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' }).then(function (r) {
            if (r.status === 401 || r.status === 419) { location.href = U.login; throw { handled: true }; }
            if (!r.ok) throw new Error(r.status);
            return r.json();
        });
    }
    var state = { seq: 0, units: [], trips: {}, facilities: [], gps: [], active: true }, map, truckLayer, facLayer, queueLayer, markers = {};
    ['mousemove', 'keydown', 'click', 'touchstart', 'wheel'].forEach(function (ev) { document.addEventListener(ev, function () { state.active = true; }, { passive: true }); });

    function unitName(id) { var u = state.units.find(function (x) { return x.id === id; }); return u ? u.name : 'Truck ' + id; }
    function tripOn(vehicleId) {
        return Object.values(state.trips).find(function (t) { return t.vehicleId === vehicleId && C.active.indexOf(t.status) >= 0; });
    }
    function render() {
        facLayer.clearLayers();
        state.facilities.forEach(function (f) {
            if (f.lat == null) return;
            L.circleMarker([f.lat, f.lon], { radius: 5, color: '#0076a3', weight: 2, fillOpacity: .6 }).addTo(facLayer).bindTooltip(esc(f.name) + (f.phone ? '<br>' + esc(f.phone) : ''));
        });
        var rows = [], seen = {};
        state.gps.forEach(function (g) {
            if (!g.vehicleId) return;
            seen[g.vehicleId] = true;
            var t = tripOn(g.vehicleId), cls = g.stale ? 'tm-stale' : (t ? 'tm-busy' : 'tm-free'), name = unitName(g.vehicleId);
            var icon = L.divIcon({ className: 'tm-truck ' + cls, html: esc(name.split(' ').pop().slice(0, 4)) });
            var tip = '<strong>' + esc(name) + '</strong><br>' + (t ? esc(t.number) + ' · ' + esc(C.statuses[t.status]) + '<br>to ' + esc(t.destination) : 'Free') + '<br>' + Math.round(g.speedMph || 0) + ' mph · ' + new Date(g.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (g.stale ? ' (old)' : '');
            if (markers[g.vehicleId]) { markers[g.vehicleId].setLatLng([g.lat, g.lon]).setIcon(icon).setTooltipContent(tip); }
            else { markers[g.vehicleId] = L.marker([g.lat, g.lon], { icon: icon }).addTo(truckLayer).bindTooltip(tip); }
            rows.push({ id: g.vehicleId, name: name, cls: cls, line: t ? t.number + ' · ' + C.statuses[t.status] : (g.stale ? 'No recent GPS' : 'Free') });
        });
        state.units.forEach(function (u) { if (!seen[u.id]) rows.push({ id: u.id, name: u.name, cls: 'tm-off', line: u.outOfService ? 'Out of service' : 'No GPS' }); });
        rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
        $('tm-trucks').innerHTML = rows.map(function (r) { return '<li data-v="' + r.id + '"><span class="tm-dot ' + r.cls + '"></span> <strong>' + esc(r.name) + '</strong><br><span class="hint">' + esc(r.line) + '</span></li>'; }).join('') || '<li class="hint">No trucks today.</li>';

        queueLayer.clearLayers();
        var q = Object.values(state.trips).filter(function (t) { return t.status === 'queued'; });
        $('tm-queue').innerHTML = q.map(function (t) {
            var f = state.facilities.find(function (x) { return x.id === t.pickupFacilityId; });
            if (f && f.lat != null) L.circleMarker([f.lat, f.lon], { radius: 9, color: '#ed1c24', weight: 3, fill: false }).addTo(queueLayer).bindTooltip(esc(t.number) + ' waiting · ' + (t.pickupMode === 'asap' ? 'ASAP' : esc(C.levels[t.level] || t.level)));
            return '<li' + (f && f.lat != null ? ' data-ll="' + f.lat + ',' + f.lon + '"' : '') + '><strong>' + esc(t.number) + '</strong> ' + (t.pickupMode === 'asap' ? '<span class="pill pill-red">ASAP</span>' : '') + '<br><span class="hint">' + esc(t.pickupLocation) + '</span></li>';
        }).join('') || '<li class="hint">Nothing waiting.</li>';
    }
    $('tm-trucks').addEventListener('click', function (e) { var li = e.target.closest('[data-v]'); if (li && markers[li.dataset.v]) { map.setView(markers[li.dataset.v].getLatLng(), 14); markers[li.dataset.v].openTooltip(); } });
    $('tm-queue').addEventListener('click', function (e) { var li = e.target.closest('[data-ll]'); if (li) map.setView(li.dataset.ll.split(',').map(Number), 14); });

    function poll() {
        var active = state.active ? 1 : 0; state.active = false;
        get(U.changes + '?since=' + state.seq + '&active=' + active).then(function (r) {
            r.trips.forEach(function (t) { state.trips[t.id] = t; });
            state.seq = r.seq; state.gps = r.gps;
            $('tm-live').textContent = 'Live';
            if (r.facilities) return load();
            render();
        }).catch(function (e) { if (!e || !e.handled) $('tm-live').textContent = 'Reconnecting…'; })
          .then(function () { setTimeout(poll, 5000); });
    }
    function load() {
        return get(U.data).then(function (b) {
            state.seq = b.seq; state.units = b.units; state.facilities = b.facilities; state.gps = b.gps; state.trips = {};
            b.trips.forEach(function (t) { state.trips[t.id] = t; });
            if (!map) {
                map = L.map('tm-map').setView(b.settings.center, 12);
                L.tileLayer(b.settings.tileUrl, { attribution: b.settings.attribution, maxZoom: 19 }).addTo(map);
                facLayer = L.layerGroup().addTo(map); queueLayer = L.layerGroup().addTo(map); truckLayer = L.layerGroup().addTo(map);
            }
            render();
        });
    }
    if (!window.L) { $('tm-map').textContent = 'The map library did not load. Check the internet connection.'; return; }
    load().then(function () { setTimeout(poll, 3000); });
})();
</script>
@endpush
