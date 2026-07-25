<?php
/**
 * Money helper regression test.   Run:  php api/tests/money_test.php
 *
 * Every rupee in the system flows through these six functions. The invariants
 * that matter are: rounding happens once and at 2dp, comparisons never use ==,
 * and a GST split always re-sums to exactly the tax it came from.
 */

require_once __DIR__ . '/../helpers/Money.php';

$GLOBALS['__passed'] = 0;
$GLOBALS['__failed'] = 0;

function check(bool $condition, string $label, string $detail = ''): void
{
    if ($condition) {
        $GLOBALS['__passed']++;
        fwrite(STDOUT, "  PASS  $label\n");
        return;
    }
    $GLOBALS['__failed']++;
    fwrite(STDOUT, "  FAIL  $label" . ($detail !== '' ? "\n        $detail" : '') . "\n");
}

function same($actual, $expected, string $label): void
{
    check(
        $actual === $expected,
        $label,
        'got ' . var_export($actual, true) . ', expected ' . var_export($expected, true)
    );
}

fwrite(STDOUT, "\nMoney helper\n" . str_repeat('-', 72) . "\n");

// --- of(): always a float, always 2dp ---------------------------------------

same(Money::of(123.456),   123.46, 'of() rounds up at the third decimal');
same(Money::of(123.454),   123.45, 'of() rounds down at the third decimal');
same(Money::of('1500'),    1500.0, 'of() casts a numeric string');
same(Money::of('123.456'), 123.46, 'of() rounds a numeric string');
same(Money::of(0),         0.0,    'of(0) is 0.0 not 0');
same(Money::of(null),      0.0,    'of(null) is 0.0');
same(Money::of(''),        0.0,    'of("") is 0.0');
same(Money::of(-99.999),   -100.0, 'of() rounds negatives away from zero');
check(is_float(Money::of('42')), 'of() always returns a float');

// --- sum(): rounds once, at the end -----------------------------------------

same(Money::sum([]),                     0.0,  'sum([]) is 0.0');
same(Money::sum([0.1, 0.2]),             0.3,  'sum() absorbs binary float error');
same(Money::sum([10.10, 20.20, 30.30]),  60.6, 'sum() of three decimals');
same(Money::sum(['100.50', '200.25']),   300.75, 'sum() accepts numeric strings');
same(Money::sum([1.005, 2.005, 3.005]),  6.02, 'sum() rounds once at the end, not per item');
same(Money::sum([100, -40]),             60.0, 'sum() handles negatives');

// A per-item round would give 0.01 x 3 = 0.03; rounding once gives 0.01.
same(Money::sum([0.004, 0.004, 0.004]),  0.01, 'sum() does not round each element');

// --- percentOf() -------------------------------------------------------------

same(Money::percentOf(1000, 5),      50.0,   'percentOf(1000, 5%)');
same(Money::percentOf(1000, 0),      0.0,    'percentOf(x, 0%) is zero');
same(Money::percentOf(0, 18),        0.0,    'percentOf(0, y) is zero');
same(Money::percentOf(999.99, 18),   180.0,  'percentOf() rounds to 2dp');
same(Money::percentOf(2500, 12.5),   312.5,  'percentOf() with a fractional rate');
same(Money::percentOf('4999.50', 5), 249.98, 'percentOf() with a string base');

// --- lineTotal(): qty x price, rounded once ---------------------------------

same(Money::lineTotal(3, 33.333),   100.0,   'lineTotal() rounds after multiplying');
same(Money::lineTotal(2, 1250.50),  2501.0,  'lineTotal() whole quantities');
same(Money::lineTotal(2.5, 400),    1000.0,  'lineTotal() fractional quantity');
same(Money::lineTotal(0, 999.99),   0.0,     'lineTotal() with zero quantity');
same(Money::lineTotal(7, 0.335),    2.35,    'lineTotal() rounds the product, not the unit price');

// --- equals() and friends: epsilon comparison, never == ---------------------

check(Money::equals(0.1 + 0.2, 0.3),      'equals() treats 0.1+0.2 as 0.3');
check((0.1 + 0.2) != 0.3,                 'raw == would have failed on 0.1+0.2 (guard is needed)');
check(Money::equals(1.00, 1.004),         'equals() absorbs a sub-half-paisa difference');
check(!Money::equals(1.00, 1.006),        'equals() rejects a difference above the epsilon');
check(Money::equals(-5.0, -5.0),          'equals() on negatives');
check(!Money::equals(100.0, 100.01),      'equals() rejects a one-paisa difference');

check(Money::greaterThan(1.01, 1.00),     'greaterThan() on a real difference');
check(!Money::greaterThan(1.004, 1.00),   'greaterThan() ignores float noise');
check(!Money::greaterThan(1.00, 1.00),    'greaterThan() is strict');
check(Money::lessThan(1.00, 1.01),        'lessThan() on a real difference');
check(!Money::lessThan(1.00, 1.004),      'lessThan() ignores float noise');

check(Money::isZero(0.0),                 'isZero(0.0)');
check(Money::isZero(0.004),               'isZero() absorbs float noise');
check(Money::isZero(-0.004),              'isZero() is symmetric around zero');
check(!Money::isZero(0.006),              'isZero() rejects a real amount');

