<?php

class Quotation extends Model
{
    protected const TABLE    = 'quotations';
    protected const FILLABLE = [
        'quote_no', 'version', 'parent_quote_id', 'lead_id', 'customer_id', 'agency_id',
        'package_id', 'quote_type', 'departure_id', 'destination_id', 'title', 'quote_date', 'valid_until',
        'travel_from', 'travel_to', 'nights', 'adults', 'children', 'infants',
        'hotel_category', 'currency', 'subtotal', 'discount_amount', 'taxable_amount',
        'gst_pct', 'gst_amount', 'tcs_amount', 'grand_total', 'cost_total', 'margin_amount',
        'inclusions', 'exclusions', 'terms', 'notes', 'status', 'previous_status',
        'sent_at', 'accepted_at', 'rejected_reason', 'converted_booking_id', 'owner_id',
    ];
    protected const SORTABLE = ['id', 'quote_no', 'quote_date', 'grand_total', 'status', 'created_at'];

    /** A quote may only be edited while it is still a draft or a revision. */
    public const EDITABLE_STATUSES = ['draft', 'revised'];

    private const TRANSITIONS = [
        'draft'    => ['sent'],
        'sent'     => ['viewed', 'revised', 'accepted', 'rejected', 'expired'],
        'viewed'   => ['revised', 'accepted', 'rejected', 'expired'],
        'revised'  => ['sent', 'rejected'],
        'accepted' => [],
        'rejected' => ['revised'],
        'expired'  => ['revised'],
    ];

