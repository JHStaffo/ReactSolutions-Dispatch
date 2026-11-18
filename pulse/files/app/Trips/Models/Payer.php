<?php

namespace App\Trips\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** An insurance company or other payor, listed once and shared by every patient. */
class Payer extends Model
{
    protected $table = 'trip_payers';

    protected $guarded = [];

    public const KINDS = [
        'medicare' => 'Medicare',
        'medicare_adv' => 'Medicare Advantage',
        'medicaid' => 'Medicaid',
        'medicaid_mco' => 'Medicaid managed care',
        'commercial' => 'Commercial insurance',
        'va' => 'VA / Tricare',
        'workers_comp' => 'Workers\' compensation',
        'facility' => 'Facility contract',
        'self_pay' => 'Self pay',
        'other' => 'Other',
    ];

    protected function casts(): array
    {
        return ['active' => 'boolean'];
    }

    public function patientPayers(): HasMany
    {
        return $this->hasMany(PatientPayer::class, 'payer_id');
    }

    /** "Sample  Medicare." and "sample medicare" are the same payor. */
    public static function keyFor(string $name): string
    {
        return mb_substr(preg_replace('/[^a-z0-9]/', '', mb_strtolower($name)), 0, 100);
    }

    public static function tidy(string $name): string
    {
        return mb_substr(trim(preg_replace('/\s+/', ' ', $name)), 0, 100);
    }

    public function toPicker(): array
    {
        return ['id' => $this->id, 'name' => $this->name, 'kind' => self::KINDS[$this->kind] ?? $this->kind, 'code' => $this->payer_code];
    }
}
