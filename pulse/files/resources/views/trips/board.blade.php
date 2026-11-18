@extends('layouts.app')

{{-- Dispatch > Trip Board. The page is drawn by public/js/trips-board.js from the data below and kept live by checking for changes every few seconds. --}}
@section('bare')
@php($c = $boot['constants'])
<div class="trip-board" id="trip-board">
    <div class="trip-bar">
        <div class="trip-day">
            <button type="button" class="btn btn-small btn-outline" data-day="-1" aria-label="Previous day">&lsaquo;</button>
            <button type="button" class="btn btn-small btn-outline" data-day="0">Today</button>
            <button type="button" class="btn btn-small btn-outline" data-day="1" aria-label="Next day">&rsaquo;</button>
            <strong id="trip-date"></strong>
        </div>
        <div class="trip-metrics" id="trip-metrics"></div>
        <input type="search" id="trip-filter" class="trip-filter" placeholder="Filter: trip #, name, place" aria-label="Filter trips">
        @if ($boot['can']['dispatch'])<button type="button" class="btn btn-small" id="trip-new">+ New trip</button>@endif
        <span class="trip-live" id="trip-live" title="Live updates">Connecting…</span>
        <span class="trip-online" id="trip-online"></span>
        <button type="button" class="btn btn-small btn-outline" id="trip-mute" title="Sound and pop-up alerts for new ASAP trips and late trips"></button>
    </div>
    <div class="trip-idle" id="trip-idle" hidden>You'll be signed out in a minute for inactivity (patient information is on this page). Move the mouse or press a key to stay.</div>
    <div class="trip-main">
        <aside class="trip-queue" id="trip-queue-drop">
            <div class="trip-queue-head">
                <h2>Unassigned</h2>
                <div class="trip-tabs" id="trip-tabs"></div>
            </div>
            <div class="trip-queue-list" id="trip-queue"></div>
            @if ($boot['can']['dispatch'])<p class="trip-hint">Drag a trip onto a truck's timeline to assign it. Drag an assigned trip back here to unassign it.</p>@endif
        </aside>
        <section class="trip-sched">
            <div class="trip-cols-head" id="trip-cols-head"></div>
            <div class="trip-scroll" id="trip-scroll">
                <div class="trip-grid" id="trip-grid"></div>
            </div>
            <div class="trip-addcol">
                <label>Show another truck <select id="trip-addcol"><option value="">Pick a truck…</option></select></label>
                <a href="{{ route('fleet') }}">Crews come from Vehicle Assignments</a>
            </div>
        </section>
    </div>
    <aside class="trip-drawer" id="trip-drawer" hidden></aside>
    <div class="trip-toasts" id="trip-toasts" aria-live="polite"></div>

    @if ($boot['can']['dispatch'])
    <dialog class="trip-dialog" id="trip-intake">
        <form id="trip-intake-form" autocomplete="off">
            <div class="trip-dialog-head"><h2>New trip</h2><button type="button" class="btn btn-small btn-outline" data-close>Close</button></div>
            <div class="trip-intake-grid">
                <fieldset>
                    <legend>Call</legend>
                    <label class="trip-wide">Ordering facility
                        <input type="text" id="trip-ordering" maxlength="120" placeholder="Who's asking for the trip">
                        <input type="hidden" name="ordering_facility_id">
                    </label>
                    <label>Caller<input type="text" name="caller_name" maxlength="100"></label>
                    <label>Title<input type="text" name="caller_title" maxlength="60" list="trip-caller-titles" placeholder="RN, case manager"></label>
                    <label>Callback phone<input type="tel" name="caller_phone" maxlength="30"></label>
                    <label>Priority
                        <select name="priority">@foreach ($c['priorities'] as $k => $v)<option value="{{ $k }}">{{ $v }}</option>@endforeach</select>
                    </label>
                    <div class="trip-sublegend trip-wide">Patient</div>
                    <label class="trip-wide">Find a patient on file
                        <input type="search" id="trip-pt-search" placeholder="Last name, first name, P-number, DOB, MRN or phone">
                    </label>
                    <div id="trip-pt-results" class="trip-pt-results trip-wide" aria-live="polite"></div>
                    <input type="hidden" name="patient_id">
                    <div class="trip-pt-picked trip-wide" id="trip-pt-picked" hidden></div>
                    <label>Last name<input type="text" name="patient_last" required maxlength="60" data-pt-field></label>
                    <label>First name<input type="text" name="patient_first" required maxlength="60" data-pt-field></label>
                    <label>Date of birth<input type="date" name="patient_dob" required data-pt-field></label>
                    <label>Weight (lb)<input type="number" name="weight_lbs" min="1" max="1500"></label>
                    <label class="trip-wide">Primary payor
                        <input type="text" name="payer" maxlength="100" id="trip-payer" placeholder="Start typing: Medicare, Sample Health…">
                        <input type="hidden" name="payer_id">
                    </label>
                    <label>Member ID<input type="text" name="member_id" maxlength="60"></label>
                    <label>Prior auth #<input type="text" name="prior_auth" maxlength="60"></label>
                    <div class="trip-wide trip-modes">
                        <span>PCS</span>
                        <label class="trip-check"><input type="checkbox" name="pcs_on_file" value="1"> On file</label>
                        <label class="trip-check"><input type="checkbox" name="pcs_requested" value="1"> Requested</label>
                        <label class="trip-check"><input type="checkbox" name="pcs_signed" value="1"> Signed</label>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>Trip</legend>
                    <label>Level
                        <select name="level" required>@foreach ($c['levels'] as $k => $v)<option value="{{ $k }}">{{ $v }}</option>@endforeach</select>
                    </label>
                    <label>Trip type
                        <select name="trip_type" required>@foreach ($c['types'] as $k => $v)<option value="{{ $k }}">{{ $v }}</option>@endforeach</select>
                    </label>
                    <label class="trip-wide">Chief complaint<input type="text" name="chief_complaint" required maxlength="500"></label>
                    <div class="trip-wide trip-dx">
                        <span>Diagnoses (ICD-10; the first is primary)</span>
                        <div id="trip-dx-rows"></div>
                        <button type="button" class="btn btn-small btn-outline" id="trip-dx-add">+ Add diagnosis</button>
                    </div>
                    <label class="trip-wide">Reason for stretcher (medical necessity)<input type="text" name="stretcher_reason" required maxlength="500"></label>
                    <div class="trip-wide trip-equip">
                        <span>Equipment</span>
                        @foreach ($c['equipment'] as $k => $v)<label class="trip-check"><input type="checkbox" name="equipment[]" value="{{ $k }}"> {{ $v }}</label>@endforeach
                    </div>
                    <label><span>O<sub>2</sub> liters/min</span><input type="number" name="oxygen_lpm" min="0" max="60" step="0.5"></label>
                    <label>Flights of stairs<input type="number" name="stairs" min="0" max="20"></label>
                    <label>Riders (family, companions)<input type="number" name="riders" min="0" max="4"></label>
                    <label class="trip-check"><input type="checkbox" name="dnr" value="1"> DNR</label>
                    <div class="trip-wide trip-hints" id="trip-intake-hints"></div>
                    <label class="trip-wide">Notes for the crew<textarea name="notes" rows="2" maxlength="1000"></textarea></label>
                    <details class="trip-wide trip-docs">
                        <summary>Doctors (referring and receiving)</summary>
                        @foreach (['referring' => 'Referring', 'receiving' => 'Receiving'] as $role => $label)
                            <div class="trip-docs-row">
                                <label>{{ $label }} doctor<input type="text" name="physicians[{{ $role }}][name]" maxlength="100"></label>
                                <label>Phone<input type="tel" name="physicians[{{ $role }}][phone]" maxlength="30"></label>
                                <label>Fax<input type="tel" name="physicians[{{ $role }}][fax]" maxlength="30"></label>
                                <label>NPI<input type="text" name="physicians[{{ $role }}][npi]" maxlength="10" inputmode="numeric" pattern="\d{10}"></label>
                            </div>
                        @endforeach
                    </details>
                </fieldset>
                <fieldset>
                    <legend>Pickup and destination</legend>
                    <label class="trip-wide">Pickup
                        <input type="text" name="pickup_location" list="trip-facility-list" maxlength="200" placeholder="Facility, or an address">
                    </label>
                    <label>Department<input type="text" name="pickup_department" maxlength="60" list="trip-departments"></label>
                    <label>Apt / room<input type="text" name="pickup_room" maxlength="40"></label>
                    <label class="trip-wide">Pickup phone<input type="tel" name="pickup_phone" maxlength="30" placeholder="Nurse station, or the patient at home"></label>
                    <label class="trip-wide">Destination
                        <input type="text" name="destination" list="trip-facility-list" maxlength="200" placeholder="Facility, or an address">
                    </label>
                    <label>Department<input type="text" name="dropoff_department" maxlength="60" list="trip-departments"></label>
                    <label>Apt / room<input type="text" name="dropoff_room" maxlength="40"></label>
                    <label class="trip-wide">Destination phone<input type="tel" name="dropoff_phone" maxlength="30"></label>
                    <div class="trip-wide trip-muted" id="trip-est"></div>
                    <div class="trip-wide trip-modes">
                        <label class="trip-check"><input type="radio" name="pickup_mode" value="asap" checked> ASAP</label>
                        <label class="trip-check"><input type="radio" name="pickup_mode" value="scheduled"> Scheduled</label>
                        <label class="trip-check"><input type="radio" name="pickup_mode" value="will_call"> Will-call</label>
                    </div>
                    <label class="trip-wide" data-when="asap">Quoted time (what you told the caller)
                        <input type="datetime-local" name="quoted_time" step="300">
                        <small class="trip-muted">Not a pickup time. The trip stays ASAP: get there sooner if a truck frees up. It shows late only after this time.</small>
                    </label>
                    <label class="trip-wide" data-when="scheduled">Pickup time<input type="datetime-local" name="pickup_time" step="900"></label>
                    <label>Minutes the trip takes<input type="number" name="duration_min" value="60" min="15" max="600" step="15"></label>
                    <label class="trip-check trip-wide"><input type="checkbox" name="round_trip" value="1"> Round trip (books a return leg)</label>
                    <div class="trip-wide trip-return" hidden>
                        <label class="trip-check"><input type="radio" name="return_mode" value="will_call" checked> Return is will-call</label>
                        <label class="trip-check"><input type="radio" name="return_mode" value="wait"> Wait and return (crew stays)</label>
                        <label class="trip-check"><input type="radio" name="return_mode" value="scheduled"> Return at</label>
                        <input type="datetime-local" name="return_time" step="900">
                    </div>
                    <div class="trip-wide trip-repeat">
                        <span>Standing order: repeat on</span>
                        @foreach ([1 => 'Mon', 2 => 'Tue', 3 => 'Wed', 4 => 'Thu', 5 => 'Fri', 6 => 'Sat', 7 => 'Sun'] as $n => $d)<label class="trip-check"><input type="checkbox" name="repeat_days[]" value="{{ $n }}"> {{ $d }}</label>@endforeach
                        <label>for <input type="number" name="repeat_weeks" value="4" min="1" max="26" class="trip-num"> weeks</label>
                    </div>
                </fieldset>
            </div>
            <div class="trip-dialog-foot">
                <span class="trip-error" id="trip-intake-error"></span>
                <button type="button" class="btn btn-outline" data-close>Cancel</button>
                <button type="submit" class="btn">Book trip</button>
            </div>
        </form>
        <datalist id="trip-facility-list"></datalist>
        <datalist id="trip-caller-titles"><option value="RN"><option value="Case manager"><option value="Social worker"><option value="Unit clerk"><option value="Physician"><option value="Family member"><option value="Patient"></datalist>
        <datalist id="trip-departments"><option value="Emergency"><option value="ICU"><option value="Med/Surg"><option value="Cardiology"><option value="Radiology"><option value="Dialysis"><option value="Lobby"><option value="Front entrance"></datalist>
    </dialog>
    @endif

    <dialog class="trip-dialog trip-dialog-small" id="trip-ack">
        <h2>Confirm assignment</h2>
        <ul id="trip-ack-list" class="trip-ack-list"></ul>
        <div class="trip-dialog-foot">
            <button type="button" class="btn btn-outline" id="trip-ack-no">Cancel</button>
            <button type="button" class="btn" id="trip-ack-yes">Assign anyway</button>
        </div>
    </dialog>
</div>
<script>
    window.TRIPS = {
        boot: @json($boot),
        csrf: @json(csrf_token()),
        urls: {
            base: @json(url('/trips')),
            data: @json(route('trips.data')),
            changes: @json(route('trips.changes')),
            facilities: @json(route('trips.facilities.json')),
            book: @json(route('trips.store')),
            lookup: @json(route('trips.patients.lookup')),
            payers: @json(route('trips.payers.json')),
            patients: @json(url('/trips/patients')),
            runSheet: @json(url('/trips/run-sheet')),
            login: @json(url('/login')),
        },
    };
</script>
<script src="{{ asset('js/trips-combobox.js') }}?v={{ @filemtime(public_path('js/trips-combobox.js')) }}"></script>
<script src="{{ asset('js/trips-board.js') }}?v={{ @filemtime(public_path('js/trips-board.js')) }}"></script>
@endsection
