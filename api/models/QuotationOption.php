<?php

/**
 * The toggle set behind the "Dynamic Quotation Builder" (one row per quotation).
 * A thin model on purpose: every write is either "read the row" or "upsert the
 * whole row", there is no partial workflow of its own — see 010_quotation_builder.sql.
 */
class QuotationOption extends Model
{
    protected const TABLE    = 'quotation_options';
    protected const FILLABLE = [
        'quotation_id', 'transport_mode', 'room_category', 'food_included', 'diet_type',
        'baggage_included', 'baggage_notes', 'local_transport_included',
        'sightseeing_included', 'insurance_included',
    ];

    /** The 8 client-editable toggle fields (everything except the FK). */
    public const FIELDS = [
        'transport_mode', 'room_category', 'food_included', 'diet_type',
        'baggage_included', 'baggage_notes', 'local_transport_included',
        'sightseeing_included', 'insurance_included',
    ];

    public static function forQuotation(int $quotationId): ?array
    {
        return Database::fetch('SELECT * FROM quotation_options WHERE quotation_id = ?', [$quotationId]);
    }

    /**
     * Validated allowlist upsert. `quotation_id` is unique, so this is always
     * exactly one row per quotation regardless of how many times it is saved.
     */
    public static function upsert(int $quotationId, array $data): void
    {
        $data = array_intersect_key($data, array_flip(self::FIELDS));
        if ($data === []) {
            return;
        }

        $data['quotation_id'] = $quotationId;

        $cols       = array_keys($data);
        $marks      = array_map(static fn($c) => ':' . $c, $cols);
        $updateCols = array_diff($cols, ['quotation_id']);
        $updates    = array_map(static fn($c) => "`$c` = VALUES(`$c`)", $updateCols);

        $sql = 'INSERT INTO quotation_options (`' . implode('`, `', $cols) . '`) VALUES (' . implode(', ', $marks) . ')'
             . ($updates !== [] ? ' ON DUPLICATE KEY UPDATE ' . implode(', ', $updates) : '');

        Database::execute($sql, array_combine($marks, array_values($data)));
    }

    /**
     * Copy the toggle set onto a freshly-created booking. Used by
     * QuotationController::convert() so the choices the customer agreed to
     * travel forward automatically, without operations having to re-enter them.
     */
    public static function copyToBooking(int $quotationId, int $bookingId): void
    {
        $opt = self::forQuotation($quotationId);
        if ($opt === null) {
            return;
        }
        BookingOption::upsert($bookingId, $opt);
    }
}
