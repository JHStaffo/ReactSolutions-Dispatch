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

    /** Never in JSON or arrays unless a page asks for them on purpose. */
    protected $hidden = ['first_name', 'last_name', 'dob', 'phone', 'address', 'member_id', 'stretcher_reason', 'medical_notes'];

    protected function casts(): array
    {
        return [
            'first_name' => 'encrypted', 'last_name' => 'encrypted', 'dob' => 'encrypted',
            'phone' => 'encrypted', 'address' => 'encrypted', 'member_id' => 'encrypted',
            'stretcher_reason' => 'encrypted', 'medical_notes' => 'encrypted',
            'pcs_expires' => 'date', 'prior_auth_expires' => 'date',
            'default_equipment' => 'array', 'active' => 'boolean',
        ];
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class);
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function fullName(): string
    {
        return "{$this->last_name}, {$this->first_name}";
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
