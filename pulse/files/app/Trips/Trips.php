<?php

namespace App\Trips;

use App\Fleet\Models\Assignment;
use App\Fleet\OutOfService;
use App\Models\User;
use App\Models\Vehicle;
use App\Trips\Models\Facility;
use App\Trips\Models\Patient;
use App\Trips\Models\Trip;
use App\Trips\Models\TripEvent;
use App\Trips\Models\TripHistory;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The trip board's rules: booking trips (one way, round trip, standing orders), assigning them to
 * trucks with the checks a dispatcher confirms, the status workflow, paperwork alerts, and the
 * change feed the board polls. Every write carries the version the dispatcher was looking at.
 */
class Trips
{
    public function __construct(private OutOfService $outOfService) {}

    // ---------------------------------------------------------------- board data

    /**
     * The board's columns for a day: trucks with a crew on the road that day (from Vehicle
     * Assignments) plus any truck with a trip that day, each with its shifts and crew.
     */
    public function units(Carbon $day): Collection
    {
        [$from, $to] = [$day->copy()->startOfDay(), $day->copy()->endOfDay()];
        $assignments = Assignment::with('members')
            ->where('starts_at', '<', $to)->where('ends_at', '>', $from)
            ->whereNotNull('vehicle_id')->orderBy('starts_at')->get()->groupBy('vehicle_id');
        $withTrips = Trip::whereNotNull('vehicle_id')->whereBetween('scheduled_start', [$from, $to])->distinct()->pluck('vehicle_id');
        $ids = $assignments->keys()->merge($withTrips)->unique()->values();
        $down = $this->outOfService->now();

        return Vehicle::whereIn('id', $ids)->get()
            ->map(fn (Vehicle $v) => $this->unit($v, $assignments->get($v->id, collect()), $down))
            ->sortBy([['onRoad', 'desc'], ['name', 'asc']])->values();
    }

    /** Every company truck, for "Show another truck" and the settings page. */
    public function allTrucks(): Collection
    {
        return Vehicle::where('kind', 'company')->where('active', true)->orderBy('name')->get()
            ->map(fn (Vehicle $v) => ['id' => $v->id, 'name' => $v->name ?: $v->plate]);
    }

    public function unit(Vehicle $v, Collection $assignments, ?Collection $down = null): array
    {
        $down ??= $this->outOfService->now();
        $shifts = $assignments->map(fn (Assignment $a) => [
            'starts' => $a->starts_at->toIso8601String(),
            'ends' => $a->ends_at->toIso8601String(),
            'name' => $a->shift_name,
            'status' => $a->status,
            'statusLabel' => $a->statusLabel(),
            'level' => $a->level,
            'levelLabel' => $a->levelLabel(),
            'crew' => $a->members->map(fn ($m) => ['name' => $m->user_name, 'role' => $m->role, 'userId' => $m->user_id])->values(),
        ])->values();
        $onRoad = $assignments->contains(fn (Assignment $a) => in_array($a->status, ['in_service', 'special_event'], true));
        $level = $assignments->pluck('level')->filter()->sortByDesc(fn ($l) => self::rank($l))->first();

        return [
            'id' => $v->id,
            'name' => $v->name ?: $v->plate,
            'plate' => $v->plate,
            'phone' => $v->trip_phone,
            'gpsDeviceId' => $v->gps_device_id,
            'level' => $level,
            'levelLabel' => $level ? (\App\Models\ScopeItem::LEVELS[$level] ?? strtoupper($level)) : null,
            'shifts' => $shifts,
            'onRoad' => $onRoad,
            'outOfService' => $down->has($v->id) ? ($down[$v->id]['reason'] ?: 'Out of service') : null,
            // What the crew set on the MDT (today only).
            'unitStatus' => $v->trip_unit_status_at && \Illuminate\Support\Carbon::parse($v->trip_unit_status_at)->isToday() ? $v->trip_unit_status : null,
        ];
    }

    /** Trips for the board: the day's assigned trips plus every open queued trip. */
    public function boardTrips(Carbon $day): Collection
    {
        [$from, $to] = [$day->copy()->startOfDay(), $day->copy()->endOfDay()];

        return Trip::with('patient')
            ->where(fn ($q) => $q->whereBetween('scheduled_start', [$from, $to])
                ->orWhere(fn ($q) => $q->whereNull('scheduled_start')->whereBetween('pickup_time', [$from, $to]))
                ->orWhere('status', 'queued'))
            ->get();
    }

