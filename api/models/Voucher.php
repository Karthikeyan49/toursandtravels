<?php

/**
 * Client-facing vouchers.
 *
 * A voucher is a SNAPSHOT. content_json freezes the company profile, the booking,
 * the passenger list, the service line and the supplier at the moment of issue, so
 * a later itinerary edit or a settings change can never rewrite a document the
 * guest is already carrying to the hotel desk.
 *
 * Vouchers are never deleted — they are cancelled.
 */
class Voucher extends Model
{
    protected const TABLE    = 'vouchers';
    protected const FILLABLE = [
        'voucher_no', 'booking_id', 'booking_service_id', 'voucher_type', 'supplier_id',
        'issued_to', 'valid_from', 'valid_to', 'content_json', 'file_path',
        'status', 'issued_at', 'sent_at', 'cancelled_at',
    ];
    protected const SORTABLE = ['id', 'voucher_no', 'voucher_type', 'status', 'issued_at', 'created_at'];

    public const TYPES = ['hotel', 'transport', 'activity', 'flight', 'tour', 'visa', 'insurance'];

    /** Statuses in which a voucher is a live document the guest may present. */
    public const LIVE_STATUSES = ['issued', 'sent'];

    /**
     * booking_services.service_type → vouchers.voucher_type.
     * The two enums deliberately differ: several service types collapse onto one
     * printed document (train and coach transfers are both "transport").
     */
    private const SERVICE_TYPE_MAP = [
        'hotel'     => 'hotel',
        'transport' => 'transport',
        'activity'  => 'activity',
        'flight'    => 'flight',
        'train'     => 'transport',
        'visa'      => 'visa',
        'insurance' => 'insurance',
        'guide'     => 'activity',
        'meal'      => 'activity',
        'other'     => 'tour',
    ];

    public static function voucherTypeForService(string $serviceType): string
    {
        return self::SERVICE_TYPE_MAP[$serviceType] ?? 'tour';
    }

    /** @return array{0:array, 1:int} */
    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['1=1', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(v.voucher_no LIKE ? OR b.booking_no LIKE ? OR v.issued_to LIKE ?)', [$like, $like, $like]];
        }
        if (!empty($filters['booking_id'])) {
            $clauses[] = ['v.booking_id = ?', [(int) $filters['booking_id']]];
        }
        if (!empty($filters['voucher_type'])) {
            $clauses[] = ['v.voucher_type = ?', [(string) $filters['voucher_type']]];
        }
        if (!empty($filters['supplier_id'])) {
            $clauses[] = ['v.supplier_id = ?', [(int) $filters['supplier_id']]];
        }
        if (!empty($filters['status'])) {
            $statuses = is_array($filters['status']) ? $filters['status'] : explode(',', (string) $filters['status']);
            $statuses = array_values(array_filter(array_map('trim', $statuses)));
            if ($statuses !== []) {
                $marks = implode(',', array_fill(0, count($statuses), '?'));
                $clauses[] = ["v.status IN ($marks)", $statuses];
            }
        }
        // Date window is on the travel dates the voucher covers, not on issue date:
        // "show me every voucher valid next week" is the question ops actually asks.
        if (!empty($filters['from'])) {
            $clauses[] = ['COALESCE(v.valid_to, b.travel_to) >= ?', [$filters['from']]];
        }
        if (!empty($filters['to'])) {
            $clauses[] = ['COALESCE(v.valid_from, b.travel_from) <= ?', [$filters['to']]];
        }

        [$scopeSql, $scopeParams] = AuthMiddleware::agencyScope('b.agency_id');
        $clauses[] = [$scopeSql, $scopeParams];

        [$where, $params] = self::buildWhere($clauses);

        $total = (int) Database::scalar(
            "SELECT COUNT(*) FROM vouchers v JOIN bookings b ON b.id = v.booking_id WHERE $where",
            $params
        );

