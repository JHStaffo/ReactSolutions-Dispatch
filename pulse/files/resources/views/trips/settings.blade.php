@extends('layouts.app')

{{-- Dispatch > Trip Settings: GPS connection, each truck's phone and GPS id, and timing. --}}
@section('band')
    <h1>Trip Settings</h1>
    <p>Connect the trucks' GPS units, set each truck's phone, and choose when trips count as late and when idle screens sign out.</p>
@endsection

@section('content')
<div class="stack">
    <div class="card">
        <h2>GPS from the trucks</h2>
        <p>Trucks show on the Trip Map and the board from any of these. Positions older than a day are deleted every night.</p>
        <h3>1. A GPS unit or service that can post to a web address (webhook)</h3>
        <p>Point it at <code>{{ route('trips.gps.ingest') }}</code> with the header <code>X-GPS-Key: your key</code>. It accepts <code>{"deviceId":"…","lat":…,"lon":…,"speedMph":…,"heading":…,"at":"…"}</code> (one or a list), or Traccar's position forwarding format.</p>
        @if ($newKey)
            <div class="flash flash-ok"><strong>Your new key:</strong> <code style="user-select:all">{{ $newKey }}</code><br>Copy it now and put it in the GPS service. It won't be shown again.</div>
        @endif
        <form method="post" action="{{ route('trips.settings.gps-key') }}" onsubmit="return {{ $hasKey ? "confirm('The old key stops working right away. Make a new one?')" : 'true' }}">@csrf
            <p>{!! $hasKey ? '<span class="pill pill-green">A key is set</span>' : '<span class="pill pill-amber">No key yet: the webhook is off</span>' !!}
            <button type="submit" class="btn btn-small btn-outline">{{ $hasKey ? 'Make a new key' : 'Make a key' }}</button></p>
        </form>
    </div>

    <form method="post" action="{{ route('trips.settings.update') }}" class="card">@csrf @method('put')
        <h3>2. Samsara</h3>
        <p>{!! $hasSamsara ? '<span class="pill pill-green">Connected</span> Pulse reads vehicle locations from Samsara every minute.' : '<span class="pill pill-amber">Not connected</span>' !!}</p>
        <div class="field"><label for="s-token">Samsara API token {{ $hasSamsara ? '(leave blank to keep the current one)' : '' }}</label><input id="s-token" type="password" name="samsara_token" autocomplete="off" maxlength="300"></div>
        @if ($hasSamsara)<label class="check"><input type="checkbox" name="remove_samsara" value="1"> Disconnect Samsara</label>@endif
        <p class="hint">The token is stored encrypted. In Samsara, make a read-only token with the Vehicles permission. Each truck's GPS device id below is its Samsara vehicle id.</p>

        <h3>3. Practice trucks (simulator)</h3>
        <label class="check"><input type="hidden" name="trips_gps_simulator" value="0"><input type="checkbox" name="trips_gps_simulator" value="1" @checked($settings['trips_gps_simulator'] === '1')> Move trucks whose GPS device id starts with <code>SIM-</code> around the map (for training and demos)</label>
        <div class="field"><label for="s-center">Map center (latitude,longitude)</label><input type="text" id="s-center" name="trips_sim_center" value="{{ old('trips_sim_center', $settings['trips_sim_center']) }}" required></div>

        <h2>Timing</h2>
        <div class="field-row">
            <div class="field"><label for="s-late">A scheduled pickup is late after (minutes)</label><input id="s-late" type="number" name="trips_late_minutes" min="0" max="120" value="{{ old('trips_late_minutes', $settings['trips_late_minutes']) }}" required></div>
            <div class="field"><label for="s-stale">GPS counts as old after (minutes)</label><input id="s-stale" type="number" name="trips_gps_stale_minutes" min="1" max="120" value="{{ old('trips_gps_stale_minutes', $settings['trips_gps_stale_minutes']) }}" required></div>
            <div class="field"><label for="s-idle">Sign out idle trip screens after (minutes)</label><input id="s-idle" type="number" name="trips_idle_minutes" min="5" max="60" value="{{ old('trips_idle_minutes', $settings['trips_idle_minutes']) }}" required></div>
        </div>
        <p class="hint">Idle sign-out is the HIPAA automatic logoff for screens that show patients: the board, map and My Trips sign out when nobody has touched them for this long.</p>
        <button type="submit" class="btn">Save settings</button>
    </form>

    <form method="post" action="{{ route('trips.settings.trucks') }}" class="card">@csrf @method('put')
        <h2>Trucks</h2>
        @if ($trucks->isEmpty())
            <p class="empty">No company vehicles yet. Add them on Admin &gt; Vehicles &gt; Vehicle List.</p>
        @else
            <div class="table-wrap"><table>
                <tr><th>Truck</th><th>Crew phone</th><th>GPS device id</th><th>Last position</th></tr>
                @foreach ($trucks as $v)
                    @php($pos = $v->gps_device_id ? $positions->get($v->gps_device_id) : null)
                    <tr @class(['struck' => ! $v->active])>
                        <td><strong>{{ $v->name ?: $v->plate }}</strong></td>
                        <td><input type="text" name="trucks[{{ $v->id }}][trip_phone]" value="{{ old("trucks.{$v->id}.trip_phone", $v->trip_phone) }}" maxlength="30"></td>
                        <td><input type="text" name="trucks[{{ $v->id }}][gps_device_id]" value="{{ old("trucks.{$v->id}.gps_device_id", $v->gps_device_id) }}" maxlength="64"></td>
                        <td>@if ($pos)<span class="pill {{ $pos['stale'] ? 'pill-amber' : 'pill-green' }}">{{ \Illuminate\Support\Carbon::parse($pos['at'])->diffForHumans() }}</span> <span class="hint">{{ $pos['source'] }}</span>@else<span class="hint">None today</span>@endif</td>
                    </tr>
                @endforeach
            </table></div>
            <button type="submit" class="btn">Save trucks</button>
        @endif
    </form>
</div>
@endsection
