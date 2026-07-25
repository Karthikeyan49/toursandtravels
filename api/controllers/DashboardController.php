<?php
/**
 * The home screen.
 *
 * GET /dashboard/overview deliberately answers the whole page in ONE request:
 * a dashboard that fires fourteen calls is a dashboard that is slow on the shared
 * hosting this deploys to, and half-loaded on a phone in a hotel lobby.
 *
 * Cost and margin figures are stripped for roles that must not see buying prices.
 */
class DashboardController extends Controller
{
    /** Roles allowed to see cost, margin and profitability. */
    private const COST_ROLES = ['owner', 'manager', 'accounts'];

    /** GET /dashboard/overview */
    public function overview(): void
    {
        $this->run(function () {
            $today      = date('Y-m-d');
            $monthStart = date('Y-m-01');
            $monthEnd   = date('Y-m-t');
            $canSeeCost = $this->canSeeCost();

            $payload = [
                'as_of'       => date('Y-m-d H:i:s'),
                'today'       => $this->todayBlock($today),
                'this_month'  => $this->monthBlock($monthStart, $monthEnd),
                'leads'       => $this->leadBlock($monthStart, $monthEnd),
                'money'       => $this->moneyBlock(),
                'upcoming'    => $this->upcomingDepartures(14),
                'top_destinations' => $this->topDestinations(6),
                'revenue_trend'    => $this->revenueTrend(12),
                'open_incidents'   => $this->openIncidents(),
                'alerts'           => $this->alerts(),
            ];

            if (!$canSeeCost) {
                $payload = $this->stripCosts($payload);
            }
            $payload['cost_visible'] = $canSeeCost;

            Response::success($payload);
        });
    }

