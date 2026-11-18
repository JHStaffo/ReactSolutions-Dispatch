<?php

namespace App\Trips\Models;

use Illuminate\Database\Eloquent\Model;

/** One line of a trip's change history. Never holds patient details. */
class TripHistory extends Model
{
    protected $table = 'trip_history';

    public const UPDATED_AT = null;

    protected $guarded = [];
}
