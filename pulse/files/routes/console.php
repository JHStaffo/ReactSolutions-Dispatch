<?php

use App\Inspections\Import\SheetImporter;
use App\Inspections\Scheduling;
use App\Maintenance\Maintenance;
use App\Models\AuditLog;
use App\Models\EmsCheck;
use App\Models\PermissionProfile;
use App\Models\ProtocolImport;
use App\Models\ProtocolVersion;
use App\Models\Setting;
use App\Models\User;
use App\Operations\Assistant;
use App\ServiceDesk\ServiceDesk;
use App\Services\Credits;
use App\Services\Ems\Affiliations;
use App\Services\Forms;
use App\Services\OigExclusions;
use App\Services\PlateReads;
use App\Services\ProtocolImport\ProtocolImporter;
use App\Services\RemoteLockSync;
use App\Services\Slack;
use App\Services\Ssn;
use App\Supplies\Alerts;
use App\Supplies\Audits;
use App\Supplies\Import\Importer;
use App\Supplies\Orders;
use App\Supplies\Requests;
use App\Training\Automation;
use App\Training\Generate\CourseGenerator;
use App\Training\Import\TalentLmsImporter;
use App\Training\Versions;
use App\Wellness\Rewards;
use App\Wellness\SyncCheck;
use Database\Seeders\ProtocolSampleSeeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Storage;

Artisan::command('drawbox:expire', function (Credits $credits) {
    $count = $credits->expireOverdue();
    if ($count) {
        AuditLog::record('system.expire', "{$count} unused draw(s) passed their window and expired.");
    }
    $this->info("Expired {$count} draw(s).");
})->purpose('Mark draws past their window as expired');

Artisan::command('drawbox:notify', function (Credits $credits) {
    $count = $credits->sendNewDrawNotices();
    if ($count) {
        AuditLog::record('system.notify', "Emailed {$count} team member(s) about new draws.");
    }
    $this->info("Sent {$count} new-draw email(s).");
})->purpose('Email team members about draws they earned since the last run');

Artisan::command('drawbox:remind', function (Credits $credits) {
    $count = $credits->sendReminders();
    if ($count) {
        AuditLog::record('system.remind', "Emailed {$count} team member(s) whose draws expire within a day.");
    }
    $this->info("Sent {$count} reminder(s).");
})->purpose('Email team members whose draws expire within 24 hours');

Artisan::command('drawbox:make-admin {email} {name}', function (string $email, string $name) {
    // The Admin profile, recreated with every permission if it was renamed or deleted.
    $profile = PermissionProfile::firstOrCreate(['name' => 'Admin'], ['permissions' => array_keys(PermissionProfile::permissionLabels())]);
    $profile->update(['permissions' => array_keys(PermissionProfile::permissionLabels())]);
    // Someone already on the roster keeps their name (and preferred name) as it is.
    $user = User::firstOrNew(['email' => strtolower($email)]);
    $user->fill(($user->exists ? [] : ['name' => $name]) + ['permission_profile_id' => $profile->id, 'active' => true])->save();
    AuditLog::record('admin.make-admin', "{$user->name} was made an admin from the server command line.", $user);
    $this->info("{$user->name} <{$user->email}> is an admin.");
})->purpose('Create or promote an admin account');

Artisan::command('oig:check', function (OigExclusions $oig) {
    $check = $oig->run();
    if ($check->status === 'failed') {
        AuditLog::record('system.oig-check', "Monthly OIG exclusion check failed: {$check->error}");
        $this->error($check->error);

        return 1;
    }
    AuditLog::record('system.oig-check', "Checked {$check->members_checked} Team Members against the OIG exclusion list: {$check->excluded_count} excluded, {$check->review_count} to check by hand.");
    $this->info("Checked {$check->members_checked}: {$check->excluded_count} excluded, {$check->review_count} to check by hand.");

    return 0;
})->purpose('Check every active Team Member against the OIG exclusion list');

