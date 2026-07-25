<?php
/**
 * Overheads and booking-attached direct costs.
 *
 * There is deliberately no DELETE route: an expense is a financial document, so a
 * wrong one is voided (with a reason, by a named user) and stays in the ledger.
 */
class ExpenseController extends Controller
{
    /** GET /expenses */
    public function index(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $filters = $this->filters();

            [$rows, $total] = Expense::paginate(
                $filters, $limit, $offset, Request::query('sort'), Request::query('dir')
            );

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'expense_no'   => 'Expense No',
                'expense_date' => 'Date',
                'category'     => 'Category',
                'subcategory'  => 'Subcategory',
                'description'  => 'Description',
                'booking_no'   => 'Booking',
                'supplier_name'=> 'Supplier',
                'amount'       => 'Amount',
                'tax_amount'   => 'Tax',
                'total_amount' => 'Total',
                'mode'         => 'Mode',
                'status'       => 'Status',
                'paid_by_name' => 'Paid By',
            ], 'expenses')) {
                return;
            }

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** GET /expenses/summary */
    public function summary(): void
    {
        $this->run(function () {
            Response::success(Expense::summary($this->filters()));
        });
    }

    /** GET /expenses/categories */
    public function categories(): void
    {
        $this->run(static fn() => Response::success(Expense::categories()));
    }

    /** GET /expenses/{id} */
    public function show(): void
    {
        $this->run(function () {
            $expense = Expense::detail(Request::paramInt('id'));
            if ($expense === null) {
                Response::notFound('Expense not found');
                return;
            }
            Response::success($expense);
        });
    }

    /** POST /expenses */
    public function store(): void
    {
        $this->run(function () {
            $data = $this->payload(true);

            $this->assertReferences($data);

            $money = Expense::money($data);

            $id = Database::transaction(static function () use ($data, $money) {
                $payload = array_merge($data, $money, [
                    'expense_no' => NumberSequence::next('EXP'),
                    'status'     => in_array($data['status'] ?? 'draft', ['draft', 'submitted'], true)
                        ? ($data['status'] ?? 'draft')
                        : 'draft',
                    'paid_by'    => !empty($data['paid_by']) ? (int) $data['paid_by'] : Request::userId(),
                ]);

                $newId = Expense::create($payload);

                Audit::log('create', 'expense', $newId, null, [
                    'expense_no' => $payload['expense_no'],
                    'category'   => $payload['category'],
                    'total'      => $money['total_amount'],
                ]);

                return $newId;
            });

            Response::created(Expense::detail($id), 'Expense recorded');
        });
    }

    /** PUT /expenses/{id} */
    public function update(): void
    {
        $this->run(function () {
            $id     = Request::paramInt('id');
            $before = Expense::findOrFail($id);

            Expense::assertEditable($before);

            $data = $this->payload(false);
            $this->assertReferences($data);

            // Recompute from whichever of amount/tax was supplied, falling back to
            // the stored values — a partial update must never zero the total.
            if (array_key_exists('amount', $data) || array_key_exists('tax_amount', $data)) {
                $data = array_merge($data, Expense::money($data, $before));
            }

            Database::transaction(static function () use ($id, $before, $data) {
                Expense::updateById($id, $data);
                Audit::logDiff('update', 'expense', $id, $before, $data);
            });

            Response::success(Expense::detail($id), 'Expense updated');
        });
    }

    /** POST /expenses/{id}/submit */
    public function submit(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Expense::submit($id);
            Response::success(Expense::detail($id), 'Expense submitted for approval');
        });
    }

    /** POST /expenses/{id}/approve */
    public function approve(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Expense::approve($id);
            Response::success(Expense::detail($id), 'Expense approved');
        });
    }

    /** POST /expenses/{id}/reject  body {reason} */
    public function reject(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['reason']), ['reason' => 'required|string|max:255']);

            Expense::reject($id, $data['reason']);
            Response::success(Expense::detail($id), 'Expense rejected');
        });
    }

    /** POST /expenses/{id}/mark-paid  body {paid_on} */
    public function markPaid(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['paid_on']), ['paid_on' => 'nullable|date']);

            if (!empty($data['paid_on']) && strtotime($data['paid_on']) > strtotime('today')) {
                throw new ValidationException(['paid_on' => ['Payment date cannot be in the future']]);
            }

            Expense::markPaid($id, $data['paid_on'] ?? null);
            Response::success(Expense::detail($id), 'Expense marked as paid');
        });
    }

    /** POST /expenses/{id}/void  body {reason} */
    public function void(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['reason']), ['reason' => 'required|string|max:255']);

            Expense::void($id, $data['reason']);
            Response::success(Expense::detail($id), 'Expense voided');
        });
    }

    // -----------------------------------------------------------------------

    private function filters(): array
    {
        return [
            'search'            => Request::query('search'),
            'category'          => Request::query('category'),
            'subcategory'       => Request::query('subcategory'),
            'status'            => Request::query('status'),
            'booking_id'        => Request::query('booking_id'),
            'supplier_id'       => Request::query('supplier_id'),
            'paid_by'           => Request::query('paid_by'),
            'mode'              => Request::query('mode'),
            'from'              => Request::query('from'),
            'to'                => Request::query('to'),
            'min_amount'        => Request::query('min_amount'),
            'max_amount'        => Request::query('max_amount'),
            'reimbursable_only' => Request::queryBool('reimbursable_only'),
            'overheads_only'    => Request::queryBool('overheads_only'),
            'direct_only'       => Request::queryBool('direct_only'),
        ];
    }

    private function payload(bool $isCreate): array
    {
        $required = $isCreate ? 'required' : 'nullable';

        $data = $this->validate(
            Request::only([
                'expense_date', 'category', 'subcategory', 'booking_id', 'supplier_id',
                'description', 'amount', 'tax_amount', 'mode', 'paid_by',
                'is_reimbursable', 'status',
            ]),
            [
                'expense_date'    => "$required|date",
                'category'        => "$required|string|max:60",
                'subcategory'     => 'nullable|string|max:60',
                'booking_id'      => 'nullable|int|min:1',
                'supplier_id'     => 'nullable|int|min:1',
                'description'     => "$required|string|max:400",
                'amount'          => "$required|money",
                'tax_amount'      => 'nullable|money',
                'mode'            => 'nullable|in:' . implode(',', Expense::MODES),
                'paid_by'         => 'nullable|int|min:1',
                'is_reimbursable' => 'nullable|bool',
                'status'          => 'nullable|in:draft,submitted',
            ]
        );

        // A future-dated expense corrupts every period report it lands in.
        if (!empty($data['expense_date']) && strtotime($data['expense_date']) > strtotime('today')) {
            throw new ValidationException(['expense_date' => ['Expense date cannot be in the future']]);
        }

        // An explicit `null` on a NOT NULL column would surface as a driver-level
        // 1048 rather than a validation error. Drop it and let the column default
        // (on insert) or the stored value (on update) stand.
        foreach (['expense_date', 'category', 'description', 'amount', 'tax_amount',
                  'mode', 'is_reimbursable', 'status'] as $notNull) {
            if (array_key_exists($notNull, $data) && $data[$notNull] === null) {
                unset($data[$notNull]);
            }
        }

        return $data;
    }

    private function assertReferences(array $data): void
    {
        if (!empty($data['booking_id']) && !Booking::exists((int) $data['booking_id'])) {
            throw new ValidationException(['booking_id' => ['Booking not found']]);
        }
        if (!empty($data['supplier_id']) && !Supplier::exists((int) $data['supplier_id'])) {
            throw new ValidationException(['supplier_id' => ['Supplier not found']]);
        }
        if (!empty($data['paid_by'])
            && Database::scalar('SELECT 1 FROM users WHERE id = ? LIMIT 1', [(int) $data['paid_by']]) === null) {
            throw new ValidationException(['paid_by' => ['User not found']]);
        }
    }
}
