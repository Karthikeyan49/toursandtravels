<?php

/**
 * The polymorphic payment ledger.
 *
 * Every money movement in the system is a row here: booking advances and
 * instalments, invoice receipts, supplier payments, refunds and commission
 * payouts. Rows are never deleted — they are voided.
 */
class Payment extends Model
{
    protected const TABLE    = 'payments';
    protected const FILLABLE = [
        'payment_no', 'ref_type', 'ref_id', 'seq', 'label', 'direction', 'amount',
        'currency', 'fx_rate', 'mode', 'utr_no', 'bank_account', 'gateway_ref',
        'due_on', 'paid_on', 'status', 'remarks',
    ];
    protected const SORTABLE = ['id', 'payment_no', 'paid_on', 'due_on', 'amount', 'created_at'];

    public const REF_TYPES = ['booking', 'invoice', 'supplier_bill', 'commission', 'refund', 'expense'];

    /**
     * Record a payment against a booking.
     *
     * The overpayment guard is evaluated INSIDE the transaction, after the
     * booking row has been locked with SELECT ... FOR UPDATE. Without the lock,
     * two concurrent requests can both read the same balance and both pass the
     * check, leaving the booking overpaid.
     */
    public static function postBookingPayment(int $bookingId, array $data): int
    {
        return Database::transaction(static function () use ($bookingId, $data) {
            $booking = Booking::lockForUpdate($bookingId);

            if ($booking['status'] === 'cancelled') {
                throw new BusinessRuleException('Cannot take a payment against a cancelled booking. Record a refund instead.');
            }

            $amount    = Money::of($data['amount']);
            $direction = $data['direction'] ?? 'in';

            if (!Money::greaterThan($amount, 0)) {
                throw new ValidationException(['amount' => ['Payment amount must be greater than zero']]);
            }

            if ($direction === 'in') {
                $alreadyPaid = (float) Database::scalar(
                    "SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0)
                       FROM payments
                      WHERE ref_type = 'booking' AND ref_id = ? AND status = 'paid'",
                    [$bookingId]
                );
                $balance = Money::of((float) $booking['grand_total'] - $alreadyPaid);

                if (Money::greaterThan($amount, $balance)) {
                    throw new BusinessRuleException(sprintf(
                        'Payment of %s exceeds the outstanding balance of %s',
                        number_format($amount, 2), number_format($balance, 2)
                    ));
                }
            }

            $seq = 1 + (int) Database::scalar(
                "SELECT COALESCE(MAX(seq), 0) FROM payments WHERE ref_type = 'booking' AND ref_id = ?",
                [$bookingId]
            );

            $id = self::create([
                'payment_no'   => NumberSequence::next('PAY'),
                'ref_type'     => 'booking',
                'ref_id'       => $bookingId,
                'seq'          => $seq,
                'label'        => $data['label'] ?? ($seq === 1 ? 'Advance' : 'Instalment ' . $seq),
                'direction'    => $direction,
                'amount'       => $amount,
                'currency'     => $data['currency'] ?? $booking['currency'],
                'fx_rate'      => (float) ($data['fx_rate'] ?? 1),
                'mode'         => $data['mode'] ?? 'bank_transfer',
                'utr_no'       => $data['utr_no'] ?? null,
                'bank_account' => $data['bank_account'] ?? null,
                'gateway_ref'  => $data['gateway_ref'] ?? null,
                'due_on'       => $data['due_on'] ?? null,
                'paid_on'      => $data['paid_on'] ?? date('Y-m-d'),
                'status'       => $data['status'] ?? 'paid',
                'remarks'      => $data['remarks'] ?? null,
            ]);

            Booking::refreshPaymentStatus($bookingId);
            Audit::log('payment_received', 'booking', $bookingId, null, [
                'payment_id' => $id, 'amount' => $amount, 'mode' => $data['mode'] ?? 'bank_transfer',
            ]);

            return $id;
        });
    }