Artisan::command('ems:check', function (Affiliations $affiliations) {
    // The daily check: start one and run it now.
    if (EmsCheck::whereIn('status', ['queued', 'running'])->exists()) {
        $this->info('A check is already waiting or running.');

        return 0;
    }
    $check = $affiliations->run($affiliations->queue(null));
    AuditLog::record('system.ems-check', $check->status === 'failed'
        ? "Daily EMS affiliation check stopped: {$check->error}"
        : "Daily EMS affiliation check of {$check->members_total} Team Members: {$check->found_count} found, {$check->attentionCount()} to look at.");
    $this->info($check->status === 'failed' ? $check->error : "Checked {$check->members_total} Team Members.");

    return $check->status === 'failed' ? 1 : 0;
})->purpose('Search every active Team Member on the Virginia EMS provider search');

Artisan::command('ems:run', function (Affiliations $affiliations) {
    // Runs a check started with Check now (a web page can't wait for every search).
    EmsCheck::where('status', 'running')->where('updated_at', '<', now()->subMinutes(30))
        ->update(['status' => 'failed', 'error' => 'Stopped before it finished.', 'finished_at' => now()]);
    $check = EmsCheck::where('status', 'queued')->oldest('id')->first();
    if (! $check) {
        return 0;
    }
    $check = $affiliations->run($check);
    AuditLog::record('system.ems-check', $check->status === 'failed'
        ? "EMS affiliation check stopped: {$check->error}"
        : "EMS affiliation check of {$check->members_total} Team Members finished: {$check->found_count} found, {$check->attentionCount()} to look at.");

    return 0;
})->purpose('Run an EMS affiliation check started from Admin > EMS Affiliations');

Artisan::command('drawbox:ssn-key', function () {
    // SSNs are encrypted with their own key. Making a new one when SSNs are
    // already saved would leave them unreadable, so an existing key is kept.
    $path = base_path('.env');
    $env = is_file($path) ? file_get_contents($path) : '';
    if (preg_match('/^SSN_KEY=\S+/m', $env)) {
        $this->error('SSN_KEY is already set in .env. It was left alone, because SSNs saved with it would be lost.');

        return 1;
    }
    $line = 'SSN_KEY='.Ssn::generateKey();
    $env = preg_match('/^SSN_KEY=\s*$/m', $env) ? preg_replace('/^SSN_KEY=\s*$/m', $line, $env, 1) : rtrim($env, "\n")."\n\n# Encrypts Social Security numbers. Back it up with the database; without it they can't be read.\n{$line}\n";
    file_put_contents($path, $env);
    AuditLog::record('system.ssn-key', 'Made the SSN encryption key from the server command line.');
    $this->info('Added SSN_KEY to .env. Run php artisan config:cache, and keep a copy of this key somewhere safe, apart from the database backups.');

    return 0;
})->purpose('Make the key that encrypts Social Security numbers');

Artisan::command('protocols:load-sample', function () {
    // Puts the arranged Cardiac Arrest sample into a draft, whatever state the protocol is in.
    // The Medical Director still has to approve it before Team Members see it.
    $existing = ProtocolVersion::where('title', 'Cardiac Arrest')->latest('id')->first()?->protocol;
    if (! $existing) {
        (new ProtocolSampleSeeder)->run();
        AuditLog::record('system.protocol-sample', 'Loaded the Cardiac Arrest sample as a new draft protocol from the server command line.');
        $this->info('Added the Cardiac Arrest protocol as a draft. Send it for approval from Protocols > Build protocols.');

        return;
    }

    $content = ProtocolSampleSeeder::content();
    $draft = $existing->openVersion();
    $from = $draft ? "version {$draft->version} ({$draft->statusLabel()})" : null;
    // Keep any links the builders set on boxes the sample also has (like Exit to ROSC).
    $links = collect(($draft ?? $existing->approved ?? $existing->latest)->boxes())->pluck('link', 'id');
    $content['chart']['nodes'] = array_map(fn ($n) => ['link' => $links[$n['id']] ?? $n['link']] + $n, $content['chart']['nodes']);

    if ($draft) {
        $draft->update($content + ['status' => 'draft', 'submitted_at' => null, 'submitted_by' => null]);
    } else {
        $base = $existing->approved ?? $existing->latest;
        $draft = $existing->versions()->create($content + [
            ...$base->only(['number', 'title', 'revised_label']),
            'version' => $existing->versions()->max('version') + 1,
            'status' => 'draft',
        ]);
    }
    $draft->update(['search_text' => $draft->fresh()->buildSearchText()]);

    $where = $from ? "replaced the flowchart and sections of {$from}" : "started version {$draft->version} as a draft";
    AuditLog::record('system.protocol-sample', "Loaded the arranged Cardiac Arrest sample from the server command line: {$where}.");
    $this->info(ucfirst($where).'. Open Protocols > Build protocols to check it and send it for approval.'
        .($existing->approved ? " Version {$existing->approved->version} stays in the book until then." : ''));
})->purpose('Load the arranged Cardiac Arrest sample protocol as a draft');

