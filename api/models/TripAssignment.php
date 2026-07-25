<?php

/**
 * Transport assignment and the trip sheet it produces.
 *
 * One model owns both tables because they are one workflow: a vehicle+driver are
 * assigned to a booking for a date range, the trip runs, and the driver returns a
 * sheet of odometer readings and out-of-pocket costs that reconciles the estimated
 * transport cost against the actual one.
 *
 * Double-booking is prevented in PHP rather than by a unique constraint, because
 * split-day trips and shared transfers are legitimately overlapping — see
 * hasClash(), which reports the conflict instead of silently blocking it.
 */
class TripAssignment extends Model
{
    protected const TABLE    = 'trip_assignments';
    protected const FILLABLE = [
        'booking_id', 'booking_service_id', 'vehicle_id', 'driver_id', 'guide_id',
        'guide_source', 'supplier_id', 'from_date', 'to_date', 'pickup_point',
        'pickup_time', 'drop_point', 'route_summary', 'estimated_km', 'status',
        'previous_status', 'driver_notified_at', 'notes',
    ];
    protected const SORTABLE = ['id', 'from_date', 'to_date', 'status', 'created_at'];

    /** Statuses that still hold a vehicle/driver. A cancelled trip frees them. */
    public const ACTIVE_STATUSES = ['planned', 'confirmed', 'dispatched', 'in_progress', 'completed'];

    private const TRANSITIONS = [
        'planned'     => ['confirmed', 'cancelled'],
        'confirmed'   => ['dispatched', 'cancelled'],
        'dispatched'  => ['in_progress', 'cancelled'],
        'in_progress' => ['completed', 'cancelled'],
        'completed'   => [],
        'cancelled'   => [],
    ];

    private const SHEET_COST_COLUMNS = ['fuel_amount', 'toll_amount', 'parking_amount', 'driver_allowance', 'other_amount'];

    public static function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    public static function allowedTransitions(string $from): array
    {
        return self::TRANSITIONS[$from] ?? [];
    }

