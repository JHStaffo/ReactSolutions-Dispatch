<?php

namespace App\Trips;

use App\Trips\Models\Patient;
use Illuminate\Database\Eloquent\Collection;

/**
 * Finding patients. Names and dates of birth are encrypted, so search decrypts in PHP. That is
 * fine for a transport service's patient list (thousands, not millions); move to a keyed blind
 * index like App\Services\Ssn if it ever gets slow.
 */
class Patients
{
    /** Patients whose name, number, date of birth, MRN or phone contain every word typed. */
    public function search(string $q, bool $includeInactive = false, int $limit = 50): Collection
    {
        $words = array_filter(preg_split('/[\s,]+/', mb_strtolower(trim($q))) ?: []);
        $out = new Collection;
        Patient::query()->when(! $includeInactive, fn ($b) => $b->where('active', true))->orderBy('id')
            ->chunk(500, function ($chunk) use ($words, $out) {
                foreach ($chunk as $p) {
                    $hay = mb_strtolower("{$p->last_name} {$p->first_name} {$p->middle_name} {$p->patient_number} {$p->dob} {$p->mrn} ").preg_replace('/\D/', '', (string) $p->phone);
                    if (! $words || collect($words)->every(fn ($w) => str_contains($hay, $w))) {
                        $out->push($p);
                    }
                }
            });

        return $out->sortBy(fn (Patient $p) => mb_strtolower($p->last_name.' '.$p->first_name))->take($limit)->values();
    }

    /** The patient with exactly this name and date of birth, if there is one. */
    public function findExact(string $first, string $last, string $dob): ?Patient
    {
        [$first, $last] = [mb_strtolower(trim($first)), mb_strtolower(trim($last))];
        $found = null;
        Patient::query()->orderBy('id')->chunk(500, function ($chunk) use ($first, $last, $dob, &$found) {
            foreach ($chunk as $p) {
                if ($p->dob === $dob && mb_strtolower($p->last_name) === $last && mb_strtolower($p->first_name) === $first) {
                    $found = $p;

                    return false;
                }
            }
        });

        return $found;
    }

    /** What the intake form fills in after a patient is picked. */
    public function forIntake(Patient $p): array
    {
        $last = $p->trips()->latest('id')->first();
        $p->loadMissing('payers.payer', 'facility');
        $primary = $p->payers->get(0);
        $second = $p->payers->get(1);

        return [
            'id' => $p->id, 'number' => $p->patient_number, 'first' => $p->first_name, 'last' => $p->last_name, 'dob' => $p->dob,
            'age' => $p->age(), 'weightLbs' => $p->weight_lbs, 'phone' => $p->phone, 'address' => $p->fullAddress(),
            'payerId' => $primary?->payer_id, 'payer' => $primary?->payer?->name, 'memberId' => $primary?->member_id,
            'secondaryPayer' => $second?->payer?->name, 'dispatchNotes' => $p->dispatch_notes, 'baseline' => $p->baseline,
            'livesAt' => $p->facility ? ['id' => $p->facility->id, 'name' => $p->facility->name] : null,
            'deceased' => $p->deceased_on?->toDateString(),
            'priorAuth' => $p->prior_auth_number, 'pcsExpires' => $p->pcs_expires?->toDateString(),
            'level' => $p->default_level, 'equipment' => $p->default_equipment ?? [], 'stretcherReason' => $p->stretcher_reason,
            'lastTrip' => $last ? [
                'tripType' => $last->trip_type, 'chiefComplaint' => $last->chief_complaint,
                'pickupLocation' => $last->pickup_location, 'pickupFacilityId' => $last->pickup_facility_id,
                'destination' => $last->destination, 'destinationFacilityId' => $last->destination_facility_id,
                'durationMin' => $last->duration_min, 'pickupRoom' => $last->pickup_room, 'pickupDepartment' => $last->pickup_department,
                'dropoffRoom' => $last->dropoff_room, 'dropoffDepartment' => $last->dropoff_department,
                'diagnoses' => $last->diagnoses ?? [], 'oxygenLpm' => $last->oxygen_lpm, 'stairs' => $last->stairs,
            ] : null,
        ];
    }
}
