<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Trips\Epcr;
use App\Trips\Models\Trip;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * ePCR import from CAD. The ePCR (or a small script beside it) pulls
 * GET /api/trips/epcr/trips?since=2026-11-18T06:00:00-05:00 with the header X-EPCR-Key, and gets every
 * trip given to a truck that changed since then (XML, or JSON with ?format=json). Dispatchers can
 * also download one trip's file from the trip drawer. Both are in the audit log by trip number.
 */
class EpcrController extends Controller
{
    public function feed(Request $request, Epcr $epcr)
    {
        if (! $epcr->keyMatches($request->header('X-EPCR-Key'))) {
            return response()->json(['error' => 'Bad or missing ePCR key.'], 401);
        }
        $in = $request->validate(['since' => ['nullable', 'date'], 'format' => ['nullable', 'in:xml,json'], 'limit' => ['nullable', 'integer', 'min:1', 'max:500']]);
        $since = isset($in['since']) ? Carbon::parse($in['since']) : now()->subDay();
        $trips = $epcr->changedSince($since, (int) ($in['limit'] ?? 200));
        Trip::whereKey($trips->modelKeys())->toBase()->update(['epcr_pulled_at' => now()]); // not updated_at, or they'd come back next time
        AuditLog::record('trips.epcr.feed', 'ePCR pulled '.$trips->count().' '.str('trip')->plural($trips->count()).($trips->isNotEmpty() ? ': '.$trips->pluck('trip_number')->join(', ') : '').'.', null, 'epcr-feed');
        // Ask again with ?since= this time to get only what changes next.
        $next = optional($trips->last())->updated_at?->toIso8601String() ?? $since->toIso8601String();
        $headers = ['X-Next-Since' => $next, 'Cache-Control' => 'no-store'];

        if (($in['format'] ?? 'xml') === 'json') {
            return response()->json(['nextSince' => $next, 'trips' => $trips->map(fn (Trip $t) => $epcr->json($t))->values()], 200, $headers);
        }

        return response($epcr->xml($trips), 200, $headers + ['Content-Type' => 'application/xml; charset=UTF-8']);
    }

    /** One trip's file, from the trip drawer. */
    public function file(Request $request, Trip $trip, Epcr $epcr)
    {
        AuditLog::record('trips.epcr.file', "Downloaded the ePCR file for trip {$trip->trip_number}.", $request->user());
        $trip->load(['vehicle', 'patient', 'orderingFacility', 'pickupFacility', 'destinationFacility']);

        return response($epcr->xml([$trip]), 200, [
            'Content-Type' => 'application/xml; charset=UTF-8', 'Cache-Control' => 'no-store',
            'Content-Disposition' => 'attachment; filename="'.$trip->trip_number.'-epcr.xml"',
        ]);
    }
}
