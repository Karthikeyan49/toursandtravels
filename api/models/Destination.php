<?php

class Destination extends Model
{
    protected const TABLE       = 'destinations';
    protected const SOFT_DELETE = true;
    protected const FILLABLE = [
        'code', 'name', 'country_id', 'region', 'scope', 'description',
        'best_season', 'hero_image', 'is_active',
    ];
    protected const SORTABLE = ['id', 'name', 'code', 'scope', 'created_at'];

    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['d.is_deleted = 0', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(d.name LIKE ? OR d.code LIKE ? OR d.region LIKE ?)', [$like, $like, $like]];
        }
        if (!empty($filters['scope'])) {
            $clauses[] = ['d.scope = ?', [$filters['scope']]];
        }
        if (!empty($filters['country_id'])) {
            $clauses[] = ['d.country_id = ?', [(int) $filters['country_id']]];
        }
        if (isset($filters['is_active'])) {
            $clauses[] = ['d.is_active = ?', [(int) $filters['is_active']]];
        }

        [$where, $params] = self::buildWhere($clauses);
        $total = (int) Database::scalar("SELECT COUNT(*) FROM destinations d WHERE $where", $params);

        $sortCol = self::assertSortable($sort, 'name');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT d.*, co.name AS country_name,
                    (SELECT COUNT(*) FROM packages p WHERE p.destination_id = d.id AND p.is_deleted = 0) AS package_count,
                    (SELECT COUNT(*) FROM hotels h   WHERE h.destination_id = d.id AND h.is_deleted = 0) AS hotel_count
               FROM destinations d
               LEFT JOIN countries co ON co.id = d.country_id
              WHERE $where
              ORDER BY d.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    /** Lightweight list for dropdowns — no counts, no joins. */
    public static function options(): array
    {
        return Database::fetchAll(
            'SELECT id, code, name, scope FROM destinations
              WHERE is_deleted = 0 AND is_active = 1 ORDER BY name ASC'
        );
    }

    public static function cities(int $destinationId): array
    {
        return Database::fetchAll(
            'SELECT id, name, airport_code FROM cities
              WHERE destination_id = ? AND is_deleted = 0 AND is_active = 1 ORDER BY name ASC',
            [$destinationId]
        );
    }

    public static function codeTaken(string $code, ?int $exceptId = null): bool
    {
        $sql = 'SELECT 1 FROM destinations WHERE code = ?';
        $params = [$code];
        if ($exceptId !== null) {
            $sql .= ' AND id <> ?';
            $params[] = $exceptId;
        }
        return Database::scalar($sql . ' LIMIT 1', $params) !== null;
    }
}
