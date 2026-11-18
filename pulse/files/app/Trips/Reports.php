<?php

namespace App\Trips;

use App\Models\Setting;
use App\Models\Vehicle;
use App\Trips\Models\Trip;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Trip reports: counts and times only, no patient details. (Billing is done from the ePCR, which
 * pulls each call from App\Trips\Epcr.)
 */
class Reports
{
    /** Trips whose day (slot, else pickup time, else when booked) falls in [from, to). */
    public function tripsBetween(Carbon $from, Carbon $to): Collection
    {
        return Trip::with('vehicle')
            ->where(fn ($q) => $q->whereBetween('scheduled_start', [$from, $to])
                ->orWhere(fn ($q) => $q->whereNull('scheduled_start')->whereBetween('pickup_time', [$from, $to]))
                ->orWhere(fn ($q) => $q->whereNull('scheduled_start')->whereNull('pickup_time')->whereBetween('created_at', [$from, $to])))
            ->get()
            ->filter(fn (Trip $t) => ($day = $t->startsAt() ?? $t->created_at) && $day->gte($from) && $day->lt($to))
            ->values();
    }

    public function summary(Carbon $from, Carbon $to): array
    {
        $trips = $this->tripsBetween($from, $to);
        $completed = $trips->where('status', 'completed');
        $late = (int) Setting::get('trips_late_minutes');
        $at = fn (Trip $t, string $s) => isset($t->status_times[$s]) ? Carbon::parse($t->status_times[$s]) : null;

        // On time: crew on scene within the late window of a scheduled pickup.
        $scheduled = $trips->filter(fn (Trip $t) => $t->pickup_mode === 'scheduled' && $t->pickup_time && $at($t, 'on_scene'));
        $onTime = $scheduled->filter(fn (Trip $t) => $at($t, 'on_scene')->lte($t->pickup_time->copy()->addMinutes($late)))->count();
        // ASAP response: booked to on scene.
        $asap = $trips->filter(fn (Trip $t) => $t->pickup_mode === 'asap' && $at($t, 'on_scene') && $at($t, 'queued'));
        // ASAP with a quoted time: on scene by the time promised to the caller.
        $quoted = $asap->filter(fn (Trip $t) => $t->quoted_time);
        $quotedMet = $quoted->filter(fn (Trip $t) => $at($t, 'on_scene')->lte($t->quoted_time))->count();
        $asapAvg = $asap->isEmpty() ? null : (int) round($asap->avg(fn (Trip $t) => $at($t, 'queued')->diffInMinutes($at($t, 'on_scene'))));

        $count = fn (Collection $c, callable $key) => $c->groupBy($key)->map->count()->sortDesc()
            ->map(fn ($n, $k) => ['key' => $k ?: 'Not set', 'count' => $n])->values()->all();

        $units = $completed->filter(fn (Trip $t) => $t->vehicle_id)->groupBy('vehicle_id')->map(function (Collection $c, $vehicleId) use ($at) {
            $v = $c->first()->vehicle ?? Vehicle::find($vehicleId);
            $busy = $c->sum(fn (Trip $t) => ($s = $at($t, 'enroute') ?? $at($t, 'assigned')) && ($e = $at($t, 'completed')) ? $s->diffInMinutes($e) : 0);

            return [
                'vehicleId' => (int) $vehicleId, 'unit' => $v?->name ?: $v?->plate ?: 'Truck #'.$vehicleId,
                'trips' => $c->count(), 'busyHours' => round($busy / 60, 1), 'loadedMiles' => round($c->sum('loaded_miles'), 1),
            ];
        })->sortByDesc('trips')->values()->all();

        return [
            'total' => $trips->count(),
            'completed' => $completed->count(),
            'cancelled' => $trips->where('status', 'cancelled')->count(),
            'open' => $trips->filter->isOpen()->count(),
            'onTimePct' => $scheduled->isEmpty() ? null : (int) round($onTime * 100 / $scheduled->count()),
            'onTimeBase' => $scheduled->count(),
            'asapAvgMin' => $asapAvg,
            'quotedPct' => $quoted->isEmpty() ? null : (int) round($quotedMet * 100 / $quoted->count()),
            'quotedBase' => $quoted->count(),
            'loadedMiles' => round($completed->sum('loaded_miles'), 1),
            'byTripType' => $count($trips, fn (Trip $t) => Trip::TYPES[$t->trip_type] ?? $t->trip_type),
            'byLevel' => $count($trips, fn (Trip $t) => \App\Models\ScopeItem::LEVELS[$t->level] ?? $t->level),
            'byPayer' => $count($trips, fn (Trip $t) => $t->payer),
            'byStatus' => $count($trips, fn (Trip $t) => Trip::STATUSES[$t->status] ?? $t->status),
            'cancelReasons' => $count($trips->where('status', 'cancelled'), fn (Trip $t) => $t->cancel_reason),
            'units' => $units,
            'lateMinutes' => $late,
        ];
    }

    /** Rows for the summary CSV (counts only). */
    public function summaryRows(array $r, string $label): array
    {
        return [
            ['Trip report', $label], [],
            ['Metric', 'Value'],
            ['Total trips', $r['total']], ['Completed', $r['completed']], ['Cancelled', $r['cancelled']], ['Still open', $r['open']],
            ['On-time pickups %', $r['onTimePct']], ['ASAP average response (min)', $r['asapAvgMin']], ['ASAP on scene by quoted time %', $r['quotedPct']], ['Loaded miles', $r['loadedMiles']], [],
            ['Unit', 'Trips', 'Busy hours', 'Loaded miles'],
            ...array_map(fn ($u) => [$u['unit'], $u['trips'], $u['busyHours'], $u['loadedMiles']], $r['units']), [],
            ['Trip type', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['byTripType']), [],
            ['Level', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['byLevel']), [],
            ['Payer', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['byPayer']), [],
            ['Cancellation reason', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['cancelReasons']),
        ];
    }

    /** A CSV download. Cells that start like a formula are prefixed so a spreadsheet won't run them. */
    public static function csv(array $rows, string $filename)
    {
        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            foreach ($rows as $row) {
                fputcsv($out, array_map(fn ($v) => is_string($v) && preg_match('/^[=+\-@\t\r]/', $v) ? "'".$v : $v, $row));
            }
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv', 'Cache-Control' => 'no-store']);
    }
}
