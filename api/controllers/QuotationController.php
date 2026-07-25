<?php

class QuotationController extends Controller
{
    /** GET /quotations */
    public function index(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $filters = [
                'search'      => Request::query('search'),
                'status'      => Request::query('status'),
                'customer_id' => Request::query('customer_id'),
                'lead_id'     => Request::query('lead_id'),
                'owner_id'    => Request::query('owner_id'),
                'from'        => Request::query('from'),
                'to'          => Request::query('to'),
                'expiring'    => Request::queryBool('expiring'),
            ];

            [$rows, $total] = Quotation::paginate($filters, $limit, $offset, Request::query('sort'), Request::query('dir'));
            Response::paginated($this->stripMargins($rows), $page, $limit, $total);
        });
    }

    /** GET /quotations/{id} */
    public function show(): void
    {
        $this->run(function () {
            $q = Quotation::detail(Request::paramInt('id'));
            if ($q === null) {
                Response::notFound('Quotation not found');
                return;
            }

            if (!$this->canViewMargins()) {
                unset($q['cost_total'], $q['margin_amount']);
                $q['items'] = $this->stripMargins($q['items']);
            }

            $q['company'] = Setting::companyProfile();
            Response::success($q);
        });
    }

    /** POST /quotations */
    public function store(): void
    {
        $this->run(function () {
            $input = Request::only([
                'lead_id', 'customer_id', 'agency_id', 'package_id', 'departure_id',
                'destination_id', 'title', 'valid_until', 'travel_from', 'travel_to',
                'adults', 'children', 'infants', 'hotel_category', 'quote_type', 'inclusions',
                'exclusions', 'terms', 'notes', 'owner_id',
            ]);

            $data = $this->validate($input, [
                'lead_id'        => 'nullable|int',
                'customer_id'    => 'nullable|int',
                'agency_id'      => 'nullable|int',
                'package_id'     => 'nullable|int',
                'departure_id'   => 'nullable|int',
                'destination_id' => 'nullable|int',
                'title'          => 'required|string|max:200',
                'valid_until'    => 'nullable|date',
                'travel_from'    => 'nullable|date',
                'travel_to'      => 'nullable|date',
                'adults'         => 'required|int|min:1|max:200',
                'children'       => 'nullable|int|min:0|max:200',
                'infants'        => 'nullable|int|min:0|max:100',
                'hotel_category' => 'nullable|in:budget,3star,4star,5star,luxury',
                'quote_type'     => 'nullable|in:package,custom,hotel_only,transport_only,activity_only,visa_only',
                'inclusions'     => 'nullable|string|max:8000',
                'exclusions'     => 'nullable|string|max:8000',
                'terms'          => 'nullable|string|max:8000',
                'notes'          => 'nullable|string|max:4000',
                'owner_id'       => 'nullable|int',
            ]);

            Validator::assertDateOrder($data['travel_from'] ?? null, $data['travel_to'] ?? null);

            if (empty($data['lead_id']) && empty($data['customer_id'])) {
                throw new ValidationException(['customer_id' => ['A quotation needs either a lead or a customer']]);
            }

            $id = Database::transaction(function () use ($data) {
                $validity = Setting::int('quote_validity_days', 7);

                $payload = array_merge($data, [
                    'quote_no'    => NumberSequence::next('QTN'),
                    'version'     => 1,
                    'quote_date'  => date('Y-m-d'),
                    'valid_until' => $data['valid_until'] ?? date('Y-m-d', strtotime("+$validity days")),
                    'status'      => 'draft',
                    'currency'    => Setting::get('default_currency', 'INR'),
                    'gst_pct'     => Setting::decimal('default_gst_pct', 5.0),
                    'owner_id'    => $data['owner_id'] ?? Request::userId(),
                    'nights'      => isset($data['travel_from'], $data['travel_to'])
                        ? max(0, Pricing::nightsBetween($data['travel_from'], $data['travel_to'])) : 0,
                ]);

                // Inherit the package's boilerplate so the sales user does not retype it.
                if (!empty($data['package_id'])) {
                    $pkg = Package::find((int) $data['package_id']);
                    if ($pkg !== null) {
                        $payload['inclusions'] ??= $pkg['inclusions'];
                        $payload['exclusions'] ??= $pkg['exclusions'];
                        $payload['terms']      ??= $pkg['terms'];
                        $payload['destination_id'] ??= $pkg['destination_id'];
                        $payload['gst_pct'] = (float) $pkg['gst_pct'];
                    }
                }

                $qid = Quotation::create($payload);

                if (!empty($data['package_id'])) {
                    Quotation::snapshotItinerary($qid, (int) $data['package_id'], $data['travel_from'] ?? null);
                }
                if (!empty($data['lead_id'])) {
                    Database::execute(
                        "UPDATE leads SET previous_status = status, status = 'quoted'
                          WHERE id = ? AND status IN ('new','contacted')",
                        [(int) $data['lead_id']]
                    );
                }

                Audit::log('create', 'quotation', $qid, null, ['quote_no' => $payload['quote_no']]);
                return $qid;
            });

            Response::created(Quotation::detail($id), 'Quotation created');
        });
    }

    /** PUT /quotations/{id} */
    public function update(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Quotation::findOrFail($id);

            if (!in_array($before['status'], Quotation::EDITABLE_STATUSES, true)) {
                throw new BusinessRuleException(
                    'A quotation that has been ' . $before['status'] . ' cannot be edited. Create a revision instead.'
                );
            }

            $data = $this->validate(
                Request::only([
                    'title', 'valid_until', 'travel_from', 'travel_to', 'adults', 'children',
                    'infants', 'hotel_category', 'inclusions', 'exclusions', 'terms', 'notes',
                    'destination_id', 'package_id', 'owner_id',
                ]),
                [
                    'title'          => 'nullable|string|max:200',
                    'valid_until'    => 'nullable|date',
                    'travel_from'    => 'nullable|date',
                    'travel_to'      => 'nullable|date',
                    'adults'         => 'nullable|int|min:1|max:200',
                    'children'       => 'nullable|int|min:0|max:200',
                    'infants'        => 'nullable|int|min:0|max:100',
                    'hotel_category' => 'nullable|in:budget,3star,4star,5star,luxury',
                    'inclusions'     => 'nullable|string|max:8000',
                    'exclusions'     => 'nullable|string|max:8000',
                    'terms'          => 'nullable|string|max:8000',
                    'notes'          => 'nullable|string|max:4000',
                    'destination_id' => 'nullable|int',
                    'package_id'     => 'nullable|int',
                    'owner_id'       => 'nullable|int',
                ]
            );

            Quotation::updateById($id, $data);
            Audit::logDiff('update', 'quotation', $id, $before, $data);

            Response::success(Quotation::detail($id), 'Quotation updated');
        });
    }

    /** PUT /quotations/{id}/items — replace lines, recompute totals server-side. */
    public function saveItems(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $quote = Quotation::findOrFail($id);

            if (!in_array($quote['status'], Quotation::EDITABLE_STATUSES, true)) {
                throw new BusinessRuleException('Only a draft or revised quotation can be re-priced');
            }

            $items = Request::input('items', []);
            if (!is_array($items)) {
                throw new ValidationException(['items' => ['Items must be a list']]);
            }

            $discount = Money::of(Request::input('discount_amount', $quote['discount_amount']));
            if (!Money::equals($discount, (float) $quote['discount_amount']) && !$this->canEditPrices()) {
                Response::forbidden('Your role cannot change the discount');
                return;
            }

            $money = Quotation::replaceItems($id, $items, $discount, (float) $quote['gst_pct'], $this->isOverseas($quote));
            Audit::log('items_updated', 'quotation', $id, null, ['grand_total' => $money['grand_total']]);

            Response::success(Quotation::detail($id), 'Quotation priced');
        });
    }

    /** PUT /quotations/{id}/options — the Dynamic Quotation Builder toggle set. */
    public function saveOptions(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $quote = Quotation::findOrFail($id);

            if (!in_array($quote['status'], Quotation::EDITABLE_STATUSES, true)) {
                throw new BusinessRuleException(
                    'A quotation that has been ' . $quote['status'] . ' cannot have its options changed. Create a revision instead.'
                );
            }

            $data = $this->validate(
                Request::only([
                    'transport_mode', 'room_category', 'food_included', 'diet_type',
                    'baggage_included', 'baggage_notes', 'local_transport_included',
                    'sightseeing_included', 'insurance_included',
                ]),
                [
                    'transport_mode'           => 'nullable|in:flight,train,bus,mixed,none',
                    'room_category'            => 'nullable|in:normal,ac,non_ac,deluxe,super_deluxe,executive,suite,other',
                    'food_included'            => 'nullable|bool',
                    'diet_type'                => 'nullable|in:veg,non_veg,brahmin,jain',
                    'baggage_included'         => 'nullable|bool',
                    'baggage_notes'            => 'nullable|string|max:255',
                    'local_transport_included' => 'nullable|bool',
                    'sightseeing_included'     => 'nullable|bool',
                    'insurance_included'       => 'nullable|bool',
                ]
            );

            QuotationOption::upsert($id, $data);
            Audit::log('options_updated', 'quotation', $id, null, $data);

            Response::success(Quotation::detail($id), 'Quotation options saved');
        });
    }

    /** POST /quotations/{id}/price-from-package */
    public function priceFromPackage(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $quote = Quotation::findOrFail($id);

            if (empty($quote['package_id'])) {
                throw new BusinessRuleException('This quotation is not linked to a package');
            }
            if (empty($quote['travel_from'])) {
                throw new BusinessRuleException('Set the travel dates before pricing');
            }

            $occupancy = (string) Request::input('occupancy', 'double');
            if (!in_array($occupancy, ['single', 'double', 'triple'], true)) {
                throw new ValidationException(['occupancy' => ['Occupancy must be single, double or triple']]);
            }

            $priced = Pricing::quotePackage(
                (int) $quote['package_id'],
                (string) $quote['travel_from'],
                [
                    'adults'            => (int) $quote['adults'],
                    'children_with_bed' => (int) Request::input('children_with_bed', 0),
                    'children_no_bed'   => (int) Request::input('children_no_bed', $quote['children']),
                    'infants'           => (int) $quote['infants'],
                    'extra_beds'        => (int) Request::input('extra_beds', 0),
                ],
                (string) ($quote['hotel_category'] ?: '3star'),
                $occupancy
            );

            $money = Quotation::replaceItems(
                $id, $priced['lines'], (float) $quote['discount_amount'],
                (float) $quote['gst_pct'], $this->isOverseas($quote)
            );

            Audit::log('priced_from_package', 'quotation', $id, null, [
                'slab_id' => $priced['slab_id'], 'grand_total' => $money['grand_total'],
            ]);

            Response::success(Quotation::detail($id), 'Priced from the package rate card');
        });
    }

    /** POST /quotations/{id}/send */
    public function send(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $quote = Quotation::findOrFail($id);

            if (!Quotation::canTransition($quote['status'], 'sent')) {
                throw new BusinessRuleException('A quotation in status "' . $quote['status'] . '" cannot be sent');
            }
            if (!Money::greaterThan((float) $quote['grand_total'], 0)) {
                throw new BusinessRuleException('Add priced items before sending this quotation');
            }

            Quotation::updateById($id, [
                'previous_status' => $quote['status'],
                'status'          => 'sent',
                'sent_at'         => date('Y-m-d H:i:s'),
            ]);

            Audit::log('sent', 'quotation', $id);
            Response::success(Quotation::detail($id), 'Quotation marked as sent');
        });
    }

    /** POST /quotations/{id}/status */
    public function changeStatus(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $to = (string) Request::input('status', '');
            $quote = Quotation::findOrFail($id);

            if (!Quotation::canTransition($quote['status'], $to)) {
                throw new BusinessRuleException(
                    'Cannot move a quotation from "' . $quote['status'] . '" to "' . $to . '"'
                );
            }
            if ($to === 'rejected' && trim((string) Request::input('reason', '')) === '') {
                throw new ValidationException(['reason' => ['A reason is required when rejecting a quotation']]);
            }

            Quotation::updateById($id, [
                'previous_status' => $quote['status'],
                'status'          => $to,
                'accepted_at'     => $to === 'accepted' ? date('Y-m-d H:i:s') : null,
                'rejected_reason' => $to === 'rejected' ? mb_substr((string) Request::input('reason'), 0, 255) : null,
            ]);

            Response::success(Quotation::detail($id), 'Quotation marked ' . $to);
        });
    }

    /** POST /quotations/{id}/revise */
    public function revise(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Quotation::findOrFail($id);

            $newId = Quotation::revise($id);
            Audit::log('revised', 'quotation', $id, null, ['new_quotation_id' => $newId]);

            Response::created(Quotation::detail($newId), 'Revision created');
        });
    }

    /** POST /quotations/{id}/convert — accept and open a booking. */
    public function convert(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $quote = Quotation::findOrFail($id);

            if (!empty($quote['converted_booking_id'])) {
                throw new BusinessRuleException('This quotation is already linked to booking #' . $quote['converted_booking_id']);
            }
            if (!in_array($quote['status'], ['sent', 'viewed', 'accepted'], true)) {
                throw new BusinessRuleException('Send the quotation to the customer before converting it');
            }
            if (empty($quote['travel_from']) || empty($quote['travel_to'])) {
                throw new BusinessRuleException('Set the travel dates before converting');
            }

            $customerId = (int) ($quote['customer_id'] ?? 0);
            if ($customerId === 0) {
                throw new BusinessRuleException('Link a customer to this quotation before converting');
            }

            $bookingId = Database::transaction(function () use ($quote, $id, $customerId) {
                $bid = Booking::create([
                    'booking_no'     => NumberSequence::next('BKG'),
                    'quotation_id'   => $id,
                    'lead_id'        => $quote['lead_id'],
                    'customer_id'    => $customerId,
                    'agency_id'      => $quote['agency_id'],
                    'package_id'     => $quote['package_id'],
                    'departure_id'   => $quote['departure_id'],
                    'destination_id' => $quote['destination_id'],
                    // The vocabulary is shared 1:1 with quote_type, so the booking
                    // opened from a quote always agrees with what was promised.
                    'booking_type'   => $quote['quote_type'] ?? (!empty($quote['package_id']) ? 'package' : 'custom'),
                    'booking_date'   => date('Y-m-d'),
                    'travel_from'    => $quote['travel_from'],
                    'travel_to'      => $quote['travel_to'],
                    'nights'         => (int) $quote['nights'],
                    'adults'         => (int) $quote['adults'],
                    'children'       => (int) $quote['children'],
                    'infants'        => (int) $quote['infants'],
                    'hotel_category' => $quote['hotel_category'],
                    'currency'       => $quote['currency'],
                    'subtotal'       => (float) $quote['subtotal'],
                    'discount_amount'=> (float) $quote['discount_amount'],
                    'taxable_amount' => (float) $quote['taxable_amount'],
                    'gst_pct'        => (float) $quote['gst_pct'],
                    'gst_amount'     => (float) $quote['gst_amount'],
                    'tcs_amount'     => (float) $quote['tcs_amount'],
                    'grand_total'    => (float) $quote['grand_total'],
                    'cost_total'     => (float) $quote['cost_total'],
                    'status'         => 'draft',
                    'owner_id'       => $quote['owner_id'],
                ]);

                Database::execute(
                    "INSERT INTO booking_services
                        (booking_id, service_type, ref_id, description, day_no, service_date, quantity,
                         unit, unit_cost, unit_price, cost_total, sell_total, sort_order, created_by)
                     SELECT ?,
                            CASE WHEN item_type IN ('hotel','transport','activity','flight','visa','insurance','guide','meal')
                                 THEN item_type ELSE 'other' END,
                            ref_id, description, day_no, service_date, quantity, unit,
                            unit_cost, unit_price, line_cost, line_total, sort_order, ?
                       FROM quotation_items WHERE quotation_id = ? AND is_optional = 0",
                    [$bid, Request::userId(), $id]
                );

                Quotation::updateById($id, [
                    'previous_status'      => $quote['status'],
                    'status'               => 'accepted',
                    'accepted_at'          => date('Y-m-d H:i:s'),
                    'converted_booking_id' => $bid,
                ]);

                // The toggle set the customer agreed to travels forward with them.
                QuotationOption::copyToBooking($id, $bid);

                if (!empty($quote['lead_id'])) {
                    Database::execute(
                        "UPDATE leads SET previous_status = status, status = 'won', converted_booking_id = ? WHERE id = ?",
                        [$bid, (int) $quote['lead_id']]
                    );
                }

                Audit::log('converted', 'quotation', $id, null, ['booking_id' => $bid]);
                return $bid;
            });

            Response::created(Booking::detail($bookingId), 'Booking created from quotation');
        });
    }

    // -----------------------------------------------------------------------

    private function isOverseas(array $quote): bool
    {
        if (empty($quote['destination_id'])) {
            return false;
        }
        return Database::scalar(
            "SELECT 1 FROM destinations WHERE id = ? AND scope = 'international' LIMIT 1",
            [(int) $quote['destination_id']]
        ) !== null;
    }

    private function canViewMargins(): bool
    {
        return in_array(Request::staffRole(), ['owner', 'manager', 'accounts'], true);
    }

    private function canEditPrices(): bool
    {
        return in_array(Request::staffRole(), ['owner', 'manager'], true);
    }

    private function stripMargins(array $rows): array
    {
        if ($this->canViewMargins()) {
            return $rows;
        }
        foreach ($rows as &$r) {
            unset($r['cost_total'], $r['margin_amount'], $r['unit_cost'], $r['line_cost']);
        }
        return $rows;
    }
}
