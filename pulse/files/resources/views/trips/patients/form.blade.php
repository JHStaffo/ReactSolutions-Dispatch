@extends('layouts.app')

@section('band')
    <h1>{{ $patient->exists ? 'Edit '.$patient->patient_number : 'Add a patient' }}</h1>
    <p>Names, date of birth, contact details, member ids and notes are encrypted when they're saved.</p>
@endsection

@section('content')
@php($v = fn ($k) => old($k, $patient->{$k} ?? null))
@php($d = fn ($k) => old($k, $patient->{$k}?->toDateString()))
@php($rels = \App\Trips\Models\PatientPayer::RELATIONSHIPS)
<form method="post" action="{{ $patient->exists ? route('trips.patients.update', $patient) : route('trips.patients.store') }}" autocomplete="off" id="patient-form" class="stack">@csrf
    @if ($patient->exists) @method('put')<input type="hidden" name="version" value="{{ $patient->version }}"> @endif
    <div class="card">
        <h2>Who</h2>
        <div class="field-row">
            <div class="field"><label for="p-last">Last name</label><input type="text" id="p-last" name="last_name" value="{{ $v('last_name') }}" required maxlength="60"></div>
            <div class="field"><label for="p-first">First name</label><input type="text" id="p-first" name="first_name" value="{{ $v('first_name') }}" required maxlength="60"></div>
            <div class="field"><label for="p-mid">Middle name</label><input type="text" id="p-mid" name="middle_name" value="{{ $v('middle_name') }}" maxlength="60"></div>
            <div class="field" style="max-width:110px"><label for="p-suf">Suffix</label><input type="text" id="p-suf" name="suffix" value="{{ $v('suffix') }}" maxlength="10" placeholder="Jr, III"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-dob">Date of birth</label><input id="p-dob" type="date" name="dob" value="{{ $v('dob') }}" required></div>
            <div class="field"><label for="p-sex">Sex</label><select id="p-sex" name="sex">@foreach (['F' => 'Female', 'M' => 'Male', 'X' => 'X', 'U' => 'Unknown'] as $k => $l)<option value="{{ $k }}" @selected($v('sex') === $k)>{{ $l }}</option>@endforeach</select></div>
            <div class="field"><label for="p-mar">Marital status</label><select id="p-mar" name="marital_status"><option value="">—</option>@foreach (\App\Trips\Models\Patient::MARITAL as $k => $l)<option value="{{ $k }}" @selected($v('marital_status') === $k)>{{ $l }}</option>@endforeach</select></div>
            <div class="field"><label for="p-lang">Language</label><input type="text" id="p-lang" name="language" value="{{ $v('language') }}" maxlength="40" list="p-langs" placeholder="English"></div>
            <div class="field"><label for="p-race">Race / ethnicity</label><input type="text" id="p-race" name="race" value="{{ $v('race') }}" maxlength="40"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-wt">Weight (lb)</label><input id="p-wt" type="number" name="weight_lbs" min="1" max="1500" value="{{ $v('weight_lbs') }}"></div>
            <div class="field"><label for="p-ht">Height (in)</label><input id="p-ht" type="number" name="height_in" min="10" max="108" value="{{ $v('height_in') }}"></div>
            <div class="field"><label for="p-mrn">MRN</label><input type="text" id="p-mrn" name="mrn" value="{{ $v('mrn') }}" maxlength="40" placeholder="Facility's record number"></div>
            <div class="field"><label for="p-ext">Other system's id</label><input type="text" id="p-ext" name="external_code" value="{{ $v('external_code') }}" maxlength="60"></div>
        </div>
    </div>

    <div class="card">
        <h2>Where and how to reach them</h2>
        <div class="field-row">
            <div class="field" style="grid-column:span 2"><label for="p-addr">Street address</label><input type="text" id="p-addr" name="address" value="{{ $v('address') }}" maxlength="200"></div>
            <div class="field"><label for="p-addr2">Apt, unit, room</label><input type="text" id="p-addr2" name="address2" value="{{ $v('address2') }}" maxlength="100"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-city">City</label><input type="text" id="p-city" name="city" value="{{ $v('city') }}" maxlength="60"></div>
            <div class="field" style="max-width:90px"><label for="p-state">State</label><input type="text" id="p-state" name="state" value="{{ $v('state') }}" maxlength="2" placeholder="VA"></div>
            <div class="field" style="max-width:140px"><label for="p-zip">Zip</label><input type="text" id="p-zip" name="zip" value="{{ $v('zip') }}" maxlength="10" inputmode="numeric"></div>
            <div class="field"><label for="p-county">County</label><input type="text" id="p-county" name="county" value="{{ $v('county') }}" maxlength="60"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-fac">Lives at a facility</label><select id="p-fac" name="facility_id"><option value="">No, at home</option>@foreach ($facilities as $f)<option value="{{ $f->id }}" @selected((int) $v('facility_id') === $f->id)>{{ $f->name }}</option>@endforeach</select></div>
            <div class="field"><label for="p-phone">Phone</label><input type="text" id="p-phone" name="phone" value="{{ $v('phone') }}" maxlength="30"></div>
            <div class="field"><label for="p-email">Email</label><input type="email" id="p-email" name="email" value="{{ $v('email') }}" maxlength="120"></div>
            <div class="field"><label for="p-emp">Employer</label><input type="text" id="p-emp" name="employer" value="{{ $v('employer') }}" maxlength="100"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-nok">Next of kin / emergency contact</label><input type="text" id="p-nok" name="nok_name" value="{{ $v('nok_name') }}" maxlength="100"></div>
            <div class="field"><label for="p-nokr">Relationship</label><input type="text" id="p-nokr" name="nok_relationship" value="{{ $v('nok_relationship') }}" maxlength="40" placeholder="Daughter"></div>
            <div class="field"><label for="p-nokp">Their phone</label><input type="text" id="p-nokp" name="nok_phone" value="{{ $v('nok_phone') }}" maxlength="30"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-pcp">Primary care doctor</label><input type="text" id="p-pcp" name="pcp_name" value="{{ $v('pcp_name') }}" maxlength="100"></div>
            <div class="field"><label for="p-pcpn">Doctor's NPI</label><input type="text" id="p-pcpn" name="pcp_npi" value="{{ $v('pcp_npi') }}" maxlength="10" inputmode="numeric"></div>
            <div class="field"><label for="p-pcpp">Doctor's phone</label><input type="text" id="p-pcpp" name="pcp_phone" value="{{ $v('pcp_phone') }}" maxlength="30"></div>
        </div>
        <label class="check"><input type="hidden" name="reminders_opt_out" value="0"><input type="checkbox" name="reminders_opt_out" value="1" @checked($v('reminders_opt_out'))> Doesn't want trip reminder calls or texts</label>
    </div>

    <div class="card">
        <h2>Payors</h2>
        <p class="hint">In billing order: the first is primary. Start typing to pick from the payor list. One that isn't on the list is added to it when you save, so it's never listed twice.</p>
        <div id="payor-rows">
            @foreach ($payorRows as $i => $r)
                @include('trips.patients.payor-row', ['i' => $i, 'r' => $r, 'rels' => $rels])
            @endforeach
        </div>
        <p><button type="button" class="btn btn-small btn-outline" id="payor-add">+ Add payor</button></p>
        <template id="payor-template">@include('trips.patients.payor-row', ['i' => '__i__', 'r' => [], 'rels' => $rels])</template>
    </div>

    <div class="card">
        <h2>Paperwork</h2>
        <div class="field-row">
            <div class="field"><label for="p-pcs">PCS good until</label><input id="p-pcs" type="date" name="pcs_expires" value="{{ $d('pcs_expires') }}"></div>
            <div class="field"><label for="p-auth">Prior auth #</label><input type="text" id="p-auth" name="prior_auth_number" value="{{ $v('prior_auth_number') }}" maxlength="60"></div>
            <div class="field"><label for="p-authx">Prior auth good until</label><input id="p-authx" type="date" name="prior_auth_expires" value="{{ $d('prior_auth_expires') }}"></div>
            <div class="field"><label for="p-authn">Trips authorized</label><input id="p-authn" type="number" name="trips_authorized" min="0" max="999" value="{{ $v('trips_authorized') }}"></div>
        </div>
    </div>

    <div class="card">
        <h2>For dispatch and crews</h2>
        <div class="field-row">
            <div class="field"><label for="p-level">Usual level</label><select id="p-level" name="default_level">@foreach (\App\Models\ScopeItem::LEVELS as $k => $l)<option value="{{ $k }}" @selected($v('default_level') === $k)>{{ $l }}</option>@endforeach</select></div>
            <div class="field"><label for="p-xp">Extra minutes at pickup</label><input id="p-xp" type="number" name="pickup_extra_min" min="0" max="120" value="{{ $v('pickup_extra_min') }}" placeholder="0"></div>
            <div class="field"><label for="p-xd">Extra minutes at drop-off</label><input id="p-xd" type="number" name="dropoff_extra_min" min="0" max="120" value="{{ $v('dropoff_extra_min') }}" placeholder="0"></div>
        </div>
        <fieldset class="plain-fieldset"><legend>Usual equipment</legend>
            @php($eq = old('default_equipment', $patient->default_equipment ?? []))
            @foreach (\App\Trips\Models\Trip::EQUIPMENT as $k => $l)<label class="check"><input type="checkbox" name="default_equipment[]" value="{{ $k }}" @checked(in_array($k, $eq, true))> {{ $l }}</label>@endforeach
        </fieldset>
        <div class="field"><label for="p-why">Reason for stretcher (medical necessity)</label><input type="text" id="p-why" name="stretcher_reason" value="{{ $v('stretcher_reason') }}" maxlength="500"></div>
        <div class="field"><label for="p-dn">Dispatch notes</label><textarea id="p-dn" name="dispatch_notes" rows="2" maxlength="1000" placeholder="Shown at intake and to the crew: gate codes, use the side door, call daughter first">{{ $v('dispatch_notes') }}</textarea></div>
        <div class="field"><label for="p-base">Baseline</label><textarea id="p-base" name="baseline" rows="2" maxlength="2000" placeholder="Usual mental status, mobility, allergies, medications">{{ $v('baseline') }}</textarea></div>
        <div class="field"><label for="p-notes">Medical notes for crews</label><textarea id="p-notes" name="medical_notes" rows="3" maxlength="2000">{{ $v('medical_notes') }}</textarea></div>
        <div class="field-row">
            <div class="field" style="max-width:220px"><label for="p-dec">Date of death</label><input id="p-dec" type="date" name="deceased_on" value="{{ $d('deceased_on') }}"></div>
        </div>
        <label class="check"><input type="hidden" name="active" value="0"><input type="checkbox" name="active" value="1" @checked($v('active'))> Active (shows up in trip intake)</label>
    </div>
    <p>
        <button type="submit" class="btn">{{ $patient->exists ? 'Save' : 'Add patient' }}</button>
        <a class="btn btn-outline" href="{{ $patient->exists ? route('trips.patients.show', $patient) : route('trips.patients') }}">Cancel</a>
    </p>
    <datalist id="p-langs"><option value="English"><option value="Spanish"><option value="Vietnamese"><option value="Korean"><option value="Arabic"><option value="American Sign Language"></datalist>
