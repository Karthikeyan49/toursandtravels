<?php

class Hotel extends Model
{
    protected const TABLE       = 'hotels';
    protected const SOFT_DELETE = true;
    protected const FILLABLE = [
        'supplier_id', 'code', 'name', 'destination_id', 'city_id', 'category',
        'address', 'phone', 'email', 'check_in_time', 'check_out_time',
        'child_free_age', 'amenities', 'notes', 'is_active',
    ];
    protected const SORTABLE = ['id', 'name', 'code', 'category', 'created_at'];

    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['h.is_deleted = 0', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(h.name LIKE ? OR h.code LIKE ? OR h.address LIKE ?)', [$like, $like, $like]];
        }
        if (!empty($filters['destination_id'])) {
            $clauses[] = ['h.destination_id = ?', [(int) $filters['destination_id']]];
        }
        if (!empty($filters['city_id'])) {
            $clauses[] = ['h.city_id = ?', [(int) $filters['city_id']]];
        }
        if (!empty($filters['category'])) {
            $clauses[] = ['h.category = ?', [$filters['category']]];
        }
        if (isset($filters['is_active'])) {
            $clauses[] = ['h.is_active = ?', [(int) $filters['is_active']]];
        }

        [$where, $params] = self::buildWhere($clauses);
        $total = (int) Database::scalar("SELECT COUNT(*) FROM hotels h WHERE $where", $params);

        $sortCol = self::assertSortable($sort, 'name');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT h.*, d.name AS destination_name, c.name AS city_name, s.name AS supplier_name,
                    (SELECT COUNT(*) FROM hotel_room_types rt WHERE rt.hotel_id = h.id AND rt.is_deleted = 0) AS room_type_count,
                    (SELECT COUNT(*) FROM hotel_rates hr WHERE hr.hotel_id = h.id AND hr.is_active = 1
                       AND CURDATE() BETWEEN hr.valid_from AND hr.valid_to) AS live_rate_count
               FROM hotels h
               LEFT JOIN destinations d ON d.id = h.destination_id
               LEFT JOIN cities c       ON c.id = h.city_id
               LEFT JOIN suppliers s    ON s.id = h.supplier_id
              WHERE $where
              ORDER BY h.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $hotel = self::find($id);
        if ($hotel === null) {
            return null;
        }

        $hotel['room_types'] = Database::fetchAll(
            'SELECT * FROM hotel_room_types WHERE hotel_id = ? AND is_deleted = 0 ORDER BY name ASC',
            [$id]
        );

        $hotel['rates'] = Database::fetchAll(
            'SELECT hr.*, rt.name AS room_type_name
               FROM hotel_rates hr
               JOIN hotel_room_types rt ON rt.id = hr.room_type_id
              WHERE hr.hotel_id = ?
              ORDER BY hr.valid_from DESC, rt.name ASC',
            [$id]
        );

        return $hotel;
    }

    public static function options(?int $destinationId = null, ?string $category = null): array
    {
        $clauses = [['h.is_deleted = 0 AND h.is_active = 1', []]];
        if ($destinationId) {
            $clauses[] = ['h.destination_id = ?', [$destinationId]];
        }
        if ($category) {
            $clauses[] = ['h.category = ?', [$category]];
        }
        [$where, $params] = self::buildWhere($clauses);

        return Database::fetchAll(
            "SELECT h.id, h.code, h.name, h.category, h.destination_id, c.name AS city_name
               FROM hotels h LEFT JOIN cities c ON c.id = h.city_id
              WHERE $where ORDER BY h.name ASC",
            $params
        );
    }

    /**
     * Resolve the contracted rate for a room on a given date.
     * Returns null when no contract covers the date — the caller must then treat
     * the cost as manual entry rather than silently assuming zero.
     */
    public static function resolveRate(int $hotelId, int $roomTypeId, string $date, string $mealPlan = 'CP'): ?array
    {
        return Database::fetch(
            'SELECT * FROM hotel_rates
              WHERE hotel_id = ? AND room_type_id = ? AND is_active = 1
                AND ? BETWEEN valid_from AND valid_to
                AND meal_plan = ?
              ORDER BY valid_from DESC
              LIMIT 1',
            [$hotelId, $roomTypeId, $date, $mealPlan]
        );
    }
}
