<?php

namespace App\Trips;

use App\Models\Setting;
use App\Models\Vehicle;
use App\Trips\Models\GpsPosition;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Truck positions from third-party GPS units. Three ways in: a keyed webhook any provider can
 * post to (generic JSON or Traccar's forward format), Samsara polling from the cron, and a crew
 * phone sharing its location. Positions carry no patient data. A simulator moves trucks whose
 * device id starts with SIM- for demos.
 */
class Gps
{
    // ---------------------------------------------------------------- keys

    public function ingestKey(): ?string
    {
        $stored = Setting::get('trips_gps_key');
        try {
            return $stored !== '' ? Crypt::decryptString($stored) : null;
        } catch (Throwable) {
            return null;
        }
    }

    public function keyMatches(?string $given): bool
    {
        $key = $this->ingestKey();

        return $key !== null && is_string($given) && $given !== '' && hash_equals($key, $given);
    }

    /** Makes a new webhook key (the old one stops working) and returns it to show once. */
    public function newKey(): string
    {
        $key = bin2hex(random_bytes(24));
        Setting::put('trips_gps_key', Crypt::encryptString($key));

        return $key;
    }

    public function samsaraToken(): ?string
    {
        $stored = Setting::get('trips_samsara_token');
        try {
            return $stored !== '' ? Crypt::decryptString($stored) : null;
        } catch (Throwable) {
            return null;
        }
    }

    // ---------------------------------------------------------------- ingest

    /**
     * Saves fixes: [['deviceId', 'lat', 'lon', 'speedMph'?, 'heading'?, 'at'?], ...]. Unknown devices
     * are kept too (a truck can be given that device id later). Returns how many were saved.
     */
    public function ingest(array $fixes, string $source = 'gps'): int
    {
        $byDevice = Vehicle::whereNotNull('gps_device_id')->pluck('id', 'gps_device_id');
        $rows = [];
        foreach ($fixes as $f) {
            $device = mb_substr(trim((string) ($f['deviceId'] ?? '')), 0, 64);
            $lat = is_numeric($f['lat'] ?? null) ? (float) $f['lat'] : null;
            $lon = is_numeric($f['lon'] ?? null) ? (float) $f['lon'] : null;
            if ($device === '' || $lat === null || $lon === null || abs($lat) > 90 || abs($lon) > 180) {
                continue;
            }
            try {
                $at = isset($f['at']) && $f['at'] ? Carbon::parse($f['at'])->setTimezone(config('app.timezone')) : now();
            } catch (Throwable) {
                $at = now();
            }
            if ($at->gt(now()->addMinutes(5))) {
                $at = now();
            }
            $rows[] = [
                'device_id' => $device, 'vehicle_id' => $byDevice[$device] ?? null, 'lat' => round($lat, 6), 'lon' => round($lon, 6),
                'speed_mph' => round(max(0, min(200, (float) ($f['speedMph'] ?? 0))), 1),
                'heading' => (int) round(fmod(fmod((float) ($f['heading'] ?? 0), 360) + 360, 360)),
                'source' => $source, 'recorded_at' => $at,
            ];
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            GpsPosition::insert($chunk);
        }

        return count($rows);
    }

    /** Reads a webhook body: generic JSON (one fix, a list, or {"positions": [...]}) or Traccar's forward.json. */
    public function parse(string $format, mixed $body): array
    {
        $num = fn ($v) => is_numeric($v) ? (float) $v : null;
        if ($format === 'traccar') {
            $list = isset($body['position']) ? [$body] : (is_array($body) && array_is_list($body) ? $body : [$body]);

            return array_map(fn ($b) => [
                'deviceId' => (string) ($b['device']['uniqueId'] ?? $b['device']['name'] ?? $b['position']['deviceId'] ?? ''),
                'lat' => $num($b['position']['latitude'] ?? null),
                'lon' => $num($b['position']['longitude'] ?? null),
                // Traccar sends knots.
                'speedMph' => ($num($b['position']['speed'] ?? 0) ?? 0) * 1.15078,
                'heading' => $num($b['position']['course'] ?? 0) ?? 0,
                'at' => $b['position']['fixTime'] ?? $b['position']['deviceTime'] ?? null,
            ], $list);
        }
        $list = is_array($body) && array_is_list($body) ? $body : (isset($body['positions']) && is_array($body['positions']) ? $body['positions'] : [$body]);

        return array_map(function ($b) use ($num) {
            $b = is_array($b) ? $b : [];
            $speed = $num($b['speedMph'] ?? null) ?? (($kph = $num($b['speedKph'] ?? null)) !== null ? $kph * 0.621371 : $num($b['speed'] ?? 0));

            return [
                'deviceId' => (string) ($b['deviceId'] ?? $b['device_id'] ?? $b['imei'] ?? $b['id'] ?? ''),
                'lat' => $num($b['lat'] ?? $b['latitude'] ?? null),
                'lon' => $num($b['lon'] ?? $b['lng'] ?? $b['longitude'] ?? null),
                'speedMph' => $speed ?? 0,
                'heading' => $num($b['heading'] ?? $b['course'] ?? 0) ?? 0,
                'at' => $b['timestamp'] ?? $b['time'] ?? $b['at'] ?? null,
            ];
        }, $list);
    }

    // ---------------------------------------------------------------- reading

    /** The newest fix for each truck with a GPS device id (or any device seen in the last day). */
    public function latest(): Collection
    {
        $since = now()->subDay();
        $ids = GpsPosition::where('recorded_at', '>=', $since)->groupBy('device_id')->select(DB::raw('MAX(id) as id'))->pluck('id');
        $byDevice = Vehicle::whereNotNull('gps_device_id')->pluck('id', 'gps_device_id');
        $stale = (int) Setting::get('trips_gps_stale_minutes');

        return GpsPosition::whereIn('id', $ids)->get()->map(fn (GpsPosition $p) => [
            'deviceId' => $p->device_id,
            'vehicleId' => $byDevice[$p->device_id] ?? $p->vehicle_id,
            'lat' => $p->lat, 'lon' => $p->lon, 'speedMph' => $p->speed_mph, 'heading' => $p->heading,
            'at' => $p->recorded_at->toIso8601String(), 'source' => $p->source,
            'stale' => $p->recorded_at->lt(now()->subMinutes($stale)),
        ])->values();
    }

    /** Miles a truck drove since a time, from its breadcrumbs, or null with fewer than two fixes. */
    public function milesSince(?int $vehicleId, Carbon $since): ?float
    {
        if (! $vehicleId) {
            return null;
        }
        $device = Vehicle::whereKey($vehicleId)->value('gps_device_id');
        $points = GpsPosition::where(fn ($q) => $q->where('vehicle_id', $vehicleId)->when($device, fn ($q) => $q->orWhere('device_id', $device)))
            ->where('recorded_at', '>=', $since)->orderBy('recorded_at')->orderBy('id')->get(['lat', 'lon']);
        if ($points->count() < 2) {
            return null;
        }
        $miles = 0.0;
        for ($i = 1; $i < $points->count(); $i++) {
            $leg = self::miles($points[$i - 1]->lat, $points[$i - 1]->lon, $points[$i]->lat, $points[$i]->lon);
            // Ignore jumps a truck can't make between fixes (a bad fix or a device swap).
            if ($leg < 5) {
                $miles += $leg;
            }
        }

        return round($miles, 1);
    }

    public static function miles(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $r = 3958.8;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        return 2 * $r * asin(min(1, sqrt($a)));
    }

    // ---------------------------------------------------------------- Samsara and the simulator

    /** Pulls every vehicle's location from Samsara (run each minute from the cron when a token is set). */
    public function pollSamsara(): int
    {
        $token = $this->samsaraToken();
        if (! $token) {
            return 0;
        }
        $res = Http::withToken($token)->acceptJson()->timeout(20)->get(config('services.trips.samsara_url'));
        if (! $res->ok()) {
            throw new \RuntimeException('Samsara answered '.$res->status().'.');
        }
        $known = Vehicle::whereNotNull('gps_device_id')->pluck('gps_device_id')->all();
        $fixes = [];
        foreach ($res->json('data') ?? [] as $v) {
            // Match on the vehicle's name in Samsara when a truck uses it as its device id, else its Samsara id.
            $id = in_array((string) ($v['name'] ?? ''), $known, true) ? (string) $v['name'] : (string) ($v['id'] ?? '');
            $loc = $v['location'] ?? [];
            $fixes[] = ['deviceId' => $id, 'lat' => $loc['latitude'] ?? null, 'lon' => $loc['longitude'] ?? null, 'speedMph' => $loc['speed'] ?? 0, 'heading' => $loc['heading'] ?? 0, 'at' => $loc['time'] ?? null];
        }

        return $this->ingest($fixes);
    }

    /**
     * Demo only: nudges each SIM- truck along a loop around the center, at most every 5 seconds.
     * Runs when the board or map checks for changes, so it needs no background process.
     */
    public function simulate(): void
    {
        if (Setting::get('trips_gps_simulator') !== '1' || ! Cache::add('trips.sim.tick', 1, 5)) {
            return;
        }
        [$lat0, $lon0] = array_map('floatval', explode(',', Setting::get('trips_sim_center')) + [0, 0]);
        $t = now()->timestamp;
        $fixes = [];
        foreach (Vehicle::where('gps_device_id', 'like', 'SIM-%')->orderBy('id')->get() as $i => $v) {
            $seed = crc32($v->gps_device_id);
            $radius = 0.03 + ($seed % 50) / 1000;
            $speed = 0.0009 + ($seed % 7) / 10000;
            $angle = ($seed % 360) * M_PI / 180 + $t * $speed;
            $parked = ($seed + intdiv($t, 300)) % 4 === 0;
            if ($parked) {
                $angle = ($seed % 360) * M_PI / 180 + intdiv($t, 300) * 300 * $speed;
            }
            $fixes[] = [
                'deviceId' => $v->gps_device_id,
                'lat' => $lat0 + $radius * sin($angle), 'lon' => $lon0 + $radius * 1.3 * cos($angle),
                'speedMph' => $parked ? 0 : 25 + $seed % 20, 'heading' => (int) (rad2deg($angle) + 90) % 360,
            ];
        }
        $this->ingest($fixes, 'simulator');
    }

    /** Keeps 90 days of breadcrumbs (enough for loaded miles and questions about a trip). */
    public function prune(int $days = 90): int
    {
        return GpsPosition::where('recorded_at', '<', now()->subDays($days))->delete();
    }
}