Artisan::command('pulse:slack-retry', function (Forms $forms) {
    $count = $forms->retryFailed();
    if ($count) {
        AuditLog::record('system.slack-retry', "Posted {$count} form submission(s) to Slack that didn't go through the first time.");
    }
    $this->info("Posted {$count} submission(s).");
})->purpose('Try again to post form submissions Slack did not take');

Artisan::command('remotelock:sync', function (RemoteLockSync $sync) {
    // Team Members added, changed or turned off whose change hasn't reached RemoteLock yet.
    $done = $sync->pushPending();
    if ($done) {
        AuditLog::record('system.remotelock-sync', implode(' ', $done));
    }
    $this->info(count($done).' RemoteLock change(s).');
})->purpose('Send Team Member changes waiting for RemoteLock');

Artisan::command('wellness:close-weeks', function (Rewards $rewards) {
    $count = $rewards->closeWeeks();
    if ($count) {
        AuditLog::record('system.wellness-weeks', "{$count} Team Member(s) earned the weekly Wellness gift card and were emailed.");
    }
    $this->info("Created {$count} weekly reward(s).");
})->purpose('Give the weekly Wellness reward for weeks that have closed');

Artisan::command('wellness:sync-check', function (SyncCheck $check) {
    $count = $check->run();
    if ($count) {
        AuditLog::record('system.wellness-sync-check', "Emailed {$count} Team Member(s) whose wearable hasn't synced in 2 days.");
    }
    $this->info("Sent {$count} sync reminder(s).");
})->purpose('Email Wellness Team Members whose wearable stopped syncing');

Artisan::command('vehicles:close-stale', function (PlateReads $reads) {
    // Stays with no exit seen after the longest stay, so "on property now" doesn't keep cars that left unseen.
    $count = $reads->closeStale();
    if ($count) {
        AuditLog::record('system.vehicles-close-stale', "Closed {$count} vehicle stay(s) with no exit seen after ".Setting::get('lpr_max_stay_hours').' hours.');
    }
    $this->info("Closed {$count} stay(s).");
})->purpose('Close vehicle stays that were never seen leaving');

Artisan::command('inspections:schedule', function (Scheduling $scheduling) {
    // Makes the checks due now from each schedule, marks unfinished ones missed, and sends reminders and overdue notices.
    $r = $scheduling->run();
    if ($r['made'] || $r['missed'] || $r['reminded'] || $r['overdue']) {
        AuditLog::record('system.inspections-schedule', "Checks due: {$r['made']} new, {$r['missed']} missed, {$r['reminded']} reminder email(s), {$r['overdue']} newly overdue.");
    }
    $this->info("{$r['made']} due, {$r['missed']} missed, {$r['reminded']} reminded, {$r['overdue']} overdue.");
})->purpose('Make inspection checks due from their schedules and send reminders');

Schedule::command('inspections:schedule')->everyFiveMinutes()->withoutOverlapping(10);

