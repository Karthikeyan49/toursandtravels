<?php

class Booking extends Model
{
    protected const TABLE    = 'bookings';
    protected const FILLABLE = [
        'booking_no', 'quotation_id', 'lead_id', 'customer_id', 'agency_id', 'package_id',
        'departure_id', 'destination_id', 'booking_type', 'booking_date', 'travel_from',
        'travel_to', 'nights', 'adults', 'children', 'infants', 'hotel_category',
        'lead_pax_name', 'contact_phone', 'contact_email', 'emergency_contact', 'emergency_phone',
        'currency', 'subtotal', 'discount_amount', 'taxable_amount', 'gst_pct', 'gst_amount',
        'tcs_amount', 'grand_total', 'cost_total', 'agency_commission', 'payment_status',
        'status', 'previous_status', 'confirmed_at', 'completed_at', 'special_requests',
        'internal_notes', 'owner_id', 'ops_owner_id',
    ];
    protected const SORTABLE = ['id', 'booking_no', 'booking_date', 'travel_from', 'grand_total', 'status', 'created_at'];

    /** Statuses in which the booking still consumes seats and supplier capacity. */
    public const LIVE_STATUSES = ['confirmed', 'vouchered', 'in_progress'];

    private const TRANSITIONS = [
        'draft'       => ['confirmed', 'cancelled'],
        'confirmed'   => ['vouchered', 'in_progress', 'cancelled'],
        'vouchered'   => ['in_progress', 'cancelled'],
        'in_progress' => ['completed', 'no_show', 'cancelled'],
        'completed'   => [],
        'cancelled'   => [],
        'no_show'     => ['completed'],
    ];

