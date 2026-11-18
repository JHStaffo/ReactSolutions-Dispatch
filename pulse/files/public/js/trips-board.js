/*
 * Dispatch > Trip Board. Plain JavaScript (no build step): draws the unassigned queue and the day's
 * timeline from window.TRIPS, keeps it live by asking /trips/changes every few seconds, and sends
 * every change with the version the dispatcher was looking at, so two dispatchers never overwrite
 * each other. Patient details are only fetched when a trip is opened (and that's audited).
 */
(function () {
    'use strict';
    var T = window.TRIPS, B = T.boot, C = B.constants;
    var SLOT = 15, PX = 14, COL = 200; // 15-minute rows, 14px each; 200px truck columns
    var state = {
        day: B.day, seq: B.seq, units: B.units, allTrucks: B.allTrucks, trips: {}, facilities: B.facilities,
        gps: B.gps, online: B.online, extraCols: [], tab: 'all', filter: '', open: null, polling: false,
        lastActivity: Date.now(), activeSincePoll: true, alerted: {}, failures: 0,
    };
    B.trips.forEach(function (t) { state.trips[t.id] = t; });
    var can = B.can, S = B.settings;
    var $ = function (id) { return document.getElementById(id); };

    // ------------------------------------------------------------------ helpers
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function d(iso) { return iso ? new Date(iso) : null; }
    function hm(date) { return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }
    function ymd(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
    function localIso(date) { return ymd(date) + 'T' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'); }
    function dayStart() { var p = state.day.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
    function minsAgo(iso) { return Math.round((Date.now() - new Date(iso).getTime()) / 60000); }
    function level(k) { return C.levels[k] || (k || '').toUpperCase(); }
    function isAls(k) { return C.alsLevels.indexOf(k) >= 0; }
    function start(t) { return d(t.scheduledStart || t.pickupTime); }
    function unitName(id) { var u = state.units.concat(state.allTrucks).find(function (x) { return x.id === id; }); return u ? u.name : 'Truck'; }
    function tripLabel(t) { return t.number + ' ' + t.patientName; }

    function toast(text, kind) {
        var el = document.createElement('div');
        el.className = 'trip-toast' + (kind ? ' trip-toast-' + kind : '');
        el.textContent = text;
        $('trip-toasts').appendChild(el);
        setTimeout(function () { el.remove(); }, kind === 'error' ? 8000 : 5000);
    }

    function api(method, url, body) {
        return fetch(url, {
            method: method, credentials: 'same-origin',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': T.csrf, 'X-Requested-With': 'XMLHttpRequest' },
            body: body ? JSON.stringify(body) : undefined,
        }).then(function (res) {
            return res.text().then(function (text) {
                var data = null;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
                if (res.status === 401 || res.status === 419) { signedOut(data && data.message); throw { handled: true }; }
                if (!res.ok) { throw { status: res.status, data: data || {} }; }
                return data;
            });
        });
    }

    function failed(err, fallback) {
        if (err && err.handled) return;
        var data = (err && err.data) || {};
        if (err && err.status === 409 && data.trip) { upsert(data.trip); render(); toast(data.message, 'warn'); return; }
        var msg = data.message || fallback || 'That didn\'t work.';
        if (data.errors) msg = Object.keys(data.errors).map(function (k) { return data.errors[k][0]; }).join(' ');
        toast(msg, 'error');
    }

    function signedOut(message) {
        document.body.innerHTML = '<main><div class="card"><h1>Signed out</h1><p>' + esc(message || 'Your sign-in ended.') + '</p><p><a class="btn" href="' + T.urls.login + '">Sign in again</a></p></div></main>';
        state.polling = false;
    }

    function upsert(t) { state.trips[t.id] = t; }

    // ------------------------------------------------------------------ what's on the board
    function onBoardDay(t) {
        var s = start(t);
        if (t.status === 'queued') return true;
        return s && sameDay(s, dayStart());
    }

    function matches(t) {
        if (!state.filter) return true;
        var hay = [t.number, t.patientName, t.pickupLocation, t.destination, C.types[t.tripType]].join(' ').toLowerCase();
        return state.filter.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
    }

    // Scheduled: past the pickup time plus the late minutes. ASAP: past the time quoted to the caller.
    function isLate(t, now) {
        if (['queued', 'assigned'].indexOf(t.status) < 0) return false;
        if (t.pickupMode === 'asap') return !!t.quotedTime && now > new Date(t.quotedTime).getTime();
        if (t.pickupMode !== 'scheduled' || !t.pickupTime) return false;
        return now - new Date(t.pickupTime).getTime() > S.lateMinutes * 60000;
    }

    function queueTrips() {
        var today = new Date(); today.setHours(23, 59, 59, 999);
        var endOfBoardDay = dayStart(); endOfBoardDay.setHours(23, 59, 59, 999);
        var cutoff = Math.max(today.getTime(), endOfBoardDay.getTime());
        return Object.values(state.trips).filter(function (t) {
            if (t.status !== 'queued' || !matches(t)) return false;
            // Scheduled trips for later days wait off the queue until their day (standing orders).
            if (t.pickupMode === 'scheduled' && t.pickupTime && new Date(t.pickupTime).getTime() > cutoff) return false;
            return state.tab === 'all' || t.pickupMode === state.tab;
        }).sort(function (a, b) {
            var order = { asap: 0, scheduled: 1, will_call: 2 };
            if (order[a.pickupMode] !== order[b.pickupMode]) return order[a.pickupMode] - order[b.pickupMode];
            return (start(a) || new Date(a.createdAt)) - (start(b) || new Date(b.createdAt));
        });
    }

    // ------------------------------------------------------------------ top bar
    function renderBar() {
        var day = dayStart();
        $('trip-date').textContent = day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        var all = Object.values(state.trips), now = Date.now();
        var queued = all.filter(function (t) { return t.status === 'queued'; });
        var asap = queued.filter(function (t) { return t.pickupMode === 'asap'; });
        var oldest = asap.reduce(function (m, t) { return Math.max(m, minsAgo(t.pickupTime || t.createdAt)); }, 0);
        var late = all.filter(function (t) { return isLate(t, now); });
        var active = all.filter(function (t) { return C.active.indexOf(t.status) >= 0; });
        var paperwork = all.filter(function (t) { return t.alerts && t.alerts.length && t.status !== 'completed' && t.status !== 'cancelled' && onBoardDay(t); });
        var inService = state.units.filter(function (u) { return u.onRoad && !u.outOfService; });
        var m = [
            ['Queued', queued.length, ''],
            ['ASAP', asap.length, asap.length ? 'red' : '', asap.length ? 'Oldest waiting ' + oldest + ' min' : ''],
            ['Will-call', queued.filter(function (t) { return t.pickupMode === 'will_call'; }).length, ''],
            ['Late', late.length, late.length ? 'red' : '', 'Scheduled pickups more than ' + S.lateMinutes + ' min past and not under way'],
            ['Active', active.length, ''],
            ['Paperwork', paperwork.length, paperwork.length ? 'amber' : '', 'Missing or expiring PCS / prior auth'],
            ['Trucks', inService.length, ''],
        ];
        $('trip-metrics').innerHTML = m.map(function (x) {
            return '<span class="trip-metric ' + (x[2] ? 'trip-metric-' + x[2] : '') + '" title="' + esc(x[3] || '') + '"><b>' + x[1] + '</b>' + x[0] + '</span>';
        }).join('');
        $('trip-online').textContent = state.online.length > 1 ? state.online.length + ' online' : '';
        $('trip-online').title = state.online.join(', ');
        $('trip-mute').textContent = muted() ? '🔕 Alerts off' : '🔔 Alerts on';
    }

    // ------------------------------------------------------------------ queue
    function renderQueue() {
        var tabs = [['all', 'All'], ['asap', 'ASAP'], ['scheduled', 'Scheduled'], ['will_call', 'Will-call']];
        var counts = { all: 0, asap: 0, scheduled: 0, will_call: 0 };
        var saveTab = state.tab; state.tab = 'all';
        queueTrips().forEach(function (t) { counts.all++; counts[t.pickupMode]++; });
        state.tab = saveTab;
        $('trip-tabs').innerHTML = tabs.map(function (x) {
            return '<button type="button" data-tab="' + x[0] + '" class="' + (state.tab === x[0] ? 'on' : '') + '">' + x[1] + ' <span>' + counts[x[0]] + '</span></button>';
        }).join('');
        var list = queueTrips(), now = Date.now();
        $('trip-queue').innerHTML = list.length ? list.map(function (t) { return queueCard(t, now); }).join('') : '<p class="trip-empty">Nothing waiting.</p>';
    }

    function queueCard(t, now) {
        var when = t.pickupMode === 'asap' ? '<span class="trip-red">ASAP · waiting ' + minsAgo(t.pickupTime || t.createdAt) + ' min' + (t.quotedTime ? ' · quoted by ' + hm(d(t.quotedTime)) : '') + '</span>'
            : t.pickupMode === 'will_call' ? '<span class="trip-amber">Will-call (waiting for the ready call)</span>'
                : 'Pickup ' + (sameDay(d(t.pickupTime), new Date()) ? hm(d(t.pickupTime)) : d(t.pickupTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }));
        return '<div class="trip-card trip-q ' + (isAls(t.level) ? 'trip-als' : 'trip-bls') + (isLate(t, now) ? ' trip-late' : '') + '" draggable="' + (can.dispatch ? 'true' : 'false') + '" data-trip="' + t.id + '">'
            + '<div class="trip-card-top"><span class="trip-lvl trip-lvl-' + esc(t.level) + '">' + esc(level(t.level)) + '</span> <b>' + esc(t.number) + '</b><span class="trip-ttype">' + (t.priority && t.priority !== 'routine' ? '<b class="trip-red">' + esc(C.priorities[t.priority]) + '</b> · ' : '') + esc(C.types[t.tripType] || '') + (t.leg === 'return' ? ' · return' : '') + '</span></div>'
            + '<div class="trip-pt">' + esc(t.patientName) + (t.age != null ? ' · ' + t.age + 'y' : '') + (t.weightLbs ? ' · ' + t.weightLbs + ' lb' : '') + '</div>'
            + '<div class="trip-route">' + esc(t.pickupLocation) + ' → ' + esc(t.destination) + '</div>'
            + '<div class="trip-card-foot">' + when + '<span>' + t.durationMin + 'm</span></div>'
            + chips(t) + '</div>';
    }

    function chips(t) {
        var out = (t.equipment || []).map(function (e) { return '<span class="trip-chip">' + esc(C.equipment[e] || e) + (e === 'oxygen' && t.oxygenLpm ? ' ' + t.oxygenLpm + ' LPM' : '') + '</span>'; });
        if (t.dnr) out.unshift('<span class="trip-chip trip-chip-warn">DNR</span>');
        if (t.stairs) out.push('<span class="trip-chip">' + t.stairs + ' flight' + (t.stairs > 1 ? 's' : '') + ' of stairs</span>');
        if (t.riders) out.push('<span class="trip-chip">' + t.riders + ' rider' + (t.riders > 1 ? 's' : '') + '</span>');
        if (t.waitAndReturn) out.push('<span class="trip-chip">Wait and return</span>');
        (t.alerts || []).forEach(function (a) { out.push('<span class="trip-chip trip-chip-warn">' + esc(a) + '</span>'); });
        return out.length ? '<div class="trip-chips">' + out.join('') + '</div>' : '';
    }

    // ------------------------------------------------------------------ timeline
    function columns() {
        var ids = state.units.map(function (u) { return u.id; });
        var cols = state.units.slice();
        state.extraCols.forEach(function (id) {
            if (ids.indexOf(id) < 0) {
                var tr = state.allTrucks.find(function (x) { return x.id === id; });
                if (tr) cols.push({ id: id, name: tr.name, shifts: [], onRoad: false, level: null, levelLabel: null, phone: null, gpsDeviceId: null, outOfService: null });
            }
        });
        // A truck with a trip on this day always gets a column.
        Object.values(state.trips).forEach(function (t) {
            if (t.vehicleId && onBoardDay(t) && t.status !== 'queued' && !cols.some(function (c) { return c.id === t.vehicleId; })) {
                cols.push({ id: t.vehicleId, name: unitName(t.vehicleId), shifts: [], onRoad: false });
            }
        });
        return cols;
    }

    function gpsFor(u) {
        return state.gps.find(function (g) { return g.vehicleId === u.id; });
    }

    function gpsLine(u) {
        var g = gpsFor(u);
        if (!g) return u.gpsDeviceId ? '<span class="trip-muted">📍 No GPS yet</span>' : '';
        var age = minsAgo(g.at);
        var label = g.speedMph > 1 ? Math.round(g.speedMph) + ' mph' : 'Stopped';
        return '<span class="' + (age > S.staleMinutes ? 'trip-amber' : 'trip-muted') + '">📍 ' + label + ' · ' + (age < 1 ? 'now' : age + ' min ago') + (g.source === 'phone' ? ' (phone)' : '') + '</span>';
    }

    function renderColumns() {
        var cols = columns(), day = dayStart();
        $('trip-cols-head').innerHTML = '<div class="trip-gutter">' + cols.length + ' trucks</div>' + cols.map(function (u) {
            var crew = [], shift = '';
            (u.shifts || []).forEach(function (s) {
                shift += (shift ? ', ' : '') + hm(d(s.starts)) + '–' + hm(d(s.ends)) + (s.status !== 'in_service' ? ' (' + s.statusLabel + ')' : '');
                s.crew.forEach(function (m) { crew.push(esc(m.name) + (m.role ? ' <span class="trip-muted">' + esc(m.role) + '</span>' : '')); });
            });
            var count = Object.values(state.trips).filter(function (t) { return t.vehicleId === u.id && onBoardDay(t) && t.status !== 'cancelled'; }).length;
            return '<div class="trip-col-head' + (u.outOfService ? ' trip-oos' : '') + (isAls(u.level) ? ' trip-als' : ' trip-bls') + '" style="width:' + COL + 'px">'
                + '<div class="trip-col-title"><b>' + esc(u.name) + '</b>' + (u.levelLabel ? ' <span class="trip-lvl trip-lvl-' + esc(u.level) + '">' + esc(u.levelLabel) + '</span>' : '') + '</div>'
                + (u.phone ? '<div><a href="tel:' + esc(u.phone.replace(/[^\d+]/g, '')) + '">' + esc(u.phone) + '</a></div>' : '')
                + '<div class="trip-crew">' + (crew.length ? crew.join('<br>') : '<span class="trip-amber">No crew assigned</span>') + '</div>'
                + '<div class="trip-muted">' + (shift ? 'Shift ' + shift : 'No shift') + ' · ' + count + ' trip' + (count === 1 ? '' : 's') + '</div>'
                + '<div>' + gpsLine(u) + '</div>'
                + (u.outOfService ? '<div class="trip-red">Out of service: ' + esc(u.outOfService) + '</div>' : '')
                + (u.unitStatus ? '<div class="' + (u.unitStatus === 'available' ? 'trip-green' : u.unitStatus === 'out_of_service' ? 'trip-red' : 'trip-amber') + '">MDT: ' + esc(C.unitStatuses[u.unitStatus] || u.unitStatus) + '</div>' : '')
                + (can.dispatch ? '<a class="trip-small" target="_blank" href="' + T.urls.runSheet + '/' + u.id + '?day=' + state.day + '">Run sheet</a>' : '')
                + '</div>';
        }).join('');

        var hours = '';
        for (var h = 0; h < 24; h++) hours += '<div class="trip-hour" style="top:' + (h * 4 * PX) + 'px">' + String(h).padStart(2, '0') + ':00</div>';
        var html = '<div class="trip-gutter trip-times" style="height:' + (96 * PX) + 'px">' + hours + '</div>';
        var now = new Date();
        cols.forEach(function (u) {
            var shade = '';
            (u.shifts || []).forEach(function (s) {
                var a = Math.max(0, (d(s.starts) - day) / 60000), b = Math.min(1440, (d(s.ends) - day) / 60000);
                if (b > a) shade += '<div class="trip-onshift" style="top:' + (a / SLOT * PX) + 'px;height:' + ((b - a) / SLOT * PX) + 'px"></div>';
            });
            html += '<div class="trip-col" data-unit="' + u.id + '" style="width:' + COL + 'px;height:' + (96 * PX) + 'px">' + shade + tripCards(u) + '</div>';
        });
        if (sameDay(now, day)) {
            html += '<div class="trip-now" style="top:' + ((now.getHours() * 60 + now.getMinutes()) / SLOT * PX) + 'px"></div>';
        }
        $('trip-grid').style.width = (60 + cols.length * COL) + 'px';
        $('trip-grid').innerHTML = html;

        var sel = $('trip-addcol'), shown = cols.map(function (c) { return c.id; });
        sel.innerHTML = '<option value="">Pick a truck…</option>' + state.allTrucks.filter(function (x) { return shown.indexOf(x.id) < 0; }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
        sel.parentNode.parentNode.hidden = !can.dispatch;
    }

    function tripCards(u) {
        var day = dayStart(), now = Date.now();
        var list = Object.values(state.trips).filter(function (t) { return t.vehicleId === u.id && t.status !== 'queued' && onBoardDay(t) && t.scheduledStart; })
            .sort(function (a, b) { return start(a) - start(b); });
        // Side-by-side lanes for overlapping trips.
        var lanes = [], placed = list.map(function (t) {
            var s = (start(t) - day) / 60000, e = s + t.durationMin, lane = 0;
            while (lanes[lane] != null && lanes[lane] > s) lane++;
            lanes[lane] = e;
            return { t: t, s: s, e: e, lane: lane };
        });
        var width = Math.max(1, lanes.length);
        return placed.map(function (p) {
            var t = p.t, top = Math.max(0, p.s) / SLOT * PX, h = Math.max(PX * 2, (p.e - Math.max(0, p.s)) / SLOT * PX - 2);
            var w = (COL - 8) / width;
            return '<div class="trip-card trip-trip trip-st-' + t.status + (isAls(t.level) ? ' trip-als' : ' trip-bls') + (matches(t) ? '' : ' trip-dim') + (isLate(t, now) ? ' trip-late' : '') + '" draggable="' + (can.dispatch && C.active.indexOf(t.status) < 0 && t.status !== 'completed' && t.status !== 'cancelled' ? 'true' : 'false') + '" data-trip="' + t.id + '" style="top:' + top + 'px;height:' + h + 'px;left:' + (4 + p.lane * w) + 'px;width:' + (w - 2) + 'px">'
                + '<div class="trip-card-top"><b>' + esc(t.number) + '</b> <span class="trip-lvl trip-lvl-' + esc(t.level) + '">' + esc(level(t.level)) + '</span>' + (t.alerts && t.alerts.length ? ' <span title="' + esc(t.alerts.join(', ')) + '">⚠</span>' : '') + '<span class="trip-st">' + esc(C.statuses[t.status]) + '</span></div>'
                + '<div class="trip-small">' + hm(start(t)) + '–' + hm(new Date(start(t).getTime() + t.durationMin * 60000)) + ' · ' + esc(t.patientName) + '</div>'
                + '<div class="trip-small">' + esc(t.pickupLocation) + ' → ' + esc(t.destination) + '</div>'
                + '<div class="trip-small trip-muted">' + esc(C.types[t.tripType] || '') + '</div>'
                + '</div>';
        }).join('');
    }

    function render() {
        renderBar();
        renderQueue();
        renderColumns();
        if (state.open && state.trips[state.open.id] && state.trips[state.open.id].version !== state.open.version) openTrip(state.open.id, true);
    }

    // ------------------------------------------------------------------ drag and drop
    var dragging = null;
    document.addEventListener('dragstart', function (e) {
        var card = e.target.closest && e.target.closest('.trip-card[draggable="true"]');
        if (!card) return;
        dragging = +card.dataset.trip;
        e.dataTransfer.setData('text/plain', String(dragging));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('trip-dragging');
    });
    document.addEventListener('dragend', function () {
        dragging = null;
        document.querySelectorAll('.trip-dragging, .trip-over').forEach(function (el) { el.classList.remove('trip-dragging', 'trip-over'); });
        $('trip-ghost') && $('trip-ghost').remove();
    });
    document.addEventListener('dragover', function (e) {
        if (dragging == null) return;
        var col = e.target.closest && e.target.closest('.trip-col');
        var queue = e.target.closest && e.target.closest('#trip-queue-drop');
        if (!col && !queue) return;
        e.preventDefault();
        if (col) {
            var t = state.trips[dragging], mins = slotAt(col, e.clientY);
            var g = $('trip-ghost') || (function () { var x = document.createElement('div'); x.id = 'trip-ghost'; x.className = 'trip-ghost'; return x; })();
            g.style.top = (mins / SLOT * PX) + 'px';
            g.style.height = ((t ? t.durationMin : 60) / SLOT * PX) + 'px';
            g.textContent = String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
            if (g.parentNode !== col) col.appendChild(g);
        } else {
            queue.classList.add('trip-over');
        }
    });
    document.addEventListener('drop', function (e) {
        if (dragging == null) return;
        var id = dragging, t = state.trips[id];
        var col = e.target.closest && e.target.closest('.trip-col');
        var queue = e.target.closest && e.target.closest('#trip-queue-drop');
        e.preventDefault();
        if (col) {
            var mins = slotAt(col, e.clientY), when = dayStart();
            when.setMinutes(mins);
            assign(t, +col.dataset.unit, when, []);
        } else if (queue && t.status !== 'queued') {
            api('POST', T.urls.base + '/' + id + '/unassign', { expected_version: t.version })
                .then(function (r) { upsert(r.trip); render(); toast(t.number + ' is back in the queue.'); })
                .catch(function (err) { failed(err); });
        }
    });

    function slotAt(col, clientY) {
        var y = clientY - col.getBoundingClientRect().top;
        return Math.max(0, Math.min(1440 - SLOT, Math.round(y / PX) * SLOT));
    }

    function assign(t, vehicleId, when, ack) {
        api('POST', T.urls.base + '/' + t.id + '/assign', { vehicle_id: vehicleId, start: localIso(when), expected_version: t.version, acknowledge: ack })
            .then(function (r) { upsert(r.trip); render(); toast(t.number + ' assigned to ' + unitName(vehicleId) + ' at ' + hm(when) + '.', 'ok'); })
            .catch(function (err) {
                if (err && err.status === 422 && err.data && err.data.error === 'NEEDS_ACK') {
                    confirmAck(err.data.warnings).then(function (ok) {
                        if (ok) assign(t, vehicleId, when, ack.concat(err.data.warnings.map(function (w) { return w.code; })));
                    });
                    return;
                }
                failed(err);
            });
    }

    function confirmAck(warnings) {
        return new Promise(function (resolve) {
            var dlg = $('trip-ack');
            $('trip-ack-list').innerHTML = warnings.map(function (w) { return '<li>' + esc(w.message) + '</li>'; }).join('');
            var done = function (v) { dlg.close(); $('trip-ack-yes').onclick = $('trip-ack-no').onclick = null; resolve(v); };
            $('trip-ack-yes').onclick = function () { done(true); };
            $('trip-ack-no').onclick = function () { done(false); };
            dlg.showModal();
        });
    }

    // ------------------------------------------------------------------ trip drawer
    document.addEventListener('click', function (e) {
        var card = e.target.closest && e.target.closest('.trip-card[data-trip]');
        if (card && !e.target.closest('a')) openTrip(+card.dataset.trip);
        var tab = e.target.closest && e.target.closest('[data-tab]');
        if (tab) { state.tab = tab.dataset.tab; renderQueue(); }
        var dayBtn = e.target.closest && e.target.closest('[data-day]');
        if (dayBtn) changeDay(+dayBtn.dataset.day);
    });

    function openTrip(id, quiet) {
        var t = state.trips[id];
        if (!can.dispatch) { // Viewers see the summary only.
            state.open = t;
            drawer('<h2>' + esc(t.number) + '</h2><p>' + esc(t.patientName) + ' · ' + esc(C.statuses[t.status]) + '</p><p>' + esc(t.pickupLocation) + ' → ' + esc(t.destination) + '</p><p class="trip-muted">Patient details are for dispatchers only.</p>');
            return;
        }
        api('GET', T.urls.base + '/' + id).then(function (full) {
            state.open = full;
            upsert(Object.assign({}, state.trips[id] || {}, pick(full)));
            drawer(detailHtml(full));
            if (full.status === 'queued' && full.pickupMode === 'asap') loadSuggestions(full);
        }).catch(function (err) { if (!quiet) failed(err, 'Couldn\'t open that trip.'); });
    }

    function pick(full) {
        var keys = ['id', 'number', 'version', 'patientId', 'patientName', 'age', 'weightLbs', 'level', 'tripType', 'equipment', 'pickupMode', 'pickupTime', 'durationMin', 'pickupLocation', 'pickupFacilityId', 'destination', 'destinationFacilityId', 'status', 'vehicleId', 'scheduledStart', 'leg', 'linkedTripId', 'cancelReason', 'loadedMiles', 'statusTimes', 'alerts', 'payer', 'createdAt', 'priority', 'quotedTime', 'dnr', 'oxygenLpm', 'stairs', 'riders', 'waitAndReturn', 'estMiles', 'pickupDepartment', 'dropoffDepartment', 'pickupRoom', 'dropoffRoom'];
        var o = {}; keys.forEach(function (k) { o[k] = full[k]; }); return o;
    }

    function drawer(html) {
        var el = $('trip-drawer');
        el.innerHTML = '<button type="button" class="btn btn-small btn-outline trip-close" id="trip-close">Close</button>' + html;
        el.hidden = false;
        $('trip-close').onclick = function () { el.hidden = true; state.open = null; };
    }

    function detailHtml(t) {
        var idx = C.flow.indexOf(t.status), next = idx >= 0 ? C.flow[idx + 1] : null;
        var times = Object.keys(C.statuses).filter(function (k) { return t.statusTimes && t.statusTimes[k]; })
            .map(function (k) { return '<li><span>' + esc(C.statuses[k]) + '</span> ' + new Date(t.statusTimes[k]).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + '</li>'; }).join('');
        var actions = '';
        if (next && t.vehicleId) actions += '<button type="button" class="btn btn-small" data-status="' + next + '">' + esc(C.statuses[next]) + '</button>';
        if (t.status !== 'completed' && t.status !== 'cancelled') {
            if (t.status === 'assigned') actions += '<button type="button" class="btn btn-small btn-outline" data-unassign>Back to queue</button>';
            actions += '<span class="trip-cancel"><select id="trip-cancel-reason"><option value="">Cancel because…</option>' + C.cancelReasons.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-small btn-outline" data-cancel>Cancel trip</button></span>';
        } else if (can.supervise) {
            actions += '<button type="button" class="btn btn-small btn-outline" data-status="queued">Reopen (back to queue)</button>';
        }
        var row = function (k, v) { return v || v === 0 ? '<dt>' + k + '</dt><dd>' + v + '</dd>' : ''; };
        return '<div class="trip-dr-head"><h2>' + esc(t.number) + '</h2><span class="trip-pill trip-st-' + t.status + '">' + esc(C.statuses[t.status]) + '</span></div>'
            + (t.alerts.length ? '<div class="flash flash-error">Paperwork: ' + esc(t.alerts.join(', ')) + '</div>' : '')
            + '<div class="trip-actions">' + actions + '</div>'
            + '<div id="trip-suggest"></div>'
            + '<dl class="trip-dl">'
            + row('Patient', esc(t.patientLast + ', ' + t.patientFirst) + (t.patientId ? ' · <a href="' + T.urls.patients + '/' + t.patientId + '" target="_blank">Patient record</a>' : ''))
            + row('DOB', esc(t.dob) + (t.age != null ? ' (' + t.age + 'y)' : '') + (t.weightLbs ? ' · ' + t.weightLbs + ' lb' : ''))
            + row('Patient notes', [t.patientNotes && t.patientNotes.dispatch ? '<b>Dispatch:</b> ' + esc(t.patientNotes.dispatch) : '', t.patientNotes && t.patientNotes.baseline ? '<b>Baseline:</b> ' + esc(t.patientNotes.baseline) : ''].filter(Boolean).join('<br>'))
            + row('Insurance', esc(t.payer || 'None') + (t.memberId ? ' · ' + esc(t.memberId) : '') + (t.secondaryPayer ? '<br>Secondary: ' + esc(t.secondaryPayer) + (t.secondaryMemberId ? ' · ' + esc(t.secondaryMemberId) : '') : '') + (t.priorAuth ? '<br>Auth ' + esc(t.priorAuth) : ''))
            + row('PCS', t.pcsOnFile ? 'On file' : (t.pcsSigned ? 'Signed' : t.pcsRequested ? 'Requested' : '<b class="trip-red">Not on file</b>'))
            + row('Ordered by', [esc(t.orderingFacility || ''), esc([t.callerName, t.callerTitle].filter(Boolean).join(', ')), t.callerPhone ? '<a href="tel:' + esc(t.callerPhone) + '">' + esc(t.callerPhone) + '</a>' : ''].filter(Boolean).join(' · '))
            + row('Priority', t.priority && t.priority !== 'routine' ? '<b class="trip-red">' + esc(C.priorities[t.priority]) + '</b>' : '')
            + row('Quoted', t.quotedTime ? 'On scene by ' + esc(new Date(t.quotedTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })) : '')
            + row('Level', esc(level(t.level)) + ' · ' + esc(C.types[t.tripType] || '') + (t.leg !== 'one_way' ? ' · ' + esc(t.leg) + ' leg' + (t.linkedTripId ? ' (<a href="#" data-open="' + t.linkedTripId + '">other leg</a>)' : '') : '') + (t.seriesId ? ' · standing order' : ''))
            + row('Pickup', esc(t.pickupLocation) + ' · ' + (t.pickupMode === 'asap' ? 'ASAP' : t.pickupMode === 'will_call' ? 'Will-call' : esc(new Date(t.pickupTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }))))
            + row('Pickup room', [esc(t.pickupDepartment || ''), t.pickupRoom ? 'Room ' + esc(t.pickupRoom) : '', t.pickupPhone ? '<a href="tel:' + esc(t.pickupPhone) + '">' + esc(t.pickupPhone) + '</a>' : ''].filter(Boolean).join(' · '))
            + row('Destination', esc(t.destination) + (t.estMiles ? ' · about ' + t.estMiles + ' mi' : ''))
            + row('Drop-off room', [esc(t.dropoffDepartment || ''), t.dropoffRoom ? 'Room ' + esc(t.dropoffRoom) : '', t.dropoffPhone ? '<a href="tel:' + esc(t.dropoffPhone) + '">' + esc(t.dropoffPhone) + '</a>' : ''].filter(Boolean).join(' · '))
            + row('Truck', t.vehicleId ? esc(unitName(t.vehicleId)) + ' at ' + hm(d(t.scheduledStart)) : 'Not assigned')
            + row('Complaint', esc(t.chiefComplaint))
            + row('Necessity', esc(t.stretcherReason))
            + row('Diagnoses', (t.diagnoses || []).map(function (x, i) { return esc(x.code) + (x.description ? ' ' + esc(x.description) : '') + (i === 0 ? ' <span class="trip-muted">(primary)</span>' : ''); }).join('<br>'))
            + row('Doctors', ['referring', 'receiving'].filter(function (r) { return t.physicians && t.physicians[r]; }).map(function (r) { var p = t.physicians[r]; return (r === 'referring' ? 'Referring: ' : 'Receiving: ') + esc(p.name) + (p.phone ? ' · ' + esc(p.phone) : '') + (p.npi ? ' · NPI ' + esc(p.npi) : ''); }).join('<br>'))
            + row('Equipment', (t.equipment || []).map(function (e) { return esc(C.equipment[e] || e) + (e === 'oxygen' && t.oxygenLpm ? ' ' + t.oxygenLpm + ' LPM' : ''); }).join(', ') || 'None')
            + row('Also', [t.dnr ? '<b class="trip-red">DNR</b>' : '', t.stairs ? t.stairs + ' flights of stairs' : '', t.riders ? t.riders + ' riding along' : '', t.waitAndReturn ? 'Crew waits and brings the patient back' : ''].filter(Boolean).join(' · '))
            + row('Notes', esc(t.notes || ''))
            + row('From the crew', t.crewNotes ? '<b>' + esc(t.crewNotes) + '</b>' : '')
            + row('Odometer', t.odometerPickup != null || t.odometerDestination != null ? 'Pickup ' + (t.odometerPickup == null ? '—' : t.odometerPickup) + ' · Destination ' + (t.odometerDestination == null ? '—' : t.odometerDestination) : '')
            + row('Cancelled', esc(t.cancelReason || ''))
            + row('ePCR', t.vehicleId && t.status !== 'cancelled' ? (t.epcrPulledAt ? 'Pulled ' + hm(d(t.epcrPulledAt)) + ' · ' : 'Not pulled yet · ') + '<a href="' + T.urls.base + '/' + t.id + '/epcr.xml">Download file</a>' : '')
            + '</dl>'
            + '<form class="trip-edit" id="trip-edit">'
            + '<h3>Change</h3>'
            + '<label>Level <select name="level">' + Object.keys(C.levels).map(function (k) { return '<option value="' + k + '"' + (k === t.level ? ' selected' : '') + '>' + esc(C.levels[k]) + '</option>'; }).join('') + '</select></label>'
            + '<label>Minutes <input type="number" name="duration_min" min="15" max="600" step="15" value="' + t.durationMin + '"></label>'
            + '<label>Pickup <select name="pickup_mode">' + [['asap', 'ASAP'], ['scheduled', 'Scheduled'], ['will_call', 'Will-call']].map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === t.pickupMode ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label>'
            + '<label>Time <input type="datetime-local" step="900" name="pickup_time" value="' + (t.pickupTime ? localIso(new Date(t.pickupTime)) : '') + '"></label>'
            + '<label>Priority <select name="priority">' + Object.keys(C.priorities).map(function (k) { return '<option value="' + k + '"' + (k === (t.priority || 'routine') ? ' selected' : '') + '>' + esc(C.priorities[k]) + '</option>'; }).join('') + '</select></label>'
            + '<label>Quoted by (ASAP) <input type="datetime-local" step="900" name="quoted_time" value="' + (t.quotedTime ? localIso(new Date(t.quotedTime)) : '') + '"></label>'
            + '<label>Loaded miles <input type="number" step="0.1" min="0" name="loaded_miles" value="' + (t.loadedMiles == null ? '' : t.loadedMiles) + '"></label>'
            + '<label class="trip-check"><input type="checkbox" name="pcs_on_file" value="1"' + (t.pcsOnFile ? ' checked' : '') + '> PCS on file</label>'
            + '<label class="trip-wide">Notes <textarea name="notes" rows="2" maxlength="1000">' + esc(t.notes || '') + '</textarea></label>'
            + '<button type="submit" class="btn btn-small">Save changes</button>'
            + '</form>'
            + '<h3>Times</h3><ul class="trip-times-list">' + times + '</ul>'
            + '<h3>History</h3><ul class="trip-history">' + t.history.map(function (h) { return '<li><span class="trip-muted">' + new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' · ' + esc(h.by || 'Pulse') + '</span><br>' + esc(h.action) + (h.detail ? ': ' + esc(h.detail) : '') + '</li>'; }).join('') + '</ul>';
    }

    $('trip-drawer').addEventListener('click', function (e) {
        var t = state.open; if (!t) return;
        var b = e.target.closest('[data-status],[data-unassign],[data-cancel],[data-open],[data-suggest]');
        if (!b) return;
        e.preventDefault();
        if (b.dataset.open) return openTrip(+b.dataset.open);
        if (b.dataset.suggest) { var now = new Date(); now.setSeconds(0, 0); now.setMinutes(Math.ceil(now.getMinutes() / SLOT) * SLOT); if (!sameDay(now, dayStart())) changeDay(0); return assign(state.trips[t.id], +b.dataset.suggest, now, []); }
        if (b.hasAttribute('data-unassign')) {
            return api('POST', T.urls.base + '/' + t.id + '/unassign', { expected_version: t.version }).then(function (r) { upsert(r.trip); render(); openTrip(t.id, true); }).catch(failed);
        }
        var status = b.dataset.status, reason = null;
        if (b.hasAttribute('data-cancel')) {
            status = 'cancelled'; reason = $('trip-cancel-reason').value;
            if (!reason) return toast('Pick a reason for cancelling first.', 'error');
        }
        api('POST', T.urls.base + '/' + t.id + '/status', { status: status, expected_version: t.version, reason: reason })
            .then(function (r) { upsert(r.trip); render(); openTrip(t.id, true); toast(t.number + ': ' + C.statuses[status] + '.', 'ok'); })
            .catch(failed);
    });

    $('trip-drawer').addEventListener('submit', function (e) {
        e.preventDefault();
        var t = state.open, f = e.target, body = { expected_version: t.version };
        ['level', 'pickup_mode', 'notes', 'priority'].forEach(function (k) { body[k] = f.elements[k].value; });
        body.quoted_time = f.elements.quoted_time.value || null;
        body.duration_min = +f.elements.duration_min.value;
        body.pickup_time = f.elements.pickup_time.value || null;
        body.loaded_miles = f.elements.loaded_miles.value === '' ? null : +f.elements.loaded_miles.value;
        body.pcs_on_file = f.elements.pcs_on_file.checked;
        api('PUT', T.urls.base + '/' + t.id, body).then(function (r) {
            state.open = r.trip; upsert(pick(r.trip)); render(); drawer(detailHtml(r.trip)); toast('Saved ' + t.number + '.', 'ok');
        }).catch(failed);
    });

    function loadSuggestions(t) {
        api('GET', T.urls.base + '/' + t.id + '/suggestions').then(function (r) {
            var el = $('trip-suggest'); if (!el) return;
            if (!r.pickupKnown) { el.innerHTML = '<p class="trip-muted">Closest trucks show when the pickup is a facility with a map location.</p>'; return; }
            if (!r.units.length) { el.innerHTML = '<p class="trip-muted">No trucks on the road right now.</p>'; return; }
            el.innerHTML = '<h3>Closest trucks</h3><ul class="trip-suggest">' + r.units.map(function (u) {
                return '<li><b>' + esc(u.unit) + '</b> ' + (u.levelLabel ? '<span class="trip-muted">' + esc(u.levelLabel) + '</span>' : '')
                    + ' · ' + (u.miles == null ? 'no GPS' : u.miles + ' mi, about ' + u.etaMin + ' min') + (u.stale ? ' <span class="trip-amber">(old fix)</span>' : '')
                    + (u.busyWith ? ' · <span class="trip-amber">busy with ' + esc(u.busyWith) + '</span>' : '') + (!u.levelOk ? ' · <span class="trip-red">level too low</span>' : '')
                    + ' <button type="button" class="btn btn-small" data-suggest="' + u.vehicleId + '">Assign now</button></li>';
            }).join('') + '</ul>';
        }).catch(function () {});
    }

    // ------------------------------------------------------------------ intake
    var intake = $('trip-intake');
    if (intake) {
        var form = $('trip-intake-form');
        $('trip-new').onclick = function () { resetIntake(); intake.showModal(); $('trip-ordering').focus(); };
        intake.addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) intake.close(); });
        form.addEventListener('change', intakeHints);
        form.addEventListener('input', intakeHints);

        // Payor: type to search the one shared list; a new one is added when the trip is booked.
        var payerList = null;
        TripsCombo.attach($('trip-payer'), {
            items: function () { return payerList = payerList || api('GET', T.urls.payers); },
            idInput: form.elements.payer_id, allowNew: true,
            newLabel: function (t) { return 'Use "' + t + '" (new payor)'; },
        });
        // Ordering facility: picking one fills an empty pickup with it.
        TripsCombo.attach($('trip-ordering'), {
            items: function () { return Promise.resolve(state.facilities.filter(function (f) { return f.active !== false; }).map(function (f) { return { id: f.id, name: f.name, hint: C.facilityKinds ? C.facilityKinds[f.kind] : '' }; })); },
            idInput: form.elements.ordering_facility_id,
            onPick: function (item) {
                if (item && !form.elements.pickup_location.value) form.elements.pickup_location.value = item.name;
                var fac = item && state.facilities.find(function (f) { return f.id === item.id; });
                if (fac && fac.phone && !form.elements.caller_phone.value) form.elements.caller_phone.value = fac.phone;
                intakeHints();
            },
        });

        // Diagnoses: rows of ICD-10 codes, searchable by code or words; the first is primary.
        $('trip-dx-add').addEventListener('click', function () { addDx().focus(); });

        // Search the patients on file as the dispatcher types in the search box...
        var searchTimer = null;
        $('trip-pt-search').addEventListener('input', function (e) {
            clearTimeout(searchTimer);
            var q = e.target.value.trim();
            if (q.length < 2) { $('trip-pt-results').innerHTML = ''; return; }
            searchTimer = setTimeout(function () { lookup(q, null); }, 300);
        });
        // ...and when they tab off the name or date of birth, so a patient on file isn't typed in twice.
        form.querySelectorAll('[data-pt-field]').forEach(function (el) {
            el.addEventListener('input', function () {
                if (form.elements.patient_id.value) { form.elements.patient_id.value = ''; $('trip-pt-picked').hidden = true; }
            });
            el.addEventListener('change', autoLookup);
            el.addEventListener('blur', autoLookup);
        });
        var lastAuto = '';
        function autoLookup() {
            var f = form.elements;
            if (f.patient_id.value) return;
            var last = f.patient_last.value.trim(), first = f.patient_first.value.trim(), dob = f.patient_dob.value;
            if (last.length < 2 && !dob) return;
            var q = [last, first, dob].filter(Boolean).join(' ');
            if (q === lastAuto) return;
            lastAuto = q;
            lookup(q, 'tab');
        }
        function lookup(q, why) {
            api('POST', T.urls.lookup, { q: q }).then(function (list) {
                var box = $('trip-pt-results');
                if (!list.length) {
                    box.innerHTML = why ? '<p class="trip-muted">Not on file yet. A patient record is made when you book.</p>' : '<p class="trip-muted">No match. Type the patient in below and a record is made.</p>';
                    return;
                }
                box.innerHTML = (why ? '<p class="trip-pt-head">' + (list.length === 1 ? 'This patient is on file. Pick them to fill in the record:' : list.length + ' patients on file match. Pick one, or keep typing for a new patient:') + '</p>' : '')
                    + list.map(function (p) {
                        return '<button type="button" data-pt="' + p.id + '">' + esc(p.name) + ' · ' + esc(p.dob) + ' (' + p.age + 'y) · ' + esc(p.number) + (p.payer ? ' · ' + esc(p.payer) : '') + '</button>';
                    }).join('');
            }).catch(failed);
        }
        $('trip-pt-results').addEventListener('click', function (e) {
            var b = e.target.closest('[data-pt]'); if (!b) return;
            api('GET', T.urls.patients + '/' + b.dataset.pt + '/intake').then(fillFromPatient).catch(failed);
        });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            $('trip-intake-error').textContent = '';
            var f = form.elements, num = function (el) { return el.value === '' ? null : +el.value; }, val = function (el) { return el.value.trim() || null; };
            var body = {
                patient_id: f.patient_id.value ? +f.patient_id.value : null,
                patient_first: f.patient_first.value, patient_last: f.patient_last.value, patient_dob: f.patient_dob.value,
                weight_lbs: num(f.weight_lbs), payer_id: f.payer_id.value ? +f.payer_id.value : null, payer: val(f.payer), member_id: val(f.member_id),
                prior_auth: val(f.prior_auth), pcs_on_file: f.pcs_on_file.checked, pcs_requested: f.pcs_requested.checked, pcs_signed: f.pcs_signed.checked,
                ordering_facility_id: f.ordering_facility_id.value ? +f.ordering_facility_id.value : null,
                caller_name: val(f.caller_name), caller_title: val(f.caller_title), caller_phone: val(f.caller_phone), priority: f.priority.value,
                level: f.level.value, trip_type: f.trip_type.value,
                equipment: checked('equipment[]'), chief_complaint: f.chief_complaint.value, stretcher_reason: f.stretcher_reason.value, notes: val(f.notes),
                oxygen_lpm: num(f.oxygen_lpm), stairs: num(f.stairs), riders: num(f.riders), dnr: f.dnr.checked,
                diagnoses: Array.prototype.map.call(form.querySelectorAll('[data-dx]'), function (el) { return { code: dxCode(el.value) }; }).filter(function (d) { return d.code; }),
                physicians: { referring: doc('referring'), receiving: doc('receiving') },
                pickup_department: val(f.pickup_department), pickup_room: val(f.pickup_room), pickup_phone: val(f.pickup_phone),
                dropoff_department: val(f.dropoff_department), dropoff_room: val(f.dropoff_room), dropoff_phone: val(f.dropoff_phone),
                pickup_mode: radio('pickup_mode'), pickup_time: f.pickup_time.value || null, quoted_time: f.quoted_time.value || null, duration_min: +f.duration_min.value || 60,
                round_trip: f.round_trip.checked, return_mode: radio('return_mode'), return_time: f.return_time.value || null,
                repeat_days: checked('repeat_days[]').map(Number), repeat_weeks: +f.repeat_weeks.value || 4,
            };
            var pf = facilityByName(f.pickup_location.value), df = facilityByName(f.destination.value);
            body.pickup_facility_id = pf ? pf.id : null; body.pickup_location = f.pickup_location.value;
            body.destination_facility_id = df ? df.id : null; body.destination = f.destination.value;
            if (body.pickup_mode !== 'asap') body.quoted_time = null;
            if (body.pickup_mode !== 'scheduled') body.pickup_time = null;
            if (!body.round_trip) { body.return_mode = null; body.return_time = null; }
            api('POST', T.urls.book, body).then(function (r) {
                if (!body.payer_id && body.payer) payerList = null; // a new payor may have been added
                r.trips.forEach(upsert); render(); intake.close();
                toast('Booked ' + r.trips.map(function (t) { return t.number; }).join(', ') + '.', 'ok');
            }).catch(function (err) {
                if (err && err.data && err.data.errors) {
                    $('trip-intake-error').textContent = Object.keys(err.data.errors).map(function (k) { return err.data.errors[k][0]; }).join(' ');
                } else failed(err);
            });
        });
        function doc(role) {
            var o = {};
            ['name', 'phone', 'fax', 'npi'].forEach(function (k) { o[k] = form.elements['physicians[' + role + '][' + k + ']'].value.trim(); });
            return o;
        }
        function checked(name) { return Array.prototype.slice.call(form.querySelectorAll('[name="' + name + '"]:checked')).map(function (x) { return x.value; }); }
        function radio(name) { var x = form.querySelector('[name="' + name + '"]:checked'); return x ? x.value : null; }
    }

    /** "N18.6 End stage renal disease" or "n18.6" -> "N18.6". */
    function dxCode(text) { var m = String(text || '').trim().match(/^([A-Za-z][0-9][0-9A-Za-z](\.[0-9A-Za-z]{1,4})?)\b/); return m ? m[1].toUpperCase() : ''; }

    function addDx(code) {
        var rows = $('trip-dx-rows'), row = document.createElement('div');
        row.className = 'trip-dx-row';
        var known = code && C.icd10.find(function (d) { return d.id === code; });
        row.innerHTML = '<input type="text" data-dx maxlength="120" placeholder="Code or words: N18.6, dialysis, CHF" aria-label="Diagnosis">'
            + '<button type="button" class="btn btn-small btn-outline" aria-label="Remove diagnosis">×</button>';
        rows.appendChild(row);
        var input = row.querySelector('input');
        input.value = code ? code + (known ? ' ' + known.hint : '') : '';
        TripsCombo.attach(input, {
            items: C.icd10.map(function (d) { return { id: d.id, name: d.id + ' ' + d.hint }; }), allowNew: true,
            newLabel: function (t) { return dxCode(t) ? 'Use code ' + dxCode(t) : 'Type an ICD-10 code (letter, 2 characters, then a dot)'; },
        });
        row.querySelector('button').addEventListener('click', function () { row.remove(); dxLabels(); });
        dxLabels();
        return input;
    }
    function dxLabels() {
        Array.prototype.forEach.call($('trip-dx-rows').children, function (r, i) { r.querySelector('input').placeholder = i ? 'Another diagnosis' : 'Primary: code or words (N18.6, dialysis, CHF)'; });
    }

    function facilityByName(name) {
        name = (name || '').trim().toLowerCase();
        return state.facilities.find(function (f) { return f.name.toLowerCase() === name; });
    }

    function resetIntake() {
        var form = $('trip-intake-form');
        form.reset();
        ['patient_id', 'payer_id', 'ordering_facility_id'].forEach(function (k) { form.elements[k].value = ''; });
        $('trip-pt-picked').hidden = true;
        $('trip-pt-results').innerHTML = '';
        $('trip-pt-search').value = '';
        $('trip-intake-error').textContent = '';
        $('trip-dx-rows').innerHTML = '';
        addDx();
        var next = new Date(); next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15 + 60, 0, 0);
        form.elements.pickup_time.value = localIso(next);
        $('trip-facility-list').innerHTML = state.facilities.map(function (f) { return '<option value="' + esc(f.name) + '">'; }).join('');
        intakeHints();
    }

    function fillFromPatient(p) {
        var form = $('trip-intake-form'), f = form.elements;
        f.patient_id.value = p.id; f.patient_last.value = p.last; f.patient_first.value = p.first; f.patient_dob.value = p.dob;
        f.weight_lbs.value = p.weightLbs || ''; f.payer.value = p.payer || ''; f.payer_id.value = p.payerId || ''; f.member_id.value = p.memberId || ''; f.prior_auth.value = p.priorAuth || '';
        f.pcs_on_file.checked = !!(p.pcsExpires && p.pcsExpires >= ymd(new Date()));
        f.level.value = p.level || 'bls';
        f.stretcher_reason.value = p.stretcherReason || '';
        document.querySelectorAll('#trip-intake-form [name="equipment[]"]').forEach(function (c) { c.checked = (p.equipment || []).indexOf(c.value) >= 0; });
        var lt = p.lastTrip;
        if (lt) {
            f.trip_type.value = lt.tripType; f.chief_complaint.value = lt.chiefComplaint || '';
            f.pickup_location.value = lt.pickupLocation || ''; f.destination.value = lt.destination || ''; f.duration_min.value = lt.durationMin || 60;
            f.pickup_room.value = lt.pickupRoom || ''; f.pickup_department.value = lt.pickupDepartment || '';
            f.dropoff_room.value = lt.dropoffRoom || ''; f.dropoff_department.value = lt.dropoffDepartment || '';
            f.oxygen_lpm.value = lt.oxygenLpm == null ? '' : lt.oxygenLpm; f.stairs.value = lt.stairs == null ? '' : lt.stairs;
            $('trip-dx-rows').innerHTML = '';
            (lt.diagnoses || []).forEach(function (d) { addDx(d.code); });
            if (!(lt.diagnoses || []).length) addDx();
        } else if (p.livesAt && !f.pickup_location.value) {
            f.pickup_location.value = p.livesAt.name;
        } else if (p.address && !f.pickup_location.value) {
            f.pickup_location.value = p.address; f.pickup_phone.value = p.phone || '';
        }
        var picked = $('trip-pt-picked');
        picked.hidden = false;
        picked.innerHTML = esc('Booking for ' + p.last + ', ' + p.first + ' (' + p.number + '). Filled in from the record' + (lt ? ' and their last trip' : '') + '; check everything.')
            + (p.deceased ? '<div class="trip-pt-notes"><strong>Date of death on file: ' + esc(p.deceased) + '.</strong></div>' : '')
            + (p.dispatchNotes ? '<div class="trip-pt-notes"><strong>Dispatch notes:</strong> ' + esc(p.dispatchNotes) + '</div>' : '')
            + (p.baseline ? '<div class="trip-pt-notes"><strong>Baseline:</strong> ' + esc(p.baseline) + '</div>' : '')
            + (p.secondaryPayer ? '<div class="trip-muted">Secondary payor: ' + esc(p.secondaryPayer) + '</div>' : '');
        $('trip-pt-results').innerHTML = '';
        intakeHints();
    }

    function intakeHints() {
        var form = $('trip-intake-form'); if (!form) return;
        var f = form.elements, hints = [];
        var eq = Array.prototype.slice.call(form.querySelectorAll('[name="equipment[]"]:checked')).map(function (x) { return x.value; });
        if (!isAls(f.level.value) && eq.some(function (e) { return C.alsEquipment.indexOf(e) >= 0; })) hints.push('ALS equipment on a ' + level(f.level.value) + ' trip.');
        if (+f.weight_lbs.value >= 350 && eq.indexOf('bariatric') < 0) hints.push('Over 350 lb: does this patient need the bariatric stretcher?');
        if (eq.indexOf('oxygen') >= 0 && !f.oxygen_lpm.value) hints.push('Oxygen: how many liters?');
        if (f.oxygen_lpm.value && eq.indexOf('oxygen') < 0) hints.push('Liters given but oxygen isn\'t checked.');
        if (!f.pcs_on_file.checked && !f.pcs_signed.checked) hints.push(f.pcs_requested.checked ? 'PCS requested, not signed yet.' : 'No PCS on file.');
        $('trip-intake-hints').innerHTML = hints.map(function (h) { return '<span class="trip-chip trip-chip-warn">' + esc(h) + '</span>'; }).join(' ');
        var mode = form.querySelector('[name="pickup_mode"]:checked').value;
        form.querySelectorAll('[data-when]').forEach(function (el) { el.hidden = el.dataset.when !== mode; });
        f.pickup_time.disabled = mode !== 'scheduled';
        form.querySelector('.trip-repeat').hidden = mode !== 'scheduled';
        form.querySelector('.trip-return').hidden = !f.round_trip.checked;
        // Rough distance between two facilities on the map (straight line plus a quarter for roads).
        var pf = facilityByName(f.pickup_location.value), df = facilityByName(f.destination.value), est = '';
        if (pf && df && pf.lat != null && df.lat != null && pf.id !== df.id) {
            var r = Math.PI / 180, a = Math.sin((df.lat - pf.lat) * r / 2), b = Math.sin((df.lon - pf.lon) * r / 2);
            var mi = 2 * 3958.8 * Math.asin(Math.sqrt(a * a + Math.cos(pf.lat * r) * Math.cos(df.lat * r) * b * b)) * 1.25;
            est = 'About ' + mi.toFixed(1) + ' miles by road (estimate).';
        }
        $('trip-est').textContent = est;
    }

    // ------------------------------------------------------------------ live updates
    function poll() {
        if (!state.polling) return;
        var active = state.activeSincePoll ? 1 : 0;
        state.activeSincePoll = false;
        api('GET', T.urls.changes + '?since=' + state.seq + '&active=' + active).then(function (r) {
            state.failures = 0;
            $('trip-live').textContent = 'Live'; $('trip-live').className = 'trip-live trip-ok';
            var newAsap = [];
            r.trips.forEach(function (t) {
                var before = state.trips[t.id];
                if (!before && t.status === 'queued' && t.pickupMode === 'asap') newAsap.push(t);
                upsert(t);
                var by = r.by[t.id];
                if (by && by !== B.me.name && before && before.version !== t.version) toast(by + ' changed ' + t.number + ': ' + C.statuses[t.status] + (t.vehicleId ? ' · ' + unitName(t.vehicleId) : ''));
                else if (by && by !== B.me.name && !before) toast(by + ' booked ' + t.number + '.');
            });
            state.seq = r.seq;
            state.gps = r.gps;
            state.online = r.online;
            if (r.facilities) api('GET', T.urls.facilities).then(function (list) { state.facilities = list; });
            if (r.units) api('GET', T.urls.data + '?day=' + state.day).then(function (b) { state.units = b.units; renderColumns(); });
            if (r.trips.length || true) render();
            if (newAsap.length) alertUser('New ASAP trip: ' + newAsap.map(tripLabel).join(', '));
            if (r.more) setTimeout(poll, 50); else setTimeout(poll, 4000);
        }).catch(function (err) {
            if (err && err.handled) return;
            state.failures++;
            $('trip-live').textContent = 'Reconnecting…'; $('trip-live').className = 'trip-live trip-warn';
            setTimeout(poll, Math.min(30000, 4000 * state.failures));
        });
    }

    function changeDay(delta) {
        var day = delta === 0 ? new Date() : dayStart();
        if (delta) day.setDate(day.getDate() + delta);
        api('GET', T.urls.data + '?day=' + ymd(day)).then(function (r) {
            state.day = r.day; state.units = r.units; state.gps = r.gps;
            state.trips = {}; r.trips.forEach(upsert);
            render();
            scrollToNow();
        }).catch(failed);
    }

    // Late trips: alert once per trip.
    setInterval(function () {
        var now = Date.now();
        Object.values(state.trips).forEach(function (t) {
            if (isLate(t, now) && !state.alerted[t.id]) { state.alerted[t.id] = true; alertUser('Late: ' + tripLabel(t) + ' (pickup ' + hm(d(t.pickupTime)) + ')'); }
        });
        renderBar(); renderQueue();
    }, 30000);

    // ------------------------------------------------------------------ alerts (sound and pop-ups)
    function muted() { try { return localStorage.getItem('trips.mute') === '1'; } catch (e) { return false; } }
    $('trip-mute').onclick = function () {
        try { localStorage.setItem('trips.mute', muted() ? '0' : '1'); } catch (e) {}
        if (!muted() && window.Notification && Notification.permission === 'default') Notification.requestPermission();
        renderBar();
    };
    var audio = null;
    function beep() {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            [0, 0.25].forEach(function (offset) {
                var o = audio.createOscillator(), g = audio.createGain();
                o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
                g.gain.setValueAtTime(0.0001, audio.currentTime + offset);
                g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + offset + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + offset + 0.2);
                o.start(audio.currentTime + offset); o.stop(audio.currentTime + offset + 0.22);
            });
        } catch (e) {}
    }
    function alertUser(text) {
        toast(text, 'error');
        if (muted()) return;
        beep();
        // No patient names in system notifications (they show on the lock screen).
        if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification('Trip Board', { body: text.replace(/ [^ ]+, [^ ]+/g, '') });
    }

    // ------------------------------------------------------------------ idle sign-out warning
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (ev) {
        document.addEventListener(ev, function () { state.lastActivity = Date.now(); state.activeSincePoll = true; $('trip-idle').hidden = true; }, { passive: true });
    });
    setInterval(function () {
        var idle = (Date.now() - state.lastActivity) / 60000;
        $('trip-idle').hidden = idle < S.idleMinutes - 1;
    }, 15000);

    // ------------------------------------------------------------------ the rest
    $('trip-filter').addEventListener('input', function (e) { state.filter = e.target.value.trim().toLowerCase(); renderQueue(); renderColumns(); });
    $('trip-addcol').addEventListener('change', function (e) { if (e.target.value) { state.extraCols.push(+e.target.value); renderColumns(); } });

    function scrollToNow() {
        var now = new Date(), mins = sameDay(now, dayStart()) ? now.getHours() * 60 + now.getMinutes() - 90 : 6 * 60;
        $('trip-scroll').scrollTop = Math.max(0, mins / SLOT * PX);
    }
    // Keep the column headers lined up with the timeline when it scrolls sideways.
    $('trip-scroll').addEventListener('scroll', function (e) { $('trip-cols-head').scrollLeft = e.target.scrollLeft; });

    render();
    scrollToNow();
    // Links from a patient record: ?trip=ID opens that trip, ?patient=ID starts a booking for them.
    (function () {
        var q = new URLSearchParams(location.search);
        if (q.get('trip') && can.dispatch) openTrip(+q.get('trip'));
        if (q.get('patient') && intake) {
            resetIntake(); intake.showModal();
            api('GET', T.urls.patients + '/' + encodeURIComponent(q.get('patient')) + '/intake').then(fillFromPatient).catch(failed);
        }
        if (q.has('trip') || q.has('patient')) history.replaceState(null, '', location.pathname + (q.get('day') ? '?day=' + q.get('day') : ''));
    })();
    state.polling = true;
    setTimeout(poll, 1000);
})();