    /**
     * What the board shows for a trip. People who can see the board but not dispatch (viewers)
     * get initials and "Residence" for home addresses, never names, payers or notes.
     */
    public function summary(Trip $t, User $viewer): array
    {
        $full = $viewer->hasPermission('trips_dispatch');
        $place = fn (?int $facilityId, ?string $text) => $full || $facilityId ? $text : 'Residence';

        return [
            'id' => $t->id,
            'number' => $t->trip_number,
            'version' => $t->version,
            'patientId' => $full ? $t->patient_id : null,
            'patientName' => $full ? $t->patient_last.', '.$t->patient_first : self::initials($t->patient_first, $t->patient_last),
            'age' => self::age($t->patient_dob),
            'weightLbs' => $t->weight_lbs,
            'level' => $t->level,
            'tripType' => $t->trip_type,
            'equipment' => $t->equipment ?? [],
            'pickupMode' => $t->pickup_mode,
            'pickupTime' => $t->pickup_time?->toIso8601String(),
            'durationMin' => $t->duration_min,
            'pickupLocation' => $place($t->pickup_facility_id, $t->pickup_location),
            'pickupFacilityId' => $t->pickup_facility_id,
            'destination' => $place($t->destination_facility_id, $t->destination),
            'destinationFacilityId' => $t->destination_facility_id,
            'status' => $t->status,
            'vehicleId' => $t->vehicle_id,
            'scheduledStart' => $t->scheduled_start?->toIso8601String(),
            'leg' => $t->leg,
            'linkedTripId' => $t->linked_trip_id,
            'cancelReason' => $t->cancel_reason,
            'loadedMiles' => $t->loaded_miles,
            'statusTimes' => $t->status_times ?? (object) [],
            'alerts' => $this->alerts($t),
            'payer' => $full ? $t->payer : null,
            'createdAt' => $t->created_at?->toIso8601String(),
            'priority' => $t->priority ?? 'routine',
            'quotedTime' => $t->quoted_time?->toIso8601String(),
            'dnr' => (bool) $t->dnr,
            'oxygenLpm' => $t->oxygen_lpm,
            'stairs' => $t->stairs,
            'riders' => $t->riders,
            'waitAndReturn' => (bool) $t->wait_and_return,
            'estMiles' => $t->est_miles,
            'pickupDepartment' => $t->pickup_department,
            'dropoffDepartment' => $t->dropoff_department,
            'pickupRoom' => $full ? $t->pickup_room : null,
            'dropoffRoom' => $full ? $t->dropoff_room : null,
        ];
    }

    /** Everything about a trip, for the trip drawer (dispatchers only; the caller audits the view). */
    public function detail(Trip $t, User $viewer): array
    {
        $t->loadMissing('history', 'updater', 'patient', 'orderingFacility');

        return $this->summary($t, $viewer) + [
            'patientFirst' => $t->patient_first,
            'patientLast' => $t->patient_last,
            'dob' => $t->patient_dob,
            'memberId' => $t->member_id,
            'priorAuth' => $t->prior_auth,
            'pcsOnFile' => $t->pcs_on_file,
            'chiefComplaint' => $t->chief_complaint,
            'stretcherReason' => $t->stretcher_reason,
            'notes' => $t->notes,
            'seriesId' => $t->series_id,
            'secondaryPayer' => $t->secondary_payer,
            'secondaryMemberId' => $t->secondary_member_id,
            'pcsRequested' => (bool) $t->pcs_requested,
            'pcsSigned' => (bool) $t->pcs_signed,
            'orderingFacility' => $t->orderingFacility?->name,
            'callerName' => $t->caller_name, 'callerTitle' => $t->caller_title, 'callerPhone' => $t->caller_phone,
            'pickupPhone' => $t->pickup_phone, 'dropoffPhone' => $t->dropoff_phone,
            'diagnoses' => $t->diagnoses ?? [],
            'physicians' => $t->physicians ?? (object) [],
            'crewNotes' => $t->crew_notes, 'epcrPulledAt' => $t->epcr_pulled_at?->toIso8601String(),
            'odometerPickup' => $t->odometer_pickup, 'odometerDestination' => $t->odometer_destination,
            'patientNotes' => $t->patient ? array_filter(['dispatch' => $t->patient->dispatch_notes, 'baseline' => $t->patient->baseline]) : (object) [],
            'updatedBy' => $t->updater?->name,
            'updatedAt' => $t->updated_at?->toIso8601String(),
            'history' => $t->history->map(fn (TripHistory $h) => [
                'at' => $h->created_at?->toIso8601String(), 'by' => $h->user_name, 'action' => $h->action, 'detail' => $h->detail,
            ])->values(),
        ];
    }

