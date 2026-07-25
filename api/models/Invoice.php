<?php

class Invoice extends Model
{
    protected const TABLE    = 'invoices';
    protected const FILLABLE = [
        'invoice_no', 'booking_id', 'customer_id', 'agency_id', 'invoice_type',
        'is_gst_applicable', 'invoice_date', 'due_date', 'place_of_supply', 'seller_state',
        'customer_state', 'customer_gstin', 'currency', 'fx_rate', 'subtotal', 'discount_amount',
        'taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'tcs_amount',
        'round_off', 'grand_total', 'payment_status', 'status', 'notes', 'terms',
    ];
    protected const SORTABLE = ['id', 'invoice_no', 'invoice_date', 'due_date', 'grand_total', 'status'];

    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['1=1', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(i.invoice_no LIKE ? OR c.full_name LIKE ? OR b.booking_no LIKE ?)', [$like, $like, $like]];
        }
        if (!empty($filters['status'])) {
            $clauses[] = ['i.status = ?', [$filters['status']]];
        }
        if (!empty($filters['payment_status'])) {
            $clauses[] = ['i.payment_status = ?', [$filters['payment_status']]];
        }
        if (!empty($filters['customer_id'])) {
            $clauses[] = ['i.customer_id = ?', [(int) $filters['customer_id']]];
        }
        if (!empty($filters['booking_id'])) {
            $clauses[] = ['i.booking_id = ?', [(int) $filters['booking_id']]];
        }
        if (!empty($filters['from'])) {
            $clauses[] = ['i.invoice_date >= ?', [$filters['from']]];
        }
        if (!empty($filters['to'])) {
            $clauses[] = ['i.invoice_date <= ?', [$filters['to']]];
        }
        if (!empty($filters['overdue'])) {
            $clauses[] = ["i.due_date < CURDATE() AND i.payment_status IN ('unpaid','partially_paid')
                           AND i.status NOT IN ('void','cancelled')", []];
        }

        [$scopeSql, $scopeParams] = AuthMiddleware::agencyScope('i.agency_id');
        $clauses[] = [$scopeSql, $scopeParams];

        [$where, $params] = self::buildWhere($clauses);

        $total = (int) Database::scalar(
            "SELECT COUNT(*) FROM invoices i
               LEFT JOIN customers c ON c.id = i.customer_id
               LEFT JOIN bookings  b ON b.id = i.booking_id
              WHERE $where",
            $params
        );

        $sortCol = self::assertSortable($sort, 'invoice_date');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT i.*, (i.grand_total - i.amount_paid) AS outstanding,
                    c.full_name AS customer_name, c.phone AS customer_phone,
                    b.booking_no, b.travel_from,
                    DATEDIFF(CURDATE(), i.due_date) AS days_overdue
               FROM invoices i
               LEFT JOIN customers c ON c.id = i.customer_id
               LEFT JOIN bookings  b ON b.id = i.booking_id
              WHERE $where
              ORDER BY i.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $inv = Database::fetch(
            'SELECT i.*, (i.grand_total - i.amount_paid) AS outstanding,
                    c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
                    c.address AS customer_address, c.city AS customer_city, c.pincode AS customer_pincode,
                    b.booking_no, b.travel_from, b.travel_to, b.adults, b.children,
                    d.name AS destination_name, p.name AS package_name
               FROM invoices i
               LEFT JOIN customers    c ON c.id = i.customer_id
               LEFT JOIN bookings     b ON b.id = i.booking_id
               LEFT JOIN destinations d ON d.id = b.destination_id
               LEFT JOIN packages     p ON p.id = b.package_id
              WHERE i.id = ? LIMIT 1',
            [$id]
        );
        if ($inv === null) {
            return null;
        }

        $inv['items']    = Database::fetchAll('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC', [$id]);
        $inv['payments'] = Payment::forRef('invoice', $id);
        $inv['company']  = Setting::companyProfile();
        $inv['amount_in_words'] = Money::inWords((float) $inv['grand_total']);

        return $inv;
    }

