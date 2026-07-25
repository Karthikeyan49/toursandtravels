<?php
/**
 * On-the-ground operations: the day board, transport assignment, trip sheets,
 * supplier confirmations and incidents.
 *
 * The one screen that earns its keep here is GET /ops/departures-checklist —
 * everything that must be true before a group leaves, per booking, in one call.
 */
class OpsController extends Controller
{
    /** Supplier states that still need chasing before departure. */
    private const UNCONFIRMED_SUPPLIER_STATES = ['pending', 'requested', 'waitlisted'];

    // --- Day board ----------------------------------------------------------

    /** GET /ops/board?date=&status=&owner_id=&destination_id= */
    public function board(): void
    {
        $this->run(function () {
            $date = $this->dateOrToday(Request::query('date'));

            $sheets = OpsDaysheet::forDate($date, [
                'status'         => Request::query('status'),
                'owner_id'       => Request::queryInt('owner_id') ?: null,
                'destination_id' => Request::queryInt('destination_id') ?: null,
            ]);

            // Decode the checklist once here rather than making every client do it.
            foreach ($sheets as &$sheet) {
                $list = json_decode((string) $sheet['checklist_json'], true);
                $sheet['checklist'] = is_array($list) ? $list : [];
                $sheet['checklist_done'] = count(array_filter($sheet['checklist'], static fn($i) => !empty($i['done'])));
                $sheet['checklist_total'] = count($sheet['checklist']);
                unset($sheet['checklist_json']);
            }
            unset($sheet);

            $counts = ['pending' => 0, 'ready' => 0, 'in_progress' => 0, 'done' => 0, 'issue' => 0];
            $pax = 0;
            foreach ($sheets as $s) {
                $counts[$s['status']] = ($counts[$s['status']] ?? 0) + 1;
                $pax += (int) $s['adults'] + (int) $s['children'];
            }

            Response::success([
                'date'        => $date,
                'daysheets'   => $sheets,
                'transport'   => TripAssignment::forDate($date),
                'departures'  => $this->departuresOn($date),
                'arrivals'    => $this->arrivalsOn($date),
                'summary'     => [
                    'bookings_on_road' => count($sheets),
                    'pax_on_road'      => $pax,
                    'by_status'        => $counts,
                ],
            ]);
        });
    }

    /** GET /ops/calendar?from=&to= — bookings on the road, grouped by date. */
    public function calendar(): void
    {
        $this->run(function () {
            $from = $this->dateOrToday(Request::query('from'));
            $to   = $this->dateOrToday(Request::query('to', date('Y-m-d', strtotime($from . ' +30 days'))));

            if (strtotime($to) < strtotime($from)) {
                throw new ValidationException(['to' => ['End date cannot be before start date']]);
            }
            // A calendar is a screen, not an export: cap the window so one request
            // cannot ask for five years of day rows.
            $days = (int) floor((strtotime($to) - strtotime($from)) / 86400) + 1;
            if ($days > 92) {
                throw new ValidationException(['to' => ['Calendar range cannot exceed 92 days']]);
            }

            $bookings = Database::fetchAll(
                "SELECT b.id, b.booking_no, b.travel_from, b.travel_to, b.status, b.payment_status,
                        b.adults, b.children, b.infants, b.lead_pax_name, b.contact_phone,
                        (b.grand_total - b.amount_paid) AS outstanding,
                        c.full_name AS customer_name,
                        d.name AS destination_name,
                        p.name AS package_name,
                        u.full_name AS ops_owner_name
                   FROM bookings b
                   LEFT JOIN customers    c ON c.id = b.customer_id
                   LEFT JOIN destinations d ON d.id = b.destination_id
                   LEFT JOIN packages     p ON p.id = b.package_id
                   LEFT JOIN users        u ON u.id = b.ops_owner_id
                  WHERE b.status NOT IN ('cancelled','draft')
                    AND b.travel_from <= ? AND b.travel_to >= ?
                  ORDER BY b.travel_from ASC, b.booking_no ASC",
                [$to, $from]
            );

            // Day sheet status per (booking, date) so the calendar can colour cells.
            $sheetStatus = [];
            foreach (Database::fetchAll(
                'SELECT booking_id, sheet_date, status FROM ops_daysheets WHERE sheet_date BETWEEN ? AND ?',
                [$from, $to]
            ) as $s) {
                $sheetStatus[$s['sheet_date'] . '#' . $s['booking_id']] = $s['status'];
            }

            $calendar = [];
            for ($t = strtotime($from); $t <= strtotime($to); $t += 86400) {
                $date = date('Y-m-d', $t);
                $calendar[$date] = [
                    'date'       => $date,
                    'weekday'    => date('D', $t),
                    'departures' => [],
                    'arrivals'   => [],
                    'on_road'    => [],
                    'pax'        => 0,
                ];
            }

            foreach ($bookings as $b) {
                $start = max(strtotime($from), strtotime((string) $b['travel_from']));
                $end   = min(strtotime($to), strtotime((string) $b['travel_to']));
                $pax   = (int) $b['adults'] + (int) $b['children'];

                for ($t = $start; $t <= $end; $t += 86400) {
                    $date = date('Y-m-d', $t);
                    if (!isset($calendar[$date])) {
                        continue;
                    }
                    $entry = $b;
                    $entry['daysheet_status'] = $sheetStatus[$date . '#' . $b['id']] ?? null;

                    $calendar[$date]['on_road'][] = $entry;
                    $calendar[$date]['pax'] += $pax;
                    if ($date === $b['travel_from']) {
                        $calendar[$date]['departures'][] = $entry;
                    }
                    if ($date === $b['travel_to']) {
                        $calendar[$date]['arrivals'][] = $entry;
                    }
                }
            }

            Response::success([
                'from'  => $from,
                'to'    => $to,
                'days'  => array_values($calendar),
                'total_bookings' => count($bookings),
            ]);
        });
    }

