<?php

namespace App\Trips;

use App\Fleet\Models\Assignment;
use App\Models\Setting;
use App\Models\User;
use App\Models\Vehicle;
use App\Trips\Models\Facility;
use App\Trips\Models\Patient;
use App\Trips\Models\Trip;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Made-up demo data for the Trip Board (`php artisan trips:sample`): facilities, sample trucks with
 * simulated GPS and today's crews, fictional patients, two weeks of history and today's trips.
 * Every name is obviously fake. Never run it on a live system with real patients.
 */
class Sample
{
    private const FACILITIES = [
        ['Riverside Dialysis Center', 'dialysis', '(555) 010-4001', 0.012, -0.018],
        ['Northgate Kidney Care', 'dialysis', '(555) 010-4002', 0.041, 0.006],
        ['Lakeview Regional Medical Center', 'hospital', '(555) 010-4003', -0.008, 0.022],
        ['St. Example General Hospital', 'hospital', '(555) 010-4004', 0.027, -0.035],
        ['Oak Hollow Skilled Nursing', 'snf', '(555) 010-4006', -0.031, -0.012],
        ['Maple Gardens Rehab & SNF', 'rehab', '(555) 010-4007', -0.019, 0.044],
        ['Summit Cardiology Clinic', 'clinic', '(555) 010-4008', 0.006, 0.031],
        ['Valley Imaging', 'imaging', '(555) 010-4009', 0.035, 0.028],
    ];

    private const TRUCKS = [
        ['Medic 12', 'SMPL12', '(555) 010-1212', 'als', [['R. Alvarez', 'Paramedic'], ['K. Brennan', 'EMT']]],
        ['Medic 14', 'SMPL14', '(555) 010-1414', 'als', [['D. Okafor', 'Paramedic'], ['S. Patel', 'AEMT']]],
        ['BLS 3', 'SMPL03', '(555) 010-0303', 'bls', [['M. Castillo', 'EMT'], ['J. Romero', 'EMT']]],
        ['BLS 5', 'SMPL05', '(555) 010-0505', 'bls', [['A. Whitfield', 'EMT'], ['P. Kowalski', 'EMT']]],
        ['BLS 7', 'SMPL07', '(555) 010-0707', 'bls', [['G. Mensah', 'EMT'], ['H. Lindqvist', 'EMT']]],
    ];

    private const PATIENTS = [
        ['Ada', 'Sample', '1948-03-14', 'F', 162, 'Sample Medicare', 'dialysis'],
        ['Fred', 'Fakename', '1937-07-02', 'M', 176, 'Sample Health PPO', 'snf_to_er'],
        ['Jo', 'Dummy', '1971-01-19', 'F', 260, 'Example Medicaid', 'discharge'],
        ['Ed', 'Mockwell', '1944-10-30', 'M', 140, 'Sample Medicare', 'doctor'],
        ['Gail', 'Specimen', '1963-05-08', 'F', 238, 'Placeholder Mutual', 'doctor'],
        ['Hal', 'Example', '1949-12-24', 'M', 190, 'Sample Medicare', 'interfacility'],
        ['Bea', 'Testcase', '1952-08-11', 'F', 150, 'Example Medicaid', 'dialysis'],
        ['Cy', 'Demo', '1958-02-27', 'M', 205, 'Sample Health PPO', 'interfacility'],
        ['Dot', 'Placeholder', '1940-06-15', 'F', 128, 'Sample Medicare', 'dialysis'],
    ];

