<?php

/**
 * Same shape as QuotationOption, but on the booking. Kept as a distinct table
 * (rather than reading straight from quotation_options) because editing a live
 * booking's toggles after conversion is a deliberate, audited action of its
 * own — see 010_quotation_builder.sql.
 */
class BookingOption extends Model
{
    protected const TABLE    = 'booking_options';
    protected const FILLABLE = [
        'booking_id', 'transport_mode', 'room_category', 'food_included', 'diet_type',
        'baggage_included', 'baggage_notes', 'local_transport_included',
        'sightseeing_included', 'insurance_included',
    ];

    /** The 8 client-editable toggle fields (everything except the FK). */
    public const FIELDS = [
        'transport_mode', 'room_category', 'food_included', 'diet_type',
        'baggage_included', 'baggage_notes', 'local_transport_included',
        'sightseeing_included', 'insurance_included',
    ];

    public static function forBooking(int $bookingId): ?array
    {
        return Database::fetch('SELECT * FROM booking_options WHERE booking_id = ?', [$bookingId]);
    }

    /**
     * Validated allowlist upsert. `booking_id` is unique, so this is always
     * exactly one row per booking regardless of how many times it is saved.
     */
    public static function upsert(int $bookingId, array $data): void
    {
        $data = array_intersect_key($data, array_flip(self::FIELDS));
        if ($data === []) {
            return;
        }

        $data['booking_id'] = $bookingId;

        $cols       = array_keys($data);
        $marks      = array_map(static fn($c) => ':' . $c, $cols);
        $updateCols = array_diff($cols, ['booking_id']);
        $updates    = array_map(static fn($c) => "`$c` = VALUES(`$c`)", $updateCols);

        $sql = 'INSERT INTO booking_options (`' . implode('`, `', $cols) . '`) VALUES (' . implode(', ', $marks) . ')'
             . ($updates !== [] ? ' ON DUPLICATE KEY UPDATE ' . implode(', ', $updates) : '');

        Database::execute($sql, array_combine($marks, array_values($data)));
    }
}