check(Money::isNonNegative(0.0),          'isNonNegative(0)');
check(Money::isNonNegative(-0.001),       'isNonNegative() tolerates float noise below zero');
check(!Money::isNonNegative(-0.01),       'isNonNegative() rejects a real negative');

same(Money::EPSILON, 0.005, 'EPSILON is half a paisa');

// --- splitGst(): the halves must re-sum EXACTLY ------------------------------

$intra = Money::splitGst(100.00, 'Tamil Nadu', 'Tamil Nadu');
same($intra['cgst'], 50.0, 'intra-state: CGST is half');
same($intra['sgst'], 50.0, 'intra-state: SGST is half');
same($intra['igst'], 0.00, 'intra-state: no IGST');

$intraCase = Money::splitGst(100.00, 'tamil nadu', '  TAMIL NADU  ');
check(
    $intraCase['igst'] === 0.00 && $intraCase['cgst'] > 0,
    'intra-state detection is case- and whitespace-insensitive'
);

// The odd-paisa case: 100.01 / 2 = 50.005, which cannot be split evenly.
$odd = Money::splitGst(100.01, 'Kerala', 'Kerala');
same(round($odd['cgst'] + $odd['sgst'], 2), 100.01, 'odd paisa: CGST + SGST re-sums exactly');
check($odd['cgst'] >= $odd['sgst'], 'odd paisa is assigned to CGST');
same($odd['igst'], 0.00, 'odd paisa: still no IGST');

foreach ([0.01, 0.03, 1.01, 17.99, 12345.67, 99999.99] as $amount) {
    $split = Money::splitGst($amount, 'Karnataka', 'Karnataka');
    check(
        round($split['cgst'] + $split['sgst'], 2) === round($amount, 2),
        sprintf('intra-state split of %.2f re-sums exactly', $amount),
        sprintf('%.2f + %.2f = %.2f', $split['cgst'], $split['sgst'], $split['cgst'] + $split['sgst'])
    );
}

$inter = Money::splitGst(180.00, 'Tamil Nadu', 'Maharashtra');
same($inter['igst'], 180.0, 'inter-state: full amount is IGST');
same($inter['cgst'], 0.00,  'inter-state: no CGST');
same($inter['sgst'], 0.00,  'inter-state: no SGST');

// An unknown buyer state must fall back to IGST — under-charging CGST/SGST on an
// inter-state supply is the expensive mistake, not the other way round.
$unknown = Money::splitGst(90.00, 'Tamil Nadu', null);
same($unknown['igst'], 90.0, 'unknown buyer state falls back to IGST');
$noSeller = Money::splitGst(90.00, null, 'Tamil Nadu');
same($noSeller['igst'], 90.0, 'unknown seller state falls back to IGST');

same(Money::splitGst(0.0, 'Goa', 'Goa'), ['cgst' => 0.0, 'sgst' => 0.0, 'igst' => 0.0], 'zero tax splits to zeros');

// --- roundOff(): [rounded total, adjustment] --------------------------------

same(Money::roundOff(1234.56), [1235.0,  0.44],  'roundOff() rounds up and reports +0.44');
same(Money::roundOff(1234.40), [1234.0, -0.40],  'roundOff() rounds down and reports -0.40');
same(Money::roundOff(100.00),  [100.0,   0.00],  'roundOff() of a whole amount adjusts by zero');
same(Money::roundOff(0.49),    [0.0,    -0.49],  'roundOff() below half a rupee');
same(Money::roundOff(0.50),    [1.0,     0.50],  'roundOff() at exactly half a rupee rounds up');

[$rounded, $adjustment] = Money::roundOff(8765.43);
check(
    Money::equals($rounded - $adjustment, 8765.43),
    'roundOff() adjustment reverses the rounding exactly',
    sprintf('%.2f - %.2f = %.2f', $rounded, $adjustment, $rounded - $adjustment)
);

// --- inWords(): Indian numbering, for invoices and vouchers -----------------

same(Money::inWords(0),        'Rupees Zero Only',      'inWords(0)');
same(Money::inWords(1),        'Rupees One Only',       'inWords(1)');
same(
    Money::inWords(1234.56),
    'Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only',
    'inWords(1234.56) includes paise'
);
same(Money::inWords(100000),   'Rupees One Lakh Only',  'inWords(100000) uses lakh, not hundred thousand');
same(Money::inWords(10000000), 'Rupees One Crore Only', 'inWords(10000000) uses crore');
same(Money::inWords(-1),       'Minus Rupees One Only', 'inWords() marks a negative');
same(Money::inWords(0.05),     'Rupees Zero and Five Paise Only', 'inWords() of paise only');
same(Money::inWords(999),      'Rupees Nine Hundred Ninety Nine Only', 'inWords() below a thousand');
same(
    Money::inWords(1500, 'Dirhams'),
    'Dirhams One Thousand Five Hundred Only',
    'inWords() honours a different currency word'
);

// --- Result ------------------------------------------------------------------

fwrite(STDOUT, str_repeat('-', 72) . "\n");
fwrite(STDOUT, sprintf(
    "money_test: %d passed, %d failed\n\n",
    $GLOBALS['__passed'],
    $GLOBALS['__failed']
));

exit($GLOBALS['__failed'] > 0 ? 1 : 0);