        $sortCol = self::assertSortable($sort, 'issued_at');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT v.id, v.voucher_no, v.booking_id, v.booking_service_id, v.voucher_type,
                    v.supplier_id, v.issued_to, v.valid_from, v.valid_to, v.file_path,
                    v.status, v.issued_at, v.sent_at, v.cancelled_at, v.created_at,
                    b.booking_no, b.travel_from, b.travel_to, b.status AS booking_status,
                    c.full_name AS customer_name, c.phone AS customer_phone,
                    s.name AS supplier_name, s.phone AS supplier_phone,
                    bs.description AS service_description, bs.confirmation_no,
                    u.full_name AS issued_by_name
               FROM vouchers v
               JOIN bookings b          ON b.id  = v.booking_id
               LEFT JOIN customers c    ON c.id  = b.customer_id
               LEFT JOIN suppliers s    ON s.id  = v.supplier_id
               LEFT JOIN booking_services bs ON bs.id = v.booking_service_id
               LEFT JOIN users u        ON u.id  = v.created_by
              WHERE $where
              ORDER BY v.$sortCol $sortDir, v.id DESC
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $v = Database::fetch(
            'SELECT v.*, b.booking_no, b.travel_from, b.travel_to, b.status AS booking_status,
                    b.agency_id, b.adults, b.children, b.infants, b.contact_phone, b.contact_email,
                    c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
                    s.name AS supplier_name, s.phone AS supplier_phone, s.address AS supplier_address,
                    bs.description AS service_description, bs.confirmation_no, bs.supplier_status,
                    u.full_name AS issued_by_name
               FROM vouchers v
               JOIN bookings b          ON b.id  = v.booking_id
               LEFT JOIN customers c    ON c.id  = b.customer_id
               LEFT JOIN suppliers s    ON s.id  = v.supplier_id
               LEFT JOIN booking_services bs ON bs.id = v.booking_service_id
               LEFT JOIN users u        ON u.id  = v.created_by
              WHERE v.id = ? LIMIT 1',
            [$id]
        );
        if ($v === null) {
            return null;
        }

        // The snapshot is what gets printed; the joined columns above are only
        // there so a list screen can show live context beside it.
        $decoded = json_decode((string) $v['content_json'], true);
        $v['content'] = is_array($decoded) ? $decoded : null;

