@extends('layouts.app')

{{-- Dispatch > My Trips: the crew's MDT for the truck Vehicle Assignments has them on. --}}
@section('bare')
<div class="mytrips-app" id="mytrips">
    <div class="card"><p class="hint">Loading your trips…</p></div>
</div>
<script>
(function () {
    'use strict';
    var C = @json($constants), csrf = @json(csrf_token());
    var U = { data: @json(route('trips.crew.data')), base: @json(url('/trips/crew')), location: @json(route('trips.crew.location')), unitStatus: @json(route('trips.crew.unit-status')), login: @json(url('/login')) };
    var root = document.getElementById('mytrips'), state = { trips: [], trucks: [], active: true, opened: false, sharing: false, watch: null, lastSent: 0, editing: false, msg: '' };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function hm(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }
    function api(method, url, body) {
        return fetch(url, { method: method, credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf, 'X-Requested-With': 'XMLHttpRequest' }, body: body ? JSON.stringify(body) : undefined })
            .then(function (r) {
                if (r.status === 401 || r.status === 419) { location.href = U.login; throw { handled: true }; }
                return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { j.status = r.status; throw j; } return j; });
            });
    }
    ['touchstart', 'click', 'keydown', 'scroll'].forEach(function (ev) { document.addEventListener(ev, function () { state.active = true; }, { passive: true }); });
    // Don't redraw while someone is typing in a box.
    root.addEventListener('focusin', function (e) { if (e.target.matches('input, textarea')) state.editing = true; });
    root.addEventListener('focusout', function () { state.editing = false; });

    function tel(n) { return n ? ' <a href="tel:' + esc(n.replace(/[^0-9+]/g, '')) + '">' + esc(n) + '</a>' : ''; }
    function dir(place) { return '<a class="btn btn-small btn-outline" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(place || '') + '">Directions</a>'; }
    function current() {
        var open = state.trips.filter(function (t) { return t.status !== 'completed' && t.status !== 'cancelled'; });
        return open.find(function (t) { return C.active.indexOf(t.status) >= 0; }) || open[0];
    }
    function render() {
        var html = '';
        if (!state.trucks.length) {
            root.innerHTML = '<div class="card"><h2>No truck right now</h2><p>Vehicle Assignments doesn\'t have you on a truck in the next 12 hours. Ask dispatch if that\'s wrong.</p></div>';
            return;
        }
        state.trucks.forEach(function (u) {
            html += '<div class="card"><strong>' + esc(u.name) + (u.levelLabel ? ' · ' + esc(u.levelLabel) : '') + '</strong>'
                + '<div class="mytrips-units">' + Object.keys(C.unitStatuses).map(function (k) {
                    return '<button type="button" class="btn btn-small' + (u.unitStatus === k ? '' : ' btn-outline') + '" data-unit="' + u.id + '" data-unit-status="' + k + '">' + esc(C.unitStatuses[k]) + '</button>';
                }).join('') + '</div></div>';
        });
        html += '<div class="card"><button type="button" class="btn btn-outline mytrips-share' + (state.sharing ? ' on' : '') + '" id="mt-share">' + (state.sharing ? 'Sharing this phone\'s location' : 'Share this phone\'s location (if the truck GPS is down)') + '</button></div>';
        var t = current();
        if (t) {
            var i = C.flow.indexOf(t.status), next = i >= 0 ? C.flow[i + 1] : null;
            var times = C.flow.filter(function (k) { return t.statusTimes && t.statusTimes[k]; }).map(function (k) { return '<span>' + esc(C.statuses[k]) + ' ' + hm(t.statusTimes[k]) + '</span>'; }).join('');
            html += '<div class="card"><div class="hint">' + esc(t.number) + ' · ' + esc(C.levels[t.level] || t.level) + ' · ' + esc(C.types[t.tripType] || t.tripType) + (t.leg && t.leg !== 'one_way' ? ' · ' + esc(t.leg) + ' leg' : '') + (t.priority && t.priority !== 'routine' ? ' · <b class="trip-red">' + esc(C.priorities[t.priority]) + '</b>' : '') + '</div>'
                + '<h2 style="margin:4px 0">' + esc(t.patientName) + (t.age != null ? ' <span class="hint">' + t.age + 'y' + (t.weightLbs ? ', ' + t.weightLbs + ' lb' : '') + '</span>' : '') + '</h2>'
                + (t.dnr ? '<div class="pill pill-red">DNR</div> ' : '')
                + '<span class="pill pill-teal">' + esc(C.statuses[t.status]) + '</span> '
                + (t.pickupMode === 'scheduled' && t.pickupTime ? 'Pickup at ' + hm(t.pickupTime) : t.quotedTime ? 'ASAP, quoted by ' + hm(t.quotedTime) : t.scheduledStart ? 'Planned ' + hm(t.scheduledStart) : '')
                + (times ? '<div class="mytrips-times">' + times + '</div>' : '')
                + '<div class="mytrips-place"><span class="hint">Pick up</span><br><strong>' + esc(t.pickupLocation) + '</strong>' + (t.pickupDepartment || t.pickupRoom ? '<br>' + esc([t.pickupDepartment, t.pickupRoom ? 'Room ' + t.pickupRoom : ''].filter(Boolean).join(' · ')) : '') + tel(t.pickupPhone) + '<br>' + dir(t.pickupLocation) + '</div>'
                + '<div class="mytrips-place"><span class="hint">Take to</span><br><strong>' + esc(t.destination) + '</strong>' + (t.dropoffDepartment || t.dropoffRoom ? '<br>' + esc([t.dropoffDepartment, t.dropoffRoom ? 'Room ' + t.dropoffRoom : ''].filter(Boolean).join(' · ')) : '') + tel(t.destinationPhone) + (t.estMiles ? ' <span class="hint">about ' + t.estMiles + ' mi</span>' : '') + '<br>' + dir(t.destination) + '</div>'
                + (t.chiefComplaint ? '<p><strong>Complaint:</strong> ' + esc(t.chiefComplaint) + '</p>' : '')
                + ((t.diagnoses || []).length ? '<p><strong>Diagnoses:</strong> ' + t.diagnoses.map(function (x) { return esc(x.code) + (x.description ? ' ' + esc(x.description) : ''); }).join('; ') + '</p>' : '')
                + (t.stretcherReason ? '<p><strong>Stretcher:</strong> ' + esc(t.stretcherReason) + '</p>' : '')
                + ((t.equipment || []).length ? '<p><strong>Equipment:</strong> ' + t.equipment.map(function (e) { return esc(C.equipment[e] || e) + (e === 'oxygen' && t.oxygenLpm ? ' ' + t.oxygenLpm + ' LPM' : ''); }).join(', ') + '</p>' : '')
                + (t.stairs || t.riders || t.waitAndReturn ? '<p>' + [t.stairs ? t.stairs + ' flights of stairs' : '', t.riders ? t.riders + ' riding along' : '', t.waitAndReturn ? 'Wait and bring the patient back' : ''].filter(Boolean).join(' · ') + '</p>' : '')
                + (t.patientNotes && t.patientNotes.baseline ? '<p><strong>Baseline:</strong> ' + esc(t.patientNotes.baseline) + '</p>' : '')
                + (t.patientNotes && t.patientNotes.dispatch ? '<p><strong>Patient notes:</strong> ' + esc(t.patientNotes.dispatch) + '</p>' : '')
                + ((t.alerts || []).length ? '<p>' + t.alerts.map(function (a) { return '<span class="pill pill-amber">' + esc(a) + '</span>'; }).join(' ') + '</p>' : '')
                + (t.notes ? '<p><strong>Dispatch notes:</strong> ' + esc(t.notes) + '</p>' : '')
                + (next ? '<button type="button" class="btn mytrips-next" data-next="' + t.id + '">' + esc(C.statuses[next]) + '</button>' : '')
                + '<p class="hint" id="mt-msg">' + esc(state.msg) + '</p>'
                + '<form class="mytrips-form" data-trip="' + t.id + '">'
                + '<div class="field-row"><div class="field"><label>Odometer at pickup</label><input type="number" inputmode="decimal" step="0.1" min="0" name="odometer_pickup" value="' + (t.odometerPickup == null ? '' : t.odometerPickup) + '"></div>'
                + '<div class="field"><label>Odometer at destination</label><input type="number" inputmode="decimal" step="0.1" min="0" name="odometer_destination" value="' + (t.odometerDestination == null ? '' : t.odometerDestination) + '"></div></div>'
                + '<div class="field"><label>Note to dispatch</label><textarea name="crew_notes" rows="2" maxlength="1000" placeholder="Patient not ready, extra help needed…">' + esc(t.crewNotes || '') + '</textarea></div>'
                + '<button type="submit" class="btn btn-outline">Send to dispatch</button></form>'
                + '</div>';
        } else {
            html += '<div class="card"><h2>No open trips</h2><p class="hint">New trips show up here when dispatch assigns them.</p></div>';
        }
        html += '<div class="card"><strong>Today</strong>' + (state.trips.map(function (x) {
            var done = x.status === 'completed' || x.status === 'cancelled';
            return '<div class="mytrips-row' + (done ? ' done' : '') + '">' + hm(x.scheduledStart) + ' · ' + esc(x.number) + ' · ' + esc(C.statuses[x.status]) + '<br>' + esc(x.pickupLocation) + ' → ' + esc(x.destination) + '</div>';
        }).join('') || '<p class="hint">Nothing assigned.</p>') + '</div>';
        root.innerHTML = html;
    }
    function replace(trip) { state.trips = state.trips.map(function (x) { return x.id === trip.id ? trip : x; }); }
    function failed(err) {
        if (err && err.handled) return;
        state.msg = err && err.status === 409 ? 'Dispatch just changed this trip. It has been reloaded.' : ((err && err.message) || 'That didn\'t save. Try again.');
        load();
    }
    root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-next]');
        if (b) {
            var t = state.trips.find(function (x) { return x.id === +b.dataset.next; });
            b.disabled = true;
            api('POST', U.base + '/' + t.id + '/next', { expected_version: t.version }).then(function (r) { state.msg = ''; replace(r.trip); render(); }).catch(failed);
        }
        var u = e.target.closest('[data-unit-status]');
        if (u) {
            api('POST', U.unitStatus, { vehicle_id: +u.dataset.unit, status: u.dataset.unitStatus }).then(load).catch(failed);
        }
        if (e.target.id === 'mt-share') toggleShare();
    });
    root.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, t = state.trips.find(function (x) { return x.id === +f.dataset.trip; });
        var num = function (n) { return f.elements[n].value === '' ? null : +f.elements[n].value; };
        api('POST', U.base + '/' + t.id + '/details', { expected_version: t.version, odometer_pickup: num('odometer_pickup'), odometer_destination: num('odometer_destination'), crew_notes: f.elements.crew_notes.value })
            .then(function (r) { state.editing = false; state.msg = 'Sent to dispatch.'; replace(r.trip); render(); }).catch(failed);
    });
    function toggleShare() {
        if (state.sharing) { navigator.geolocation.clearWatch(state.watch); state.sharing = false; render(); return; }
        if (!navigator.geolocation) { state.msg = 'This phone can\'t share its location.'; render(); return; }
        state.sharing = true; render();
        state.watch = navigator.geolocation.watchPosition(function (p) {
            if (Date.now() - state.lastSent < 20000) return;
            state.lastSent = Date.now();
            api('POST', U.location, { lat: p.coords.latitude, lon: p.coords.longitude, speed_mph: p.coords.speed ? p.coords.speed * 2.23694 : 0, heading: p.coords.heading || 0 }).catch(function () {});
        }, function () { state.sharing = false; render(); }, { enableHighAccuracy: true, maximumAge: 15000 });
    }
    function load() {
        var q = '?active=' + (state.active ? 1 : 0) + (state.opened ? '' : '&opened=1');
        state.active = false;
        return api('GET', U.data + q).then(function (r) {
            state.opened = true; state.trips = r.trips; state.trucks = r.trucks;
            if (!state.editing) render();
        });
    }
    function loop() { load().catch(function () {}).then(function () { setTimeout(loop, 10000); }); }
    loop();
})();
</script>
@endsection
