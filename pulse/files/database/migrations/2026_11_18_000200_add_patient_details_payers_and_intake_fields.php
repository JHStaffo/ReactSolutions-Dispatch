<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fuller patient records (demographics, contacts, next of kin, PCP, dispatch notes and baseline)
 * and payors: one shared list of insurance companies, each listed once, and each patient's
 * payors in billing order. Text that identifies a patient is encrypted (marked "encrypted").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trip_payers', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100)->unique();
            // Lowercase letters and digits only, so "Sample Medicare" and "sample  medicare." are the same payor.
            $table->string('name_key', 100)->unique();
            $table->string('kind', 20)->default('commercial');
            $table->string('payer_code', 30)->nullable(); // electronic payer id
            $table->string('phone', 30)->nullable();
            $table->string('notes', 300)->nullable();
            $table->boolean('active')->default(true);
            // "list" when added on the payor list, "typed" when someone typed it on a patient or in intake.
            $table->string('added_from', 10)->default('list');
            $table->timestamps();
        });

        Schema::create('trip_patient_payers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('patient_id')->constrained('trip_patients')->cascadeOnDelete();
            $table->foreignId('payer_id')->constrained('trip_payers')->restrictOnDelete();
            // 1 = primary, 2 = secondary, 3 = tertiary...
            $table->unsignedTinyInteger('position')->default(1);
            $table->text('member_id')->nullable(); // encrypted
            $table->text('group_number')->nullable(); // encrypted
            $table->text('subscriber_name')->nullable(); // encrypted; when the patient isn't the policy holder
            $table->string('subscriber_relationship', 10)->default('self');
            $table->date('effective_from')->nullable();
            $table->date('effective_to')->nullable();
            $table->date('eligibility_checked_on')->nullable();
            $table->timestamps();
            $table->unique(['patient_id', 'payer_id']);
        });

        Schema::table('trip_patients', function (Blueprint $table) {
            $table->text('middle_name')->nullable(); // encrypted
            $table->string('suffix', 10)->nullable();
            $table->string('marital_status', 10)->nullable();
            $table->string('race', 40)->nullable();
            $table->string('language', 40)->nullable();
            $table->unsignedSmallInteger('height_in')->nullable();
            $table->text('mrn')->nullable(); // encrypted, a facility's medical record number
            $table->text('address2')->nullable(); // encrypted
            $table->text('city')->nullable(); // encrypted
            $table->string('state', 2)->nullable();
            $table->text('zip')->nullable(); // encrypted
            $table->string('county', 60)->nullable();
            $table->text('email')->nullable(); // encrypted
            $table->text('employer')->nullable(); // encrypted
            $table->foreignId('facility_id')->nullable()->constrained('trip_facilities')->nullOnDelete(); // where they live (a nursing home)
            $table->string('pcp_name', 100)->nullable();
            $table->string('pcp_npi', 10)->nullable();
            $table->string('pcp_phone', 30)->nullable();
            $table->text('nok_name')->nullable(); // encrypted
            $table->string('nok_relationship', 40)->nullable();
            $table->text('nok_phone')->nullable(); // encrypted
            $table->text('dispatch_notes')->nullable(); // encrypted; shown at intake and to the crew
            $table->text('baseline')->nullable(); // encrypted; medications, allergies, baseline mental status
            $table->unsignedSmallInteger('pickup_extra_min')->nullable(); // extra minutes loading at pickup
            $table->unsignedSmallInteger('dropoff_extra_min')->nullable();
            $table->string('external_code', 60)->nullable();
            $table->date('deceased_on')->nullable();
            $table->boolean('reminders_opt_out')->default(false);
        });

        Schema::table('trips', function (Blueprint $table) {
            $table->string('secondary_payer', 100)->nullable();
            $table->text('secondary_member_id')->nullable(); // encrypted
            // Who asked for the trip.
            $table->foreignId('ordering_facility_id')->nullable()->constrained('trip_facilities')->nullOnDelete();
            $table->string('caller_name', 100)->nullable();
            $table->string('caller_title', 60)->nullable();
            $table->string('caller_phone', 30)->nullable();
            // Room, department and phone at each end (a home phone is PHI, so they're encrypted).
            $table->text('pickup_room')->nullable(); // encrypted
            $table->string('pickup_department', 60)->nullable();
            $table->text('pickup_phone')->nullable(); // encrypted
            $table->text('dropoff_room')->nullable(); // encrypted
            $table->string('dropoff_department', 60)->nullable();
            $table->text('dropoff_phone')->nullable(); // encrypted
            $table->string('priority', 10)->default('routine'); // routine, urgent, stat
            // ASAP trips: the latest time promised to the caller ("by 9 PM"). Not a pickup time, so the
            // trip can go earlier; scheduled trips use pickup_time, which is exact.
            $table->dateTime('quoted_time')->nullable();
            $table->decimal('oxygen_lpm', 4, 1)->nullable();
            $table->unsignedTinyInteger('stairs')->nullable(); // flights of stairs
            $table->unsignedTinyInteger('riders')->nullable(); // family or companions riding along
            $table->boolean('dnr')->default(false);
            $table->text('diagnoses')->nullable(); // encrypted JSON: ICD-10 codes, the first is primary
            $table->json('physicians')->nullable(); // referring and receiving doctors (name, phone, fax, NPI)
            $table->boolean('pcs_requested')->default(false);
            $table->boolean('pcs_signed')->default(false);
            $table->boolean('wait_and_return')->default(false); // the crew waits at the destination for the return leg
            $table->decimal('est_miles', 6, 1)->nullable();
            // From the crew's MDT.
            $table->decimal('odometer_pickup', 9, 1)->nullable();
            $table->decimal('odometer_destination', 9, 1)->nullable();
            $table->text('crew_notes')->nullable(); // encrypted; notes from the crew to dispatch
            // When the ePCR last pulled this trip.
            $table->timestamp('epcr_pulled_at')->nullable();
        });

        // The truck's own status on the MDT (available, out of service, at the station...).
        Schema::table('vehicles', function (Blueprint $table) {
            $table->string('trip_unit_status', 20)->nullable();
            $table->timestamp('trip_unit_status_at')->nullable();
        });

        // Move each patient's single payer into the payor list.
        $now = now();
        foreach (DB::table('trip_patients')->whereNotNull('payer')->where('payer', '!=', '')->get(['id', 'payer', 'member_id']) as $p) {
            $name = trim(preg_replace('/\s+/', ' ', $p->payer));
            $key = mb_substr(preg_replace('/[^a-z0-9]/', '', mb_strtolower($name)), 0, 100);
            if ($key === '') {
                continue;
            }
            $payerId = DB::table('trip_payers')->where('name_key', $key)->value('id')
                ?? DB::table('trip_payers')->insertGetId(['name' => $name, 'name_key' => $key, 'kind' => 'commercial', 'added_from' => 'typed', 'created_at' => $now, 'updated_at' => $now]);
            DB::table('trip_patient_payers')->insertOrIgnore(['patient_id' => $p->id, 'payer_id' => $payerId, 'position' => 1, 'member_id' => $p->member_id, 'subscriber_relationship' => 'self', 'created_at' => $now, 'updated_at' => $now]);
        }
        Schema::table('trip_patients', function (Blueprint $table) {
            $table->dropColumn(['payer', 'member_id']);
        });

        foreach ([['Medicare', 'medicare'], ['Medicaid', 'medicaid'], ['Self pay', 'self_pay'], ['Facility contract', 'facility'], ['Workers\' compensation', 'workers_comp'], ['VA Community Care', 'va']] as [$name, $kind]) {
            $key = preg_replace('/[^a-z0-9]/', '', mb_strtolower($name));
            if (! DB::table('trip_payers')->where('name_key', $key)->exists()) {
                DB::table('trip_payers')->insert(['name' => $name, 'name_key' => $key, 'kind' => $kind, 'created_at' => $now, 'updated_at' => $now]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('trip_patients', function (Blueprint $table) {
            $table->string('payer', 100)->nullable();
            $table->text('member_id')->nullable();
        });
        foreach (DB::table('trip_patient_payers')->where('position', 1)->join('trip_payers', 'trip_payers.id', '=', 'trip_patient_payers.payer_id')->get(['patient_id', 'name', 'member_id']) as $r) {
            DB::table('trip_patients')->where('id', $r->patient_id)->update(['payer' => $r->name, 'member_id' => $r->member_id]);
        }
        Schema::table('trips', function (Blueprint $table) {
            $table->dropConstrainedForeignId('ordering_facility_id');
            $table->dropColumn(['quoted_time', 'odometer_pickup', 'odometer_destination', 'crew_notes', 'epcr_pulled_at']);
            $table->dropColumn(['secondary_payer', 'secondary_member_id', 'caller_name', 'caller_title', 'caller_phone', 'pickup_room', 'pickup_department', 'pickup_phone', 'dropoff_room', 'dropoff_department', 'dropoff_phone', 'priority', 'oxygen_lpm', 'stairs', 'riders', 'dnr', 'diagnoses', 'physicians', 'pcs_requested', 'pcs_signed', 'wait_and_return', 'est_miles']);
        });
        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropColumn(['trip_unit_status', 'trip_unit_status_at']);
        });
        Schema::table('trip_patients', function (Blueprint $table) {
            $table->dropConstrainedForeignId('facility_id');
            $table->dropColumn(['middle_name', 'suffix', 'marital_status', 'race', 'language', 'height_in', 'mrn', 'address2', 'city', 'state', 'zip', 'county', 'email', 'employer', 'pcp_name', 'pcp_npi', 'pcp_phone', 'nok_name', 'nok_relationship', 'nok_phone', 'dispatch_notes', 'baseline', 'pickup_extra_min', 'dropoff_extra_min', 'external_code', 'deceased_on', 'reminders_opt_out']);
        });
        Schema::dropIfExists('trip_patient_payers');
        Schema::dropIfExists('trip_payers');
    }
};
