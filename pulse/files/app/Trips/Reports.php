<?php

namespace App\Trips;

use App\Models\Setting;
use App\Models\Vehicle;
use App\Trips\Models\Trip;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Trip reports. The summary has counts and times only (no patient details); the billing export is
 * the one place patient names leave Pulse, so it's trips_supervise only and audited.
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
            ['On-time pickups %', $r['onTimePct']], ['ASAP average response (min)', $r['asapAvgMin']], ['Loaded miles', $r['loadedMiles']], [],
            ['Unit', 'Trips', 'Busy hours', 'Loaded miles'],
            ...array_map(fn ($u) => [$u['unit'], $u['trips'], $u['busyHours'], $u['loadedMiles']], $r['units']), [],
            ['Trip type', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['byTripType']), [],
            ['Level', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['byLevel']), [],
            ['Payer', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['byPayer']), [],
            ['Cancellation reason', 'Trips'], ...array_map(fn ($x) => [$x['key'], $x['count']], $r['cancelReasons']),
        ];
    }

    /** Completed trips with patient, payer, paperwork and loaded miles, for billing. PHI. */
    public function billingRows(Carbon $from, Carbon $to): array
    {
        $rows = [['Trip #', 'Date', 'Last name', 'First name', 'DOB', 'Payer', 'Member ID', 'Prior auth', 'PCS on file', 'Level', 'Trip type', 'Leg', 'Pickup', 'Destination', 'Unit', 'En route', 'On scene', 'Transporting', 'At destination', 'Completed', 'Loaded miles']];
        $time = fn (Trip $t, string $s) => isset($t->status_times[$s]) ? Carbon::parse($t->status_times[$s])->setTimezone(config('app.timezone'))->format('H:i') : '';
        foreach ($this->tripsBetween($from, $to)->where('status', 'completed')->sortBy(fn (Trip $t) => $t->startsAt()?->timestamp) as $t) {
            $rows[] = [
                $t->trip_number, $t->startsAt()?->toDateString(), $t->patient_last, $t->patient_first, $t->patient_dob,
                $t->payer, $t->member_id, $t->prior_auth, $t->pcs_on_file ? 'Yes' : 'No',
                \App\Models\ScopeItem::LEVELS[$t->level] ?? $t->level, Trip::TYPES[$t->trip_type] ?? $t->trip_type, $t->leg,
                $t->pickup_location, $t->destination, $t->vehicle?->name ?: $t->vehicle?->plate,
                $time($t, 'enroute'), $time($t, 'on_scene'), $time($t, 'transporting'), $time($t, 'at_destination'), $time($t, 'completed'),
                $t->loaded_miles,
            ];
        }

        return $rows;
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
