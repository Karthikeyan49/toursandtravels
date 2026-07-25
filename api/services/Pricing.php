<?php
/**
 * Server-side price resolution.
 *
 * SECURITY RULE: a sell price is NEVER taken from the request body for anything
 * that resolves to a catalogued item. The client sends *what* is being sold
 * (package id, occupancy, pax counts, dates); the server decides *how much*.
 *
 * Free-text lines (item_type = 'other', or a custom quotation line with no
 * ref_id) are the one exception, and those are restricted to roles that are
 * allowed to price manually — enforced at the route guard, not here.
 */
class Pricing
{
    /**
     * Resolve the applicable package_prices row for a package on a date.
     *
     * @return array<string,mixed>|null null when the package has no slab covering
     *         the travel date — the caller must surface that as a validation error
     *         rather than defaulting to zero.
     */
    public static function resolvePackagePrice(
        int $packageId,
        string $travelDate,
        int $paxCount,
        string $hotelCategory = '3star'
    ): ?array {
        return Database::fetch(
            'SELECT * FROM package_prices
              WHERE package_id = ?
                AND is_active = 1
                AND hotel_category = ?
                AND ? BETWEEN valid_from AND valid_to
                AND ? BETWEEN pax_from AND pax_to
              ORDER BY valid_from DESC, pax_from DESC
              LIMIT 1',
            [$packageId, $hotelCategory, $travelDate, $paxCount]
        );
    }

    /**
     * Price a package for a party.
     *
     * Occupancy drives the per-adult rate: a solo traveller pays the single
     * supplement rate, a couple pays the twin-sharing rate each, and so on.
     *
     * @param array{adults:int, children_with_bed:int, children_no_bed:int, infants:int, extra_beds:int} $party
     * @return array{lines: array, subtotal: float, cost: float, slab_id: int|null}
     */
    public static function quotePackage(
        int $packageId,
        string $travelDate,
        array $party,
        string $hotelCategory = '3star',
        string $occupancy = 'double'
    ): array {
        $adults          = max(0, (int) ($party['adults'] ?? 0));
        $childrenWithBed = max(0, (int) ($party['children_with_bed'] ?? 0));
        $childrenNoBed   = max(0, (int) ($party['children_no_bed'] ?? 0));
        $infants         = max(0, (int) ($party['infants'] ?? 0));
        $extraBeds       = max(0, (int) ($party['extra_beds'] ?? 0));

        $paxCount = $adults + $childrenWithBed + $childrenNoBed;
        if ($paxCount < 1) {
            throw new ValidationException(['adults' => ['At least one traveller is required']]);
        }

        $slab = self::resolvePackagePrice($packageId, $travelDate, $paxCount, $hotelCategory);
        if ($slab === null) {
            throw new BusinessRuleException(
                'No price slab is configured for this package on ' . $travelDate
                . ' (' . $hotelCategory . ', ' . $paxCount . ' pax). Add a rate before quoting.'
            );
        }

        $adultRate = match ($occupancy) {
            'single' => (float) $slab['price_single'],
            'triple' => (float) $slab['price_triple'],
            default  => (float) $slab['price_double'],
        };

        $lines = [];
        if ($adults > 0) {
            $lines[] = self::line('package', $packageId,
                sprintf('Adult (%s occupancy)', $occupancy), $adults, 'pax',
                (float) $slab['cost_per_adult'], $adultRate);
        }
        if ($childrenWithBed > 0) {
            $lines[] = self::line('package', $packageId, 'Child with bed', $childrenWithBed, 'pax',
                (float) $slab['cost_per_adult'], (float) $slab['price_child_bed']);
        }
        if ($childrenNoBed > 0) {
            $lines[] = self::line('package', $packageId, 'Child without bed', $childrenNoBed, 'pax',
                (float) $slab['cost_per_adult'] * 0.5, (float) $slab['price_child_nobed']);
        }
        if ($infants > 0) {
            $lines[] = self::line('package', $packageId, 'Infant', $infants, 'pax',
                0.0, (float) $slab['price_infant']);
        }
        if ($extraBeds > 0) {
            $lines[] = self::line('package', $packageId, 'Extra bed', $extraBeds, 'bed',
                0.0, (float) $slab['extra_bed_price']);
        }

        return [
            'lines'    => $lines,
            'subtotal' => Money::sum(array_column($lines, 'line_total')),
            'cost'     => Money::sum(array_column($lines, 'line_cost')),
            'slab_id'  => (int) $slab['id'],
        ];
    }

