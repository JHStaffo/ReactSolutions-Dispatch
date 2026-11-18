<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ScopeItem;
use App\Trips\Models\Facility;
use App\Trips\Models\Patient;
use App\Trips\Models\PatientPayer;
use App\Trips\Models\Trip;
use App\Trips\Patients;
use App\Trips\Payers;
use App\Trips\Trips;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Dispatch > Patients. Searches are POSTed so names never land in a URL or a log; opening a
 * record, and every search, is in the audit log with ids and counts only.
 */
class PatientController extends Controller
{
    public function __construct(private Patients $patients, private Payers $payers) {}

    public function index()
    {
        return view('trips.patients.index', ['results' => null, 'q' => '', 'inactive' => false, 'title' => 'Patients']);
    }

    public function search(Request $request)
    {
        $in = $request->validate(['q' => ['nullable', 'string', 'max:60'], 'inactive' => ['boolean']]);
        $results = $this->patients->search($in['q'] ?? '', (bool) ($in['inactive'] ?? false))->load('payers.payer');
        audit_note('Searched patients: '.$results->count().' found.');

        return view('trips.patients.index', ['results' => $results, 'q' => $in['q'] ?? '', 'inactive' => (bool) ($in['inactive'] ?? false), 'title' => 'Patients']);
    }

    /** The intake form's patient search (JSON). */
    public function lookup(Request $request)
    {
        $in = $request->validate(['q' => ['required', 'string', 'min:2', 'max:60']]);
        $results = $this->patients->search($in['q'], false, 10)->load('payers.payer');
        audit_note('Looked up patients for a trip: '.$results->count().' found.');

        return response()->json($results->map(fn (Patient $p) => [
            'id' => $p->id, 'number' => $p->patient_number, 'name' => $p->fullName(), 'dob' => $p->dob, 'age' => $p->age(), 'payer' => $p->primaryPayer()?->payer?->name,
        ])->values());
    }

    /** What intake fills in after picking a patient. */
    public function intake(Request $request, Patient $patient)
    {
        AuditLog::record('trips.patients.view', "Opened patient {$patient->patient_number} for a new trip.", $request->user());

        return response()->json($this->patients->forIntake($patient));
    }

    public function show(Request $request, Patient $patient, Trips $trips)
    {
        AuditLog::record('trips.patients.view', "Opened patient {$patient->patient_number}.", $request->user());
        $all = $patient->trips()->with('vehicle')->get()->sortByDesc(fn (Trip $t) => ($t->startsAt() ?? $t->created_at)->timestamp);
        $upcoming = $all->filter(fn (Trip $t) => $t->isOpen())->sortBy(fn (Trip $t) => ($t->startsAt() ?? $t->created_at)->timestamp)->values();

        $patient->load(['payers.payer', 'facility']);

        return view('trips.patients.show', [
            'patient' => $patient, 'upcoming' => $upcoming, 'past' => $all->reject(fn (Trip $t) => $t->isOpen())->values(),
            'alerts' => $upcoming->mapWithKeys(fn (Trip $t) => [$t->id => $trips->alerts($t)]),
            'title' => 'Patient '.$patient->patient_number,
        ]);
    }

    public function create()
    {
        return view('trips.patients.form', $this->formData(new Patient(['default_level' => 'bls', 'sex' => 'U', 'active' => true]), 'Add a patient'));
    }

    public function store(Request $request)
    {
        [$in, $payors] = $this->validated($request);
        if ($dupe = $this->patients->findExact($in['first_name'], $in['last_name'], $in['dob'])) {
            return back()->withInput()->with('error', "That patient is already on file as {$dupe->patient_number}.");
        }
        $p = DB::transaction(function () use ($in, $payors, $request) {
            $p = Patient::create($in + ['patient_number' => Patient::nextNumber(), 'updated_by' => $request->user()->id]);
            $this->payers->saveForPatient($p, $payors);

            return $p;
        });
        audit_note("Added patient {$p->patient_number}.");

        return redirect()->route('trips.patients.show', $p)->with('status', "Added patient {$p->patient_number}.");
    }

