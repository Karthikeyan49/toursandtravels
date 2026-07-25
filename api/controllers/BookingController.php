<?php

class BookingController extends Controller
{
    /** GET /bookings */
    public function index(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $filters = [
                'search'                => Request::query('search'),
                'status'                => Request::query('status'),
                'payment_status'        => Request::query('payment_status'),
                'customer_id'           => Request::query('customer_id'),
                'package_id'            => Request::query('package_id'),
                'departure_id'          => Request::query('departure_id'),
                'destination_id'        => Request::query('destination_id'),
                'owner_id'              => Request::query('owner_id'),
                'travel_from'           => Request::query('travel_from'),
                'travel_to'             => Request::query('travel_to'),
                'booked_from'           => Request::query('booked_from'),
                'booked_to'             => Request::query('booked_to'),
                'outstanding_only'      => Request::queryBool('outstanding_only'),
                'departing_within_days' => Request::query('departing_within_days'),
            ];

            [$rows, $total] = Booking::paginate(
                $filters, $limit, $offset, Request::query('sort'), Request::query('dir')
            );

            Response::paginated($this->stripCosts($rows), $page, $limit, $total);
        });
    }

    /** GET /bookings/{id} */
    public function show(): void
    {
        $this->run(function () {
            $booking = Booking::detail(Request::paramInt('id'));
            if ($booking === null) {
                Response::notFound('Booking not found');
                return;
            }
            $this->assertAgencyAccess($booking);

            if (!$this->canViewCosts()) {
                unset($booking['cost_total'], $booking['margin']);
                $booking['services'] = $this->stripCosts($booking['services']);
            }

            Response::success($booking);
        });
    }

    /** POST /bookings */
    public function store(): void
    {
        $this->run(function () {
            $input = Request::only([
                'customer_id', 'quotation_id', 'lead_id', 'agency_id', 'package_id',
                'departure_id', 'destination_id', 'booking_type', 'travel_from', 'travel_to',
                'adults', 'children', 'infants', 'hotel_category', 'lead_pax_name',
                'contact_phone', 'contact_email', 'emergency_contact', 'emergency_phone',
                'special_requests', 'internal_notes', 'owner_id', 'ops_owner_id',
            ]);

            $data = $this->validate($input, [
                'customer_id'    => 'required|int|min:1',
                'quotation_id'   => 'nullable|int',
                'lead_id'        => 'nullable|int',
                'agency_id'      => 'nullable|int',
                'package_id'     => 'nullable|int',
                'departure_id'   => 'nullable|int',
                'destination_id' => 'nullable|int',
                'booking_type'   => 'in:package,custom,hotel_only,transport_only,activity_only,visa_only',
                'travel_from'    => 'required|date',
                'travel_to'      => 'required|date',
                'adults'         => 'required|int|min:1|max:200',
                'children'       => 'nullable|int|min:0|max:200',
                'infants'        => 'nullable|int|min:0|max:100',
                'hotel_category' => 'nullable|in:budget,3star,4star,5star,luxury',
                'lead_pax_name'  => 'nullable|string|max:150',
                'contact_phone'  => 'nullable|phone',
                'contact_email'  => 'nullable|email',
                'emergency_contact' => 'nullable|string|max:150',
                'emergency_phone'   => 'nullable|phone',
                'special_requests'  => 'nullable|string|max:2000',
                'internal_notes'    => 'nullable|string|max:2000',
                'owner_id'          => 'nullable|int',
                'ops_owner_id'      => 'nullable|int',
            ]);

            Validator::assertDateOrder($data['travel_from'], $data['travel_to']);

            if (!Customer::exists((int) $data['customer_id'])) {
                throw new ValidationException(['customer_id' => ['Customer not found']]);
            }

            $bookingId = Database::transaction(function () use ($data) {
                $nights = Pricing::nightsBetween($data['travel_from'], $data['travel_to']);

                $payload = array_merge($data, [
                    'booking_no'   => NumberSequence::next('BKG'),
                    'booking_date' => date('Y-m-d'),
                    'nights'       => max(0, $nights),
                    'status'       => 'draft',
                    'currency'     => Setting::get('default_currency', 'INR'),
                    'gst_pct'      => Setting::decimal('default_gst_pct', 5.0),
                    'owner_id'     => $data['owner_id'] ?? Request::userId(),
                ]);

                $id = Booking::create($payload);

                // Seed the pax manifest with empty rows so the ops team has a
                // checklist to fill rather than a blank screen.
                $this->seedPaxRows($id, (int) $data['adults'], (int) ($data['children'] ?? 0), (int) ($data['infants'] ?? 0));

                if (!empty($data['quotation_id'])) {
                    $this->copyFromQuotation($id, (int) $data['quotation_id']);
                    $this->copyOptionsFromQuotation($id, (int) $data['quotation_id']);
                }

                Audit::log('create', 'booking', $id, null, ['booking_no' => $payload['booking_no']]);
                return $id;
            });

            Response::created(Booking::detail($bookingId), 'Booking created');
        });
    }

    /** PUT /bookings/{id} */
    public function update(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Booking::findOrFail($id);
            $this->assertAgencyAccess($before);

            if (in_array($before['status'], ['completed', 'cancelled'], true)) {
                throw new BusinessRuleException('A ' . $before['status'] . ' booking cannot be edited');
            }

            $input = Request::only([
                'travel_from', 'travel_to', 'adults', 'children', 'infants', 'hotel_category',
                'lead_pax_name', 'contact_phone', 'contact_email', 'emergency_contact',
                'emergency_phone', 'special_requests', 'internal_notes', 'owner_id', 'ops_owner_id',
                'destination_id', 'package_id', 'departure_id',
            ]);

            $data = $this->validate($input, [
                'travel_from'    => 'nullable|date',
                'travel_to'      => 'nullable|date',
                'adults'         => 'nullable|int|min:1|max:200',
                'children'       => 'nullable|int|min:0|max:200',
                'infants'        => 'nullable|int|min:0|max:100',
                'hotel_category' => 'nullable|in:budget,3star,4star,5star,luxury',
                'lead_pax_name'  => 'nullable|string|max:150',
                'contact_phone'  => 'nullable|phone',
                'contact_email'  => 'nullable|email',
                'emergency_contact' => 'nullable|string|max:150',
                'emergency_phone'   => 'nullable|phone',
                'special_requests'  => 'nullable|string|max:2000',
                'internal_notes'    => 'nullable|string|max:2000',
                'owner_id'          => 'nullable|int',
                'ops_owner_id'      => 'nullable|int',
                'destination_id'    => 'nullable|int',
                'package_id'        => 'nullable|int',
                'departure_id'      => 'nullable|int',
            ]);

            $from = $data['travel_from'] ?? $before['travel_from'];
            $to   = $data['travel_to']   ?? $before['travel_to'];
            Validator::assertDateOrder($from, $to);
            $data['nights'] = max(0, Pricing::nightsBetween($from, $to));

            Booking::updateById($id, $data);
            Audit::logDiff('update', 'booking', $id, $before, $data);

            Response::success(Booking::detail($id), 'Booking updated');
        });
    }

    /** PUT /bookings/{id}/services — replace all service lines, recompute totals. */
    public function saveServices(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            $services = Request::input('services', []);
            if (!is_array($services)) {
                throw new ValidationException(['services' => ['Services must be a list']]);
            }

            $discount = Money::of(Request::input('discount_amount', $booking['discount_amount']));

            // Only roles permitted to price may change the discount.
            if (!Money::equals($discount, (float) $booking['discount_amount']) && !$this->canEditPrices()) {
                Response::forbidden('Your role cannot change the discount');
                return;
            }

            $isOverseas = $this->isOverseas($booking);
            $money = Booking::replaceServices($id, $services, $discount, (float) $booking['gst_pct'], $isOverseas);

            Audit::log('services_updated', 'booking', $id, null, ['grand_total' => $money['grand_total']]);

            Response::success(Booking::detail($id), 'Services saved');
        });
    }

    /** PUT /bookings/{id}/options — the toggle set inherited from the quotation, editable on a live booking. */
    public function saveOptions(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            if (in_array($booking['status'], ['completed', 'cancelled'], true)) {
                throw new BusinessRuleException('A ' . $booking['status'] . ' booking cannot have its options changed');
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

            BookingOption::upsert($id, $data);
            Audit::log('options_updated', 'booking', $id, null, $data);

            Response::success(Booking::detail($id), 'Booking options saved');
        });
    }

    /** GET /bookings/{id}/travel-legs */
    public function travelLegs(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            Response::success(TravelLeg::forBooking($id));
        });
    }

    /** PUT /bookings/{id}/travel-legs — replace the whole logistics itinerary. */
    public function saveTravelLegs(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            $legs = Request::input('legs', []);
            if (!is_array($legs)) {
                throw new ValidationException(['legs' => ['Travel legs must be a list']]);
            }

            $saved = TravelLeg::replaceForBooking($id, $legs);
            Audit::log('travel_legs_updated', 'booking', $id, null, ['count' => count($saved)]);

            Response::success($saved, 'Travel legs saved');
        });
    }

    /** POST /bookings/{id}/travel-legs — append a single leg. */
    public function addTravelLeg(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            $leg = Request::only([
                'mode', 'direction', 'carrier_name', 'vehicle_number', 'pnr', 'seat_class',
                'from_location', 'to_location', 'departure_date', 'departure_time',
                'arrival_date', 'arrival_time', 'baggage_allowance', 'confirmation_status', 'notes',
            ]);

            $legId = TravelLeg::add($id, $leg);
            Audit::log('travel_leg_added', 'booking', $id, null, ['leg_id' => $legId]);

            Response::created(TravelLeg::forBooking($id), 'Travel leg added');
        });
    }

    /** PUT /bookings/{id}/travel-legs/{legId} */
    public function updateTravelLeg(): void
    {
        $this->run(function () {
            $id      = Request::paramInt('id');
            $legId   = Request::paramInt('legId');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            $data = Request::only([
                'mode', 'direction', 'carrier_name', 'vehicle_number', 'pnr', 'seat_class',
                'from_location', 'to_location', 'departure_date', 'departure_time',
                'arrival_date', 'arrival_time', 'baggage_allowance', 'confirmation_status', 'notes',
            ]);

            TravelLeg::updateOne($legId, $data);
            Audit::log('travel_leg_updated', 'booking', $id, null, ['leg_id' => $legId]);

            Response::success(TravelLeg::forBooking($id), 'Travel leg updated');
        });
    }

    /** DELETE /bookings/{id}/travel-legs/{legId} */
    public function removeTravelLeg(): void
    {
        $this->run(function () {
            $id      = Request::paramInt('id');
            $legId   = Request::paramInt('legId');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            TravelLeg::remove($legId);
            Audit::log('travel_leg_removed', 'booking', $id, null, ['leg_id' => $legId]);

            Response::success(TravelLeg::forBooking($id), 'Travel leg removed');
        });
    }

    /** POST /bookings/{id}/travel-legs/{legId}/confirm */
    public function confirmTravelLeg(): void
    {
        $this->run(function () {
            $id      = Request::paramInt('id');
            $legId   = Request::paramInt('legId');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            $pnr = trim((string) Request::input('pnr', ''));
            if ($pnr === '') {
                throw new ValidationException(['pnr' => ['A PNR is required to confirm this leg']]);
            }

            TravelLeg::markConfirmed($legId, $pnr);
            Audit::log('travel_leg_confirmed', 'booking', $id, null, ['leg_id' => $legId, 'pnr' => $pnr]);

            Response::success(TravelLeg::forBooking($id), 'Travel leg confirmed');
        });
    }

    /**
     * POST /bookings/{id}/services/from-package
     * Build the service lines from the catalogue. Prices resolved server-side.
     */
    public function servicesFromPackage(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            if (empty($booking['package_id'])) {
                throw new BusinessRuleException('This booking is not linked to a package');
            }

            $occupancy = (string) Request::input('occupancy', 'double');
            if (!in_array($occupancy, ['single', 'double', 'triple'], true)) {
                throw new ValidationException(['occupancy' => ['Occupancy must be single, double or triple']]);
            }

            $quote = Pricing::quotePackage(
                (int) $booking['package_id'],
                (string) $booking['travel_from'],
                [
                    'adults'            => (int) $booking['adults'],
                    'children_with_bed' => (int) Request::input('children_with_bed', 0),
                    'children_no_bed'   => (int) Request::input('children_no_bed', $booking['children']),
                    'infants'           => (int) $booking['infants'],
                    'extra_beds'        => (int) Request::input('extra_beds', 0),
                ],
                (string) ($booking['hotel_category'] ?: '3star'),
                $occupancy
            );

            $money = Booking::replaceServices(
                $id, $quote['lines'], (float) $booking['discount_amount'],
                (float) $booking['gst_pct'], $this->isOverseas($booking)
            );

            Audit::log('priced_from_package', 'booking', $id, null, [
                'slab_id' => $quote['slab_id'], 'grand_total' => $money['grand_total'],
            ]);

            Response::success(Booking::detail($id), 'Priced from the package rate card');
        });
    }

    /** PUT /bookings/{id}/pax — replace the passenger manifest. */
    public function savePax(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            $pax = Request::input('pax', []);
            if (!is_array($pax)) {
                throw new ValidationException(['pax' => ['Passenger list must be a list']]);
            }

            Database::transaction(static function () use ($id, $pax) {
                Database::execute('DELETE FROM booking_pax WHERE booking_id = ?', [$id]);

                $no = 0;
                foreach ($pax as $p) {
                    $no++;
                    $first = trim((string) ($p['first_name'] ?? ''));
                    if ($first === '') {
                        throw new ValidationException(['pax' => ["Passenger $no needs a first name"]]);
                    }

                    Database::insert('booking_pax', [
                        'booking_id'      => $id,
                        'pax_no'          => $no,
                        'title'           => in_array($p['title'] ?? '', ['Mr','Mrs','Ms','Mstr','Dr','Prof'], true) ? $p['title'] : 'Mr',
                        'first_name'      => mb_substr($first, 0, 100),
                        'last_name'       => isset($p['last_name']) ? mb_substr((string) $p['last_name'], 0, 100) : null,
                        'pax_type'        => in_array($p['pax_type'] ?? '', ['adult','child','infant'], true) ? $p['pax_type'] : 'adult',
                        'gender'          => in_array($p['gender'] ?? '', ['male','female','other'], true) ? $p['gender'] : null,
                        'date_of_birth'   => $p['date_of_birth'] ?? null,
                        'age'             => isset($p['age']) ? (int) $p['age'] : null,
                        'nationality_id'  => !empty($p['nationality_id']) ? (int) $p['nationality_id'] : null,
                        'phone'           => $p['phone'] ?? null,
                        'email'           => $p['email'] ?? null,
                        'passport_no'     => $p['passport_no'] ?? null,
                        'passport_issue'  => $p['passport_issue'] ?? null,
                        'passport_expiry' => $p['passport_expiry'] ?? null,
                        'passport_country'=> $p['passport_country'] ?? null,
                        'visa_no'         => $p['visa_no'] ?? null,
                        'visa_status'     => in_array($p['visa_status'] ?? '', ['not_required','pending','applied','approved','rejected'], true) ? $p['visa_status'] : 'not_required',
                        'visa_expiry'     => $p['visa_expiry'] ?? null,
                        'meal_preference' => in_array($p['meal_preference'] ?? '', ['none','veg','non_veg','brahmin','jain','vegan','halal'], true) ? $p['meal_preference'] : 'none',
                        'medical_notes'   => isset($p['medical_notes']) ? mb_substr((string) $p['medical_notes'], 0, 500) : null,
                        'is_lead_pax'     => !empty($p['is_lead_pax']) ? 1 : 0,
                        'insurance_no'    => $p['insurance_no'] ?? null,
                    ], [
                        'booking_id','pax_no','title','first_name','last_name','pax_type','gender',
                        'date_of_birth','age','nationality_id','phone','email','passport_no',
                        'passport_issue','passport_expiry','passport_country','visa_no','visa_status',
                        'visa_expiry','meal_preference','medical_notes','is_lead_pax','insurance_no',
                    ]);
                }
            });

            $warnings = $this->documentWarnings($id, (string) $booking['travel_to']);
            Audit::log('pax_updated', 'booking', $id, null, ['count' => count($pax)]);

            Response::success(['pax' => Booking::detail($id)['pax'], 'warnings' => $warnings], 'Passenger list saved');
        });
    }

    /** POST /bookings/{id}/confirm */
    public function confirm(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            Database::transaction(function () use ($id) {
                $booking = Booking::lockForUpdate($id);

                if (!Booking::canTransition($booking['status'], 'confirmed')) {
                    throw new BusinessRuleException(
                        'A booking in status "' . $booking['status'] . '" cannot be confirmed'
                    );
                }
                if (!Money::greaterThan((float) $booking['grand_total'], 0)) {
                    throw new BusinessRuleException('Add priced services before confirming this booking');
                }

                // Seat inventory on a fixed departure is consumed here, under the
                // same transaction, so two confirmations cannot oversell.
                if (!empty($booking['departure_id'])) {
                    $this->consumeSeats((int) $booking['departure_id'], (int) $booking['adults'] + (int) $booking['children']);
                }

                Database::execute(
                    "UPDATE bookings SET previous_status = status, status = 'confirmed', confirmed_at = NOW() WHERE id = ?",
                    [$id]
                );

                $this->recordTransition($id, (string) $booking['status'], 'confirmed', Request::input('note'));
                OpsDaysheet::generateForBooking($id);

                if (!empty($booking['lead_id'])) {
                    Database::execute(
                        "UPDATE leads SET previous_status = status, status = 'won', converted_booking_id = ? WHERE id = ?",
                        [$id, (int) $booking['lead_id']]
                    );
                }

                Notifier::bookingConfirmed($id);
            });

            Response::success(Booking::detail($id), 'Booking confirmed');
        });
    }

    /** POST /bookings/{id}/status — generic guarded transition. */
    public function changeStatus(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $to = (string) Request::input('status', '');

            $booking = Booking::findOrFail($id);
            $this->assertAgencyAccess($booking);

            if ($to === 'cancelled') {
                Response::error('Use POST /bookings/{id}/cancel to cancel a booking', 400);
                return;
            }
            if (!Booking::canTransition($booking['status'], $to)) {
                throw new BusinessRuleException(
                    'Cannot move a booking from "' . $booking['status'] . '" to "' . $to . '"'
                );
            }

            Database::transaction(function () use ($id, $booking, $to) {
                $extra = $to === 'completed' ? ', completed_at = NOW()' : '';
                Database::execute(
                    "UPDATE bookings SET previous_status = status, status = ?$extra WHERE id = ?",
                    [$to, $id]
                );
                $this->recordTransition($id, (string) $booking['status'], $to, Request::input('note'));
            });

            Response::success(Booking::detail($id), 'Status updated to ' . $to);
        });
    }

    /**
     * POST /bookings/{id}/cancel
     * Cancellation charge is computed from the policy slab, not sent by the client.
     */
    public function cancel(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $reason = trim((string) Request::input('reason', ''));

            if ($reason === '') {
                throw new ValidationException(['reason' => ['A cancellation reason is required']]);
            }

            $result = Database::transaction(function () use ($id, $reason) {
                $booking = Booking::lockForUpdate($id);

                if ($booking['status'] === 'cancelled') {
                    throw new BusinessRuleException('Booking is already cancelled');
                }
                if ($booking['status'] === 'completed') {
                    throw new BusinessRuleException('A completed booking cannot be cancelled');
                }

                $policy = Pricing::cancellationCharge(
                    (float) $booking['grand_total'],
                    (string) $booking['travel_from'],
                    !empty($booking['package_id']) ? (int) $booking['package_id'] : null
                );

                // Refund is capped at what was actually received.
                $paid   = (float) $booking['amount_paid'];
                $refund = Money::of(max(0, min($policy['refund'], $paid)));

                Database::execute(
                    "UPDATE bookings
                        SET previous_status = status, status = 'cancelled', cancelled_at = NOW(),
                            cancelled_by = ?, cancellation_reason = ?,
                            cancellation_charge = ?, refund_amount = ?
                      WHERE id = ?",
                    [Request::userId(), mb_substr($reason, 0, 500), $policy['charge'], $refund, $id]
                );

                // Release seat inventory.
                if (!empty($booking['departure_id'])) {
                    Database::execute(
                        'UPDATE package_departures
                            SET seats_booked = GREATEST(0, seats_booked - ?),
                                status = CASE WHEN status = \'full\' THEN \'open\' ELSE status END
                          WHERE id = ?',
                        [(int) $booking['adults'] + (int) $booking['children'], (int) $booking['departure_id']]
                    );
                }

                // Release supplier-side holds.
                Database::execute(
                    "UPDATE booking_services SET supplier_status = 'cancelled'
                      WHERE booking_id = ? AND supplier_status IN ('pending','requested','confirmed','waitlisted')",
                    [$id]
                );

                Database::execute(
                    "UPDATE vouchers SET status = 'cancelled', cancelled_at = NOW()
                      WHERE booking_id = ? AND status IN ('draft','issued','sent')",
                    [$id]
                );

                $this->recordTransition($id, (string) $booking['status'], 'cancelled', $reason);
                Audit::log('cancel', 'booking', $id, $booking, [
                    'reason' => $reason, 'charge' => $policy['charge'], 'refund' => $refund,
                ]);

                return ['policy' => $policy, 'refund_due' => $refund];
            });

            Response::success([
                'booking'    => Booking::detail($id),
                'policy'     => $result['policy'],
                'refund_due' => $result['refund_due'],
            ], 'Booking cancelled');
        });
    }

    /** GET /bookings/{id}/margin — restricted to cost-visible roles by the route guard. */
    public function margin(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Booking::findOrFail($id);
            Response::success(Booking::margin($id));
        });
    }

    /** GET /bookings/{id}/history */
    public function history(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Booking::findOrFail($id);
            Response::success([
                'transitions' => Database::fetchAll(
                    "SELECT wh.*, u.full_name AS actor_name
                       FROM workflow_history wh LEFT JOIN users u ON u.id = wh.actor_id
                      WHERE wh.entity_type = 'booking' AND wh.entity_id = ?
                      ORDER BY wh.created_at DESC",
                    [$id]
                ),
                'audit' => Audit::forEntity('booking', $id),
            ]);
        });
    }

    // -----------------------------------------------------------------------

    private function seedPaxRows(int $bookingId, int $adults, int $children, int $infants): void
    {
        $no = 0;
        $add = static function (string $type, int $count) use (&$no, $bookingId) {
            for ($i = 0; $i < $count; $i++) {
                $no++;
                Database::insert('booking_pax', [
                    'booking_id'  => $bookingId,
                    'pax_no'      => $no,
                    'first_name'  => 'Passenger ' . $no,
                    'pax_type'    => $type,
                    'is_lead_pax' => $no === 1 ? 1 : 0,
                ], ['booking_id', 'pax_no', 'first_name', 'pax_type', 'is_lead_pax']);
            }
        };
        $add('adult', $adults);
        $add('child', $children);
        $add('infant', $infants);
    }

    private function copyFromQuotation(int $bookingId, int $quotationId): void
    {
        $quote = Quotation::find($quotationId);
        if ($quote === null) {
            return;
        }

        Database::execute(
            "INSERT INTO booking_services
                (booking_id, service_type, ref_id, description, day_no, service_date, quantity,
                 unit, unit_cost, unit_price, cost_total, sell_total, sort_order, created_by)
             SELECT ?,
                    CASE WHEN item_type IN ('hotel','transport','activity','flight','visa','insurance','guide','meal')
                         THEN item_type ELSE 'other' END,
                    ref_id, description, day_no, service_date, quantity, unit,
                    unit_cost, unit_price, line_cost, line_total, sort_order, ?
               FROM quotation_items
              WHERE quotation_id = ? AND is_optional = 0",
            [$bookingId, Request::userId(), $quotationId]
        );

        Database::execute(
            'UPDATE bookings b
                JOIN quotations q ON q.id = ?
                SET b.subtotal = q.subtotal, b.discount_amount = q.discount_amount,
                    b.taxable_amount = q.taxable_amount, b.gst_pct = q.gst_pct,
                    b.gst_amount = q.gst_amount, b.tcs_amount = q.tcs_amount,
                    b.grand_total = q.grand_total, b.cost_total = q.cost_total
              WHERE b.id = ?',
            [$quotationId, $bookingId]
        );

        Database::execute(
            "UPDATE quotations SET previous_status = status, status = 'accepted',
                    accepted_at = NOW(), converted_booking_id = ?
              WHERE id = ?",
            [$bookingId, $quotationId]
        );
    }

    /** Carry the quotation's toggle set onto the new booking, if one was ever saved. */
    private function copyOptionsFromQuotation(int $bookingId, int $quotationId): void
    {
        $opt = QuotationOption::forQuotation($quotationId);
        if ($opt !== null) {
            BookingOption::upsert($bookingId, $opt);
        }
    }

    /** Consume seats atomically; the UPDATE's own WHERE is the oversell guard. */
    private function consumeSeats(int $departureId, int $pax): void
    {
        $affected = Database::execute(
            'UPDATE package_departures
                SET seats_booked = seats_booked + ?
              WHERE id = ?
                AND status IN (\'open\', \'filling\')
                AND (seats_total - seats_booked - seats_held) >= ?',
            [$pax, $departureId, $pax]
        );

        if ($affected === 0) {
            throw new BusinessRuleException('Not enough seats available on this departure');
        }

        Database::execute(
            "UPDATE package_departures
                SET status = CASE
                        WHEN seats_booked >= seats_total THEN 'full'
                        WHEN seats_booked > 0            THEN 'filling'
                        ELSE status END
              WHERE id = ?",
            [$departureId]
        );
    }

    private function recordTransition(int $bookingId, string $from, string $to, $note): void
    {
        Database::insert('workflow_history', [
            'entity_type' => 'booking',
            'entity_id'   => $bookingId,
            'from_status' => $from,
            'to_status'   => $to,
            'note'        => $note !== null ? mb_substr((string) $note, 0, 255) : null,
            'actor_id'    => Request::userId(),
        ], ['entity_type', 'entity_id', 'from_status', 'to_status', 'note', 'actor_id']);
    }

    /** Passport/visa problems that would strand a traveller. */
    private function documentWarnings(int $bookingId, string $travelEnd): array
    {
        $minValidityDays = Setting::int('passport_expiry_alert_days', 180);

        $rows = Database::fetchAll(
            'SELECT pax_no, first_name, last_name, passport_no, passport_expiry, visa_status
               FROM booking_pax WHERE booking_id = ? ORDER BY pax_no',
            [$bookingId]
        );

        $warnings = [];
        foreach ($rows as $p) {
            $name = trim($p['first_name'] . ' ' . ($p['last_name'] ?? ''));

            if (!empty($p['passport_expiry'])) {
                $daysAfterTravel = (int) floor((strtotime($p['passport_expiry']) - strtotime($travelEnd)) / 86400);
                if ($daysAfterTravel < 0) {
                    $warnings[] = ['pax_no' => $p['pax_no'], 'severity' => 'critical',
                        'message' => "$name — passport expires before the return date"];
                } elseif ($daysAfterTravel < $minValidityDays) {
                    $warnings[] = ['pax_no' => $p['pax_no'], 'severity' => 'warning',
                        'message' => "$name — passport valid for only $daysAfterTravel days after travel (many countries require $minValidityDays)"];
                }
            }

            if ($p['visa_status'] === 'rejected') {
                $warnings[] = ['pax_no' => $p['pax_no'], 'severity' => 'critical',
                    'message' => "$name — visa rejected"];
            } elseif (in_array($p['visa_status'], ['pending', 'applied'], true)) {
                $warnings[] = ['pax_no' => $p['pax_no'], 'severity' => 'info',
                    'message' => "$name — visa still {$p['visa_status']}"];
            }
        }

        return $warnings;
    }

    private function isOverseas(array $booking): bool
    {
        if (empty($booking['destination_id'])) {
            return false;
        }
        return Database::scalar(
            "SELECT 1 FROM destinations WHERE id = ? AND scope = 'international' LIMIT 1",
            [(int) $booking['destination_id']]
        ) !== null;
    }

    private function canViewCosts(): bool
    {
        return in_array(Request::staffRole(), ['owner', 'manager', 'accounts', 'operations'], true);
    }

    private function canEditPrices(): bool
    {
        return in_array(Request::staffRole(), ['owner', 'manager'], true);
    }

    /** Strip buying prices for roles that must not see them. */
    private function stripCosts(array $rows): array
    {
        if ($this->canViewCosts()) {
            return $rows;
        }
        foreach ($rows as &$r) {
            unset($r['cost_total'], $r['unit_cost'], $r['margin'], $r['margin_amount']);
        }
        return $rows;
    }

    private function assertAgencyAccess(array $booking): void
    {
        $user = Request::user();
        if ($user !== null && $user['user_type'] === 'agent'
            && (int) ($booking['agency_id'] ?? 0) !== (int) $user['agency_id']) {
            throw new NotFoundException('Booking not found');
        }
    }
}