    /**
     * Price an activity for a party. Sell price comes from the activities row,
     * never from the client.
     */
    public static function quoteActivity(int $activityId, string $serviceDate, int $adults, int $children = 0): array
    {
        $a = Database::fetch(
            'SELECT * FROM activities WHERE id = ? AND is_deleted = 0 AND is_active = 1 LIMIT 1',
            [$activityId]
        );
        if ($a === null) {
            throw new NotFoundException('Activity not found or inactive');
        }

        $totalPax = $adults + $children;
        if ($totalPax < (int) $a['min_pax']) {
            throw new BusinessRuleException(
                $a['name'] . ' requires a minimum of ' . $a['min_pax'] . ' travellers'
            );
        }

        $lines = [];
        if ($a['pricing_basis'] === 'per_person') {
            if ($adults > 0) {
                $lines[] = self::line('activity', $activityId, $a['name'] . ' (adult)', $adults, 'pax',
                    (float) $a['cost_adult'], (float) $a['sell_adult'], $serviceDate);
            }
            if ($children > 0) {
                $lines[] = self::line('activity', $activityId, $a['name'] . ' (child)', $children, 'pax',
                    (float) $a['cost_child'], (float) $a['sell_child'], $serviceDate);
            }
        } else {
            $unit = $a['pricing_basis'] === 'per_vehicle' ? 'vehicle' : 'group';
            $lines[] = self::line('activity', $activityId, $a['name'], 1, $unit,
                (float) $a['cost_adult'], (float) $a['sell_adult'], $serviceDate);
        }

        return [
            'lines'    => $lines,
            'subtotal' => Money::sum(array_column($lines, 'line_total')),
            'cost'     => Money::sum(array_column($lines, 'line_cost')),
        ];
    }

    /**
     * Price a hotel stay from the contracted rate card.
     * Markup comes from the package or the global default, never from the client.
     */
    public static function quoteHotel(
        int $hotelId,
        int $roomTypeId,
        string $checkIn,
        string $checkOut,
        int $rooms,
        string $occupancy = 'double',
        string $mealPlan = 'CP',
        ?float $markupPct = null
    ): array {
        $nights = self::nightsBetween($checkIn, $checkOut);
        if ($nights < 1) {
            throw new ValidationException(['check_out' => ['Check-out must be after check-in']]);
        }

        $rate = Hotel::resolveRate($hotelId, $roomTypeId, $checkIn, $mealPlan);
        if ($rate === null) {
            throw new BusinessRuleException(
                'No contracted rate for this room on ' . $checkIn . ' (' . $mealPlan . '). Enter the cost manually or add a contract.'
            );
        }

        $costPerRoomNight = match ($occupancy) {
            'single' => (float) $rate['cost_single'],
            'triple' => (float) $rate['cost_triple'],
            default  => (float) $rate['cost_double'],
        };

        $markupPct ??= Setting::decimal('default_markup_pct', 15.0);
        $sellPerRoomNight = Money::of($costPerRoomNight * (1 + $markupPct / 100));

        $hotel = Hotel::find($hotelId);
        $label = sprintf(
            '%s — %s (%s, %s) · %d night%s',
            $hotel['name'] ?? 'Hotel', $occupancy, $mealPlan, $checkIn, $nights, $nights > 1 ? 's' : ''
        );

        $units = $rooms * $nights;
        $line  = self::line('hotel', $hotelId, $label, $units, 'room-night',
            $costPerRoomNight, $sellPerRoomNight, $checkIn);
        $line['nights']           = $nights;
        $line['service_end_date'] = $checkOut;

        return [
            'lines'    => [$line],
            'subtotal' => $line['line_total'],
            'cost'     => $line['line_cost'],
        ];
    }

