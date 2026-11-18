<?php

namespace App\Trips\Models;

use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One non-emergency transport leg. Patient fields are encrypted copies taken when it was booked. */
class Trip extends Model
{
    protected $guarded = [];

    protected $hidden = ['patient_first', 'patient_last', 'patient_dob', 'member_id', 'chief_complaint', 'stretcher_reason', 'notes', 'pickup_location', 'destination'];

    public const TYPES = [
        'dialysis' => 'Dialysis',
        'doctor' => 'Doctor\'s appointment',
        'interfacility' => 'Interfacility transfer',
        'discharge' => 'Hospital discharge',
        'snf_to_er' => 'SNF to ER',
        'other' => 'Other',
    ];

    public const STATUSES = [
        'queued' => 'Queued',
        'assigned' => 'Assigned',
        'enroute' => 'En route',
        'on_scene' => 'On scene',
        'transporting' => 'Transporting',
        'at_destination' => 'At destination',
        'completed' => 'Completed',
        'cancelled' => 'Cancelled',
    ];

    /** The order a crew works through a trip. */
    public const FLOW = ['assigned', 'enroute', 'on_scene', 'transporting', 'at_destination', 'completed'];

    /** Crew is on the trip. */
    public const ACTIVE = ['enroute', 'on_scene', 'transporting', 'at_destination'];

    public const EQUIPMENT = [
        'oxygen' => 'Oxygen',
        'cardiac_monitor' => 'Cardiac monitor',
        'iv_pump' => 'IV pump',
        'ventilator' => 'Ventilator',
        'suction' => 'Suction',
        'bariatric' => 'Bariatric stretcher',
        'stair_chair' => 'Stair chair',
        'restraints' => 'Restraints',
        'isolation' => 'Isolation precautions',
    ];

    /** Equipment a BLS crew can't run with. */
    public const ALS_EQUIPMENT = ['cardiac_monitor', 'iv_pump', 'ventilator'];

    /** Levels that need an ALS (or higher) crew. */
    public const ALS_LEVELS = ['als', 'sct', 'rn'];

    public const CANCEL_REASONS = [
        'Patient refused', 'Facility cancelled', 'Patient not ready', 'Duplicate', 'Insurance denied', 'Patient admitted', 'Other',
    ];

    protected function casts(): array
    {
        return [
            'patient_first' => 'encrypted', 'patient_last' => 'encrypted', 'patient_dob' => 'encrypted',
            'member_id' => 'encrypted', 'chief_complaint' => 'encrypted', 'stretcher_reason' => 'encrypted',
            'notes' => 'encrypted', 'pickup_location' => 'encrypted', 'destination' => 'encrypted',
            'equipment' => 'array', 'status_times' => 'array', 'pcs_on_file' => 'boolean',
            'pickup_time' => 'datetime', 'scheduled_start' => 'datetime', 'loaded_miles' => 'float',
        ];
    }

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function linked(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'linked_trip_id');
    }

    public function pickupFacility(): BelongsTo
    {
        return $this->belongsTo(Facility::class, 'pickup_facility_id');
    }

    public function destinationFacility(): BelongsTo
    {
        return $this->belongsTo(Facility::class, 'destination_facility_id');
    }

    public function history(): HasMany
    {
        return $this->hasMany(TripHistory::class)->orderBy('id');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function isOpen(): bool
    {
        return ! in_array($this->status, ['completed', 'cancelled'], true);
    }

    /** When the trip starts on the board: its slot, else its pickup time. */
    public function startsAt(): ?\Illuminate\Support\Carbon
    {
        return $this->scheduled_start ?? $this->pickup_time;
    }

    public function needsAls(): bool
    {
        return in_array($this->level, self::ALS_LEVELS, true);
    }
}