    /** GET /dashboard/sales-funnel */
    public function salesFunnel(): void
    {
        $this->run(function () {
            $from = (string) Request::query('from', date('Y-m-01', strtotime('-5 months')));
            $to   = (string) Request::query('to', date('Y-m-d'));

            $pipeline = Lead::pipeline([
                'from'        => $from,
                'to'          => $to,
                'assigned_to' => Request::queryInt('assigned_to') ?: null,
            ]);

            $byStatus = [];
            foreach ($pipeline as $row) {
                $byStatus[$row['status']] = $row;
            }

            $totalLeads = (int) array_sum(array_column($pipeline, 'lead_count'));
            $quoted     = (int) Database::scalar(
                'SELECT COUNT(DISTINCT l.id) FROM leads l
                   JOIN quotations q ON q.lead_id = l.id
                  WHERE DATE(l.created_at) BETWEEN ? AND ?',
                [$from, $to]
            );
            $won = (int) ($byStatus['won']['lead_count'] ?? 0);

            $bookings = Database::fetch(
                "SELECT COUNT(*) AS booking_count, COALESCE(SUM(grand_total), 0) AS booking_value
                   FROM bookings
                  WHERE booking_date BETWEEN ? AND ? AND status NOT IN ('cancelled','draft')",
                [$from, $to]
            );

            $quotes = Database::fetchAll(
                "SELECT status, COUNT(*) AS quote_count, COALESCE(SUM(grand_total), 0) AS quote_value
                   FROM quotations WHERE quote_date BETWEEN ? AND ?
                  GROUP BY status",
                [$from, $to]
            );

            // The four headline numbers the client asks for by name, derived from
            // the quote breakdown already fetched above rather than a second query.
            $quotesDispatched = 0;
            $pendingResponse  = 0;
            foreach ($quotes as $qRow) {
                $count = (int) $qRow['quote_count'];
                if ($qRow['status'] !== 'draft') {
                    $quotesDispatched += $count;
                }
                if (in_array($qRow['status'], ['sent', 'viewed'], true)) {
                    $pendingResponse += $count;
                }
            }

            $stages = [
                ['stage' => 'Enquiries',  'count' => $totalLeads,                                  'value' => Money::sum(array_column($pipeline, 'potential_value'))],
                ['stage' => 'Contacted',  'count' => $totalLeads - (int) ($byStatus['new']['lead_count'] ?? 0), 'value' => null],
                ['stage' => 'Quoted',     'count' => $quoted,                                      'value' => Money::sum(array_column($quotes, 'quote_value'))],
                ['stage' => 'Won',        'count' => $won,                                         'value' => null],
                ['stage' => 'Booked',     'count' => (int) $bookings['booking_count'],             'value' => Money::of($bookings['booking_value'])],
            ];

            // Stage-to-stage conversion is what tells a sales manager where the
            // pipeline actually leaks; a single overall rate hides it.
            foreach ($stages as $i => &$stage) {
                $previous = $i === 0 ? $stage['count'] : $stages[$i - 1]['count'];
                $stage['conversion_from_previous_pct'] = $previous > 0 ? round($stage['count'] / $previous * 100, 2) : 0.0;
                $stage['conversion_from_top_pct']      = $totalLeads > 0 ? round($stage['count'] / $totalLeads * 100, 2) : 0.0;
            }
            unset($stage);

            Response::success([
                'period'    => ['from' => $from, 'to' => $to],
                'summary'   => [
                    'total_inquiries'         => $totalLeads,
                    'total_quotes_dispatched' => $quotesDispatched,
                    'pending_response'        => $pendingResponse,
                    'conversions'             => $won,
                ],
                'stages'    => $stages,
                'pipeline'  => $pipeline,
                'quotations'=> $quotes,
                'by_source' => Database::fetchAll(
                    "SELECT COALESCE(ls.name, 'Unknown') AS source, COUNT(l.id) AS lead_count,
                            SUM(l.status = 'won') AS won_count,
                            ROUND(SUM(l.status = 'won') / NULLIF(COUNT(l.id), 0) * 100, 2) AS win_rate_pct
                       FROM leads l
                       LEFT JOIN lead_sources ls ON ls.id = l.source_id
                      WHERE DATE(l.created_at) BETWEEN ? AND ?
                      GROUP BY ls.name
                      ORDER BY lead_count DESC",
                    [$from, $to]
                ),
                'by_owner' => Database::fetchAll(
                    "SELECT COALESCE(u.full_name, 'Unassigned') AS owner, COUNT(l.id) AS lead_count,
                            SUM(l.status = 'won') AS won_count,
                            ROUND(SUM(l.status = 'won') / NULLIF(COUNT(l.id), 0) * 100, 2) AS win_rate_pct
                       FROM leads l
                       LEFT JOIN users u ON u.id = l.assigned_to
                      WHERE DATE(l.created_at) BETWEEN ? AND ?
                      GROUP BY u.full_name
                      ORDER BY won_count DESC, lead_count DESC",
                    [$from, $to]
                ),
            ]);
        });
    }

