<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    public const DEFAULTS = [
        'draw_window_days' => '7',
        'draw_delay_hours' => '2',
        'expiry_reminder_enabled' => '1',
        // Training emails (course update notices). Off until the courses are all in, so nobody gets a flood.
        'training_emails_enabled' => '0',
        // Training reminders (sent only while training emails are on): days before the due date, and how often while overdue. 0 = none.
        'training_remind_before_days' => '3',
        'training_remind_overdue_days' => '7',
        // AI for Team Members in courses that turn it on: tokens per Team Member per course (a course can set its own), and per Team Member per month across all courses. 0 = no limit.
        'training_ai_course_tokens' => '50000',
        'training_ai_monthly_tokens' => '300000',
        'locker_pickup_days' => '7',
        'news_hide_dispatcher' => '0',
        'news_hide_supervisor' => '0',
        'news_hide_admin' => '0',
        'news_min_cents' => '0',
        'scope_base_crew' => '2',
        // Encrypted Slack bot token (see App\Services\Slack). Empty means not connected.
        'slack_bot_token' => '',
        // Encrypted Anthropic API key for reading uploaded protocols (see App\Services\ProtocolImport\AnthropicKey).
        'anthropic_api_key' => '',
        // Encrypted RemoteLock client ID and secret (see App\Services\RemoteLock). Empty means not connected.
        'remotelock_credentials' => '',
        // Add Team Members to RemoteLock as they're added to Pulse.
        'remotelock_auto_add' => '1',
        // Encrypted secret Turing signs its license plate webhook with (Vehicles > Camera settings). Empty: reads are refused.
        'turing_webhook_secret' => '',
        // A plate read again at the same camera within this many minutes is a repeat, not a new in or out.
        'lpr_repeat_minutes' => '3',
        // A stay with no exit seen after this many hours is closed as "never seen leaving".
        'lpr_max_stay_hours' => '26',
        // Pulse's own copies of plate read pictures are deleted after this many days.
        'lpr_snapshot_keep_days' => '365',
        // Supplies: days ahead that stock counts as expiring soon, the Slack channel (ID and name) for the
        // daily low and expiring summary, and whether Team Members with Manage supplies get it by email.
        'supplies_expiry_days' => '60',
        'supplies_slack_channel' => '',
        'supplies_slack_channel_name' => '',
        'supplies_alert_email' => '0',
        // "We have RFID": shows RFID tag fields on items (and later assets). Reader hookups come in a later part.
        'supplies_rfid_enabled' => '0',
        'supplies_count_approval' => '1',
        'supplies_order_approval_dollars' => '',
        'supplies_order_from' => '',
        // Blank: no second approval. Over it, two different people approve an order.
        'supplies_order_second_approval_dollars' => '',
        // Blank: requests don't need approval (unless an item's category always needs it).
        'supplies_request_approval_dollars' => '',
        // Hourly: restock requests for places below their minimum, and supply room shortages onto vendor drafts.
        'supplies_auto_restock' => '1',
        'supplies_auto_order_drafts' => '1',
        // Forecasting: how many weeks of use a suggested order covers.
        'supplies_forecast_weeks' => '4',
        'supplies_blind_counts' => '1',
        'supplies_audit_reminder_days' => '3',
        // Controlled substances: '2' = a second person confirms with their witness PIN, '1' = one person.
        'controlled_verify_receive' => '2',
        'controlled_verify_move' => '2',
        'controlled_verify_assign' => '2',
        'controlled_verify_return' => '2',
        'controlled_verify_give' => '1',
        'controlled_verify_waste' => '2',
        'controlled_verify_sendback' => '2',
        'controlled_verify_destroy' => '2',
        'controlled_verify_correct' => '2',
        'controlled_verify_count' => '2',
        // A place or Team Member holding vials needs a count at least this often.
        'controlled_count_hours' => '24',
        // Assets (Equipment > Assets): track depreciation (straight line) or just purchase price and status.
        'assets_depreciation' => '0',
        // New assets get the next tag after this prefix (A00012) unless one is typed.
        'assets_tag_prefix' => 'A',
        // Maintenance (Equipment > Work Orders): a daily summary of what's due, overdue and open.
        'maint_slack_channel' => '',
        'maint_slack_channel_name' => '',
        'maint_alert_email' => '0',
        // Make a work order by itself when a maintenance plan comes due soon.
        'maint_auto_work_orders' => '1',
        // AI assistant (Admin > Reports > AI Assistant): the weekly operations summary, Mondays at 7 AM when on.
        'ai_weekly_slack_channel' => '',
        'ai_weekly_slack_channel_name' => '',
        'ai_weekly_email' => '0',
        'ai_weekly_enabled' => '0',
        // Our agency as the Virginia EMS provider search lists it (Admin > EMS Affiliations).
        'ems_our_agency' => 'FAST TRACK EMS, LLC',
        // Slack channel ID (and its name, for the page) for the daily EMS affiliation summary. Empty: email instead.
        'ems_slack_channel' => '',
        'ems_slack_channel_name' => '',
        'oig_slack_channel' => '',
        'oig_slack_channel_name' => '',
        'oig_list_updated_at' => '', // Last-Modified of the kept copy of the OIG list
        // Wellness module (App\Wellness). Turning it off hides the menu, pages and API.
        'wellness_enabled' => '1',
        'wellness_daily_max' => '8',
        'wellness_grace_days' => '3',
        // Points before this day are the soft-launch test period and don't count toward prizes.
        'wellness_official_start' => '2027-01-01',
        // While on, everyone may type steps, sleep and workout in by hand (testing, before wearables sync).
        'wellness_manual_device' => '1',
        // How far back a visit, InBody scan or weigh-in can be submitted, in days.
        'wellness_submit_days' => '60',
        'wellness_weekly_reward_cents' => '1000',
        'wellness_gift_brands' => "Amazon\nTarget\nWalmart\nStarbucks\nChick-fil-A\nVisa",
        // An InBody scan qualifies when, compared with the last approved scan at least this many days earlier,
        // body fat drops by at least the first number (percentage points) or skeletal muscle rises by the second (lb).
        'wellness_inbody_min_days' => '28',
        'wellness_inbody_fat_drop' => '1.0',
        'wellness_inbody_muscle_gain' => '1.0',
        // The iCloud link to the shared Apple Health Shortcut, shown on the Devices page.
        'wellness_shortcut_url' => '',
        // Inspections: the Slack channel new deficiencies post to, and the Team Members (ids, comma-separated) emailed about each.
        'inspection_slack_channel' => '',
        'inspection_slack_channel_name' => '',
        'inspection_notify_users' => '',
        // Remind whoever a due check is assigned to this many minutes before it's due (0 = no reminder),
        // and post overdue checks to the inspections Slack channel.
        'inspection_remind_minutes' => '30',
        'inspection_overdue_slack' => '1',
        // Service Desk: hours a ticket can sit untouched before it escalates, by priority (0 = never),
        // and days after a ticket is resolved that it closes on its own (0 = never).
        'service_desk_escalate_urgent' => '1',
        'service_desk_escalate_high' => '4',
        'service_desk_escalate_normal' => '24',
        'service_desk_escalate_low' => '72',
        'service_desk_close_days' => '7',
        // Trip Board (App\Trips). The GPS key and Samsara token are encrypted with APP_KEY; empty means off.
        'trips_gps_key' => '',
        'trips_epcr_key' => '', // encrypted; the ePCR's key for pulling trips
        'trips_samsara_token' => '',
        // Demo only: moves trucks whose GPS device id starts with SIM- around trips_sim_center.
        'trips_gps_simulator' => '0',
        'trips_sim_center' => '37.5407,-77.4360',
        // Patient pages sign out after this many idle minutes; GPS older than this shows as stale; trips this late flag red.
        'trips_idle_minutes' => '15',
        'trips_gps_stale_minutes' => '5',
        'trips_late_minutes' => '15',
        'scope_scene_types' => "House\nApartment with elevator\nApartment without elevator\nNursing facility\nAssisted living\nHospital\nDialysis center\nDoctor's office",
        'scope_destination_types' => "Hospital\nNursing facility\nAssisted living\nHouse\nApartment with elevator\nApartment without elevator\nDialysis center\nDoctor's office",
    ];

    public static function get(string $key): string
    {
        return static::find($key)?->value ?? self::DEFAULTS[$key];
    }

    public static function put(string $key, string $value): void
    {
        static::updateOrCreate(['key' => $key], ['value' => $value]);
    }
}