    /**
     * Raise a tax invoice from a confirmed booking.
     * All amounts come from the booking; the caller supplies only dates and notes.
     */
    public static function fromBooking(int $bookingId, array $options = []): int
    {
        return Database::transaction(static function () use ($bookingId, $options) {
            $booking = Booking::findOrFail($bookingId);

            if ($booking['status'] === 'draft') {
                throw new BusinessRuleException('Confirm the booking before raising an invoice');
            }
            if ($booking['status'] === 'cancelled') {
                throw new BusinessRuleException('Cannot invoice a cancelled booking');
            }

            $existing = Database::scalar(
                "SELECT id FROM invoices
                  WHERE booking_id = ? AND invoice_type = 'tax_invoice' AND status NOT IN ('void','cancelled')
                  LIMIT 1",
                [$bookingId]
            );
            if ($existing !== null) {
                throw new BusinessRuleException('A tax invoice already exists for this booking (#' . $existing . ')');
            }

            $customer    = Customer::find((int) $booking['customer_id']) ?? [];
            $sellerState = (string) Setting::get('company_state', '');
            $buyerState  = $customer['state'] ?? $sellerState;

            $gstSplit = Money::splitGst((float) $booking['gst_amount'], $sellerState, $buyerState);
            [$roundedTotal, $roundOff] = Money::roundOff((float) $booking['grand_total']);

            $dueDays  = (int) ($options['due_days'] ?? 0);
            $invoiceDate = $options['invoice_date'] ?? date('Y-m-d');

            $invoiceId = self::create([
                'invoice_no'      => NumberSequence::next('INV'),
                'booking_id'      => $bookingId,
                'customer_id'     => (int) $booking['customer_id'],
                'agency_id'       => $booking['agency_id'] ?: null,
                'invoice_type'    => $options['invoice_type'] ?? 'tax_invoice',
                'invoice_date'    => $invoiceDate,
                'due_date'        => $dueDays > 0 ? date('Y-m-d', strtotime($invoiceDate . " +$dueDays days")) : $invoiceDate,
                'place_of_supply' => $buyerState,
                'seller_state'    => $sellerState,
                'customer_state'  => $buyerState,
                'customer_gstin'  => $customer['gstin'] ?? null,
                'currency'        => $booking['currency'],
                'subtotal'        => (float) $booking['subtotal'],
                'discount_amount' => (float) $booking['discount_amount'],
                'taxable_amount'  => (float) $booking['taxable_amount'],
                'cgst_amount'     => $gstSplit['cgst'],
                'sgst_amount'     => $gstSplit['sgst'],
                'igst_amount'     => $gstSplit['igst'],
                'tcs_amount'      => (float) $booking['tcs_amount'],
                'round_off'       => $roundOff,
                'grand_total'     => $roundedTotal,
                'status'          => 'issued',
                'notes'           => $options['notes'] ?? null,
                'terms'           => $options['terms'] ?? null,
            ]);

            // One consolidated line per service type keeps the client-facing
            // invoice readable while the booking retains the full breakdown.
            $groups = Database::fetchAll(
                'SELECT service_type, SUM(sell_total) AS amount, COUNT(*) AS line_count
                   FROM booking_services WHERE booking_id = ?
                  GROUP BY service_type ORDER BY service_type',
                [$bookingId]
            );

            $sort = 0;
            $gstPct = (float) $booking['gst_pct'];
            foreach ($groups as $g) {
                $taxable = Money::of($g['amount']);
                Database::insert('invoice_items', [
                    'invoice_id'    => $invoiceId,
                    'description'   => self::serviceLabel($g['service_type']) . ' — ' . $booking['booking_no'],
                    'sac_code'      => '998555',
                    'quantity'      => 1,
                    'unit'          => 'lot',
                    'unit_price'    => $taxable,
                    'taxable_value' => $taxable,
                    'gst_pct'       => $gstPct,
                    'gst_amount'    => Money::percentOf($taxable, $gstPct),
                    'line_total'    => Money::of($taxable + Money::percentOf($taxable, $gstPct)),
                    'sort_order'    => $sort++,
                ], [
                    'invoice_id', 'description', 'sac_code', 'quantity', 'unit', 'unit_price',
                    'taxable_value', 'gst_pct', 'gst_amount', 'line_total', 'sort_order',
                ]);
            }

            Audit::log('invoice_raised', 'booking', $bookingId, null, ['invoice_id' => $invoiceId]);

            return $invoiceId;
        });
    }

