@extends('layouts.app')

@section('band')
    <h1>{{ $patient->exists ? 'Edit '.$patient->patient_number : 'Add a patient' }}</h1>
    <p>Everything here except insurance dates is encrypted when it's saved.</p>
@endsection

@section('content')
@php($v = fn ($k) => old($k, $patient->exists ? $patient->{$k} : ($patient->{$k} ?? null)))
@php($d = fn ($k) => old($k, $patient->{$k}?->toDateString()))
<div class="card">
    <form method="post" action="{{ $patient->exists ? route('trips.patients.update', $patient) : route('trips.patients.store') }}" autocomplete="off">@csrf
        @if ($patient->exists) @method('put')<input type="hidden" name="version" value="{{ $patient->version }}"> @endif
        <div class="field-row">
            <div class="field"><label for="p-last">Last name</label><input type="text" id="p-last" name="last_name" value="{{ $v('last_name') }}" required maxlength="60"></div>
            <div class="field"><label for="p-first">First name</label><input type="text" id="p-first" name="first_name" value="{{ $v('first_name') }}" required maxlength="60"></div>
            <div class="field"><label for="p-dob">Date of birth</label><input id="p-dob" type="date" name="dob" value="{{ $v('dob') }}" required></div>
            <div class="field"><label for="p-sex">Sex</label><select id="p-sex" name="sex">@foreach (['F' => 'Female', 'M' => 'Male', 'X' => 'X', 'U' => 'Unknown'] as $k => $l)<option value="{{ $k }}" @selected($v('sex') === $k)>{{ $l }}</option>@endforeach</select></div>
            <div class="field"><label for="p-wt">Weight (lb)</label><input id="p-wt" type="number" name="weight_lbs" min="1" max="1500" value="{{ $v('weight_lbs') }}"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-phone">Phone</label><input type="text" id="p-phone" name="phone" value="{{ $v('phone') }}" maxlength="30"></div>
            <div class="field" style="flex:2"><label for="p-addr">Home address</label><input type="text" id="p-addr" name="address" value="{{ $v('address') }}" maxlength="200"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-payer">Insurance</label><input type="text" id="p-payer" name="payer" value="{{ $v('payer') }}" maxlength="100" list="p-payers"></div>
            <div class="field"><label for="p-member">Member ID</label><input type="text" id="p-member" name="member_id" value="{{ $v('member_id') }}" maxlength="60"></div>
            <div class="field"><label for="p-pcs">PCS good until</label><input id="p-pcs" type="date" name="pcs_expires" value="{{ $d('pcs_expires') }}"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-auth">Prior auth #</label><input type="text" id="p-auth" name="prior_auth_number" value="{{ $v('prior_auth_number') }}" maxlength="60"></div>
            <div class="field"><label for="p-authx">Prior auth good until</label><input id="p-authx" type="date" name="prior_auth_expires" value="{{ $d('prior_auth_expires') }}"></div>
            <div class="field"><label for="p-authn">Trips authorized</label><input id="p-authn" type="number" name="trips_authorized" min="0" max="999" value="{{ $v('trips_authorized') }}"></div>
        </div>
        <div class="field-row">
            <div class="field"><label for="p-level">Usual level</label><select id="p-level" name="default_level">@foreach (\App\Models\ScopeItem::LEVELS as $k => $l)<option value="{{ $k }}" @selected($v('default_level') === $k)>{{ $l }}</option>@endforeach</select></div>
        </div>
        <fieldset class="plain-fieldset"><legend>Usual equipment</legend>
            @php($eq = old('default_equipment', $patient->default_equipment ?? []))
            @foreach (\App\Trips\Models\Trip::EQUIPMENT as $k => $l)<label class="check"><input type="checkbox" name="default_equipment[]" value="{{ $k }}" @checked(in_array($k, $eq, true))> {{ $l }}</label>@endforeach
        </fieldset>
        <div class="field"><label for="p-why">Reason for stretcher (medical necessity)</label><input type="text" id="p-why" name="stretcher_reason" value="{{ $v('stretcher_reason') }}" maxlength="500"></div>
        <div class="field"><label for="p-notes">Medical notes for crews</label><textarea id="p-notes" name="medical_notes" rows="3" maxlength="2000">{{ $v('medical_notes') }}</textarea></div>
        <label class="check"><input type="hidden" name="active" value="0"><input type="checkbox" name="active" value="1" @checked($v('active'))> Active (shows up in trip intake)</label>
        <p>
            <button type="submit" class="btn">{{ $patient->exists ? 'Save' : 'Add patient' }}</button>
            <a class="btn btn-outline" href="{{ $patient->exists ? route('trips.patients.show', $patient) : route('trips.patients') }}">Cancel</a>
        </p>
        <datalist id="p-payers"><option value="Medicare"><option value="Medicaid"><option value="Private pay"></datalist>
    </form>
</div>
@endsection
