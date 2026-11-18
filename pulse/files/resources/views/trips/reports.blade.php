@extends('layouts.app')

{{-- Dispatch > Trip Reports. Counts and times only, no patient details. --}}
@section('band')
    <h1>Trip Reports</h1>
    <p>Volume, on-time pickups, ASAP response and truck use for {{ $from->format('M j, Y') }} to {{ $to->format('M j, Y') }}. No patient details are on this page or in its CSV.</p>
@endsection

@section('content')
@php($bars = function (array $rows) { $max = max(1, ...array_column($rows, 'count') ?: [1]); return $rows ? collect($rows)->map(fn ($x) => '<div class="tr-bar"><span>'.e($x['key']).'</span><span><i style="width:'.round($x['count'] * 100 / $max).'%"></i></span><b>'.$x['count'].'</b></div>')->join('') : '<p class="empty">None.</p>'; })
@php($qs = '?from='.$from->toDateString().'&to='.$to->toDateString())
<div class="stack">
    <div class="card">
        <form method="get" class="field-row" style="align-items:flex-end">
            <div class="field"><label for="r-from">From</label><input id="r-from" type="date" name="from" value="{{ $from->toDateString() }}"></div>
            <div class="field"><label for="r-to">To</label><input id="r-to" type="date" name="to" value="{{ $to->toDateString() }}"></div>
            <div class="field"><button type="submit" class="btn">Show</button></div>
            <div class="field">
                <a class="btn btn-outline" href="{{ route('trips.reports.csv') }}{{ $qs }}">Download CSV</a>
                @if (auth()->user()->hasPermission('trips_supervise'))
                    <a class="btn btn-outline" href="{{ route('trips.reports.billing') }}{{ $qs }}" title="Completed trips with patient names, insurance and loaded miles. Each download is logged.">Billing export (patient info)</a>
                @endif
            </div>
        </form>
    </div>

    <div class="tr-kpis">
        <div class="tr-kpi"><b>{{ $r['total'] }}</b>Trips</div>
        <div class="tr-kpi"><b>{{ $r['completed'] }}</b>Completed</div>
        <div class="tr-kpi"><b>{{ $r['cancelled'] }}</b>Cancelled</div>
        <div class="tr-kpi"><b>{{ $r['open'] }}</b>Still open</div>
        <div class="tr-kpi"><b>{{ $r['onTimePct'] === null ? '—' : $r['onTimePct'].'%' }}</b>On-time pickups <span class="hint">({{ $r['onTimeBase'] }} scheduled, within {{ $r['lateMinutes'] }} min)</span></div>
        <div class="tr-kpi"><b>{{ $r['asapAvgMin'] === null ? '—' : $r['asapAvgMin'].' min' }}</b>ASAP booked to on scene</div>
        <div class="tr-kpi"><b>{{ $r['loadedMiles'] }}</b>Loaded miles</div>
    </div>

    <div class="card">
        <h2>Trucks</h2>
        @if (! $r['units'])
            <p class="empty">No completed trips in this range.</p>
        @else
            <div class="table-wrap"><table>
                <tr><th>Truck</th><th>Trips</th><th>Busy hours</th><th>Loaded miles</th></tr>
                @foreach ($r['units'] as $u)<tr><td>{{ $u['unit'] }}</td><td>{{ $u['trips'] }}</td><td>{{ $u['busyHours'] }}</td><td>{{ $u['loadedMiles'] }}</td></tr>@endforeach
            </table></div>
        @endif
    </div>

    <div class="field-row" style="align-items:stretch">
        <div class="card" style="flex:1"><h2>By trip type</h2>{!! $bars($r['byTripType']) !!}</div>
        <div class="card" style="flex:1"><h2>By level</h2>{!! $bars($r['byLevel']) !!}</div>
    </div>
    <div class="field-row" style="align-items:stretch">
        <div class="card" style="flex:1"><h2>By insurance</h2>{!! $bars($r['byPayer']) !!}</div>
        <div class="card" style="flex:1"><h2>By status</h2>{!! $bars($r['byStatus']) !!}</div>
    </div>
    <div class="card"><h2>Why trips were cancelled</h2>{!! $bars($r['cancelReasons']) !!}</div>
</div>
@endsection
