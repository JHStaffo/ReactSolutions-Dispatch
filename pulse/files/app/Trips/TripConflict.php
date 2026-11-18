<?php

namespace App\Trips;

use App\Trips\Models\Trip;
use Exception;
use Illuminate\Http\JsonResponse;

/** Someone else changed the trip after this page loaded it. The board reloads it and says who. */
class TripConflict extends Exception
{
    public function __construct(public Trip $trip)
    {
        parent::__construct('Changed by '.($trip->updater?->name ?? 'someone else').' first. The board has the latest; try again.');
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'error' => 'VERSION_CONFLICT',
            'message' => $this->getMessage(),
            'trip' => app(Trips::class)->summary($this->trip, request()->user()),
        ], 409);
    }
}
