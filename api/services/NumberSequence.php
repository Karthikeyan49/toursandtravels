<?php
/**
 * Atomic document numbering.
 *
 * One row per (doc_type, period) in `document_sequences`. Allocation is a SINGLE
 * statement — no SELECT ... FOR UPDATE, no explicit transaction, so two concurrent
 * bookings can never receive the same number even under a race:
 *
 *   INSERT INTO document_sequences (doc_type, period, next_value)
 *   VALUES (?, ?, LAST_INSERT_ID(2))
 *   ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1)
 *
 * LAST_INSERT_ID(expr) sets the session value AND returns it, so the read-back is
 * correct on both the insert and the update path. On insert we seed with 2 and
 * subtract 1, so the first allocated number is 1.
 */
class NumberSequence
{
    /**
     * doc_type => [default prefix, period policy]
     * Policies: yearly | monthly | financial_year | continuous
     */
    private const DOCUMENTS = [
        'LEAD' => ['LEAD', 'yearly'],
        'QTN'  => ['QTN',  'financial_year'],
        'BKG'  => ['BKG',  'financial_year'],
        'INV'  => ['INV',  'financial_year'],
        'CASH' => ['CASH', 'financial_year'],
        'PAY'  => ['PAY',  'financial_year'],
        'VCH'  => ['VCH',  'financial_year'],
        'SB'   => ['SB',   'financial_year'],
        'EXP'  => ['EXP',  'financial_year'],
        'COM'  => ['COM',  'financial_year'],
        'PKG'  => ['PKG',  'continuous'],
        'CUS'  => ['CUS',  'continuous'],
        'SUP'  => ['SUP',  'continuous'],
        'AGY'  => ['AGY',  'continuous'],
        'TRP'  => ['TRP',  'yearly'],
    ];

    private const DEFAULT_PADDING = 4;

    /** Allocate and format the next number. Consumes the sequence. */
    public static function next(string $docType, ?DateTimeInterface $when = null): string
    {
        [$defaultPrefix, $policy] = self::DOCUMENTS[$docType]
            ?? throw new InvalidArgumentException("Unknown document type: $docType");

        $period = self::period($policy, $when);
        $value  = self::allocate($docType, $period);

        return self::format($docType, $defaultPrefix, $period, $value);
    }

    /** Show what the next number WOULD be, without consuming it. */
    public static function preview(string $docType, ?DateTimeInterface $when = null): string
    {
        [$defaultPrefix, $policy] = self::DOCUMENTS[$docType]
            ?? throw new InvalidArgumentException("Unknown document type: $docType");

        $period  = self::period($policy, $when);
        $current = Database::scalar(
            'SELECT next_value FROM document_sequences WHERE doc_type = ? AND period = ?',
            [$docType, $period]
        );

        return self::format($docType, $defaultPrefix, $period, (int) ($current ?? 1));
    }

    private static function allocate(string $docType, string $period): int
    {
        Database::execute(
            'INSERT INTO document_sequences (doc_type, period, next_value)
             VALUES (?, ?, LAST_INSERT_ID(2))
             ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1)',
            [$docType, $period]
        );
        // On the INSERT path LAST_INSERT_ID() is 2 → value 1.
        // On the UPDATE path it is the new next_value → value is the previous one.
        return Database::lastInsertId() - 1;
    }

    private static function format(string $docType, string $defaultPrefix, string $period, int $value): string
    {
        $prefix  = self::setting('seq_' . $docType . '_prefix', $defaultPrefix);
        // Sanitise: an operator editing a prefix in Settings must not be able to
        // inject characters that break filenames or CSV exports.
        $prefix  = preg_replace('/[^A-Z0-9]/', '', strtoupper($prefix)) ?: $defaultPrefix;
        $prefix  = substr($prefix, 0, 12);

        $padding = (int) self::setting('seq_' . $docType . '_padding', (string) self::DEFAULT_PADDING);
        $padding = max(2, min($padding, 8));

        $number = str_pad((string) $value, $padding, '0', STR_PAD_LEFT);

        return $period === ''
            ? $prefix . '-' . $number
            : $prefix . '-' . $period . '-' . $number;
    }

    private static function period(string $policy, ?DateTimeInterface $when): string
    {
        $when ??= new DateTimeImmutable('now');

        switch ($policy) {
            case 'yearly':
                return $when->format('Y');
            case 'monthly':
                return $when->format('Y-m');
            case 'financial_year':
                // Indian FY runs April–March: 2026-07-25 → "2026-27".
                $y = (int) $when->format('Y');
                $m = (int) $when->format('n');
                $start = $m >= 4 ? $y : $y - 1;
                return $start . '-' . substr((string) ($start + 1), -2);
            case 'continuous':
            default:
                return '';
        }
    }

    private static function setting(string $key, string $default): string
    {
        static $cache = [];
        if (!array_key_exists($key, $cache)) {
            $v = Database::scalar('SELECT setting_value FROM settings WHERE setting_key = ?', [$key]);
            $cache[$key] = ($v === null || $v === '') ? $default : (string) $v;
        }
        return $cache[$key];
    }

    /** Powers the Settings > Numbering screen. */
    public static function summary(): array
    {
        $out = [];
        foreach (self::DOCUMENTS as $type => [$prefix, $policy]) {
            $out[] = [
                'doc_type' => $type,
                'prefix'   => self::setting('seq_' . $type . '_prefix', $prefix),
                'policy'   => $policy,
                'padding'  => (int) self::setting('seq_' . $type . '_padding', (string) self::DEFAULT_PADDING),
                'next'     => self::preview($type),
            ];
        }
        return $out;
    }
}
