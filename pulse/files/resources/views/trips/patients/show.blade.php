@extends('layouts.app')

@section('band')
    <h1>{{ $patient->fullName() }} <span class="hint">{{ $patient->patient_number }}</span></h1>
    <p>DOB {{ $patient->dob }} (age {{ $patient->age() }}) · {{ ['F' => 'Female', 'M' => 'Male', 'X' => 'X', 'U' => 'Sex unknown'][$patient->sex] ?? $patient->sex }}@if ($patient->weight_lbs) · {{ $patient->weight_lbs }} lb @endif @if ($patient->height_in) · {{ intdiv($patient->height_in, 12) }}′{{ $patient->height_in % 12 }}″ @endif @if ($patient->language && strcasecmp($patient->language, 'English')) · Speaks {{ $patient->language }}@endif · Usual level {{ \App\Models\ScopeItem::LEVELS[$patient->default_level] ?? $patient->default_level }}@unless ($patient->active) · <strong>Inactive</strong>@endunless</p>
@endsection

@section('content')
@php($when = fn ($t) => ($t->startsAt() ?? $t->created_at)?->setTimezone(config('app.timezone')))
<div class="stack">
    <div class="card">
        @if ($patient->deceased_on)<p><span class="pill pill-red">Deceased {{ $patient->deceased_on->format('m/d/Y') }}</span></p>@endif
        @if ($patient->dispatch_notes)<p class="trip-alert-note"><strong>Dispatch notes:</strong> {{ $patient->dispatch_notes }}</p>@endif
        <div class="field-row">
            <div>
                <h2>Contact</h2>
                <p>
                    {{ $patient->phone ?: 'No phone' }}@if ($patient->email)<br>{{ $patient->email }}@endif<br>
                    {{ $patient->fullAddress() ?: 'No home address' }}@if ($patient->county)<br><span class="hint">{{ $patient->county }} County</span>@endif
                    @if ($patient->facility)<br>Lives at <strong>{{ $patient->facility->name }}</strong>@endif
                    @if ($patient->reminders_opt_out)<br><span class="hint">No reminder calls or texts</span>@endif
                </p>
                @if ($patient->nok_name)<p><strong>Next of kin:</strong> {{ $patient->nok_name }}@if ($patient->nok_relationship) ({{ $patient->nok_relationship }})@endif @if ($patient->nok_phone) · {{ $patient->nok_phone }}@endif</p>@endif
                @if ($patient->pcp_name)<p><strong>Primary care:</strong> {{ $patient->pcp_name }}@if ($patient->pcp_npi) · NPI {{ $patient->pcp_npi }}@endif @if ($patient->pcp_phone) · {{ $patient->pcp_phone }}@endif</p>@endif
            </div>
            <div>
                <h2>Payors</h2>
                @forelse ($patient->payers as $pp)
                    <p>
                        <strong>{{ $pp->positionLabel() }}:</strong> {{ $pp->payer?->name }}<br>
                        <span class="hint">
                            @if ($pp->member_id)Member {{ $pp->member_id }}@endif @if ($pp->group_number) · Group {{ $pp->group_number }}@endif
                            @if ($pp->subscriber_relationship !== 'self') · Policy holder {{ $pp->subscriber_name ?: 'not given' }} ({{ strtolower(\App\Trips\Models\PatientPayer::RELATIONSHIPS[$pp->subscriber_relationship] ?? $pp->subscriber_relationship) }})@endif
                            @if ($pp->effective_from || $pp->effective_to)<br>{{ $pp->effective_from?->format('m/d/Y') ?? '…' }} to {{ $pp->effective_to?->format('m/d/Y') ?? 'open' }}@endif
                            @if ($pp->eligibility_checked_on)<br>Eligibility checked {{ $pp->eligibility_checked_on->format('m/d/Y') }}@endif
                        </span>
                        @if ($pp->effective_to?->isPast())<span class="pill pill-red">Ended</span>@endif
                    </p>
                @empty
                    <p class="empty">No payors on file.</p>
                @endforelse
            </div>
            <div>
                <h2>Paperwork</h2>
                <p>
                    PCS: @if (! $patient->pcs_expires)<span class="pill pill-amber">No date</span>@elseif ($patient->pcs_expires->isPast())<span class="pill pill-red">Expired {{ $patient->pcs_expires->format('m/d/Y') }}</span>@else<span class="pill pill-green">Good to {{ $patient->pcs_expires->format('m/d/Y') }}</span>@endif<br>
                    Prior auth: {{ $patient->prior_auth_number ?: 'None' }}@if ($patient->prior_auth_expires) (to {{ $patient->prior_auth_expires->format('m/d/Y') }}@if ($patient->prior_auth_expires->isPast()), <strong>expired</strong>@endif)@endif
                    @if ($patient->trips_authorized) · {{ $patient->trips_authorized }} trips authorized @endif
                    @if ($patient->mrn)<br>MRN {{ $patient->mrn }}@endif
                    @if ($patient->external_code)<br>Other system id {{ $patient->external_code }}@endif
                </p>
            </div>
        </div>
        @if ($patient->default_equipment)<p><strong>Usual equipment:</strong> {{ collect($patient->default_equipment)->map(fn ($e) => \App\Trips\Models\Trip::EQUIPMENT[$e] ?? $e)->join(', ') }}</p>@endif
        @if ($patient->stretcher_reason)<p><strong>Reason for stretcher:</strong> {{ $patient->stretcher_reason }}</p>@endif
        @if ($patient->baseline)<p><strong>Baseline:</strong> {{ $patient->baseline }}</p>@endif
        @if ($patient->medical_notes)<p><strong>Notes:</strong> {{ $patient->medical_notes }}</p>@endif
        @if ($patient->pickup_extra_min || $patient->dropoff_extra_min)<p><strong>Allow extra time:</strong> {{ (int) $patient->pickup_extra_min }} min at pickup, {{ (int) $patient->dropoff_extra_min }} min at drop-off</p>@endif
        <p>
            <a class="btn btn-small" href="{{ route('trips.patients.edit', $patient) }}">Edit</a>
            <a class="btn btn-small btn-outline" href="{{ url('/trips') }}?patient={{ $patient->id }}">Book a trip</a>
            <span class="hint">Last changed {{ $patient->updated_at?->setTimezone(config('app.timezone'))->format('m/d/Y g:i A') }}@if ($patient->updater) by {{ $patient->updater->name }}@endif</span>
        </p>
    </div>

    <div class="card">
        <h2>Scheduled and open trips ({{ $upcoming->count() }})</h2>
        @if ($upcoming->isEmpty())
            <p class="empty">Nothing scheduled.</p>
        @else
            <div class="table-wrap"><table>
                <tr><th>Trip</th><th>When</th><th>Type</th><th>From → To</th><th>Truck</th><th>Status</th></tr>
                @foreach ($upcoming as $t)
                    <tr>
                        <td><a href="{{ url('/trips') }}?day={{ $when($t)?->toDateString() }}&trip={{ $t->id }}">{{ $t->trip_number }}</a>@if (in_array($t->leg, ['outbound', 'return'], true))<div class="hint">{{ ucfirst($t->leg) }} leg</div>@endif</td>
                        <td>{{ $t->pickup_mode === 'will_call' && ! $t->scheduled_start ? 'Will-call' : $when($t)?->format('D m/d g:i A') }}</td>
                        <td>{{ \App\Trips\Models\Trip::TYPES[$t->trip_type] ?? $t->trip_type }}</td>
                        <td>{{ $t->pickup_location }} → {{ $t->destination }}</td>
                        <td>{{ $t->vehicle?->name ?: '—' }}</td>
                        <td>{{ \App\Trips\Models\Trip::STATUSES[$t->status] ?? $t->status }}@foreach ($alerts[$t->id] ?? [] as $a) <span class="pill {{ str_contains($a, 'expired') || $a === 'No PCS' ? 'pill-red' : 'pill-amber' }}">{{ $a }}</span>@endforeach</td>
                    </tr>
                @endforeach
            </table></div>
        @endif
    </div>

    <div class="card">
        <h2>Past trips ({{ $past->count() }})</h2>
        @if ($past->isEmpty())
            <p class="empty">No past trips.</p>
        @else
            <div class="table-wrap"><table>
                <tr><th>Trip</th><th>Date</th><th>Type</th><th>From → To</th><th>Truck</th><th>Result</th></tr>
                @foreach ($past as $t)
                    <tr>
                        <td>{{ $t->trip_number }}</td>
                        <td>{{ $when($t)?->format('m/d/Y') }}</td>
                        <td>{{ \App\Trips\Models\Trip::TYPES[$t->trip_type] ?? $t->trip_type }}</td>
                        <td>{{ $t->pickup_location }} → {{ $t->destination }}</td>
                        <td>{{ $t->vehicle?->name ?: '—' }}</td>
                        <td>@if ($t->status === 'cancelled')<span class="pill pill-red">Cancelled</span> <span class="hint">{{ $t->cancel_reason }}</span>@else<span class="pill pill-green">Completed</span>@if ($t->loaded_miles !== null) <span class="hint">{{ $t->loaded_miles }} loaded mi</span>@endif @endif</td>
                    </tr>
                @endforeach
            </table></div>
        @endif
    </div>
</div>
@endsection
