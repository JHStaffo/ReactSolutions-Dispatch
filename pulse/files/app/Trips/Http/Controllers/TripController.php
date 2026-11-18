<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ScopeItem;
use App\Models\Vehicle;
use App\Trips\Models\Trip;
use App\Trips\Trips;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/** Booking and dispatching trips from the board. Every answer is JSON; every change is version-checked. */
class TripController extends Controller
{
    public function __construct(private Trips $trips) {}

    public function store(Request $request)
    {
        $in = $request->validate([
            'patient_id' => ['nullable', 'integer', 'exists:trip_patients,id'],
            'patient_first' => ['required', 'string', 'max:60'],
            'patient_last' => ['required', 'string', 'max:60'],
            'patient_dob' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'weight_lbs' => ['nullable', 'integer', 'min:1', 'max:1500'],
            'payer_id' => ['nullable', 'integer', 'exists:trip_payers,id'],
            'payer' => ['nullable', 'string', 'max:100'],
            'member_id' => ['nullable', 'string', 'max:60'],
            'prior_auth' => ['nullable', 'string', 'max:60'],
            'pcs_on_file' => ['boolean'],
            'pcs_requested' => ['boolean'],
            'pcs_signed' => ['boolean'],
            'ordering_facility_id' => ['nullable', 'integer', 'exists:trip_facilities,id'],
            'caller_name' => ['nullable', 'string', 'max:100'],
            'caller_title' => ['nullable', 'string', 'max:60'],
            'caller_phone' => ['nullable', 'string', 'max:30'],
            'pickup_room' => ['nullable', 'string', 'max:40'],
            'pickup_department' => ['nullable', 'string', 'max:60'],
            'pickup_phone' => ['nullable', 'string', 'max:30'],
            'dropoff_room' => ['nullable', 'string', 'max:40'],
            'dropoff_department' => ['nullable', 'string', 'max:60'],
            'dropoff_phone' => ['nullable', 'string', 'max:30'],
            'priority' => ['nullable', Rule::in(array_keys(Trip::PRIORITIES))],
            'quoted_time' => ['nullable', 'date'],
            'oxygen_lpm' => ['nullable', 'numeric', 'min:0', 'max:60'],
            'stairs' => ['nullable', 'integer', 'min:0', 'max:20'],
            'riders' => ['nullable', 'integer', 'min:0', 'max:4'],
            'dnr' => ['boolean'],
            'diagnoses' => ['array', 'max:12'],
            'diagnoses.*.code' => ['nullable', 'string', 'regex:'.\App\Trips\Icd10::PATTERN],
            'diagnoses.*.description' => ['nullable', 'string', 'max:200'],
            'physicians' => ['array'],
            'physicians.*.name' => ['nullable', 'string', 'max:100'],
            'physicians.*.phone' => ['nullable', 'string', 'max:30'],
            'physicians.*.fax' => ['nullable', 'string', 'max:30'],
            'physicians.*.npi' => ['nullable', 'digits:10'],
            'level' => ['required', Rule::in(array_keys(ScopeItem::LEVELS))],
            'trip_type' => ['required', Rule::in(array_keys(Trip::TYPES))],
            'equipment' => ['array'],
            'equipment.*' => [Rule::in(array_keys(Trip::EQUIPMENT))],
            'chief_complaint' => ['required', 'string', 'max:500'],
            'stretcher_reason' => ['required', 'string', 'max:500'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'pickup_mode' => ['required', Rule::in(['asap', 'scheduled', 'will_call'])],
            'pickup_time' => ['nullable', 'required_if:pickup_mode,scheduled', 'date'],
            'duration_min' => ['nullable', 'integer', 'min:15', 'max:600'],
            'pickup_facility_id' => ['nullable', 'integer', 'exists:trip_facilities,id'],
            'pickup_location' => ['nullable', 'required_without:pickup_facility_id', 'string', 'max:200'],
            'destination_facility_id' => ['nullable', 'integer', 'exists:trip_facilities,id'],
            'destination' => ['nullable', 'required_without:destination_facility_id', 'string', 'max:200'],
            'round_trip' => ['boolean'],
            'return_mode' => ['nullable', Rule::in(['scheduled', 'will_call', 'wait'])],
            'return_time' => ['nullable', 'required_if:return_mode,scheduled', 'date'],
            'repeat_days' => ['array'],
            'repeat_days.*' => ['integer', 'between:1,7'],
            'repeat_weeks' => ['nullable', 'integer', 'min:1', 'max:26'],
        ], [
            'pickup_location.required_without' => 'Pick or type a pickup location.', 'destination.required_without' => 'Pick or type a destination.',
            'diagnoses.*.code.regex' => 'Type diagnosis codes as ICD-10 (for example N18.6).', 'physicians.*.npi.digits' => 'An NPI is 10 digits.',
        ]);

        $made = $this->trips->create($in, $request->user());
        $numbers = $made->pluck('trip_number');
        audit_note(trim('Booked '.$numbers->join(', ').'. '.$request->attributes->get('audit', '')));

        return response()->json(['trips' => $made->map(fn (Trip $t) => $this->trips->summary($t->fresh('patient'), $request->user()))->values()], 201);
    }

    /** The trip drawer. Opening a trip is a look at patient details, so it's in the audit log. */
    public function show(Request $request, Trip $trip)
    {
        AuditLog::record('trips.view', "Opened trip {$trip->trip_number}.", $request->user());

        return response()->json($this->trips->detail($trip, $request->user()));
    }

    public function update(Request $request, Trip $trip)
    {
        $in = $request->validate([
            'expected_version' => ['required', 'integer'],
            'level' => [Rule::in(array_keys(ScopeItem::LEVELS))],
            'trip_type' => [Rule::in(array_keys(Trip::TYPES))],
            'equipment' => ['array'],
            'equipment.*' => [Rule::in(array_keys(Trip::EQUIPMENT))],
            'chief_complaint' => ['string', 'max:500'],
            'stretcher_reason' => ['string', 'max:500'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'pickup_mode' => [Rule::in(['asap', 'scheduled', 'will_call'])],
            'pickup_time' => ['nullable', 'date'],
            'duration_min' => ['integer', 'min:15', 'max:600'],
            'weight_lbs' => ['nullable', 'integer', 'min:1', 'max:1500'],
            'prior_auth' => ['nullable', 'string', 'max:60'],
            'pcs_on_file' => ['boolean'],
            'pcs_requested' => ['boolean'],
            'pcs_signed' => ['boolean'],
            'loaded_miles' => ['nullable', 'numeric', 'min:0', 'max:2000'],
            'priority' => [Rule::in(array_keys(Trip::PRIORITIES))],
            'quoted_time' => ['nullable', 'date'],
            'oxygen_lpm' => ['nullable', 'numeric', 'min:0', 'max:60'],
            'stairs' => ['nullable', 'integer', 'min:0', 'max:20'],
            'riders' => ['nullable', 'integer', 'min:0', 'max:4'],
            'dnr' => ['boolean'],
            'pickup_room' => ['nullable', 'string', 'max:40'],
            'pickup_department' => ['nullable', 'string', 'max:60'],
            'pickup_phone' => ['nullable', 'string', 'max:30'],
            'dropoff_room' => ['nullable', 'string', 'max:40'],
            'dropoff_department' => ['nullable', 'string', 'max:60'],
            'dropoff_phone' => ['nullable', 'string', 'max:30'],
            'diagnoses' => ['array', 'max:12'],
            'diagnoses.*.code' => ['nullable', 'string', 'regex:'.\App\Trips\Icd10::PATTERN],
            'diagnoses.*.description' => ['nullable', 'string', 'max:200'],
        ]);
        $t = $this->trips->update($trip, $in, $in['expected_version'], $request->user());

        return response()->json(['trip' => $this->trips->detail($t->fresh(), $request->user())]);
    }

    public function assign(Request $request, Trip $trip)
    {
        $in = $request->validate([
            'vehicle_id' => ['required', 'integer', 'exists:vehicles,id'],
            'start' => ['required', 'date'],
            'expected_version' => ['required', 'integer'],
            'acknowledge' => ['array'],
            'acknowledge.*' => ['string'],
        ]);
        $t = $this->trips->assign($trip, Vehicle::findOrFail($in['vehicle_id']), Carbon::parse($in['start']), $in['acknowledge'] ?? [], $in['expected_version'], $request->user());

        return response()->json(['trip' => $this->trips->summary($t->fresh('patient'), $request->user())]);
    }

    public function unassign(Request $request, Trip $trip)
    {
        $in = $request->validate(['expected_version' => ['required', 'integer']]);
        $t = $this->trips->unassign($trip, $in['expected_version'], $request->user());

        return response()->json(['trip' => $this->trips->summary($t->fresh('patient'), $request->user())]);
    }

    public function status(Request $request, Trip $trip)
    {
        $in = $request->validate([
            'status' => ['required', Rule::in(array_keys(Trip::STATUSES))],
            'expected_version' => ['required', 'integer'],
            'reason' => ['nullable', 'string', 'max:200'],
        ]);
        $t = $this->trips->setStatus($trip, $in['status'], $in['expected_version'], $request->user(), $in['reason'] ?? null);

        return response()->json(['trip' => $this->trips->summary($t->fresh('patient'), $request->user())]);
    }

    public function suggestions(Trip $trip)
    {
        return response()->json($this->trips->suggestions($trip));
    }
}