Artisan::command('inspections:import {--all : Keep going until every upload is read}', function (SheetImporter $importer) {
    // Reads paper check sheets uploaded under Equipment > Check Sheets into turned-off check sheets.
    if (! $importer->ready()) {
        return;
    }
    $count = 0;
    $until = now()->addSeconds(50);
    while ($importer->runNext()) {
        $count++;
        if (! $this->option('all') && now()->greaterThan($until)) {
            break;
        }
    }
    $this->info($count ? "Read {$count} check sheet upload(s)." : 'No check sheet uploads waiting.');
})->purpose('Have Claude read paper check sheets uploaded under Check Sheets');

Schedule::command('inspections:import')->everyMinute()->withoutOverlapping(30);
Artisan::command('service-desk:escalate', function (ServiceDesk $desk) {
    // Tickets nobody has touched for their priority's hours (Admin > Settings > Service Desk).
    $count = $desk->escalateDue();
    if ($count) {
        AuditLog::record('system.service-desk-escalate', "Escalated {$count} ticket(s) nobody had touched in time.");
    }
    $this->info("Escalated {$count} ticket(s).");
})->purpose('Escalate Service Desk tickets nobody has worked in time');

Artisan::command('service-desk:close', function (ServiceDesk $desk) {
    $count = $desk->closeResolved();
    if ($count) {
        AuditLog::record('system.service-desk-close', "Closed {$count} resolved ticket(s) after ".Setting::get('service_desk_close_days').' days.');
    }
    $this->info("Closed {$count} ticket(s).");
})->purpose('Close Service Desk tickets resolved long enough ago');

Artisan::command('supplies:alerts', function (Alerts $alerts) {
    // The morning summary of low and expiring supplies, to Slack and (if turned on) email.
    $r = $alerts->sendDaily();
    if ($r['slack'] || $r['emailed']) {
        AuditLog::record('system.supplies-alerts', "Sent the supplies summary ({$r['low']} low, {$r['expiring']} expiring)".($r['slack'] ? ' to Slack' : '').($r['emailed'] ? ($r['slack'] ? ' and' : '')." by email to {$r['emailed']} Team Member(s)" : '').'.');
    }
    $this->info("{$r['low']} low, {$r['expiring']} expiring.");
})->purpose('Post and email the daily summary of low and expiring supplies');

Artisan::command('maintenance:run', function (Maintenance $maintenance, Slack $slack) {
    // Type plans pick up new assets, plans coming due get a work order (when that's on), and the
    // morning summary goes to Slack and (if turned on) email.
    $r = $maintenance->run();
    if ($r['made']) {
        AuditLog::record('system.maintenance', "Made {$r['made']} work order(s) for maintenance coming due.");
    }
    $s = $maintenance->sendDaily($slack);
    if ($s['slack'] || $s['emailed']) {
        AuditLog::record('system.maintenance', 'Sent the maintenance summary'.($s['slack'] ? ' to Slack' : '').($s['emailed'] ? ($s['slack'] ? ' and' : '')." by email to {$s['emailed']} Team Member(s)" : '').'.');
    }
    $this->info("{$r['added']} added to plans, {$r['made']} work order(s) made, {$s['lines']} summary line(s).");
})->purpose('Make work orders for maintenance coming due and send the daily maintenance summary');

Artisan::command('operations:weekly', function (Assistant $assistant) {
    // The AI's weekly operations summary (Admin > Reports > AI Assistant > settings), when it's turned on.
    if (Setting::get('ai_weekly_enabled') !== '1' || ! $assistant->ready()) {
        $this->info('The weekly summary is off or there is no Anthropic key.');

        return;
    }
    $r = $assistant->sendWeekly();
    AuditLog::record('system.ai-weekly', $r['error'] ? "The weekly operations summary failed: {$r['error']}" : 'Sent the weekly operations summary'.($r['slack'] ? ' to Slack' : '').($r['emailed'] ? ($r['slack'] ? ' and' : '')." by email to {$r['emailed']} Team Member(s)" : '').'.');
    $this->info($r['error'] ?: 'Sent.');
})->purpose('Write and send the AI weekly operations summary');

