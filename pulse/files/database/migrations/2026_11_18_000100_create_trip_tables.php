<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dispatch > Trip Board: non-emergency transport trips, patients, facilities and truck GPS.
 * Patient details are PHI: every column marked "encrypted" holds ciphertext (Laravel's encrypted
 * cast with APP_KEY), so a copy of the database alone shows no names, dates of birth or complaints.
 */
return new class extends Migration
{
    private const PERMISSIONS = ['trips_view', 'trips_dispatch', 'trips_supervise', 'trips_reports', 'trips_crew'];

    public function up(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            // The truck's phone, shown on the trip board, and the id its GPS unit reports as.
            $table->string('trip_phone', 30)->nullable()->after('notes');
            $table->string('gps_device_id', 64)->nullable()->unique()->after('trip_phone');
        });

        Schema::create('trip_facilities', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120)->unique();
            // hospital, dialysis, snf, rehab, clinic, imaging, other
            $table->string('kind', 20)->default('other');
            $table->string('address', 200)->nullable();
            $table->string('phone', 30)->nullable();
            $table->decimal('lat', 9, 6)->nullable();
            $table->decimal('lon', 9, 6)->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create('trip_patients', function (Blueprint $table) {
            $table->id();
            // Pulse's own number (P-000123); never an SSN or insurance member id.
            $table->string('patient_number', 20)->unique();
            $table->unsignedInteger('version')->default(1);
            $table->text('first_name'); // encrypted
            $table->text('last_name'); // encrypted
            $table->text('dob'); // encrypted, YYYY-MM-DD
            $table->string('sex', 1)->default('U');
            $table->unsignedSmallInteger('weight_lbs')->nullable();
            $table->text('phone')->nullable(); // encrypted
            $table->text('address')->nullable(); // encrypted
            $table->string('payer', 100)->nullable();
            $table->text('member_id')->nullable(); // encrypted
            $table->date('pcs_expires')->nullable();
            $table->string('prior_auth_number', 60)->nullable();
            $table->date('prior_auth_expires')->nullable();
            $table->unsignedSmallInteger('trips_authorized')->nullable();
            $table->string('default_level', 10)->default('bls');
            $table->json('default_equipment')->nullable();
            $table->text('stretcher_reason')->nullable(); // encrypted
            $table->text('medical_notes')->nullable(); // encrypted
            $table->boolean('active')->default(true);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('trips', function (Blueprint $table) {
            $table->id();
            $table->string('trip_number', 20)->unique();
            // Goes up by one on every change, so two dispatchers can't overwrite each other.
            $table->unsignedInteger('version')->default(1);
            $table->foreignId('patient_id')->nullable()->constrained('trip_patients')->nullOnDelete();
            // Copied from the patient when booked, so later edits to the patient don't rewrite a trip.
            $table->text('patient_first'); // encrypted
            $table->text('patient_last'); // encrypted
            $table->text('patient_dob'); // encrypted
            $table->unsignedSmallInteger('weight_lbs')->nullable();
            $table->string('payer', 100)->nullable();
            $table->text('member_id')->nullable(); // encrypted
            $table->string('prior_auth', 60)->nullable();
            $table->boolean('pcs_on_file')->default(false);
            // A Scope Check level key (bls, aemt, als, sct, rn).
            $table->string('level', 10);
            // dialysis, doctor, interfacility, discharge, snf_to_er, other
            $table->string('trip_type', 20);
            $table->json('equipment')->nullable();
            $table->text('chief_complaint'); // encrypted
            $table->text('stretcher_reason'); // encrypted
            $table->text('notes')->nullable(); // encrypted
            // asap, scheduled or will_call (the facility calls when the patient is ready).
            $table->string('pickup_mode', 10);
            $table->dateTime('pickup_time')->nullable();
            $table->unsignedSmallInteger('duration_min')->default(60);
            // A facility, or an address (a home address is PHI, so both are encrypted).
            $table->foreignId('pickup_facility_id')->nullable()->constrained('trip_facilities')->nullOnDelete();
            $table->text('pickup_location'); // encrypted
            $table->foreignId('destination_facility_id')->nullable()->constrained('trip_facilities')->nullOnDelete();
            $table->text('destination'); // encrypted
            // queued, assigned, enroute, on_scene, transporting, at_destination, completed, cancelled
            $table->string('status', 20)->default('queued');
            $table->foreignId('vehicle_id')->nullable()->constrained()->nullOnDelete();
            // Where the trip sits on the board's timeline.
            $table->dateTime('scheduled_start')->nullable();
            // one_way, outbound or return; a round trip's two legs point at each other.
            $table->string('leg', 10)->default('one_way');
            $table->foreignId('linked_trip_id')->nullable()->constrained('trips')->nullOnDelete();
            // Standing orders (dialysis Mon/Wed/Fri) share a series id.
            $table->string('series_id', 40)->nullable()->index();
            $table->string('cancel_reason', 200)->nullable();
            $table->decimal('loaded_miles', 7, 1)->nullable();
            // status => ISO time it was reached.
            $table->json('status_times')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['status', 'pickup_time']);
            $table->index(['vehicle_id', 'scheduled_start']);
        });

        // What changed and when, for the board's live updates (pages ask for everything after the last id they saw).
        Schema::create('trip_events', function (Blueprint $table) {
            $table->id();
            // trip or facilities
            $table->string('type', 20);
            $table->foreignId('trip_id')->nullable()->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('vehicle_id')->nullable();
            $table->unsignedBigInteger('prev_vehicle_id')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('created_at')->nullable()->index();
        });

        // Each trip's change history, shown on the trip. Never holds patient details.
        Schema::create('trip_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('user_name', 120)->nullable();
            $table->string('action', 40);
            $table->string('detail', 300)->nullable();
            $table->timestamp('created_at')->nullable();
        });

        // GPS fixes from the trucks' GPS units (or a crew phone). No patient data.
        Schema::create('trip_gps_positions', function (Blueprint $table) {
            $table->id();
            $table->string('device_id', 64);
            $table->foreignId('vehicle_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('lat', 9, 6);
            $table->decimal('lon', 9, 6);
            $table->decimal('speed_mph', 5, 1)->default(0);
            $table->unsignedSmallInteger('heading')->default(0);
            // gps (the truck's unit), phone or simulator
            $table->string('source', 10)->default('gps');
            $table->dateTime('recorded_at');
            $table->index(['device_id', 'recorded_at']);
            $table->index(['vehicle_id', 'recorded_at']);
        });

        // Only Admin starts with the new permissions.
        $admin = DB::table('permission_profiles')->where('name', 'Admin')->first();
        if ($admin) {
            $permissions = json_decode($admin->permissions, true) ?: [];
            $permissions = array_values(array_unique([...$permissions, ...self::PERMISSIONS]));
            DB::table('permission_profiles')->where('id', $admin->id)->update(['permissions' => json_encode($permissions)]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_gps_positions');
        Schema::dropIfExists('trip_history');
        Schema::dropIfExists('trip_events');
        Schema::dropIfExists('trips');
        Schema::dropIfExists('trip_patients');
        Schema::dropIfExists('trip_facilities');
        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropUnique(['gps_device_id']);
            $table->dropColumn(['trip_phone', 'gps_device_id']);
        });
        foreach (DB::table('permission_profiles')->get() as $profile) {
            $permissions = array_values(array_diff(json_decode($profile->permissions, true) ?: [], self::PERMISSIONS));
            DB::table('permission_profiles')->where('id', $profile->id)->update(['permissions' => json_encode($permissions)]);
        }
    }
};
