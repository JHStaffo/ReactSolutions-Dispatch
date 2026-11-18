<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Trips\Models\Facility;
use App\Trips\Trips;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Dispatch > Facilities: the address book of hospitals, dialysis centers and nursing homes, with map locations. */
class FacilityController extends Controller
{
    public function index()
    {
        return view('trips.facilities', ['facilities' => Facility::orderByDesc('active')->orderBy('name')->get(), 'kinds' => Facility::KINDS, 'title' => 'Facilities']);
    }

    public function store(Request $request, Trips $trips)
    {
        $f = Facility::create($this->validated($request));
        $trips->emit(null, $request->user(), null, 'facilities');

        return back()->with('status', "Added {$f->name}.");
    }

    public function update(Request $request, Facility $facility, Trips $trips)
    {
        $facility->update($this->validated($request, $facility));
        $trips->emit(null, $request->user(), null, 'facilities');

        return back()->with('status', "Saved {$facility->name}.");
    }

    private function validated(Request $request, ?Facility $f = null): array
    {
        $in = $request->validate([
            'name' => ['required', 'string', 'max:120', Rule::unique('trip_facilities', 'name')->ignore($f?->id)],
            'kind' => ['required', Rule::in(array_keys(Facility::KINDS))],
            'address' => ['nullable', 'string', 'max:200'],
            'phone' => ['nullable', 'string', 'max:30'],
            'lat' => ['nullable', 'numeric', 'between:-90,90', 'required_with:lon'],
            'lon' => ['nullable', 'numeric', 'between:-180,180', 'required_with:lat'],
        ]);

        return $in + ['active' => $request->boolean('active', $f === null)];
    }
}
