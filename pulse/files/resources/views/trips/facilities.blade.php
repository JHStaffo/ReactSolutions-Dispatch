@extends('layouts.app')

{{-- Dispatch > Facilities: the address book intake picks pickups and destinations from. --}}
@section('band')
    <h1>Facilities</h1>
    <p>Hospitals, dialysis centers, nursing homes and offices. Intake offers these by name, the board shows their phone numbers, and a location puts them on the Trip Map.</p>
@endsection

@section('content')
@php($edit = $facilities->firstWhere('id', (int) request('edit')))
<div class="stack">
    <div class="card">
        <h2>{{ $edit ? 'Edit '.$edit->name : 'Add a facility' }}</h2>
        <form method="post" action="{{ $edit ? route('trips.facilities.update', $edit) : route('trips.facilities.store') }}">@csrf
            @if ($edit) @method('put') @endif
            <div class="field-row">
                <div class="field" style="flex:2"><label for="f-name">Name</label><input type="text" id="f-name" name="name" value="{{ old('name', $edit?->name) }}" required maxlength="120"></div>
                <div class="field"><label for="f-kind">Kind</label><select id="f-kind" name="kind">@foreach ($kinds as $k => $l)<option value="{{ $k }}" @selected(old('kind', $edit?->kind) === $k)>{{ $l }}</option>@endforeach</select></div>
                <div class="field"><label for="f-phone">Phone</label><input type="text" id="f-phone" name="phone" value="{{ old('phone', $edit?->phone) }}" maxlength="30"></div>
            </div>
            <div class="field-row">
                <div class="field" style="flex:2"><label for="f-addr">Address</label><input type="text" id="f-addr" name="address" value="{{ old('address', $edit?->address) }}" maxlength="200"></div>
                <div class="field"><label for="f-lat">Latitude</label><input type="text" id="f-lat" name="lat" inputmode="decimal" value="{{ old('lat', $edit?->lat) }}" placeholder="37.5407"></div>
                <div class="field"><label for="f-lon">Longitude</label><input type="text" id="f-lon" name="lon" inputmode="decimal" value="{{ old('lon', $edit?->lon) }}" placeholder="-77.4360"></div>
            </div>
            <p class="hint">For the map location, right-click the building in any online map and copy the latitude and longitude, or click the spot on the map below.</p>
            <div id="f-map" style="height:260px;border-radius:12px;margin-bottom:12px"></div>
            @if ($edit)<label class="check"><input type="hidden" name="active" value="0"><input type="checkbox" name="active" value="1" @checked(old('active', $edit->active))> Active (offered in intake)</label>@endif
            <p>
                <button type="submit" class="btn">{{ $edit ? 'Save' : 'Add facility' }}</button>
                @if ($edit)<a class="btn btn-outline" href="{{ route('trips.facilities') }}">Cancel</a>@endif
            </p>
        </form>
    </div>

    <div class="card">
        <h2>{{ $facilities->count() }} {{ str('facility')->plural($facilities->count()) }}</h2>
        @if ($facilities->isEmpty())
            <p class="empty">None yet.</p>
        @else
            <div class="table-wrap"><table>
                <tr><th>Name</th><th>Kind</th><th>Address</th><th>Phone</th><th>On the map</th><th></th></tr>
                @foreach ($facilities as $f)
                    <tr @class(['struck' => ! $f->active])>
                        <td><strong>{{ $f->name }}</strong>@unless ($f->active)<div class="hint">Turned off</div>@endunless</td>
                        <td>{{ $kinds[$f->kind] ?? $f->kind }}</td>
                        <td>{{ $f->address }}</td>
                        <td>{{ $f->phone }}</td>
                        <td>{!! $f->lat !== null ? '<span class="pill pill-green">Yes</span>' : '<span class="pill pill-amber">No</span>' !!}</td>
                        <td><a class="btn btn-small btn-outline" href="{{ route('trips.facilities') }}?edit={{ $f->id }}">Edit</a></td>
                    </tr>
                @endforeach
            </table></div>
        @endif
    </div>
</div>
@endsection

@push('scripts')
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
@php($places = $facilities->whereNotNull('lat')->map(fn ($f) => [$f->lat, $f->lon, $f->name])->values())
@php($center = array_map('floatval', explode(',', \App\Models\Setting::get('trips_sim_center'))))
<script>
(function () {
    if (!window.L) return;
    var lat = document.getElementById('f-lat'), lon = document.getElementById('f-lon');
    var places = @json($places);
    var center = @json($center);
    var map = L.map('f-map').setView(lat.value ? [+lat.value, +lon.value] : center, 12);
    L.tileLayer(@json(config('services.trips.map_tile_url')), { attribution: @json(config('services.trips.map_attribution')), maxZoom: 19 }).addTo(map);
    places.forEach(function (p) { L.circleMarker([p[0], p[1]], { radius: 6, color: '#0076a3' }).addTo(map).bindTooltip(p[2]); });
    var pin = lat.value ? L.marker([+lat.value, +lon.value]).addTo(map) : null;
    map.on('click', function (e) {
        lat.value = e.latlng.lat.toFixed(6); lon.value = e.latlng.lng.toFixed(6);
        if (pin) pin.setLatLng(e.latlng); else pin = L.marker(e.latlng).addTo(map);
    });
})();
</script>
@endpush