    /** Payment out against a supplier bill, with the same locked-balance guard. */
    public static function postSupplierPayment(int $billId, array $data): int
    {
        return Database::transaction(static function () use ($billId, $data) {
            $bill = Database::fetch('SELECT * FROM supplier_bills WHERE id = ? FOR UPDATE', [$billId]);
            if ($bill === null) {
                throw new NotFoundException('Supplier bill not found');
            }
            if (in_array($bill['status'], ['void', 'cancelled'], true)) {
                throw new BusinessRuleException('Cannot pay a ' . $bill['status'] . ' bill');
            }

            $amount = Money::of($data['amount']);
            if (!Money::greaterThan($amount, 0)) {
                throw new ValidationException(['amount' => ['Payment amount must be greater than zero']]);
            }

            $alreadyPaid = (float) Database::scalar(
                "SELECT COALESCE(SUM(amount), 0) FROM payments
                  WHERE ref_type = 'supplier_bill' AND ref_id = ? AND status = 'paid' AND direction = 'out'",
                [$billId]
            );
            $balance = Money::of((float) $bill['grand_total'] - $alreadyPaid);

            if (Money::greaterThan($amount, $balance)) {
                throw new BusinessRuleException(sprintf(
                    'Payment of %s exceeds the bill balance of %s',
                    number_format($amount, 2), number_format($balance, 2)
                ));
            }

            $seq = 1 + (int) Database::scalar(
                "SELECT COALESCE(MAX(seq), 0) FROM payments WHERE ref_type = 'supplier_bill' AND ref_id = ?",
                [$billId]
            );

            $id = self::create([
                'payment_no'   => NumberSequence::next('PAY'),
                'ref_type'     => 'supplier_bill',
                'ref_id'       => $billId,
                'seq'          => $seq,
                'label'        => $data['label'] ?? 'Supplier payment ' . $seq,
                'direction'    => 'out',
                'amount'       => $amount,
                'currency'     => $data['currency'] ?? $bill['currency'],
                'fx_rate'      => (float) ($data['fx_rate'] ?? $bill['fx_rate']),
                'mode'         => $data['mode'] ?? 'bank_transfer',
                'utr_no'       => $data['utr_no'] ?? null,
                'bank_account' => $data['bank_account'] ?? null,
                'paid_on'      => $data['paid_on'] ?? date('Y-m-d'),
                'status'       => 'paid',
                'remarks'      => $data['remarks'] ?? null,
            ]);

            self::refreshSupplierBill($billId);
            Audit::log('payment_made', 'supplier_bill', $billId, null, ['payment_id' => $id, 'amount' => $amount]);

            return $id;
        });
    }

    public static function refreshSupplierBill(int $billId): void
    {
        $paid = (float) Database::scalar(
            "SELECT COALESCE(SUM(amount), 0) FROM payments
              WHERE ref_type = 'supplier_bill' AND ref_id = ? AND status = 'paid' AND direction = 'out'",
            [$billId]
        );

        $bill = Database::fetch('SELECT grand_total, due_date FROM supplier_bills WHERE id = ?', [$billId]);
        if ($bill === null) {
            return;
        }

        $total = (float) $bill['grand_total'];
        if (Money::isZero($paid)) {
            $status = (!empty($bill['due_date']) && strtotime($bill['due_date']) < strtotime('today')) ? 'overdue' : 'unpaid';
        } elseif (Money::greaterThan($total, $paid)) {
            $status = 'partially_paid';
        } else {
            $status = 'paid';
        }

        Database::execute(
            'UPDATE supplier_bills SET amount_paid = ?, payment_status = ? WHERE id = ?',
            [Money::of($paid), $status, $billId]
        );
    }

    /**
     * Void a payment. Never a DELETE — the row stays, flagged, and the parent
     * document's cached totals are recomputed.
     */
    public static function void(int $paymentId, string $reason): void
    {
        Database::transaction(static function () use ($paymentId, $reason) {
            $p = self::findOrFail($paymentId);
            if ($p['status'] === 'void') {
                throw new BusinessRuleException('Payment is already void');
            }

            Database::execute(
                "UPDATE payments SET status = 'void', voided_by = ?, voided_at = NOW(), void_reason = ? WHERE id = ?",
                [Request::userId(), mb_substr($reason, 0, 255), $paymentId]
            );

            if ($p['ref_type'] === 'booking') {
                Booking::refreshPaymentStatus((int) $p['ref_id']);
            } elseif ($p['ref_type'] === 'supplier_bill') {
                self::refreshSupplierBill((int) $p['ref_id']);
            } elseif ($p['ref_type'] === 'invoice') {
                Invoice::refreshPaymentStatus((int) $p['ref_id']);
            }

            Audit::log('payment_voided', $p['ref_type'], (int) $p['ref_id'], $p, ['reason' => $reason]);
        });
    }