    public function edit(Request $request, Patient $patient)
    {
        AuditLog::record('trips.patients.view', "Opened patient {$patient->patient_number} to edit.", $request->user());

        return view('trips.patients.form', $this->formData($patient->load('payers.payer'), 'Edit patient '.$patient->patient_number));
    }

    public function update(Request $request, Patient $patient, Trips $trips)
    {
        [$in, $payors] = $this->validated($request);
        if ((int) $request->input('version') !== $patient->version) {
            return back()->withInput()->with('error', 'Someone else changed this patient while you were editing. Open it again to see their changes.');
        }
        $patient->fill($in);
        $changed = array_keys($patient->getDirty());
        $before = $this->payorSnapshot($patient);
        DB::transaction(function () use ($patient, $payors, $request) {
            $patient->fill(['version' => $patient->version + 1, 'updated_by' => $request->user()->id])->save();
            $this->payers->saveForPatient($patient, $payors);
        });
        if ($before !== $this->payorSnapshot($patient)) {
            $changed[] = 'payors';
        }
        // Paperwork alerts on open trips may have changed: tell the boards.
        if (array_intersect($changed, ['pcs_expires', 'prior_auth_expires'])) {
            foreach ($patient->trips()->whereNotIn('status', ['completed', 'cancelled'])->get() as $t) {
                $trips->emit($t, $request->user());
            }
        }
        audit_note("Changed patient {$patient->patient_number}: ".($changed ? implode(', ', array_map(fn ($f) => str_replace('_', ' ', $f), $changed)) : 'nothing').'.');

        return redirect()->route('trips.patients.show', $patient)->with('status', "Saved patient {$patient->patient_number}.");
    }

