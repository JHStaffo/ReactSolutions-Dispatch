<?php

namespace App\Trips\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\ScopeItem;
use App\Trips\Models\Patient;
use App\Trips\Models\Trip;
use App\Trips\Patients;
use App\Trips\Trips;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Dispatch > Patients. Searches are POSTed so names never land in a URL or a log; opening a
 * record, and every search, is in the audit log with ids and counts only.
 */
class PatientController extends Controller
{
    public function __construct(private Patients $patients) {}

    public function index()
    {
        return view('trips.patients.index', ['results' => null, 'q' => '', 'inactive' => false, 'title' => 'Patients']);
    }

    public function search(Request $request)
    {
        $in = $request->validate(['q' => ['nullable', 'string', 'max:60'], 'inactive' => ['boolean']]);
        $results = $this->patients->search($in['q'] ?? '', (bool) ($in['inactive'] ?? false));
        audit_note('Searched patients: '.$results->count().' found.');

        return view('trips.patients.index', ['results' => $results, 'q' => $in['q'] ?? '', 'inactive' => (bool) ($in['inactive'] ?? false), 'title' => 'Patients']);
    }

    /** The intake form's patient search (JSON). */
    public function lookup(Request $request)
    {
        $in = $request->validate(['q' => ['required', 'string', 'min:2', 'max:60']]);
        $results = $this->patients->search($in['q'], false, 10);
        audit_note('Looked up patients for a trip: '.$results->count().' found.');

        return response()->json($results->map(fn (Patient $p) => [
            'id' => $p->id, 'number' => $p->patient_number, 'name' => $p->fullName(), 'dob' => $p->dob, 'age' => $p->age(), 'payer' => $p->payer,
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

        return view('trips.patients.show', [
            'patient' => $patient, 'upcoming' => $upcoming, 'past' => $all->reject(fn (Trip $t) => $t->isOpen())->values(),
            'alerts' => $upcoming->mapWithKeys(fn (Trip $t) => [$t->id => $trips->alerts($t)]),
            'title' => 'Patient '.$patient->patient_number,
        ]);
    }

    public function create()
    {
        return view('trips.patients.form', ['patient' => new Patient(['default_level' => 'bls', 'sex' => 'U', 'active' => true]), 'title' => 'Add a patient']);
    }

    public function store(Request $request)
    {
        $in = $this->validated($request);
        if ($dupe = $this->patients->findExact($in['first_name'], $in['last_name'], $in['dob'])) {
            return back()->withInput()->with('error', "That patient is already on file as {$dupe->patient_number}.");
        }
        $p = Patient::create($in + ['patient_number' => Patient::nextNumber(), 'updated_by' => $request->user()->id]);

        return redirect()->route('trips.patients.show', $p)->with('status', "Added patient {$p->patient_number}.");
    }

    public function edit(Request $request, Patient $patient)
    {
        AuditLog::record('trips.patients.view', "Opened patient {$patient->patient_number} to edit.", $request->user());

        return view('trips.patients.form', ['patient' => $patient, 'title' => 'Edit patient '.$patient->patient_number]);
    }

    public function update(Request $request, Patient $patient, Trips $trips)
    {
        $in = $this->validated($request);
        if ((int) $request->input('version') !== $patient->version) {
            return back()->withInput()->with('error', 'Someone else changed this patient while you were editing. Open it again to see their changes.');
        }
        $patient->fill($in);
        $changed = array_keys($patient->getDirty());
        $patient->fill(['version' => $patient->version + 1, 'updated_by' => $request->user()->id])->save();
        // Paperwork alerts on open trips may have changed: tell the boards.
        if (array_intersect($changed, ['pcs_expires', 'prior_auth_expires'])) {
            foreach ($patient->trips()->whereNotIn('status', ['completed', 'cancelled'])->get() as $t) {
                $trips->emit($t, $request->user());
            }
        }
        audit_note("Changed patient {$patient->patient_number}: ".($changed ? implode(', ', array_map(fn ($f) => str_replace('_', ' ', $f), $changed)) : 'nothing').'.');

        return redirect()->route('trips.patients.show', $patient)->with('status', "Saved patient {$patient->patient_number}.");
    }

    private function validated(Request $request): array
    {
        $in = $request->validate([
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'dob' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'sex' => ['required', Rule::in(['F', 'M', 'X', 'U'])],
            'weight_lbs' => ['nullable', 'integer', 'min:1', 'max:1500'],
            'phone' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:200'],
            'payer' => ['nullable', 'string', 'max:100'],
            'member_id' => ['nullable', 'string', 'max:60'],
            'pcs_expires' => ['nullable', 'date'],
            'prior_auth_number' => ['nullable', 'string', 'max:60'],
            'prior_auth_expires' => ['nullable', 'date'],
            'trips_authorized' => ['nullable', 'integer', 'min:0', 'max:999'],
            'default_level' => ['required', Rule::in(array_keys(ScopeItem::LEVELS))],
            'default_equipment' => ['array'],
            'default_equipment.*' => [Rule::in(array_keys(Trip::EQUIPMENT))],
            'stretcher_reason' => ['nullable', 'string', 'max:500'],
            'medical_notes' => ['nullable', 'string', 'max:2000'],
            'active' => ['boolean'],
        ]);
        $in['default_equipment'] = array_values($in['default_equipment'] ?? []);
        $in['active'] = $request->boolean('active');

        return $in;
    }
}
