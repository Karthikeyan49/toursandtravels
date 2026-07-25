<?php
/**
 * Operational and financial reports.
 *
 * Every report accepts `?format=csv` (or `json`) and streams the same rows it
 * would otherwise return in the JSON envelope, so the screen and the download can
 * never disagree. Exports go through Exporter, which neutralises formula
 * injection — a customer name beginning with `=` must not become a formula in
 * the accountant's spreadsheet.
 */
class ReportController extends Controller
{
    /** Dimensions the sales report can be grouped by → [SQL expression, join]. */
    private const SALES_DIMENSIONS = [
        'period'      => ["DATE_FORMAT(b.booking_date, '%Y-%m')", 'Period'],
        'travel_month'=> ["DATE_FORMAT(b.travel_from, '%Y-%m')",  'Travel month'],
        'destination' => ['COALESCE(d.name, \'Unassigned\')',     'Destination'],
        'package'     => ['COALESCE(p.name, \'Custom\')',         'Package'],
        'staff'       => ['COALESCE(u.full_name, \'Unassigned\')','Sales owner'],
        'source'      => ['COALESCE(ls.name, \'Direct\')',        'Lead source'],
        'agency'      => ['COALESCE(a.name, \'Direct\')',         'Agency'],
        'booking_type'=> ['b.booking_type',                       'Booking type'],
    ];

    /** GET /reports/sales?from=&to=&group_by=&destination_id=&format= */
    public function sales(): void
    {
        $this->run(function () {
            [$from, $to] = $this->period(date('Y-m-01', strtotime('-5 months')));

            $groupBy = (string) Request::query('group_by', 'period');
            if (!isset(self::SALES_DIMENSIONS[$groupBy])) {
                throw new ValidationException(['group_by' => [
                    'group_by must be one of: ' . implode(', ', array_keys(self::SALES_DIMENSIONS)),
                ]]);
            }
            // Resolved from a constant map — never interpolated from raw input.
            [$expression, $label] = self::SALES_DIMENSIONS[$groupBy];

            $dateColumn = Request::query('date_basis') === 'travel' ? 'b.travel_from' : 'b.booking_date';
            $dateColumn = in_array($dateColumn, ['b.travel_from', 'b.booking_date'], true) ? $dateColumn : 'b.booking_date';

            $clauses = ["b.status NOT IN ('cancelled','draft')", "$dateColumn BETWEEN ? AND ?"];
            $params  = [$from, $to];

            if ($destinationId = Request::queryInt('destination_id')) {
                $clauses[] = 'b.destination_id = ?';
                $params[]  = $destinationId;
            }
            if ($packageId = Request::queryInt('package_id')) {
                $clauses[] = 'b.package_id = ?';
                $params[]  = $packageId;
            }
            if ($ownerId = Request::queryInt('owner_id')) {
                $clauses[] = 'b.owner_id = ?';
                $params[]  = $ownerId;
            }

            $where = implode(' AND ', $clauses);

            $rows = Database::fetchAll(
                "SELECT $expression AS dimension,
                        COUNT(*) AS booking_count,
                        COALESCE(SUM(b.adults + b.children), 0) AS pax,
                        COALESCE(SUM(b.subtotal), 0)        AS subtotal,
                        COALESCE(SUM(b.discount_amount), 0) AS discount,
                        COALESCE(SUM(b.taxable_amount), 0)  AS net_revenue,
                        COALESCE(SUM(b.gst_amount), 0)      AS gst,
                        COALESCE(SUM(b.grand_total), 0)     AS gross_revenue,
                        COALESCE(SUM(b.cost_total), 0)      AS estimated_cost,
                        COALESCE(SUM(b.amount_paid), 0)     AS collected,
                        COALESCE(SUM(b.grand_total - b.amount_paid), 0) AS outstanding
                   FROM bookings b
                   LEFT JOIN destinations  d  ON d.id  = b.destination_id
                   LEFT JOIN packages      p  ON p.id  = b.package_id
                   LEFT JOIN users         u  ON u.id  = b.owner_id
                   LEFT JOIN agencies      a  ON a.id  = b.agency_id
                   LEFT JOIN leads         l  ON l.id  = b.lead_id
                   LEFT JOIN lead_sources  ls ON ls.id = l.source_id
                  WHERE $where
                  GROUP BY dimension
                  ORDER BY gross_revenue DESC",
                $params
            );

            foreach ($rows as &$row) {
                $revenue = Money::of($row['net_revenue']);
                $cost    = Money::of($row['estimated_cost']);
                $row['margin']      = Money::of($revenue - $cost);
                $row['margin_pct']  = $revenue > 0 ? round($row['margin'] / $revenue * 100, 2) : 0.0;
                $row['avg_booking'] = (int) $row['booking_count'] > 0
                    ? Money::of($row['gross_revenue'] / (int) $row['booking_count']) : 0.0;
                $row['revenue_per_pax'] = (int) $row['pax'] > 0
                    ? Money::of($row['gross_revenue'] / (int) $row['pax']) : 0.0;
            }
            unset($row);

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'dimension'       => $label,
                'booking_count'   => 'Bookings',
                'pax'             => 'Pax',
                'gross_revenue'   => 'Gross Revenue',
                'discount'        => 'Discount',
                'net_revenue'     => 'Net Revenue',
                'gst'             => 'GST',
                'estimated_cost'  => 'Estimated Cost',
                'margin'          => 'Margin',
                'margin_pct'      => 'Margin %',
                'collected'       => 'Collected',
                'outstanding'     => 'Outstanding',
                'avg_booking'     => 'Avg Booking',
                'revenue_per_pax' => 'Revenue / Pax',
            ], 'sales-report-' . $groupBy)) {
                return;
            }

