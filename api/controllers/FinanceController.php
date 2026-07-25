<?php
/**
 * Receivables, payables and the payment ledger.
 *
 * Every route here is guarded to 'staff:owner,manager,accounts' in the route
 * table — money movements are never open to sales or operations roles.
 */
class FinanceController extends Controller
{
    // --- Payments -----------------------------------------------------------

    /** POST /bookings/{id}/payments */
    public function recordBookingPayment(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');

            $data = $this->validate(
                Request::only(['amount', 'mode', 'utr_no', 'bank_account', 'gateway_ref', 'paid_on', 'label', 'remarks', 'direction']),
                [
                    'amount'       => 'required|money|min:0.01',
                    'mode'         => 'nullable|in:cash,bank_transfer,upi,cheque,card,wallet,adjustment,online_gateway',
                    'utr_no'       => 'nullable|string|max:60',
                    'bank_account' => 'nullable|string|max:80',
                    'gateway_ref'  => 'nullable|string|max:120',
                    'paid_on'      => 'nullable|date',
                    'label'        => 'nullable|string|max:120',
                    'remarks'      => 'nullable|string|max:400',
                    'direction'    => 'nullable|in:in,out',
                ]
            );

            // A future-dated receipt is almost always a typo and corrupts the day book.
            if (!empty($data['paid_on']) && strtotime($data['paid_on']) > strtotime('today')) {
                throw new ValidationException(['paid_on' => ['Payment date cannot be in the future']]);
            }
            // Non-cash modes need a reference for reconciliation.
            if (in_array($data['mode'] ?? 'bank_transfer', ['bank_transfer', 'upi', 'cheque'], true)
                && empty($data['utr_no'])) {
                throw new ValidationException(['utr_no' => ['A UTR / cheque / reference number is required for this payment mode']]);
            }

            $paymentId = Payment::postBookingPayment($bookingId, $data);

            Response::created([
                'payment' => Payment::find($paymentId),
                'booking' => Booking::detail($bookingId),
            ], 'Payment recorded');
        });
    }

    /** GET /bookings/{id}/payments */
    public function bookingPayments(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');
            $booking = Booking::findOrFail($bookingId);

            $payments = Payment::forRef('booking', $bookingId);

            $received = Money::sum(array_map(
                static fn($p) => $p['status'] === 'paid' ? ($p['direction'] === 'in' ? $p['amount'] : -$p['amount']) : 0,
                $payments
            ));
            $scheduled = Money::sum(array_map(
                static fn($p) => $p['status'] === 'scheduled' ? $p['amount'] : 0,
                $payments
            ));

            Response::success([
                'payments'    => $payments,
                'grand_total' => Money::of($booking['grand_total']),
                'received'    => $received,
                'scheduled'   => $scheduled,
                'outstanding' => Money::of((float) $booking['grand_total'] - $received),
                'status'      => $booking['payment_status'],
            ]);
        });
    }

    /** POST /bookings/{id}/payment-plan */
    public function schedulePlan(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');
            $instalments = Request::input('instalments', []);

            if (!is_array($instalments) || $instalments === []) {
                throw new ValidationException(['instalments' => ['Provide at least one instalment']]);
            }
            foreach ($instalments as $i => $inst) {
                if (!isset($inst['amount']) || !is_numeric($inst['amount']) || (float) $inst['amount'] <= 0) {
                    throw new ValidationException(['instalments' => ["Instalment " . ($i + 1) . " needs a positive amount"]]);
                }
            }

            Payment::scheduleInstalments($bookingId, $instalments);
            Response::success(Payment::forRef('booking', $bookingId), 'Payment plan saved');
        });
    }

    /** POST /payments/{id}/mark-paid */
    public function markPaid(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(
                Request::only(['paid_on', 'mode', 'utr_no', 'bank_account', 'remarks']),
                [
                    'paid_on'      => 'nullable|date',
                    'mode'         => 'nullable|in:cash,bank_transfer,upi,cheque,card,wallet,adjustment,online_gateway',
                    'utr_no'       => 'nullable|string|max:60',
                    'bank_account' => 'nullable|string|max:80',
                    'remarks'      => 'nullable|string|max:400',
                ]
            );

            Payment::markScheduledPaid($id, $data);
            Response::success(Payment::find($id), 'Instalment marked as received');
        });
    }

    /** POST /payments/{id}/void */
    public function voidPayment(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $reason = trim((string) Request::input('reason', ''));

            if ($reason === '') {
                throw new ValidationException(['reason' => ['A reason is required to void a payment']]);
            }

            Payment::void($id, $reason);
            Response::success(Payment::find($id), 'Payment voided');
        });
    }

    /** GET /payments/daybook */
    public function daybook(): void
    {
        $this->run(function () {
            $from = Request::query('from', date('Y-m-d'));
            $to   = Request::query('to', $from);

            $rows = Payment::dayBook($from, $to, Request::query('mode'));

            $in  = Money::sum(array_map(static fn($r) => $r['direction'] === 'in'  ? $r['amount'] : 0, $rows));
            $out = Money::sum(array_map(static fn($r) => $r['direction'] === 'out' ? $r['amount'] : 0, $rows));

            $byMode = [];
            foreach ($rows as $r) {
                $byMode[$r['mode']] ??= ['mode' => $r['mode'], 'in' => 0.0, 'out' => 0.0];
                $byMode[$r['mode']][$r['direction']] += (float) $r['amount'];
            }

            Response::success([
                'entries' => $rows,
                'summary' => [
                    'from'    => $from,
                    'to'      => $to,
                    'total_in'  => $in,
                    'total_out' => $out,
                    'net'       => Money::of($in - $out),
                    'by_mode'   => array_values(array_map(static function ($m) {
                        $m['in']  = Money::of($m['in']);
                        $m['out'] = Money::of($m['out']);
                        return $m;
                    }, $byMode)),
                ],
            ]);
        });
    }

    // --- Invoices -----------------------------------------------------------

    /** GET /invoices */
    public function invoices(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            [$rows, $total] = Invoice::paginate([
                'search'         => Request::query('search'),
                'status'         => Request::query('status'),
                'payment_status' => Request::query('payment_status'),
                'customer_id'    => Request::query('customer_id'),
                'booking_id'     => Request::query('booking_id'),
                'from'           => Request::query('from'),
                'to'             => Request::query('to'),
                'overdue'        => Request::queryBool('overdue'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** GET /invoices/{id} */
    public function showInvoice(): void
    {
        $this->run(function () {
            $inv = Invoice::detail(Request::paramInt('id'));
            if ($inv === null) {
                Response::notFound('Invoice not found');
                return;
            }
            Response::success($inv);
        });
    }

    /** POST /bookings/{id}/invoice */
    public function raiseInvoice(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');

            $options = $this->validate(
                Request::only(['invoice_date', 'due_days', 'notes', 'terms', 'invoice_type']),
                [
                    'invoice_date' => 'nullable|date',
                    'due_days'     => 'nullable|int|min:0|max:365',
                    'notes'        => 'nullable|string|max:4000',
                    'terms'        => 'nullable|string|max:4000',
                    'invoice_type' => 'nullable|in:tax_invoice,proforma',
                ]
            );

            $invoiceId = Invoice::fromBooking($bookingId, $options);
            Response::created(Invoice::detail($invoiceId), 'Invoice raised');
        });
    }

    /** POST /bookings/{id}/cash-bill — non-GST bill, the raiseInvoice() sibling. */
    public function raiseCashBill(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');

            $options = $this->validate(
                Request::only(['invoice_date', 'due_days', 'notes', 'terms']),
                [
                    'invoice_date' => 'nullable|date',
                    'due_days'     => 'nullable|int|min:0|max:365',
                    'notes'        => 'nullable|string|max:4000',
                    'terms'        => 'nullable|string|max:4000',
                ]
            );

            $invoiceId = Invoice::cashBill($bookingId, $options);
            Response::created(Invoice::detail($invoiceId), 'Cash bill raised');
        });
    }

    /** POST /invoices/{id}/payments */
    public function recordInvoicePayment(): void
    {
        $this->run(function () {
            $invoiceId = Request::paramInt('id');

            $data = $this->validate(
                Request::only(['amount', 'mode', 'utr_no', 'bank_account', 'paid_on', 'remarks']),
                [
                    'amount'       => 'required|money|min:0.01',
                    'mode'         => 'nullable|in:cash,bank_transfer,upi,cheque,card,wallet,adjustment,online_gateway',
                    'utr_no'       => 'nullable|string|max:60',
                    'bank_account' => 'nullable|string|max:80',
                    'paid_on'      => 'nullable|date',
                    'remarks'      => 'nullable|string|max:400',
                ]
            );

            $paymentId = Database::transaction(static function () use ($invoiceId, $data) {
                $inv = Database::fetch('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [$invoiceId]);
                if ($inv === null) {
                    throw new NotFoundException('Invoice not found');
                }
                if (in_array($inv['status'], ['void', 'cancelled'], true)) {
                    throw new BusinessRuleException('Cannot take payment against a ' . $inv['status'] . ' invoice');
                }

                $paid = (float) Database::scalar(
                    "SELECT COALESCE(SUM(amount), 0) FROM payments
                      WHERE ref_type = 'invoice' AND ref_id = ? AND status = 'paid' AND direction = 'in'",
                    [$invoiceId]
                );
                $balance = Money::of((float) $inv['grand_total'] - $paid);
                $amount  = Money::of($data['amount']);

                if (Money::greaterThan($amount, $balance)) {
                    throw new BusinessRuleException(sprintf(
                        'Payment of %s exceeds the invoice balance of %s',
                        number_format($amount, 2), number_format($balance, 2)
                    ));
                }

                $seq = 1 + (int) Database::scalar(
                    "SELECT COALESCE(MAX(seq), 0) FROM payments WHERE ref_type = 'invoice' AND ref_id = ?",
                    [$invoiceId]
                );

                $id = Payment::create([
                    'payment_no'   => NumberSequence::next('PAY'),
                    'ref_type'     => 'invoice',
                    'ref_id'       => $invoiceId,
                    'seq'          => $seq,
                    'label'        => 'Receipt ' . $seq,
                    'direction'    => 'in',
                    'amount'       => $amount,
                    'currency'     => $inv['currency'],
                    'mode'         => $data['mode'] ?? 'bank_transfer',
                    'utr_no'       => $data['utr_no'] ?? null,
                    'bank_account' => $data['bank_account'] ?? null,
                    'paid_on'      => $data['paid_on'] ?? date('Y-m-d'),
                    'status'       => 'paid',
                    'remarks'      => $data['remarks'] ?? null,
                ]);

                Invoice::refreshPaymentStatus($invoiceId);
                return $id;
            });

            Response::created([
                'payment' => Payment::find($paymentId),
                'invoice' => Invoice::detail($invoiceId),
            ], 'Receipt recorded');
        });
    }

    /** POST /invoices/{id}/void */
    public function voidInvoice(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $reason = trim((string) Request::input('reason', ''));

            if ($reason === '') {
                throw new ValidationException(['reason' => ['A reason is required to void an invoice']]);
            }

            Invoice::void($id, $reason);
            Response::success(Invoice::detail($id), 'Invoice voided');
        });
    }

    // --- Supplier bills -----------------------------------------------------

    /** GET /supplier-bills */
    public function supplierBills(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $clauses = ["sb.status <> 'void'"];
            $params  = [];

            if ($s = Request::query('search')) {
                $clauses[] = '(sb.bill_no LIKE ? OR sb.supplier_ref_no LIKE ? OR sup.name LIKE ?)';
                array_push($params, "%$s%", "%$s%", "%$s%");
            }
            if ($sid = Request::queryInt('supplier_id')) {
                $clauses[] = 'sb.supplier_id = ?';
                $params[] = $sid;
            }
            if ($bid = Request::queryInt('booking_id')) {
                $clauses[] = 'sb.booking_id = ?';
                $params[] = $bid;
            }
            if ($ps = Request::query('payment_status')) {
                $clauses[] = 'sb.payment_status = ?';
                $params[] = $ps;
            }
            if (Request::queryBool('due_only')) {
                $clauses[] = "sb.grand_total - sb.amount_paid > 0.005";
            }
            if ($from = Request::query('from')) {
                $clauses[] = 'sb.bill_date >= ?';
                $params[] = $from;
            }
            if ($to = Request::query('to')) {
                $clauses[] = 'sb.bill_date <= ?';
                $params[] = $to;
            }

            $where = implode(' AND ', $clauses);
            $total = (int) Database::scalar(
                "SELECT COUNT(*) FROM supplier_bills sb JOIN suppliers sup ON sup.id = sb.supplier_id WHERE $where",
                $params
            );

            $rows = Database::fetchAll(
                "SELECT sb.*, (sb.grand_total - sb.amount_paid) AS outstanding,
                        sup.name AS supplier_name, sup.supplier_type,
                        b.booking_no, b.travel_from,
                        DATEDIFF(CURDATE(), sb.due_date) AS days_overdue
                   FROM supplier_bills sb
                   JOIN suppliers sup ON sup.id = sb.supplier_id
                   LEFT JOIN bookings b ON b.id = sb.booking_id
                  WHERE $where
                  ORDER BY sb.due_date ASC, sb.bill_date DESC
                  LIMIT $limit OFFSET $offset",
                $params
            );

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** POST /supplier-bills */
    public function storeSupplierBill(): void
    {
        $this->run(function () {
            $data = $this->validate(
                Request::only([
                    'supplier_id', 'supplier_ref_no', 'booking_id', 'bill_date', 'due_date',
                    'currency', 'fx_rate', 'tds_amount', 'notes',
                ]),
                [
                    'supplier_id'     => 'required|int|min:1',
                    'supplier_ref_no' => 'nullable|string|max:60',
                    'booking_id'      => 'nullable|int',
                    'bill_date'       => 'required|date',
                    'due_date'        => 'nullable|date',
                    'currency'        => 'nullable|string|max:3',
                    'fx_rate'         => 'nullable|decimal|min:0',
                    'tds_amount'      => 'nullable|money',
                    'notes'           => 'nullable|string|max:4000',
                ]
            );

            $items = Request::input('items', []);
            if (!is_array($items) || $items === []) {
                throw new ValidationException(['items' => ['A bill needs at least one line']]);
            }

            if (!Supplier::exists((int) $data['supplier_id'])) {
                throw new ValidationException(['supplier_id' => ['Supplier not found']]);
            }

            $billId = Database::transaction(function () use ($data, $items) {
                $creditDays = (int) Database::scalar('SELECT credit_days FROM suppliers WHERE id = ?', [(int) $data['supplier_id']]);
                $data['due_date'] ??= date('Y-m-d', strtotime($data['bill_date'] . " +$creditDays days"));
                $data['bill_no'] = NumberSequence::next('SB');
                $data['status']  = 'draft';

                $id = Database::insert('supplier_bills', array_merge($data, ['created_by' => Request::userId()]), [
                    'bill_no', 'supplier_ref_no', 'supplier_id', 'booking_id', 'bill_date', 'due_date',
                    'currency', 'fx_rate', 'tds_amount', 'status', 'notes', 'created_by',
                ]);

                $subtotal = 0.0;
                $tax      = 0.0;
                $sort     = 0;

                foreach ($items as $item) {
                    $qty  = (float) ($item['quantity'] ?? 1);
                    $cost = Money::of($item['unit_cost'] ?? 0);
                    if (!Money::isNonNegative($cost)) {
                        throw new ValidationException(['items' => ['Costs cannot be negative']]);
                    }

                    $lineNet = Money::lineTotal($qty, $cost);
                    $taxPct  = (float) ($item['tax_pct'] ?? 0);
                    $lineTax = Money::percentOf($lineNet, $taxPct);

                    Database::insert('supplier_bill_items', [
                        'supplier_bill_id'   => $id,
                        'booking_service_id' => !empty($item['booking_service_id']) ? (int) $item['booking_service_id'] : null,
                        'description'        => mb_substr((string) ($item['description'] ?? ''), 0, 400),
                        'quantity'           => $qty,
                        'unit_cost'          => $cost,
                        'tax_pct'            => $taxPct,
                        'line_total'         => Money::of($lineNet + $lineTax),
                        'sort_order'         => $sort++,
                    ], [
                        'supplier_bill_id', 'booking_service_id', 'description', 'quantity',
                        'unit_cost', 'tax_pct', 'line_total', 'sort_order',
                    ]);

                    // Link the service line back to the bill so booking margin
                    // can distinguish billed from estimated cost.
                    if (!empty($item['booking_service_id'])) {
                        Database::execute(
                            'UPDATE booking_services SET supplier_bill_id = ? WHERE id = ?',
                            [$id, (int) $item['booking_service_id']]
                        );
                    }

                    $subtotal += $lineNet;
                    $tax      += $lineTax;
                }

                $tds   = Money::of($data['tds_amount'] ?? 0);
                $total = Money::of($subtotal + $tax - $tds);

                Database::execute(
                    'UPDATE supplier_bills SET subtotal = ?, tax_amount = ?, grand_total = ? WHERE id = ?',
                    [Money::of($subtotal), Money::of($tax), $total, $id]
                );

                Audit::log('create', 'supplier_bill', $id, null, ['bill_no' => $data['bill_no'], 'total' => $total]);
                return $id;
            });

            Response::created($this->supplierBillDetail($billId), 'Supplier bill created');
        });
    }

    /** GET /supplier-bills/{id} */
    public function showSupplierBill(): void
    {
        $this->run(function () {
            $bill = $this->supplierBillDetail(Request::paramInt('id'));
            if ($bill === null) {
                Response::notFound('Supplier bill not found');
                return;
            }
            Response::success($bill);
        });
    }

    /** POST /supplier-bills/{id}/approve */
    public function approveSupplierBill(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $bill = Database::fetch('SELECT * FROM supplier_bills WHERE id = ?', [$id]);
            if ($bill === null) {
                Response::notFound('Supplier bill not found');
                return;
            }
            if ($bill['status'] !== 'draft') {
                throw new BusinessRuleException('Only a draft bill can be approved');
            }

            Database::execute(
                "UPDATE supplier_bills SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
                [Request::userId(), $id]
            );

            Audit::log('approve', 'supplier_bill', $id);
            Response::success($this->supplierBillDetail($id), 'Bill approved for payment');
        });
    }

    /** POST /supplier-bills/{id}/payments */
    public function paySupplierBill(): void
    {
        $this->run(function () {
            $billId = Request::paramInt('id');

            $data = $this->validate(
                Request::only(['amount', 'mode', 'utr_no', 'bank_account', 'paid_on', 'remarks']),
                [
                    'amount'       => 'required|money|min:0.01',
                    'mode'         => 'nullable|in:cash,bank_transfer,upi,cheque,card,wallet,adjustment,online_gateway',
                    'utr_no'       => 'nullable|string|max:60',
                    'bank_account' => 'nullable|string|max:80',
                    'paid_on'      => 'nullable|date',
                    'remarks'      => 'nullable|string|max:400',
                ]
            );

            $status = Database::scalar('SELECT status FROM supplier_bills WHERE id = ?', [$billId]);
            if ($status === 'draft') {
                throw new BusinessRuleException('Approve the bill before paying it');
            }

            $paymentId = Payment::postSupplierPayment($billId, $data);

            Response::created([
                'payment' => Payment::find($paymentId),
                'bill'    => $this->supplierBillDetail($billId),
            ], 'Supplier payment recorded');
        });
    }

    /** GET /finance/payables — ageing buckets. */
    public function payables(): void
    {
        $this->run(static function () {
            $rows = Database::fetchAll(
                "SELECT sup.id AS supplier_id, sup.name AS supplier_name, sup.supplier_type,
                        COUNT(sb.id) AS bill_count,
                        COALESCE(SUM(sb.grand_total - sb.amount_paid), 0) AS outstanding,
                        COALESCE(SUM(CASE WHEN sb.due_date >= CURDATE() THEN sb.grand_total - sb.amount_paid ELSE 0 END), 0) AS not_due,
                        COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), sb.due_date) BETWEEN 1 AND 30  THEN sb.grand_total - sb.amount_paid ELSE 0 END), 0) AS days_1_30,
                        COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), sb.due_date) BETWEEN 31 AND 60 THEN sb.grand_total - sb.amount_paid ELSE 0 END), 0) AS days_31_60,
                        COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), sb.due_date) > 60 THEN sb.grand_total - sb.amount_paid ELSE 0 END), 0) AS days_60_plus
                   FROM supplier_bills sb
                   JOIN suppliers sup ON sup.id = sb.supplier_id
                  WHERE sb.status NOT IN ('void','cancelled')
                    AND sb.grand_total - sb.amount_paid > 0.005
                  GROUP BY sup.id, sup.name, sup.supplier_type
                  ORDER BY outstanding DESC"
            );

            Response::success([
                'suppliers' => $rows,
                'totals'    => [
                    'outstanding'  => Money::sum(array_column($rows, 'outstanding')),
                    'not_due'      => Money::sum(array_column($rows, 'not_due')),
                    'days_1_30'    => Money::sum(array_column($rows, 'days_1_30')),
                    'days_31_60'   => Money::sum(array_column($rows, 'days_31_60')),
                    'days_60_plus' => Money::sum(array_column($rows, 'days_60_plus')),
                ],
            ]);
        });
    }

    /** GET /finance/receivables — ageing by customer. */
    public function receivables(): void
    {
        $this->run(static function () {
            $rows = Database::fetchAll(
                "SELECT c.id AS customer_id, c.full_name AS customer_name, c.phone,
                        COUNT(b.id) AS booking_count,
                        COALESCE(SUM(b.grand_total - b.amount_paid), 0) AS outstanding,
                        MIN(b.travel_from) AS next_departure,
                        COALESCE(SUM(CASE WHEN b.travel_from <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                                          THEN b.grand_total - b.amount_paid ELSE 0 END), 0) AS due_within_7_days
                   FROM bookings b
                   JOIN customers c ON c.id = b.customer_id
                  WHERE b.status NOT IN ('cancelled','draft')
                    AND b.grand_total - b.amount_paid > 0.005
                  GROUP BY c.id, c.full_name, c.phone
                  ORDER BY due_within_7_days DESC, outstanding DESC"
            );

            Response::success([
                'customers' => $rows,
                'totals'    => [
                    'outstanding'       => Money::sum(array_column($rows, 'outstanding')),
                    'due_within_7_days' => Money::sum(array_column($rows, 'due_within_7_days')),
                ],
            ]);
        });
    }

    /** GET /finance/gst-summary */
    public function gstSummary(): void
    {
        $this->run(static function () {
            $from = Request::query('from', date('Y-04-01'));
            $to   = Request::query('to', date('Y-m-d'));
            Response::success([
                'periods' => Invoice::gstSummary($from, $to),
                'from'    => $from,
                'to'      => $to,
            ]);
        });
    }

    /** GET /finance/pl — profit & loss by period. */
    public function profitAndLoss(): void
    {
        $this->run(static function () {
            $from = Request::query('from', date('Y-m-01'));
            $to   = Request::query('to', date('Y-m-d'));

            $revenue = Database::fetch(
                "SELECT COALESCE(SUM(taxable_amount), 0) AS revenue,
                        COALESCE(SUM(cost_total), 0)     AS estimated_cost,
                        COUNT(*) AS booking_count,
                        COALESCE(SUM(adults + children), 0) AS pax
                   FROM bookings
                  WHERE travel_from BETWEEN ? AND ? AND status NOT IN ('cancelled','draft')",
                [$from, $to]
            );

            $supplierCost = (float) Database::scalar(
                "SELECT COALESCE(SUM(sb.grand_total), 0)
                   FROM supplier_bills sb
                  WHERE sb.bill_date BETWEEN ? AND ? AND sb.status NOT IN ('void','cancelled')",
                [$from, $to]
            );

            $overheads = Database::fetchAll(
                "SELECT category, COALESCE(SUM(total_amount), 0) AS amount
                   FROM expenses
                  WHERE expense_date BETWEEN ? AND ? AND status NOT IN ('void','rejected','draft')
                    AND booking_id IS NULL
                  GROUP BY category ORDER BY amount DESC",
                [$from, $to]
            );

            $directExpenses = (float) Database::scalar(
                "SELECT COALESCE(SUM(total_amount), 0) FROM expenses
                  WHERE expense_date BETWEEN ? AND ? AND status NOT IN ('void','rejected','draft')
                    AND booking_id IS NOT NULL",
                [$from, $to]
            );

            $commission = (float) Database::scalar(
                "SELECT COALESCE(SUM(net_payable), 0) FROM commissions
                  WHERE status NOT IN ('void','cancelled')
                    AND booking_id IN (SELECT id FROM bookings WHERE travel_from BETWEEN ? AND ?)",
                [$from, $to]
            );

            $rev        = Money::of($revenue['revenue'] ?? 0);
            $cogs       = Money::of($supplierCost + $directExpenses + $commission);
            $overheadTotal = Money::sum(array_column($overheads, 'amount'));
            $gross      = Money::of($rev - $cogs);
            $net        = Money::of($gross - $overheadTotal);

            Response::success([
                'period'        => ['from' => $from, 'to' => $to],
                'revenue'       => $rev,
                'booking_count' => (int) ($revenue['booking_count'] ?? 0),
                'pax'           => (int) ($revenue['pax'] ?? 0),
                'cogs' => [
                    'supplier_bills'   => Money::of($supplierCost),
                    'direct_expenses'  => Money::of($directExpenses),
                    'agent_commission' => Money::of($commission),
                    'total'            => $cogs,
                ],
                'gross_profit'     => $gross,
                'gross_margin_pct' => $rev > 0 ? round($gross / $rev * 100, 2) : 0.0,
                'overheads'        => $overheads,
                'overhead_total'   => $overheadTotal,
                'net_profit'       => $net,
                'net_margin_pct'   => $rev > 0 ? round($net / $rev * 100, 2) : 0.0,
                'revenue_per_pax'  => ($revenue['pax'] ?? 0) > 0 ? Money::of($rev / (int) $revenue['pax']) : 0.0,
            ]);
        });
    }

    private function supplierBillDetail(int $id): ?array
    {
        $bill = Database::fetch(
            'SELECT sb.*, (sb.grand_total - sb.amount_paid) AS outstanding,
                    sup.name AS supplier_name, sup.gstin AS supplier_gstin,
                    b.booking_no
               FROM supplier_bills sb
               JOIN suppliers sup ON sup.id = sb.supplier_id
               LEFT JOIN bookings b ON b.id = sb.booking_id
              WHERE sb.id = ? LIMIT 1',
            [$id]
        );
        if ($bill === null) {
            return null;
        }

        $bill['items']    = Database::fetchAll('SELECT * FROM supplier_bill_items WHERE supplier_bill_id = ? ORDER BY sort_order', [$id]);
        $bill['payments'] = Payment::forRef('supplier_bill', $id);

        return $bill;
    }
}
