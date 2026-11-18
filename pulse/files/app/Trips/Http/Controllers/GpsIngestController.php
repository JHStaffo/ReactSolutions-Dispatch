<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Trips\Gps;
use Illuminate\Http\Request;

/**
 * The GPS webhook: POST /api/trips/gps with header X-GPS-Key (or ?key= for providers that can
 * only set a URL, like Traccar's forward.url). ?format=traccar for Traccar, otherwise generic JSON.
 */
class GpsIngestController extends Controller
{
    public function __invoke(Request $request, Gps $gps)
    {
        if (! $gps->keyMatches($request->header('X-GPS-Key') ?? $request->query('key'))) {
            return response()->json(['error' => 'Bad or missing GPS key.'], 401);
        }
        $fixes = $gps->parse($request->query('format') === 'traccar' ? 'traccar' : 'generic', $request->json()->all());
        $saved = $gps->ingest($fixes);

        return response()->json(['accepted' => $saved]);
    }
}