    /** GET /dashboard/my-work — what the signed-in user has to do today. */
    public function myWork(): void
    {
        $this->run(function () {
            $userId = Request::userId();
            if ($userId === null) {
                Response::unauthorized();
                return;
            }

            $myLeadsDue = Database::fetchAll(
                "SELECT l.id, l.lead_no, l.contact_name, l.phone, l.status, l.priority,
                        l.next_followup_at, l.travel_date, d.name AS destination_name,
                        TIMESTAMPDIFF(HOUR, l.next_followup_at, NOW()) AS hours_overdue
                   FROM leads l
                   LEFT JOIN destinations d ON d.id = l.destination_id
                  WHERE l.assigned_to = ?
                    AND l.status NOT IN ('won','lost','dropped')
                    AND l.next_followup_at IS NOT NULL
                    AND l.next_followup_at <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
                  ORDER BY l.next_followup_at ASC
                  LIMIT 50",
                [$userId]
            );

            $myBookings = Database::fetchAll(
                "SELECT b.id, b.booking_no, b.travel_from, b.travel_to, b.status, b.payment_status,
                        b.adults, b.children, (b.grand_total - b.amount_paid) AS outstanding,
                        DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure,
                        c.full_name AS customer_name, c.phone AS customer_phone,
                        d.name AS destination_name
                   FROM bookings b
                   LEFT JOIN customers    c ON c.id = b.customer_id
                   LEFT JOIN destinations d ON d.id = b.destination_id
                  WHERE (b.owner_id = ? OR b.ops_owner_id = ?)
                    AND b.status NOT IN ('cancelled','completed')
                    AND b.travel_from BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                  ORDER BY b.travel_from ASC
                  LIMIT 50",
                [$userId, $userId]
            );

            $myDraftQuotes = Database::fetchAll(
                "SELECT q.id, q.quote_no, q.version, q.title, q.quote_date, q.valid_until,
                        q.grand_total, q.status, c.full_name AS customer_name,
                        DATEDIFF(q.valid_until, CURDATE()) AS days_to_expiry
                   FROM quotations q
                   LEFT JOIN customers c ON c.id = q.customer_id
                  WHERE (q.owner_id = ? OR q.created_by = ?)
                    AND q.status IN ('draft','revised','sent','viewed')
                  ORDER BY FIELD(q.status,'draft','revised','viewed','sent'), q.quote_date DESC
                  LIMIT 50",
                [$userId, $userId]
            );

            $myDaysheets = Database::fetchAll(
                "SELECT ds.id, ds.booking_id, ds.sheet_date, ds.day_no, ds.status, ds.summary,
                        b.booking_no, b.lead_pax_name, b.contact_phone
                   FROM ops_daysheets ds
                   JOIN bookings b ON b.id = ds.booking_id
                  WHERE ds.owner_id = ? AND ds.sheet_date = CURDATE()
                    AND b.status NOT IN ('cancelled','draft')
                  ORDER BY b.booking_no ASC",
                [$userId]
            );

            Response::success([
                'leads_due_today'      => $myLeadsDue,
                'bookings_this_week'   => $myBookings,
                'open_quotations'      => $myDraftQuotes,
                'daysheets_today'      => $myDaysheets,
                'unread_notifications' => (int) Database::scalar(
                    'SELECT COUNT(*) FROM notifications
                      WHERE (user_id = ? OR (user_id IS NULL AND role_scope = ?)) AND read_at IS NULL',
                    [$userId, Request::staffRole()]
                ),
                'counts' => [
                    'leads_due_today'    => count($myLeadsDue),
                    'bookings_this_week' => count($myBookings),
                    'open_quotations'    => count($myDraftQuotes),
                    'daysheets_today'    => count($myDaysheets),
                ],
            ]);
        });
    }

    // -----------------------------------------------------------------------

    private function todayBlock(string $today): array
    {
        $departures = Database::fetchAll(
            "SELECT b.id, b.booking_no, b.lead_pax_name, b.contact_phone, b.adults, b.children,
                    b.travel_from, b.travel_to, b.payment_status,
                    (b.grand_total - b.amount_paid) AS outstanding,
                    c.full_name AS customer_name, d.name AS destination_name
               FROM bookings b
               LEFT JOIN customers    c ON c.id = b.customer_id
               LEFT JOIN destinations d ON d.id = b.destination_id
              WHERE b.travel_from = ? AND b.status NOT IN ('cancelled','draft')
              ORDER BY b.booking_no ASC",
            [$today]
        );

        $arrivals = Database::fetchAll(
            "SELECT b.id, b.booking_no, b.lead_pax_name, b.contact_phone, b.adults, b.children,
                    b.travel_from, b.travel_to,
                    c.full_name AS customer_name, d.name AS destination_name
               FROM bookings b
               LEFT JOIN customers    c ON c.id = b.customer_id
               LEFT JOIN destinations d ON d.id = b.destination_id
              WHERE b.travel_to = ? AND b.status NOT IN ('cancelled','draft')
              ORDER BY b.booking_no ASC",
            [$today]
        );

        $onRoad = Database::fetch(
            "SELECT COUNT(*) AS booking_count,
                    COALESCE(SUM(adults + children), 0) AS pax,
                    COALESCE(SUM(infants), 0) AS infants
               FROM bookings
              WHERE ? BETWEEN travel_from AND travel_to AND status NOT IN ('cancelled','draft')",
            [$today]
        );

        return [
            'date'                  => $today,
            'departures'            => $departures,
            'arrivals'              => $arrivals,
            'departure_count'       => count($departures),
            'arrival_count'         => count($arrivals),
            'bookings_on_road'      => (int) $onRoad['booking_count'],
            'pax_on_road'           => (int) $onRoad['pax'],
            'infants_on_road'       => (int) $onRoad['infants'],
            'collections_today'     => Money::of(Database::scalar(
                "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
                   FROM payments WHERE paid_on = ? AND status = 'paid'",
                [$today]
            )),
            'daysheets_with_issues' => (int) Database::scalar(
                "SELECT COUNT(*) FROM ops_daysheets WHERE sheet_date = ? AND status = 'issue'",
                [$today]
            ),
        ];
    }

