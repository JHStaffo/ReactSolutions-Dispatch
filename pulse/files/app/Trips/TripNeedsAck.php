<?php

namespace App\Trips;

use Exception;
use Illuminate\Http\JsonResponse;

/** An assignment the dispatcher has to confirm first (ALS trip on a BLS truck, overlap, off shift, out of service). */
class TripNeedsAck extends Exception
{
    /** @param  array<string, string>  $warnings  code => message */
    public function __construct(public array $warnings)
    {
        parent::__construct(implode(' ', $warnings));
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'error' => 'NEEDS_ACK',
            'message' => $this->getMessage(),
            'warnings' => collect($this->warnings)->map(fn ($m, $code) => ['code' => $code, 'message' => $m])->values(),
        ], 422);
    }
}