    /**
     * Raise a cash / non-GST bill from a confirmed booking. Sibling of
     * fromBooking() with the tax machinery switched off entirely: no CGST/SGST/
     * IGST/TCS, grand_total is simply subtotal less discount, and the number
     * comes from the CASH sequence so it never collides with a tax invoice.
     */
    public static function cashBill(int $bookingId, array $options = []): int
    {
        return Database::transaction(static function () use ($bookingId, $options) {
            $booking = Booking::findOrFail($bookingId);

            if ($booking['status'] === 'draft') {
                throw new BusinessRuleException('Confirm the booking before raising a cash bill');
            }
            if ($booking['status'] === 'cancelled') {
                throw new BusinessRuleException('Cannot invoice a cancelled booking');
            }

            $existing = Database::scalar(
                "SELECT id FROM invoices
                  WHERE booking_id = ? AND invoice_type = 'cash_bill' AND status NOT IN ('void','cancelled')
                  LIMIT 1",
                [$bookingId]
            );
            if ($existing !== null) {
                throw new BusinessRuleException('A cash bill already exists for this booking (#' . $existing . ')');
            }

            $customer    = Customer::find((int) $booking['customer_id']) ?? [];
            $sellerState = (string) Setting::get('company_state', '');
            $buyerState  = $customer['state'] ?? $sellerState;

            $subtotal = Money::of($booking['subtotal']);
            $discount = Money::of($booking['discount_amount']);
            $taxable  = Money::of($subtotal - $discount);
            [$roundedTotal, $roundOff] = Money::roundOff($taxable);

            $dueDays     = (int) ($options['due_days'] ?? 0);
            $invoiceDate = $options['invoice_date'] ?? date('Y-m-d');

            $invoiceId = self::create([
                'invoice_no'        => NumberSequence::next('CASH'),
                'booking_id'        => $bookingId,
                'customer_id'       => (int) $booking['customer_id'],
                'agency_id'         => $booking['agency_id'] ?: null,
                'invoice_type'      => 'cash_bill',
                'is_gst_applicable' => 0,
                'invoice_date'      => $invoiceDate,
                'due_date'          => $dueDays > 0 ? date('Y-m-d', strtotime($invoiceDate . " +$dueDays days")) : $invoiceDate,
                'place_of_supply'   => $buyerState,
                'seller_state'      => $sellerState,
                'customer_state'    => $buyerState,
                'customer_gstin'    => $customer['gstin'] ?? null,
                'currency'          => $booking['currency'],
                'subtotal'          => $subtotal,
                'discount_amount'   => $discount,
                'taxable_amount'    => $taxable,
                'cgst_amount'       => 0.00,
                'sgst_amount'       => 0.00,
                'igst_amount'       => 0.00,
                'tcs_amount'        => 0.00,
                'round_off'         => $roundOff,
                'grand_total'       => $roundedTotal,
                'status'            => 'issued',
                'notes'             => $options['notes'] ?? null,
                'terms'             => $options['terms'] ?? null,
            ]);

            // Same one-line-per-service-type layout as the tax invoice, but
            // every line is untaxed: gst_pct/gst_amount are 0 and the line
            // total is just the taxable value.
            $groups = Database::fetchAll(
                'SELECT service_type, SUM(sell_total) AS amount, COUNT(*) AS line_count
                   FROM booking_services WHERE booking_id = ?
                  GROUP BY service_type ORDER BY service_type',
                [$bookingId]
            );

            $sort = 0;
            foreach ($groups as $g) {
                $taxableLine = Money::of($g['amount']);
                Database::insert('invoice_items', [
                    'invoice_id'    => $invoiceId,
                    'description'   => self::serviceLabel($g['service_type']) . ' — ' . $booking['booking_no'],
                    'sac_code'      => '998555',
                    'quantity'      => 1,
                    'unit'          => 'lot',
                    'unit_price'    => $taxableLine,
                    'taxable_value' => $taxableLine,
                    'gst_pct'       => 0,
                    'gst_amount'    => 0.00,
                    'line_total'    => $taxableLine,
                    'sort_order'    => $sort++,
                ], [
                    'invoice_id', 'description', 'sac_code', 'quantity', 'unit', 'unit_price',
                    'taxable_value', 'gst_pct', 'gst_amount', 'line_total', 'sort_order',
                ]);
            }

            Audit::log('cash_bill_raised', 'booking', $bookingId, null, ['invoice_id' => $invoiceId]);

            return $invoiceId;
        });
    }

