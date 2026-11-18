<?php

namespace App\Trips;

use App\Models\User;
use App\Models\Vehicle;
use App\Trips\Models\Trip;
use Illuminate\Support\Facades\DB;

/**
 * The crew's MDT (mobile data terminal): the truck's own status, odometer readings and notes to
 * dispatch. Trip status steps go through Trips::setStatus like the board's.
 */
class Mdt
{
    public const UNIT_STATUSES = [
        'available' => 'Available',
        'at_station' => 'At station',
        'fuel' => 'Getting fuel',
        'meal' => 'Meal break',
        'cleaning' => 'Cleaning the truck',
        'out_of_service' => 'Out of service',
    ];

    public function __construct(private Trips $trips) {}

    public function setUnitStatus(Vehicle $v, string $status, User $by): void
    {
        $v->forceFill(['trip_unit_status' => $status, 'trip_unit_status_at' => now()])->save();
        audit_note(($v->name ?: $v->plate).': '.self::UNIT_STATUSES[$status].'.');
        $this->trips->emit(null, $by, null, 'units');
    }

    /** Odometer readings and a note from the crew. Field names only go in the history. */
    public function update(Trip $t, array $in, int $expected, User $by): Trip
    {
        return DB::transaction(function () use ($t, $in, $expected, $by) {
            $t = Trip::lockForUpdate()->findOrFail($t->id);
            $this->trips->checkVersion($t, $expected);
            $t->fill(array_intersect_key($in, array_flip(['odometer_pickup', 'odometer_destination', 'crew_notes'])));
            $changed = array_keys($t->getDirty());
            if (! $changed) {
                return $t;
            }
            // Loaded miles from the odometer when GPS didn't measure them.
            if ($t->loaded_miles === null && $t->odometer_pickup !== null && $t->odometer_destination !== null && $t->odometer_destination >= $t->odometer_pickup) {
                $t->loaded_miles = round($t->odometer_destination - $t->odometer_pickup, 1);
            }
            $t->fill(['version' => $t->version + 1, 'updated_by' => $by->id])->save();
            $names = implode(', ', array_map(fn ($f) => str_replace('_', ' ', $f), $changed));
            $this->trips->history($t, $by, 'crew', 'Crew updated '.$names);
            audit_note("{$t->trip_number}: crew updated {$names}.");
            $this->trips->emit($t, $by);

            return $t;
        });
    }
}
