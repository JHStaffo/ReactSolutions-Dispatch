@extends('layouts.app')

{{-- A truck's trips for the day, to print. Opening it is in the audit log. --}}
@section('bare')
@php($tz = config('app.timezone'))
<div class="rs-bar">
    <button type="button" class="btn" onclick="window.print()">Print</button>
    <a class="btn btn-outline" href="{{ url('/trips') }}?day={{ $day->toDateString() }}">Back to the board</a>
    <span class="hint">Contains patient information. Shred printed copies after the shift.</span>
</div>
<div class="rs-sheet">
    <div class="rs-head">
        <div><h1 style="margin:0">{{ $unit['name'] }}</h1>{{ $unit['levelLabel'] ?? '' }}@if ($unit['phone']) · {{ $unit['phone'] }}@endif</div>
        <div style="text-align:right"><strong>{{ $day->format('l, F j, Y') }}</strong><br>
            @foreach ($unit['shifts'] as $s){{ \Illuminate\Support\Carbon::parse($s['starts'])->setTimezone($tz)->format('H:i') }}–{{ \Illuminate\Support\Carbon::parse($s['ends'])->setTimezone($tz)->format('H:i') }}: {{ collect($s['crew'])->pluck('name')->join(', ') ?: 'No crew' }}<br>@endforeach
        </div>
    </div>
    @forelse ($trips as $i => $t)
        <div class="rs-trip">
            <strong>{{ $i + 1 }}. {{ $t->scheduled_start?->setTimezone($tz)->format('H:i') }} · {{ $t->trip_number }} · {{ \App\Models\ScopeItem::LEVELS[$t->level] ?? $t->level }} · {{ \App\Trips\Models\Trip::TYPES[$t->trip_type] ?? $t->trip_type }}@if (in_array($t->leg, ['outbound', 'return'], true)) ({{ $t->leg }} leg)@endif</strong>
            <table>
                <tr><th>Patient</th><td>{{ $t->patient_last }}, {{ $t->patient_first }} · DOB {{ $t->patient_dob }} (age {{ \App\Trips\Trips::age($t->patient_dob) }})@if ($t->weight_lbs) · {{ $t->weight_lbs }} lb @endif</td></tr>
                <tr><th>Pickup</th><td>{{ $t->pickup_location }}@if ($t->pickup_facility_id && ($phones[$t->pickup_facility_id] ?? null)) · {{ $phones[$t->pickup_facility_id] }}@endif @if ($t->pickup_mode === 'will_call') (will-call)@endif</td></tr>
                <tr><th>Destination</th><td>{{ $t->destination }}@if ($t->destination_facility_id && ($phones[$t->destination_facility_id] ?? null)) · {{ $phones[$t->destination_facility_id] }}@endif</td></tr>
                <tr><th>Complaint</th><td>{{ $t->chief_complaint }}</td></tr>
                <tr><th>Stretcher reason</th><td>{{ $t->stretcher_reason }}</td></tr>
                @if ($t->equipment)<tr><th>Equipment</th><td>{{ collect($t->equipment)->map(fn ($e) => \App\Trips\Models\Trip::EQUIPMENT[$e] ?? $e)->join(', ') }}</td></tr>@endif
                <tr><th>Insurance</th><td>{{ $t->payer ?: '—' }}@if ($t->member_id) · {{ $t->member_id }}@endif · PCS {{ $t->pcs_on_file ? 'on file' : 'NOT on file' }}@if ($t->prior_auth) · Auth {{ $t->prior_auth }}@endif</td></tr>
                @if ($t->notes)<tr><th>Notes</th><td>{{ $t->notes }}</td></tr>@endif
                <tr><th>Times</th><td>En route ____ On scene ____ Transporting ____ At dest ____ Clear ____ &nbsp; Loaded miles ____</td></tr>
            </table>
        </div>
    @empty
        <p class="empty">No trips on this truck for the day.</p>
    @endforelse
    <p class="hint">Printed {{ now()->setTimezone($tz)->format('m/d/Y H:i') }} by {{ auth()->user()->name }}.</p>
</div>
@endsection