    public static function refreshPaymentStatus(int $invoiceId): void
    {
        $paid = (float) Database::scalar(
            "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
               FROM payments WHERE ref_type = 'invoice' AND ref_id = ? AND status = 'paid'",
            [$invoiceId]
        );

        $inv = self::find($invoiceId);
        if ($inv === null) {
            return;
        }

        $total = (float) $inv['grand_total'];
        if (Money::isZero($paid)) {
            $status = (!empty($inv['due_date']) && strtotime($inv['due_date']) < strtotime('today')) ? 'overdue' : 'unpaid';
        } elseif (Money::greaterThan($total, $paid)) {
            $status = 'partially_paid';
        } else {
            $status = 'paid';
        }

        Database::execute(
            'UPDATE invoices SET amount_paid = ?, payment_status = ?, last_payment_at = NOW() WHERE id = ?',
            [Money::of($paid), $status, $invoiceId]
        );
    }

    /** Void an invoice. Financial documents are never deleted. */
    public static function void(int $invoiceId, string $reason): void
    {
        Database::transaction(static function () use ($invoiceId, $reason) {
            $inv = self::findOrFail($invoiceId);
            if ($inv['status'] === 'void') {
                throw new BusinessRuleException('Invoice is already void');
            }
            if (Money::greaterThan((float) $inv['amount_paid'], 0)) {
                throw new BusinessRuleException('Void the payments against this invoice before voiding the invoice');
            }

            Database::execute(
                "UPDATE invoices SET status = 'void', voided_by = ?, voided_at = NOW(), void_reason = ? WHERE id = ?",
                [Request::userId(), mb_substr($reason, 0, 255), $invoiceId]
            );

            Audit::log('invoice_voided', 'invoice', $invoiceId, $inv, ['reason' => $reason]);
        });
    }

    /** GST summary for a period — the input to GSTR-1 preparation. */
    public static function gstSummary(string $from, string $to): array
    {
        return Database::fetchAll(
            "SELECT DATE_FORMAT(invoice_date, '%Y-%m') AS period,
                    COUNT(*) AS invoice_count,
                    COALESCE(SUM(taxable_amount), 0) AS taxable_amount,
                    COALESCE(SUM(cgst_amount), 0)   AS cgst,
                    COALESCE(SUM(sgst_amount), 0)   AS sgst,
                    COALESCE(SUM(igst_amount), 0)   AS igst,
                    COALESCE(SUM(tcs_amount), 0)    AS tcs,
                    COALESCE(SUM(grand_total), 0)   AS grand_total
               FROM invoices
              WHERE invoice_date BETWEEN ? AND ?
                AND status NOT IN ('void','cancelled','draft')
              GROUP BY period ORDER BY period ASC",
            [$from, $to]
        );
    }

    private static function serviceLabel(string $type): string
    {
        return [
            'hotel'     => 'Accommodation',
            'transport' => 'Ground transportation',
            'activity'  => 'Sightseeing & activities',
            'flight'    => 'Air ticket',
            'train'     => 'Rail ticket',
            'visa'      => 'Visa processing',
            'insurance' => 'Travel insurance',
            'guide'     => 'Guide services',
            'meal'      => 'Meals',
        ][$type] ?? 'Tour services';
    }
}
