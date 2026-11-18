<?php

namespace App\Http\Middleware;

use App\Models\AuditLog;
use App\Models\Setting;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Automatic sign-out on the trip pages, which show patient information (HIPAA automatic logoff).
 * Opening a page or doing something counts as activity; the board's background checks only count
 * when they say the person touched the page (active=1). A check that finds the page idle for longer
 * than Trip Settings' idle minutes signs the person out.
 */
class TripsIdle
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! Auth::check() || ! $request->hasSession()) {
            return $next($request);
        }
        $session = $request->session();
        $isCheck = $request->routeIs('trips.changes', 'trips.crew.data', 'trips.gps') && ! $request->boolean('active');
        $last = $session->get('trips_active_at');
        $limit = max(5, (int) Setting::get('trips_idle_minutes')) * 60;

        if ($isCheck && $last !== null && now()->timestamp - $last > $limit) {
            AuditLog::record('logout', 'Signed out automatically after '.intdiv($limit, 60).' idle minutes on a trip page.', $request->user());
            Auth::logout();
            $session->invalidate();
            $session->regenerateToken();

            return response()->json(['error' => 'IDLE', 'message' => 'Signed out after '.intdiv($limit, 60).' minutes without activity.'], 401);
        }
        if (! $isCheck) {
            $session->put('trips_active_at', now()->timestamp);
        }

        return $next($request);
    }
}