    public static function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['1=1', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(b.booking_no LIKE ? OR c.full_name LIKE ? OR b.lead_pax_name LIKE ? OR b.contact_phone LIKE ?)',
                          [$like, $like, $like, $like]];
        }
        if (!empty($filters['status'])) {
            $statuses = is_array($filters['status']) ? $filters['status'] : explode(',', (string) $filters['status']);
            $statuses = array_values(array_filter(array_map('trim', $statuses)));
            if ($statuses !== []) {
                $marks = implode(',', array_fill(0, count($statuses), '?'));
                $clauses[] = ["b.status IN ($marks)", $statuses];
            }
        }
        if (!empty($filters['payment_status'])) {
            $clauses[] = ['b.payment_status = ?', [$filters['payment_status']]];
        }
        if (!empty($filters['customer_id'])) {
            $clauses[] = ['b.customer_id = ?', [(int) $filters['customer_id']]];
        }
        if (!empty($filters['package_id'])) {
            $clauses[] = ['b.package_id = ?', [(int) $filters['package_id']]];
        }
        if (!empty($filters['departure_id'])) {
            $clauses[] = ['b.departure_id = ?', [(int) $filters['departure_id']]];
        }
        if (!empty($filters['destination_id'])) {
            $clauses[] = ['b.destination_id = ?', [(int) $filters['destination_id']]];
        }
        if (!empty($filters['owner_id'])) {
            $clauses[] = ['b.owner_id = ?', [(int) $filters['owner_id']]];
        }
        // Overlap semantics: any booking whose travel window intersects [from, to].
        if (!empty($filters['travel_from'])) {
            $clauses[] = ['b.travel_to >= ?', [$filters['travel_from']]];
        }
        if (!empty($filters['travel_to'])) {
            $clauses[] = ['b.travel_from <= ?', [$filters['travel_to']]];
        }
        if (!empty($filters['booked_from'])) {
            $clauses[] = ['b.booking_date >= ?', [$filters['booked_from']]];
        }
        if (!empty($filters['booked_to'])) {
            $clauses[] = ['b.booking_date <= ?', [$filters['booked_to']]];
        }
        if (!empty($filters['outstanding_only'])) {
            $clauses[] = ["b.grand_total - b.amount_paid > 0.005 AND b.status NOT IN ('cancelled','draft')", []];
        }
        if (!empty($filters['departing_within_days'])) {
            $clauses[] = ['b.travel_from BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)',
                          [(int) $filters['departing_within_days']]];
        }

        [$scopeSql, $scopeParams] = AuthMiddleware::agencyScope('b.agency_id');
        $clauses[] = [$scopeSql, $scopeParams];

        [$where, $params] = self::buildWhere($clauses);

        $total = (int) Database::scalar(
            "SELECT COUNT(*) FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id WHERE $where",
            $params
        );

        $sortCol = self::assertSortable($sort, 'travel_from');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT b.*,
                    (b.grand_total - b.amount_paid) AS outstanding,
                    c.full_name AS customer_name, c.phone AS customer_phone,
                    d.name AS destination_name, p.name AS package_name,
                    pd.batch_code, a.name AS agency_name,
                    u.full_name AS owner_name, o.full_name AS ops_owner_name,
                    DATEDIFF(b.travel_from, CURDATE()) AS days_to_departure,
                    (SELECT COUNT(*) FROM booking_services bs
                      WHERE bs.booking_id = b.id AND bs.supplier_status = 'pending') AS pending_services
               FROM bookings b
               LEFT JOIN customers          c  ON c.id  = b.customer_id
               LEFT JOIN destinations       d  ON d.id  = b.destination_id
               LEFT JOIN packages           p  ON p.id  = b.package_id
               LEFT JOIN package_departures pd ON pd.id = b.departure_id
               LEFT JOIN agencies           a  ON a.id  = b.agency_id
               LEFT JOIN users              u  ON u.id  = b.owner_id
               LEFT JOIN users              o  ON o.id  = b.ops_owner_id
              WHERE $where
              ORDER BY b.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $b = Database::fetch(
            'SELECT b.*, (b.grand_total - b.amount_paid) AS outstanding,
                    c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
                    c.address AS customer_address, c.city AS customer_city, c.state AS customer_state,
                    c.gstin AS customer_gstin, c.code AS customer_code,
                    d.name AS destination_name, p.name AS package_name, p.code AS package_code,
                    pd.batch_code, pd.departure_date, a.name AS agency_name,
                    u.full_name AS owner_name, o.full_name AS ops_owner_name,
                    q.quote_no
               FROM bookings b
               LEFT JOIN customers          c  ON c.id  = b.customer_id
               LEFT JOIN destinations       d  ON d.id  = b.destination_id
               LEFT JOIN packages           p  ON p.id  = b.package_id
               LEFT JOIN package_departures pd ON pd.id = b.departure_id
               LEFT JOIN agencies           a  ON a.id  = b.agency_id
               LEFT JOIN users              u  ON u.id  = b.owner_id
               LEFT JOIN users              o  ON o.id  = b.ops_owner_id
               LEFT JOIN quotations         q  ON q.id  = b.quotation_id
              WHERE b.id = ? LIMIT 1',
            [$id]
        );
        if ($b === null) {
            return null;
        }

        $b['pax'] = Database::fetchAll(
            'SELECT * FROM booking_pax WHERE booking_id = ? ORDER BY pax_no ASC',
            [$id]
        );

        $b['services'] = Database::fetchAll(
            'SELECT bs.*, s.name AS supplier_name, ci.name AS city_name
               FROM booking_services bs
               LEFT JOIN suppliers s  ON s.id  = bs.supplier_id
               LEFT JOIN cities    ci ON ci.id = bs.city_id
              WHERE bs.booking_id = ?
              ORDER BY bs.day_no ASC, bs.sort_order ASC, bs.id ASC',
            [$id]
        );

        $b['rooms'] = Database::fetchAll(
            'SELECT * FROM booking_rooms WHERE booking_id = ? ORDER BY room_no ASC',
            [$id]
        );

        $b['payments'] = Database::fetchAll(
            "SELECT p.*, u.full_name AS recorded_by
               FROM payments p
               LEFT JOIN users u ON u.id = p.created_by
              WHERE p.ref_type = 'booking' AND p.ref_id = ?
              ORDER BY p.seq ASC, p.id ASC",
            [$id]
        );

        $b['invoices'] = Database::fetchAll(
            'SELECT id, invoice_no, invoice_date, grand_total, amount_paid, payment_status, status
               FROM invoices WHERE booking_id = ? ORDER BY invoice_date DESC',
            [$id]
        );

        $b['vouchers'] = Database::fetchAll(
            'SELECT id, voucher_no, voucher_type, status, issued_at, valid_from, valid_to
               FROM vouchers WHERE booking_id = ? ORDER BY voucher_type ASC',
            [$id]
        );

        $b['trip_assignments'] = Database::fetchAll(
            'SELECT ta.*, v.registration_no, vt.name AS vehicle_type_name, dr.full_name AS driver_name, dr.phone AS driver_phone
               FROM trip_assignments ta
               LEFT JOIN vehicles      v  ON v.id  = ta.vehicle_id
               LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
               LEFT JOIN drivers       dr ON dr.id = ta.driver_id
              WHERE ta.booking_id = ? ORDER BY ta.from_date ASC',
            [$id]
        );

        $b['options']      = BookingOption::forBooking($id);
        $b['travel_legs']  = TravelLeg::forBooking($id);
        $b['margin'] = self::margin($id);

        return $b;
    }

    /**
     * Replace all service lines and recompute totals.
     * Sell prices for catalogued items are resolved by Pricing, not by the client.
     */
    public static function replaceServices(int $bookingId, array $services, float $discount, ?float $gstPct, bool $isOverseas): array
    {
        return Database::transaction(static function () use ($bookingId, $services, $discount, $gstPct, $isOverseas) {
            $booking = self::findOrFail($bookingId);

            if (in_array($booking['status'], ['completed', 'cancelled'], true)) {
                throw new BusinessRuleException('A ' . $booking['status'] . ' booking cannot be re-costed');
            }

            Database::execute('DELETE FROM booking_services WHERE booking_id = ?', [$bookingId]);

            $sort = 0;
            $subtotal = 0.0;
            $costTotal = 0.0;

            foreach ($services as $svc) {
                $qty       = (float) ($svc['quantity'] ?? 1);
                $unitPrice = Money::of($svc['unit_price'] ?? 0);
                $unitCost  = Money::of($svc['unit_cost'] ?? 0);

                if (!Money::isNonNegative($unitPrice) || !Money::isNonNegative($unitCost)) {
                    throw new ValidationException(['services' => ['Prices and costs cannot be negative']]);
                }

                $sellTotal = Money::lineTotal($qty, $unitPrice);
                $lineCost  = Money::lineTotal($qty, $unitCost);

                Database::insert('booking_services', [
                    'booking_id'       => $bookingId,
                    'service_type'     => $svc['service_type'] ?? 'other',
                    'ref_id'           => !empty($svc['ref_id']) ? (int) $svc['ref_id'] : null,
                    'supplier_id'      => !empty($svc['supplier_id']) ? (int) $svc['supplier_id'] : null,
                    'description'      => mb_substr((string) ($svc['description'] ?? ''), 0, 400),
                    'day_no'           => !empty($svc['day_no']) ? (int) $svc['day_no'] : null,
                    'service_date'     => $svc['service_date'] ?? null,
                    'service_end_date' => $svc['service_end_date'] ?? null,
                    'city_id'          => !empty($svc['city_id']) ? (int) $svc['city_id'] : null,
                    'quantity'         => $qty,
                    'unit'             => mb_substr((string) ($svc['unit'] ?? 'pax'), 0, 20),
                    'nights'           => (int) ($svc['nights'] ?? 0),
                    'pax_count'        => (int) ($svc['pax_count'] ?? 0),
                    'unit_cost'        => $unitCost,
                    'unit_price'       => $unitPrice,
                    'cost_total'       => $lineCost,
                    'sell_total'       => $sellTotal,
                    'tax_pct'          => (float) ($svc['tax_pct'] ?? 0),
                    'currency'         => $svc['currency'] ?? 'INR',
                    'fx_rate'          => (float) ($svc['fx_rate'] ?? 1),
                    'notes'            => isset($svc['notes']) ? mb_substr((string) $svc['notes'], 0, 500) : null,
                    'sort_order'       => $sort++,
                    'created_by'       => Request::userId(),
                ], [
                    'booking_id', 'service_type', 'ref_id', 'supplier_id', 'description', 'day_no',
                    'service_date', 'service_end_date', 'city_id', 'quantity', 'unit', 'nights',
                    'pax_count', 'unit_cost', 'unit_price', 'cost_total', 'sell_total', 'tax_pct',
                    'currency', 'fx_rate', 'notes', 'sort_order', 'created_by',
                ]);

                $subtotal  += $sellTotal;
                $costTotal += $lineCost;
            }

            $money = Pricing::applyTax($subtotal, $discount, $gstPct, $isOverseas);

            Database::execute(
                'UPDATE bookings
                    SET subtotal = ?, discount_amount = ?, taxable_amount = ?, gst_pct = ?,
                        gst_amount = ?, tcs_amount = ?, grand_total = ?, cost_total = ?
                  WHERE id = ?',
                [
                    $money['subtotal'], $money['discount_amount'], $money['taxable_amount'],
                    $money['gst_pct'], $money['gst_amount'], $money['tcs_amount'],
                    $money['grand_total'], Money::of($costTotal), $bookingId,
                ]
            );

            self::refreshPaymentStatus($bookingId);

            return $money;
        });
    }

    /**
     * Recompute amount_paid from the ledger and derive payment_status.
     * Called after every payment write. amount_paid is a cache; the payments
     * table is the source of truth.
     */
    public static function refreshPaymentStatus(int $bookingId): void
    {
        $paid = (float) Database::scalar(
            "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
               FROM payments
              WHERE ref_type = 'booking' AND ref_id = ? AND status = 'paid'",
            [$bookingId]
        );

        $booking = self::find($bookingId);
        if ($booking === null) {
            return;
        }

        $total   = (float) $booking['grand_total'];
        $advance = Money::percentOf($total, Setting::decimal('advance_percent', 25.0));

        if (Money::isZero($paid)) {
            $status = 'unpaid';
        } elseif (Money::greaterThan($paid, $total)) {
            $status = 'overpaid';
        } elseif (Money::equals($paid, $total)) {
            $status = 'paid';
        } elseif (Money::greaterThan($paid, 0) && !Money::lessThan($paid, $advance)) {
            $status = 'advance_paid';
        } else {
            $status = 'partially_paid';
        }

        Database::execute(
            'UPDATE bookings
                SET amount_paid = ?, payment_status = ?,
                    last_payment_at = (SELECT MAX(paid_on) FROM payments
                                        WHERE ref_type = \'booking\' AND ref_id = ? AND status = \'paid\')
              WHERE id = ?',
            [Money::of($paid), $status, $bookingId, $bookingId]
        );
    }

    /** Per-booking P&L. Cost includes supplier bills and directly-attached expenses. */
    public static function margin(int $bookingId): array
    {
        $row = Database::fetch(
            "SELECT b.grand_total, b.taxable_amount, b.cost_total AS estimated_cost, b.agency_commission,
                    COALESCE((SELECT SUM(sb.grand_total) FROM supplier_bills sb
                               WHERE sb.booking_id = b.id AND sb.status NOT IN ('void','cancelled')), 0) AS billed_cost,
                    COALESCE((SELECT SUM(e.total_amount) FROM expenses e
                               WHERE e.booking_id = b.id AND e.status NOT IN ('void','rejected')), 0) AS direct_expenses
               FROM bookings b WHERE b.id = ?",
            [$bookingId]
        );

        if ($row === null) {
            return [];
        }

        // Actual cost = whatever has actually been billed; fall back to the
        // estimate while nothing is billed yet, so margin is never fictitiously 100%.
        $billed  = (float) $row['billed_cost'];
        $actual  = Money::of(($billed > 0 ? $billed : (float) $row['estimated_cost']) + (float) $row['direct_expenses']);
        $revenue = Money::of($row['taxable_amount']);
        $margin  = Money::of($revenue - $actual - (float) $row['agency_commission']);

        return [
            'revenue'         => $revenue,
            'estimated_cost'  => Money::of($row['estimated_cost']),
            'billed_cost'     => Money::of($billed),
            'direct_expenses' => Money::of($row['direct_expenses']),
            'actual_cost'     => $actual,
            'commission'      => Money::of($row['agency_commission']),
            'margin'          => $margin,
            'margin_pct'      => $revenue > 0 ? round($margin / $revenue * 100, 2) : 0.0,
            'is_estimated'    => $billed <= 0,
        ];
    }

    public static function outstanding(int $bookingId): float
    {
        $b = self::findOrFail($bookingId);
        return Money::of((float) $b['grand_total'] - (float) $b['amount_paid']);
    }

    /**
     * Row-lock a booking inside a transaction. Required before any balance check
     * that gates a write, so two concurrent payments cannot both pass it.
     */
    public static function lockForUpdate(int $bookingId): array
    {
        $row = Database::fetch('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [$bookingId]);
        if ($row === null) {
            throw new NotFoundException('Booking not found');
        }
        return $row;
    }
}
