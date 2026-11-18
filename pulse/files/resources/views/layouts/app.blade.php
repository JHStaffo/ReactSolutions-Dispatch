<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ isset($title) ? $title.' · ' : '' }}Fast Track Pulse · Fast Track EMS</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Oswald:wght@400;500&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="{{ asset('css/app.css') }}?v={{ @filemtime(public_path('css/app.css')) }}">
    <link rel="icon" href="{{ asset('images/logo.png') }}">
</head>
<body>
@auth
    @php($u = auth()->user())
    {{-- Pages reached from the Admin submenus, so Admin (and not their module's menu) lights up. --}}
    @php($reportRoutes = ['supervisor.reports*', 'forms.reports*', 'training.reports*', 'training.progress', 'training.person', 'training.ai-usage*', 'vehicles.arrivals*', 'service-desk.reports*', 'supplies.history*', 'supplies.spending*', 'supplies.value', 'controlled.reports', 'assets.reports', 'maintenance.reports', 'fleet.reports*', 'inspections.reports*', 'reports.custom*', 'assistant', 'admin.audit'])
    @php($settingsRoutes = ['admin.profiles*', 'supervisor.settings', 'admin.forms*', 'admin.lists*', 'admin.slack*', 'admin.remotelock*', 'service-desk.settings*', 'boards.*', 'inspections.settings', 'assets.settings*', 'maintenance.settings', 'assistant.settings'])
    <header class="topbar">
        <div class="topbar-inner">
            <a href="{{ route('home') }}"><img src="{{ asset('images/logo.png') }}" alt="Fast Track EMS"></a>
            <span class="app-name">Fast Track Pulse</span>
            <nav class="nav">
                <a href="{{ route('home') }}" @class(['active' => request()->routeIs('home')])>Home</a>
                <details class="nav-menu">
                    <summary @class(['active' => request()->routeIs('drawbox.home', 'draws.*', 'supervisor.dashboard', 'supervisor.dispense', 'supervisor.inventory*', 'admin.lockers', 'admin.locks*', 'admin.draws.*')])>Draw Box</summary>
                    <div class="nav-drop">
                        <a href="{{ route('drawbox.home') }}" @class(['active' => request()->routeIs('drawbox.home', 'draws.*')])>Draw Box Home</a>
                        @if ($u->hasPermission('dashboard'))<a href="{{ route('supervisor.dashboard') }}" @class(['active' => request()->routeIs('supervisor.dashboard', 'supervisor.dispense')])>Dashboard</a>@endif
                        @if ($u->hasPermission('inventory'))<a href="{{ route('supervisor.inventory') }}" @class(['active' => request()->routeIs('supervisor.inventory*')])>Inventory</a>@endif
                        @if ($u->hasPermission('lockers'))<a href="{{ route('admin.lockers') }}" @class(['active' => request()->routeIs('admin.lockers')])>Lockers</a><a href="{{ route('admin.locks') }}" @class(['active' => request()->routeIs('admin.locks*')])>Locks</a>@endif
                    </div>
                </details>
                @if ($u->hasAnyPermission('credit_calls', 'scope_check', 'forms', 'assignments_view', 'trips_view', 'trips_dispatch', 'trips_crew', 'trips_reports', 'trips_supervise'))
                    <details class="nav-menu">
                        <summary @class(['active' => request()->routeIs('dispatch.*', 'scope', 'forms', 'forms.show', 'fleet', 'fleet.trucks', 'fleet.protocols*', 'trips*')])>Dispatch</summary>
                        <div class="nav-drop">
                            @if ($u->hasAnyPermission('trips_view', 'trips_dispatch', 'trips_supervise'))<a href="{{ route('trips') }}" @class(['active' => request()->routeIs('trips')])>Trip Board</a><a href="{{ route('trips.map') }}" @class(['active' => request()->routeIs('trips.map')])>Trip Map</a>@endif
                            @if ($u->hasPermission('trips_dispatch'))<a href="{{ route('trips.patients') }}" @class(['active' => request()->routeIs('trips.patients*')])>Patients</a><a href="{{ route('trips.facilities') }}" @class(['active' => request()->routeIs('trips.facilities*')])>Facilities</a>@endif
                            @if ($u->hasPermission('trips_crew'))<a href="{{ route('trips.crew') }}" @class(['active' => request()->routeIs('trips.crew*')])>My Trips</a>@endif
                            @if ($u->hasAnyPermission('trips_reports', 'trips_supervise'))<a href="{{ route('trips.reports') }}" @class(['active' => request()->routeIs('trips.reports*')])>Trip Reports</a>@endif
                            @if ($u->hasPermission('trips_supervise'))<a href="{{ route('trips.payers') }}" @class(['active' => request()->routeIs('trips.payers*')])>Payors</a><a href="{{ route('trips.settings') }}" @class(['active' => request()->routeIs('trips.settings*')])>Trip Settings</a>@endif
                            @if ($u->hasPermission('credit_calls'))<a href="{{ route('dispatch.create') }}" @class(['active' => request()->routeIs('dispatch.*')])>Credit a call</a>@endif
                            @if ($u->hasPermission('scope_check'))<a href="{{ route('scope') }}" @class(['active' => request()->routeIs('scope')])>Scope Check</a>@endif
                            @if ($u->hasPermission('forms'))<a href="{{ route('forms') }}" @class(['active' => request()->routeIs('forms', 'forms.show')])>Forms</a>@endif
                            @if ($u->hasPermission('assignments_view'))<a href="{{ route('fleet') }}" @class(['active' => request()->routeIs('fleet', 'fleet.trucks', 'fleet.protocols*')])>Vehicle Assignments</a>@endif
                        </div>
                    </details>
                @endif
                @if ($u->hasAnyPermission('supplies', 'supplies_stock', 'supplies_manage', 'supplies_order', 'supplies_approve_orders', 'supplies_request', 'supplies_drug_boxes', 'controlled', 'controlled_admin') || ($u->hasPermission('rfid') && \App\Rfid\Rfid::enabled()))
                    @php($suppliesLow = $u->hasAnyPermission('supplies_stock', 'supplies_manage') ? app(\App\Supplies\Alerts::class)->count() : 0)
                    @php($suppliesCounts = $u->hasPermission('supplies_stock') ? \App\Supplies\Models\Audit::where('status', 'open')->whereDate('due_on', '<=', today())->count() + ($u->hasPermission('supplies_approve_counts') ? \App\Supplies\Models\Audit::where('status', 'submitted')->count() : 0) : 0)
                    @php($suppliesOrders = $u->hasPermission('supplies_approve_orders') ? \App\Supplies\Models\Order::where('status', 'approval')->count() : 0)
                    @php($suppliesBoxes = $u->hasPermission('supplies_drug_boxes') ? \App\Supplies\Models\DrugBox::where('status', 'open')->count() : 0)
                    @php($suppliesCs = $u->hasPermission('controlled_admin') ? \App\Supplies\Models\ControlledCount::where('status', 'discrepancy')->count() : 0)
                    @php($suppliesRequests = ($u->hasPermission('supplies_stock') ? \App\Supplies\Models\Request::whereIn('status', ['open', 'picked'])->count() : 0) + ($u->hasPermission('supplies_approve_orders') ? \App\Supplies\Models\Request::where('status', 'approval')->count() : 0))
                    <details class="nav-menu">
                        <summary @class(['active' => (request()->routeIs('supplies*') || (request()->routeIs('controlled*') && ! request()->routeIs('controlled.reports')) || request()->routeIs('rfid*')) && ! request()->routeIs('supplies.history*', 'supplies.spending*', 'supplies.value')])>Supplies @if ($suppliesLow + $suppliesCounts + $suppliesOrders + $suppliesRequests + $suppliesBoxes + $suppliesCs)<span class="nav-count">{{ $suppliesLow + $suppliesCounts + $suppliesOrders + $suppliesRequests + $suppliesBoxes + $suppliesCs }}</span>@endif</summary>
                        <div class="nav-drop">
                            @if (\App\Operations\Operations::canSee($u))<a href="{{ route('operations') }}" @class(['active' => request()->routeIs('operations')])>Operations Dashboard</a>@endif
                            @if ($u->hasPermission('supplies'))
                                <a href="{{ route('supplies') }}" @class(['active' => request()->routeIs('supplies')])>Search</a>
                                <a href="{{ route('supplies.items') }}" @class(['active' => request()->routeIs('supplies.items*')])>Catalog</a>
                                <a href="{{ route('supplies.places') }}" @class(['active' => request()->routeIs('supplies.places*', 'supplies.restock*', 'supplies.count*')])>Places</a>
                                <a href="{{ route('supplies.bags') }}" @class(['active' => request()->routeIs('supplies.bags*')])>Sealed Bags</a>
                            @endif
                            @if ($u->hasAnyPermission('supplies', 'supplies_drug_boxes', 'supplies_manage'))
                                <a href="{{ route('supplies.boxes') }}" @class(['active' => request()->routeIs('supplies.boxes*', 'supplies.box-types*')])>Drug Boxes @if ($suppliesBoxes)<span class="nav-count">{{ $suppliesBoxes }}</span>@endif</a>
                            @endif
                            @if ($u->hasAnyPermission('controlled', 'controlled_admin'))
                                <a href="{{ route('controlled') }}" @class(['active' => request()->routeIs('controlled*') && ! request()->routeIs('controlled.reports')])>Controlled Substances @if ($suppliesCs)<span class="nav-count">{{ $suppliesCs }}</span>@endif</a>
                            @endif
                            @if ($u->hasPermission('supplies'))
                                <a href="{{ route('supplies.low') }}" @class(['active' => request()->routeIs('supplies.low')])>Low and Expiring @if ($suppliesLow)<span class="nav-count">{{ $suppliesLow }}</span>@endif</a>
                            @endif
                            @if ($u->hasPermission('supplies_stock'))<a href="{{ route('supplies.audits') }}" @class(['active' => request()->routeIs('supplies.audits*')])>Counts @if ($suppliesCounts)<span class="nav-count">{{ $suppliesCounts }}</span>@endif</a>@endif
                            @if ($u->hasAnyPermission('supplies_request', 'supplies_stock', 'supplies_approve_orders'))<a href="{{ route('supplies.requests') }}" @class(['active' => request()->routeIs('supplies.requests*')])>Requests @if ($suppliesRequests)<span class="nav-count">{{ $suppliesRequests }}</span>@endif</a>@endif
                            @if ($u->hasAnyPermission('supplies_order', 'supplies_approve_orders', 'supplies_stock'))<a href="{{ route('supplies.orders') }}" @class(['active' => request()->routeIs('supplies.orders*', 'supplies.vendors*')])>Orders @if ($suppliesOrders)<span class="nav-count">{{ $suppliesOrders }}</span>@endif</a>@endif
                            @if ($u->hasPermission('rfid') && \App\Rfid\Rfid::enabled())<a href="{{ route('rfid') }}" @class(['active' => request()->routeIs('rfid*')])>RFID</a>@endif
                            @if ($u->hasPermission('supplies_manage'))<a href="{{ route('supplies.settings') }}" @class(['active' => request()->routeIs('supplies.settings')])>Supplies Settings</a>@endif
                        </div>
                    </details>
                @endif
                @if ($u->hasAnyPermission('protocols', 'protocols_build', 'protocols_approve'))
                    @php($waitingProtocols = $u->hasPermission('protocols_approve') ? \App\Models\ProtocolVersion::where('status', 'submitted')->count() : 0)
                    <details class="nav-menu">
                        <summary @class(['active' => request()->routeIs('protocols.*')])>Protocols @if ($waitingProtocols)<span class="nav-count">{{ $waitingProtocols }}</span>@endif</summary>
                        <div class="nav-drop">
                            @if ($u->hasPermission('protocols'))<a href="{{ route('protocols.index') }}" @class(['active' => request()->routeIs('protocols.index', 'protocols.book', 'protocols.show')])>Protocol Book</a>@endif
                            @if ($u->hasPermission('protocols_build'))<a href="{{ route('protocols.manage') }}" @class(['active' => request()->routeIs('protocols.manage*')])>Build protocols</a>@endif
                            @if ($u->hasPermission('protocols_approve'))<a href="{{ route('protocols.approvals') }}" @class(['active' => request()->routeIs('protocols.approvals*')])>Approvals @if ($waitingProtocols)<span class="nav-count">{{ $waitingProtocols }}</span>@endif</a>@endif
                        </div>
                    </details>
                @endif
                @if ($u->hasAnyPermission('training', 'training_build', 'training_assign', 'training_grade', 'training_signoff'))
                    @php($trainingDue = $u->hasPermission('training') ? \App\Training\Models\Assignment::shown()->where('user_id', $u->id)->whereNull('replaced_at')->whereNull('completed_at')->count() + \App\Training\Models\Assignment::shown()->where('user_id', $u->id)->awaitingReacknowledgment()->count() : 0)
                    <details class="nav-menu">
                        <summary @class(['active' => request()->routeIs('training*') && ! request()->routeIs($reportRoutes)])>Training @if ($trainingDue)<span class="nav-count">{{ $trainingDue }}</span>@endif</summary>
                        <div class="nav-drop">
                            @if ($u->hasPermission('training'))<a href="{{ route('training') }}" @class(['active' => request()->routeIs('training', 'training.lesson', 'training.course', 'training.attempt')])>My Training @if ($trainingDue)<span class="nav-count">{{ $trainingDue }}</span>@endif</a>@endif
                            @if ($u->hasPermission('training_build'))<a href="{{ route('training.courses') }}" @class(['active' => request()->routeIs('training.courses*', 'training.lessons.*')])>Courses</a>@endif
                            @if ($u->hasPermission('training_assign'))<a href="{{ route('training.assign') }}" @class(['active' => request()->routeIs('training.assign*')])>Assign</a>@endif
                            @if ($u->hasPermission('training_assign'))<a href="{{ route('training.profiles') }}" @class(['active' => request()->routeIs('training.profiles*')])>Training profiles</a>@endif
                            @if ($u->hasPermission('training_grade'))
                                @php($toGrade = \App\Training\Models\Attempt::where('needs_grading', true)->count() + \App\Training\Models\Submission::where('status', 'waiting')->count())
                                <a href="{{ route('training.grading') }}" @class(['active' => request()->routeIs('training.grading')])>Grade answers @if ($toGrade)<span class="nav-count">{{ $toGrade }}</span>@endif</a>
                            @endif
                            @if ($u->hasPermission('training_signoff'))
                                @php($toSign = \App\Training\Models\LessonProgress::whereNotNull('signoff_requested_at')->whereNull('signed_off_at')->whereHas('assignment', fn ($a) => $a->whereNull('replaced_at'))->count())
                                <a href="{{ route('training.signoff') }}" @class(['active' => request()->routeIs('training.signoff*')])>Sign off skills @if ($toSign)<span class="nav-count">{{ $toSign }}</span>@endif</a>
                            @endif
                        </div>
                    </details>
                @endif
                @if ($u->hasAnyPermission('inspections', 'inspections_deficiencies', 'inspections_manage', 'inspection_reports', 'assets', 'assets_checkout', 'assets_manage', 'maintenance', 'maintenance_manage'))
                    @php($maintCount = $u->hasAnyPermission('maintenance', 'maintenance_manage') ? \App\Maintenance\Maintenance::navCount($u) : 0)
                    @php($openDeficiencies = $u->hasPermission('inspections_deficiencies') ? \App\Inspections\Models\Deficiency::open()->count() : 0)
                    @php($assetAlerts = $u->hasPermission('assets_manage') ? \App\Assets\Models\Asset::where(fn ($q) => $q->where('status', 'missing')->orWhere(fn ($r) => $r->whereIn('status', ['loaned', 'in_repair', 'assigned'])->whereNotNull('due_back_on')->whereDate('due_back_on', '<', today())))->count() : 0)
                    <details class="nav-menu">
                        <summary @class(['active' => request()->routeIs('inspections*', 'assets*', 'maintenance*') && ! request()->routeIs([...$settingsRoutes, ...$reportRoutes])])>Equipment @if ($openDeficiencies + $assetAlerts + $maintCount)<span class="nav-count">{{ $openDeficiencies + $assetAlerts + $maintCount }}</span>@endif</summary>
                        <div class="nav-drop">
                            @if (\App\Operations\Operations::canSee($u))<a href="{{ route('operations') }}" @class(['active' => request()->routeIs('operations')])>Operations Dashboard</a>@endif
                            @if ($u->hasAnyPermission('assets', 'assets_checkout', 'assets_manage'))<a href="{{ route('assets') }}" @class(['active' => request()->routeIs('assets', 'assets.show', 'assets.create', 'assets.edit', 'assets.labels', 'assets.imports*')])>Assets @if ($assetAlerts)<span class="nav-count">{{ $assetAlerts }}</span>@endif</a>@endif
                            @if ($u->hasAnyPermission('assets_checkout', 'assets_manage'))<a href="{{ route('assets.checkout') }}" @class(['active' => request()->routeIs('assets.checkout')])>Check Out / In</a>@endif
                            @if ($u->hasAnyPermission('assets', 'assets_checkout', 'assets_manage'))<a href="{{ route('assets.audits') }}" @class(['active' => request()->routeIs('assets.audits*')])>Asset Audits</a>@endif
                            @if ($u->hasAnyPermission('maintenance', 'maintenance_manage'))
                                <a href="{{ route('maintenance') }}" @class(['active' => request()->routeIs('maintenance', 'maintenance.show', 'maintenance.create')])>Work Orders @if ($maintCount)<span class="nav-count">{{ $maintCount }}</span>@endif</a>
                                <a href="{{ route('maintenance.due') }}" @class(['active' => request()->routeIs('maintenance.due')])>Coming Due</a>
                                <a href="{{ route('maintenance.plans') }}" @class(['active' => request()->routeIs('maintenance.plans*')])>Maintenance Plans</a>
                                <a href="{{ route('maintenance.facilities') }}" @class(['active' => request()->routeIs('maintenance.facilities*')])>Buildings</a>
                            @endif
                            @if ($u->hasPermission('inspections'))<a href="{{ route('inspections') }}" @class(['active' => request()->routeIs('inspections', 'inspections.do')])>Do a Check</a>@endif
                            @if ($u->hasPermission('inspections'))<a href="{{ route('inspections.report') }}" @class(['active' => request()->routeIs('inspections.report')])>Report a Problem</a>@endif
                            @if ($u->hasAnyPermission('inspections_deficiencies', 'inspections_manage', 'inspection_reports'))<a href="{{ route('inspections.dashboard') }}" @class(['active' => request()->routeIs('inspections.dashboard')])>Inspection Dashboard</a>@endif
                            @if ($u->hasAnyPermission('inspections', 'inspections_deficiencies', 'inspections_manage'))<a href="{{ route('inspections.history') }}" @class(['active' => request()->routeIs('inspections.history', 'inspections.show')])>Check History</a>@endif
                            @if ($u->hasPermission('inspections_deficiencies'))<a href="{{ route('inspections.deficiencies') }}" @class(['active' => request()->routeIs('inspections.deficiencies*')])>Deficiencies @if ($openDeficiencies)<span class="nav-count">{{ $openDeficiencies }}</span>@endif</a>@endif
                            @if ($u->hasPermission('inspections_manage'))<a href="{{ route('inspections.sheets') }}" @class(['active' => request()->routeIs('inspections.sheets*')])>Check Sheets</a>@endif
                            @if ($u->hasPermission('inspections_manage'))<a href="{{ route('inspections.subjects') }}" @class(['active' => request()->routeIs('inspections.subjects')])>What Gets Checked</a>@endif
                            @if ($u->hasPermission('inspections_manage'))<a href="{{ route('inspections.schedules') }}" @class(['active' => request()->routeIs('inspections.schedules')])>Schedules</a>@endif
                        </div>
                    </details>
                @endif
                @if ($u->hasAnyPermission('service_desk', 'service_desk_work', 'service_desk_manage'))
                    @php($deskWork = $u->hasAnyPermission('service_desk_work', 'service_desk_manage'))
                    @php($deskWaiting = $deskWork ? \App\ServiceDesk\Models\Ticket::workableBy($u)->whereIn('status', ['new', 'assigned', 'in_progress'])->where(fn ($q) => $q->whereNull('assigned_to')->orWhere('assigned_to', $u->id))->count() : 0)
                    @php($deskMine = $u->hasPermission('service_desk') ? \App\ServiceDesk\Models\Ticket::where('user_id', $u->id)->where('status', 'waiting')->count() : 0)
                    <details class="nav-menu">
                        <summary @class(['active' => request()->routeIs('service-desk*') && ! request()->routeIs([...$reportRoutes, ...$settingsRoutes])])>Service Desk @if ($deskWaiting + $deskMine)<span class="nav-count">{{ $deskWaiting + $deskMine }}</span>@endif</summary>
                        <div class="nav-drop">
                            @if ($u->hasPermission('service_desk'))
                                <a href="{{ route('service-desk.create') }}" @class(['active' => request()->routeIs('service-desk.create')])>New ticket</a>
                                <a href="{{ route('service-desk') }}" @class(['active' => request()->routeIs('service-desk')])>My tickets @if ($deskMine)<span class="nav-count">{{ $deskMine }}</span>@endif</a>
                            @endif
                            @if ($deskWork)
                                <a href="{{ route('service-desk.queue') }}" @class(['active' => request()->routeIs('service-desk.queue')])>Work queue @if ($deskWaiting)<span class="nav-count">{{ $deskWaiting }}</span>@endif</a>
                                <a href="{{ route('service-desk.dashboard') }}" @class(['active' => request()->routeIs('service-desk.dashboard')])>Dashboard</a>
                                @if (\App\Operations\Operations::canSee($u))<a href="{{ route('operations') }}" @class(['active' => request()->routeIs('operations')])>Operations Dashboard</a>@endif
                            @endif
                        </div>
                    </details>
                @endif
                @php($wellnessOn = \App\Wellness\Wellness::enabled())
                @php($wellnessUse = $wellnessOn && \App\Wellness\Wellness::canUse($u))
                @php($wellnessJoined = $wellnessUse && app(\App\Wellness\Wellness::class)->participant($u)?->isActive())
                @if ($wellnessUse || ($wellnessOn && $u->hasAnyPermission('wellness_admin', 'wellness_review')) || $u->hasPermission('wellness_settings'))
                    <details class="nav-menu">
                        <summary @class(['active' => request()->routeIs('wellness*')])>Wellness</summary>
                        <div class="nav-drop">
                            @if ($wellnessUse && ! $wellnessJoined)
                                <a href="{{ route('wellness') }}" @class(['active' => request()->routeIs('wellness')])>Sign up</a>
                                <a href="{{ route('wellness.rules') }}" @class(['active' => request()->routeIs('wellness.rules')])>Rules and privacy</a>
                            @endif
                            @if ($wellnessJoined)
                                <a href="{{ route('wellness') }}" @class(['active' => request()->routeIs('wellness')])>My Wellness</a>
                                <a href="{{ route('wellness.log') }}" @class(['active' => request()->routeIs('wellness.log')])>Log a day</a>
                                <a href="{{ route('wellness.activities') }}" @class(['active' => request()->routeIs('wellness.activities')])>Activities and rewards</a>
                                <a href="{{ route('wellness.leaderboard') }}" @class(['active' => request()->routeIs('wellness.leaderboard')])>Leaderboard</a>
                                <a href="{{ route('wellness.connect') }}" @class(['active' => request()->routeIs('wellness.connect')])>Devices</a>
                                <a href="{{ route('wellness.rules') }}" @class(['active' => request()->routeIs('wellness.rules')])>Rules and privacy</a>
                            @endif
                            @if ($wellnessOn && $u->hasPermission('wellness_review'))
                                <a href="{{ route('wellness.admin.review') }}" @class(['active' => request()->routeIs('wellness.admin.review')])>Review queue</a>
                            @endif
                            @if ($wellnessOn && $u->hasPermission('wellness_admin'))
                                <a href="{{ route('wellness.admin.rewards') }}" @class(['active' => request()->routeIs('wellness.admin.rewards')])>Rewards</a>
                                <a href="{{ route('wellness.admin.participants') }}" @class(['active' => request()->routeIs('wellness.admin.participants')])>Participants</a>
                                <a href="{{ route('wellness.admin.rules') }}" @class(['active' => request()->routeIs('wellness.admin.rules')])>Point rules</a>
                            @endif
                            @if ($u->hasPermission('wellness_settings'))
                                <a href="{{ route('wellness.admin.settings') }}" @class(['active' => request()->routeIs('wellness.admin.settings')])>Wellness settings</a>
                            @endif
                        </div>
                    </details>
                @endif
                @if ($u->hasAnyPermission('team_members', 'oig_exclusions', 'ems_affiliations', 'reports', 'form_reports', 'training_reports', 'arrivals', 'assignment_reports', 'audit_log', 'vehicles', 'vehicles_manage', 'profiles', 'settings', 'manage_forms', 'remotelock', 'service_desk_reports', 'service_desk_settings', 'supplies_stock', 'supplies_order', 'supplies_approve_orders', 'controlled_admin', 'status_boards', 'inspections_manage', 'inspection_reports', 'assets_manage', 'maintenance_manage', 'custom_reports', 'ai_assistant', 'id_cards'))
                    <details class="nav-menu">
                        <summary @class(['active' => request()->routeIs('admin.users*', 'admin.oig*', 'admin.ems*', 'admin.id-cards*', 'vehicles*', ...$reportRoutes, ...$settingsRoutes)])>Admin</summary>
                        <div class="nav-drop">
                            @if ($u->hasPermission('team_members'))<a href="{{ route('admin.users') }}" @class(['active' => request()->routeIs('admin.users*')])>Team Members</a>@endif
                            @if ($u->hasPermission('oig_exclusions'))<a href="{{ route('admin.oig') }}" @class(['active' => request()->routeIs('admin.oig*')])>OIG Exclusions</a>@endif
                            @if ($u->hasPermission('ems_affiliations'))<a href="{{ route('admin.ems') }}" @class(['active' => request()->routeIs('admin.ems*')])>EMS Affiliations</a>@endif
                            @if ($u->hasPermission('id_cards'))<a href="{{ route('admin.id-cards') }}" @class(['active' => request()->routeIs('admin.id-cards*')])>ID Cards</a>@endif
                            <x-nav-sub label="Reports" :active="request()->routeIs($reportRoutes)">
                                @if ($u->hasPermission('reports'))<a href="{{ route('supervisor.reports') }}" @class(['active' => request()->routeIs('supervisor.reports*')])>Draw Box Reports</a>@endif
                                @if ($u->hasPermission('form_reports'))<a href="{{ route('forms.reports') }}" @class(['active' => request()->routeIs('forms.reports*')])>Form Reports</a>@endif
                                @if ($u->hasPermission('training_reports'))<a href="{{ route('training.reports') }}" @class(['active' => request()->routeIs('training.reports*', 'training.progress', 'training.person')])>Training Reports</a>@endif
                                @if ($u->hasPermission('training_reports'))<a href="{{ route('training.ai-usage') }}" @class(['active' => request()->routeIs('training.ai-usage*')])>Training AI Usage</a>@endif
                                @if ($u->hasPermission('arrivals'))<a href="{{ route('vehicles.arrivals') }}" @class(['active' => request()->routeIs('vehicles.arrivals*')])>Vehicle Arrival Times</a>@endif
                                @if ($u->hasPermission('inspection_reports'))<a href="{{ route('inspections.reports') }}" @class(['active' => request()->routeIs('inspections.reports*')])>Inspection Reports</a>@endif
                                @if ($u->hasPermission('assignment_reports'))<a href="{{ route('fleet.reports') }}" @class(['active' => request()->routeIs('fleet.reports*')])>Vehicle Assignment Reports</a>@endif
                                @if ($u->hasPermission('service_desk_reports'))<a href="{{ route('service-desk.reports') }}" @class(['active' => request()->routeIs('service-desk.reports*')])>Service Desk Reports</a>@endif
                                @if ($u->hasPermission('supplies_stock'))<a href="{{ route('supplies.history') }}" @class(['active' => request()->routeIs('supplies.history*')])>Supply History</a>@endif
                                @if ($u->hasAnyPermission('supplies_order', 'supplies_approve_orders'))<a href="{{ route('supplies.spending') }}" @class(['active' => request()->routeIs('supplies.spending*')])>Supply Spending</a>@endif
                                @if ($u->hasAnyPermission('supplies_order', 'supplies_approve_orders', 'supplies_stock'))<a href="{{ route('supplies.value') }}" @class(['active' => request()->routeIs('supplies.value')])>Supply Value</a>@endif
                                @if ($u->hasPermission('controlled_admin'))<a href="{{ route('controlled.reports') }}" @class(['active' => request()->routeIs('controlled.reports')])>Controlled Substances</a>@endif
                                @if ($u->hasPermission('assets_manage'))<a href="{{ route('assets.reports') }}" @class(['active' => request()->routeIs('assets.reports')])>Asset Reports</a>@endif
                                @if ($u->hasPermission('maintenance_manage'))<a href="{{ route('maintenance.reports') }}" @class(['active' => request()->routeIs('maintenance.reports')])>Maintenance Reports</a>@endif
                                @if ($u->hasPermission('custom_reports'))<a href="{{ route('reports.custom') }}" @class(['active' => request()->routeIs('reports.custom*')])>Custom Reports</a>@endif
                                @if ($u->hasPermission('ai_assistant'))<a href="{{ route('assistant') }}" @class(['active' => request()->routeIs('assistant')])>AI Assistant</a>@endif
                                @if ($u->hasPermission('audit_log'))<a href="{{ route('admin.audit') }}" @class(['active' => request()->routeIs('admin.audit')])>Audit Log</a>@endif
                            </x-nav-sub>
                            <x-nav-sub label="Vehicles" :active="request()->routeIs('vehicles', 'vehicles.list', 'vehicles.settings')">
                                @if ($u->hasPermission('vehicles'))<a href="{{ route('vehicles') }}" @class(['active' => request()->routeIs('vehicles')])>On Property</a>@endif
                                @if ($u->hasAnyPermission('vehicles', 'vehicles_manage'))<a href="{{ route('vehicles.list') }}" @class(['active' => request()->routeIs('vehicles.list')])>Vehicle List</a>@endif
                                @if ($u->hasPermission('vehicles_manage'))<a href="{{ route('vehicles.settings') }}" @class(['active' => request()->routeIs('vehicles.settings')])>Camera Settings</a>@endif
                            </x-nav-sub>
                            <x-nav-sub label="Settings" :active="request()->routeIs($settingsRoutes)">
                                @if ($u->hasPermission('profiles'))<a href="{{ route('admin.profiles') }}" @class(['active' => request()->routeIs('admin.profiles*')])>Permission Profiles</a>@endif
                                @if ($u->hasPermission('settings'))<a href="{{ route('supervisor.settings') }}" @class(['active' => request()->routeIs('supervisor.settings')])>General Settings</a>@endif
                                @if ($u->hasPermission('manage_forms'))<a href="{{ route('admin.forms') }}" @class(['active' => request()->routeIs('admin.forms*')])>Form Editor</a>@endif
                                @if ($u->hasPermission('manage_forms'))<a href="{{ route('admin.lists') }}" @class(['active' => request()->routeIs('admin.lists*')])>Shared Lists</a>@endif
                                @if ($u->hasPermission('manage_forms'))<a href="{{ route('admin.slack') }}" @class(['active' => request()->routeIs('admin.slack*')])>Slack</a>@endif
                                @if ($u->hasPermission('service_desk_settings'))<a href="{{ route('service-desk.settings') }}" @class(['active' => request()->routeIs('service-desk.settings*')])>Service Desk</a>@endif
                                @if ($u->hasPermission('remotelock'))<a href="{{ route('admin.remotelock') }}" @class(['active' => request()->routeIs('admin.remotelock*')])>RemoteLock</a>@endif
                                @if ($u->hasPermission('status_boards'))<a href="{{ route('boards.index') }}" @class(['active' => request()->routeIs('boards.*')])>Status Boards</a>@endif
                                @if ($u->hasPermission('inspections_manage'))<a href="{{ route('inspections.settings') }}" @class(['active' => request()->routeIs('inspections.settings')])>Inspection Settings</a>@endif @if ($u->hasPermission('assets_manage'))<a href="{{ route('assets.settings') }}" @class(['active' => request()->routeIs('assets.settings*')])>Asset Settings</a>@endif @if ($u->hasPermission('maintenance_manage'))<a href="{{ route('maintenance.settings') }}" @class(['active' => request()->routeIs('maintenance.settings')])>Maintenance Settings</a>@endif @if ($u->hasPermission('ai_assistant'))<a href="{{ route('assistant.settings') }}" @class(['active' => request()->routeIs('assistant.settings')])>AI Assistant Settings</a>@endif
                            </x-nav-sub>
                        </div>
                    </details>
                @endif
                <a href="{{ route('help') }}" @class(['nav-help', 'active' => request()->routeIs('help*')]) title="Help" aria-label="Help">?</a>
                <form method="post" action="{{ route('logout') }}">@csrf<button type="submit">Sign out</button></form>
            </nav>
        </div>
    </header>
@endauth

@hasSection('band')
    <section class="band"><div class="band-inner">@yield('band')</div></section>
@endif

@hasSection('bare')
    @yield('bare')
@else
    <main>
        @if (session('status'))<div class="flash flash-ok">{{ session('status') }}</div>@endif
        @if (session('error'))<div class="flash flash-error">{{ session('error') }}</div>@endif
        @if (is_array(session('warning')))<div class="flash flash-error"><strong>{{ session('warning')['title'] }}</strong><ul class="flash-list">@foreach (session('warning')['items'] as $item)<li>{{ $item['text'] }}@if ($item['url']) <a href="{{ $item['url'] }}">Open</a>@endif</li>@endforeach</ul></div>@endif
        @if ($errors->any())
            <div class="flash flash-error">@foreach ($errors->all() as $e)<div>{{ $e }}</div>@endforeach</div>
        @endif
        @yield('content')
    </main>
@endif
<script>
    // One nav menu (and one submenu) open at a time; a click anywhere else closes them.
    document.addEventListener('click', function (e) {
        document.querySelectorAll('.nav-menu[open], .nav-sub[open]').forEach(function (m) { if (!m.contains(e.target)) m.removeAttribute('open'); });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') document.querySelectorAll('.nav-menu[open], .nav-sub[open]').forEach(function (m) { m.removeAttribute('open'); });
    });
</script>
@stack('scripts')
</body>
</html>
