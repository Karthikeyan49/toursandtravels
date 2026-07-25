<?php

/**
 * Actual travel logistics captured once a booking is live — real flight/train/bus
 * numbers, PNR, exact timings — for the printable itinerary handout. Deliberately
 * separate from `booking_services` (costing/billing); see 011_travel_legs.sql.
 */
class TravelLeg extends Model
{
    protected const TABLE    = 'booking_travel_legs';
    protected const FILLABLE = [
        'booking_id', 'leg_no', 'mode', 'direction', 'carrier_name', 'vehicle_number',
        'pnr', 'seat_class', 'from_location', 'to_location', 'departure_date',
        'departure_time', 'arrival_date', 'arrival_time', 'baggage_allowance',
        'confirmation_status', 'notes', 'sort_order', 'created_by',
    ];
    protected const SORTABLE = ['id', 'leg_no', 'sort_order', 'departure_date'];

    public static function forBooking(int $bookingId): array
    {
        return Database::fetchAll(
            'SELECT * FROM booking_travel_legs WHERE booking_id = ? ORDER BY sort_order ASC, leg_no ASC',
            [$bookingId]
        );
    }

    /**
     * Replace the whole leg list for a booking. Transactional delete + reinsert,
     * the same pattern as Package::replaceItinerary — legs have no life of their
     * own outside the set the ops user is currently editing. leg_no is always
     * renumbered from 1 in the order supplied.
     */
    public static function replaceForBooking(int $bookingId, array $legs): array
    {
        return Database::transaction(static function () use ($bookingId, $legs) {
            Database::execute('DELETE FROM booking_travel_legs WHERE booking_id = ?', [$bookingId]);

            $no = 0;
            foreach ($legs as $leg) {
                $no++;
                self::insertLeg($bookingId, $leg, $no, $no - 1);
            }

            return self::forBooking($bookingId);
        });
    }

    /** Append a single leg after whatever already exists for this booking. */
    public static function add(int $bookingId, array $leg): int
    {
        $nextNo = 1 + (int) Database::scalar(
            'SELECT COALESCE(MAX(leg_no), 0) FROM booking_travel_legs WHERE booking_id = ?',
            [$bookingId]
        );
        $nextSort = 1 + (int) Database::scalar(
            'SELECT COALESCE(MAX(sort_order), -1) FROM booking_travel_legs WHERE booking_id = ?',
            [$bookingId]
        );

        return self::insertLeg($bookingId, $leg, $nextNo, $nextSort);
    }

    public static function updateOne(int $legId, array $data): void
    {
        $existing = self::findOrFail($legId);
        $merged   = array_merge($existing, $data);
        self::assertLegShape($merged);

        self::updateById($legId, $data);
    }

    public static function remove(int $legId): void
    {
        self::findOrFail($legId);
        Database::execute('DELETE FROM booking_travel_legs WHERE id = ?', [$legId]);
    }

    public static function markConfirmed(int $legId, string $pnr): void
    {
        self::findOrFail($legId);
        Database::execute(
            "UPDATE booking_travel_legs SET confirmation_status = 'confirmed', pnr = ? WHERE id = ?",
            [mb_substr(trim($pnr), 0, 20), $legId]
        );
    }

    // -----------------------------------------------------------------------

    private static function insertLeg(int $bookingId, array $leg, int $legNo, int $sortOrder): int
    {
        self::assertLegShape($leg);

        return Database::insert('booking_travel_legs', [
            'booking_id'          => $bookingId,
            'leg_no'              => $legNo,
            'mode'                => in_array($leg['mode'] ?? '', ['flight', 'train', 'bus', 'car', 'other'], true)
                ? $leg['mode'] : 'flight',
            'direction'           => in_array($leg['direction'] ?? '', ['onward', 'return', 'internal'], true)
                ? $leg['direction'] : 'onward',
            'carrier_name'        => isset($leg['carrier_name']) ? mb_substr((string) $leg['carrier_name'], 0, 120) : null,
            'vehicle_number'      => isset($leg['vehicle_number']) ? mb_substr((string) $leg['vehicle_number'], 0, 30) : null,
            'pnr'                 => isset($leg['pnr']) ? mb_substr((string) $leg['pnr'], 0, 20) : null,
            'seat_class'          => isset($leg['seat_class']) ? mb_substr((string) $leg['seat_class'], 0, 40) : null,
            'from_location'       => mb_substr((string) $leg['from_location'], 0, 160),
            'to_location'         => mb_substr((string) $leg['to_location'], 0, 160),
            'departure_date'      => $leg['departure_date'],
            'departure_time'      => $leg['departure_time'] ?? null,
            'arrival_date'        => $leg['arrival_date'] ?? null,
            'arrival_time'        => $leg['arrival_time'] ?? null,
            'baggage_allowance'   => isset($leg['baggage_allowance']) ? mb_substr((string) $leg['baggage_allowance'], 0, 120) : null,
            'confirmation_status' => in_array($leg['confirmation_status'] ?? '', ['pending', 'confirmed', 'cancelled'], true)
                ? $leg['confirmation_status'] : 'pending',
            'notes'               => isset($leg['notes']) ? mb_substr((string) $leg['notes'], 0, 500) : null,
            'sort_order'          => $sortOrder,
            'created_by'          => Request::userId(),
        ], [
            'booking_id', 'leg_no', 'mode', 'direction', 'carrier_name', 'vehicle_number', 'pnr',
            'seat_class', 'from_location', 'to_location', 'departure_date', 'departure_time',
            'arrival_date', 'arrival_time', 'baggage_allowance', 'confirmation_status', 'notes',
            'sort_order', 'created_by',
        ]);
    }

    /** from_location/to_location/departure_date are mandatory; arrival, if given, may not precede departure. */
    private static function assertLegShape(array $leg): void
    {
        if (trim((string) ($leg['from_location'] ?? '')) === '') {
            throw new ValidationException(['from_location' => ['Every travel leg needs a starting point']]);
        }
        if (trim((string) ($leg['to_location'] ?? '')) === '') {
            throw new ValidationException(['to_location' => ['Every travel leg needs a destination']]);
        }
        if (empty($leg['departure_date'])) {
            throw new ValidationException(['departure_date' => ['Every travel leg needs a departure date']]);
        }

        if (!empty($leg['arrival_date'])) {
            $depart = strtotime($leg['departure_date'] . ' ' . ($leg['departure_time'] ?? '00:00:00'));
            $arrive = strtotime($leg['arrival_date'] . ' ' . ($leg['arrival_time'] ?? '00:00:00'));
            if ($arrive !== false && $depart !== false && $arrive < $depart) {
                throw new ValidationException(['arrival_date' => ['Arrival cannot be before departure']]);
            }
        }
    }
}
