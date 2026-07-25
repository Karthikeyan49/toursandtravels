<?php
/**
 * Money arithmetic.
 *
 * Storage is DECIMAL(15,2) — exact. PHP reads it back as a float, so every
 * computed amount is rounded to 2dp at the point it is written, and every
 * comparison goes through an epsilon. Never write `if ($paid == $total)`.
 */
class Money
{
    /** Half a paisa. Anything smaller is float noise, not a real difference. */
    public const EPSILON = 0.005;

    public static function of($value): float
    {
        return round((float) $value, 2);
    }

    public static function sum(array $values): float
    {
        $total = 0.0;
        foreach ($values as $v) {
            $total += (float) $v;
        }
        return round($total, 2);
    }

    /** Line total = qty × unit price, rounded once at the end. */
    public static function lineTotal($quantity, $unitPrice): float
    {
        return round(((float) $quantity) * ((float) $unitPrice), 2);
    }

    /** Percentage of a base, e.g. GST or a commission rate. */
    public static function percentOf($base, $percent): float
    {
        return round(((float) $base) * ((float) $percent) / 100.0, 2);
    }

    public static function equals($a, $b): bool
    {
        return abs(((float) $a) - ((float) $b)) < self::EPSILON;
    }

    public static function greaterThan($a, $b): bool
    {
        return ((float) $a) - ((float) $b) > self::EPSILON;
    }

    public static function lessThan($a, $b): bool
    {
        return ((float) $b) - ((float) $a) > self::EPSILON;
    }

    public static function isZero($a): bool
    {
        return abs((float) $a) < self::EPSILON;
    }

    public static function isNonNegative($a): bool
    {
        return ((float) $a) > -self::EPSILON;
    }

    /** Round a grand total to the nearest rupee; returns [rounded, roundOff]. */
    public static function roundOff($amount): array
    {
        $amount  = self::of($amount);
        $rounded = round($amount, 0);
        return [$rounded, round($rounded - $amount, 2)];
    }

    /**
     * Split a tax amount into CGST/SGST (intra-state) or IGST (inter-state).
     * @return array{cgst:float, sgst:float, igst:float}
     */
    public static function splitGst(float $taxAmount, ?string $sellerState, ?string $buyerState): array
    {
        $intra = $sellerState !== null && $buyerState !== null
            && strcasecmp(trim($sellerState), trim($buyerState)) === 0;

        if ($intra) {
            $half = round($taxAmount / 2, 2);
            // Assign the odd paisa to CGST so the two halves always re-sum exactly.
            return ['cgst' => $half, 'sgst' => round($taxAmount - $half, 2), 'igst' => 0.00];
        }
        return ['cgst' => 0.00, 'sgst' => 0.00, 'igst' => round($taxAmount, 2)];
    }

    /** Indian-format amount in words, for invoices and vouchers. */
    public static function inWords(float $amount, string $currencyWord = 'Rupees'): string
    {
        $amount  = self::of($amount);
        $rupees  = (int) floor(abs($amount));
        $paise   = (int) round((abs($amount) - $rupees) * 100);
        $sign    = $amount < 0 ? 'Minus ' : '';

        $words = $rupees === 0 ? 'Zero' : self::indianWords($rupees);
        $out   = $sign . $currencyWord . ' ' . $words;
        if ($paise > 0) {
            $out .= ' and ' . self::indianWords($paise) . ' Paise';
        }
        return $out . ' Only';
    }

    private static function indianWords(int $n): string
    {
        static $ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
            'Eighteen', 'Nineteen'];
        static $tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

        if ($n < 20) {
            return $ones[$n];
        }
        if ($n < 100) {
            return trim($tens[intdiv($n, 10)] . ' ' . $ones[$n % 10]);
        }
        if ($n < 1000) {
            return trim($ones[intdiv($n, 100)] . ' Hundred ' . self::indianWords($n % 100));
        }
        if ($n < 100000) {
            return trim(self::indianWords(intdiv($n, 1000)) . ' Thousand ' . self::indianWords($n % 1000));
        }
        if ($n < 10000000) {
            return trim(self::indianWords(intdiv($n, 100000)) . ' Lakh ' . self::indianWords($n % 100000));
        }
        return trim(self::indianWords(intdiv($n, 10000000)) . ' Crore ' . self::indianWords($n % 10000000));
    }
}
