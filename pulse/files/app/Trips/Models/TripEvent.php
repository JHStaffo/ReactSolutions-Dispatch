<?php

namespace App\Trips\Models;

use Illuminate\Database\Eloquent\Model;

/** A change the trip board picks up on its next check (pages ask for every event after the last id they saw). */
class TripEvent extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = [];
}