    /** POST /ops/daysheets/{id}/checklist  body {index, done} */
    public function toggleChecklist(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['index', 'done']), [
                'index' => 'required|int|min:0|max:99',
                'done'  => 'required|bool',
            ]);

            $result = OpsDaysheet::toggleChecklistItem($id, (int) $data['index'], (int) $data['done'] === 1);

            Audit::log('daysheet_checklist', 'ops_daysheet', $id, null, [
                'index' => $data['index'], 'done' => (int) $data['done'], 'status' => $result['status'],
            ]);

            Response::success($result, 'Checklist updated');
        });
    }

    /** POST /ops/daysheets/{id}/issue  body {note} — raises a critical alert. */
    public function flagIssue(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['note']), ['note' => 'required|string|max:500']);

            $sheet = Database::fetch(
                'SELECT ds.*, b.booking_no, b.ops_owner_id, b.lead_pax_name
                   FROM ops_daysheets ds JOIN bookings b ON b.id = ds.booking_id
                  WHERE ds.id = ? LIMIT 1',
                [$id]
            );
            if ($sheet === null) {
                Response::notFound('Day sheet not found');
                return;
            }

            Database::execute(
                "UPDATE ops_daysheets SET status = 'issue', issue_note = ? WHERE id = ?",
                [$data['note'], $id]
            );

            Notifier::push(
                'ops_issue',
                'Issue on ' . $sheet['booking_no'] . ' (' . $sheet['sheet_date'] . ')',
                $data['note'],
                !empty($sheet['ops_owner_id']) ? (int) $sheet['ops_owner_id'] : null,
                'operations',
                'booking',
                (int) $sheet['booking_id'],
                'critical'
            );

            Audit::log('daysheet_issue', 'ops_daysheet', $id, null, ['note' => $data['note']]);

            Response::success(
                Database::fetch('SELECT * FROM ops_daysheets WHERE id = ?', [$id]),
                'Issue flagged and the operations team notified'
            );
        });
    }

    // --- Trip assignments ---------------------------------------------------

    /** GET /trip-assignments */
    public function tripAssignments(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            [$rows, $total] = TripAssignment::paginate([
                'search'      => Request::query('search'),
                'from'        => Request::query('from'),
                'to'          => Request::query('to'),
                'vehicle_id'  => Request::query('vehicle_id'),
                'driver_id'   => Request::query('driver_id'),
                'supplier_id' => Request::query('supplier_id'),
                'status'      => Request::query('status'),
                'booking_id'  => Request::query('booking_id'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** GET /trip-assignments/{id} */
    public function showTripAssignment(): void
    {
        $this->run(function () {
            $ta = TripAssignment::detail(Request::paramInt('id'));
            if ($ta === null) {
                Response::notFound('Trip assignment not found');
                return;
            }
            Response::success($ta);
        });
    }

    /** POST /bookings/{id}/trip-assignments */
    public function storeTripAssignment(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');
            $booking   = Booking::findOrFail($bookingId);

            $data = $this->tripAssignmentPayload(true);
            $this->assertTripWindow($booking, $data['from_date'], $data['to_date']);
            $this->assertResourcesExist($data);

            $clashes = TripAssignment::hasClash(
                $data['vehicle_id'] ?? null,
                $data['driver_id'] ?? null,
                $data['from_date'],
                $data['to_date']
            );
            if ($clashes !== []) {
                throw new BusinessRuleException(TripAssignment::describeClash($clashes));
            }

            if (!empty($data['booking_service_id'])) {
                $belongs = Database::scalar(
                    'SELECT 1 FROM booking_services WHERE id = ? AND booking_id = ? LIMIT 1',
                    [(int) $data['booking_service_id'], $bookingId]
                );
                if ($belongs === null) {
                    throw new ValidationException(['booking_service_id' => ['Service line does not belong to this booking']]);
                }
            }

            $id = TripAssignment::createFor($bookingId, $data);

            Response::created(TripAssignment::detail($id), 'Transport assigned');
        });
    }

    /** PUT /trip-assignments/{id} */
    public function updateTripAssignment(): void
    {
        $this->run(function () {
            $id     = Request::paramInt('id');
            $before = TripAssignment::findOrFail($id);

            $data = $this->tripAssignmentPayload(false);

            $from = $data['from_date'] ?? (string) $before['from_date'];
            $to   = $data['to_date']   ?? (string) $before['to_date'];
            Validator::assertDateOrder($from, $to, 'to_date');

            $booking = Booking::findOrFail((int) $before['booking_id']);
            $this->assertTripWindow($booking, $from, $to);
            $this->assertResourcesExist($data);

            $vehicleId = array_key_exists('vehicle_id', $data)
                ? ($data['vehicle_id'] !== null ? (int) $data['vehicle_id'] : null)
                : (!empty($before['vehicle_id']) ? (int) $before['vehicle_id'] : null);
            $driverId = array_key_exists('driver_id', $data)
                ? ($data['driver_id'] !== null ? (int) $data['driver_id'] : null)
                : (!empty($before['driver_id']) ? (int) $before['driver_id'] : null);

            $clashes = TripAssignment::hasClash($vehicleId, $driverId, $from, $to, $id);
            if ($clashes !== []) {
                throw new BusinessRuleException(TripAssignment::describeClash($clashes));
            }

            TripAssignment::updateFor($id, $data);

            Response::success(TripAssignment::detail($id), 'Trip assignment updated');
        });
    }

    /** POST /trip-assignments/{id}/status  body {status, note} */
    public function changeTripStatus(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['status', 'note']), [
                'status' => 'required|in:planned,confirmed,dispatched,in_progress,completed,cancelled',
                'note'   => 'nullable|string|max:255',
            ]);

            TripAssignment::changeStatus($id, $data['status'], $data['note'] ?? null);

            Response::success(TripAssignment::detail($id), 'Trip status updated to ' . $data['status']);
        });
    }

    /** POST /trip-assignments/{id}/trip-sheet */
    public function submitTripSheet(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(
                Request::only([
                    'sheet_date', 'start_km', 'end_km', 'start_time', 'end_time',
                    'fuel_amount', 'toll_amount', 'parking_amount', 'driver_allowance',
                    'other_amount', 'odometer_photo', 'remarks',
                ]),
                [
                    'sheet_date'       => 'nullable|date',
                    'start_km'         => 'required|int|min:0|max:9999999',
                    'end_km'           => 'required|int|min:0|max:9999999',
                    'start_time'       => 'nullable|time',
                    'end_time'         => 'nullable|time',
                    'fuel_amount'      => 'nullable|money',
                    'toll_amount'      => 'nullable|money',
                    'parking_amount'   => 'nullable|money',
                    'driver_allowance' => 'nullable|money',
                    'other_amount'     => 'nullable|money',
                    'odometer_photo'   => 'nullable|string|max:255',
                    'remarks'          => 'nullable|string|max:500',
                ]
            );

            $sheetId = TripAssignment::submitTripSheet($id, $data);

            Response::created([
                'trip_sheet' => Database::fetch('SELECT * FROM trip_sheets WHERE id = ?', [$sheetId]),
                'assignment' => TripAssignment::detail($id),
            ], 'Trip sheet submitted');
        });
    }

    /** POST /trip-sheets/{id}/approve */
    public function approveTripSheet(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            TripAssignment::approveTripSheet($id);
            Response::success(Database::fetch('SELECT * FROM trip_sheets WHERE id = ?', [$id]), 'Trip sheet approved');
        });
    }

    /** POST /trip-sheets/{id}/reject  body {reason} */
    public function rejectTripSheet(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['reason']), ['reason' => 'required|string|max:255']);

            TripAssignment::rejectTripSheet($id, $data['reason']);
            Response::success(Database::fetch('SELECT * FROM trip_sheets WHERE id = ?', [$id]), 'Trip sheet rejected');
        });
    }

    // --- Departures readiness ----------------------------------------------

    /**
     * GET /ops/departures-checklist?days=7
     *
     * Everything that must be true before a group leaves, per booking:
     * supplier confirmations, passport/visa data, vouchers, transport and money.
     * Each booking carries an explicit blocker list so the screen is actionable
     * rather than decorative.
     */
    public function departuresChecklist(): void
    {
        $this->run(function () {
            $days = Request::queryInt('days', 7);
            $days = max(1, min($days, 90));

            $balanceDueDays = Setting::int('balance_due_days_before', 15);
            $passportBuffer = Setting::int('passport_expiry_alert_days', 180);

            $rows = Database::fetchAll(
                "SELECT b.id, b.booking_no, b.travel_from, b.travel_to, b.status, b.payment_status,
                        b.adults, b.children, b.infants, b.lead_pax_name, b.contact_phone, b.contact_email,
                        b.grand_total, b.amount_paid, (b.grand_total - b.amount_paid) AS outstanding,
                        DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure,
                        c.full_name AS customer_name, c.phone AS customer_phone,
                        d.name AS destination_name, d.scope AS destination_scope,
                        p.name AS package_name, pd.batch_code,
                        so.full_name AS owner_name, oo.full_name AS ops_owner_name,

                        (SELECT COUNT(*) FROM booking_services bs
                          WHERE bs.booking_id = b.id AND bs.supplier_status <> 'cancelled') AS service_count,
                        (SELECT COUNT(*) FROM booking_services bs
                          WHERE bs.booking_id = b.id
                            AND bs.supplier_status IN ('pending','requested','waitlisted')) AS unconfirmed_services,

                        (SELECT COUNT(*) FROM booking_pax bp WHERE bp.booking_id = b.id) AS pax_rows,
                        (SELECT COUNT(*) FROM booking_pax bp
                          WHERE bp.booking_id = b.id
                            AND (bp.passport_no IS NULL OR bp.passport_no = ''
                                 OR bp.passport_expiry IS NULL)) AS pax_missing_passport,
                        (SELECT COUNT(*) FROM booking_pax bp
                          WHERE bp.booking_id = b.id
                            AND bp.passport_expiry IS NOT NULL
                            AND bp.passport_expiry < b.travel_to) AS pax_passport_expired,
                        (SELECT COUNT(*) FROM booking_pax bp
                          WHERE bp.booking_id = b.id
                            AND bp.passport_expiry IS NOT NULL
                            AND bp.passport_expiry >= b.travel_to
                            AND DATEDIFF(bp.passport_expiry, b.travel_to) < ?) AS pax_passport_short,
                        (SELECT COUNT(*) FROM booking_pax bp
                          WHERE bp.booking_id = b.id AND bp.visa_status IN ('pending','applied')) AS pax_visa_pending,
                        (SELECT COUNT(*) FROM booking_pax bp
                          WHERE bp.booking_id = b.id AND bp.visa_status = 'rejected') AS pax_visa_rejected,
                        (SELECT COUNT(*) FROM booking_pax bp
                          WHERE bp.booking_id = b.id
                            AND (bp.first_name IS NULL OR bp.first_name = ''
                                 OR bp.first_name LIKE 'Passenger %')) AS pax_unnamed,

                        (SELECT COUNT(*) FROM booking_services bs
                          WHERE bs.booking_id = b.id AND bs.supplier_status = 'confirmed'
                            AND NOT EXISTS (SELECT 1 FROM vouchers v
                                             WHERE v.booking_service_id = bs.id
                                               AND v.status IN ('draft','issued','sent'))) AS unissued_vouchers,
                        (SELECT COUNT(*) FROM vouchers v
                          WHERE v.booking_id = b.id AND v.status IN ('issued','sent')) AS issued_vouchers,

                        (SELECT COUNT(*) FROM booking_services bs
                          WHERE bs.booking_id = b.id
                            AND bs.service_type IN ('transport')
                            AND bs.supplier_status <> 'cancelled'
                            AND NOT EXISTS (SELECT 1 FROM trip_assignments ta
                                             WHERE ta.booking_id = b.id AND ta.status <> 'cancelled'
                                               AND COALESCE(bs.service_date, b.travel_from)
                                                   BETWEEN ta.from_date AND ta.to_date)) AS unassigned_transport,
                        (SELECT COUNT(*) FROM trip_assignments ta
                          WHERE ta.booking_id = b.id AND ta.status <> 'cancelled') AS assignment_count,
                        (SELECT COUNT(*) FROM trip_assignments ta
                          WHERE ta.booking_id = b.id AND ta.status <> 'cancelled'
                            AND (ta.driver_id IS NULL OR ta.vehicle_id IS NULL)) AS incomplete_assignments,

                        (SELECT COUNT(*) FROM trip_incidents ti
                          WHERE ti.booking_id = b.id AND ti.status IN ('open','investigating')) AS open_incidents,
                        (SELECT COUNT(*) FROM ops_daysheets ds
                          WHERE ds.booking_id = b.id AND ds.status = 'issue') AS daysheet_issues
                   FROM bookings b
                   LEFT JOIN customers          c  ON c.id  = b.customer_id
                   LEFT JOIN destinations       d  ON d.id  = b.destination_id
                   LEFT JOIN packages           p  ON p.id  = b.package_id
                   LEFT JOIN package_departures pd ON pd.id = b.departure_id
                   LEFT JOIN users              so ON so.id = b.owner_id
                   LEFT JOIN users              oo ON oo.id = b.ops_owner_id
                  WHERE b.status IN ('confirmed','vouchered')
                    AND b.travel_from BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
                  ORDER BY b.travel_from ASC, b.booking_no ASC",
                [$passportBuffer, $days]
            );

            $summary = [
                'bookings'             => count($rows),
                'pax'                  => 0,
                'ready'                => 0,
                'blocked'              => 0,
                'unconfirmed_services' => 0,
                'unissued_vouchers'    => 0,
                'unassigned_transport' => 0,
                'pax_document_issues'  => 0,
                'outstanding_amount'   => 0.0,
            ];

            foreach ($rows as &$b) {
                $international = ($b['destination_scope'] ?? 'domestic') === 'international';
                $outstanding   = Money::of($b['outstanding']);
                $daysOut       = (int) $b['days_to_departure'];

                $blockers = [];
                $warnings = [];

                if ((int) $b['service_count'] === 0) {
                    $blockers[] = ['code' => 'no_services', 'severity' => 'critical',
                        'message' => 'No service lines on the booking'];
                }
                if ((int) $b['unconfirmed_services'] > 0) {
                    $blockers[] = ['code' => 'unconfirmed_services', 'severity' => $daysOut <= 3 ? 'critical' : 'warning',
                        'message' => $b['unconfirmed_services'] . ' supplier service(s) not confirmed'];
                }
                if ((int) $b['pax_unnamed'] > 0) {
                    $blockers[] = ['code' => 'pax_names_missing', 'severity' => 'critical',
                        'message' => $b['pax_unnamed'] . ' passenger(s) still unnamed'];
                }
                if ($international) {
                    if ((int) $b['pax_missing_passport'] > 0) {
                        $blockers[] = ['code' => 'passport_missing', 'severity' => 'critical',
                            'message' => $b['pax_missing_passport'] . ' passenger(s) without passport details'];
                    }
                    if ((int) $b['pax_passport_expired'] > 0) {
                        $blockers[] = ['code' => 'passport_expired', 'severity' => 'critical',
                            'message' => $b['pax_passport_expired'] . ' passport(s) expire before the return date'];
                    }
                    if ((int) $b['pax_passport_short'] > 0) {
                        $warnings[] = ['code' => 'passport_short_validity', 'severity' => 'warning',
                            'message' => $b['pax_passport_short'] . ' passport(s) valid for less than ' . $passportBuffer . ' days after travel'];
                    }
                    if ((int) $b['pax_visa_rejected'] > 0) {
                        $blockers[] = ['code' => 'visa_rejected', 'severity' => 'critical',
                            'message' => $b['pax_visa_rejected'] . ' visa application(s) rejected'];
                    }
                    if ((int) $b['pax_visa_pending'] > 0) {
                        $blockers[] = ['code' => 'visa_pending', 'severity' => $daysOut <= 7 ? 'critical' : 'warning',
                            'message' => $b['pax_visa_pending'] . ' visa(s) still pending'];
                    }
                } elseif ((int) $b['pax_missing_passport'] > 0) {
                    $warnings[] = ['code' => 'id_proof_missing', 'severity' => 'info',
                        'message' => $b['pax_missing_passport'] . ' passenger(s) without an ID document on file'];
                }

                if ((int) $b['unissued_vouchers'] > 0) {
                    $blockers[] = ['code' => 'vouchers_pending', 'severity' => $daysOut <= 3 ? 'critical' : 'warning',
                        'message' => $b['unissued_vouchers'] . ' confirmed service(s) without a voucher'];
                }
                if ((int) $b['unassigned_transport'] > 0) {
                    $blockers[] = ['code' => 'transport_unassigned', 'severity' => $daysOut <= 2 ? 'critical' : 'warning',
                        'message' => $b['unassigned_transport'] . ' transport service(s) without a vehicle assignment'];
                }
                if ((int) $b['incomplete_assignments'] > 0) {
                    $warnings[] = ['code' => 'assignment_incomplete', 'severity' => 'warning',
                        'message' => $b['incomplete_assignments'] . ' assignment(s) missing a vehicle or driver'];
                }
                if (Money::greaterThan($outstanding, 0) && $daysOut <= $balanceDueDays) {
                    $blockers[] = ['code' => 'balance_outstanding', 'severity' => $daysOut <= 3 ? 'critical' : 'warning',
                        'message' => number_format($outstanding, 2) . ' outstanding with ' . $daysOut . ' day(s) to departure'];
                } elseif (Money::greaterThan($outstanding, 0)) {
                    $warnings[] = ['code' => 'balance_due_later', 'severity' => 'info',
                        'message' => number_format($outstanding, 2) . ' due by ' . $balanceDueDays . ' days before departure'];
                }
                if ((int) $b['open_incidents'] > 0) {
                    $warnings[] = ['code' => 'open_incidents', 'severity' => 'warning',
                        'message' => $b['open_incidents'] . ' open incident(s)'];
                }

                $b['outstanding']    = $outstanding;
                $b['pax_total']      = (int) $b['adults'] + (int) $b['children'] + (int) $b['infants'];
                $b['international']  = $international;
                $b['blockers']       = $blockers;
                $b['warnings']       = $warnings;
                $b['is_ready']       = $blockers === [];
                $b['readiness_pct']  = $this->readinessPct($b);

                $summary['pax']                  += $b['pax_total'];
                $summary['unconfirmed_services'] += (int) $b['unconfirmed_services'];
                $summary['unissued_vouchers']    += (int) $b['unissued_vouchers'];
                $summary['unassigned_transport'] += (int) $b['unassigned_transport'];
                $summary['pax_document_issues']  += (int) $b['pax_missing_passport'] + (int) $b['pax_passport_expired']
                                                  + (int) $b['pax_visa_pending'] + (int) $b['pax_visa_rejected'];
                $summary['outstanding_amount']   += $outstanding;
                $summary[$b['is_ready'] ? 'ready' : 'blocked']++;
            }
            unset($b);

            $summary['outstanding_amount'] = Money::of($summary['outstanding_amount']);

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'booking_no'           => 'Booking No',
                'travel_from'          => 'Departs',
                'travel_to'            => 'Returns',
                'days_to_departure'    => 'Days To Departure',
                'customer_name'        => 'Customer',
                'contact_phone'        => 'Phone',
                'destination_name'     => 'Destination',
                'pax_total'            => 'Pax',
                'unconfirmed_services' => 'Unconfirmed Services',
                'pax_missing_passport' => 'Pax Missing Passport',
                'unissued_vouchers'    => 'Unissued Vouchers',
                'unassigned_transport' => 'Unassigned Transport',
                'outstanding'          => 'Outstanding',
                'is_ready'             => 'Ready',
            ], 'departures-checklist')) {
                return;
            }

            Response::success([
                'window_days' => $days,
                'settings'    => [
                    'balance_due_days_before'     => $balanceDueDays,
                    'passport_expiry_alert_days'  => $passportBuffer,
                ],
                'summary'     => $summary,
                'departures'  => $rows,
            ]);
        });
    }

    // --- Supplier confirmation ---------------------------------------------

    /** POST /booking-services/{id}/confirm  body {confirmation_no, supplier_status} */
    public function confirmService(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(
                Request::only(['confirmation_no', 'supplier_status', 'notes']),
                [
                    'confirmation_no' => 'nullable|string|max:60',
                    'supplier_status' => 'nullable|in:pending,requested,confirmed,waitlisted,cancelled,no_show',
                    'notes'           => 'nullable|string|max:500',
                ]
            );

            $service = Database::fetch(
                'SELECT bs.*, b.booking_no, b.status AS booking_status
                   FROM booking_services bs JOIN bookings b ON b.id = bs.booking_id
                  WHERE bs.id = ? LIMIT 1',
                [$id]
            );
            if ($service === null) {
                Response::notFound('Service line not found');
                return;
            }
            if ($service['booking_status'] === 'cancelled') {
                throw new BusinessRuleException('The booking is cancelled — supplier services cannot be confirmed');
            }

            $status = $data['supplier_status'] ?? 'confirmed';

            // A confirmation without a reference is a confirmation nobody can
            // prove at the hotel desk.
            if ($status === 'confirmed' && trim((string) ($data['confirmation_no'] ?? $service['confirmation_no'])) === '') {
                throw new ValidationException(['confirmation_no' => ['A supplier confirmation number is required']]);
            }

            Database::execute(
                'UPDATE booking_services
                    SET supplier_status = ?,
                        confirmation_no = COALESCE(?, confirmation_no),
                        confirmed_at    = CASE WHEN ? = \'confirmed\' THEN NOW() ELSE NULL END,
                        notes           = COALESCE(?, notes)
                  WHERE id = ?',
                [$status, $data['confirmation_no'] ?? null, $status, $data['notes'] ?? null, $id]
            );

            Audit::logDiff('supplier_status', 'booking_service', $id, $service, [
                'supplier_status' => $status,
                'confirmation_no' => $data['confirmation_no'] ?? $service['confirmation_no'],
            ]);

            Response::success(
                Database::fetch(
                    'SELECT bs.*, s.name AS supplier_name
                       FROM booking_services bs LEFT JOIN suppliers s ON s.id = bs.supplier_id
                      WHERE bs.id = ?',
                    [$id]
                ),
                'Supplier status updated to ' . $status
            );
        });
    }

    // --- Incidents ----------------------------------------------------------

    /** GET /ops/incidents */
    public function incidents(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $clauses = ['1=1'];
            $params  = [];

            if ($s = Request::query('search')) {
                $clauses[] = '(ti.title LIKE ? OR ti.description LIKE ? OR b.booking_no LIKE ?)';
                array_push($params, "%$s%", "%$s%", "%$s%");
            }
            if ($status = Request::query('status')) {
                $clauses[] = 'ti.status = ?';
                $params[]  = $status;
            } elseif (Request::queryBool('open_only', true)) {
                $clauses[] = "ti.status IN ('open','investigating')";
            }
            if ($severity = Request::query('severity')) {
                $clauses[] = 'ti.severity = ?';
                $params[]  = $severity;
            }
            if ($category = Request::query('category')) {
                $clauses[] = 'ti.category = ?';
                $params[]  = $category;
            }
            if ($supplierId = Request::queryInt('supplier_id')) {
                $clauses[] = 'ti.supplier_id = ?';
                $params[]  = $supplierId;
            }
            if ($bookingId = Request::queryInt('booking_id')) {
                $clauses[] = 'ti.booking_id = ?';
                $params[]  = $bookingId;
            }
            if ($from = Request::query('from')) {
                $clauses[] = 'ti.incident_date >= ?';
                $params[]  = $from;
            }
            if ($to = Request::query('to')) {
                $clauses[] = 'ti.incident_date <= ?';
                $params[]  = $to;
            }

            $where = implode(' AND ', $clauses);

            $total = (int) Database::scalar(
                "SELECT COUNT(*) FROM trip_incidents ti JOIN bookings b ON b.id = ti.booking_id WHERE $where",
                $params
            );

            $rows = Database::fetchAll(
                "SELECT ti.*, b.booking_no, b.travel_from, b.travel_to,
                        c.full_name AS customer_name,
                        s.name AS supplier_name, s.supplier_type,
                        r.full_name AS reported_by_name, a.full_name AS assigned_to_name
                   FROM trip_incidents ti
                   JOIN bookings b        ON b.id = ti.booking_id
                   LEFT JOIN customers c  ON c.id = b.customer_id
                   LEFT JOIN suppliers s  ON s.id = ti.supplier_id
                   LEFT JOIN users     r  ON r.id = ti.reported_by
                   LEFT JOIN users     a  ON a.id = ti.assigned_to
                  WHERE $where
                  ORDER BY FIELD(ti.severity,'critical','high','medium','low'), ti.incident_date DESC, ti.id DESC
                  LIMIT $limit OFFSET $offset",
                $params
            );

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** POST /bookings/{id}/incidents */
    public function storeIncident(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');
            $booking   = Booking::findOrFail($bookingId);

            $data = $this->validate(
                Request::only([
                    'incident_date', 'category', 'supplier_id', 'severity', 'title',
                    'description', 'action_taken', 'cost_impact', 'assigned_to',
                ]),
                [
                    'incident_date' => 'nullable|date',
                    'category'      => 'required|in:hotel,transport,activity,guide,medical,weather,flight,customer,other',
                    'supplier_id'   => 'nullable|int|min:1',
                    'severity'      => 'nullable|in:low,medium,high,critical',
                    'title'         => 'required|string|max:200',
                    'description'   => 'nullable|string|max:4000',
                    'action_taken'  => 'nullable|string|max:4000',
                    'cost_impact'   => 'nullable|money',
                    'assigned_to'   => 'nullable|int|min:1',
                ]
            );

            if (!empty($data['supplier_id']) && !Supplier::exists((int) $data['supplier_id'])) {
                throw new ValidationException(['supplier_id' => ['Supplier not found']]);
            }

            $severity = $data['severity'] ?? 'low';

            $id = Database::insert('trip_incidents', [
                'booking_id'    => $bookingId,
                'incident_date' => $data['incident_date'] ?? date('Y-m-d'),
                'category'      => $data['category'],
                'supplier_id'   => !empty($data['supplier_id']) ? (int) $data['supplier_id'] : null,
                'severity'      => $severity,
                'title'         => $data['title'],
                'description'   => $data['description'] ?? null,
                'action_taken'  => $data['action_taken'] ?? null,
                'cost_impact'   => Money::of($data['cost_impact'] ?? 0),
                'status'        => 'open',
                'reported_by'   => Request::userId(),
                'assigned_to'   => !empty($data['assigned_to']) ? (int) $data['assigned_to'] : ($booking['ops_owner_id'] ?? null),
            ], [
                'booking_id', 'incident_date', 'category', 'supplier_id', 'severity', 'title',
                'description', 'action_taken', 'cost_impact', 'status', 'reported_by', 'assigned_to',
            ]);

            Notifier::push(
                'trip_incident',
                strtoupper($severity) . ' incident on ' . $booking['booking_no'],
                $data['title'],
                !empty($data['assigned_to']) ? (int) $data['assigned_to'] : null,
                'operations',
                'booking',
                $bookingId,
                in_array($severity, ['high', 'critical'], true) ? 'critical' : 'warning'
            );

            Audit::log('incident_reported', 'booking', $bookingId, null, [
                'incident_id' => $id, 'severity' => $severity, 'title' => $data['title'],
            ]);

            Response::created(Database::fetch('SELECT * FROM trip_incidents WHERE id = ?', [$id]), 'Incident logged');
        });
    }

    /** POST /incidents/{id}/resolve  body {action_taken, cost_impact, status} */
    public function resolveIncident(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(
                Request::only(['action_taken', 'cost_impact', 'status']),
                [
                    'action_taken' => 'required|string|max:4000',
                    'cost_impact'  => 'nullable|money',
                    'status'       => 'nullable|in:resolved,closed',
                ]
            );

            $incident = Database::fetch('SELECT * FROM trip_incidents WHERE id = ? LIMIT 1', [$id]);
            if ($incident === null) {
                Response::notFound('Incident not found');
                return;
            }
            if (in_array($incident['status'], ['resolved', 'closed'], true)) {
                throw new BusinessRuleException('Incident is already ' . $incident['status']);
            }

            $status = $data['status'] ?? 'resolved';

            Database::execute(
                'UPDATE trip_incidents
                    SET status = ?, action_taken = ?, cost_impact = COALESCE(?, cost_impact), resolved_at = NOW()
                  WHERE id = ?',
                [
                    $status,
                    $data['action_taken'],
                    isset($data['cost_impact']) ? Money::of($data['cost_impact']) : null,
                    $id,
                ]
            );

            // A resolved incident against a supplier changes how they score.
            if (!empty($incident['supplier_id'])) {
                Supplier::refreshRating((int) $incident['supplier_id']);
            }

            Audit::log('incident_resolved', 'booking', (int) $incident['booking_id'], $incident, [
                'incident_id' => $id, 'status' => $status,
            ]);

            Response::success(Database::fetch('SELECT * FROM trip_incidents WHERE id = ?', [$id]), 'Incident ' . $status);
        });
    }

    // --- Attachments --------------------------------------------------------
    // The polymorphic attachment store is exposed once, here, rather than being
    // duplicated per module: passports, visas, receipts, supplier bills and trip
    // photos all share one table, one validator and one download path.

    /** POST /attachments  multipart: file, entity_type, entity_id, category */
    public function uploadAttachment(): void
    {
        $this->run(function () {
            $data = $this->validate(
                Request::only(['entity_type', 'entity_id', 'category', 'label']),
                [
                    'entity_type' => 'required|string|max:60',
                    'entity_id'   => 'required|int|min:1',
                    'category'    => 'required|in:' . implode(',', FileStore::categories()),
                    'label'       => 'nullable|string|max:120',
                ]
            );

            if (empty($_FILES['file'])) {
                throw new ValidationException(['file' => ['No file was uploaded']]);
            }

            $entityType = $this->assertAttachableEntity((string) $data['entity_type'], (int) $data['entity_id']);

            $id = FileStore::createAttachment(
                $entityType,
                (int) $data['entity_id'],
                $_FILES['file'],
                (string) $data['category'],
                !empty($data['label']) ? ['label' => $data['label']] : null
            );

            Response::created(FileStore::find($id), 'File uploaded');
        });
    }

    /** GET /attachments?entity_type=&entity_id=&category= */
    public function listAttachments(): void
    {
        $this->run(function () {
            $entityType = (string) Request::query('entity_type', '');
            $entityId   = Request::queryInt('entity_id');

            if ($entityType === '' || $entityId < 1) {
                throw new ValidationException(['entity_id' => ['entity_type and entity_id are required']]);
            }

            Response::success(FileStore::forEntity($entityType, $entityId, Request::query('category')));
        });
    }

    /** GET /attachments/{id} */
    public function streamAttachment(): void
    {
        $this->run(static function () {
            FileStore::stream(Request::paramInt('id'));
        });
    }

    /** DELETE /attachments/{id} */
    public function deleteAttachment(): void
    {
        $this->run(static function () {
            FileStore::delete(Request::paramInt('id'));
            Response::success(null, 'File deleted');
        });
    }

    // -----------------------------------------------------------------------

    private function dateOrToday($value): string
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '') {
            return date('Y-m-d');
        }
        $parsed = DateTime::createFromFormat('Y-m-d', $value);
        if ($parsed === false || $parsed->format('Y-m-d') !== $value) {
            throw new ValidationException(['date' => ['Date must be in YYYY-MM-DD format']]);
        }
        return $value;
    }

    private function departuresOn(string $date): array
    {
        return Database::fetchAll(
            "SELECT b.id, b.booking_no, b.lead_pax_name, b.contact_phone, b.adults, b.children,
                    b.travel_from, b.travel_to, b.payment_status,
                    (b.grand_total - b.amount_paid) AS outstanding,
                    c.full_name AS customer_name, d.name AS destination_name
               FROM bookings b
               LEFT JOIN customers    c ON c.id = b.customer_id
               LEFT JOIN destinations d ON d.id = b.destination_id
              WHERE b.travel_from = ? AND b.status NOT IN ('cancelled','draft')
              ORDER BY b.booking_no ASC",
            [$date]
        );
    }

    private function arrivalsOn(string $date): array
    {
        return Database::fetchAll(
            "SELECT b.id, b.booking_no, b.lead_pax_name, b.contact_phone, b.adults, b.children,
                    b.travel_from, b.travel_to,
                    c.full_name AS customer_name, d.name AS destination_name
               FROM bookings b
               LEFT JOIN customers    c ON c.id = b.customer_id
               LEFT JOIN destinations d ON d.id = b.destination_id
              WHERE b.travel_to = ? AND b.status NOT IN ('cancelled','draft')
              ORDER BY b.booking_no ASC",
            [$date]
        );
    }

    /** Crude but useful: five equally-weighted readiness gates. */
    private function readinessPct(array $b): int
    {
        $gates = [
            (int) $b['service_count'] > 0 && (int) $b['unconfirmed_services'] === 0,
            (int) $b['pax_unnamed'] === 0,
            !$b['international'] || ((int) $b['pax_missing_passport'] === 0 && (int) $b['pax_passport_expired'] === 0),
            (int) $b['unissued_vouchers'] === 0,
            (int) $b['unassigned_transport'] === 0,
            !Money::greaterThan((float) $b['outstanding'], 0),
        ];

        return (int) round(count(array_filter($gates)) / count($gates) * 100);
    }

    /** @return array validated payload for a trip assignment */
    private function tripAssignmentPayload(bool $isCreate): array
    {
        $required = $isCreate ? 'required' : 'nullable';

        $data = $this->validate(
            Request::only([
                'booking_service_id', 'vehicle_id', 'driver_id', 'guide_id', 'guide_source',
                'supplier_id', 'from_date', 'to_date', 'pickup_point', 'pickup_time',
                'drop_point', 'route_summary', 'estimated_km', 'notes',
            ]),
            [
                'booking_service_id' => 'nullable|int|min:1',
                'vehicle_id'         => 'nullable|int|min:1',
                'driver_id'          => 'nullable|int|min:1',
                'guide_id'           => 'nullable|int|min:1',
                'guide_source'       => 'nullable|in:staff,supplier',
                'supplier_id'        => 'nullable|int|min:1',
                'from_date'          => "$required|date",
                'to_date'            => "$required|date",
                'pickup_point'       => 'nullable|string|max:255',
                'pickup_time'        => 'nullable|time',
                'drop_point'         => 'nullable|string|max:255',
                'route_summary'      => 'nullable|string|max:500',
                'estimated_km'       => 'nullable|int|min:0|max:100000',
                'notes'              => 'nullable|string|max:500',
            ]
        );

        if ($isCreate) {
            Validator::assertDateOrder($data['from_date'], $data['to_date'], 'to_date');
            if (empty($data['vehicle_id']) && empty($data['driver_id']) && empty($data['supplier_id'])) {
                throw new ValidationException([
                    'vehicle_id' => ['Assign at least a vehicle, a driver or a transport supplier'],
                ]);
            }
        }

        // An explicit `null` from the client on a NOT NULL column would surface as
        // a driver-level 1048 rather than a validation error. Drop it and let the
        // column default (on insert) or the stored value (on update) stand.
        foreach (['from_date', 'to_date', 'estimated_km', 'guide_source'] as $notNull) {
            if (array_key_exists($notNull, $data) && $data[$notNull] === null) {
                unset($data[$notNull]);
            }
        }

        return $data;
    }

    private function assertTripWindow(array $booking, string $from, string $to): void
    {
        // Overlap, not containment: a pre-tour airport pickup the night before is
        // legitimate, a date in a different month is a typo.
        if ($to < (string) $booking['travel_from'] || $from > (string) $booking['travel_to']) {
            throw new ValidationException(['from_date' => [
                'Trip dates must overlap the booking travel window ('
                . $booking['travel_from'] . ' to ' . $booking['travel_to'] . ')',
            ]]);
        }
    }

    private function assertResourcesExist(array $data): void
    {
        if (!empty($data['vehicle_id'])) {
            $ok = Database::scalar(
                'SELECT 1 FROM vehicles WHERE id = ? AND is_deleted = 0 AND is_active = 1 LIMIT 1',
                [(int) $data['vehicle_id']]
            );
            if ($ok === null) {
                throw new ValidationException(['vehicle_id' => ['Vehicle not found or inactive']]);
            }
        }
        if (!empty($data['driver_id'])) {
            $ok = Database::scalar(
                'SELECT 1 FROM drivers WHERE id = ? AND is_deleted = 0 AND is_active = 1 LIMIT 1',
                [(int) $data['driver_id']]
            );
            if ($ok === null) {
                throw new ValidationException(['driver_id' => ['Driver not found or inactive']]);
            }
        }
        if (!empty($data['supplier_id']) && !Supplier::exists((int) $data['supplier_id'])) {
            throw new ValidationException(['supplier_id' => ['Supplier not found']]);
        }
    }

    /**
     * Only entities that actually exist may be attached to, and only from a fixed
     * list — otherwise `entity_type` becomes a free-text field pointing at rows
     * nobody can ever clean up.
     */
    private function assertAttachableEntity(string $entityType, int $entityId): string
    {
        $tables = [
            'booking'         => 'bookings',
            'booking_pax'     => 'booking_pax',
            'booking_service' => 'booking_services',
            'customer'        => 'customers',
            'supplier'        => 'suppliers',
            'supplier_bill'   => 'supplier_bills',
            'expense'         => 'expenses',
            'voucher'         => 'vouchers',
            'invoice'         => 'invoices',
            'package'         => 'packages',
            'hotel'           => 'hotels',
            'trip_sheet'      => 'trip_sheets',
            'trip_incident'   => 'trip_incidents',
            'import_job'      => 'import_jobs',
        ];

        $table = $tables[$entityType] ?? null;
        if ($table === null) {
            throw new ValidationException(['entity_type' => [
                'Attachments are not supported for "' . $entityType . '"',
            ]]);
        }
        // $table comes from the constant map above, never from the request.
        if (Database::scalar("SELECT 1 FROM `$table` WHERE id = ? LIMIT 1", [$entityId]) === null) {
            throw new NotFoundException(ucfirst(str_replace('_', ' ', $entityType)) . ' not found');
        }

        return $entityType;
    }
}
