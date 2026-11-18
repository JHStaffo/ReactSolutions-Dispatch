<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Models\Vehicle;
use App\Trips\Epcr;
use App\Trips\Gps;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Validation\Rule;

/** Dispatch > Trip Settings: GPS connection, the ePCR feed, each truck's phone and GPS device id, and timing. */
class SettingsController extends Controller
{
    public function index(Gps $gps, Epcr $epcr)
    {
        return view('trips.settings', [
            'hasEpcrKey' => $epcr->key() !== null,
            'newEpcrKey' => session('trips_new_epcr_key'),
            'lastEpcrPull' => \App\Trips\Models\Trip::max('epcr_pulled_at'),
            'trucks' => Vehicle::where('kind', 'company')->orderByDesc('active')->orderBy('name')->get(),
            'hasKey' => $gps->ingestKey() !== null,
            'newKey' => session('trips_new_key'),
            'hasSamsara' => $gps->samsaraToken() !== null,
            'settings' => collect(['trips_gps_simulator', 'trips_sim_center', 'trips_idle_minutes', 'trips_gps_stale_minutes', 'trips_late_minutes'])->mapWithKeys(fn ($k) => [$k => Setting::get($k)]),
            'positions' => app(Gps::class)->latest()->keyBy('deviceId'),
            'title' => 'Trip Settings',
        ]);
    }

    public function update(Request $request)
    {
        $in = $request->validate([
            'trips_idle_minutes' => ['required', 'integer', 'min:5', 'max:60'],
            'trips_gps_stale_minutes' => ['required', 'integer', 'min:1', 'max:120'],
            'trips_late_minutes' => ['required', 'integer', 'min:0', 'max:120'],
            'trips_sim_center' => ['required', 'regex:/^-?\d{1,2}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/'],
            'samsara_token' => ['nullable', 'string', 'max:300'],
            'remove_samsara' => ['boolean'],
        ], ['trips_sim_center.regex' => 'Type the map center as latitude,longitude (for example 37.5407,-77.4360).']);
        foreach (['trips_idle_minutes', 'trips_gps_stale_minutes', 'trips_late_minutes'] as $k) {
            Setting::put($k, (string) $in[$k]);
        }
        Setting::put('trips_sim_center', preg_replace('/\s+/', '', $in['trips_sim_center']));
        Setting::put('trips_gps_simulator', $request->boolean('trips_gps_simulator') ? '1' : '0');
        if ($request->boolean('remove_samsara')) {
            Setting::put('trips_samsara_token', '');
        } elseif (! empty($in['samsara_token'])) {
            Setting::put('trips_samsara_token', Crypt::encryptString(trim($in['samsara_token'])));
        }

        return back()->with('status', 'Saved trip settings.');
    }

    public function newKey(Gps $gps)
    {
        $key = $gps->newKey();
        audit_note('Made a new GPS webhook key (the old one stopped working).');

        return back()->with('trips_new_key', $key)->with('status', 'Made a new GPS key. Copy it now: it won\'t be shown again.');
    }

    public function newEpcrKey(Epcr $epcr)
    {
        $key = $epcr->newKey();
        audit_note('Made a new ePCR feed key (the old one stopped working).');

        return back()->with('trips_new_epcr_key', $key)->with('status', 'Made a new ePCR key. Copy it now: it won\'t be shown again.');
    }

    public function trucks(Request $request)
    {
        $in = $request->validate([
            'trucks' => ['array'],
            'trucks.*.trip_phone' => ['nullable', 'string', 'max:30'],
            'trucks.*.gps_device_id' => ['nullable', 'string', 'max:64'],
        ]);
        $ids = collect($in['trucks'] ?? [])->pluck('gps_device_id')->map(fn ($v) => trim((string) $v))->filter();
        if ($ids->count() !== $ids->unique()->count()) {
            return back()->withInput()->with('error', 'Two trucks have the same GPS device id.');
        }
        $changed = 0;
        foreach ($in['trucks'] ?? [] as $id => $row) {
            $v = Vehicle::where('kind', 'company')->find($id);
            if (! $v) {
                continue;
            }
            $v->fill(['trip_phone' => trim((string) ($row['trip_phone'] ?? '')) ?: null, 'gps_device_id' => trim((string) ($row['gps_device_id'] ?? '')) ?: null]);
            if ($v->isDirty()) {
                $v->save();
                $changed++;
            }
        }

        return back()->with('status', $changed ? "Saved {$changed} ".str('truck')->plural($changed).'.' : 'Nothing changed.');
    }
}
