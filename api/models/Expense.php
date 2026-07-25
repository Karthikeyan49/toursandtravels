<?php

/**
 * Overheads and direct costs.
 *
 * An expense is a financial document: once approved or paid it is frozen, and it
 * is voided rather than deleted. `total_amount` is always recomputed server-side
 * from amount + tax_amount so a client cannot post a total that does not add up.
 */
class Expense extends Model
{
    protected const TABLE    = 'expenses';
    protected const FILLABLE = [
        'expense_no', 'expense_date', 'category', 'subcategory', 'booking_id', 'supplier_id',
        'description', 'amount', 'tax_amount', 'total_amount', 'mode', 'paid_by',
        'is_reimbursable', 'reimbursed_at', 'status', 'approved_by', 'approved_at',
        'rejection_reason',
    ];
    protected const SORTABLE = ['id', 'expense_no', 'expense_date', 'category', 'amount', 'total_amount', 'status', 'created_at'];

    public const MODES = ['cash', 'bank_transfer', 'upi', 'cheque', 'card'];

    /** Only these may still be edited; approval freezes the document. */
    public const EDITABLE_STATUSES = ['draft', 'submitted', 'rejected'];

    /** Only these may be approved or rejected. */
    private const DECIDABLE_STATUSES = ['draft', 'submitted'];

    /** Categories offered before the operator has entered any of their own. */
    private const SEED_CATEGORIES = [
        'Marketing', 'Office Rent', 'Salaries', 'Fuel', 'Travel', 'Utilities',
        'Software', 'Professional Fees', 'Bank Charges', 'Entertainment', 'Miscellaneous',
    ];

    /** @return array{0:array, 1:int} */
    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        [$where, $params] = self::filterClauses($filters);

        $total = (int) Database::scalar(
            "SELECT COUNT(*) FROM expenses e
               LEFT JOIN bookings b  ON b.id = e.booking_id
               LEFT JOIN suppliers s ON s.id = e.supplier_id
              WHERE $where",
            $params
        );

        $sortCol = self::assertSortable($sort, 'expense_date');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT e.*, b.booking_no, b.travel_from, s.name AS supplier_name,
                    p.full_name AS paid_by_name, a.full_name AS approved_by_name,
                    cr.full_name AS created_by_name,
                    (SELECT COUNT(*) FROM attachments att
                      WHERE att.entity_type = 'expense' AND att.entity_id = e.id) AS attachment_count
               FROM expenses e
               LEFT JOIN bookings  b  ON b.id = e.booking_id
               LEFT JOIN suppliers s  ON s.id = e.supplier_id
               LEFT JOIN users     p  ON p.id = e.paid_by
               LEFT JOIN users     a  ON a.id = e.approved_by
               LEFT JOIN users     cr ON cr.id = e.created_by
              WHERE $where
              ORDER BY e.$sortCol $sortDir, e.id DESC
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $e = Database::fetch(
            'SELECT e.*, b.booking_no, b.travel_from, b.travel_to,
                    s.name AS supplier_name, s.supplier_type,
                    p.full_name AS paid_by_name, a.full_name AS approved_by_name,
                    cr.full_name AS created_by_name, vd.full_name AS voided_by_name
               FROM expenses e
               LEFT JOIN bookings  b  ON b.id = e.booking_id
               LEFT JOIN suppliers s  ON s.id = e.supplier_id
               LEFT JOIN users     p  ON p.id = e.paid_by
               LEFT JOIN users     a  ON a.id = e.approved_by
               LEFT JOIN users     cr ON cr.id = e.created_by
               LEFT JOIN users     vd ON vd.id = e.voided_by
              WHERE e.id = ? LIMIT 1',
            [$id]
        );
        if ($e === null) {
            return null;
        }

        $e['attachments'] = Database::fetchAll(
            "SELECT id, category, original_name, mime_type, size_bytes, created_at
               FROM attachments WHERE entity_type = 'expense' AND entity_id = ?
              ORDER BY id ASC",
            [$id]
        );
        $e['payments'] = Payment::forRef('expense', $id);

