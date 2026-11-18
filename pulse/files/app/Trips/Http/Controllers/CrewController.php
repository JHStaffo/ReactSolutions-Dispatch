<?php

namespace App\Trips\Http\Controllers;

use App\Fleet\Models\Assignment;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Vehicle;
use App\Trips\Gps;
use App\Trips\Models\Trip;
use App\Trips\Trips;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Dispatch > My Trips: the crew's phone screen. A Team Member sees the trips for the truck
 * Vehicle Assignments has them on right now (or later today), and moves them along one tap at a time.
 */
class CrewController extends Controller
{
    public function __construct(private Trips $trips) {}

    public function index(Request $request)
    {
        return view('trips.crew', ['title' => 'My Trips', 'constants' => BoardController::constants()]);
    }

    public function data(Request $request)
    {
        $user = $request->user();
        $assignments = $this->assignments($user);
        $vehicleIds = $assignments->pluck('vehicle_id')->unique()->values()->all();
        $trips = Trip::with('patient', 'pickupFacility', 'destinationFacility')->whereIn('vehicle_id', $vehicleIds)
            ->where(fn ($q) => $q->whereBetween('scheduled_start', [today()->subDay(), today()->addDays(2)])->orWhereIn('status', Trip::ACTIVE))
            ->orderBy('scheduled_start')->get();
        if ($trips->isNotEmpty() && $request->boolean('opened')) {
            \App\Models\AuditLog::record('trips.crew.view', 'Opened My Trips: '.$trips->pluck('trip_number')->join(', ').'.', $user);
        }

        return response()->json([
            'seq' => $this->trips->lastEventId(),
            'trucks' => Vehicle::whereIn('id', $vehicleIds)->get()->map(fn (Vehicle $v) => $this->trips->unit($v, $assignments->where('vehicle_id', $v->id)->values())),
            'unitStatuses' => \App\Trips\Mdt::UNIT_STATUSES,
            'trips' => $trips->map(fn (Trip $t) => $this->crewTrip($t, $user))->values(),
        ]);
    }

    public function status(Request $request, Trip $trip)
    {
        $in = $request->validate(['expected_version' => ['required', 'integer']]);
        $user = $request->user();
        if (! in_array($trip->vehicle_id, $this->assignments($user)->pluck('vehicle_id')->all(), true)) {
            abort(403, 'That trip isn\'t on your truck.');
        }
        $i = array_search($trip->status, Trip::FLOW, true);
        $next = $i === false ? null : (Trip::FLOW[$i + 1] ?? null);
        if (! $next) {
            throw ValidationException::withMessages(['status' => 'This trip has no next step.']);
        }
        $t = $this->trips->setStatus($trip, $next, $in['expected_version'], $user);

        return response()->json(['trip' => $this->crewTrip($t->fresh(['patient', 'pickupFacility', 'destinationFacility']), $user)]);
    }

    /** The truck's own status from the MDT (available, at station, out of service...). */
    public function unitStatus(Request $request, \App\Trips\Mdt $mdt)
    {
        $in = $request->validate(['vehicle_id' => ['required', 'integer'], 'status' => ['required', \Illuminate\Validation\Rule::in(array_keys(\App\Trips\Mdt::UNIT_STATUSES))]]);
        if (! in_array($in['vehicle_id'], $this->assignments($request->user())->pluck('vehicle_id')->all(), true)) {
            abort(403, 'You aren\'t on that truck.');
        }
        $mdt->setUnitStatus(Vehicle::findOrFail($in['vehicle_id']), $in['status'], $request->user());

        return response()->json(['ok' => true]);
    }

    /** Odometer readings and a note to dispatch. */
    public function details(Request $request, Trip $trip, \App\Trips\Mdt $mdt)
    {
        $in = $request->validate([
            'expected_version' => ['required', 'integer'],
            'odometer_pickup' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
            'odometer_destination' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
            'crew_notes' => ['nullable', 'string', 'max:1000'],
        ]);
        $user = $request->user();
        if (! in_array($trip->vehicle_id, $this->assignments($user)->pluck('vehicle_id')->all(), true)) {
            abort(403, 'That trip isn\'t on your truck.');
        }
        $t = $mdt->update($trip, $in, $in['expected_version'], $user);

        return response()->json(['trip' => $this->crewTrip($t->fresh(['patient', 'pickupFacility', 'destinationFacility']), $user)]);
    }

    /** A crew phone sharing its location (when the truck's GPS unit is down). */
    public function location(Request $request, Gps $gps)
    {
        $in = $request->validate(['lat' => ['required', 'numeric', 'between:-90,90'], 'lon' => ['required', 'numeric', 'between:-180,180'], 'speed_mph' => ['nullable', 'numeric'], 'heading' => ['nullable', 'numeric']]);
        $vehicle = Vehicle::whereIn('id', $this->assignments($request->user())->pluck('vehicle_id'))->first();
        if (! $vehicle) {
            abort(422, 'You aren\'t on a truck right now.');
        }
        $device = $vehicle->gps_device_id ?: 'PHONE-'.$vehicle->id;
        $gps->ingest([['deviceId' => $device, 'lat' => $in['lat'], 'lon' => $in['lon'], 'speedMph' => $in['speed_mph'] ?? 0, 'heading' => $in['heading'] ?? 0]], 'phone');

        return response()->json(['ok' => true, 'vehicle' => $vehicle->name]);
    }

    /** The user's crew assignments from an hour before their shift to an hour after, today. */
    private function assignments(User $user): Collection
    {
        return Assignment::whereHas('members', fn ($q) => $q->where('user_id', $user->id))
            ->with('members')->whereNotNull('vehicle_id')
            ->where('starts_at', '<=', now()->addHours(12))->where('ends_at', '>=', now()->subHour())
            ->orderBy('starts_at')->get();
    }

    private function crewTrip(Trip $t, User $user): array
    {
        $s = $this->trips->summary($t, $user);
        // Crews need the patient's name and the clinical picture to run the call (minimum necessary for the job).
        return array_merge($s, [
            'patientName' => $t->patient_last.', '.$t->patient_first,
            'pickupLocation' => $t->pickup_location,
            'destination' => $t->destination,
            'chiefComplaint' => $t->chief_complaint,
            'stretcherReason' => $t->stretcher_reason,
            'notes' => $t->notes,
            'pickupPhone' => $t->pickup_phone ?: $t->pickupFacility?->phone,
            'destinationPhone' => $t->dropoff_phone ?: $t->destinationFacility?->phone,
            'pickupRoom' => $t->pickup_room,
            'dropoffRoom' => $t->dropoff_room,
            'diagnoses' => $t->diagnoses ?? [],
            'patientNotes' => array_filter(['dispatch' => $t->patient?->dispatch_notes, 'baseline' => $t->patient?->baseline]),
            'crewNotes' => $t->crew_notes,
            'odometerPickup' => $t->odometer_pickup,
            'odometerDestination' => $t->odometer_destination,
        ]);
    }
}
