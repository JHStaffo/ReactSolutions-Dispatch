@extends('layouts.app')

{{-- Dispatch > My Trips: the crew's phone screen for the truck Vehicle Assignments has them on. --}}
@section('bare')
<div class="mytrips-app" id="mytrips">
    <div class="card"><p class="hint">Loading your trips…</p></div>
</div>
<script>
(function () {
    'use strict';
    var C = @json($constants), csrf = @json(csrf_token());
    var U = { data: @json(route('trips.crew.data')), base: @json(url('/trips/crew')), location: @json(route('trips.crew.location')), login: @json(url('/login')) };
    var root = document.getElementById('mytrips'), state = { trips: [], trucks: [], active: true, opened: false, sharing: false, watch: null, lastSent: 0 };
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

    function tel(n) { return n ? ' <a href="tel:' + esc(n.replace(/[^0-9+]/g, '')) + '">' + esc(n) + '</a>' : ''; }
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
        html += '<div class="card"><strong>' + state.trucks.map(function (u) { return esc(u.name) + (u.levelLabel ? ' · ' + esc(u.levelLabel) : ''); }).join(', ') + '</strong>'
            + '<button type="button" class="btn btn-outline mytrips-share' + (state.sharing ? ' on' : '') + '" id="mt-share" style="margin-top:8px">' + (state.sharing ? 'Sharing this phone\'s location' : 'Share this phone\'s location (if the truck GPS is down)') + '</button></div>';
        var t = current();
        if (t) {
            var i = C.flow.indexOf(t.status), next = i >= 0 ? C.flow[i + 1] : null;
            html += '<div class="card"><div class="hint">' + esc(t.number) + ' · ' + esc(C.levels[t.level] || t.level) + ' · ' + esc(C.types[t.tripType] || t.tripType) + (t.leg && t.leg !== 'one_way' ? ' · ' + esc(t.leg) + ' leg' : '') + '</div>'
                + '<h2 style="margin:4px 0">' + esc(t.patientName) + (t.age != null ? ' <span class="hint">' + t.age + 'y' + (t.weightLbs ? ', ' + t.weightLbs + ' lb' : '') + '</span>' : '') + '</h2>'
                + '<div><span class="pill pill-teal">' + esc(C.statuses[t.status]) + '</span> ' + (t.scheduledStart ? 'Pickup ' + hm(t.pickupTime || t.scheduledStart) : '') + '</div>'
                + '<div class="mytrips-place"><span class="hint">Pick up</span><br><strong>' + esc(t.pickupLocation) + '</strong>' + tel(t.pickupPhone) + '<br><a target="_blank" rel="noopener" href="https://maps.google.com/?q=' + encodeURIComponent(t.pickupLocation || '') + '">Directions</a></div>'
                + '<div class="mytrips-place"><span class="hint">Take to</span><br><strong>' + esc(t.destination) + '</strong>' + tel(t.destinationPhone) + '<br><a target="_blank" rel="noopener" href="https://maps.google.com/?q=' + encodeURIComponent(t.destination || '') + '">Directions</a></div>'
                + (t.chiefComplaint ? '<p><strong>Complaint:</strong> ' + esc(t.chiefComplaint) + '</p>' : '')
                + (t.stretcherReason ? '<p><strong>Stretcher:</strong> ' + esc(t.stretcherReason) + '</p>' : '')
                + ((t.equipment || []).length ? '<p><strong>Equipment:</strong> ' + t.equipment.map(function (e) { return esc(C.equipment[e] || e); }).join(', ') + '</p>' : '')
                + ((t.alerts || []).length ? '<p>' + t.alerts.map(function (a) { return '<span class="pill pill-amber">' + esc(a) + '</span>'; }).join(' ') + '</p>' : '')
                + (t.notes ? '<p><strong>Notes:</strong> ' + esc(t.notes) + '</p>' : '')
                + (next ? '<button type="button" class="btn mytrips-next" data-next="' + t.id + '">' + esc(C.statuses[next]) + '</button>' : '')
                + '<p class="hint" id="mt-error"></p></div>';
        } else {
            html += '<div class="card"><h2>No open trips</h2><p class="hint">New trips show up here when dispatch assigns them.</p></div>';
        }
        html += '<div class="card"><strong>Today</strong>' + (state.trips.map(function (x) {
            var done = x.status === 'completed' || x.status === 'cancelled';
            return '<div class="mytrips-row' + (done ? ' done' : '') + '">' + hm(x.scheduledStart) + ' · ' + esc(x.number) + ' · ' + esc(C.statuses[x.status]) + '<br>' + esc(x.pickupLocation) + ' → ' + esc(x.destination) + '</div>';
        }).join('') || '<p class="hint">Nothing assigned.</p>') + '</div>';
        root.innerHTML = html;
    }
    root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-next]');
        if (b) {
            var t = state.trips.find(function (x) { return x.id === +b.dataset.next; });
            b.disabled = true;
            api('POST', U.base + '/' + t.id + '/next', { expected_version: t.version }).then(function (r) {
                state.trips = state.trips.map(function (x) { return x.id === r.trip.id ? r.trip : x; });
                render();
            }).catch(function (err) {
                if (err && err.handled) return;
                var msg = err.status === 409 ? 'Dispatch just changed this trip. It has been reloaded.' : (err.message || 'That didn\'t save. Try again.');
                load().then(function () { var el = document.getElementById('mt-error'); if (el) el.textContent = msg; });
            });
        }
        if (e.target.id === 'mt-share') toggleShare();
    });
    function toggleShare() {
        if (state.sharing) { navigator.geolocation.clearWatch(state.watch); state.sharing = false; render(); return; }
        if (!navigator.geolocation) { alert('This phone can\'t share its location.'); return; }
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
        return api('GET', U.data + q).then(function (r) { state.opened = true; state.trips = r.trips; state.trucks = r.trucks; render(); });
    }
    function loop() { load().catch(function () {}).then(function () { setTimeout(loop, 10000); }); }
    loop();
})();
</script>
@endsection
