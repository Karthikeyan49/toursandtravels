<?php

class Customer extends Model
{
    protected const TABLE       = 'customers';
    protected const SOFT_DELETE = true;
    protected const FILLABLE = [
        'code', 'full_name', 'email', 'phone', 'alt_phone', 'whatsapp', 'address',
        'city', 'state', 'pincode', 'country_id', 'date_of_birth', 'anniversary',
        'gstin', 'customer_type', 'agency_id', 'source', 'notes', 'is_active',
    ];
    protected const SORTABLE = ['id', 'full_name', 'code', 'city', 'created_at'];

    public static function nextCode(): string
    {
        return NumberSequence::next('CUS');
    }

    /** Dedupe on phone — the practical unique key for a walk-in travel business. */
    public static function findByPhone(string $phone): ?array
    {
        return Database::fetch(
            'SELECT * FROM customers WHERE phone = ? AND is_deleted = 0 LIMIT 1',
            [$phone]
        );
    }

    /** @return array{0:array, 1:int} */
    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['c.is_deleted = 0', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.code LIKE ?)',
                          [$like, $like, $like, $like]];
        }
        if (!empty($filters['customer_type'])) {
            $clauses[] = ['c.customer_type = ?', [$filters['customer_type']]];
        }
        if (!empty($filters['agency_id'])) {
            $clauses[] = ['c.agency_id = ?', [(int) $filters['agency_id']]];
        }
        if (!empty($filters['city'])) {
            $clauses[] = ['c.city = ?', [$filters['city']]];
        }
        if (isset($filters['is_active'])) {
            $clauses[] = ['c.is_active = ?', [(int) $filters['is_active']]];
        }

        // Agency users only ever see their own customers.
        [$scopeSql, $scopeParams] = AuthMiddleware::agencyScope('c.agency_id');
        $clauses[] = [$scopeSql, $scopeParams];

        [$where, $params] = self::buildWhere($clauses);

        $total = (int) Database::scalar("SELECT COUNT(*) FROM customers c WHERE $where", $params);

        $sortCol = self::assertSortable($sort, 'created_at');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT c.*, a.name AS agency_name,
                    (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.status <> 'cancelled') AS booking_count,
                    (SELECT COALESCE(SUM(b.grand_total), 0) FROM bookings b
                      WHERE b.customer_id = c.id AND b.status NOT IN ('cancelled','draft')) AS lifetime_value
               FROM customers c
               LEFT JOIN agencies a ON a.id = c.agency_id
              WHERE $where
              ORDER BY c.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    /** Full 360° view: profile + bookings + outstanding. */
    public static function detail(int $id): ?array
    {
        $customer = self::find($id);
        if ($customer === null) {
            return null;
        }

        $customer['bookings'] = Database::fetchAll(
            "SELECT b.id, b.booking_no, b.travel_from, b.travel_to, b.status, b.payment_status,
                    b.grand_total, b.amount_paid, (b.grand_total - b.amount_paid) AS outstanding,
                    d.name AS destination_name, p.name AS package_name
               FROM bookings b
               LEFT JOIN destinations d ON d.id = b.destination_id
               LEFT JOIN packages p     ON p.id = b.package_id
              WHERE b.customer_id = ?
              ORDER BY b.travel_from DESC
              LIMIT 100",
            [$id]
        );

        $customer['stats'] = Database::fetch(
            "SELECT COUNT(*) AS total_bookings,
                    COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','draft') THEN grand_total ELSE 0 END), 0) AS lifetime_value,
                    COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','draft') THEN grand_total - amount_paid ELSE 0 END), 0) AS outstanding,
                    MAX(travel_to) AS last_travelled
               FROM bookings WHERE customer_id = ?",
            [$id]
        );

        $customer['open_leads'] = Database::fetchAll(
            "SELECT id, lead_no, status, destination_id, travel_date, created_at
               FROM leads WHERE customer_id = ? AND status NOT IN ('won','lost','dropped')
              ORDER BY created_at DESC LIMIT 20",
            [$id]
        );

        return $customer;
    }
}
