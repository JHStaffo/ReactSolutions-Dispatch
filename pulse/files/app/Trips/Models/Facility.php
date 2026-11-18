<?php

namespace App\Trips\Models;

use Illuminate\Database\Eloquent\Model;

/** A hospital, dialysis center, nursing home or clinic trips go to and from. Not PHI. */
class Facility extends Model
{
    protected $table = 'trip_facilities';

    protected $guarded = [];

    public const KINDS = [
        'hospital' => 'Hospital',
        'dialysis' => 'Dialysis center',
        'snf' => 'Skilled nursing / nursing home',
        'rehab' => 'Rehab',
        'clinic' => 'Clinic / doctor\'s office',
        'imaging' => 'Imaging',
        'other' => 'Other',
    ];

    protected function casts(): array
    {
        return ['active' => 'boolean', 'lat' => 'float', 'lon' => 'float'];
    }

    public function toBoard(): array
    {
        return [
            'id' => $this->id, 'name' => $this->name, 'kind' => $this->kind, 'address' => $this->address,
            'phone' => $this->phone, 'lat' => $this->lat, 'lon' => $this->lon, 'active' => $this->active,
        ];
    }
}