    public function load(User $by): array
    {
        $now = now();
        $today = $now->copy()->startOfDay();
        [$lat0, $lon0] = array_map('floatval', explode(',', Setting::get('trips_sim_center')));
        $f = [];
        foreach (self::FACILITIES as [$name, $kind, $phone, $dLat, $dLon]) {
            $f[$name] = Facility::updateOrCreate(['name' => $name], ['kind' => $kind, 'phone' => $phone, 'address' => 'Sample address, '.$name, 'lat' => $lat0 + $dLat, 'lon' => $lon0 + $dLon, 'active' => true]);
        }

        $trucks = [];
        foreach (self::TRUCKS as $i => [$name, $plate, $phone, $level, $crew]) {
            $v = Vehicle::updateOrCreate(['plate' => $plate], ['kind' => 'company', 'name' => $name, 'trip_phone' => $phone, 'gps_device_id' => 'SIM-'.preg_replace('/\D/', '', $plate), 'active' => true]);
            $trucks[$name] = $v;
            $start = $today->copy()->setTime(6 + ($i % 3), 0);
            $a = Assignment::updateOrCreate(['service_date' => $today->toDateString(), 'shift_key' => 'sample', 'vehicle_id' => $v->id], [
                'shift_name' => 'Sample shift', 'starts_at' => $start, 'ends_at' => $start->copy()->addHours($i === 0 ? 24 : 12),
                'vehicle_name' => $name, 'status' => 'in_service', 'level' => $level, 'created_by' => $by->id, 'updated_by' => $by->id,
            ]);
            $a->members()->delete();
            foreach ($crew as $pos => [$who, $role]) {
                $a->members()->create(['user_name' => $who, 'role' => $role, 'position' => $pos]);
            }
            // Put whoever loaded the sample on the first truck too, so My Trips has something to show them.
            if ($i === 0) {
                $a->members()->create(['user_id' => $by->id, 'user_name' => $by->name, 'role' => 'Third rider', 'position' => count($crew)]);
            }
        }
        Setting::put('trips_gps_simulator', '1');

        $patients = [];
        foreach (self::PATIENTS as $i => [$first, $last, $dob, $sex, $lbs, $payer, $type]) {
            $existing = app(Patients::class)->findExact($first, $last, $dob);
            $patients[] = $existing ?? Patient::create([
                'patient_number' => Patient::nextNumber(), 'first_name' => $first, 'last_name' => $last, 'dob' => $dob, 'sex' => $sex,
                'weight_lbs' => $lbs, 'payer' => $payer, 'member_id' => 'SMP'.str_pad((string) (1000 + $i), 6, '0', STR_PAD_LEFT),
                'pcs_expires' => match ($i % 4) { 0 => $today->copy()->addMonths(3), 1 => $today->copy()->addDays(4), 2 => null, default => $today->copy()->subDays(2) },
                'prior_auth_number' => $payer === 'Sample Health PPO' ? 'AUTH-'.(5000 + $i) : null,
                'prior_auth_expires' => $payer === 'Sample Health PPO' ? $today->copy()->addDays($i % 2 ? 3 : 40) : null,
                'default_level' => in_array($type, ['interfacility', 'snf_to_er'], true) ? 'als' : 'bls',
                'stretcher_reason' => 'Bed-confined; unable to sit upright for transport (sample)',
                'medical_notes' => 'Sample record. No real patient information.',
            ]);
        }

        $trips = app(Trips::class);
        $made = 0;
        $book = function (Patient $p, string $type, string $level, string $mode, ?Carbon $time, string $from, string $to, ?Vehicle $v = null, string $status = 'queued', array $equipment = []) use ($trips, $by, $f, &$made) {
            $t = $trips->create([
                'patient_id' => $p->id, 'patient_first' => $p->first_name, 'patient_last' => $p->last_name, 'patient_dob' => $p->dob,
                'level' => $level, 'trip_type' => $type, 'equipment' => $equipment, 'pcs_on_file' => (bool) $p->pcs_expires,
                'chief_complaint' => match ($type) { 'dialysis' => 'ESRD, scheduled hemodialysis', 'snf_to_er' => 'Altered mental status (sample)', 'discharge' => 'Discharge home after hip repair (sample)', 'interfacility' => 'Transfer for cardiology workup (sample)', default => 'Follow-up appointment (sample)' },
                'stretcher_reason' => $p->stretcher_reason, 'pickup_mode' => $mode, 'pickup_time' => $time?->format('Y-m-d H:i'),
                'pickup_facility_id' => $f[$from]->id ?? null, 'pickup_location' => $from,
                'destination_facility_id' => $f[$to]->id ?? null, 'destination' => $to, 'duration_min' => $level === 'bls' ? 60 : 90,
            ], $by)->first();
            if ($v) {
                $t->forceFill(['vehicle_id' => $v->id, 'scheduled_start' => $time ?? now(), 'status' => $status, 'status_times' => $this->times($time ?? now(), $status)])->save();
                if ($status === 'completed') {
                    $t->forceFill(['loaded_miles' => round(3 + crc32($t->trip_number) % 90 / 10, 1)])->save();
                }
            }
            $made++;

            return $t;
        };

        // Two weeks of Mon/Wed/Fri dialysis for the dialysis patients, all completed.
        $dialysis = array_values(array_filter($patients, fn ($p, $i) => self::PATIENTS[$i][6] === 'dialysis', ARRAY_FILTER_USE_BOTH));
        for ($d = 14; $d >= 1; $d--) {
            $day = $today->copy()->subDays($d);
            if (! in_array($day->isoWeekday(), [1, 3, 5], true)) {
                continue;
            }
            foreach ($dialysis as $k => $p) {
                $truck = $trucks[['BLS 3', 'BLS 5', 'BLS 7'][$k % 3]];
                $book($p, 'dialysis', 'bls', 'scheduled', $day->copy()->setTime(6 + $k, 30), 'Oak Hollow Skilled Nursing', 'Riverside Dialysis Center', $truck, 'completed', ['oxygen']);
            }
        }
        // A cancelled trip last week.
        $c = $book($patients[3], 'doctor', 'bls', 'scheduled', $today->copy()->subDays(5)->setTime(10, 0), 'Oak Hollow Skilled Nursing', 'Summit Cardiology Clinic');
        $c->forceFill(['status' => 'cancelled', 'cancel_reason' => 'Patient refused', 'status_times' => ['queued' => $c->created_at->toIso8601String(), 'cancelled' => $c->created_at->toIso8601String()]])->save();

        // Today.
        $hour = fn (int $h, int $m = 0) => $today->copy()->setTime($h, $m);
        $book($patients[0], 'dialysis', 'bls', 'scheduled', $hour(6, 30), 'Oak Hollow Skilled Nursing', 'Riverside Dialysis Center', $trucks['BLS 3'], $now->gt($hour(8)) ? 'completed' : 'assigned', ['oxygen']);
        $book($patients[6], 'dialysis', 'bls', 'scheduled', $hour(7, 15), 'Maple Gardens Rehab & SNF', 'Northgate Kidney Care', $trucks['BLS 5'], $now->gt($hour(7, 15)) ? 'enroute' : 'assigned');
        $book($patients[5], 'interfacility', 'als', 'scheduled', $hour(9), 'Lakeview Regional Medical Center', 'St. Example General Hospital', $trucks['Medic 12'], 'assigned', ['cardiac_monitor', 'iv_pump']);
        $book($patients[0], 'dialysis', 'bls', 'scheduled', $hour(11), 'Riverside Dialysis Center', 'Oak Hollow Skilled Nursing', $trucks['BLS 3'], 'assigned', ['oxygen']);
        $book($patients[8], 'dialysis', 'bls', 'scheduled', $hour(10, 30), 'Oak Hollow Skilled Nursing', 'Northgate Kidney Care', $trucks['BLS 7'], 'assigned');
        $book($patients[1], 'snf_to_er', 'als', 'asap', null, 'Oak Hollow Skilled Nursing', 'Lakeview Regional Medical Center', null, 'queued', ['oxygen', 'cardiac_monitor']);
        $book($patients[2], 'discharge', 'bls', 'asap', null, 'Lakeview Regional Medical Center', 'Sample residence, 45 Example Blvd', null, 'queued', ['bariatric', 'stair_chair']);
        $book($patients[3], 'doctor', 'bls', 'scheduled', $hour(13), 'Maple Gardens Rehab & SNF', 'Summit Cardiology Clinic', null, 'queued', ['oxygen']);
        $book($patients[4], 'doctor', 'bls', 'scheduled', $hour(14, 30), 'Sample residence, 88 Example Ave', 'Valley Imaging');
        $book($patients[7], 'interfacility', 'als', 'scheduled', $hour(15), 'St. Example General Hospital', 'Lakeview Regional Medical Center', null, 'queued', ['ventilator', 'cardiac_monitor', 'suction']);

        // Upcoming dialysis (a standing order for next week).
        $trips->create([
            'patient_id' => $patients[6]->id, 'patient_first' => $patients[6]->first_name, 'patient_last' => $patients[6]->last_name, 'patient_dob' => $patients[6]->dob,
            'level' => 'bls', 'trip_type' => 'dialysis', 'equipment' => [], 'pcs_on_file' => true, 'chief_complaint' => 'ESRD, scheduled hemodialysis',
            'stretcher_reason' => 'Bed-confined (sample)', 'pickup_mode' => 'scheduled', 'pickup_time' => $today->copy()->addDay()->setTime(7, 15)->format('Y-m-d H:i'),
            'pickup_facility_id' => $f['Maple Gardens Rehab & SNF']->id, 'pickup_location' => '', 'destination_facility_id' => $f['Northgate Kidney Care']->id, 'destination' => '',
            'repeat_days' => [1, 3, 5], 'repeat_weeks' => 2, 'round_trip' => true, 'return_mode' => 'will_call',
        ], $by);

        return ['facilities' => count($f), 'trucks' => count($trucks), 'patients' => count($patients), 'trips' => $made];
    }

    private function times(Carbon $start, string $status): array
    {
        $flow = ['queued', ...Trip::FLOW];
        $out = [];
        foreach ($flow as $i => $s) {
            // Assigned 30 minutes before pickup, on scene at pickup time, then 15 minutes a step.
            $out[$s] = $start->copy()->addMinutes($i === 0 ? -120 : ($i - 3) * 15)->toIso8601String();
            if ($s === $status) {
                break;
            }
        }

        return $out;
    }
}
