<?php
/**
 * The operations board.
 *
 * One row per booking per travel day, generated when a booking is confirmed.
 * The checklist is stored as JSON so the ops team can tick items without a
 * schema change every time the workflow evolves.
 */
class OpsDaysheet
{
    private const DEFAULT_CHECKLIST = [
        'Hotel confirmed with supplier',
        'Vehicle and driver assigned',
        'Driver briefed with pickup time and pax contact',
        'Vouchers issued to guest',
        'Guest contacted on arrival day',
    ];

    /** Idempotent: re-running after an itinerary change adds only missing days. */
    public static function generateForBooking(int $bookingId): int
    {
        $booking = Database::fetch(
            'SELECT id, travel_from, travel_to, ops_owner_id, destination_id FROM bookings WHERE id = ?',
            [$bookingId]
        );
        if ($booking === null) {
            return 0;
        }

        $start = strtotime((string) $booking['travel_from']);
        $end   = strtotime((string) $booking['travel_to']);
        if ($start === false || $end === false || $end < $start) {
            return 0;
        }

        $created = 0;
        $dayNo = 0;

        for ($t = $start; $t <= $end; $t += 86400) {
            $dayNo++;
            $date = date('Y-m-d', $t);

            $exists = Database::scalar(
                'SELECT 1 FROM ops_daysheets WHERE booking_id = ? AND sheet_date = ? LIMIT 1',
                [$bookingId, $date]
            );
            if ($exists !== null) {
                continue;
            }

            // Pull that day's hotel + city from the service lines when present.
            $svc = Database::fetch(
                "SELECT bs.city_id, bs.ref_id AS hotel_id, bs.description
                   FROM booking_services bs
                  WHERE bs.booking_id = ? AND bs.service_type = 'hotel'
                    AND ? BETWEEN bs.service_date AND COALESCE(bs.service_end_date, bs.service_date)
                  LIMIT 1",
                [$bookingId, $date]
            );

            Database::insert('ops_daysheets', [
                'booking_id'     => $bookingId,
                'sheet_date'     => $date,
                'day_no'         => $dayNo,
                'city_id'        => $svc['city_id'] ?? null,
                'hotel_id'       => $svc['hotel_id'] ?? null,
                'summary'        => $svc['description'] ?? null,
                'checklist_json' => json_encode(array_map(
                    static fn($label) => ['label' => $label, 'done' => false, 'by' => null, 'at' => null],
                    self::DEFAULT_CHECKLIST
                )),
                'status'         => 'pending',
                'owner_id'       => $booking['ops_owner_id'] ?? null,
            ], [
                'booking_id', 'sheet_date', 'day_no', 'city_id', 'hotel_id',
                'summary', 'checklist_json', 'status', 'owner_id',
            ]);

            $created++;
        }

        return $created;
    }

    /** The board for a date: every booking on the road that day. */
    public static function forDate(string $date, array $filters = []): array
    {
        $clauses = ["ds.sheet_date = ?"];
        $params  = [$date];

        if (!empty($filters['status'])) {
            $clauses[] = 'ds.status = ?';
            $params[]  = $filters['status'];
        }
        if (!empty($filters['owner_id'])) {
            $clauses[] = 'ds.owner_id = ?';
            $params[]  = (int) $filters['owner_id'];
        }
        if (!empty($filters['destination_id'])) {
            $clauses[] = 'b.destination_id = ?';
            $params[]  = (int) $filters['destination_id'];
        }

        $where = implode(' AND ', $clauses);

        return Database::fetchAll(
            "SELECT ds.*, b.booking_no, b.lead_pax_name, b.contact_phone, b.adults, b.children,
                    b.travel_from, b.travel_to, b.status AS booking_status,
                    c.full_name AS customer_name,
                    d.name AS destination_name, ci.name AS city_name, h.name AS hotel_name,
                    u.full_name AS owner_name,
                    (SELECT COUNT(*) FROM trip_assignments ta
                      WHERE ta.booking_id = b.id AND ds.sheet_date BETWEEN ta.from_date AND ta.to_date) AS transport_assigned
               FROM ops_daysheets ds
               JOIN bookings b      ON b.id  = ds.booking_id
               LEFT JOIN customers c ON c.id = b.customer_id
               LEFT JOIN destinations d ON d.id = b.destination_id
               LEFT JOIN cities ci   ON ci.id = ds.city_id
               LEFT JOIN hotels h    ON h.id  = ds.hotel_id
               LEFT JOIN users u     ON u.id  = ds.owner_id
              WHERE $where AND b.status NOT IN ('cancelled','draft')
              ORDER BY ds.status = 'issue' DESC, b.booking_no ASC",
            $params
        );
    }

    /** Tick or untick one checklist entry. */
    public static function toggleChecklistItem(int $daysheetId, int $index, bool $done): array
    {
        return Database::transaction(static function () use ($daysheetId, $index, $done) {
            $sheet = Database::fetch('SELECT * FROM ops_daysheets WHERE id = ? FOR UPDATE', [$daysheetId]);
            if ($sheet === null) {
                throw new NotFoundException('Day sheet not found');
            }

            $list = json_decode((string) $sheet['checklist_json'], true);
            if (!is_array($list) || !isset($list[$index])) {
                throw new ValidationException(['index' => ['Checklist item not found']]);
            }

            $list[$index]['done'] = $done;
            $list[$index]['by']   = $done ? Request::userId() : null;
            $list[$index]['at']   = $done ? date('Y-m-d H:i:s') : null;

            $allDone = true;
            $anyDone = false;
            foreach ($list as $item) {
                $allDone = $allDone && !empty($item['done']);
                $anyDone = $anyDone || !empty($item['done']);
            }

            $status = $sheet['status'] === 'issue'
                ? 'issue'
                : ($allDone ? 'done' : ($anyDone ? 'in_progress' : 'pending'));

            Database::execute(
                'UPDATE ops_daysheets SET checklist_json = ?, status = ? WHERE id = ?',
                [json_encode($list), $status, $daysheetId]
            );

            return ['checklist' => $list, 'status' => $status];
        });
    }
}