Artisan::command('supplies:audits', function (Audits $audits) {
    // Makes the counts schedules call for and emails reminders (Supplies > Counts).
    $r = $audits->runSchedules();
    if ($r['created'] || $r['reminded'] || $r['overdue']) {
        AuditLog::record('system.supplies-audits', "Supply counts: {$r['created']} came due, {$r['reminded']} reminder(s), {$r['overdue']} overdue notice(s).");
    }
    $this->info("{$r['created']} count(s) came due, {$r['reminded']} reminder(s), {$r['overdue']} overdue.");
})->purpose('Make scheduled supply counts and send reminders');

Artisan::command('supplies:requests', function (Requests $requests, Orders $orders) {
    // Hourly: restock requests for places below their minimum, and supply room shortages onto vendor drafts.
    $lines = [];
    if (Setting::get('supplies_auto_restock') !== '0') {
        $r = $requests->autoRestock();
        if ($r['made'] || $r['closed']) {
            $lines[] = "{$r['made']} new restock request(s), {$r['closed']} no longer needed";
        }
    }
    if (Setting::get('supplies_auto_order_drafts') !== '0') {
        $added = $orders->autoDrafts();
        if ($added) {
            $lines[] = 'added to draft orders: '.implode(', ', $added);
        }
    }
    if ($lines) {
        AuditLog::record('system.supplies-requests', ucfirst(implode('; ', $lines)).'.');
    }
    $this->info($lines ? implode("\n", $lines) : 'Nothing to do.');
})->purpose('Make restock requests and vendor draft orders for supplies below their minimum');
Schedule::command('supplies:requests')->hourlyAt(20)->withoutOverlapping(30);
Schedule::command('supplies:audits')->dailyAt('06:45');
Schedule::command('supplies:alerts')->dailyAt('07:00');
Schedule::command('maintenance:run')->dailyAt('06:50')->withoutOverlapping(30);
Artisan::command('vehicles:snapshots', function (\App\Services\PlateSnapshots $snapshots) {
    // Pictures the webhook couldn't save right away. Downloads aren't in the audit log; the plate read is the record.
    $this->info($snapshots->fetchWaiting().' picture(s) saved.');
})->purpose('Save plate read pictures that are still waiting');

Artisan::command('vehicles:prune-snapshots', function (\App\Services\PlateSnapshots $snapshots) {
    $count = $snapshots->prune();
    if ($count) {
        AuditLog::record('system.vehicles-prune-snapshots', "Deleted {$count} plate read picture(s) older than ".Setting::get('lpr_snapshot_keep_days').' days.');
    }
    $this->info("Deleted {$count} picture(s).");
})->purpose('Delete plate read pictures past the keep period');

Schedule::command('operations:weekly')->weeklyOn(1, '07:10')->withoutOverlapping(30);
Schedule::command('vehicles:close-stale')->hourly();
Schedule::command('vehicles:snapshots')->everyFiveMinutes()->withoutOverlapping(10);
Schedule::command('vehicles:prune-snapshots')->dailyAt('03:30')->withoutOverlapping(60);
Schedule::command('service-desk:escalate')->everyFifteenMinutes()->withoutOverlapping(15);
Schedule::command('service-desk:close')->dailyAt('03:00');
Schedule::command('wellness:close-weeks')->dailyAt('06:00');
Schedule::command('wellness:sync-check')->dailyAt('10:00');
Schedule::command('drawbox:expire')->everyFifteenMinutes();
Schedule::command('drawbox:notify')->everyTwoHours();
Schedule::command('drawbox:remind')->hourly();
Schedule::command('pulse:slack-retry')->everyFiveMinutes();
Schedule::command('remotelock:sync')->everyFiveMinutes()->withoutOverlapping(15);
Schedule::command('protocols:import')->everyMinute()->withoutOverlapping(30);
Schedule::command('supplies:import')->everyMinute()->withoutOverlapping(30);
Schedule::command('training:generate')->everyMinute()->withoutOverlapping(30);
Schedule::command('training:update-emails')->dailyAt('08:00');
Schedule::command('training:schedule')->everyFiveMinutes()->withoutOverlapping(10);
Schedule::command('training:daily')->dailyAt('07:30')->withoutOverlapping(30);
// The OIG posts its updated list early each month; check everyone on the 15th.
Schedule::command('oig:check')->monthlyOn(15, '07:00')->withoutOverlapping(30);
Schedule::command('ems:run')->everyMinute()->withoutOverlapping(120);
// Every active Team Member on the Virginia EMS provider search each morning, with a Slack summary.
Schedule::command('ems:check')->dailyAt('06:00')->withoutOverlapping(120);

