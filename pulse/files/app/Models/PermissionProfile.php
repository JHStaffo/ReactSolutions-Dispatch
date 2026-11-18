<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What a group of people can do. Everyone can draw prizes they've earned;
 * the permissions below add pages and actions on top of that. A sub-profile
 * (EMT under Team Member, say) has everything its parent allows plus its own.
 * Sub-profiles go one level deep.
 */
class PermissionProfile extends Model
{
    protected $guarded = [];

    /**
     * Grouped the way the menus are. A new feature adds its key here; every
     * profile starts without it, and a migration can grant it where needed.
     */
    public const GROUPS = [
        'Draw Box' => [
            'dashboard' => 'Dashboard (hand out prizes, check lockers, remove unused draws)',
            'reports' => 'Reports',
            'inventory' => 'Inventory',
            'lockers' => 'Locker map',
            'edit_won' => 'Change or remove won prizes',
        ],
        'Dispatch' => [
            'credit_calls' => 'Credit a call',
            'scope_check' => 'Scope Check',
            'forms' => 'Forms (fill out and send)',
            'form_reports' => 'Form reports (every submission, totals and CSV)',
            'trips_view' => 'See the trip board (read-only, patient initials only)',
            'trips_dispatch' => 'Dispatch trips (book trips, assign them to trucks, change status, patients and facilities; sees patient details)',
            'trips_crew' => 'My Trips (the crew phone screen: their truck\'s trips, status buttons and sharing phone location)',
            'trips_reports' => 'Trip reports (counts, on-time, response and unit utilization, no patient details, CSV)',
            'trips_supervise' => 'Trip supervisor (reopen closed trips, the payor list, and Trip Settings: GPS, the ePCR feed and timing)',
        ],
        'Protocols' => [
            'protocols' => 'Protocol book (read approved protocols)',
            'protocols_build' => 'Build protocols (write drafts and send them for approval)',
            'protocols_approve' => 'Medical Director (approve, send back or retire protocols)',
        ],
        'Training' => [
            'training' => 'Training (take the courses assigned to them)',
            'training_build' => 'Build courses (lessons, files, course designer and quizzes)',
            'training_assign' => 'Assign training (assign and reassign courses, training profiles, allow more quiz attempts)',
            'training_reports' => 'Training reports (progress, time spent, grades and CSV)',
            'training_grade' => 'Grade written quiz answers and review work handed in for assignments',
            'training_signoff' => 'Sign off skills (check Team Members off on skills checklists, like a truck checkout, and on lessons that need a trainer\'s sign-off)',
            'training_ai_tools' => 'AI content development tools (the AI course writer, AI writing help in lessons, AI quiz questions and pictures)',
            'training_ai_courses' => 'Create AI-based training (turn on AI help for the Team Members taking a course, like the AI coach and practice questions)',
            'training_scorm' => 'Upload SCORM packages (simulations and courses made in other tools; they run their own code inside Pulse)',
        ],
        'Wellness' => [
            'wellness' => 'Wellness (join, log, see their own progress and the leaderboard)',
            'wellness_review' => 'Wellness review (exceptions now; attendance notes and appeals later)',
            'wellness_admin' => 'Wellness admin (Team Members in the program and point rules)',
            'wellness_settings' => 'Wellness settings (turn the module on or off, dates and grace period)',
        ],
        'Supplies' => [
            'supplies' => 'Supplies (search, see stock at every place, and record supplies used)',
            'supplies_stock' => 'Restock and count supplies (receive, move between places, restock trucks, counts, expired and damaged, history CSV)',
            'supplies_manage' => 'Manage supplies (the catalog, places, layouts, minimums and maximums, alerts, imports and audit schedules)',
            'supplies_approve_counts' => 'Approve supply count differences (turns what a count found into stock changes, with a reason)',
            'supplies_order' => 'Order supplies (vendors, build orders from the Low list, send them, close them, and the spending report)',
            'supplies_approve_orders' => 'Approve supply orders and requests (over the amounts in Supplies settings, or in a category that always needs approval)',
            'supplies_request' => 'Ask for supplies (request supplies for a truck or station and follow the request)',
            'supplies_drug_boxes' => 'Drug boxes (add, restock and seal from the pharmacy, assign to trucks, and swap opened boxes)',
            'controlled' => 'Controlled substances (record giving, wasting, moves, handoffs and counts they are part of, and witness with their PIN)',
            'controlled_admin' => 'Controlled substance admin (receiving, sending back and destroying, corrections, discrepancy write-ups, settings and reports)',
        ],
        'Assets' => [
            'assets' => 'Assets (see equipment and vehicle asset records, where each one is, their files and history, and audits)',
            'assets_checkout' => 'Check out, check in and audit assets (hand equipment to a Team Member or truck by scanning its tag, take it back, and audit a truck or station)',
            'assets_manage' => 'Manage assets (add and change assets, status, repairs, loans, retirement, costs, files, imports, asset settings and asset reports)',
        ],
        'Reports and AI' => [
            'custom_reports' => 'Custom reports (build, save and export reports from anything else their permissions let them see)',
            'ai_assistant' => 'AI assistant (ask questions about what their permissions let them see, have the AI draft work orders, and set up the weekly summary; uses the Anthropic key and counts toward their monthly AI allowance)',
        ],
        'RFID' => [
            'rfid' => 'RFID (only while "We have RFID" is on: put tags on assets, pieces, vials and places, look a tag up, and sweep a place with a reader)',
        ],
        'Maintenance' => [
            'maintenance' => 'Maintenance (see work orders, maintenance plans, what\'s due and buildings; make work orders and work the ones assigned to them or to nobody: notes, files, parts from stock, mileage and hours, done)',
            'maintenance_manage' => 'Manage maintenance (every work order, maintenance plans, the building registry, maintenance reports and settings)',
        ],
        'Vehicles' => [
            'vehicles' => 'Vehicles (see which company vehicles and Team Member cars are on property, and every license plate read)',
            'vehicles_manage' => 'Manage vehicles (add company vehicles and Team Member cars, camera directions, and the Turing connection)',
            'arrivals' => 'Arrival times (when each Team Member\'s car arrived and left, company vehicle trips, and CSV)',
            'assignments_view' => 'See vehicle assignments (which truck runs each shift, with which crew, and the Trucks page)',
            'assignments_edit' => 'Assign vehicles (set each shift\'s trucks and crews, mark backup trucks, and let out-of-service trucks run anyway)',
            'rotation_manage' => 'Rotation protocols (build the rules Pulse suggests vehicle assignments from)',
            'assignment_reports' => 'Vehicle assignment reports (shifts, hours and miles by truck and Team Member, and CSV)',
            'status_boards' => 'Status boards (make TV boards with a private link that shows assignments and other panels without signing in)',
        ],
        'Service Desk' => [
            'service_desk' => 'Service Desk (submit tickets and follow their own)',
            'service_desk_work' => 'Work tickets (the work queue and dashboard for the departments they handle in Service Desk settings)',
            'service_desk_manage' => 'Manage all tickets (see, assign and delete every ticket in every department, and get every escalation)',
            'service_desk_reports' => 'Service Desk reports (ticket volume, response and resolve times, and CSV)',
            'service_desk_settings' => 'Service Desk settings (departments and their handlers, categories, escalation times)',
        ],
        'Inspections' => [
            'inspections' => 'Inspections (do truck, equipment and station checks, report problems, see their own checks)',
            'inspections_deficiencies' => 'Deficiencies (see every check and deficiency, assign and fix them, take trucks and equipment out of service and back)',
            'inspections_manage' => 'Manage inspections (check sheets, schedules and who does them, what gets checked, shifts, who gets notices)',
            'inspection_reports' => 'Inspection reports (checks done on time, late or missed, by Team Member, deficiencies, CSV) and the inspection dashboard',
        ],
        'Admin' => [
            'team_members' => 'Team Members',
            'ssn_view' => 'See SSNs and dates of birth (last 4 on Team Members, and the full number and birth date one at a time; each look is in the audit log)',
            'ssn_edit' => 'Add, change or remove SSNs and dates of birth (also lets CSV imports fill them in)',
            'oig_exclusions' => 'OIG Exclusions (check Team Members against the OIG exclusion list and record manual checks)',
            'ems_affiliations' => 'EMS Affiliations (search the Virginia Office of EMS provider search for every Team Member, review their other agencies, and keep the unacceptable agencies list)',
            'settings' => 'Settings',
            'audit_log' => 'Audit log',
            'profiles' => 'Permission Profiles',
            'manage_forms' => 'Forms and Slack (build forms, see every submission, connect Slack)',
            'remotelock' => 'RemoteLock (connect it, match Team Members, door groups for new Team Members)',
            'id_cards' => 'ID Cards (make, change, print and download Team Member ID cards, and edit the job roles and colors on them)',
        ],
    ];