    private function monthBlock(string $from, string $to): array
    {
        $booked = Database::fetch(
            "SELECT COUNT(*) AS booking_count,
                    COALESCE(SUM(grand_total), 0) AS booking_value,
                    COALESCE(SUM(cost_total), 0)  AS cost_total,
                    COALESCE(SUM(adults + children), 0) AS pax
               FROM bookings
              WHERE booking_date BETWEEN ? AND ? AND status NOT IN ('cancelled','draft')",
            [$from, $to]
        );

        $cancelled = Database::fetch(
            "SELECT COUNT(*) AS booking_count, COALESCE(SUM(grand_total), 0) AS booking_value
               FROM bookings
              WHERE booking_date BETWEEN ? AND ? AND status = 'cancelled'",
            [$from, $to]
        );

        $lastMonthFrom = date('Y-m-01', strtotime($from . ' -1 month'));
        $lastMonthTo   = date('Y-m-t', strtotime($from . ' -1 month'));
        $lastMonth     = (float) Database::scalar(
            "SELECT COALESCE(SUM(grand_total), 0) FROM bookings
              WHERE booking_date BETWEEN ? AND ? AND status NOT IN ('cancelled','draft')",
            [$lastMonthFrom, $lastMonthTo]
        );

        $value  = Money::of($booked['booking_value']);
        $margin = Money::of($value - (float) $booked['cost_total']);

        return [
            'from'             => $from,
            'to'               => $to,
            'booking_count'    => (int) $booked['booking_count'],
            'booking_value'    => $value,
            'pax'              => (int) $booked['pax'],
            'estimated_cost'   => Money::of($booked['cost_total']),
            'estimated_margin' => $margin,
            'margin_pct'       => $value > 0 ? round($margin / $value * 100, 2) : 0.0,
            'cancelled_count'  => (int) $cancelled['booking_count'],
            'cancelled_value'  => Money::of($cancelled['booking_value']),
            'collections'      => Money::of(Database::scalar(
                "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
                   FROM payments WHERE paid_on BETWEEN ? AND ? AND status = 'paid'",
                [$from, $to]
            )),
            'vs_last_month_pct' => $lastMonth > 0 ? round(($value - $lastMonth) / $lastMonth * 100, 2) : null,
        ];
    }

    private function leadBlock(string $from, string $to): array
    {
        $byStatus = Database::fetchAll(
            'SELECT status, COUNT(*) AS lead_count, COALESCE(SUM(budget_max), 0) AS potential_value
               FROM leads WHERE DATE(created_at) BETWEEN ? AND ?
              GROUP BY status',
            [$from, $to]
        );

        $counts = [];
        foreach ($byStatus as $row) {
            $counts[$row['status']] = (int) $row['lead_count'];
        }
        $total = array_sum($counts);
        $won   = $counts['won'] ?? 0;

        return [
            'by_status'          => $byStatus,
            'total'              => $total,
            'won'                => $won,
            'open'               => $total - $won - ($counts['lost'] ?? 0) - ($counts['dropped'] ?? 0),
            'conversion_rate_pct'=> $total > 0 ? round($won / $total * 100, 2) : 0.0,
            'overdue_followups'  => (int) Database::scalar(
                "SELECT COUNT(*) FROM leads
                  WHERE next_followup_at IS NOT NULL AND next_followup_at < NOW()
                    AND status NOT IN ('won','lost','dropped')"
            ),
            'unassigned'         => (int) Database::scalar(
                "SELECT COUNT(*) FROM leads WHERE assigned_to IS NULL AND status NOT IN ('won','lost','dropped')"
            ),
        ];
    }

