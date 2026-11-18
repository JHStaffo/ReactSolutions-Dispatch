<?php

namespace App\Trips\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One of a patient's payors, in billing order (position 1 is primary). */
class PatientPayer extends Model
{
    protected $table = 'trip_patient_payers';

    protected $guarded = [];

    protected $hidden = ['member_id', 'group_number', 'subscriber_name'];

    public const RELATIONSHIPS = ['self' => 'Self', 'spouse' => 'Spouse', 'child' => 'Child', 'parent' => 'Parent', 'other' => 'Other'];

    public const POSITIONS = [1 => 'Primary', 2 => 'Secondary', 3 => 'Tertiary'];

    protected function casts(): array
    {
        return [
            'member_id' => 'encrypted', 'group_number' => 'encrypted', 'subscriber_name' => 'encrypted',
            'effective_from' => 'date', 'effective_to' => 'date', 'eligibility_checked_on' => 'date',
        ];
    }

    public function payer(): BelongsTo
    {
        return $this->belongsTo(Payer::class, 'payer_id');
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class, 'patient_id');
    }

    public function positionLabel(): string
    {
        return self::POSITIONS[$this->position] ?? 'Payor '.$this->position;
    }
}