    /** Paperwork problems for a trip on its day: missing or expired PCS, and expiring prior auth. */
    public function alerts(Trip $t): array
    {
        $day = ($t->startsAt() ?? $t->created_at ?? now())->copy()->startOfDay();
        $p = $t->relationLoaded('patient') ? $t->patient : ($t->patient_id ? $t->patient()->first() : null);
        $out = [];
        $pcs = $p?->pcs_expires;
        if (! $t->pcs_on_file && ! $pcs) {
            $out[] = 'No PCS';
        } elseif ($pcs && $pcs->lt($day)) {
            $out[] = 'PCS expired';
        } elseif ($pcs && $pcs->lt($day->copy()->addDays(7))) {
            $out[] = 'PCS expiring';
        }
        $auth = $p?->prior_auth_expires;
        if ($auth && $auth->lt($day)) {
            $out[] = 'Auth expired';
        } elseif ($auth && $auth->lt($day->copy()->addDays(7))) {
            $out[] = 'Auth expiring';
        }

        return $out;
    }

    // ---------------------------------------------------------------- booking

    /**
     * Books a trip from the intake form: one way, a round trip (two linked legs) and/or a standing
     * order repeated on chosen weekdays. Returns the trips made, first leg first.
     *
     * @return Collection<int, Trip>
     */
    public function create(array $in, User $by): Collection
    {
        return DB::transaction(function () use ($in, $by) {
            $patient = $this->resolvePatient($in, $by);
            $base = $this->tripFields($in, $patient);
            $dates = $this->occurrences($in);
            $series = count($dates) > 1 ? (string) Str::uuid() : null;
            $made = collect();

            foreach ($dates as $date) {
                $out = $this->newTrip($base, $in, $date, $by, $series);
                $made->push($out);
                if (! empty($in['round_trip'])) {
                    $timing = $this->returnTiming($in, $out);
                    $wait = ! empty($timing['wait_and_return']);
                    $back = $this->newTrip(array_merge($base, [
                        'pickup_location' => $base['destination'], 'pickup_facility_id' => $base['destination_facility_id'],
                        'destination' => $base['pickup_location'], 'destination_facility_id' => $base['pickup_facility_id'],
                        'pickup_room' => $base['dropoff_room'], 'pickup_department' => $base['dropoff_department'], 'pickup_phone' => $base['dropoff_phone'],
                        'dropoff_room' => $base['pickup_room'], 'dropoff_department' => $base['pickup_department'], 'dropoff_phone' => $base['pickup_phone'],
                    ]), $timing, $date, $by, $series, 'return');
                    // Wait and return: both legs say so, so the board and the crew know the truck stays.
                    $out->update(['leg' => 'outbound', 'linked_trip_id' => $back->id, 'wait_and_return' => $wait]);
                    $back->update(['linked_trip_id' => $out->id, 'wait_and_return' => $wait]);
                    $made->push($back);
                }
            }
            foreach ($made as $t) {
                $this->history($t, $by, 'created', $series ? 'Standing order ('.count($dates).' dates)' : ($t->leg === 'one_way' ? null : ucfirst($t->leg).' leg'));
                $this->emit($t, $by);
            }

            return $made;
        });
    }

    /**
     * When the return leg is picked up: a set time, will-call, or "wait and return" (the crew waits,
     * so it's scheduled for when the outbound leg's minutes are up).
     */
    private function returnTiming(array $in, Trip $out): array
    {
        $mode = $in['return_mode'] ?? 'will_call';
        if ($mode === 'wait' && $out->pickup_time) {
            $out->update(['wait_and_return' => true]);

            return ['pickup_mode' => 'scheduled', 'pickup_time' => $out->pickup_time->copy()->addMinutes($out->duration_min)->format('Y-m-d H:i'), 'wait_and_return' => true];
        }

        return ['pickup_mode' => $mode === 'scheduled' ? 'scheduled' : 'will_call', 'pickup_time' => $mode === 'scheduled' ? $in['return_time'] ?? null : null];
    }