    /** @return array{0:array, 1:int} */
    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['1=1', []]];

        // Overlap semantics: any assignment whose window intersects [from, to].
        if (!empty($filters['from'])) {
            $clauses[] = ['ta.to_date >= ?', [$filters['from']]];
        }
        if (!empty($filters['to'])) {
            $clauses[] = ['ta.from_date <= ?', [$filters['to']]];
        }
        if (!empty($filters['vehicle_id'])) {
            $clauses[] = ['ta.vehicle_id = ?', [(int) $filters['vehicle_id']]];
        }
        if (!empty($filters['driver_id'])) {
            $clauses[] = ['ta.driver_id = ?', [(int) $filters['driver_id']]];
        }
        if (!empty($filters['supplier_id'])) {
            $clauses[] = ['ta.supplier_id = ?', [(int) $filters['supplier_id']]];
        }
        if (!empty($filters['booking_id'])) {
            $clauses[] = ['ta.booking_id = ?', [(int) $filters['booking_id']]];
        }
        if (!empty($filters['status'])) {
            $statuses = is_array($filters['status']) ? $filters['status'] : explode(',', (string) $filters['status']);
            $statuses = array_values(array_filter(array_map('trim', $statuses)));
            if ($statuses !== []) {
                $marks = implode(',', array_fill(0, count($statuses), '?'));
                $clauses[] = ["ta.status IN ($marks)", $statuses];
            }
        }
        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(b.booking_no LIKE ? OR v.registration_no LIKE ? OR dr.full_name LIKE ? OR ta.route_summary LIKE ?)',
                          [$like, $like, $like, $like]];
        }

        [$scopeSql, $scopeParams] = AuthMiddleware::agencyScope('b.agency_id');
        $clauses[] = [$scopeSql, $scopeParams];

        [$where, $params] = self::buildWhere($clauses);

        $total = (int) Database::scalar(
            "SELECT COUNT(*)
               FROM trip_assignments ta
               JOIN bookings b        ON b.id  = ta.booking_id
               LEFT JOIN vehicles v   ON v.id  = ta.vehicle_id
               LEFT JOIN drivers  dr  ON dr.id = ta.driver_id
              WHERE $where",
            $params
        );

        $sortCol = self::assertSortable($sort, 'from_date');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT ta.*,
                    b.booking_no, b.lead_pax_name, b.contact_phone, b.adults, b.children,
                    b.travel_from, b.travel_to, b.status AS booking_status,
                    c.full_name AS customer_name,
                    v.registration_no, vt.name AS vehicle_type_name, vt.seat_count,
                    dr.full_name AS driver_name, dr.phone AS driver_phone,
                    s.name AS supplier_name,
                    bs.description AS service_description,
                    (SELECT COUNT(*) FROM trip_sheets ts WHERE ts.trip_assignment_id = ta.id) AS sheet_count,
                    (SELECT COALESCE(SUM(ts.total_amount), 0) FROM trip_sheets ts
                      WHERE ts.trip_assignment_id = ta.id AND ts.status = 'approved') AS actual_cost
               FROM trip_assignments ta
               JOIN bookings b            ON b.id  = ta.booking_id
               LEFT JOIN customers c      ON c.id  = b.customer_id
               LEFT JOIN vehicles v       ON v.id  = ta.vehicle_id
               LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
               LEFT JOIN drivers dr       ON dr.id = ta.driver_id
               LEFT JOIN suppliers s      ON s.id  = ta.supplier_id
               LEFT JOIN booking_services bs ON bs.id = ta.booking_service_id
              WHERE $where
              ORDER BY ta.$sortCol $sortDir, ta.id DESC
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $ta = Database::fetch(
            'SELECT ta.*,
                    b.booking_no, b.lead_pax_name, b.contact_phone, b.contact_email,
                    b.adults, b.children, b.infants, b.travel_from, b.travel_to,
                    b.status AS booking_status, b.agency_id, b.special_requests,
                    c.full_name AS customer_name, c.phone AS customer_phone,
                    v.registration_no, v.model_year, vt.name AS vehicle_type_name,
                    vt.seat_count, vt.is_ac,
                    dr.full_name AS driver_name, dr.phone AS driver_phone,
                    dr.alt_phone AS driver_alt_phone, dr.licence_no, dr.languages,
                    s.name AS supplier_name, s.phone AS supplier_phone,
                    bs.description AS service_description, bs.service_date, bs.service_end_date,
                    g.full_name AS guide_name
               FROM trip_assignments ta
               JOIN bookings b            ON b.id  = ta.booking_id
               LEFT JOIN customers c      ON c.id  = b.customer_id
               LEFT JOIN vehicles v       ON v.id  = ta.vehicle_id
               LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
               LEFT JOIN drivers dr       ON dr.id = ta.driver_id
               LEFT JOIN suppliers s      ON s.id  = ta.supplier_id
               LEFT JOIN booking_services bs ON bs.id = ta.booking_service_id
               LEFT JOIN users g          ON g.id  = ta.guide_id AND ta.guide_source = \'staff\'
              WHERE ta.id = ? LIMIT 1',
            [$id]
        );
        if ($ta === null) {
            return null;
        }

        $ta['trip_sheets'] = self::sheetsFor($id);
        $ta['allowed_transitions'] = self::allowedTransitions((string) $ta['status']);
        $ta['pax'] = Database::fetchAll(
            'SELECT pax_no, title, first_name, last_name, pax_type, phone, is_lead_pax
               FROM booking_pax WHERE booking_id = ? ORDER BY pax_no ASC',
            [(int) $ta['booking_id']]
        );

        return $ta;
    }

    public static function sheetsFor(int $assignmentId): array
    {
        return Database::fetchAll(
            'SELECT ts.*, u.full_name AS approved_by_name, cr.full_name AS submitted_by_name
               FROM trip_sheets ts
               LEFT JOIN users u  ON u.id  = ts.approved_by
               LEFT JOIN users cr ON cr.id = ts.created_by
              WHERE ts.trip_assignment_id = ?
              ORDER BY ts.sheet_date ASC, ts.id ASC',
            [$assignmentId]
        );
    }

    /**
     * Rows where the same vehicle or driver is already committed over an
     * overlapping date range.
     *
     * Returns the conflicting assignments (with their booking numbers) rather than
     * a bare boolean, so the caller can name the clash in the 409 it raises.
     */
    public static function hasClash(?int $vehicleId, ?int $driverId, string $fromDate, string $toDate, ?int $exceptId = null): array
    {
        $resource = [];
        $params   = [];

        if ($vehicleId !== null && $vehicleId > 0) {
            $resource[] = 'ta.vehicle_id = ?';
            $params[]   = $vehicleId;
        }
        if ($driverId !== null && $driverId > 0) {
            $resource[] = 'ta.driver_id = ?';
            $params[]   = $driverId;
        }
        if ($resource === []) {
            return [];   // nothing to double-book
        }

        $sql = "SELECT ta.id, ta.booking_id, ta.vehicle_id, ta.driver_id,
                       ta.from_date, ta.to_date, ta.status, ta.pickup_point, ta.pickup_time,
                       b.booking_no, b.lead_pax_name,
                       v.registration_no, dr.full_name AS driver_name
                  FROM trip_assignments ta
                  JOIN bookings b       ON b.id  = ta.booking_id
                  LEFT JOIN vehicles v  ON v.id  = ta.vehicle_id
                  LEFT JOIN drivers dr  ON dr.id = ta.driver_id
                 WHERE ta.status <> 'cancelled'
                   AND ta.from_date <= ? AND ta.to_date >= ?
                   AND (" . implode(' OR ', $resource) . ')';

        // Date bounds are bound first because they precede the resource clause.
        $bind = array_merge([$toDate, $fromDate], $params);

        if ($exceptId !== null && $exceptId > 0) {
            $sql .= ' AND ta.id <> ?';
            $bind[] = $exceptId;
        }

        $rows = Database::fetchAll($sql . ' ORDER BY ta.from_date ASC LIMIT 20', $bind);

        // Label which resource actually clashed so the message is specific.
        foreach ($rows as &$row) {
            $on = [];
            if ($vehicleId !== null && (int) $row['vehicle_id'] === (int) $vehicleId) {
                $on[] = 'vehicle ' . ($row['registration_no'] ?? $vehicleId);
            }
            if ($driverId !== null && (int) $row['driver_id'] === (int) $driverId) {
                $on[] = 'driver ' . ($row['driver_name'] ?? $driverId);
            }
            $row['conflict_on'] = $on;
        }
        unset($row);

        return $rows;
    }

    /** Build a human-readable clash message for a 409. */
    public static function describeClash(array $clashes): string
    {
        $parts = [];
        foreach ($clashes as $c) {
            $parts[] = sprintf(
                '%s is already assigned to booking %s from %s to %s (%s)',
                ucfirst(implode(' and ', $c['conflict_on'] ?: ['This resource'])),
                $c['booking_no'],
                $c['from_date'],
                $c['to_date'],
                $c['status']
            );
        }
        return implode('; ', $parts);
    }

    public static function createFor(int $bookingId, array $data): int
    {
        return Database::transaction(static function () use ($bookingId, $data) {
            $booking = Booking::findOrFail($bookingId);
            if (in_array($booking['status'], ['cancelled', 'completed'], true)) {
                throw new BusinessRuleException('Transport cannot be assigned to a ' . $booking['status'] . ' booking');
            }

            $payload = array_merge($data, [
                'booking_id' => $bookingId,
                'status'     => $data['status'] ?? 'planned',
            ]);

            $id = self::create($payload);

            Audit::log('trip_assigned', 'booking', $bookingId, null, [
                'trip_assignment_id' => $id,
                'vehicle_id'         => $data['vehicle_id'] ?? null,
                'driver_id'          => $data['driver_id'] ?? null,
                'from_date'          => $data['from_date'] ?? null,
                'to_date'            => $data['to_date'] ?? null,
            ]);

            return $id;
        });
    }

    public static function updateFor(int $id, array $data): void
    {
        Database::transaction(static function () use ($id, $data) {
            $before = self::findOrFail($id);

            if (in_array($before['status'], ['completed', 'cancelled'], true)) {
                throw new BusinessRuleException('A ' . $before['status'] . ' trip assignment cannot be edited');
            }

            self::updateById($id, $data);
            Audit::logDiff('update', 'trip_assignment', $id, $before, $data);
        });
    }

    public static function changeStatus(int $id, string $to, ?string $note = null): array
    {
        return Database::transaction(static function () use ($id, $to, $note) {
            $ta = Database::fetch('SELECT * FROM trip_assignments WHERE id = ? FOR UPDATE', [$id]);
            if ($ta === null) {
                throw new NotFoundException('Trip assignment not found');
            }

            $from = (string) $ta['status'];
            if (!self::canTransition($from, $to)) {
                throw new BusinessRuleException(
                    'Cannot move a trip assignment from "' . $from . '" to "' . $to . '"'
                );
            }

            // Dispatching is the moment the driver is told; stamp it so nobody
            // has to guess whether the call was made.
            $extra = $to === 'dispatched' ? ', driver_notified_at = NOW()' : '';

            Database::execute(
                "UPDATE trip_assignments SET previous_status = status, status = ?$extra WHERE id = ?",
                [$to, $id]
            );

            Database::insert('workflow_history', [
                'entity_type' => 'trip_assignment',
                'entity_id'   => $id,
                'from_status' => $from,
                'to_status'   => $to,
                'note'        => $note !== null ? mb_substr($note, 0, 255) : null,
                'actor_id'    => Request::userId(),
            ], ['entity_type', 'entity_id', 'from_status', 'to_status', 'note', 'actor_id']);

            Audit::log('trip_status', 'trip_assignment', $id, ['status' => $from], ['status' => $to]);

            return ['from' => $from, 'to' => $to];
        });
    }

    /**
     * Record (or correct) the sheet for one day of a trip.
     *
     * total_km and total_amount are always derived here — never taken from the
     * client — so a driver cannot claim 900 km on a 90 km run by editing a total.
     * One sheet per (assignment, date); resubmitting a draft or rejected sheet
     * overwrites it, an approved one is frozen.
     */
    public static function submitTripSheet(int $assignmentId, array $data): int
    {
        return Database::transaction(static function () use ($assignmentId, $data) {
            $ta = self::findOrFail($assignmentId);

            if ($ta['status'] === 'cancelled') {
                throw new BusinessRuleException('A cancelled trip assignment cannot have a trip sheet');
            }
            if ($ta['status'] === 'planned') {
                throw new BusinessRuleException('Confirm and dispatch the trip before submitting a trip sheet');
            }

            $sheetDate = (string) ($data['sheet_date'] ?? date('Y-m-d'));
            if ($sheetDate < (string) $ta['from_date'] || $sheetDate > (string) $ta['to_date']) {
                throw new ValidationException([
                    'sheet_date' => ['Sheet date must fall inside the trip window ' . $ta['from_date'] . ' to ' . $ta['to_date']],
                ]);
            }

            $startKm = max(0, (int) ($data['start_km'] ?? 0));
            $endKm   = max(0, (int) ($data['end_km'] ?? 0));
            if ($endKm < $startKm) {
                throw new ValidationException(['end_km' => ['Closing odometer cannot be lower than the opening reading']]);
            }
            $totalKm = $endKm - $startKm;

            $costs = [];
            foreach (self::SHEET_COST_COLUMNS as $col) {
                $value = Money::of($data[$col] ?? 0);
                if (!Money::isNonNegative($value)) {
                    throw new ValidationException([$col => ['Amount cannot be negative']]);
                }
                $costs[$col] = $value;
            }
            $totalAmount = Money::sum(array_values($costs));

            $existing = Database::fetch(
                'SELECT * FROM trip_sheets WHERE trip_assignment_id = ? AND sheet_date = ? LIMIT 1',
                [$assignmentId, $sheetDate]
            );

            $row = array_merge($costs, [
                'trip_assignment_id' => $assignmentId,
                'sheet_date'         => $sheetDate,
                'start_km'           => $startKm,
                'end_km'             => $endKm,
                'total_km'           => $totalKm,
                'start_time'         => $data['start_time'] ?? null,
                'end_time'           => $data['end_time'] ?? null,
                'total_amount'       => $totalAmount,
                'odometer_photo'     => $data['odometer_photo'] ?? null,
                'remarks'            => isset($data['remarks']) ? mb_substr((string) $data['remarks'], 0, 500) : null,
                'status'             => 'submitted',
            ]);

            $allowed = array_merge(self::SHEET_COST_COLUMNS, [
                'trip_assignment_id', 'sheet_date', 'start_km', 'end_km', 'total_km',
                'start_time', 'end_time', 'total_amount', 'odometer_photo', 'remarks', 'status',
            ]);

            if ($existing === null) {
                $row['created_by'] = Request::userId();
                $sheetId = Database::insert('trip_sheets', $row, array_merge($allowed, ['created_by']));
            } else {
                if ($existing['status'] === 'approved') {
                    throw new BusinessRuleException('The trip sheet for ' . $sheetDate . ' is already approved and cannot be changed');
                }
                $sheetId = (int) $existing['id'];
                // A resubmission clears any previous rejection.
                $row['rejection_reason'] = null;
                Database::update('trip_sheets', $sheetId, $row, array_merge($allowed, ['rejection_reason']));
            }

            // A trip sheet means the vehicle actually moved.
            if ($ta['status'] === 'dispatched') {
                Database::execute(
                    "UPDATE trip_assignments SET previous_status = status, status = 'in_progress' WHERE id = ?",
                    [$assignmentId]
                );
            }

            Audit::log('trip_sheet_submitted', 'trip_assignment', $assignmentId, null, [
                'trip_sheet_id' => $sheetId, 'sheet_date' => $sheetDate,
                'total_km' => $totalKm, 'total_amount' => $totalAmount,
            ]);

            return $sheetId;
        });
    }

    public static function approveTripSheet(int $sheetId): void
    {
        Database::transaction(static function () use ($sheetId) {
            $sheet = Database::fetch('SELECT * FROM trip_sheets WHERE id = ? FOR UPDATE', [$sheetId]);
            if ($sheet === null) {
                throw new NotFoundException('Trip sheet not found');
            }
            if ($sheet['status'] === 'approved') {
                throw new BusinessRuleException('Trip sheet is already approved');
            }
            if ($sheet['status'] === 'draft') {
                throw new BusinessRuleException('Submit the trip sheet before approving it');
            }

            Database::execute(
                "UPDATE trip_sheets SET status = 'approved', approved_by = ?, approved_at = NOW(),
                        rejection_reason = NULL
                  WHERE id = ?",
                [Request::userId(), $sheetId]
            );

            Audit::log('trip_sheet_approved', 'trip_assignment', (int) $sheet['trip_assignment_id'], null, [
                'trip_sheet_id' => $sheetId, 'total_amount' => $sheet['total_amount'],
            ]);
        });
    }

    public static function rejectTripSheet(int $sheetId, string $reason): void
    {
        Database::transaction(static function () use ($sheetId, $reason) {
            $sheet = Database::fetch('SELECT * FROM trip_sheets WHERE id = ? FOR UPDATE', [$sheetId]);
            if ($sheet === null) {
                throw new NotFoundException('Trip sheet not found');
            }
            if ($sheet['status'] === 'approved') {
                throw new BusinessRuleException('An approved trip sheet cannot be rejected. Raise a correction instead.');
            }

            Database::execute(
                "UPDATE trip_sheets SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = NOW()
                  WHERE id = ?",
                [mb_substr($reason, 0, 255), Request::userId(), $sheetId]
            );

            Audit::log('trip_sheet_rejected', 'trip_assignment', (int) $sheet['trip_assignment_id'], null, [
                'trip_sheet_id' => $sheetId, 'reason' => $reason,
            ]);
        });
    }

    /** Assignments overlapping a date — the transport row of the ops board. */
    public static function forDate(string $date): array
    {
        return Database::fetchAll(
            "SELECT ta.id, ta.booking_id, ta.from_date, ta.to_date, ta.status,
                    ta.pickup_point, ta.pickup_time, ta.drop_point, ta.route_summary,
                    b.booking_no, b.lead_pax_name, b.contact_phone,
                    v.registration_no, vt.name AS vehicle_type_name,
                    dr.full_name AS driver_name, dr.phone AS driver_phone
               FROM trip_assignments ta
               JOIN bookings b            ON b.id  = ta.booking_id
               LEFT JOIN vehicles v       ON v.id  = ta.vehicle_id
               LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
               LEFT JOIN drivers dr       ON dr.id = ta.driver_id
              WHERE ? BETWEEN ta.from_date AND ta.to_date
                AND ta.status <> 'cancelled'
              ORDER BY ta.pickup_time ASC, b.booking_no ASC",
            [$date]
        );
    }
}