    protected function casts(): array
    {
        return ['permissions' => 'array', 'is_default' => 'boolean', 'hide_winners' => 'boolean', 'remotelock_door_groups' => 'array', 'ai_monthly_tokens' => 'integer'];
    }

    /** @return array<string, string> key => label */
    public static function permissionLabels(): array
    {
        return array_merge(...array_values(self::GROUPS));
    }

    public function allows(string $permission): bool
    {
        return in_array($permission, $this->effectivePermissions(), true);
    }

    /** Its own permissions plus its parent's. */
    public function effectivePermissions(): array
    {
        return array_values(array_unique(array_merge($this->inheritedPermissions(), $this->permissions ?? [])));
    }

    /** What it gets from its parent, if it's a sub-profile. */
    public function inheritedPermissions(): array
    {
        return $this->parent?->permissions ?? [];
    }

    /** "Team Member › EMT" for a sub-profile, "Team Member" otherwise. */
    public function label(): string
    {
        return $this->parent ? "{$this->parent->name} › {$this->name}" : $this->name;
    }

    /** Main profiles in the order they were added, each followed by its sub-profiles A to Z. */
    public static function ordered()
    {
        $all = static::with('parent')->orderBy('id')->get();

        return $all->whereNull('parent_id')
            ->flatMap(fn (self $top) => collect([$top])->concat($all->where('parent_id', $top->id)->sortBy('name')))
            ->values();
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    /** The profile new and imported team members get. */
    public static function default(): ?self
    {
        return static::where('is_default', true)->first() ?? static::orderBy('id')->first();
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }
}