    /** Schedule an instalment plan on a booking (rows with status='scheduled'). */
    public static function scheduleInstalments(int $bookingId, array $instalments): array
    {
        return Database::transaction(static function () use ($bookingId, $instalments) {
            $booking = Booking::findOrFail($bookingId);

            Database::execute(
                "DELETE FROM payments WHERE ref_type = 'booking' AND ref_id = ? AND status = 'scheduled'",
                [$bookingId]
            );

            $planned = Money::sum(array_column($instalments, 'amount'));
            if (Money::greaterThan($planned, (float) $booking['grand_total'])) {
                throw new BusinessRuleException('Scheduled instalments exceed the booking total');
            }

            $seq = (int) Database::scalar(
                "SELECT COALESCE(MAX(seq), 0) FROM payments WHERE ref_type = 'booking' AND ref_id = ?",
                [$bookingId]
            );

            $created = [];
            foreach ($instalments as $inst) {
                $seq++;
                $created[] = self::create([
                    'payment_no' => NumberSequence::next('PAY'),
                    'ref_type'   => 'booking',
                    'ref_id'     => $bookingId,
                    'seq'        => $seq,
                    'label'      => $inst['label'] ?? ('Instalment ' . $seq),
                    'direction'  => 'in',
                    'amount'     => Money::of($inst['amount']),
                    'currency'   => $booking['currency'],
                    'mode'       => $inst['mode'] ?? 'bank_transfer',
                    'due_on'     => $inst['due_on'] ?? null,
                    'paid_on'    => null,
                    'status'     => 'scheduled',
                ]);
            }

            return $created;
        });
    }

    /** Mark a scheduled instalment as received. */
    public static function markScheduledPaid(int $paymentId, array $data): void
    {
        Database::transaction(static function () use ($paymentId, $data) {
            $p = self::findOrFail($paymentId);
            if ($p['status'] !== 'scheduled') {
                throw new BusinessRuleException('Only a scheduled instalment can be marked paid');
            }

            Database::execute(
                "UPDATE payments SET status = 'paid', paid_on = ?, mode = ?, utr_no = ?, bank_account = ?, remarks = ?
                  WHERE id = ?",
                [
                    $data['paid_on'] ?? date('Y-m-d'),
                    $data['mode'] ?? $p['mode'],
                    $data['utr_no'] ?? null,
                    $data['bank_account'] ?? null,
                    $data['remarks'] ?? null,
                    $paymentId,
                ]
            );

            if ($p['ref_type'] === 'booking') {
                Booking::refreshPaymentStatus((int) $p['ref_id']);
            }

            Audit::log('instalment_paid', $p['ref_type'], (int) $p['ref_id'], null, ['payment_id' => $paymentId]);
        });
    }

    public static function forRef(string $refType, int $refId): array
    {
        return Database::fetchAll(
            'SELECT p.*, u.full_name AS recorded_by
               FROM payments p LEFT JOIN users u ON u.id = p.created_by
              WHERE p.ref_type = ? AND p.ref_id = ?
              ORDER BY p.seq ASC, p.id ASC',
            [$refType, $refId]
        );
    }

    /** Day book: all money in and out for a date range. */
    public static function dayBook(string $from, string $to, ?string $mode = null): array
    {
        $clauses = [
            ["p.status = 'paid'", []],
            ['p.paid_on BETWEEN ? AND ?', [$from, $to]],
        ];
        if ($mode !== null && $mode !== '') {
            $clauses[] = ['p.mode = ?', [$mode]];
        }
        [$where, $params] = self::buildWhere($clauses);

        return Database::fetchAll(
            "SELECT p.id, p.payment_no, p.ref_type, p.ref_id, p.label, p.direction, p.amount,
                    p.mode, p.utr_no, p.paid_on, p.remarks,
                    CASE p.ref_type
                        WHEN 'booking'       THEN (SELECT b.booking_no FROM bookings b WHERE b.id = p.ref_id)
                        WHEN 'invoice'       THEN (SELECT i.invoice_no FROM invoices i WHERE i.id = p.ref_id)
                        WHEN 'supplier_bill' THEN (SELECT sb.bill_no FROM supplier_bills sb WHERE sb.id = p.ref_id)
                        ELSE NULL
                    END AS ref_no
               FROM payments p
              WHERE $where
              ORDER BY p.paid_on ASC, p.id ASC",
            $params
        );
    }
}