    /** Uses the chosen patient record, or finds one by name and date of birth, or makes a new one. */
    private function resolvePatient(array $in, User $by): Patient
    {
        $patient = ! empty($in['patient_id']) ? Patient::findOrFail($in['patient_id']) : app(Patients::class)->findExact($in['patient_first'], $in['patient_last'], $in['patient_dob']);
        $payers = app(Payers::class);
        $payer = $payers->resolve(isset($in['payer_id']) ? (int) $in['payer_id'] : null, $in['payer'] ?? null);
        if (! $patient) {
            $home = empty($in['pickup_facility_id']) ? trim((string) ($in['pickup_location'] ?? '')) : '';
            $patient = Patient::create([
                'patient_number' => Patient::nextNumber(),
                'first_name' => trim($in['patient_first']), 'last_name' => trim($in['patient_last']), 'dob' => $in['patient_dob'],
                'weight_lbs' => $in['weight_lbs'] ?? null, 'prior_auth_number' => $in['prior_auth'] ?? null,
                'default_level' => $in['level'], 'default_equipment' => $in['equipment'] ?? [],
                'stretcher_reason' => $in['stretcher_reason'] ?? null, 'updated_by' => $by->id,
                // A pickup that isn't a facility is usually home.
                'address' => $home ?: null, 'phone' => empty($in['pickup_facility_id']) ? ($in['pickup_phone'] ?? null) : null,
            ]);
            audit_note("Added patient {$patient->patient_number} from intake.");
        } else {
            // Intake is where weight and paperwork usually change: keep the record current.
            $changes = array_filter(['weight_lbs' => $in['weight_lbs'] ?? null, 'prior_auth_number' => $in['prior_auth'] ?? null], fn ($v) => $v !== null && $v !== '');
            $dirty = array_filter($changes, fn ($v, $k) => (string) $patient->{$k} !== (string) $v, ARRAY_FILTER_USE_BOTH);
            if ($dirty) {
                $patient->fill($dirty + ['updated_by' => $by->id, 'version' => $patient->version + 1])->save();
            }
        }
        if ($payer) {
            $payers->fromIntake($patient, $payer, $in['member_id'] ?? null);
        }

        return $patient->load('payers.payer');
    }

    private function tripFields(array $in, Patient $p): array
    {
        $pickupFacility = ! empty($in['pickup_facility_id']) ? Facility::find($in['pickup_facility_id']) : null;
        $destFacility = ! empty($in['destination_facility_id']) ? Facility::find($in['destination_facility_id']) : null;

        return [
            'patient_id' => $p->id,
            'patient_first' => $p->first_name, 'patient_last' => $p->last_name, 'patient_dob' => $p->dob,
            'weight_lbs' => $in['weight_lbs'] ?? $p->weight_lbs,
            // The payors as they are today, copied so later changes to the patient don't rewrite the trip.
            'payer' => $p->payers->get(0)?->payer?->name, 'member_id' => $p->payers->get(0)?->member_id,
            'secondary_payer' => $p->payers->get(1)?->payer?->name, 'secondary_member_id' => $p->payers->get(1)?->member_id,
            'prior_auth' => $in['prior_auth'] ?? $p->prior_auth_number,
            'pcs_on_file' => (bool) ($in['pcs_on_file'] ?? false),
            'pcs_requested' => (bool) ($in['pcs_requested'] ?? false), 'pcs_signed' => (bool) ($in['pcs_signed'] ?? false),
            'ordering_facility_id' => $in['ordering_facility_id'] ?? null,
            'caller_name' => $in['caller_name'] ?? null, 'caller_title' => $in['caller_title'] ?? null, 'caller_phone' => $in['caller_phone'] ?? null,
            'pickup_room' => $in['pickup_room'] ?? null, 'pickup_department' => $in['pickup_department'] ?? null, 'pickup_phone' => $in['pickup_phone'] ?? null,
            'dropoff_room' => $in['dropoff_room'] ?? null, 'dropoff_department' => $in['dropoff_department'] ?? null, 'dropoff_phone' => $in['dropoff_phone'] ?? null,
            'priority' => $in['priority'] ?? 'routine',
            'quoted_time' => ($in['pickup_mode'] ?? '') === 'asap' && ! empty($in['quoted_time']) ? Carbon::parse($in['quoted_time']) : null,
            'oxygen_lpm' => $in['oxygen_lpm'] ?? null, 'stairs' => $in['stairs'] ?? null, 'riders' => $in['riders'] ?? null, 'dnr' => (bool) ($in['dnr'] ?? false),
            'diagnoses' => self::diagnoses($in['diagnoses'] ?? []) ?: null,
            'physicians' => self::physicians($in['physicians'] ?? []) ?: null,
            'est_miles' => $pickupFacility?->lat !== null && $destFacility?->lat !== null && $pickupFacility && $destFacility
                ? round(Gps::miles($pickupFacility->lat, $pickupFacility->lon, $destFacility->lat, $destFacility->lon) * 1.25, 1) : null,
            'level' => $in['level'], 'trip_type' => $in['trip_type'], 'equipment' => array_values($in['equipment'] ?? []),
            'chief_complaint' => $in['chief_complaint'], 'stretcher_reason' => $in['stretcher_reason'], 'notes' => $in['notes'] ?? null,
            'duration_min' => (int) ($in['duration_min'] ?? 60),
            'pickup_facility_id' => $pickupFacility?->id, 'pickup_location' => $pickupFacility?->name ?? trim($in['pickup_location']),
            'destination_facility_id' => $destFacility?->id, 'destination' => $destFacility?->name ?? trim($in['destination']),
        ];
    }

