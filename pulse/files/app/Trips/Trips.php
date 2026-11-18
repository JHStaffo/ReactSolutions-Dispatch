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
        ];
    }

    /** Everything about a trip, for the trip drawer (dispatchers only; the caller audits the view). */
    public function detail(Trip $t, User $viewer): array
    {
        $t->loadMissing('history', 'updater');

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
                    $back = $this->newTrip(array_merge($base, [
                        'pickup_location' => $base['destination'], 'pickup_facility_id' => $base['destination_facility_id'],
                        'destination' => $base['pickup_location'], 'destination_facility_id' => $base['pickup_facility_id'],
                    ]), [
                        'pickup_mode' => $in['return_mode'] ?? 'will_call',
                        'pickup_time' => ($in['return_mode'] ?? 'will_call') === 'scheduled' ? $in['return_time'] ?? null : null,
                    ], $date, $by, $series, 'return');
                    $out->update(['leg' => 'outbound', 'linked_trip_id' => $back->id]);
                    $back->update(['linked_trip_id' => $out->id]);
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

    /** Uses the chosen patient record, or finds one by name and date of birth, or makes a new one. */
    private function resolvePatient(array $in, User $by): Patient
    {
        $patient = ! empty($in['patient_id']) ? Patient::findOrFail($in['patient_id']) : app(Patients::class)->findExact($in['patient_first'], $in['patient_last'], $in['patient_dob']);
        if (! $patient) {
            $patient = Patient::create([
                'patient_number' => Patient::nextNumber(),
                'first_name' => trim($in['patient_first']), 'last_name' => trim($in['patient_last']), 'dob' => $in['patient_dob'],
                'weight_lbs' => $in['weight_lbs'] ?? null, 'payer' => $in['payer'] ?? null, 'member_id' => $in['member_id'] ?? null,
                'prior_auth_number' => $in['prior_auth'] ?? null, 'default_level' => $in['level'], 'default_equipment' => $in['equipment'] ?? [],
                'stretcher_reason' => $in['stretcher_reason'] ?? null, 'updated_by' => $by->id,
            ]);
            audit_note("Added patient {$patient->patient_number} from intake.");
        } else {
            // Intake is where weight and insurance usually change: keep the record current.
            $changes = array_filter([
                'weight_lbs' => $in['weight_lbs'] ?? null, 'payer' => $in['payer'] ?? null,
                'member_id' => $in['member_id'] ?? null, 'prior_auth_number' => $in['prior_auth'] ?? null,
            ], fn ($v) => $v !== null && $v !== '');
            $dirty = array_filter($changes, fn ($v, $k) => (string) $patient->{$k} !== (string) $v, ARRAY_FILTER_USE_BOTH);
            if ($dirty) {
                $patient->fill($dirty + ['updated_by' => $by->id, 'version' => $patient->version + 1])->save();
            }
        }

        return $patient;
    }

    private function tripFields(array $in, Patient $p): array
    {
        $pickupFacility = ! empty($in['pickup_facility_id']) ? Facility::find($in['pickup_facility_id']) : null;
        $destFacility = ! empty($in['destination_facility_id']) ? Facility::find($in['destination_facility_id']) : null;

        return [
            'patient_id' => $p->id,
            'patient_first' => $p->first_name, 'patient_last' => $p->last_name, 'patient_dob' => $p->dob,
            'weight_lbs' => $in['weight_lbs'] ?? $p->weight_lbs,
            'payer' => $in['payer'] ?? $p->payer, 'member_id' => $in['member_id'] ?? $p->member_id,
            'prior_auth' => $in['prior_auth'] ?? $p->prior_auth_number,
            'pcs_on_file' => (bool) ($in['pcs_on_file'] ?? false),
            'level' => $in['level'], 'trip_type' => $in['trip_type'], 'equipment' => array_values($in['equipment'] ?? []),
            'chief_complaint' => $in['chief_complaint'], 'stretcher_reason' => $in['stretcher_reason'], 'notes' => $in['notes'] ?? null,
            'duration_min' => (int) ($in['duration_min'] ?? 60),
            'pickup_facility_id' => $pickupFacility?->id, 'pickup_location' => $pickupFacility?->name ?? trim($in['pickup_location']),
            'destination_facility_id' => $destFacility?->id, 'destination' => $destFacility?->name ?? trim($in['destination']),
        ];
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
            $allowed = ['level', 'trip_type', 'equipment', 'chief_complaint', 'stretcher_reason', 'notes', 'pickup_mode', 'pickup_time', 'duration_min', 'weight_lbs', 'payer', 'member_id', 'prior_auth', 'pcs_on_file', 'loaded_miles'];
            $fields = array_intersect_key($in, array_flip($allowed));
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
