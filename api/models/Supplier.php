<?php

class Supplier extends Model
{
    protected const TABLE       = 'suppliers';
    protected const SOFT_DELETE = true;
    protected const FILLABLE = [
        'code', 'name', 'supplier_type', 'destination_id', 'contact_person', 'phone',
        'alt_phone', 'email', 'address', 'city', 'state', 'country_id', 'gstin', 'pan',
        'currency', 'credit_days', 'credit_limit', 'bank_name', 'bank_account',
        'bank_ifsc', 'rating', 'notes', 'is_active',
    ];
    protected const SORTABLE = ['id', 'name', 'code', 'supplier_type', 'rating', 'created_at'];

    public static function nextCode(): string
    {
        return NumberSequence::next('SUP');
    }

    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['s.is_deleted = 0', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(s.name LIKE ? OR s.code LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ?)',
                          [$like, $like, $like, $like]];
        }
        if (!empty($filters['supplier_type'])) {
            $clauses[] = ['s.supplier_type = ?', [$filters['supplier_type']]];
        }
        if (!empty($filters['destination_id'])) {
            $clauses[] = ['s.destination_id = ?', [(int) $filters['destination_id']]];
        }
        if (isset($filters['is_active'])) {
            $clauses[] = ['s.is_active = ?', [(int) $filters['is_active']]];
        }

        [$where, $params] = self::buildWhere($clauses);
        $total = (int) Database::scalar("SELECT COUNT(*) FROM suppliers s WHERE $where", $params);

        $sortCol = self::assertSortable($sort, 'name');
        $sortDir = self::sortDirection($dir);

        // Outstanding payable is COMPUTED, never stored.
        $rows = Database::fetchAll(
            "SELECT s.*, d.name AS destination_name,
                    COALESCE(bills.total_billed, 0) AS total_billed,
                    COALESCE(bills.total_paid, 0)   AS total_paid,
                    COALESCE(bills.total_billed, 0) - COALESCE(bills.total_paid, 0) AS outstanding
               FROM suppliers s
               LEFT JOIN destinations d ON d.id = s.destination_id
               LEFT JOIN (
                    SELECT supplier_id,
                           SUM(grand_total) AS total_billed,
                           SUM(amount_paid) AS total_paid
                      FROM supplier_bills
                     WHERE status NOT IN ('void','cancelled')
                     GROUP BY supplier_id
               ) bills ON bills.supplier_id = s.id
              WHERE $where
              ORDER BY s.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function options(?string $type = null, ?int $destinationId = null): array
    {
        $clauses = [['is_deleted = 0 AND is_active = 1', []]];
        if ($type !== null && $type !== '') {
            $clauses[] = ['supplier_type = ?', [$type]];
        }
        if ($destinationId !== null && $destinationId > 0) {
            $clauses[] = ['(destination_id = ? OR destination_id IS NULL)', [$destinationId]];
        }
        [$where, $params] = self::buildWhere($clauses);

        return Database::fetchAll(
            "SELECT id, code, name, supplier_type, currency, credit_days
               FROM suppliers WHERE $where ORDER BY name ASC",
            $params
        );
    }

    /** Ledger: bills and payments interleaved, running balance computed client-side. */
    public static function ledger(int $supplierId, ?string $from = null, ?string $to = null): array
    {
        $clauses = [['sb.supplier_id = ?', [$supplierId]], ["sb.status NOT IN ('void')", []]];
        if ($from !== null) {
            $clauses[] = ['sb.bill_date >= ?', [$from]];
        }
        if ($to !== null) {
            $clauses[] = ['sb.bill_date <= ?', [$to]];
        }
        [$where, $params] = self::buildWhere($clauses);

        $bills = Database::fetchAll(
            "SELECT sb.id, sb.bill_no, sb.supplier_ref_no, sb.bill_date, sb.due_date,
                    sb.grand_total, sb.amount_paid, sb.payment_status, sb.status,
                    b.booking_no
               FROM supplier_bills sb
               LEFT JOIN bookings b ON b.id = sb.booking_id
              WHERE $where
              ORDER BY sb.bill_date DESC, sb.id DESC",
            $params
        );

        $payments = Database::fetchAll(
            "SELECT p.id, p.payment_no, p.amount, p.mode, p.utr_no, p.paid_on, p.status, p.remarks,
                    sb.bill_no
               FROM payments p
               JOIN supplier_bills sb ON sb.id = p.ref_id
              WHERE p.ref_type = 'supplier_bill' AND sb.supplier_id = ? AND p.status <> 'void'
              ORDER BY p.paid_on DESC, p.id DESC
              LIMIT 500",
            [$supplierId]
        );

        return ['bills' => $bills, 'payments' => $payments];
    }

    /** Recompute rating from post-tour feedback + incident count. */
    public static function refreshRating(int $supplierId): void
    {
        $avg = Database::scalar(
            "SELECT AVG(rating_val) FROM (
                SELECT CASE bs.service_type
                         WHEN 'hotel'     THEN f.hotel_rating
                         WHEN 'transport' THEN f.transport_rating
                         WHEN 'guide'     THEN f.guide_rating
                         ELSE f.overall_rating
                       END AS rating_val
                  FROM trip_feedback f
                  JOIN booking_services bs ON bs.booking_id = f.booking_id
                 WHERE bs.supplier_id = ?
             ) t WHERE rating_val IS NOT NULL",
            [$supplierId]
        );

        if ($avg !== null) {
            Database::execute('UPDATE suppliers SET rating = ? WHERE id = ?', [round((float) $avg, 2), $supplierId]);
        }
    }
}
