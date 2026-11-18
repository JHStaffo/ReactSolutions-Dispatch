<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Vehicle;
use App\Trips\Models\Facility;
use App\Trips\Models\Trip;
use App\Trips\Reports;
use App\Trips\Trips;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/** Trip reports (no patient details), the billing export (PHI, audited) and printable run sheets (PHI, audited). */
class ReportController extends Controller
{
    public function __construct(private Reports $reports) {}

    public function index(Request $request)
    {
        [$from, $to] = $this->range($request);

        return view('trips.reports', [
            'r' => $this->reports->summary($from, $to->copy()->addDay()),
            'from' => $from, 'to' => $to, 'title' => 'Trip Reports',
        ]);
    }

    public function csv(Request $request)
    {
        [$from, $to] = $this->range($request);
        $r = $this->reports->summary($from, $to->copy()->addDay());

        return Reports::csv($this->reports->summaryRows($r, $from->toDateString().' to '.$to->toDateString()), 'trip-report-'.$from->toDateString().'-to-'.$to->toDateString().'.csv');
    }

    public function billing(Request $request)
    {
        [$from, $to] = $this->range($request);
        $rows = $this->reports->billingRows($from, $to->copy()->addDay());
        audit_note('Billing export (patient information): '.(count($rows) - 1).' completed trips, '.$from->toDateString().' to '.$to->toDateString().'.');

        return Reports::csv($rows, 'trip-billing-'.$from->toDateString().'-to-'.$to->toDateString().'.csv');
    }

    /** One truck's trips for a day, to print. Printing patient details is audited. */
    public function runSheet(Request $request, Vehicle $vehicle, Trips $trips)
    {
        $day = $request->filled('day') ? Carbon::parse($request->string('day'))->startOfDay() : today();
        $list = Trip::with('patient')->where('vehicle_id', $vehicle->id)->whereBetween('scheduled_start', [$day, $day->copy()->endOfDay()])
            ->where('status', '!=', 'cancelled')->orderBy('scheduled_start')->get();
        AuditLog::record('trips.run-sheet', "Printed the run sheet for {$vehicle->name} on {$day->toDateString()}: ".($list->pluck('trip_number')->join(', ') ?: 'no trips').'.', $request->user());
        $unit = $trips->unit($vehicle, \App\Fleet\Models\Assignment::with('members')->where('vehicle_id', $vehicle->id)->where('starts_at', '<', $day->copy()->endOfDay())->where('ends_at', '>', $day)->get());

        return view('trips.run-sheet', [
            'unit' => $unit, 'day' => $day, 'trips' => $list, 'phones' => Facility::pluck('phone', 'id'),
            'title' => 'Run sheet '.$unit['name'],
        ]);
    }

    /** [from, to] inclusive days; defaults to the last 7 days. */
    private function range(Request $request): array
    {
        try {
            $from = $request->filled('from') ? Carbon::parse($request->string('from'))->startOfDay() : today()->subDays(6);
            $to = $request->filled('to') ? Carbon::parse($request->string('to'))->startOfDay() : today();
        } catch (\Throwable) {
            [$from, $to] = [today()->subDays(6), today()];
        }
        if ($to->lt($from)) {
            [$from, $to] = [$to, $from];
        }
        if ($from->diffInDays($to) > 366) {
            $from = $to->copy()->subDays(366);
        }

        return [$from, $to];
    }
}
