<?php

class Package extends Model
{
    protected const TABLE       = 'packages';
    protected const SOFT_DELETE = true;
    protected const FILLABLE = [
        'code', 'name', 'destination_id', 'package_type', 'scope', 'nights', 'days',
        'min_pax', 'max_pax', 'summary', 'description', 'inclusions', 'exclusions',
        'terms', 'cancellation_policy', 'hero_image', 'base_price_adult', 'currency',
        'markup_pct', 'gst_pct', 'status',
    ];
    protected const SORTABLE = ['id', 'name', 'code', 'nights', 'base_price_adult', 'created_at'];

    public static function nextCode(): string
    {
        return NumberSequence::next('PKG');
    }

    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['p.is_deleted = 0', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(p.name LIKE ? OR p.code LIKE ? OR p.summary LIKE ?)', [$like, $like, $like]];
        }
        if (!empty($filters['destination_id'])) {
            $clauses[] = ['p.destination_id = ?', [(int) $filters['destination_id']]];
        }
        if (!empty($filters['package_type'])) {
            $clauses[] = ['p.package_type = ?', [$filters['package_type']]];
        }
        if (!empty($filters['scope'])) {
            $clauses[] = ['p.scope = ?', [$filters['scope']]];
        }
        if (!empty($filters['status'])) {
            $clauses[] = ['p.status = ?', [$filters['status']]];
        }
        if (!empty($filters['nights_min'])) {
            $clauses[] = ['p.nights >= ?', [(int) $filters['nights_min']]];
        }
        if (!empty($filters['nights_max'])) {
            $clauses[] = ['p.nights <= ?', [(int) $filters['nights_max']]];
        }

        [$where, $params] = self::buildWhere($clauses);
        $total = (int) Database::scalar("SELECT COUNT(*) FROM packages p WHERE $where", $params);

        $sortCol = self::assertSortable($sort, 'created_at');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT p.*, d.name AS destination_name,
                    (SELECT COUNT(*) FROM package_departures pd
                      WHERE pd.package_id = p.id AND pd.status IN ('open','filling')
                        AND pd.departure_date >= CURDATE()) AS open_departures,
                    (SELECT COUNT(*) FROM bookings b
                      WHERE b.package_id = p.id AND b.status NOT IN ('cancelled','draft')) AS booking_count
               FROM packages p
               LEFT JOIN destinations d ON d.id = p.destination_id
              WHERE $where
              ORDER BY p.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $pkg = self::find($id);
        if ($pkg === null) {
            return null;
        }

        $pkg['days'] = Database::fetchAll(
            'SELECT pd.*, c.name AS city_name, oc.name AS overnight_city_name
               FROM package_days pd
               LEFT JOIN cities c  ON c.id  = pd.city_id
               LEFT JOIN cities oc ON oc.id = pd.overnight_city_id
              WHERE pd.package_id = ? ORDER BY pd.day_no ASC',
            [$id]
        );

        $dayIds = array_column($pkg['days'], 'id');
        $pkg['day_items'] = [];
        if ($dayIds !== []) {
            $marks = implode(',', array_fill(0, count($dayIds), '?'));
            $pkg['day_items'] = Database::fetchAll(
                "SELECT * FROM package_day_items WHERE package_day_id IN ($marks) ORDER BY package_day_id, sort_order",
                $dayIds
            );
        }

        $pkg['prices'] = Database::fetchAll(
            'SELECT * FROM package_prices WHERE package_id = ? ORDER BY valid_from DESC, pax_from ASC',
            [$id]
        );

        $pkg['departures'] = Database::fetchAll(
            'SELECT pd.*, (pd.seats_total - pd.seats_booked - pd.seats_held) AS seats_available,
                    u.full_name AS tour_manager_name
               FROM package_departures pd
               LEFT JOIN users u ON u.id = pd.tour_manager_id
              WHERE pd.package_id = ?
              ORDER BY pd.departure_date ASC',
            [$id]
        );

        return $pkg;
    }

    public static function options(?int $destinationId = null): array
    {
        $clauses = [["is_deleted = 0 AND status = 'active'", []]];
        if ($destinationId) {
            $clauses[] = ['destination_id = ?', [$destinationId]];
        }
        [$where, $params] = self::buildWhere($clauses);

        return Database::fetchAll(
            "SELECT id, code, name, nights, days, destination_id, base_price_adult, gst_pct
               FROM packages WHERE $where ORDER BY name ASC",
            $params
        );
    }

    /** Replace the full itinerary in one transaction. */
    public static function replaceItinerary(int $packageId, array $days): void
    {
        Database::transaction(static function () use ($packageId, $days) {
            $existing = Database::fetchAll('SELECT id FROM package_days WHERE package_id = ?', [$packageId]);
            if ($existing !== []) {
                $ids   = array_column($existing, 'id');
                $marks = implode(',', array_fill(0, count($ids), '?'));
                Database::execute("DELETE FROM package_day_items WHERE package_day_id IN ($marks)", $ids);
                Database::execute('DELETE FROM package_days WHERE package_id = ?', [$packageId]);
            }

            $dayNo = 0;
            foreach ($days as $day) {
                $dayNo++;
                $dayId = Database::insert('package_days', [
                    'package_id'        => $packageId,
                    'day_no'            => $dayNo,
                    'title'             => (string) ($day['title'] ?? ('Day ' . $dayNo)),
                    'description'       => $day['description'] ?? null,
                    'city_id'           => !empty($day['city_id']) ? (int) $day['city_id'] : null,
                    'overnight_city_id' => !empty($day['overnight_city_id']) ? (int) $day['overnight_city_id'] : null,
                    'meal_plan'         => $day['meal_plan'] ?? 'B',
                    'distance_km'       => isset($day['distance_km']) ? (int) $day['distance_km'] : null,
                    'drive_hours'       => isset($day['drive_hours']) ? (float) $day['drive_hours'] : null,
                    'image_path'        => $day['image_path'] ?? null,
                ], [
                    'package_id', 'day_no', 'title', 'description', 'city_id',
                    'overnight_city_id', 'meal_plan', 'distance_km', 'drive_hours', 'image_path',
                ]);

                $sort = 0;
                foreach (($day['items'] ?? []) as $item) {
                    Database::insert('package_day_items', [
                        'package_day_id' => $dayId,
                        'item_type'      => $item['item_type'] ?? 'other',
                        'ref_id'         => !empty($item['ref_id']) ? (int) $item['ref_id'] : null,
                        'label'          => (string) ($item['label'] ?? ''),
                        'quantity'       => (float) ($item['quantity'] ?? 1),
                        'unit_cost'      => Money::of($item['unit_cost'] ?? 0),
                        'is_optional'    => !empty($item['is_optional']) ? 1 : 0,
                        'sort_order'     => $sort++,
                    ], [
                        'package_day_id', 'item_type', 'ref_id', 'label',
                        'quantity', 'unit_cost', 'is_optional', 'sort_order',
                    ]);
                }
            }

            // Keep the headline nights/days consistent with the itinerary length.
            if ($dayNo > 0) {
                Database::execute(
                    'UPDATE packages SET days = ?, nights = ? WHERE id = ?',
                    [$dayNo, max(0, $dayNo - 1), $packageId]
                );
            }
        });
    }
}