    private function moneyBlock(): array
    {
        $receivable = Database::fetch(
            "SELECT COALESCE(SUM(grand_total - amount_paid), 0) AS outstanding,
                    COUNT(*) AS booking_count,
                    COALESCE(SUM(CASE WHEN travel_from <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                                      THEN grand_total - amount_paid ELSE 0 END), 0) AS due_before_departure
               FROM bookings
              WHERE status NOT IN ('cancelled','draft') AND grand_total - amount_paid > 0.005"
        );

        $payable = Database::fetch(
            "SELECT COALESCE(SUM(grand_total - amount_paid), 0) AS outstanding,
                    COUNT(*) AS bill_count,
                    COALESCE(SUM(CASE WHEN due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                                      THEN grand_total - amount_paid ELSE 0 END), 0) AS due_this_week,
                    COALESCE(SUM(CASE WHEN due_date < CURDATE()
                                      THEN grand_total - amount_paid ELSE 0 END), 0) AS overdue
               FROM supplier_bills
              WHERE status NOT IN ('void','cancelled') AND grand_total - amount_paid > 0.005"
        );

        return [
            'receivable' => [
                'outstanding'          => Money::of($receivable['outstanding']),
                'booking_count'        => (int) $receivable['booking_count'],
                'due_before_departure' => Money::of($receivable['due_before_departure']),
            ],
            'payable' => [
                'outstanding'   => Money::of($payable['outstanding']),
                'bill_count'    => (int) $payable['bill_count'],
                'due_this_week' => Money::of($payable['due_this_week']),
                'overdue'       => Money::of($payable['overdue']),
            ],
            'unapproved_expenses' => Money::of(Database::scalar(
                "SELECT COALESCE(SUM(total_amount), 0) FROM expenses WHERE status IN ('draft','submitted')"
            )),
        ];
    }

    private function upcomingDepartures(int $days): array
    {
        return Database::fetchAll(
            "SELECT b.id, b.booking_no, b.travel_from, b.travel_to, b.status, b.payment_status,
                    b.adults, b.children, b.infants, b.lead_pax_name,
                    (b.grand_total - b.amount_paid) AS outstanding,
                    DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure,
                    c.full_name AS customer_name, c.phone AS customer_phone,
                    d.name AS destination_name, p.name AS package_name,
                    (SELECT COUNT(*) FROM booking_services bs
                      WHERE bs.booking_id = b.id
                        AND bs.supplier_status IN ('pending','requested','waitlisted')) AS unconfirmed_services
               FROM bookings b
               LEFT JOIN customers    c ON c.id = b.customer_id
               LEFT JOIN destinations d ON d.id = b.destination_id
               LEFT JOIN packages     p ON p.id = b.package_id
              WHERE b.status IN ('confirmed','vouchered')
                AND b.travel_from BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
              ORDER BY b.travel_from ASC, b.booking_no ASC
              LIMIT 100",
            [$days]
        );
    }

    private function topDestinations(int $months): array
    {
        return Database::fetchAll(
            "SELECT d.id, d.name AS destination_name, d.scope,
                    COUNT(b.id) AS booking_count,
                    COALESCE(SUM(b.adults + b.children), 0) AS pax,
                    COALESCE(SUM(b.grand_total), 0) AS revenue,
                    COALESCE(SUM(b.grand_total - b.cost_total), 0) AS estimated_margin
               FROM bookings b
               JOIN destinations d ON d.id = b.destination_id
              WHERE b.status NOT IN ('cancelled','draft')
                AND b.booking_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
              GROUP BY d.id, d.name, d.scope
              ORDER BY revenue DESC
              LIMIT 10",
            [$months]
        );
    }