Artisan::command('training:schedule', function (Automation $automation) {
    // Courses set to publish or retire at a date and time (Training > Courses > the course).
    foreach ($automation->runSchedule() as $line) {
        $this->line($line);
    }
})->purpose('Publish and retire training courses at their scheduled times');

Artisan::command('training:daily', function (Automation $automation) {
    // Renewals of courses whose completion expires soon, then reminder emails for due and overdue training.
    $renewed = $automation->renew();
    $counts = $automation->remind();
    if ($counts['sent']) {
        AuditLog::record('system.training-reminders', "Emailed {$counts['sent']} Team Member(s) training reminders (due soon or overdue).");
    }
    $this->info("Renewed {$renewed}; reminders sent to {$counts['sent']}, {$counts['skipped']} not sent (training emails off).");
})->purpose('Assign training renewals and send training reminder emails');

Artisan::command('training:update-emails', function (Versions $versions) {
    // Tells Team Members once a day about updates to courses they finished (when training emails are on in Settings).
    $counts = $versions->sendUpdateNotices();
    if ($counts['sent']) {
        AuditLog::record('system.training-update-emails', "Emailed {$counts['sent']} Team Member(s) about updates to courses they finished.");
    }
    if ($counts['skipped']) {
        AuditLog::record('system.training-update-emails', "Training emails are off in Settings, so {$counts['skipped']} course update notice(s) were not sent.");
    }
    $this->info("Sent {$counts['sent']} update email(s); {$counts['skipped']} skipped.");
})->purpose('Email Team Members about updates to training courses they finished');

Artisan::command('training:import-talentlms {path : Folder of the TalentLMS export (with manifest.json)} {--course=* : Only these TalentLMS course ids} {--dry-run : Show what would come over without saving}', function (string $path) {
    // One-time move from TalentLMS: courses arrive as drafts with their completion history. Team Members are never created.
    $importer = new TalentLmsImporter($path);
    $report = $importer->run(array_map('intval', $this->option('course')), (bool) $this->option('dry-run'));
    $this->table(['Course', 'Result', 'Lessons', 'Questions', 'Completed', 'In progress'], collect($report['courses'])->map(fn ($c) => [
        $c['title'], $c['result'], $c['lessons'] ?? '', $c['questions'] ?? '', $c['completed'] ?? '', $c['open'] ?? '',
    ])->all());
    foreach ($report['matched_by_name'] as $m) {
        $this->line("Matched by name: {$m['talentlms']} is {$m['pulse']}");
    }
    foreach ($report['notes'] as $note) {
        $this->warn($note);
    }
    $missing = collect($report['not_in_pulse'])->sortBy(fn ($p) => mb_strtolower($p['last_name'].' '.$p['first_name']))->values();
    $csv = "First Name,Last Name,Email,TalentLMS status,Courses,Completed\n".$missing->map(fn ($p) => implode(',', array_map(
        fn ($v) => '"'.str_replace('"', '""', (string) $v).'"', [$p['first_name'], $p['last_name'], $p['email'], $p['talentlms_status'], $p['courses'], $p['completed']]
    )))->implode("\n");
    Storage::disk('local')->put('talentlms-not-in-pulse.csv', $csv."\n");
    $this->info($missing->count().' TalentLMS people are not in Pulse: listed in '.Storage::disk('local')->path('talentlms-not-in-pulse.csv'));
})->purpose('Bring courses and completion history over from a TalentLMS export');