    public static function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['1=1', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(q.quote_no LIKE ? OR q.title LIKE ? OR c.full_name LIKE ?)', [$like, $like, $like]];
        }
        if (!empty($filters['status'])) {
            $statuses = is_array($filters['status']) ? $filters['status'] : explode(',', (string) $filters['status']);
            $statuses = array_values(array_filter(array_map('trim', $statuses)));
            if ($statuses !== []) {
                $marks = implode(',', array_fill(0, count($statuses), '?'));
                $clauses[] = ["q.status IN ($marks)", $statuses];
            }
        }
        if (!empty($filters['customer_id'])) {
            $clauses[] = ['q.customer_id = ?', [(int) $filters['customer_id']]];
        }
        if (!empty($filters['lead_id'])) {
            $clauses[] = ['q.lead_id = ?', [(int) $filters['lead_id']]];
        }
        if (!empty($filters['owner_id'])) {
            $clauses[] = ['q.owner_id = ?', [(int) $filters['owner_id']]];
        }
        if (!empty($filters['from'])) {
            $clauses[] = ['q.quote_date >= ?', [$filters['from']]];
        }
        if (!empty($filters['to'])) {
            $clauses[] = ['q.quote_date <= ?', [$filters['to']]];
        }
        if (!empty($filters['expiring'])) {
            $clauses[] = ["q.valid_until IS NOT NULL AND q.valid_until BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
                           AND q.status IN ('sent','viewed')", []];
        }

        [$scopeSql, $scopeParams] = AuthMiddleware::agencyScope('q.agency_id');
        $clauses[] = [$scopeSql, $scopeParams];

        [$where, $params] = self::buildWhere($clauses);

        $total = (int) Database::scalar(
            "SELECT COUNT(*) FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE $where",
            $params
        );

        $sortCol = self::assertSortable($sort, 'quote_date');
        $sortDir = self::sortDirection($dir);

        // cost_total and margin are internal — the controller strips them for
        // roles that should not see buying prices.
        $rows = Database::fetchAll(
            "SELECT q.*, c.full_name AS customer_name, c.phone AS customer_phone,
                    d.name AS destination_name, p.name AS package_name,
                    u.full_name AS owner_name, l.lead_no
               FROM quotations q
               LEFT JOIN customers    c ON c.id = q.customer_id
               LEFT JOIN destinations d ON d.id = q.destination_id
               LEFT JOIN packages     p ON p.id = q.package_id
               LEFT JOIN users        u ON u.id = q.owner_id
               LEFT JOIN leads        l ON l.id = q.lead_id
              WHERE $where
              ORDER BY q.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $q = Database::fetch(
            'SELECT q.*, c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
                    c.address AS customer_address, c.city AS customer_city, c.state AS customer_state,
                    c.gstin AS customer_gstin,
                    d.name AS destination_name, p.name AS package_name, u.full_name AS owner_name
               FROM quotations q
               LEFT JOIN customers    c ON c.id = q.customer_id
               LEFT JOIN destinations d ON d.id = q.destination_id
               LEFT JOIN packages     p ON p.id = q.package_id
               LEFT JOIN users        u ON u.id = q.owner_id
              WHERE q.id = ? LIMIT 1',
            [$id]
        );
        if ($q === null) {
            return null;
        }

        $q['items'] = Database::fetchAll(
            'SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, id ASC',
            [$id]
        );
        $q['days'] = Database::fetchAll(
            'SELECT qd.*, h.name AS hotel_display_name
               FROM quotation_days qd
               LEFT JOIN hotels h ON h.id = qd.hotel_id
              WHERE qd.quotation_id = ? ORDER BY qd.day_no ASC',
            [$id]
        );
        $q['revisions'] = Database::fetchAll(
            'SELECT id, quote_no, version, quote_date, grand_total, status
               FROM quotations
              WHERE quote_no = ? ORDER BY version DESC',
            [$q['quote_no']]
        );

        $q['options'] = QuotationOption::forQuotation($id);

        return $q;
    }

    /**
     * Replace all line items and recompute the money block from them.
     * Totals are ALWAYS derived here — the client never supplies them.
     */
    public static function replaceItems(int $quotationId, array $items, float $discount, ?float $gstPct, bool $isOverseas): array
    {
        return Database::transaction(static function () use ($quotationId, $items, $discount, $gstPct, $isOverseas) {
            Database::execute('DELETE FROM quotation_items WHERE quotation_id = ?', [$quotationId]);

            $sort = 0;
            $subtotal = 0.0;
            $costTotal = 0.0;

            foreach ($items as $item) {
                $qty       = (float) ($item['quantity'] ?? 1);
                $unitPrice = Money::of($item['unit_price'] ?? 0);
                $unitCost  = Money::of($item['unit_cost'] ?? 0);

                if (!Money::isNonNegative($unitPrice) || !Money::isNonNegative($unitCost)) {
                    throw new ValidationException(['items' => ['Prices and costs cannot be negative']]);
                }

                $lineTotal = Money::lineTotal($qty, $unitPrice);
                $lineCost  = Money::lineTotal($qty, $unitCost);

                Database::insert('quotation_items', [
                    'quotation_id' => $quotationId,
                    'item_type'    => $item['item_type'] ?? 'other',
                    'ref_id'       => !empty($item['ref_id']) ? (int) $item['ref_id'] : null,
                    'description'  => mb_substr((string) ($item['description'] ?? ''), 0, 400),
                    'day_no'       => !empty($item['day_no']) ? (int) $item['day_no'] : null,
                    'service_date' => $item['service_date'] ?? null,
                    'quantity'     => $qty,
                    'unit'         => mb_substr((string) ($item['unit'] ?? 'pax'), 0, 20),
                    'unit_cost'    => $unitCost,
                    'unit_price'   => $unitPrice,
                    'line_cost'    => $lineCost,
                    'line_total'   => $lineTotal,
                    'is_optional'  => !empty($item['is_optional']) ? 1 : 0,
                    'sort_order'   => $sort++,
                ], [
                    'quotation_id', 'item_type', 'ref_id', 'description', 'day_no', 'service_date',
                    'quantity', 'unit', 'unit_cost', 'unit_price', 'line_cost', 'line_total',
                    'is_optional', 'sort_order',
                ]);

                // Optional lines are quoted but excluded from the headline total.
                if (empty($item['is_optional'])) {
                    $subtotal  += $lineTotal;
                    $costTotal += $lineCost;
                }
            }

            $money = Pricing::applyTax($subtotal, $discount, $gstPct, $isOverseas);
            $money['cost_total']    = Money::of($costTotal);
            $money['margin_amount'] = Money::of($money['taxable_amount'] - $costTotal);

            Database::execute(
                'UPDATE quotations
                    SET subtotal = ?, discount_amount = ?, taxable_amount = ?, gst_pct = ?,
                        gst_amount = ?, tcs_amount = ?, grand_total = ?, cost_total = ?, margin_amount = ?
                  WHERE id = ?',
                [
                    $money['subtotal'], $money['discount_amount'], $money['taxable_amount'],
                    $money['gst_pct'], $money['gst_amount'], $money['tcs_amount'],
                    $money['grand_total'], $money['cost_total'], $money['margin_amount'],
                    $quotationId,
                ]
            );

            return $money;
        });
    }

    /** Create the next version of a quote, copying items and itinerary. */
    public static function revise(int $quotationId): int
    {
        return Database::transaction(static function () use ($quotationId) {
            $src = self::findOrFail($quotationId);

            $nextVersion = 1 + (int) Database::scalar(
                'SELECT MAX(version) FROM quotations WHERE quote_no = ?',
                [$src['quote_no']]
            );

            $copy = $src;
            unset($copy['id'], $copy['created_at'], $copy['updated_at']);
            $copy['version']              = $nextVersion;
            $copy['parent_quote_id']      = $quotationId;
            $copy['status']               = 'draft';
            $copy['previous_status']      = null;
            $copy['sent_at']              = null;
            $copy['accepted_at']          = null;
            $copy['rejected_reason']      = null;
            $copy['converted_booking_id'] = null;
            $copy['quote_date']           = date('Y-m-d');
            $copy['valid_until']          = date('Y-m-d', strtotime('+' . Setting::int('quote_validity_days', 7) . ' days'));

            $newId = self::create($copy);

            Database::execute(
                'INSERT INTO quotation_items
                    (quotation_id, item_type, ref_id, description, day_no, service_date, quantity,
                     unit, unit_cost, unit_price, line_cost, line_total, is_optional, sort_order)
                 SELECT ?, item_type, ref_id, description, day_no, service_date, quantity,
                        unit, unit_cost, unit_price, line_cost, line_total, is_optional, sort_order
                   FROM quotation_items WHERE quotation_id = ?',
                [$newId, $quotationId]
            );

            Database::execute(
                'INSERT INTO quotation_days
                    (quotation_id, day_no, day_date, title, description, hotel_id, hotel_name, meal_plan)
                 SELECT ?, day_no, day_date, title, description, hotel_id, hotel_name, meal_plan
                   FROM quotation_days WHERE quotation_id = ?',
                [$newId, $quotationId]
            );

            // A revision inherits the same toggle choices — the builder is
            // versioned along with the price, not reset to defaults.
            Database::execute(
                'INSERT INTO quotation_options
                    (quotation_id, transport_mode, room_category, food_included, diet_type,
                     baggage_included, baggage_notes, local_transport_included,
                     sightseeing_included, insurance_included)
                 SELECT ?, transport_mode, room_category, food_included, diet_type,
                        baggage_included, baggage_notes, local_transport_included,
                        sightseeing_included, insurance_included
                   FROM quotation_options WHERE quotation_id = ?',
                [$newId, $quotationId]
            );

            Database::execute(
                "UPDATE quotations SET previous_status = status, status = 'revised' WHERE id = ?",
                [$quotationId]
            );

            return $newId;
        });
    }

    /** Snapshot the package itinerary onto the quote so later edits don't rewrite it. */
    public static function snapshotItinerary(int $quotationId, int $packageId, ?string $travelFrom): void
    {
        Database::execute('DELETE FROM quotation_days WHERE quotation_id = ?', [$quotationId]);

        $days = Database::fetchAll(
            'SELECT pd.*, oc.name AS overnight_city_name
               FROM package_days pd
               LEFT JOIN cities oc ON oc.id = pd.overnight_city_id
              WHERE pd.package_id = ? ORDER BY pd.day_no ASC',
            [$packageId]
        );

        foreach ($days as $d) {
            $dayDate = $travelFrom !== null
                ? date('Y-m-d', strtotime($travelFrom . ' +' . ((int) $d['day_no'] - 1) . ' days'))
                : null;

            Database::insert('quotation_days', [
                'quotation_id' => $quotationId,
                'day_no'       => (int) $d['day_no'],
                'day_date'     => $dayDate,
                'title'        => $d['title'],
                'description'  => $d['description'],
                'hotel_id'     => null,
                'hotel_name'   => $d['overnight_city_name'] ?? null,
                'meal_plan'    => $d['meal_plan'] ?? 'B',
            ], ['quotation_id', 'day_no', 'day_date', 'title', 'description', 'hotel_id', 'hotel_name', 'meal_plan']);
        }
    }
}
