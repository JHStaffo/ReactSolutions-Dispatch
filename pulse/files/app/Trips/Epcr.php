<?php

namespace App\Trips;

use App\Fleet\Models\Assignment;
use App\Models\Setting;
use App\Trips\Models\Trip;
use DOMDocument;
use DOMElement;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Throwable;

/**
 * What the ePCR imports from CAD, so crews don't retype the call: the patient, the times, where from
 * and to, the complaint and diagnoses, and the dispatch details. Billing is done from the ePCR, so
 * this is the only way trip data leaves Pulse.
 *
 * The XML uses NEMSIS 3.5 element names (eRecord, eResponse, eTimes, ePatient, eScene, eSituation,
 * eDisposition) for the fields that have one, with values as plain text. Code lists (sex, service
 * type, payment) and the exact import format differ by ePCR vendor, so map them once the vendor is
 * known. Everything without a NEMSIS element is under <PulseDispatch>.
 */
class Epcr
{
    /** Status times → NEMSIS eTimes. */
    private const TIMES = [
        'assigned' => 'eTimes.03', // unit notified by dispatch
        'enroute' => 'eTimes.05', // unit en route
        'on_scene' => 'eTimes.06', // unit arrived on scene
        'transporting' => 'eTimes.09', // unit left scene
        'at_destination' => 'eTimes.11', // patient arrived at destination
        'completed' => 'eTimes.13', // unit back in service
    ];

    public function key(): ?string
    {
        $stored = Setting::get('trips_epcr_key');
        try {
            return $stored !== '' ? Crypt::decryptString($stored) : null;
        } catch (Throwable) {
            return null;
        }
    }

    public function keyMatches(?string $given): bool
    {
        $key = $this->key();

        return $key !== null && is_string($given) && $given !== '' && hash_equals($key, $given);
    }

    /** Makes a new feed key (the old one stops working) and returns it to show once. */
    public function newKey(): string
    {
        $key = bin2hex(random_bytes(24));
        Setting::put('trips_epcr_key', Crypt::encryptString($key));

        return $key;
    }

    /** Trips a truck has been given, changed since $since, oldest change first. Not queued or cancelled ones. */
    public function changedSince(Carbon $since, int $limit = 200): Collection
    {
        return Trip::with(['vehicle', 'patient', 'orderingFacility', 'pickupFacility', 'destinationFacility'])
            ->whereNotNull('vehicle_id')->whereNotIn('status', ['queued', 'cancelled'])
            ->where('updated_at', '>', $since)->orderBy('updated_at')->orderBy('id')->limit($limit)->get();
    }

    /** @param  iterable<Trip>  $trips */
    public function xml(iterable $trips): string
    {
        $doc = new DOMDocument('1.0', 'UTF-8');
        $doc->formatOutput = true;
        $root = $doc->appendChild($doc->createElement('EMSDataSet'));
        $root->setAttribute('source', 'Pulse CAD');
        $root->setAttribute('nemsisVersion', '3.5 element names');
        $root->setAttribute('generated', now()->toIso8601String());
        foreach ($trips as $t) {
            $this->report($doc, $root, $t);
        }

        return $doc->saveXML();
    }

    /** The same fields as JSON, for an ePCR that would rather read that. */
    public function json(Trip $t): array
    {
        $doc = new DOMDocument('1.0', 'UTF-8');
        $root = $doc->appendChild($doc->createElement('x'));
        $this->report($doc, $root, $t);

        return $this->toArray($root->firstChild);
    }