Artisan::command('training:generate', function (CourseGenerator $generator) {
    // Writes courses asked for under Training > Courses > Write a course with AI.
    if (! $generator->ready()) {
        return;
    }
    $count = 0;
    $until = now()->addSeconds(50);
    while (now()->lessThan($until) && $generator->runNext()) {
        $count++;
    }
    $this->info($count ? "Worked on {$count} AI course request(s)." : 'No AI course requests waiting.');
})->purpose('Have Claude write the courses asked for under Training > Courses');

Artisan::command('supplies:import {--all : Keep going until every upload is read}', function (Importer $importer) {
    // Reads supply lists and par sheets uploaded under Supplies > Import that need AI.
    if (! $importer->aiReady()) {
        return;
    }
    $count = 0;
    $until = now()->addSeconds(50);
    while ($importer->runNext()) {
        $count++;
        if (! $this->option('all') && now()->greaterThan($until)) {
            break;
        }
    }
    $this->info($count ? "Read {$count} supply upload(s)." : 'No supply uploads waiting.');
})->purpose('Have Claude read supply lists and par sheets uploaded under Supplies > Import');

Artisan::command('protocols:import {--all : Keep going until every upload is read}', function (ProtocolImporter $importer) {
    // Reads the next couple of pages of uploaded protocol files (Protocols > Build protocols > Import).
    // Cron runs it every minute; --all is for running it by hand.
    if (! $importer->ready()) {
        if (ProtocolImport::whereIn('status', ['queued', 'working'])->exists()) {
            $this->warn('Uploads are waiting, but ANTHROPIC_API_KEY is not set in .env.');
        }

        return;
    }
    $steps = 0;
    $until = now()->addSeconds(50);
    while ($importer->runNext()) {
        $steps++;
        if (! $this->option('all') && now()->greaterThan($until)) {
            break;
        }
    }
    $this->info($steps ? "Read {$steps} step(s) of uploaded protocols." : 'No uploads waiting.');
})->purpose('Turn uploaded protocol PDFs and photos into draft protocols');

// Trip Board (App\Trips): Samsara GPS polling when a token is set, breadcrumb pruning, and demo data.
Artisan::command('trips:samsara', function (\App\Trips\Gps $gps) {
    try {
        $n = $gps->pollSamsara();
        $this->info("Saved {$n} positions from Samsara.");
    } catch (\Throwable $e) {
        report($e);
        $this->error($e->getMessage());
    }
})->purpose('Pull truck positions from Samsara (Trip Settings)');
Schedule::command('trips:samsara')->everyMinute()->withoutOverlapping(5)->when(fn () => \App\Models\Setting::get('trips_samsara_token') !== '');

Artisan::command('trips:prune-gps {--days=90}', function (\App\Trips\Gps $gps) {
    $this->info('Deleted '.$gps->prune((int) $this->option('days')).' old GPS positions.');
})->purpose('Delete GPS breadcrumbs older than --days (90)');
Schedule::command('trips:prune-gps')->dailyAt('03:20');

Artisan::command('trips:sample {email : The Team Member the sample trips are booked as} {--force : Run even when APP_ENV is production}', function (string $email) {
    if (app()->environment('production') && ! $this->option('force')) {
        $this->error('This adds made-up patients and trips. Use --force to add them on a production install anyway.');

        return 1;
    }
    $user = \App\Models\User::where('email', mb_strtolower($email))->first();
    if (! $user) {
        $this->error("No Team Member with the email {$email}.");

        return 1;
    }
    $made = app(\App\Trips\Sample::class)->load($user);
    $this->info("Added sample data: {$made['facilities']} facilities, {$made['trucks']} trucks with today's crews, {$made['patients']} patients and {$made['trips']} trips. The GPS simulator is on (Trip Settings).");
})->purpose('Add made-up facilities, trucks, patients and trips for a Trip Board demo');