    /** The patient's fields, and their payor rows, from the form. */
    private function validated(Request $request): array
    {
        $date = ['nullable', 'date_format:Y-m-d'];
        $in = $request->validate([
            'first_name' => ['required', 'string', 'max:60'],
            'middle_name' => ['nullable', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'suffix' => ['nullable', 'string', 'max:10'],
            'dob' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'sex' => ['required', Rule::in(['F', 'M', 'X', 'U'])],
            'marital_status' => ['nullable', Rule::in(array_keys(Patient::MARITAL))],
            'race' => ['nullable', 'string', 'max:40'],
            'language' => ['nullable', 'string', 'max:40'],
            'weight_lbs' => ['nullable', 'integer', 'min:1', 'max:1500'],
            'height_in' => ['nullable', 'integer', 'min:10', 'max:108'],
            'mrn' => ['nullable', 'string', 'max:40'],
            'external_code' => ['nullable', 'string', 'max:60'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'email', 'max:120'],
            'address' => ['nullable', 'string', 'max:200'],
            'address2' => ['nullable', 'string', 'max:100'],
            'city' => ['nullable', 'string', 'max:60'],
            'state' => ['nullable', 'alpha', 'size:2'],
            'zip' => ['nullable', 'regex:/^\d{5}(-\d{4})?$/'],
            'county' => ['nullable', 'string', 'max:60'],
            'facility_id' => ['nullable', 'integer', Rule::exists('trip_facilities', 'id')],
            'employer' => ['nullable', 'string', 'max:100'],
            'nok_name' => ['nullable', 'string', 'max:100'],
            'nok_relationship' => ['nullable', 'string', 'max:40'],
            'nok_phone' => ['nullable', 'string', 'max:30'],
            'pcp_name' => ['nullable', 'string', 'max:100'],
            'pcp_npi' => ['nullable', 'digits:10'],
            'pcp_phone' => ['nullable', 'string', 'max:30'],
            'pcs_expires' => $date,
            'prior_auth_number' => ['nullable', 'string', 'max:60'],
            'prior_auth_expires' => $date,
            'trips_authorized' => ['nullable', 'integer', 'min:0', 'max:999'],
            'default_level' => ['required', Rule::in(array_keys(ScopeItem::LEVELS))],
            'default_equipment' => ['array'],
            'default_equipment.*' => [Rule::in(array_keys(Trip::EQUIPMENT))],
            'pickup_extra_min' => ['nullable', 'integer', 'min:0', 'max:120'],
            'dropoff_extra_min' => ['nullable', 'integer', 'min:0', 'max:120'],
            'stretcher_reason' => ['nullable', 'string', 'max:500'],
            'medical_notes' => ['nullable', 'string', 'max:2000'],
            'baseline' => ['nullable', 'string', 'max:2000'],
            'dispatch_notes' => ['nullable', 'string', 'max:1000'],
            'deceased_on' => [...$date, 'before_or_equal:today'],
            'reminders_opt_out' => ['boolean'],
            'active' => ['boolean'],
            'payors' => ['array', 'max:6'],
            'payors.*.payer_id' => ['nullable', 'integer', Rule::exists('trip_payers', 'id')],
            'payors.*.payer_name' => ['nullable', 'string', 'max:100'],
            'payors.*.member_id' => ['nullable', 'string', 'max:60'],
            'payors.*.group_number' => ['nullable', 'string', 'max:60'],
            'payors.*.subscriber_name' => ['nullable', 'string', 'max:100'],
            'payors.*.subscriber_relationship' => ['nullable', Rule::in(array_keys(PatientPayer::RELATIONSHIPS))],
            'payors.*.effective_from' => $date,
            'payors.*.effective_to' => [...$date, 'after_or_equal:payors.*.effective_from'],
            'payors.*.eligibility_checked_on' => [...$date, 'before_or_equal:today'],
        ], [
            'zip.regex' => 'Zip is 5 digits, or 5+4 (12345-6789).',
            'pcp_npi.digits' => 'An NPI is 10 digits.',
            'payors.*.effective_to.after_or_equal' => 'A payor\'s end date can\'t be before its start date.',
        ]);
        $payors = $in['payors'] ?? [];
        unset($in['payors']);
        $in['state'] = isset($in['state']) ? strtoupper($in['state']) : null;
        $in['default_equipment'] = array_values($in['default_equipment'] ?? []);
        $in['active'] = $request->boolean('active');
        $in['reminders_opt_out'] = $request->boolean('reminders_opt_out');

        return [$in, $payors];
    }

    private function formData(Patient $patient, string $title): array
    {
        $rows = old('payors', $patient->exists ? $patient->payers->map(fn (PatientPayer $pp) => [
            'payer_id' => $pp->payer_id, 'payer_name' => $pp->payer?->name, 'member_id' => $pp->member_id, 'group_number' => $pp->group_number,
            'subscriber_name' => $pp->subscriber_name, 'subscriber_relationship' => $pp->subscriber_relationship,
            'effective_from' => $pp->effective_from?->toDateString(), 'effective_to' => $pp->effective_to?->toDateString(),
            'eligibility_checked_on' => $pp->eligibility_checked_on?->toDateString(),
        ])->all() : []);

        return [
            'patient' => $patient, 'title' => $title, 'payorRows' => array_values($rows),
            'facilities' => Facility::where('active', true)->orderBy('name')->get(['id', 'name']),
        ];
    }

    /** Payors, member ids and dates as one string, to tell whether a save changed them. */
    private function payorSnapshot(Patient $patient): string
    {
        return $patient->payers()->get()->map(fn (PatientPayer $pp) => implode('|', [
            $pp->payer_id, $pp->member_id, $pp->group_number, $pp->subscriber_name, $pp->subscriber_relationship,
            $pp->effective_from?->toDateString(), $pp->effective_to?->toDateString(), $pp->eligibility_checked_on?->toDateString(),
        ]))->join(';');
    }
}
