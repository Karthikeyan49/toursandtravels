<?php
/**
 * Daily alert sweep.   Run from cron, once a day:
 *
 *   30 6 * * *  /usr/bin/php /path/to/api/cron/daily_alerts.php >> /path/to/alerts.log 2>&1
 *
 * Raises in-app notifications for the five things that cost a travel agency
 * money when they are missed:
 *
 *   1. a balance still outstanding inside the balance-due window
 *   2. a passport expiring too close to (or before) the return date
 *   3. a lead nobody has touched
 *   4. a departure inside three days
 *   5. vehicle paperwork expiring inside thirty days
 *
 * IDEMPOTENT. Every raise is preceded by a same-day lookup on
 * (kind, entity_type, entity_id), so running this twice — or a cron that fires
 * on every deploy — never doubles anyone's inbox.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "daily_alerts.php can only be run from the command line.\n";
    exit(1);
}

define('ROOT_PATH', dirname(__DIR__));

$config = require ROOT_PATH . '/config/app.php';

require_once ROOT_PATH . '/core/Response.php';
require_once ROOT_PATH . '/core/Config.php';
require_once ROOT_PATH . '/core/Database.php';
require_once ROOT_PATH . '/core/Request.php';
require_once ROOT_PATH . '/core/Model.php';
require_once ROOT_PATH . '/helpers/Money.php';
require_once ROOT_PATH . '/services/Audit.php';
require_once ROOT_PATH . '/services/Notifier.php';
require_once ROOT_PATH . '/models/Setting.php';
require_once ROOT_PATH . '/models/Lead.php';

Config::load($config);
Database::configure($config['db'] ?? []);
date_default_timezone_set($config['app']['timezone'] ?? 'Asia/Kolkata');

// ---------------------------------------------------------------------------

$counts = [
    'payment_due'          => 0,
    'doc_expiring'         => 0,
    'lead_idle'            => 0,
    'departure_soon'       => 0,
    'vehicle_doc_expiring' => 0,
    'skipped_duplicate'    => 0,
];

$startedAt = microtime(true);

out('daily_alerts ' . date('Y-m-d H:i:s'));
out(str_repeat('-', 60));

if (empty($config['db']['name'])) {
    fwrite(STDERR, 'DB_NAME is not set — is the .env file in place above the application root?' . PHP_EOL);
    exit(1);
}

try {
    Database::connection();
} catch (Throwable $e) {
    fwrite(STDERR, 'Database unavailable: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

balancesOutstanding($counts);
passportsExpiring($counts);
idleLeads($counts);
departuresSoon($counts);
vehicleDocumentsExpiring($counts);

out(str_repeat('-', 60));
foreach ($counts as $kind => $count) {
    out(sprintf('  %-22s %4d', $kind, $count));
}
out(sprintf('  %-22s %4.2fs', 'elapsed', microtime(true) - $startedAt));
out('');

exit(0);

// ---------------------------------------------------------------------------

/**
 * Has this exact alert already gone out today?
 *
 * Keyed on (kind, entity_type, entity_id) rather than on the message text, so a
 * changed wording or a changed outstanding amount does not re-notify.
 */
function alreadyRaisedToday(string $kind, string $entityType, int $entityId): bool
{
    return Database::scalar(
        'SELECT 1 FROM notifications
          WHERE kind = ? AND entity_type = ? AND entity_id = ? AND DATE(created_at) = CURDATE()
          LIMIT 1',
        [$kind, $entityType, $entityId]
    ) !== null;
}

/** 1. Balances still outstanding inside the balance-due window. */
function balancesOutstanding(array &$counts): void
{
    $dueDays = Setting::int('balance_due_days_before', 15);

    $rows = Database::fetchAll(
        "SELECT b.id, b.booking_no, b.travel_from,
                (b.grand_total - b.amount_paid) AS outstanding,
                DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure
           FROM bookings b
          WHERE b.status IN ('confirmed','vouchered','in_progress')
            AND b.grand_total - b.amount_paid > 0.005
            AND b.travel_from BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
          ORDER BY b.travel_from ASC",
        [$dueDays]
    );

    foreach ($rows as $row) {
        if (alreadyRaisedToday('payment_due', 'booking', (int) $row['id'])) {
            $counts['skipped_duplicate']++;
            continue;
        }

        Notifier::paymentOverdue(
            (int) $row['id'],
            Money::of($row['outstanding']),
            (int) $row['days_to_departure']
        );
        $counts['payment_due']++;
    }

    out(sprintf('  balances outstanding within %d days: %d booking(s)', $dueDays, count($rows)));
}

