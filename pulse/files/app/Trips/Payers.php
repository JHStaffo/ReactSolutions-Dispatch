<?php

namespace App\Trips;

use App\Trips\Models\Patient;
use App\Trips\Models\PatientPayer;
use App\Trips\Models\Payer;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The shared payor list and each patient's payors. A payor typed that isn't on the list is added
 * to it once (matched on letters and digits, ignoring case), so the same company is never listed twice.
 */
class Payers
{
    /** The payor picked from the list (id), or the one with this name, or a new one. Null when both are empty. */
    public function resolve(?int $id, ?string $name): ?Payer
    {
        if ($id && ($p = Payer::find($id))) {
            return $p;
        }
        $name = Payer::tidy((string) $name);
        $key = Payer::keyFor($name);
        if ($key === '') {
            return null;
        }

        return Payer::where('name_key', $key)->first()
            ?? Payer::create(['name' => $name, 'name_key' => $key, 'kind' => $this->guessKind($name), 'added_from' => 'typed']);
    }

    /**
     * Replaces a patient's payors with these rows, in this order. Each row: payer_id or payer_name,
     * member_id, group_number, subscriber_name, subscriber_relationship, effective_from, effective_to,
     * eligibility_checked_on. Rows with no payor are skipped; the same payor twice is refused.
     */
    public function saveForPatient(Patient $patient, array $rows): void
    {
        DB::transaction(function () use ($patient, $rows) {
            $resolved = [];
            foreach (array_values($rows) as $i => $row) {
                $payer = $this->resolve(isset($row['payer_id']) ? (int) $row['payer_id'] : null, $row['payer_name'] ?? null);
                if (! $payer) {
                    continue;
                }
                if (isset($resolved[$payer->id])) {
                    throw ValidationException::withMessages(["payors.{$i}.payer_name" => "{$payer->name} is listed twice. List each payor once."]);
                }
                $resolved[$payer->id] = $row;
            }
            $patient->payers()->delete();
            $pos = 1;
            foreach ($resolved as $payerId => $row) {
                PatientPayer::create([
                    'patient_id' => $patient->id, 'payer_id' => $payerId, 'position' => $pos++,
                    'member_id' => $this->blank($row['member_id'] ?? null), 'group_number' => $this->blank($row['group_number'] ?? null),
                    'subscriber_name' => $this->blank($row['subscriber_name'] ?? null),
                    'subscriber_relationship' => $row['subscriber_relationship'] ?? 'self',
                    'effective_from' => $this->blank($row['effective_from'] ?? null), 'effective_to' => $this->blank($row['effective_to'] ?? null),
                    'eligibility_checked_on' => $this->blank($row['eligibility_checked_on'] ?? null),
                ]);
            }
            $patient->unsetRelation('payers');
        });
    }

    /**
     * Intake: the payor (and member id) typed for a trip. A payor the patient already has gets the
     * new member id; a new one is added as primary, moving the others down.
     */
    public function fromIntake(Patient $patient, Payer $payer, ?string $memberId): void
    {
        $existing = $patient->payers()->where('payer_id', $payer->id)->first();
        if ($existing) {
            if ($this->blank($memberId) !== null && $existing->member_id !== $memberId) {
                $existing->update(['member_id' => $memberId]);
            }

            return;
        }
        $patient->payers()->increment('position');
        PatientPayer::create(['patient_id' => $patient->id, 'payer_id' => $payer->id, 'position' => 1, 'member_id' => $this->blank($memberId), 'subscriber_relationship' => 'self']);
        $patient->unsetRelation('payers');
    }

    /** Moves every patient from one payor to another and removes the first (for duplicates). Returns patients moved. */
    public function merge(Payer $from, Payer $into): int
    {
        if ($from->is($into)) {
            return 0;
        }

        return DB::transaction(function () use ($from, $into) {
            $moved = 0;
            foreach ($from->patientPayers()->get() as $pp) {
                if (PatientPayer::where('patient_id', $pp->patient_id)->where('payer_id', $into->id)->exists()) {
                    $pp->delete(); // the patient already has the one being kept
                } else {
                    $pp->update(['payer_id' => $into->id]);
                }
                $moved++;
            }
            DB::table('trips')->where('payer', $from->name)->update(['payer' => $into->name]);
            DB::table('trips')->where('secondary_payer', $from->name)->update(['secondary_payer' => $into->name]);
            $from->delete();

            return $moved;
        });
    }

    private function guessKind(string $name): string
    {
        $n = mb_strtolower($name);

        return match (true) {
            str_contains($n, 'medicare') && (str_contains($n, 'advantage') || str_contains($n, 'hmo') || str_contains($n, 'ppo')) => 'medicare_adv',
            str_contains($n, 'medicare') => 'medicare',
            str_contains($n, 'medicaid') => 'medicaid',
            str_contains($n, 'self') => 'self_pay',
            str_contains($n, 'tricare') || str_contains($n, 'va ') || str_starts_with($n, 'va') => 'va',
            str_contains($n, 'workers') => 'workers_comp',
            default => 'commercial',
        };
    }

    private function blank(mixed $v): mixed
    {
        return is_string($v) ? (trim($v) === '' ? null : trim($v)) : $v;
    }
}