        return $e;
    }

    /**
     * Category / status / month breakdown for the same filter set as paginate(),
     * so the numbers on a filtered screen always reconcile with the rows on it.
     */
    public static function summary(array $filters): array
    {
        [$where, $params] = self::filterClauses($filters);

        $byCategory = Database::fetchAll(
            "SELECT e.category,
                    COUNT(*) AS expense_count,
                    COALESCE(SUM(e.amount), 0)       AS net_amount,
                    COALESCE(SUM(e.tax_amount), 0)   AS tax_amount,
                    COALESCE(SUM(e.total_amount), 0) AS total_amount,
                    COALESCE(SUM(CASE WHEN e.booking_id IS NULL THEN e.total_amount ELSE 0 END), 0) AS overhead_amount,
                    COALESCE(SUM(CASE WHEN e.booking_id IS NOT NULL THEN e.total_amount ELSE 0 END), 0) AS direct_amount
               FROM expenses e
               LEFT JOIN bookings b  ON b.id = e.booking_id
               LEFT JOIN suppliers s ON s.id = e.supplier_id
              WHERE $where
              GROUP BY e.category
              ORDER BY total_amount DESC",
            $params
        );

        $byStatus = Database::fetchAll(
            "SELECT e.status, COUNT(*) AS expense_count, COALESCE(SUM(e.total_amount), 0) AS total_amount
               FROM expenses e
               LEFT JOIN bookings b  ON b.id = e.booking_id
               LEFT JOIN suppliers s ON s.id = e.supplier_id
              WHERE $where
              GROUP BY e.status",
            $params
        );

        $byMonth = Database::fetchAll(
            "SELECT DATE_FORMAT(e.expense_date, '%Y-%m') AS period,
                    COUNT(*) AS expense_count,
                    COALESCE(SUM(e.total_amount), 0) AS total_amount
               FROM expenses e
               LEFT JOIN bookings b  ON b.id = e.booking_id
               LEFT JOIN suppliers s ON s.id = e.supplier_id
              WHERE $where
              GROUP BY period
              ORDER BY period ASC",
            $params
        );

        return [
            'by_category' => $byCategory,
            'by_status'   => $byStatus,
            'by_month'    => $byMonth,
            'totals'      => [
                'expense_count'   => (int) array_sum(array_column($byCategory, 'expense_count')),
                'net_amount'      => Money::sum(array_column($byCategory, 'net_amount')),
                'tax_amount'      => Money::sum(array_column($byCategory, 'tax_amount')),
                'total_amount'    => Money::sum(array_column($byCategory, 'total_amount')),
                'overhead_amount' => Money::sum(array_column($byCategory, 'overhead_amount')),
                'direct_amount'   => Money::sum(array_column($byCategory, 'direct_amount')),
            ],
        ];
    }

    /** Distinct categories already in use, unioned with the starter list. */
    public static function categories(): array
    {
        $used = Database::fetchAll(
            "SELECT category, COUNT(*) AS usage_count, MAX(expense_date) AS last_used
               FROM expenses WHERE status <> 'void' AND category <> ''
              GROUP BY category ORDER BY usage_count DESC, category ASC"
        );

        $known = array_column($used, 'category');
        foreach (self::SEED_CATEGORIES as $seed) {
            if (!in_array($seed, $known, true)) {
                $used[] = ['category' => $seed, 'usage_count' => 0, 'last_used' => null];
            }
        }

        return $used;
    }

    /** Compute amount / tax / total consistently for both create and update. */
    public static function money(array $data, array $fallback = []): array
    {
        $amount = Money::of($data['amount'] ?? ($fallback['amount'] ?? 0));
        $tax    = Money::of($data['tax_amount'] ?? ($fallback['tax_amount'] ?? 0));

        if (!Money::greaterThan($amount, 0)) {
            throw new ValidationException(['amount' => ['Expense amount must be greater than zero']]);
        }
        if (!Money::isNonNegative($tax)) {
            throw new ValidationException(['tax_amount' => ['Tax cannot be negative']]);
        }

        return ['amount' => $amount, 'tax_amount' => $tax, 'total_amount' => Money::of($amount + $tax)];
    }

    public static function assertEditable(array $expense): void
    {
        if (!in_array($expense['status'], self::EDITABLE_STATUSES, true)) {
            throw new BusinessRuleException(
                'A ' . $expense['status'] . ' expense cannot be edited. Void it and raise a new one.'
            );
        }
    }

    /** draft → submitted. Separates "I am still typing" from "please approve". */
    public static function submit(int $id): void
    {
        $e = self::findOrFail($id);
        if ($e['status'] !== 'draft') {
            throw new BusinessRuleException('Only a draft expense can be submitted');
        }
        Database::execute("UPDATE expenses SET status = 'submitted' WHERE id = ?", [$id]);
        Audit::log('expense_submitted', 'expense', $id, null, ['expense_no' => $e['expense_no']]);
    }

    public static function approve(int $id): void
    {
        Database::transaction(static function () use ($id) {
            $e = self::findOrFail($id);
            if (!in_array($e['status'], self::DECIDABLE_STATUSES, true)) {
                throw new BusinessRuleException('Only a draft or submitted expense can be approved');
            }

            Database::execute(
                "UPDATE expenses SET status = 'approved', approved_by = ?, approved_at = NOW(),
                        rejection_reason = NULL
                  WHERE id = ?",
                [Request::userId(), $id]
            );

            Audit::log('expense_approved', 'expense', $id, ['status' => $e['status']], [
                'status' => 'approved', 'total_amount' => $e['total_amount'],
            ]);
        });
    }

    public static function reject(int $id, string $reason): void
    {
        Database::transaction(static function () use ($id, $reason) {
            $e = self::findOrFail($id);
            if (!in_array($e['status'], self::DECIDABLE_STATUSES, true)) {
                throw new BusinessRuleException('Only a draft or submitted expense can be rejected');
            }

            Database::execute(
                "UPDATE expenses SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = NOW()
                  WHERE id = ?",
                [mb_substr($reason, 0, 255), Request::userId(), $id]
            );

            Audit::log('expense_rejected', 'expense', $id, ['status' => $e['status']], ['reason' => $reason]);
        });
    }

    /** Mark an approved expense as actually disbursed. */
    public static function markPaid(int $id, ?string $paidOn = null): void
    {
        Database::transaction(static function () use ($id, $paidOn) {
            $e = self::findOrFail($id);
            if ($e['status'] !== 'approved') {
                throw new BusinessRuleException('Only an approved expense can be marked paid');
            }

            $reimbursedAt = (int) $e['is_reimbursable'] === 1
                ? (($paidOn ?? date('Y-m-d')) . ' 00:00:00')
                : null;

            Database::execute(
                "UPDATE expenses SET status = 'paid', reimbursed_at = COALESCE(?, reimbursed_at) WHERE id = ?",
                [$reimbursedAt, $id]
            );

            Audit::log('expense_paid', 'expense', $id, ['status' => 'approved'], ['status' => 'paid']);
        });
    }

    /** Expenses are never deleted; a wrong one is voided with a reason. */
    public static function void(int $id, string $reason): void
    {
        Database::transaction(static function () use ($id, $reason) {
            $e = self::findOrFail($id);
            if ($e['status'] === 'void') {
                throw new BusinessRuleException('Expense is already void');
            }

            Database::execute(
                "UPDATE expenses SET status = 'void', voided_by = ?, voided_at = NOW(), void_reason = ?
                  WHERE id = ?",
                [Request::userId(), mb_substr($reason, 0, 255), $id]
            );

            Audit::log('expense_voided', 'expense', $id, $e, ['reason' => $reason]);
        });
    }

    // -----------------------------------------------------------------------

    /** @return array{0:string, 1:array} */
    private static function filterClauses(array $filters): array
    {
        $clauses = [['1=1', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(e.expense_no LIKE ? OR e.description LIKE ? OR e.category LIKE ? OR e.subcategory LIKE ?)',
                          [$like, $like, $like, $like]];
        }
        if (!empty($filters['category'])) {
            $clauses[] = ['e.category = ?', [(string) $filters['category']]];
        }
        if (!empty($filters['subcategory'])) {
            $clauses[] = ['e.subcategory = ?', [(string) $filters['subcategory']]];
        }
        if (!empty($filters['status'])) {
            $statuses = is_array($filters['status']) ? $filters['status'] : explode(',', (string) $filters['status']);
            $statuses = array_values(array_filter(array_map('trim', $statuses)));
            if ($statuses !== []) {
                $marks = implode(',', array_fill(0, count($statuses), '?'));
                $clauses[] = ["e.status IN ($marks)", $statuses];
            }
        } else {
            // Voided rows are noise on every default view; ask for them explicitly.
            $clauses[] = ["e.status <> 'void'", []];
        }
        if (!empty($filters['booking_id'])) {
            $clauses[] = ['e.booking_id = ?', [(int) $filters['booking_id']]];
        }
        if (!empty($filters['supplier_id'])) {
            $clauses[] = ['e.supplier_id = ?', [(int) $filters['supplier_id']]];
        }
        if (!empty($filters['paid_by'])) {
            $clauses[] = ['e.paid_by = ?', [(int) $filters['paid_by']]];
        }
        if (!empty($filters['mode'])) {
            $clauses[] = ['e.mode = ?', [(string) $filters['mode']]];
        }
        if (!empty($filters['from'])) {
            $clauses[] = ['e.expense_date >= ?', [$filters['from']]];
        }
        if (!empty($filters['to'])) {
            $clauses[] = ['e.expense_date <= ?', [$filters['to']]];
        }
        if (isset($filters['min_amount']) && is_numeric($filters['min_amount'])) {
            $clauses[] = ['e.total_amount >= ?', [Money::of($filters['min_amount'])]];
        }
        if (isset($filters['max_amount']) && is_numeric($filters['max_amount'])) {
            $clauses[] = ['e.total_amount <= ?', [Money::of($filters['max_amount'])]];
        }
        if (!empty($filters['reimbursable_only'])) {
            $clauses[] = ['e.is_reimbursable = 1 AND e.reimbursed_at IS NULL', []];
        }
        if (!empty($filters['overheads_only'])) {
            $clauses[] = ['e.booking_id IS NULL', []];
        }
        if (!empty($filters['direct_only'])) {
            $clauses[] = ['e.booking_id IS NOT NULL', []];
        }

        return self::buildWhere($clauses);
    }
}
