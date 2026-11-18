<?php

namespace App\Trips\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A transport patient. Names, date of birth, contact details, member id and notes are
 * encrypted at rest; the list and search decrypt in PHP (see Patients::search).
 */
class Patient extends Model
{
    protected $table = 'trip_patients';

    protected $guarded = [];

    /** Encrypted at rest. */
    public const ENCRYPTED = [
        'first_name', 'middle_name', 'last_name', 'dob', 'phone', 'email', 'address', 'address2', 'city', 'zip', 'mrn', 'employer',
        'nok_name', 'nok_phone', 'stretcher_reason', 'medical_notes', 'dispatch_notes', 'baseline',
    ];

    public const MARITAL = ['single' => 'Single', 'married' => 'Married', 'partner' => 'Domestic partner', 'divorced' => 'Divorced', 'widowed' => 'Widowed', 'other' => 'Other'];

    /** Never in JSON or arrays unless a page asks for them on purpose. */
    protected $hidden = self::ENCRYPTED;

    protected function casts(): array
    {
        return array_fill_keys(self::ENCRYPTED, 'encrypted') + [
            'pcs_expires' => 'date', 'prior_auth_expires' => 'date', 'deceased_on' => 'date',
            'default_equipment' => 'array', 'active' => 'boolean', 'reminders_opt_out' => 'boolean',
        ];
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class);
    }

    /** Payors in billing order. */
    public function payers(): HasMany
    {
        return $this->hasMany(PatientPayer::class, 'patient_id')->orderBy('position');
    }

    public function facility(): BelongsTo
    {
        return $this->belongsTo(Facility::class, 'facility_id');
    }

    public function primaryPayer(): ?PatientPayer
    {
        return $this->payers->first();
    }

    /** Street, city, state and zip on one line. */
    public function fullAddress(): string
    {
        return collect([$this->address, $this->address2, trim(collect([$this->city, trim("{$this->state} {$this->zip}")])->filter()->join(', '))])->filter()->join(', ');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function fullName(): string
    {
        return "{$this->last_name}".($this->suffix ? " {$this->suffix}" : '').", {$this->first_name}".($this->middle_name ? ' '.mb_substr($this->middle_name, 0, 1).'.' : '');
    }

    public function age(): ?int
    {
        return \App\Trips\Trips::age($this->dob);
    }

    /** "Sample, A." on lists for people who can see patients. */
    public function shortName(): string
    {
        return $this->last_name.', '.mb_substr((string) $this->first_name, 0, 1).'.';
    }

    public static function nextNumber(): string
    {
        $last = static::query()->orderByDesc('id')->value('patient_number');
        $n = $last ? (int) preg_replace('/\D/', '', $last) + 1 : 1;

        return 'P-'.str_pad((string) $n, 6, '0', STR_PAD_LEFT);
    }
}
