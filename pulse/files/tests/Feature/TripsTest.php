<?php

namespace Tests\Feature;

use App\Fleet\Models\Assignment;
use App\Models\AuditLog;
use App\Models\PermissionProfile;
use App\Models\User;
use App\Models\Vehicle;
use App\Trips\Gps;
use App\Trips\Models\Facility;
use App\Trips\Models\GpsPosition;
use App\Trips\Models\Patient;
use App\Trips\Models\Trip;
use App\Trips\Models\TripEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Dispatch > Trip Board and the pages around it (App\Trips). All patients here are made up. */
class TripsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $dispatcher;

    private User $viewer;

    private User $crew;

    private Vehicle $bls;

    private Vehicle $als;

    private Facility $home;

    private Facility $dialysis;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->setDate(2026, 11, 16)->setTime(9, 0));
        $profile = fn (string $name, array $perms) => PermissionProfile::create(['name' => $name, 'permissions' => $perms])->id;
        $this->admin = User::factory()->role('admin')->create(['name' => 'Alex Admin']);
        $this->dispatcher = User::factory()->create(['name' => 'Dana Dispatch', 'permission_profile_id' => $profile('Trips test dispatcher', ['trips_dispatch'])]);
        $this->viewer = User::factory()->create(['name' => 'Val Viewer', 'permission_profile_id' => $profile('Trips test viewer', ['trips_view'])]);
        $this->crew = User::factory()->create(['name' => 'Cam Crew', 'permission_profile_id' => $profile('Trips test crew', ['trips_crew'])]);

        $this->bls = Vehicle::create(['kind' => 'company', 'plate' => 'T3', 'name' => 'BLS 3', 'gps_device_id' => 'DEV-3']);
        $this->als = Vehicle::create(['kind' => 'company', 'plate' => 'T12', 'name' => 'Medic 12', 'gps_device_id' => 'DEV-12']);
        $this->shift($this->bls, 'bls', $this->crew);
        $this->shift($this->als, 'als');
        $this->home = Facility::create(['name' => 'Oak Hollow SNF', 'kind' => 'snf', 'phone' => '555-0100', 'lat' => 37.54, 'lon' => -77.43, 'active' => true]);
        $this->dialysis = Facility::create(['name' => 'Riverside Dialysis', 'kind' => 'dialysis', 'lat' => 37.56, 'lon' => -77.45, 'active' => true]);
    }

    private function shift(Vehicle $v, string $level, ?User $member = null): Assignment
    {
        $a = Assignment::create([
            'service_date' => '2026-11-16', 'shift_key' => 'day', 'shift_name' => 'Day', 'vehicle_id' => $v->id, 'vehicle_name' => $v->name,
            'starts_at' => now()->setTime(7, 0), 'ends_at' => now()->setTime(19, 0), 'status' => 'in_service', 'level' => $level,
            'created_by' => $this->admin->id, 'updated_by' => $this->admin->id,
        ]);
        $a->members()->create(['user_id' => $member?->id, 'user_name' => $member?->name ?? 'Pat Partner', 'role' => 'EMT', 'position' => 0]);

        return $a;
    }

    private function booking(array $over = []): array
    {
        return $over + [
            'patient_first' => 'Ada', 'patient_last' => 'Sample', 'patient_dob' => '1948-03-14', 'weight_lbs' => 160,
            'payer' => 'Sample Medicare', 'member_id' => 'SMP0001', 'pcs_on_file' => true,
            'level' => 'bls', 'trip_type' => 'dialysis', 'equipment' => ['oxygen'],
            'chief_complaint' => 'ESRD, scheduled dialysis', 'stretcher_reason' => 'Bed-confined',
            'pickup_mode' => 'scheduled', 'pickup_time' => '2026-11-16 10:00', 'duration_min' => 60,
            'pickup_facility_id' => $this->home->id, 'pickup_location' => $this->home->name,
            'destination_facility_id' => $this->dialysis->id, 'destination' => $this->dialysis->name,
        ];
    }

    private function book(array $over = []): Trip
    {
        $id = $this->actingAs($this->dispatcher)->postJson('/trips/book', $this->booking($over))->assertCreated()->json('trips.0.id');

        return Trip::findOrFail($id);
    }

    public function test_pages_need_the_right_permission(): void
    {
        $this->actingAs($this->dispatcher)->get('/trips')->assertOk()->assertSee('Unassigned');
        $this->actingAs($this->dispatcher)->get('/trips/patients')->assertOk();
        $this->actingAs($this->dispatcher)->get('/trips/facilities')->assertOk();
        $this->actingAs($this->dispatcher)->get('/trips/map')->assertOk();
        $this->actingAs($this->dispatcher)->get('/trips/settings')->assertForbidden();
        $this->actingAs($this->dispatcher)->get('/trips/reports')->assertForbidden();
        $this->actingAs($this->viewer)->get('/trips')->assertOk()->assertDontSee('New trip');
        $this->actingAs($this->viewer)->get('/trips/patients')->assertForbidden();
        $this->actingAs($this->viewer)->postJson('/trips/book', $this->booking())->assertForbidden();
        $this->actingAs($this->crew)->get('/trips')->assertForbidden();
        $this->actingAs($this->crew)->get('/trips/crew')->assertOk();
        foreach (['/trips', '/trips/patients', '/trips/map', '/trips/crew', '/trips/reports', '/trips/settings', '/trips/facilities', '/trips/patients/new'] as $url) {
            $this->actingAs($this->admin)->get($url)->assertOk();
        }
        $this->post('/logout');
        $this->get('/trips')->assertRedirect('/login');
    }

    public function test_patient_details_are_encrypted_at_rest(): void
    {
        $t = $this->book();
        $row = DB::table('trips')->find($t->id);
        foreach (['patient_first', 'patient_last', 'patient_dob', 'member_id', 'chief_complaint', 'pickup_location', 'destination'] as $col) {
            $this->assertStringNotContainsString('Sample', (string) $row->{$col}.'');
            $this->assertStringNotContainsString('1948', (string) $row->{$col});
        }
        $p = DB::table('trip_patients')->first();
        $this->assertStringNotContainsString('Sample', $p->last_name);
        $this->assertStringNotContainsString('SMP0001', $p->member_id);
        $this->assertSame('Sample', Patient::first()->last_name);
        // And none of it ends up in the audit log.
        $this->assertFalse(AuditLog::where('description', 'like', '%Sample%')->exists());
        $this->assertTrue(AuditLog::where('description', 'like', "%{$t->trip_number}%")->exists());
    }

    public function test_booking_a_round_trip_and_a_standing_order(): void
    {
        $r = $this->actingAs($this->dispatcher)->postJson('/trips/book', $this->booking(['round_trip' => true, 'return_mode' => 'will_call']))->assertCreated();
        [$out, $back] = [Trip::find($r->json('trips.0.id')), Trip::find($r->json('trips.1.id'))];
        $this->assertSame(['outbound', 'return'], [$out->leg, $back->leg]);
        $this->assertSame($back->id, $out->linked_trip_id);
        $this->assertSame($out->id, $back->linked_trip_id);
        $this->assertSame('will_call', $back->pickup_mode);
        $this->assertSame($this->home->name, $back->destination);
        $this->assertSame(1, Patient::count(), 'The patient record is made once and reused.');

        // Mon/Wed/Fri for 2 weeks from Monday 11/16: 6 trips, all for the same patient on file.
        $r = $this->actingAs($this->dispatcher)->postJson('/trips/book', $this->booking(['patient_id' => Patient::first()->id, 'repeat_days' => [1, 3, 5], 'repeat_weeks' => 2]))->assertCreated();
        $this->assertCount(6, $r->json('trips'));
        $series = Trip::whereNotNull('series_id')->get();
        $this->assertCount(6, $series);
        $this->assertCount(1, $series->pluck('series_id')->unique());
        $this->assertSame(['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25', '2026-11-27'], $series->map(fn ($t) => $t->pickup_time->toDateString())->sort()->values()->all());
        $this->assertSame(1, Patient::count());
    }

    public function test_assigning_asks_to_confirm_a_level_mismatch_and_checks_the_version(): void
    {
        $t = $this->book(['level' => 'als', 'equipment' => ['cardiac_monitor']]);
        $body = ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 10:00', 'expected_version' => $t->version];
        $r = $this->actingAs($this->dispatcher)->postJson("/trips/{$t->id}/assign", $body)->assertStatus(422)->assertJsonPath('error', 'NEEDS_ACK');
        $this->assertContains('LEVEL', collect($r->json('warnings'))->pluck('code')->all());
        $this->assertSame('queued', $t->fresh()->status);

        $r = $this->actingAs($this->dispatcher)->postJson("/trips/{$t->id}/assign", $body + ['acknowledge' => ['LEVEL']])->assertOk();
        $this->assertSame('assigned', $r->json('trip.status'));
        $this->assertSame($this->bls->id, $t->fresh()->vehicle_id);
        $this->assertStringContainsString('confirmed: LEVEL', $t->fresh()->history()->where('action', 'assigned')->value('detail'));

        // A second dispatcher working from the old version gets a conflict, not a silent overwrite.
        $this->actingAs($this->admin)->postJson("/trips/{$t->id}/assign", ['vehicle_id' => $this->als->id, 'start' => '2026-11-16 10:00', 'expected_version' => $t->version])
            ->assertStatus(409)->assertJsonPath('error', 'VERSION_CONFLICT')->assertJsonPath('trip.vehicleId', $this->bls->id);
        // ALS on the ALS truck inside its shift needs no confirmation.
        $this->actingAs($this->admin)->postJson("/trips/{$t->id}/assign", ['vehicle_id' => $this->als->id, 'start' => '2026-11-16 10:00', 'expected_version' => $t->fresh()->version])->assertOk();
    }

    public function test_overlapping_and_off_shift_assignments_need_confirming(): void
    {
        $a = $this->book();
        $this->actingAs($this->dispatcher)->postJson("/trips/{$a->id}/assign", ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 10:00', 'expected_version' => 1])->assertOk();
        $b = $this->book();
        $r = $this->actingAs($this->dispatcher)->postJson("/trips/{$b->id}/assign", ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 10:30', 'expected_version' => 1])->assertStatus(422);
        $this->assertContains('OVERLAP', collect($r->json('warnings'))->pluck('code')->all());
        $r = $this->actingAs($this->dispatcher)->postJson("/trips/{$b->id}/assign", ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 21:00', 'expected_version' => 1])->assertStatus(422);
        $this->assertContains('OUTSIDE_SHIFT', collect($r->json('warnings'))->pluck('code')->all());
    }

    public function test_the_change_feed_and_what_a_viewer_sees(): void
    {
        $seq = TripEvent::max('id') ?? 0;
        $t = $this->book(['pickup_facility_id' => null, 'pickup_location' => '12 Sample Lane']);
        $r = $this->actingAs($this->viewer)->getJson("/trips/changes?since={$seq}&active=1")->assertOk();
        $this->assertGreaterThan($seq, $r->json('seq'));
        $row = collect($r->json('trips'))->firstWhere('id', $t->id);
        $this->assertSame('A.S.', $row['patientName']);
        $this->assertSame('Residence', $row['pickupLocation']);
        $this->assertNull($row['payer']);
        $this->assertStringNotContainsString('Sample', $r->getContent());
        $this->assertSame('Dana Dispatch', $r->json('by.'.$t->id));

        $d = $this->actingAs($this->dispatcher)->getJson("/trips/changes?since={$seq}")->json('trips.0');
        $this->assertSame('Sample, Ada', $d['patientName']);
        $this->assertSame('12 Sample Lane', $d['pickupLocation']);
        // Nothing new since the last event.
        $this->assertSame([], $this->actingAs($this->dispatcher)->getJson('/trips/changes?since='.$r->json('seq'))->json('trips'));
        // Opening the drawer is a look at patient details: audited, by trip number only.
        $this->actingAs($this->dispatcher)->getJson("/trips/{$t->id}")->assertOk()->assertJsonPath('memberId', 'SMP0001');
        $this->assertTrue(AuditLog::where('action', 'trips.view')->where('description', "Opened trip {$t->trip_number}.")->exists());
    }

    public function test_status_flow_cancel_reasons_reopen_and_loaded_miles(): void
    {
        $t = $this->book();
        $this->actingAs($this->dispatcher)->postJson("/trips/{$t->id}/assign", ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 10:00', 'expected_version' => 1])->assertOk();
        $go = fn (string $s, array $extra = []) => $this->actingAs($this->dispatcher)->postJson("/trips/{$t->id}/status", ['status' => $s, 'expected_version' => $t->fresh()->version] + $extra);
        $go('enroute')->assertOk();
        $go('on_scene')->assertOk();
        $this->travel(1)->minutes();
        $go('transporting')->assertOk();
        // The truck drives about 1.4 miles north while loaded.
        $gps = app(Gps::class);
        foreach ([37.540, 37.550, 37.560] as $i => $lat) {
            $this->travel(2)->minutes();
            $gps->ingest([['deviceId' => 'DEV-3', 'lat' => $lat, 'lon' => -77.43, 'speedMph' => 30, 'heading' => 0]]);
        }
        $go('at_destination')->assertOk();
        $this->assertEqualsWithDelta(1.4, $t->fresh()->loaded_miles, 0.1);
        $go('completed')->assertOk();
        $this->assertSame(['queued', 'assigned', 'enroute', 'on_scene', 'transporting', 'at_destination', 'completed'], array_keys($t->fresh()->status_times));

        // Only a supervisor reopens a closed trip.
        $go('assigned')->assertStatus(422);
        $this->actingAs($this->admin)->postJson("/trips/{$t->id}/status", ['status' => 'assigned', 'expected_version' => $t->fresh()->version])->assertOk();

        $c = $this->book();
        $this->actingAs($this->dispatcher)->postJson("/trips/{$c->id}/status", ['status' => 'cancelled', 'expected_version' => 1])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->actingAs($this->dispatcher)->postJson("/trips/{$c->id}/status", ['status' => 'cancelled', 'expected_version' => 1, 'reason' => 'Patient refused'])->assertOk();
        $this->assertSame('Patient refused', $c->fresh()->cancel_reason);
    }

    public function test_patient_search_is_posted_and_audited_without_names(): void
    {
        $this->book();
        $this->book(['patient_first' => 'Fred', 'patient_last' => 'Fakename', 'patient_dob' => '1937-07-02']);
        $this->actingAs($this->dispatcher)->get('/trips/patients?q=Sample')->assertOk()->assertDontSee('Fakename')->assertDontSee('Sample, Ada');
        $r = $this->actingAs($this->dispatcher)->post('/trips/patients/search', ['q' => 'fake'])->assertOk()->assertSee('Fakename, Fred')->assertDontSee('Sample, Ada');
        $this->actingAs($this->dispatcher)->post('/trips/patients/search', ['q' => '1948-03-14'])->assertOk()->assertSee('Sample, Ada');
        $this->actingAs($this->dispatcher)->postJson('/trips/patients/lookup', ['q' => 'sam'])->assertOk()->assertJsonCount(1)->assertJsonPath('0.name', 'Sample, Ada');
        $this->assertTrue(AuditLog::where('description', 'Searched patients: 1 found.')->exists());
        $this->assertFalse(AuditLog::where('description', 'like', '%fake%')->exists());

        $p = Patient::where('patient_number', 'P-000001')->first();
        $this->actingAs($this->dispatcher)->get("/trips/patients/{$p->id}")->assertOk()->assertSee('Scheduled and open trips (1)')->assertSee('Riverside Dialysis');
        $this->assertTrue(AuditLog::where('action', 'trips.patients.view')->where('description', 'Opened patient P-000001.')->exists());
    }

    public function test_adding_and_editing_patients(): void
    {
        $in = ['first_name' => 'Gail', 'last_name' => 'Specimen', 'dob' => '1963-01-01', 'sex' => 'F', 'default_level' => 'bls', 'pcs_expires' => '2026-11-18', 'active' => 1];
        $this->actingAs($this->dispatcher)->post('/trips/patients', $in)->assertRedirect();
        $p = Patient::firstOrFail();
        $this->assertSame('P-000001', $p->patient_number);
        $this->actingAs($this->dispatcher)->post('/trips/patients', $in)->assertSessionHas('error');
        $this->assertSame(1, Patient::count());

        $this->actingAs($this->dispatcher)->put("/trips/patients/{$p->id}", $in + ['version' => $p->version, 'payer' => 'Example Medicaid'])->assertSessionHas('status');
        $this->assertSame('Example Medicaid', $p->fresh()->payer);
        // Stale form: refused.
        $this->actingAs($this->dispatcher)->put("/trips/patients/{$p->id}", $in + ['version' => $p->version, 'payer' => 'Private pay'])->assertSessionHas('error');
        $this->assertSame('Example Medicaid', $p->fresh()->payer);

        // PCS expiring within a week shows on the patient's trips.
        $t = $this->book(['patient_id' => $p->id, 'patient_first' => 'Gail', 'patient_last' => 'Specimen', 'patient_dob' => '1963-01-01', 'pcs_on_file' => false]);
        $this->assertContains('PCS expiring', app(\App\Trips\Trips::class)->alerts($t->fresh()));
    }

    public function test_gps_webhook_needs_the_key(): void
    {
        $fix = ['deviceId' => 'DEV-12', 'lat' => 37.55, 'lon' => -77.44, 'speedMph' => 22];
        $this->postJson('/api/trips/gps', $fix)->assertUnauthorized();
        $this->actingAs($this->admin)->post('/trips/settings/gps-key')->assertSessionHas('trips_new_key');
        $key = session('trips_new_key');
        $this->postJson('/api/trips/gps', $fix, ['X-GPS-Key' => 'wrong'])->assertUnauthorized();
        $this->postJson('/api/trips/gps', $fix, ['X-GPS-Key' => $key])->assertOk()->assertJsonPath('accepted', 1);
        $this->assertSame($this->als->id, GpsPosition::first()->vehicle_id);
        // Traccar sends knots.
        $this->postJson('/api/trips/gps?format=traccar&key='.$key, ['device' => ['uniqueId' => 'DEV-3'], 'position' => ['latitude' => 37.5, 'longitude' => -77.4, 'speed' => 10, 'fixTime' => now()->toIso8601String()]])->assertOk();
        $this->assertEqualsWithDelta(11.5, GpsPosition::where('device_id', 'DEV-3')->value('speed_mph'), 0.1);
        $this->assertNotSame($key, \App\Models\Setting::get('trips_gps_key'), 'The key is stored encrypted.');
        $latest = $this->actingAs($this->viewer)->getJson('/trips/gps')->assertOk()->json();
        $this->assertCount(2, $latest);
    }

    public function test_crew_see_and_move_only_their_own_trucks_trips(): void
    {
        $mine = $this->book();
        $theirs = $this->book(['level' => 'als']);
        $this->actingAs($this->dispatcher)->postJson("/trips/{$mine->id}/assign", ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 10:00', 'expected_version' => 1])->assertOk();
        $this->actingAs($this->dispatcher)->postJson("/trips/{$theirs->id}/assign", ['vehicle_id' => $this->als->id, 'start' => '2026-11-16 10:00', 'expected_version' => 1])->assertOk();

        $r = $this->actingAs($this->crew)->getJson('/trips/crew/data?opened=1&active=1')->assertOk();
        $this->assertSame([$mine->id], collect($r->json('trips'))->pluck('id')->all());
        $this->assertSame('Sample, Ada', $r->json('trips.0.patientName'));
        $this->assertTrue(AuditLog::where('action', 'trips.crew.view')->where('description', "Opened My Trips: {$mine->trip_number}.")->exists());

        $this->actingAs($this->crew)->postJson("/trips/crew/{$mine->id}/next", ['expected_version' => $mine->fresh()->version])->assertOk()->assertJsonPath('trip.status', 'enroute');
        $this->actingAs($this->crew)->postJson("/trips/crew/{$theirs->id}/next", ['expected_version' => $theirs->fresh()->version])->assertForbidden();
        $this->actingAs($this->crew)->postJson('/trips/crew/location', ['lat' => 37.5, 'lon' => -77.4])->assertOk()->assertJsonPath('vehicle', 'BLS 3');
        $this->assertSame($this->bls->id, GpsPosition::latest('id')->first()->vehicle_id);
    }

    public function test_reports_have_no_patient_details_and_billing_is_supervisor_only_and_audited(): void
    {
        $t = $this->book(['pickup_mode' => 'asap', 'pickup_time' => null]);
        $this->actingAs($this->dispatcher)->postJson("/trips/{$t->id}/assign", ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 09:15', 'expected_version' => 1])->assertOk();
        foreach (['enroute', 'on_scene', 'transporting', 'at_destination', 'completed'] as $s) {
            $this->travel(5)->minutes();
            $this->actingAs($this->dispatcher)->postJson("/trips/{$t->id}/status", ['status' => $s, 'expected_version' => $t->fresh()->version])->assertOk();
        }
        $reports = User::factory()->create(['permission_profile_id' => PermissionProfile::create(['name' => 'Trips test reports', 'permissions' => ['trips_reports']])->id]);
        $this->actingAs($reports)->get('/trips/reports?from=2026-11-16&to=2026-11-16')->assertOk()->assertSee('ASAP booked to on scene')->assertDontSee('Ada');
        $csv = $this->actingAs($reports)->get('/trips/reports.csv?from=2026-11-16&to=2026-11-16')->assertOk()->streamedContent();
        $this->assertStringContainsString('"Total trips",1', $csv);
        $this->assertStringNotContainsString('Ada', $csv);
        $this->actingAs($reports)->get('/trips/reports/billing.csv')->assertForbidden();

        $billing = $this->actingAs($this->admin)->get('/trips/reports/billing.csv?from=2026-11-16&to=2026-11-16')->assertOk()->streamedContent();
        $this->assertStringContainsString('Sample,Ada,1948-03-14', $billing);
        $this->assertTrue(AuditLog::where('description', 'like', 'Billing export (patient information): 1 completed trips%')->exists());
    }

    public function test_csv_cells_that_look_like_formulas_are_neutralised(): void
    {
        $out = \Illuminate\Testing\TestResponse::fromBaseResponse(\App\Trips\Reports::csv([['=HYPERLINK("x")', '+1', 'ok']], 'x.csv'))->streamedContent();
        $this->assertSame("\"'=HYPERLINK(\"\"x\"\")\",'+1,ok\n", $out);
    }

    public function test_run_sheet_prints_patients_and_is_audited(): void
    {
        $t = $this->book();
        $this->actingAs($this->dispatcher)->postJson("/trips/{$t->id}/assign", ['vehicle_id' => $this->bls->id, 'start' => '2026-11-16 10:00', 'expected_version' => 1])->assertOk();
        $this->actingAs($this->dispatcher)->get("/trips/run-sheet/{$this->bls->id}?day=2026-11-16")->assertOk()->assertSee('Sample, Ada')->assertSee('Cam Crew');
        $this->assertTrue(AuditLog::where('action', 'trips.run-sheet')->where('description', 'like', "%{$t->trip_number}%")->exists());
        $this->actingAs($this->viewer)->get("/trips/run-sheet/{$this->bls->id}")->assertForbidden();
    }

    public function test_idle_screens_sign_out(): void
    {
        $this->actingAs($this->dispatcher)->get('/trips')->assertOk();
        $this->travel(5)->minutes();
        $this->getJson('/trips/changes?since=0')->assertOk();
        $this->travel(11)->minutes();
        // A background check that says someone touched the page keeps them signed in...
        $this->getJson('/trips/changes?since=0&active=1')->assertOk();
        $this->travel(16)->minutes();
        // ...but sixteen idle minutes later the next check signs them out.
        $this->getJson('/trips/changes?since=0')->assertUnauthorized()->assertJsonPath('error', 'IDLE');
        $this->assertGuest();
        $this->assertTrue(AuditLog::where('action', 'logout')->where('description', 'like', '%idle minutes on a trip page%')->exists());
    }

    public function test_facilities_and_settings(): void
    {
        $this->actingAs($this->dispatcher)->post('/trips/facilities', ['name' => 'Valley Imaging', 'kind' => 'imaging', 'lat' => 37.5, 'lon' => -77.5])->assertSessionHas('status');
        $this->actingAs($this->dispatcher)->post('/trips/facilities', ['name' => 'Valley Imaging', 'kind' => 'imaging'])->assertSessionHasErrors('name');
        $this->assertTrue(TripEvent::where('type', 'facilities')->exists());

        $this->actingAs($this->admin)->put('/trips/settings', ['trips_idle_minutes' => 10, 'trips_gps_stale_minutes' => 3, 'trips_late_minutes' => 20, 'trips_sim_center' => '37.5, -77.4', 'samsara_token' => 'tok_sample'])->assertSessionHas('status');
        $this->assertSame('10', \App\Models\Setting::get('trips_idle_minutes'));
        $this->assertSame('37.5,-77.4', \App\Models\Setting::get('trips_sim_center'));
        $this->assertSame('tok_sample', app(Gps::class)->samsaraToken());
        $this->assertNotSame('tok_sample', \App\Models\Setting::get('trips_samsara_token'));

        $this->actingAs($this->admin)->put('/trips/settings/trucks', ['trucks' => [$this->bls->id => ['gps_device_id' => 'X'], $this->als->id => ['gps_device_id' => 'X']]])->assertSessionHas('error');
        $this->actingAs($this->admin)->put('/trips/settings/trucks', ['trucks' => [$this->bls->id => ['trip_phone' => '555-0303', 'gps_device_id' => 'NEW-3']]])->assertSessionHas('status', 'Saved 1 truck.');
        $this->assertSame('NEW-3', $this->bls->fresh()->gps_device_id);
    }

    public function test_sample_data_loads(): void
    {
        $this->artisan('trips:sample', ['email' => $this->admin->email])->assertSuccessful();
        $this->assertSame(9, Patient::count());
        $this->assertGreaterThan(20, Trip::count());
        $this->actingAs($this->admin)->get('/trips')->assertOk();
        $this->actingAs($this->admin)->getJson('/trips/crew/data')->assertOk()->assertJsonCount(1, 'trucks');
    }
}