    /** 12 rolling months, zero-filled so a chart never has gaps. */
    private function revenueTrend(int $months): array
    {
        $rows = Database::fetchAll(
            "SELECT DATE_FORMAT(booking_date, '%Y-%m') AS period,
                    COUNT(*) AS booking_count,
                    COALESCE(SUM(grand_total), 0) AS revenue,
                    COALESCE(SUM(cost_total), 0)  AS cost,
                    COALESCE(SUM(adults + children), 0) AS pax
               FROM bookings
              WHERE status NOT IN ('cancelled','draft')
                AND booking_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? MONTH), '%Y-%m-01')
              GROUP BY period",
            [$months - 1]
        );

        $indexed = [];
        foreach ($rows as $row) {
            $indexed[$row['period']] = $row;
        }

        $trend = [];
        for ($i = $months - 1; $i >= 0; $i--) {
            $period = date('Y-m', strtotime("-$i months"));
            $row    = $indexed[$period] ?? null;
            $revenue = Money::of($row['revenue'] ?? 0);
            $cost    = Money::of($row['cost'] ?? 0);

            $trend[] = [
                'period'        => $period,
                'label'         => date('M Y', strtotime($period . '-01')),
                'booking_count' => (int) ($row['booking_count'] ?? 0),
                'pax'           => (int) ($row['pax'] ?? 0),
                'revenue'       => $revenue,
                'cost'          => $cost,
                'margin'        => Money::of($revenue - $cost),
            ];
        }

        return $trend;
    }

    private function openIncidents(): array
    {
        return Database::fetchAll(
            "SELECT ti.id, ti.booking_id, ti.incident_date, ti.category, ti.severity, ti.title,
                    ti.status, ti.cost_impact,
                    b.booking_no, s.name AS supplier_name, a.full_name AS assigned_to_name
               FROM trip_incidents ti
               JOIN bookings b       ON b.id = ti.booking_id
               LEFT JOIN suppliers s ON s.id = ti.supplier_id
               LEFT JOIN users     a ON a.id = ti.assigned_to
              WHERE ti.status IN ('open','investigating')
              ORDER BY FIELD(ti.severity,'critical','high','medium','low'), ti.incident_date DESC
              LIMIT 20"
        );
    }

    /**
     * The four things that actually go wrong in a travel agency, in one list:
     * unpaid balances close to departure, expiring passports, cold leads and
     * lapsed vehicle paperwork.
     */
    private function alerts(): array
    {
        $balanceDueDays = Setting::int('balance_due_days_before', 15);
        $passportDays   = Setting::int('passport_expiry_alert_days', 180);
        $idleHours      = Setting::int('lead_idle_alert_hours', 48);

        $alerts = [];

        foreach (Database::fetchAll(
            "SELECT b.id, b.booking_no, b.travel_from, (b.grand_total - b.amount_paid) AS outstanding,
                    DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure,
                    c.full_name AS customer_name, c.phone AS customer_phone
               FROM bookings b
               LEFT JOIN customers c ON c.id = b.customer_id
              WHERE b.status IN ('confirmed','vouchered','in_progress')
                AND b.grand_total - b.amount_paid > 0.005
                AND b.travel_from BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
              ORDER BY b.travel_from ASC
              LIMIT 25",
            [$balanceDueDays]
        ) as $row) {
            $alerts[] = [
                'kind'        => 'payment_due',
                'severity'    => (int) $row['days_to_departure'] <= 3 ? 'critical' : 'warning',
                'title'       => number_format((float) $row['outstanding'], 2) . ' outstanding on ' . $row['booking_no'],
                'detail'      => ($row['customer_name'] ?? '') . ' departs in ' . (int) $row['days_to_departure'] . ' day(s)',
                'entity_type' => 'booking',
                'entity_id'   => (int) $row['id'],
            ];
        }

        foreach (Database::fetchAll(
            "SELECT bp.id, bp.booking_id, bp.first_name, bp.last_name, bp.passport_no, bp.passport_expiry,
                    b.booking_no, b.travel_to,
                    DATEDIFF(bp.passport_expiry, b.travel_to) AS days_after_travel
               FROM booking_pax bp
               JOIN bookings b ON b.id = bp.booking_id
              WHERE b.status IN ('confirmed','vouchered')
                AND b.travel_from >= CURDATE()
                AND bp.passport_expiry IS NOT NULL
                AND DATEDIFF(bp.passport_expiry, b.travel_to) < ?
              ORDER BY days_after_travel ASC
              LIMIT 25",
            [$passportDays]
        ) as $row) {
            $paxName = trim($row['first_name'] . ' ' . (string) $row['last_name']);
            $days    = (int) $row['days_after_travel'];
            $alerts[] = [
                'kind'        => 'doc_expiring',
                'severity'    => $days < 0 ? 'critical' : 'warning',
                'title'       => $paxName . ' — passport ' . ($days < 0 ? 'expires before return' : 'valid only ' . $days . ' days after travel'),
                'detail'      => $row['booking_no'] . ' · expires ' . $row['passport_expiry'],
                'entity_type' => 'booking',
                'entity_id'   => (int) $row['booking_id'],
            ];
        }

        foreach (Lead::idle($idleHours, 15) as $row) {
            $alerts[] = [
                'kind'        => 'lead_idle',
                'severity'    => 'warning',
                'title'       => 'No follow-up on ' . $row['lead_no'] . ' for ' . (int) $row['idle_hours'] . 'h',
                'detail'      => $row['contact_name'] . ' · ' . $row['phone']
                                 . ($row['assigned_to_name'] ? ' · ' . $row['assigned_to_name'] : ' · unassigned'),
                'entity_type' => 'lead',
                'entity_id'   => (int) $row['id'],
            ];
        }

        foreach (Database::fetchAll(
            "SELECT * FROM (
                SELECT v.id, v.registration_no, vt.name AS vehicle_type_name,
                       v.permit_expiry, v.insurance_expiry, v.fitness_expiry, v.puc_expiry,
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
              ORDER BY x.days_to_expiry ASC
              LIMIT 15"
        ) as $row) {
            $alerts[] = [
                'kind'        => 'vehicle_doc_expiring',
                'severity'    => (int) $row['days_to_expiry'] < 0 ? 'critical' : 'warning',
                'title'       => $row['registration_no'] . ' — paperwork '
                                 . ((int) $row['days_to_expiry'] < 0 ? 'expired' : 'expires in ' . (int) $row['days_to_expiry'] . ' day(s)'),
                'detail'      => $this->vehicleExpiryDetail($row),
                'entity_type' => 'vehicle',
                'entity_id'   => (int) $row['id'],
            ];
        }

        // Critical first; within a severity keep the query order.
        usort($alerts, static function ($a, $b) {
            $rank = ['critical' => 0, 'warning' => 1, 'info' => 2];
            return ($rank[$a['severity']] ?? 3) <=> ($rank[$b['severity']] ?? 3);
        });

        return $alerts;
    }

    private function vehicleExpiryDetail(array $vehicle): string
    {
        $parts = [];
        foreach (['permit_expiry' => 'Permit', 'insurance_expiry' => 'Insurance',
                  'fitness_expiry' => 'Fitness', 'puc_expiry' => 'PUC'] as $col => $label) {
            if (!empty($vehicle[$col])) {
                $parts[] = $label . ' ' . $vehicle[$col];
            }
        }
        return implode(' · ', $parts);
    }

    private function canSeeCost(): bool
    {
        return in_array(Request::staffRole(), self::COST_ROLES, true);
    }

    /** Remove every buying-price and profitability field from the payload. */
    private function stripCosts(array $payload): array
    {
        unset(
            $payload['this_month']['estimated_cost'],
            $payload['this_month']['estimated_margin'],
            $payload['this_month']['margin_pct'],
            $payload['money']['payable'],
            $payload['money']['unapproved_expenses']
        );

        foreach ($payload['top_destinations'] as &$d) {
            unset($d['estimated_margin']);
        }
        unset($d);

        foreach ($payload['revenue_trend'] as &$t) {
            unset($t['cost'], $t['margin']);
        }
        unset($t);

        foreach ($payload['open_incidents'] as &$i) {
            unset($i['cost_impact']);
        }
        unset($i);

        return $payload;
    }
}