        return $v;
    }

    public static function forBooking(int $bookingId): array
    {
        return Database::fetchAll(
            'SELECT v.id, v.voucher_no, v.booking_service_id, v.voucher_type, v.supplier_id,
                    v.issued_to, v.valid_from, v.valid_to, v.status, v.issued_at, v.sent_at,
                    v.cancelled_at, s.name AS supplier_name, bs.description AS service_description
               FROM vouchers v
               LEFT JOIN suppliers s         ON s.id  = v.supplier_id
               LEFT JOIN booking_services bs ON bs.id = v.booking_service_id
              WHERE v.booking_id = ?
              ORDER BY v.voucher_type ASC, v.id ASC',
            [$bookingId]
        );
    }

    /**
     * Allocate a number, snapshot the content and issue.
     *
     * @param string|null $type NULL derives the type from the service line.
     * @return int new voucher id
     */
    public static function issue(int $bookingId, ?string $type = null, ?int $bookingServiceId = null): int
    {
        return Database::transaction(static function () use ($bookingId, $type, $bookingServiceId) {
            // Lock the booking so a concurrent cancel cannot slip between the
            // status check and the insert.
            $booking = Booking::lockForUpdate($bookingId);

            if ($booking['status'] === 'cancelled') {
                throw new BusinessRuleException('Vouchers cannot be issued against a cancelled booking');
            }
            if ($booking['status'] === 'draft') {
                throw new BusinessRuleException('Confirm the booking before issuing vouchers');
            }

            $service = null;
            if ($bookingServiceId !== null) {
                $service = Database::fetch(
                    'SELECT bs.*, s.name AS supplier_name, s.contact_person AS supplier_contact,
                            s.phone AS supplier_phone, s.alt_phone AS supplier_alt_phone,
                            s.email AS supplier_email, s.address AS supplier_address,
                            ci.name AS city_name
                       FROM booking_services bs
                       LEFT JOIN suppliers s  ON s.id  = bs.supplier_id
                       LEFT JOIN cities    ci ON ci.id = bs.city_id
                      WHERE bs.id = ? AND bs.booking_id = ? LIMIT 1',
                    [$bookingServiceId, $bookingId]
                );
                if ($service === null) {
                    throw new NotFoundException('Service line not found on this booking');
                }
                if (in_array($service['supplier_status'], ['cancelled', 'no_show'], true)) {
                    throw new BusinessRuleException(
                        'Service "' . $service['description'] . '" is ' . $service['supplier_status'] . ' — nothing to voucher'
                    );
                }
                $type ??= self::voucherTypeForService((string) $service['service_type']);
            }

            $type ??= 'tour';
            if (!in_array($type, self::TYPES, true)) {
                throw new ValidationException(['voucher_type' => ['Unknown voucher type: ' . $type]]);
            }

            // One live voucher per (booking, service, type). Re-issuing requires an
            // explicit cancel first, so two conflicting documents never circulate.
            $duplicate = Database::scalar(
                "SELECT voucher_no FROM vouchers
                  WHERE booking_id = ? AND voucher_type = ?
                    AND ((booking_service_id IS NULL AND ? IS NULL) OR booking_service_id = ?)
                    AND status IN ('draft','issued','sent')
                  LIMIT 1",
                [$bookingId, $type, $bookingServiceId, $bookingServiceId]
            );
            if ($duplicate !== null) {
                throw new BusinessRuleException(
                    'Voucher ' . $duplicate . ' already covers this service. Cancel it before re-issuing.'
                );
            }

            $customer = Database::fetch(
                'SELECT id, code, full_name, phone, alt_phone, email, address, city, state, gstin
                   FROM customers WHERE id = ? LIMIT 1',
                [(int) $booking['customer_id']]
            );

            $validFrom = $service['service_date'] ?? $booking['travel_from'];
            $validTo   = $service['service_end_date'] ?? ($service['service_date'] ?? $booking['travel_to']);

            $voucherNo = NumberSequence::next('VCH');

            $id = self::create([
                'voucher_no'         => $voucherNo,
                'booking_id'         => $bookingId,
                'booking_service_id' => $bookingServiceId,
                'voucher_type'       => $type,
                'supplier_id'        => !empty($service['supplier_id']) ? (int) $service['supplier_id'] : null,
                'issued_to'          => mb_substr((string) ($booking['lead_pax_name'] ?: ($customer['full_name'] ?? '')), 0, 200),
                'valid_from'         => $validFrom,
                'valid_to'           => $validTo,
                'content_json'       => self::snapshot($booking, $customer, $service, $type, $voucherNo),
                'status'             => 'issued',
                'issued_at'          => date('Y-m-d H:i:s'),
            ]);

            Audit::log('voucher_issued', 'booking', $bookingId, null, [
                'voucher_id' => $id, 'voucher_no' => $voucherNo, 'voucher_type' => $type,
                'booking_service_id' => $bookingServiceId,
            ]);

            self::promoteBookingIfFullyVouchered($bookingId, (string) $booking['status']);

            return $id;
        });
    }

    public static function cancel(int $id, string $reason): void
    {
        Database::transaction(static function () use ($id, $reason) {
            $voucher = self::findOrFail($id);

            if ($voucher['status'] === 'cancelled') {
                throw new BusinessRuleException('Voucher is already cancelled');
            }

            Database::execute(
                "UPDATE vouchers SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?",
                [$id]
            );

            Audit::log('voucher_cancelled', 'booking', (int) $voucher['booking_id'], $voucher, [
                'voucher_no' => $voucher['voucher_no'], 'reason' => mb_substr($reason, 0, 255),
            ]);
        });
    }

    /** Mark an issued voucher as delivered to the guest. */
    public static function markSent(int $id): void
    {
        $voucher = self::findOrFail($id);
        if ($voucher['status'] !== 'issued') {
            throw new BusinessRuleException('Only an issued voucher can be marked as sent');
        }
        Database::execute("UPDATE vouchers SET status = 'sent', sent_at = NOW() WHERE id = ?", [$id]);
    }

    /**
     * Confirmed supplier services on a booking that do not yet have a live voucher.
     * Drives both the issue-all endpoint and the ops departures checklist.
     */
    public static function pendingServices(int $bookingId): array
    {
        return Database::fetchAll(
            "SELECT bs.id, bs.service_type, bs.description, bs.service_date, bs.service_end_date,
                    bs.supplier_id, bs.confirmation_no, s.name AS supplier_name
               FROM booking_services bs
               LEFT JOIN suppliers s ON s.id = bs.supplier_id
              WHERE bs.booking_id = ?
                AND bs.supplier_status = 'confirmed'
                AND NOT EXISTS (
                      SELECT 1 FROM vouchers v
                       WHERE v.booking_service_id = bs.id
                         AND v.status IN ('draft','issued','sent'))
              ORDER BY bs.day_no ASC, bs.sort_order ASC, bs.id ASC",
            [$bookingId]
        );
    }

    // -----------------------------------------------------------------------

    /**
     * Freeze everything the printed document needs. Stored as JSON rather than
     * re-joined at print time precisely so it cannot drift.
     */
    private static function snapshot(array $booking, ?array $customer, ?array $service, string $type, string $voucherNo): string
    {
        $pax = Database::fetchAll(
            'SELECT pax_no, title, first_name, last_name, pax_type, gender, age,
                    passport_no, passport_expiry, visa_no, visa_status,
                    meal_preference, is_lead_pax
               FROM booking_pax WHERE booking_id = ? ORDER BY pax_no ASC',
            [(int) $booking['id']]
        );

        $content = [
            'voucher_no'   => $voucherNo,
            'voucher_type' => $type,
            'generated_at' => date('Y-m-d H:i:s'),
            'generated_by' => Request::userId(),
            'company'      => Setting::companyProfile(),
            'booking' => [
                'booking_no'        => $booking['booking_no'],
                'booking_date'      => $booking['booking_date'],
                'travel_from'       => $booking['travel_from'],
                'travel_to'         => $booking['travel_to'],
                'nights'            => (int) $booking['nights'],
                'adults'            => (int) $booking['adults'],
                'children'          => (int) $booking['children'],
                'infants'           => (int) $booking['infants'],
                'lead_pax_name'     => $booking['lead_pax_name'],
                'contact_phone'     => $booking['contact_phone'],
                'contact_email'     => $booking['contact_email'],
                'emergency_contact' => $booking['emergency_contact'],
                'emergency_phone'   => $booking['emergency_phone'],
                'special_requests'  => $booking['special_requests'],
                'currency'          => $booking['currency'],
            ],
            'customer' => $customer === null ? null : [
                'code'      => $customer['code'],
                'full_name' => $customer['full_name'],
                'phone'     => $customer['phone'],
                'email'     => $customer['email'],
                'city'      => $customer['city'],
                'state'     => $customer['state'],
            ],
            'pax' => $pax,
        ];

        if ($service !== null) {
            $content['service'] = [
                'id'               => (int) $service['id'],
                'service_type'     => $service['service_type'],
                'description'      => $service['description'],
                'day_no'           => $service['day_no'],
                'service_date'     => $service['service_date'],
                'service_end_date' => $service['service_end_date'],
                'city_name'        => $service['city_name'] ?? null,
                'nights'           => (int) $service['nights'],
                'pax_count'        => (int) $service['pax_count'],
                'quantity'         => (float) $service['quantity'],
                'unit'             => $service['unit'],
                'confirmation_no'  => $service['confirmation_no'],
                'supplier_status'  => $service['supplier_status'],
                'notes'            => $service['notes'],
            ];
            $content['supplier'] = empty($service['supplier_id']) ? null : [
                'id'             => (int) $service['supplier_id'],
                'name'           => $service['supplier_name'],
                'contact_person' => $service['supplier_contact'],
                'phone'          => $service['supplier_phone'],
                'alt_phone'      => $service['supplier_alt_phone'],
                'email'          => $service['supplier_email'],
                'address'        => $service['supplier_address'],
            ];

            // Rooming list belongs on a hotel voucher and nowhere else.
            if ($service['service_type'] === 'hotel') {
                $content['rooms'] = Database::fetchAll(
                    'SELECT room_no, room_type_label, occupancy, extra_bed, pax_ids, notes
                       FROM booking_rooms
                      WHERE booking_id = ? AND (booking_service_id = ? OR booking_service_id IS NULL)
                      ORDER BY room_no ASC',
                    [(int) $booking['id'], (int) $service['id']]
                );
            }
        } else {
            $content['service']  = null;
            $content['supplier'] = null;
            // A tour kit carries the whole itinerary instead of a single line.
            $content['itinerary'] = Database::fetchAll(
                'SELECT bs.service_type, bs.description, bs.day_no, bs.service_date, bs.service_end_date,
                        bs.confirmation_no, bs.supplier_status, s.name AS supplier_name, ci.name AS city_name
                   FROM booking_services bs
                   LEFT JOIN suppliers s  ON s.id  = bs.supplier_id
                   LEFT JOIN cities    ci ON ci.id = bs.city_id
                  WHERE bs.booking_id = ? AND bs.supplier_status <> \'cancelled\'
                  ORDER BY bs.day_no ASC, bs.sort_order ASC, bs.id ASC',
                [(int) $booking['id']]
            );
        }

        return (string) json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * Once every confirmed service carries a voucher the booking is "vouchered".
     * Doing this here keeps the board honest without an extra click for ops.
     */
    private static function promoteBookingIfFullyVouchered(int $bookingId, string $currentStatus): void
    {
        if ($currentStatus !== 'confirmed' || !Booking::canTransition($currentStatus, 'vouchered')) {
            return;
        }
        if (self::pendingServices($bookingId) !== []) {
            return;
        }
        // Nothing to voucher at all is not the same as everything vouchered.
        $issued = (int) Database::scalar(
            "SELECT COUNT(*) FROM vouchers WHERE booking_id = ? AND status IN ('issued','sent')",
            [$bookingId]
        );
        if ($issued === 0) {
            return;
        }

        Database::execute(
            "UPDATE bookings SET previous_status = status, status = 'vouchered' WHERE id = ? AND status = 'confirmed'",
            [$bookingId]
        );
        Database::insert('workflow_history', [
            'entity_type' => 'booking',
            'entity_id'   => $bookingId,
            'from_status' => $currentStatus,
            'to_status'   => 'vouchered',
            'note'        => 'All confirmed services vouchered',
            'actor_id'    => Request::userId(),
        ], ['entity_type', 'entity_id', 'from_status', 'to_status', 'note', 'actor_id']);
    }
}