    /** ICD-10 codes as [{code, description}], first = primary, each once, upper case. */
    public static function diagnoses(array $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            $code = strtoupper(trim((string) ($r['code'] ?? '')));
            if ($code === '' || isset($out[$code])) {
                continue;
            }
            $out[$code] = ['code' => $code, 'description' => mb_substr(trim((string) ($r['description'] ?? '')) ?: (Icd10::COMMON[$code] ?? ''), 0, 200)];
        }

        return array_values($out);
    }

    /** Referring and receiving doctors: name, phone, fax and NPI. Empty ones are left out. */
    public static function physicians(array $in): array
    {
        $out = [];
        foreach (['referring', 'receiving'] as $role) {
            $d = array_map(fn ($v) => mb_substr(trim((string) $v), 0, 100), array_intersect_key($in[$role] ?? [], array_flip(['name', 'phone', 'fax', 'npi'])));
            if (array_filter($d)) {
                $out[$role] = $d + ['name' => '', 'phone' => '', 'fax' => '', 'npi' => ''];
            }
        }

        return $out;
    }

    /** The day(s) to book: one date, or each chosen weekday for the number of weeks. */
    private function occurrences(array $in): array
    {
        $first = isset($in['pickup_time']) && $in['pickup_time'] ? Carbon::parse($in['pickup_time']) : now();
        if (empty($in['repeat_days']) || ($in['pickup_mode'] ?? '') !== 'scheduled') {
            return [$first];
        }
        $weeks = max(1, min(26, (int) ($in['repeat_weeks'] ?? 4)));
        $days = array_map('intval', $in['repeat_days']);
        $out = [];
        $cursor = $first->copy();
        $end = $first->copy()->addWeeks($weeks);
        while ($cursor->lt($end)) {
            if (in_array($cursor->isoWeekday(), $days, true)) {
                $out[] = $cursor->copy();
            }
            $cursor->addDay();
        }

        return $out ?: [$first];
    }

    private function newTrip(array $fields, array $in, Carbon $date, User $by, ?string $series, string $leg = 'one_way'): Trip
    {
        $mode = $in['pickup_mode'] ?? 'asap';
        $time = null;
        if ($mode === 'scheduled' && ! empty($in['pickup_time'])) {
            $t = Carbon::parse($in['pickup_time']);
            $time = $date->copy()->setTime($t->hour, $t->minute);
        } elseif ($mode === 'asap') {
            $time = now();
        }

        return Trip::create($fields + [
            'trip_number' => $this->nextNumber(),
            'pickup_mode' => $mode, 'pickup_time' => $time, 'leg' => $leg, 'series_id' => $series,
            'status' => 'queued', 'status_times' => ['queued' => now()->toIso8601String()],
            'created_by' => $by->id, 'updated_by' => $by->id,
        ]);
    }

    private function nextNumber(): string
    {
        $last = Trip::query()->orderByDesc('id')->lockForUpdate()->value('trip_number');
        $n = $last ? (int) preg_replace('/\D/', '', $last) + 1 : 1;

        return 'T-'.str_pad((string) $n, 6, '0', STR_PAD_LEFT);
    }

    // ---------------------------------------------------------------- dispatching

    /** Refuses a write made from an out-of-date copy of the trip (someone else changed it first). */
    public function checkVersion(Trip $t, ?int $expected): void
    {
        if ($expected !== null && $expected !== $t->version) {
            throw new TripConflict($t);
        }
    }

    /**
     * Things a dispatcher must confirm before a trip goes on a truck at a time:
     * code => message. Empty when nothing needs confirming.
     */
    public function assignWarnings(Trip $t, Vehicle $v, Carbon $start): array
    {
        $end = $start->copy()->addMinutes($t->duration_min);
        $assignments = Assignment::where('vehicle_id', $v->id)->where('starts_at', '<', $end)->where('ends_at', '>', $start)->get();
        $onRoad = $assignments->filter(fn (Assignment $a) => in_array($a->status, ['in_service', 'special_event'], true));
        $warnings = [];

        $crewLevel = $onRoad->pluck('level')->filter()->sortByDesc(fn ($l) => self::rank($l))->first();
        if ($t->needsAls() && $crewLevel && ! in_array($crewLevel, Trip::ALS_LEVELS, true)) {
            $warnings['LEVEL'] = "This is an {$this->levelName($t->level)} trip and {$this->name($v)} is staffed {$this->levelName($crewLevel)}.";
        }
        $down = $this->outOfService->now();
        if ($down->has($v->id) || ($assignments->isNotEmpty() && $onRoad->isEmpty())) {
            $warnings['OUT_OF_SERVICE'] = "{$this->name($v)} is out of service".($down->has($v->id) && $down[$v->id]['reason'] ? ': '.$down[$v->id]['reason'] : '').'.';
        }
        $covered = $onRoad->contains(fn (Assignment $a) => $a->starts_at->lte($start) && $a->ends_at->gte($end));
        if (! $covered) {
            $warnings['OUTSIDE_SHIFT'] = $onRoad->isEmpty()
                ? "{$this->name($v)} has no crew assigned at {$start->format('H:i')} (Vehicle Assignments)."
                : "The trip runs outside {$this->name($v)}'s shift.";
        }
        $overlap = Trip::where('vehicle_id', $v->id)->where('id', '!=', $t->id)->whereNotIn('status', ['completed', 'cancelled'])
            ->whereNotNull('scheduled_start')->where('scheduled_start', '<', $end)->get()
            ->first(fn (Trip $o) => $o->scheduled_start->copy()->addMinutes($o->duration_min)->gt($start));
        if ($overlap) {
            $warnings['OVERLAP'] = "{$this->name($v)} already has {$overlap->trip_number} at {$overlap->scheduled_start->format('H:i')}.";
        }

        return $warnings;
    }

    /**
     * Puts a trip on a truck at a time (or moves it). Throws TripNeedsAck listing what must be
     * confirmed when $ack doesn't cover every warning.
     */
    public function assign(Trip $t, Vehicle $v, Carbon $start, array $ack, ?int $expected, User $by): Trip
    {
        return DB::transaction(function () use ($t, $v, $start, $ack, $expected, $by) {
            $t = Trip::lockForUpdate()->findOrFail($t->id);
            $this->checkVersion($t, $expected);
            if (! $t->isOpen()) {
                throw ValidationException::withMessages(['trip' => "{$t->trip_number} is ".strtolower(Trip::STATUSES[$t->status]).'.']);
            }
            $warnings = $this->assignWarnings($t, $v, $start);
            $missing = array_diff(array_keys($warnings), $ack);
            if ($missing) {
                throw new TripNeedsAck(array_intersect_key($warnings, array_flip($missing)));
            }
            $prev = $t->vehicle_id;
            $times = $t->status_times ?? [];
            if ($t->status === 'queued') {
                $times['assigned'] = now()->toIso8601String();
            }
            $t->fill([
                'vehicle_id' => $v->id, 'scheduled_start' => $start,
                'status' => $t->status === 'queued' ? 'assigned' : $t->status,
                'status_times' => $times, 'version' => $t->version + 1, 'updated_by' => $by->id,
            ])->save();
            $detail = ($prev && $prev !== $v->id ? 'Moved to ' : 'Assigned to ').$this->name($v).' at '.$start->format('H:i').($warnings ? ' (confirmed: '.implode(', ', array_keys($warnings)).')' : '');
            $this->history($t, $by, 'assigned', $detail);
            audit_note("{$t->trip_number}: {$detail}.");
            $this->emit($t, $by, $prev);

            return $t;
        });
    }

    public function unassign(Trip $t, ?int $expected, User $by): Trip
    {
        return DB::transaction(function () use ($t, $expected, $by) {
            $t = Trip::lockForUpdate()->findOrFail($t->id);
            $this->checkVersion($t, $expected);
            if (! in_array($t->status, ['assigned', 'queued'], true)) {
                throw ValidationException::withMessages(['trip' => "{$t->trip_number} is already under way; change its status instead."]);
            }
            $prev = $t->vehicle_id;
            $times = $t->status_times ?? [];
            unset($times['assigned']);
            $t->fill(['vehicle_id' => null, 'scheduled_start' => null, 'status' => 'queued', 'status_times' => $times, 'version' => $t->version + 1, 'updated_by' => $by->id])->save();
            $this->history($t, $by, 'unassigned', 'Back to the queue');
            audit_note("{$t->trip_number}: back to the queue.");
            $this->emit($t, $by, $prev);

            return $t;
        });
    }

    /**
     * Moves a trip along (or cancels or reopens it). Crews may only move their own trips forward
     * one step at a time; reopening a closed trip needs trips_supervise.
     */
    public function setStatus(Trip $t, string $status, ?int $expected, User $by, ?string $reason = null): Trip
    {
        return DB::transaction(function () use ($t, $status, $expected, $by, $reason) {
            $t = Trip::lockForUpdate()->findOrFail($t->id);
            $this->checkVersion($t, $expected);
            if (! array_key_exists($status, Trip::STATUSES) || $status === $t->status) {
                throw ValidationException::withMessages(['status' => 'That status change isn\'t allowed.']);
            }
            if ($status === 'cancelled' && ! $reason) {
                throw ValidationException::withMessages(['reason' => 'Pick a reason for cancelling.']);
            }
            if (! $t->isOpen() && ! $by->hasPermission('trips_supervise')) {
                throw ValidationException::withMessages(['status' => 'Only a trip supervisor can reopen a closed trip.']);
            }
            if (in_array($status, Trip::ACTIVE, true) || $status === 'completed') {
                if (! $t->vehicle_id) {
                    throw ValidationException::withMessages(['status' => 'Assign the trip to a truck first.']);
                }
            }
            $times = $t->status_times ?? [];
            $times[$status] = now()->toIso8601String();
            $fields = ['status' => $status, 'status_times' => $times, 'version' => $t->version + 1, 'updated_by' => $by->id];
            if ($status === 'cancelled') {
                $fields['cancel_reason'] = mb_substr($reason, 0, 200);
            } elseif ($status === 'queued') {
                $fields += ['vehicle_id' => null, 'scheduled_start' => null, 'cancel_reason' => null];
            } elseif (! $t->isOpen()) {
                $fields['cancel_reason'] = null;
            }
            // Loaded miles from the truck's GPS between "Transporting" and now.
            if (in_array($status, ['at_destination', 'completed'], true) && $t->loaded_miles === null && isset($times['transporting'])) {
                $miles = app(Gps::class)->milesSince($t->vehicle_id, Carbon::parse($times['transporting']));
                if ($miles !== null) {
                    $fields['loaded_miles'] = $miles;
                }
            }
            $prev = $t->vehicle_id;
            $t->fill($fields)->save();
            $detail = Trip::STATUSES[$status].($status === 'cancelled' ? ': '.$reason : '');
            $this->history($t, $by, 'status', $detail);
            audit_note("{$t->trip_number}: {$detail}.");
            $this->emit($t, $by, $prev);

            return $t;
        });
    }

    /** Edits a trip's details from the drawer (not its patient name or date of birth: book a new trip for that). */
    public function update(Trip $t, array $in, ?int $expected, User $by): Trip
    {
        return DB::transaction(function () use ($t, $in, $expected, $by) {
            $t = Trip::lockForUpdate()->findOrFail($t->id);
            $this->checkVersion($t, $expected);
            $allowed = ['level', 'trip_type', 'equipment', 'chief_complaint', 'stretcher_reason', 'notes', 'pickup_mode', 'pickup_time', 'duration_min', 'weight_lbs', 'prior_auth', 'pcs_on_file', 'pcs_requested', 'pcs_signed', 'loaded_miles',
                'priority', 'quoted_time', 'oxygen_lpm', 'stairs', 'riders', 'dnr', 'pickup_room', 'pickup_department', 'pickup_phone', 'dropoff_room', 'dropoff_department', 'dropoff_phone', 'caller_name', 'caller_title', 'caller_phone'];
            $fields = array_intersect_key($in, array_flip($allowed));
            if (array_key_exists('diagnoses', $in)) {
                $fields['diagnoses'] = self::diagnoses($in['diagnoses'] ?? []) ?: null;
            }
            if (array_key_exists('pickup_mode', $fields) && $fields['pickup_mode'] !== 'scheduled' && ! array_key_exists('pickup_time', $fields)) {
                $fields['pickup_time'] = $fields['pickup_mode'] === 'asap' ? now() : null;
            }
            $t->fill($fields);
            $changed = array_keys($t->getDirty());
            if (! $changed) {
                return $t;
            }
            $t->fill(['version' => $t->version + 1, 'updated_by' => $by->id])->save();
            // Field names only: values can be PHI.
            $names = array_map(fn ($f) => str_replace('_', ' ', $f), $changed);
            $this->history($t, $by, 'edited', 'Changed '.implode(', ', $names));
            audit_note("{$t->trip_number}: changed ".implode(', ', $names).'.');
            $this->emit($t, $by);

            return $t;
        });
    }

    // ---------------------------------------------------------------- change feed

    public function emit(?Trip $t, ?User $by, ?int $prevVehicleId = null, string $type = 'trip'): void
    {
        TripEvent::create([
            'type' => $type, 'trip_id' => $t?->id, 'vehicle_id' => $t?->vehicle_id,
            'prev_vehicle_id' => $prevVehicleId !== $t?->vehicle_id ? $prevVehicleId : null,
            'user_id' => $by?->id, 'created_at' => now(),
        ]);
    }

    public function lastEventId(): int
    {
        return (int) TripEvent::max('id');
    }

    /**
     * Everything after event $since: the changed trips (as the viewer may see them), whether
     * facilities changed, and who made each change. Crew members only hear about their own trucks.
     */
    public function changesSince(int $since, User $viewer, ?array $onlyVehicles = null): array
    {
        $events = TripEvent::where('id', '>', $since)->orderBy('id')->limit(500)->get();
        if ($onlyVehicles !== null) {
            $events = $events->filter(fn ($e) => $e->type === 'trip' && (in_array($e->vehicle_id, $onlyVehicles, true) || in_array($e->prev_vehicle_id, $onlyVehicles, true)));
        }
        $tripIds = $events->where('type', 'trip')->pluck('trip_id')->filter()->unique();
        $trips = Trip::with('patient')->whereIn('id', $tripIds)->get();
        $names = User::whereIn('id', $events->pluck('user_id')->filter()->unique())->pluck('name', 'id');

        return [
            'seq' => (int) ($events->max('id') ?? max($since, 0)),
            'more' => $events->count() === 500,
            'trips' => $trips->map(fn (Trip $t) => $this->summary($t, $viewer))->values(),
            'facilities' => $events->contains('type', 'facilities'),
            'units' => $events->contains('type', 'units'),
            'by' => $events->where('type', 'trip')->mapWithKeys(fn ($e) => [$e->trip_id => $names[$e->user_id] ?? null])->filter(),
        ];
    }

    // ---------------------------------------------------------------- closest units

    /**
     * Trucks that could take an ASAP trip now, closest first: on the road now, with their last GPS
     * fix, straight-line miles to the pickup facility, a rough ETA, and whether the level fits.
     */
    public function suggestions(Trip $t): array
    {
        $pickup = $t->pickupFacility;
        if (! $pickup || $pickup->lat === null) {
            return ['pickupKnown' => false, 'units' => []];
        }
        $now = now();
        $units = $this->units($now)->filter(fn ($u) => $u['onRoad'] && ! $u['outOfService'])
            ->filter(fn ($u) => collect($u['shifts'])->contains(fn ($s) => Carbon::parse($s['starts'])->lte($now) && Carbon::parse($s['ends'])->gt($now) && in_array($s['status'], ['in_service', 'special_event'], true)));
        $gps = app(Gps::class)->latest()->keyBy('vehicleId');
        $busy = Trip::whereIn('status', Trip::ACTIVE)->pluck('trip_number', 'vehicle_id');

        $out = $units->map(function ($u) use ($gps, $pickup, $t, $busy) {
            $fix = $gps->get($u['id']);
            $miles = $fix ? round(Gps::miles($fix['lat'], $fix['lon'], $pickup->lat, $pickup->lon), 1) : null;
            $levelOk = ! $t->needsAls() || in_array($u['level'], Trip::ALS_LEVELS, true);

            return [
                'vehicleId' => $u['id'], 'unit' => $u['name'], 'levelLabel' => $u['levelLabel'], 'levelOk' => $levelOk,
                'miles' => $miles, 'etaMin' => $miles !== null ? (int) max(1, round($miles / 30 * 60)) : null,
                'stale' => $fix['stale'] ?? true, 'busyWith' => $busy[$u['id']] ?? null,
            ];
        })->sortBy([fn ($a, $b) => ($b['levelOk'] <=> $a['levelOk']) ?: (($a['busyWith'] ? 1 : 0) <=> ($b['busyWith'] ? 1 : 0)) ?: (($a['miles'] ?? 9999) <=> ($b['miles'] ?? 9999))])->values();

        return ['pickupKnown' => true, 'units' => $out->take(6)->all()];
    }

    // ---------------------------------------------------------------- helpers

    public function history(Trip $t, ?User $by, string $action, ?string $detail = null): void
    {
        TripHistory::create(['trip_id' => $t->id, 'user_id' => $by?->id, 'user_name' => $by?->name, 'action' => $action, 'detail' => $detail ? mb_substr($detail, 0, 300) : null, 'created_at' => now()]);
    }

    public static function age(?string $dob): ?int
    {
        try {
            return $dob ? Carbon::parse($dob)->age : null;
        } catch (\Throwable) {
            return null;
        }
    }

    public static function initials(?string $first, ?string $last): string
    {
        return mb_strtoupper(mb_substr((string) $first, 0, 1).'.'.mb_substr((string) $last, 0, 1).'.');
    }

    public static function rank(?string $level): int
    {
        return (int) array_search($level, array_keys(\App\Models\ScopeItem::LEVELS), true);
    }

    private function levelName(?string $level): string
    {
        return \App\Models\ScopeItem::LEVELS[$level] ?? strtoupper((string) $level);
    }

    private function name(Vehicle $v): string
    {
        return $v->name ?: $v->plate;
    }
}
