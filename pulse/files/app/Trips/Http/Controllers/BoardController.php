<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\ScopeItem;
use App\Models\Setting;
use App\Models\User;
use App\Trips\Gps;
use App\Trips\Models\Facility;
use App\Trips\Models\Trip;
use App\Trips\Trips;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

/** Dispatch > Trip Board: the queue and the day's timeline, kept live by polling for changes. */
class BoardController extends Controller
{
    public function __construct(private Trips $trips, private Gps $gps) {}

    public function index(Request $request)
    {
        return view('trips.board', ['boot' => $this->payload($request, $this->day($request)) + ['constants' => self::constants()], 'title' => 'Trip Board']);
    }

    /** The board for another day (the day arrows). */
    public function data(Request $request)
    {
        return response()->json($this->payload($request, $this->day($request)));
    }

    /** Everything that changed after event `since`, plus truck positions and who else has the board open. */
    public function changes(Request $request)
    {
        $this->gps->simulate();
        $since = max(0, $request->integer('since'));
        $user = $request->user();
        $online = $this->touchPresence($user);

        return response()->json($this->trips->changesSince($since, $user) + [
            'gps' => $this->gps->latest(),
            'online' => $online,
            'facilitiesList' => null,
        ]);
    }

    public function facilities()
    {
        return response()->json(Facility::where('active', true)->orderBy('name')->get()->map->toBoard());
    }

    public function gps()
    {
        $this->gps->simulate();

        return response()->json($this->gps->latest());
    }

    private function payload(Request $request, Carbon $day): array
    {
        $user = $request->user();
        $this->gps->simulate();

        return [
            'day' => $day->toDateString(),
            'seq' => $this->trips->lastEventId(),
            'units' => $this->trips->units($day),
            'allTrucks' => $this->trips->allTrucks(),
            'trips' => $this->trips->boardTrips($day)->map(fn (Trip $t) => $this->trips->summary($t, $user))->values(),
            'facilities' => Facility::where('active', true)->orderBy('name')->get()->map->toBoard(),
            'gps' => $this->gps->latest(),
            'online' => $this->touchPresence($user),
            'me' => ['id' => $user->id, 'name' => $user->name],
            'can' => [
                'dispatch' => $user->hasPermission('trips_dispatch'),
                'supervise' => $user->hasPermission('trips_supervise'),
                'reports' => $user->hasPermission('trips_reports'),
            ],
            'settings' => [
                'lateMinutes' => (int) Setting::get('trips_late_minutes'),
                'staleMinutes' => (int) Setting::get('trips_gps_stale_minutes'),
                'idleMinutes' => (int) Setting::get('trips_idle_minutes'),
                'tileUrl' => config('services.trips.map_tile_url'),
                'attribution' => config('services.trips.map_attribution'),
                'center' => array_map('floatval', explode(',', Setting::get('trips_sim_center'))),
            ],
        ];
    }

    public static function constants(): array
    {
        return [
            'types' => Trip::TYPES, 'statuses' => Trip::STATUSES, 'flow' => Trip::FLOW, 'active' => Trip::ACTIVE,
            'equipment' => Trip::EQUIPMENT, 'alsEquipment' => Trip::ALS_EQUIPMENT, 'alsLevels' => Trip::ALS_LEVELS,
            'levels' => ScopeItem::LEVELS, 'cancelReasons' => Trip::CANCEL_REASONS, 'facilityKinds' => Facility::KINDS,
            'priorities' => Trip::PRIORITIES, 'unitStatuses' => \App\Trips\Mdt::UNIT_STATUSES, 'icd10' => \App\Trips\Icd10::picker(),
        ];
    }

    private function day(Request $request): Carbon
    {
        try {
            return $request->filled('day') ? Carbon::parse($request->string('day'))->startOfDay() : today();
        } catch (\Throwable) {
            return today();
        }
    }

    /** Who has the board open in the last minute (names only). */
    private function touchPresence(User $user): array
    {
        $map = collect(Cache::get('trips.online', []))->filter(fn ($p) => $p['at'] > now()->timestamp - 60);
        $map[$user->id] = ['name' => $user->name, 'at' => now()->timestamp];
        Cache::put('trips.online', $map->all(), 300);

        return $map->pluck('name')->sort()->values()->all();
    }
}
