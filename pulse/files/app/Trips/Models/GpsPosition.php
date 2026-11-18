<?php

namespace App\Trips\Models;

use Illuminate\Database\Eloquent\Model;

/** One GPS fix from a truck's GPS unit, a crew phone or the demo simulator. */
class GpsPosition extends Model
{
    protected $table = 'trip_gps_positions';

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['lat' => 'float', 'lon' => 'float', 'speed_mph' => 'float', 'heading' => 'integer', 'recorded_at' => 'datetime'];
    }
}