    private function report(DOMDocument $doc, DOMElement $root, Trip $t): void
    {
        $tz = config('app.timezone');
        $at = fn (?string $iso) => $iso ? Carbon::parse($iso)->setTimezone($tz)->toIso8601String() : null;
        $p = $t->patient;
        $pcr = $root->appendChild($doc->createElement('PatientCareReport'));

        $this->group($doc, $pcr, 'eRecord', ['eRecord.01' => $t->trip_number]);
        $this->group($doc, $pcr, 'eResponse', [
            'eResponse.03' => $t->trip_number, // incident number
            'eResponse.04' => $t->trip_number, // response number
            'eResponse.05' => Trip::TYPES[$t->trip_type] ?? $t->trip_type, // type of service requested (map to the vendor's code)
            'eResponse.13' => $t->vehicle?->name, // vehicle number
            'eResponse.14' => $t->vehicle?->name, // call sign
            'eResponse.15' => \App\Models\ScopeItem::LEVELS[$t->level] ?? $t->level, // level of care of this unit
        ]);
        $times = ['eTimes.01' => $at($t->created_at?->toIso8601String())]; // call received
        foreach (self::TIMES as $status => $el) {
            $times[$el] = $at($t->status_times[$status] ?? null);
        }
        $this->group($doc, $pcr, 'eTimes', $times);
        $this->group($doc, $pcr, 'ePatient', [
            'ePatient.02' => $t->patient_last, 'ePatient.03' => $t->patient_first, 'ePatient.04' => $p?->middle_name,
            'ePatient.05' => $p?->address, 'ePatient.06' => $p?->city, 'ePatient.08' => $p?->state, 'ePatient.09' => $p?->zip,
            'ePatient.13' => ['F' => 'Female', 'M' => 'Male', 'X' => 'Unknown (Unable to Determine)', 'U' => 'Unknown (Unable to Determine)'][$p?->sex] ?? null,
            'ePatient.15' => Trips::age($t->patient_dob), 'ePatient.16' => 'Years',
            'ePatient.17' => $t->patient_dob, 'ePatient.18' => $p?->phone,
        ]);
        $this->group($doc, $pcr, 'eScene', [
            'eScene.13' => $t->pickup_location, // facility or location name
            'eScene.15' => $t->pickupFacility?->address ?? ($t->pickup_facility_id ? null : $t->pickup_location),
        ]);
        $dx = $t->diagnoses ?? [];
        $sit = $this->group($doc, $pcr, 'eSituation', [
            'eSituation.04' => $t->chief_complaint, // complaint
            'eSituation.11' => $dx[0]['code'] ?? null, // primary impression (ICD-10)
        ]);
        foreach (array_slice($dx, 1) as $d) {
            $this->el($doc, $sit, 'eSituation.12', $d['code']); // secondary impressions
        }
        $this->group($doc, $pcr, 'eDisposition', [
            'eDisposition.01' => $t->destination, // destination name
            'eDisposition.03' => $t->destinationFacility?->address ?? ($t->destination_facility_id ? null : $t->destination),
        ]);

        // Dispatch details with no NEMSIS element of their own.
        $x = $pcr->appendChild($doc->createElement('PulseDispatch'));
        $this->fields($doc, $x, [
            'TripNumber' => $t->trip_number, 'Leg' => $t->leg, 'LinkedTrip' => $t->linked_trip_id ? Trip::whereKey($t->linked_trip_id)->value('trip_number') : null,
            'PatientNumber' => $p?->patient_number, 'Mrn' => $p?->mrn, 'WeightLbs' => $t->weight_lbs, 'HeightIn' => $p?->height_in,
            'Level' => $t->level, 'Priority' => $t->priority, 'PickupMode' => $t->pickup_mode,
            'PickupTime' => $t->pickup_time?->setTimezone($tz)->toIso8601String(), 'QuotedTime' => $t->quoted_time?->setTimezone($tz)->toIso8601String(),
            'OrderingFacility' => $t->orderingFacility?->name, 'CallerName' => $t->caller_name, 'CallerTitle' => $t->caller_title, 'CallerPhone' => $t->caller_phone,
            'PickupDepartment' => $t->pickup_department, 'PickupRoom' => $t->pickup_room, 'PickupPhone' => $t->pickup_phone,
            'DropoffDepartment' => $t->dropoff_department, 'DropoffRoom' => $t->dropoff_room, 'DropoffPhone' => $t->dropoff_phone,
            'StretcherReason' => $t->stretcher_reason, 'Dnr' => $t->dnr ? 'Yes' : 'No',
            'OxygenLpm' => $t->oxygen_lpm, 'Stairs' => $t->stairs, 'Riders' => $t->riders, 'WaitAndReturn' => $t->wait_and_return ? 'Yes' : 'No',
            'PcsOnFile' => $t->pcs_on_file ? 'Yes' : 'No', 'PcsRequested' => $t->pcs_requested ? 'Yes' : 'No', 'PcsSigned' => $t->pcs_signed ? 'Yes' : 'No',
            'PriorAuth' => $t->prior_auth, 'PrimaryPayor' => $t->payer, 'PrimaryMemberId' => $t->member_id,
            'SecondaryPayor' => $t->secondary_payer, 'SecondaryMemberId' => $t->secondary_member_id,
            'DispatchNotes' => $t->notes, 'PatientDispatchNotes' => $p?->dispatch_notes, 'Baseline' => $p?->baseline,
            'OdometerPickup' => $t->odometer_pickup, 'OdometerDestination' => $t->odometer_destination, 'LoadedMiles' => $t->loaded_miles,
            'CrewNotes' => $t->crew_notes, 'Status' => $t->status,
        ]);
        $eq = $x->appendChild($doc->createElement('Equipment'));
        foreach ($t->equipment ?? [] as $e) {
            $this->el($doc, $eq, 'Item', Trip::EQUIPMENT[$e] ?? $e);
        }
        $dxs = $x->appendChild($doc->createElement('Diagnoses'));
        foreach ($dx as $i => $d) {
            $n = $this->el($doc, $dxs, 'Diagnosis', $d['description'] ?? '');
            $n->setAttribute('code', $d['code']);
            $n->setAttribute('primary', $i === 0 ? 'true' : 'false');
        }
        foreach ($t->physicians ?? [] as $role => $doctor) {
            $d = $x->appendChild($doc->createElement('Physician'));
            $d->setAttribute('role', $role);
            $this->fields($doc, $d, ['Name' => $doctor['name'] ?? null, 'Phone' => $doctor['phone'] ?? null, 'Fax' => $doctor['fax'] ?? null, 'Npi' => $doctor['npi'] ?? null]);
        }
        $crew = $x->appendChild($doc->createElement('Crew'));
        foreach ($this->crew($t) as $m) {
            $n = $this->el($doc, $crew, 'Member', $m['name']);
            $n->setAttribute('role', (string) $m['role']);
        }
    }