            Response::success([
                'period'     => ['from' => $from, 'to' => $to, 'basis' => $dateColumn === 'b.travel_from' ? 'travel' : 'booking'],
                'group_by'   => $groupBy,
                'dimension_label' => $label,
                'rows'       => $rows,
                'totals'     => [
                    'booking_count'  => (int) array_sum(array_column($rows, 'booking_count')),
                    'pax'            => (int) array_sum(array_column($rows, 'pax')),
                    'gross_revenue'  => Money::sum(array_column($rows, 'gross_revenue')),
                    'net_revenue'    => Money::sum(array_column($rows, 'net_revenue')),
                    'estimated_cost' => Money::sum(array_column($rows, 'estimated_cost')),
                    'margin'         => Money::sum(array_column($rows, 'margin')),
                    'collected'      => Money::sum(array_column($rows, 'collected')),
                    'outstanding'    => Money::sum(array_column($rows, 'outstanding')),
                ],
            ]);
        });
    }

    /**
     * GET /reports/margin?from=&to=&loss_making=1&format=
     * Per-booking P&L. Actual cost is what has actually been billed by suppliers;
     * where nothing is billed yet the estimate stands in, and is_estimated says so
     * — otherwise every unbilled booking would appear to be 100% margin.
     */
    public function margin(): void
    {
        $this->run(function () {
            [$from, $to] = $this->period(date('Y-m-01', strtotime('-2 months')));

            $clauses = ["b.status NOT IN ('cancelled','draft')", 'b.travel_from BETWEEN ? AND ?'];
            $params  = [$from, $to];

            if ($destinationId = Request::queryInt('destination_id')) {
                $clauses[] = 'b.destination_id = ?';
                $params[]  = $destinationId;
            }
            if ($packageId = Request::queryInt('package_id')) {
                $clauses[] = 'b.package_id = ?';
                $params[]  = $packageId;
            }
            if ($ownerId = Request::queryInt('owner_id')) {
                $clauses[] = 'b.owner_id = ?';
                $params[]  = $ownerId;
            }

            $where = implode(' AND ', $clauses);

            $rows = Database::fetchAll(
                "SELECT b.id, b.booking_no, b.booking_date, b.travel_from, b.travel_to,
                        b.adults, b.children, b.status,
                        b.taxable_amount AS revenue, b.grand_total, b.cost_total AS estimated_cost,
                        b.agency_commission,
                        c.full_name AS customer_name,
                        d.name AS destination_name, p.name AS package_name,
                        u.full_name AS owner_name,
                        COALESCE((SELECT SUM(sb.grand_total) FROM supplier_bills sb
                                   WHERE sb.booking_id = b.id
                                     AND sb.status NOT IN ('void','cancelled')), 0) AS billed_cost,
                        COALESCE((SELECT SUM(e.total_amount) FROM expenses e
                                   WHERE e.booking_id = b.id
                                     AND e.status NOT IN ('void','rejected')), 0) AS direct_expenses,
                        COALESCE((SELECT SUM(ts.total_amount) FROM trip_sheets ts
                                    JOIN trip_assignments ta ON ta.id = ts.trip_assignment_id
                                   WHERE ta.booking_id = b.id AND ts.status = 'approved'), 0) AS trip_sheet_cost
                   FROM bookings b
                   LEFT JOIN customers    c ON c.id = b.customer_id
                   LEFT JOIN destinations d ON d.id = b.destination_id
                   LEFT JOIN packages     p ON p.id = b.package_id
                   LEFT JOIN users        u ON u.id = b.owner_id
                  WHERE $where
                  ORDER BY b.travel_from ASC, b.booking_no ASC",
                $params
            );

            $lossOnly = Request::queryBool('loss_making', false) === true;
            $out      = [];

            foreach ($rows as $row) {
                $billed  = Money::of($row['billed_cost']);
                $base    = Money::greaterThan($billed, 0) ? $billed : Money::of($row['estimated_cost']);
                $actual  = Money::of($base + (float) $row['direct_expenses'] + (float) $row['trip_sheet_cost']);
                $revenue = Money::of($row['revenue']);
                $margin  = Money::of($revenue - $actual - (float) $row['agency_commission']);

                $row['billed_cost']     = $billed;
                $row['estimated_cost']  = Money::of($row['estimated_cost']);
                $row['direct_expenses'] = Money::of($row['direct_expenses']);
                $row['trip_sheet_cost'] = Money::of($row['trip_sheet_cost']);
                $row['actual_cost']     = $actual;
                $row['revenue']         = $revenue;
                $row['margin']          = $margin;
                $row['margin_pct']      = $revenue > 0 ? round($margin / $revenue * 100, 2) : 0.0;
                $row['is_estimated']    = !Money::greaterThan($billed, 0);
                $row['pax']             = (int) $row['adults'] + (int) $row['children'];

                if ($lossOnly && !Money::lessThan($margin, 0)) {
                    continue;
                }
                $out[] = $row;
            }

            if (Exporter::maybeExport(Request::query('format'), $out, [
                'booking_no'       => 'Booking No',
                'travel_from'      => 'Departs',
                'customer_name'    => 'Customer',
                'destination_name' => 'Destination',
                'package_name'     => 'Package',
                'owner_name'       => 'Sales Owner',
                'pax'              => 'Pax',
                'revenue'          => 'Revenue',
                'estimated_cost'   => 'Estimated Cost',
                'billed_cost'      => 'Billed Cost',
                'direct_expenses'  => 'Direct Expenses',
                'trip_sheet_cost'  => 'Trip Sheet Cost',
                'actual_cost'      => 'Actual Cost',
                'agency_commission'=> 'Agency Commission',
                'margin'           => 'Margin',
                'margin_pct'       => 'Margin %',
                'is_estimated'     => 'Cost Is Estimated',
            ], 'margin-report')) {
                return;
            }

            $revenueTotal = Money::sum(array_column($out, 'revenue'));
            $marginTotal  = Money::sum(array_column($out, 'margin'));

            Response::success([
                'period'  => ['from' => $from, 'to' => $to],
                'rows'    => $out,
                'totals'  => [
                    'booking_count' => count($out),
                    'revenue'       => $revenueTotal,
                    'actual_cost'   => Money::sum(array_column($out, 'actual_cost')),
                    'margin'        => $marginTotal,
                    'margin_pct'    => $revenueTotal > 0 ? round($marginTotal / $revenueTotal * 100, 2) : 0.0,
                    'loss_making'   => count(array_filter($out, static fn($r) => Money::lessThan($r['margin'], 0))),
                ],
            ]);
        });
    }

    /** GET /reports/supplier-performance?from=&to=&supplier_type=&format= */
    public function supplierPerformance(): void
    {
        $this->run(function () {
            [$from, $to] = $this->period(date('Y-m-01', strtotime('-11 months')));

            $clauses = ['s.is_deleted = 0'];
            $params  = [$from, $to, $from, $to, $from, $to, $from, $to];

            if ($type = Request::query('supplier_type')) {
                $clauses[] = 's.supplier_type = ?';
                $params[]  = $type;
            }
            if ($destinationId = Request::queryInt('destination_id')) {
                $clauses[] = 's.destination_id = ?';
                $params[]  = $destinationId;
            }

            $where = implode(' AND ', $clauses);

            // Correlated subqueries rather than four LEFT JOINs: joining bills,
            // services, incidents and feedback in one pass multiplies the rows and
            // silently inflates every SUM.
            $rows = Database::fetchAll(
                "SELECT s.id, s.code, s.name AS supplier_name, s.supplier_type, s.rating,
                        s.phone, s.email, s.credit_days,
                        d.name AS destination_name,

                        (SELECT COUNT(*) FROM supplier_bills sb
                          WHERE sb.supplier_id = s.id AND sb.status NOT IN ('void','cancelled')
                            AND sb.bill_date BETWEEN ? AND ?) AS bill_count,
                        COALESCE((SELECT SUM(sb.grand_total) FROM supplier_bills sb
                                   WHERE sb.supplier_id = s.id AND sb.status NOT IN ('void','cancelled')
                                     AND sb.bill_date BETWEEN ? AND ?), 0) AS billed_amount,
                        COALESCE((SELECT SUM(sb.grand_total - sb.amount_paid) FROM supplier_bills sb
                                   WHERE sb.supplier_id = s.id AND sb.status NOT IN ('void','cancelled')), 0) AS outstanding,

                        (SELECT COUNT(*) FROM booking_services bs
                           JOIN bookings b ON b.id = bs.booking_id
                          WHERE bs.supplier_id = s.id AND b.status NOT IN ('cancelled','draft')
                            AND bs.service_date BETWEEN ? AND ?) AS service_count,
                        (SELECT COUNT(*) FROM booking_services bs
                           JOIN bookings b ON b.id = bs.booking_id
                          WHERE bs.supplier_id = s.id AND b.status NOT IN ('cancelled','draft')
                            AND bs.service_date BETWEEN ? AND ?
                            AND bs.supplier_status = 'confirmed'
                            AND bs.confirmed_at IS NOT NULL
                            AND DATE(bs.confirmed_at) <= bs.service_date) AS on_time_confirmations,

                        (SELECT COUNT(*) FROM trip_incidents ti
                          WHERE ti.supplier_id = s.id) AS incident_count,
                        (SELECT COUNT(*) FROM trip_incidents ti
                          WHERE ti.supplier_id = s.id AND ti.severity IN ('high','critical')) AS serious_incident_count,
                        COALESCE((SELECT SUM(ti.cost_impact) FROM trip_incidents ti
                                   WHERE ti.supplier_id = s.id), 0) AS incident_cost_impact,

                        (SELECT COUNT(DISTINCT f.id) FROM trip_feedback f
                           JOIN booking_services bs2 ON bs2.booking_id = f.booking_id
                          WHERE bs2.supplier_id = s.id) AS feedback_count
                   FROM suppliers s
                   LEFT JOIN destinations d ON d.id = s.destination_id
                  WHERE $where
                  ORDER BY billed_amount DESC, s.name ASC",
                $params
            );

            // Suppliers with no activity in the window are noise on this report.
            $rows = array_values(array_filter($rows, static fn($r) =>
                (int) $r['bill_count'] > 0 || (int) $r['service_count'] > 0 || (int) $r['incident_count'] > 0));

            foreach ($rows as &$row) {
                $services = (int) $row['service_count'];
                $row['on_time_pct']       = $services > 0
                    ? round((int) $row['on_time_confirmations'] / $services * 100, 2) : null;
                $row['incident_rate_pct'] = $services > 0
                    ? round((int) $row['incident_count'] / $services * 100, 2) : null;
                $row['billed_amount']        = Money::of($row['billed_amount']);
                $row['outstanding']          = Money::of($row['outstanding']);
                $row['incident_cost_impact'] = Money::of($row['incident_cost_impact']);
                $row['rating']               = $row['rating'] !== null ? round((float) $row['rating'], 2) : null;
            }
            unset($row);

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'code'                   => 'Code',
                'supplier_name'          => 'Supplier',
                'supplier_type'          => 'Type',
                'destination_name'       => 'Destination',
                'service_count'          => 'Services',
                'on_time_confirmations'  => 'On-Time Confirmations',
                'on_time_pct'            => 'On-Time %',
                'bill_count'             => 'Bills',
                'billed_amount'          => 'Billed',
                'outstanding'            => 'Outstanding',
                'incident_count'         => 'Incidents',
                'serious_incident_count' => 'Serious Incidents',
                'incident_cost_impact'   => 'Incident Cost',
                'feedback_count'         => 'Feedback Responses',
                'rating'                 => 'Rating',
            ], 'supplier-performance')) {
                return;
            }

            Response::success([
                'period'    => ['from' => $from, 'to' => $to],
                'suppliers' => $rows,
                'totals'    => [
                    'supplier_count' => count($rows),
                    'billed_amount'  => Money::sum(array_column($rows, 'billed_amount')),
                    'outstanding'    => Money::sum(array_column($rows, 'outstanding')),
                    'incidents'      => (int) array_sum(array_column($rows, 'incident_count')),
                ],
            ]);
        });
    }

    /** GET /reports/pax-manifest?departure_id=&format= */
    public function paxManifest(): void
    {
        $this->run(function () {
            $departureId = Request::queryInt('departure_id');
            if ($departureId < 1) {
                throw new ValidationException(['departure_id' => ['departure_id is required']]);
            }

            $departure = Database::fetch(
                'SELECT pd.*, p.name AS package_name, p.code AS package_code, p.nights, p.days,
                        d.name AS destination_name, ci.name AS departure_city,
                        tm.full_name AS tour_manager_name, tm.phone AS tour_manager_phone
                   FROM package_departures pd
                   JOIN packages p          ON p.id  = pd.package_id
                   LEFT JOIN destinations d ON d.id  = p.destination_id
                   LEFT JOIN cities ci      ON ci.id = pd.departure_city_id
                   LEFT JOIN users tm       ON tm.id = pd.tour_manager_id
                  WHERE pd.id = ? LIMIT 1',
                [$departureId]
            );
            if ($departure === null) {
                Response::notFound('Departure not found');
                return;
            }

            $pax = Database::fetchAll(
                "SELECT b.booking_no, b.travel_from, b.travel_to, b.status AS booking_status,
                        b.contact_phone AS booking_phone, b.emergency_contact, b.emergency_phone,
                        b.special_requests,
                        c.full_name AS customer_name,
                        bp.id AS pax_id, bp.pax_no, bp.title, bp.first_name, bp.last_name,
                        bp.pax_type, bp.gender, bp.date_of_birth, bp.age, bp.phone, bp.email,
                        bp.passport_no, bp.passport_issue, bp.passport_expiry, bp.passport_country,
                        bp.visa_no, bp.visa_status, bp.visa_expiry,
                        bp.meal_preference, bp.medical_notes, bp.is_lead_pax, bp.insurance_no,
                        co.name AS nationality,
                        br.room_no, br.room_type_label, br.occupancy
                   FROM bookings b
                   JOIN booking_pax bp   ON bp.booking_id = b.id
                   LEFT JOIN customers c ON c.id = b.customer_id
                   LEFT JOIN countries co ON co.id = bp.nationality_id
                   LEFT JOIN booking_rooms br ON br.booking_id = b.id
                        AND FIND_IN_SET(bp.id, REPLACE(COALESCE(br.pax_ids, ''), ' ', '')) > 0
                  WHERE b.departure_id = ? AND b.status NOT IN ('cancelled','draft')
                  ORDER BY b.booking_no ASC, bp.pax_no ASC",
                [$departureId]
            );

            foreach ($pax as &$p) {
                $p['full_name'] = trim($p['title'] . ' ' . $p['first_name'] . ' ' . (string) $p['last_name']);
                $p['document_ok'] = !($p['passport_expiry'] !== null
                    && strtotime((string) $p['passport_expiry']) < strtotime((string) $departure['return_date']));
            }
            unset($p);

            if (Exporter::maybeExport(Request::query('format'), $pax, [
                'booking_no'      => 'Booking No',
                'pax_no'          => 'Pax No',
                'full_name'       => 'Passenger',
                'pax_type'        => 'Type',
                'gender'          => 'Gender',
                'age'             => 'Age',
                'date_of_birth'   => 'Date Of Birth',
                'nationality'     => 'Nationality',
                'phone'           => 'Phone',
                'passport_no'     => 'Passport No',
                'passport_expiry' => 'Passport Expiry',
                'visa_no'         => 'Visa No',
                'visa_status'     => 'Visa Status',
                'meal_preference' => 'Meal',
                'medical_notes'   => 'Medical Notes',
                'insurance_no'    => 'Insurance No',
                'room_no'         => 'Room',
                'occupancy'       => 'Occupancy',
                'emergency_contact' => 'Emergency Contact',
                'emergency_phone' => 'Emergency Phone',
            ], 'pax-manifest-' . $departure['batch_code'])) {
                return;
            }

            $bookings = Database::fetchAll(
                "SELECT b.id, b.booking_no, b.adults, b.children, b.infants, b.status, b.payment_status,
                        b.grand_total, b.amount_paid, (b.grand_total - b.amount_paid) AS outstanding,
                        c.full_name AS customer_name, c.phone AS customer_phone
                   FROM bookings b
                   LEFT JOIN customers c ON c.id = b.customer_id
                  WHERE b.departure_id = ? AND b.status NOT IN ('cancelled','draft')
                  ORDER BY b.booking_no ASC",
                [$departureId]
            );

            $mealCounts = [];
            foreach ($pax as $p) {
                $mealCounts[$p['meal_preference']] = ($mealCounts[$p['meal_preference']] ?? 0) + 1;
            }

            Response::success([
                'departure' => $departure,
                'bookings'  => $bookings,
                'pax'       => $pax,
                'summary'   => [
                    'booking_count' => count($bookings),
                    'pax_count'     => count($pax),
                    'adults'        => (int) array_sum(array_column($bookings, 'adults')),
                    'children'      => (int) array_sum(array_column($bookings, 'children')),
                    'infants'       => (int) array_sum(array_column($bookings, 'infants')),
                    'seats_total'   => (int) $departure['seats_total'],
                    'seats_free'    => max(0, (int) $departure['seats_total'] - (int) $departure['seats_booked'] - (int) $departure['seats_held']),
                    'meal_preferences' => $mealCounts,
                    'outstanding'   => Money::sum(array_column($bookings, 'outstanding')),
                    'document_issues' => count(array_filter($pax, static fn($p) => $p['document_ok'] === false)),
                ],
            ]);
        });
    }

    /** GET /reports/outstanding?as_of=&overdue_only=&format= */
    public function outstanding(): void
    {
        $this->run(function () {
            $balanceDueDays = Setting::int('balance_due_days_before', 15);

            $clauses = ["b.status NOT IN ('cancelled','draft')", 'b.grand_total - b.amount_paid > 0.005'];
            $params  = [];

            if ($customerId = Request::queryInt('customer_id')) {
                $clauses[] = 'b.customer_id = ?';
                $params[]  = $customerId;
            }
            if ($ownerId = Request::queryInt('owner_id')) {
                $clauses[] = 'b.owner_id = ?';
                $params[]  = $ownerId;
            }
            if (Request::queryBool('overdue_only', false) === true) {
                // "Overdue" for a tour operator means the balance-due milestone has
                // passed, not the departure date.
                $clauses[] = 'DATEDIFF(b.travel_from, CURDATE()) <= ?';
                $params[]  = $balanceDueDays;
            }

            $where = implode(' AND ', $clauses);

            $rows = Database::fetchAll(
                "SELECT b.id, b.booking_no, b.booking_date, b.travel_from, b.travel_to,
                        b.status, b.payment_status, b.grand_total, b.amount_paid,
                        (b.grand_total - b.amount_paid) AS outstanding,
                        DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure,
                        b.last_payment_at,
                        c.id AS customer_id, c.full_name AS customer_name, c.phone AS customer_phone,
                        c.email AS customer_email,
                        d.name AS destination_name,
                        u.full_name AS owner_name,
                        (SELECT MIN(p.due_on) FROM payments p
                          WHERE p.ref_type = 'booking' AND p.ref_id = b.id AND p.status = 'scheduled') AS next_instalment_due
                   FROM bookings b
                   LEFT JOIN customers    c ON c.id = b.customer_id
                   LEFT JOIN destinations d ON d.id = b.destination_id
                   LEFT JOIN users        u ON u.id = b.owner_id
                  WHERE $where
                  ORDER BY b.travel_from ASC, outstanding DESC",
                $params
            );

            $buckets = ['departed' => 0.0, 'due_now' => 0.0, 'due_30' => 0.0, 'later' => 0.0];

            foreach ($rows as &$row) {
                $days = (int) $row['days_to_departure'];
                $amt  = Money::of($row['outstanding']);
                $row['outstanding'] = $amt;

                if ($days < 0) {
                    $row['bucket'] = 'departed';
                } elseif ($days <= $balanceDueDays) {
                    $row['bucket'] = 'due_now';
                } elseif ($days <= 30) {
                    $row['bucket'] = 'due_30';
                } else {
                    $row['bucket'] = 'later';
                }
                $buckets[$row['bucket']] += $amt;
            }
            unset($row);

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'booking_no'        => 'Booking No',
                'customer_name'     => 'Customer',
                'customer_phone'    => 'Phone',
                'destination_name'  => 'Destination',
                'travel_from'       => 'Departs',
                'days_to_departure' => 'Days To Departure',
                'grand_total'       => 'Total',
                'amount_paid'       => 'Paid',
                'outstanding'       => 'Outstanding',
                'bucket'            => 'Bucket',
                'last_payment_at'   => 'Last Payment',
                'owner_name'        => 'Sales Owner',
            ], 'outstanding-report')) {
                return;
            }

            Response::success([
                'balance_due_days_before' => $balanceDueDays,
                'rows'    => $rows,
                'buckets' => array_map(static fn($v) => Money::of($v), $buckets),
                'totals'  => [
                    'booking_count' => count($rows),
                    'outstanding'   => Money::sum(array_column($rows, 'outstanding')),
                ],
                'invoices' => Database::fetchAll(
                    "SELECT i.id, i.invoice_no, i.invoice_date, i.due_date, i.grand_total, i.amount_paid,
                            (i.grand_total - i.amount_paid) AS outstanding,
                            DATEDIFF(CURDATE(), i.due_date) AS days_overdue,
                            c.full_name AS customer_name
                       FROM invoices i
                       LEFT JOIN customers c ON c.id = i.customer_id
                      WHERE i.status NOT IN ('void','cancelled','draft')
                        AND i.grand_total - i.amount_paid > 0.005
                      ORDER BY i.due_date ASC
                      LIMIT 200"
                ),
            ]);
        });
    }

    /** GET /reports/lead-source-roi?from=&to=&format= */
    public function leadSourceRoi(): void
    {
        $this->run(function () {
            [$from, $to] = $this->period(date('Y-m-01', strtotime('-5 months')));

            $rows = Database::fetchAll(
                "SELECT COALESCE(ls.id, 0) AS source_id,
                        COALESCE(ls.name, 'Unknown') AS source_name,
                        COALESCE(ls.is_paid, 0) AS is_paid,
                        COUNT(l.id) AS lead_count,
                        SUM(l.status = 'won')  AS won_count,
                        SUM(l.status = 'lost') AS lost_count,
                        SUM(l.status NOT IN ('won','lost','dropped')) AS open_count,
                        COALESCE(SUM(l.adults + l.children), 0) AS enquiry_pax,
                        COALESCE(SUM(l.budget_max), 0) AS potential_value,
                        -- Quotes are counted with a per-lead subquery rather than a
                        -- join: joining them would fan out the lead rows and inflate
                        -- every other SUM on this line.
                        COALESCE(SUM((SELECT COUNT(*) FROM quotations q WHERE q.lead_id = l.id)), 0) AS quote_count,
                        COALESCE(SUM((SELECT COUNT(*) FROM quotations q WHERE q.lead_id = l.id) > 0), 0) AS quoted_lead_count,
                        COUNT(b.id) AS booking_count,
                        COALESCE(SUM(b.grand_total), 0) AS revenue,
                        COALESCE(SUM(b.taxable_amount - b.cost_total), 0) AS estimated_margin
                   FROM leads l
                   LEFT JOIN lead_sources ls ON ls.id = l.source_id
                   LEFT JOIN bookings     b  ON b.id = l.converted_booking_id
                                             AND b.status NOT IN ('cancelled','draft')
                  WHERE DATE(l.created_at) BETWEEN ? AND ?
                  GROUP BY ls.id, ls.name, ls.is_paid
                  ORDER BY revenue DESC, lead_count DESC",
                [$from, $to]
            );

            // Marketing spend booked against the period, so a paid source can be
            // judged on return rather than on volume alone.
            $marketingSpend = Money::of(Database::scalar(
                "SELECT COALESCE(SUM(total_amount), 0) FROM expenses
                  WHERE expense_date BETWEEN ? AND ?
                    AND status NOT IN ('void','rejected','draft')
                    AND category = 'Marketing'",
                [$from, $to]
            ));

            $paidLeads = 0;
            foreach ($rows as $row) {
                if ((int) $row['is_paid'] === 1) {
                    $paidLeads += (int) $row['lead_count'];
                }
            }

            foreach ($rows as &$row) {
                $leads   = (int) $row['lead_count'];
                $revenue = Money::of($row['revenue']);

                $row['revenue']          = $revenue;
                $row['estimated_margin'] = Money::of($row['estimated_margin']);
                $row['potential_value']  = Money::of($row['potential_value']);
                $row['quote_rate_pct']   = $leads > 0 ? round((int) $row['quoted_lead_count'] / $leads * 100, 2) : 0.0;
                $row['win_rate_pct']     = $leads > 0 ? round((int) $row['won_count'] / $leads * 100, 2) : 0.0;
                $row['revenue_per_lead'] = $leads > 0 ? Money::of($revenue / $leads) : 0.0;

                // Spend is only tracked in total, so it is apportioned across paid
                // sources by lead volume. Approximate, and labelled as such.
                $row['allocated_spend'] = ((int) $row['is_paid'] === 1 && $paidLeads > 0)
                    ? Money::of($marketingSpend * $leads / $paidLeads) : 0.0;
                $row['roi_pct'] = Money::greaterThan($row['allocated_spend'], 0)
                    ? round(($revenue - $row['allocated_spend']) / $row['allocated_spend'] * 100, 2) : null;
                $row['cost_per_acquisition'] = ((int) $row['won_count'] > 0 && Money::greaterThan($row['allocated_spend'], 0))
                    ? Money::of($row['allocated_spend'] / (int) $row['won_count']) : null;
            }
            unset($row);

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'source_name'          => 'Source',
                'is_paid'              => 'Paid Channel',
                'lead_count'           => 'Leads',
                'quote_count'          => 'Quotes',
                'quote_rate_pct'       => 'Quote %',
                'won_count'            => 'Won',
                'win_rate_pct'         => 'Win %',
                'booking_count'        => 'Bookings',
                'revenue'              => 'Revenue',
                'estimated_margin'     => 'Estimated Margin',
                'revenue_per_lead'     => 'Revenue / Lead',
                'allocated_spend'      => 'Allocated Spend',
                'cost_per_acquisition' => 'Cost Per Acquisition',
                'roi_pct'              => 'ROI %',
            ], 'lead-source-roi')) {
                return;
            }

            Response::success([
                'period'          => ['from' => $from, 'to' => $to],
                'marketing_spend' => $marketingSpend,
                'spend_note'      => 'Spend is the total of Marketing expenses in the period, apportioned across paid sources by lead volume.',
                'rows'            => $rows,
                'totals'          => [
                    'lead_count'    => (int) array_sum(array_column($rows, 'lead_count')),
                    'won_count'     => (int) array_sum(array_column($rows, 'won_count')),
                    'booking_count' => (int) array_sum(array_column($rows, 'booking_count')),
                    'revenue'       => Money::sum(array_column($rows, 'revenue')),
                ],
            ]);
        });
    }

    // -----------------------------------------------------------------------

    /** @return array{0:string, 1:string} validated from/to */
    private function period(string $defaultFrom): array
    {
        $from = (string) Request::query('from', $defaultFrom);
        $to   = (string) Request::query('to', date('Y-m-d'));

        foreach (['from' => $from, 'to' => $to] as $field => $value) {
            $parsed = DateTime::createFromFormat('Y-m-d', $value);
            if ($parsed === false || $parsed->format('Y-m-d') !== $value) {
                throw new ValidationException([$field => ['Date must be in YYYY-MM-DD format']]);
            }
        }
        Validator::assertDateOrder($from, $to, 'to');

        return [$from, $to];
    }
}