</form>
@endsection

@push('scripts')
<script src="{{ asset('js/trips-combobox.js') }}"></script>
<script>
(function () {
    var rows = document.getElementById('payor-rows'), tpl = document.getElementById('payor-template').innerHTML, n = rows.children.length;
    var payers = null;
    function list() { return payers = payers || fetch(@json(route('trips.payers.json')), { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }); }
    function wire(row) {
        var name = row.querySelector('[data-payor-name]');
        TripsCombo.attach(name, { items: list, idInput: row.querySelector('[data-payor-id]'), allowNew: true, newLabel: function (t) { return 'Add "' + t + '" as a new payor'; } });
        var rel = row.querySelector('[data-rel]'), sub = row.querySelector('[data-sub]');
        function showSub() { sub.hidden = rel.value === 'self'; }
        rel.addEventListener('change', showSub); showSub();
    }
    function label() {
        var words = ['Primary', 'Secondary', 'Tertiary'];
        Array.prototype.forEach.call(rows.children, function (row, i) { row.querySelector('[data-pos]').textContent = words[i] || 'Payor ' + (i + 1); });
    }
    Array.prototype.forEach.call(rows.children, wire);
    label();
    document.getElementById('payor-add').addEventListener('click', function () {
        var box = document.createElement('div');
        box.innerHTML = tpl.replace(/__i__/g, 'n' + (n++));
        var row = box.firstElementChild;
        rows.appendChild(row);
        wire(row); label();
        row.querySelector('[data-payor-name]').focus();
    });
    rows.addEventListener('click', function (e) {
        var b = e.target.closest('[data-move]');
        if (!b) return;
        var row = b.closest('.payor-row');
        if (b.dataset.move === 'remove') row.remove();
        else if (b.dataset.move === 'up' && row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling);
        else if (b.dataset.move === 'down' && row.nextElementSibling) rows.insertBefore(row.nextElementSibling, row);
        label();
    });
    // Rows are saved in the order shown.
    document.getElementById('patient-form').addEventListener('submit', function () {
        Array.prototype.forEach.call(rows.children, function (row, i) {
            row.querySelectorAll('[name^="payors["]').forEach(function (el) { el.name = el.name.replace(/^payors\[[^\]]*\]/, 'payors[' + i + ']'); });
        });
    });
})();
</script>
@endpush