/** 2. Passports expiring before — or too soon after — the return date. */
function passportsExpiring(array &$counts): void
{
    $bufferDays = Setting::int('passport_expiry_alert_days', 180);

    $rows = Database::fetchAll(
        "SELECT bp.id AS pax_id, bp.booking_id, bp.first_name, bp.last_name,
                bp.passport_no, bp.passport_expiry,
                b.booking_no, b.travel_to,
                DATEDIFF(bp.passport_expiry, b.travel_to) AS days_after_travel
           FROM booking_pax bp
           JOIN bookings b ON b.id = bp.booking_id
          WHERE b.status IN ('confirmed','vouchered')
            AND b.travel_from >= CURDATE()
            AND bp.passport_expiry IS NOT NULL
            AND DATEDIFF(bp.passport_expiry, b.travel_to) < ?
          ORDER BY days_after_travel ASC",
        [$bufferDays]
    );

    // Grouped by booking: Notifier::documentExpiring keys its notification on the
    // booking, so one alert per booking per day is what the idempotency check can
    // actually enforce — and it is also what the visa desk wants to act on.
    $byBooking = [];
    foreach ($rows as $row) {
        $byBooking[(int) $row['booking_id']][] = $row;
    }

    foreach ($byBooking as $bookingId => $pax) {
        if (alreadyRaisedToday('doc_expiring', 'booking', $bookingId)) {
            $counts['skipped_duplicate']++;
            continue;
        }

        $lines = [];
        foreach ($pax as $p) {
            $name = trim($p['first_name'] . ' ' . (string) $p['last_name']);
            $days = (int) $p['days_after_travel'];
            $lines[] = $days < 0
                ? sprintf('%s: passport expires %s, BEFORE the return date of %s', $name, $p['passport_expiry'], $p['travel_to'])
                : sprintf('%s: passport valid only %d day(s) after travel (policy: %d)', $name, $days, $bufferDays);
        }

        $lead    = trim($pax[0]['first_name'] . ' ' . (string) $pax[0]['last_name']);
        $paxName = count($pax) > 1 ? $lead . ' +' . (count($pax) - 1) . ' more' : $lead;

        Notifier::documentExpiring(
            $bookingId,
            $paxName,
            $pax[0]['booking_no'] . ' — ' . implode(' | ', $lines)
        );

        $counts['doc_expiring']++;
    }

    out(sprintf(
        '  passports below %d days of post-travel validity: %d pax across %d booking(s)',
        $bufferDays, count($rows), count($byBooking)
    ));
}

/** 3. Leads with no follow-up inside the configured idle window. */
function idleLeads(array &$counts): void
{
    $idleHours = Setting::int('lead_idle_alert_hours', 48);
    $leads     = Lead::idle($idleHours, 200);

    foreach ($leads as $lead) {
        if (alreadyRaisedToday('lead_idle', 'lead', (int) $lead['id'])) {
            $counts['skipped_duplicate']++;
            continue;
        }

        Notifier::leadIdle($lead);
        $counts['lead_idle']++;
    }

    out(sprintf('  leads idle for %d+ hours: %d', $idleHours, count($leads)));
}

/** 4. Departures inside three days — the last chance to fix anything. */
function departuresSoon(array &$counts): void
{
    $rows = Database::fetchAll(
        "SELECT b.id, b.booking_no, DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure
           FROM bookings b
          WHERE b.status IN ('confirmed','vouchered')
            AND b.travel_from BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
          ORDER BY b.travel_from ASC"
    );

    foreach ($rows as $row) {
        if (alreadyRaisedToday('departure_soon', 'booking', (int) $row['id'])) {
            $counts['skipped_duplicate']++;
            continue;
        }

        Notifier::departureSoon(
            (int) $row['id'],
            (string) $row['booking_no'],
            (int) $row['days_to_departure']
        );
        $counts['departure_soon']++;
    }

    out(sprintf('  departures within 3 days: %d', count($rows)));
}

/** 5. Permit / insurance / fitness / PUC expiring inside thirty days. */
function vehicleDocumentsExpiring(array &$counts): void
{
    $rows = Database::fetchAll(
        "SELECT * FROM (
            SELECT v.id, v.registration_no, v.permit_expiry, v.insurance_expiry,
                   v.fitness_expiry, v.puc_expiry, vt.name AS vehicle_type_name,
                   LEAST(
                       COALESCE(DATEDIFF(v.permit_expiry,    CURDATE()), 9999),
                       COALESCE(DATEDIFF(v.insurance_expiry, CURDATE()), 9999),
                       COALESCE(DATEDIFF(v.fitness_expiry,   CURDATE()), 9999),
                       COALESCE(DATEDIFF(v.puc_expiry,       CURDATE()), 9999)
                   ) AS days_to_expiry
              FROM vehicles v
              JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
             WHERE v.is_deleted = 0 AND v.is_active = 1
         ) x
         WHERE x.days_to_expiry <= 30
         ORDER BY x.days_to_expiry ASC"
    );

    foreach ($rows as $row) {
        if (alreadyRaisedToday('vehicle_doc_expiring', 'vehicle', (int) $row['id'])) {
            $counts['skipped_duplicate']++;
            continue;
        }

        $days   = (int) $row['days_to_expiry'];
        $detail = [];
        foreach ([
            'permit_expiry'    => 'Permit',
            'insurance_expiry' => 'Insurance',
            'fitness_expiry'   => 'Fitness',
            'puc_expiry'       => 'PUC',
        ] as $column => $label) {
            if (empty($row[$column])) {
                continue;
            }
            $left = (int) floor((strtotime((string) $row[$column]) - strtotime('today')) / 86400);
            if ($left <= 30) {
                $detail[] = sprintf('%s %s (%s)', $label, $row[$column], $left < 0 ? 'expired' : $left . 'd');
            }
        }

        Notifier::push(
            'vehicle_doc_expiring',
            $row['registration_no'] . ' — paperwork ' . ($days < 0 ? 'expired' : 'expires in ' . $days . ' day(s)'),
            implode(' · ', $detail),
            null,
            'operations',
            'vehicle',
            (int) $row['id'],
            $days < 0 ? 'critical' : 'warning'
        );

        $counts['vehicle_doc_expiring']++;
    }

    out(sprintf('  vehicles with paperwork due inside 30 days: %d', count($rows)));
}

function out(string $text): void
{
    fwrite(STDOUT, $text . PHP_EOL);
}