    /**
     * Apply tax to a subtotal and return the full money block used by both
     * quotations and bookings. Single implementation so the two can never drift.
     *
     * @return array{subtotal:float, discount_amount:float, taxable_amount:float,
     *               gst_pct:float, gst_amount:float, tcs_amount:float, grand_total:float}
     */
    public static function applyTax(
        float $subtotal,
        float $discount = 0.0,
        ?float $gstPct = null,
        bool $isOverseas = false
    ): array {
        $subtotal = Money::of($subtotal);
        $discount = Money::of($discount);

        if (Money::greaterThan($discount, $subtotal)) {
            throw new ValidationException(['discount_amount' => ['Discount cannot exceed the subtotal']]);
        }

        $taxable = Money::of($subtotal - $discount);
        $gstPct  = $gstPct ?? Setting::decimal('default_gst_pct', 5.0);
        $gst     = Money::percentOf($taxable, $gstPct);

        // TCS applies to overseas tour packages under section 206C(1G).
        $tcs = $isOverseas
            ? Money::percentOf($taxable, Setting::decimal('default_tcs_pct', 5.0))
            : 0.0;

        return [
            'subtotal'        => $subtotal,
            'discount_amount' => $discount,
            'taxable_amount'  => $taxable,
            'gst_pct'         => $gstPct,
            'gst_amount'      => $gst,
            'tcs_amount'      => $tcs,
            'grand_total'     => Money::of($taxable + $gst + $tcs),
        ];
    }

    /** Cancellation charge from the applicable slab. Resolved server-side. */
    public static function cancellationCharge(float $grandTotal, string $departureDate, ?int $packageId = null): array
    {
        $daysBefore = (int) floor((strtotime($departureDate) - strtotime(date('Y-m-d'))) / 86400);
        $daysBefore = max(0, $daysBefore);

        // Package-specific slab wins over the global default.
        $slab = null;
        if ($packageId !== null) {
            $slab = Database::fetch(
                "SELECT * FROM cancellation_policies
                  WHERE scope_type = 'package' AND scope_id = ? AND is_active = 1
                    AND ? BETWEEN days_before_min AND days_before_max
                  LIMIT 1",
                [$packageId, $daysBefore]
            );
        }
        $slab ??= Database::fetch(
            "SELECT * FROM cancellation_policies
              WHERE scope_type = 'global' AND is_active = 1
                AND ? BETWEEN days_before_min AND days_before_max
              LIMIT 1",
            [$daysBefore]
        );

        if ($slab === null) {
            return ['days_before' => $daysBefore, 'charge' => 0.00, 'refund' => Money::of($grandTotal), 'label' => 'No policy matched'];
        }

        $charge = $slab['charge_type'] === 'percent'
            ? Money::percentOf($grandTotal, (float) $slab['charge_value'])
            : Money::of($slab['charge_value']);

        $charge = min($charge, Money::of($grandTotal));

        return [
            'days_before' => $daysBefore,
            'charge'      => $charge,
            'refund'      => Money::of($grandTotal - $charge),
            'label'       => $slab['label'] ?? '',
            'policy_id'   => (int) $slab['id'],
        ];
    }

    public static function nightsBetween(string $from, string $to): int
    {
        return (int) floor((strtotime($to) - strtotime($from)) / 86400);
    }

    /** @return array<string,mixed> a normalised priced line */
    private static function line(
        string $type,
        ?int $refId,
        string $description,
        float $quantity,
        string $unit,
        float $unitCost,
        float $unitPrice,
        ?string $serviceDate = null
    ): array {
        return [
            'item_type'    => $type,
            'service_type' => $type,
            'ref_id'       => $refId,
            'description'  => $description,
            'quantity'     => $quantity,
            'unit'         => $unit,
            'unit_cost'    => Money::of($unitCost),
            'unit_price'   => Money::of($unitPrice),
            'line_cost'    => Money::lineTotal($quantity, $unitCost),
            'line_total'   => Money::lineTotal($quantity, $unitPrice),
            'cost_total'   => Money::lineTotal($quantity, $unitCost),
            'sell_total'   => Money::lineTotal($quantity, $unitPrice),
            'service_date' => $serviceDate,
        ];
    }
}