    /** Who was on the truck when the trip started. */
    private function crew(Trip $t): array
    {
        $when = $t->startsAt() ?? $t->created_at;
        if (! $t->vehicle_id || ! $when) {
            return [];
        }
        $a = Assignment::with('members')->where('vehicle_id', $t->vehicle_id)->where('starts_at', '<=', $when)->where('ends_at', '>', $when)->first();

        return $a ? $a->members->sortBy('position')->map(fn ($m) => ['name' => $m->user_name, 'role' => $m->role])->values()->all() : [];
    }

    private function group(DOMDocument $doc, DOMElement $parent, string $name, array $fields): DOMElement
    {
        $g = $parent->appendChild($doc->createElement($name));
        $this->fields($doc, $g, $fields);

        return $g;
    }

    /** Adds each field that has a value. */
    private function fields(DOMDocument $doc, DOMElement $parent, array $fields): void
    {
        foreach ($fields as $name => $value) {
            if ($value !== null && $value !== '') {
                $this->el($doc, $parent, $name, (string) $value);
            }
        }
    }

    private function el(DOMDocument $doc, DOMElement $parent, string $name, string $value): DOMElement
    {
        $n = $parent->appendChild($doc->createElement($name));
        $n->appendChild($doc->createTextNode($value));

        return $n;
    }

    /** Elements as nested arrays; repeatable ones are always lists, attributes are "@name". */
    private function toArray(DOMElement $el): array|string
    {
        $kids = array_filter(iterator_to_array($el->childNodes), fn ($n) => $n instanceof DOMElement);
        $out = [];
        foreach ($el->attributes ?? [] as $a) {
            $out['@'.$a->name] = $a->value;
        }
        if (! $kids) {
            return $out ? $out + ['value' => $el->textContent] : $el->textContent;
        }
        foreach ($kids as $k) {
            if (in_array($k->nodeName, ['Item', 'Member', 'Diagnosis', 'Physician', 'eSituation.12'], true)) {
                $out[$k->nodeName][] = $this->toArray($k);
            } else {
                $out[$k->nodeName] = $this->toArray($k);
            }
        }

        return $out;
    }
}
