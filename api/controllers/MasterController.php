<?php
/**
 * Reference-data CRUD: destinations, cities, suppliers, hotels, activities,
 * vehicles, drivers, agencies.
 *
 * These share one shape — list / show / create / update / soft-delete — so they
 * live in one controller rather than eight near-identical files. Anything with
 * real business rules (packages, bookings, money) gets its own controller.
 */
class MasterController extends Controller
{
    // --- Destinations -------------------------------------------------------

    public function destinations(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();
            [$rows, $total] = Destination::paginate([
                'search'     => Request::query('search'),
                'scope'      => Request::query('scope'),
                'country_id' => Request::query('country_id'),
                'is_active'  => Request::queryBool('is_active'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function destinationOptions(): void
    {
        $this->run(static fn() => Response::success(Destination::options()));
    }

    public function storeDestination(): void
    {
        $this->run(function () {
            $data = $this->validate(
                Request::only(['code', 'name', 'country_id', 'region', 'scope', 'description', 'best_season', 'hero_image']),
                [
                    'code'        => 'required|code|max:20',
                    'name'        => 'required|string|max:120',
                    'country_id'  => 'nullable|int',
                    'region'      => 'nullable|string|max:80',
                    'scope'       => 'required|in:domestic,international',
                    'description' => 'nullable|string|max:8000',
                    'best_season' => 'nullable|string|max:120',
                    'hero_image'  => 'nullable|string|max:255',
                ]
            );

            if (Destination::codeTaken($data['code'])) {
                throw new ValidationException(['code' => ['That destination code is already in use']]);
            }

            $id = Destination::create($data);
            Audit::log('create', 'destination', $id, null, $data);

            Response::created(Destination::find($id), 'Destination created');
        });
    }

    public function updateDestination(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Destination::findOrFail($id);

            $data = $this->validate(
                Request::only(['code', 'name', 'country_id', 'region', 'scope', 'description', 'best_season', 'hero_image', 'is_active']),
                [
                    'code'        => 'nullable|code|max:20',
                    'name'        => 'nullable|string|max:120',
                    'country_id'  => 'nullable|int',
                    'region'      => 'nullable|string|max:80',
                    'scope'       => 'nullable|in:domestic,international',
                    'description' => 'nullable|string|max:8000',
                    'best_season' => 'nullable|string|max:120',
                    'hero_image'  => 'nullable|string|max:255',
                    'is_active'   => 'nullable|bool',
                ]
            );

            if (isset($data['code']) && Destination::codeTaken($data['code'], $id)) {
                throw new ValidationException(['code' => ['That destination code is already in use']]);
            }

            Destination::updateById($id, $data);
            Audit::logDiff('update', 'destination', $id, $before, $data);

            Response::success(Destination::find($id), 'Destination updated');
        });
    }

    public function deleteDestination(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Destination::findOrFail($id);

            // Refuse to hide a destination that live packages still point at —
            // silently orphaning them would break pricing.
            $inUse = (int) Database::scalar(
                "SELECT COUNT(*) FROM packages WHERE destination_id = ? AND is_deleted = 0 AND status = 'active'",
                [$id]
            );
            if ($inUse > 0) {
                throw new BusinessRuleException("$inUse active package(s) still use this destination. Archive them first.");
            }

            Destination::softDelete($id);
            Audit::log('delete', 'destination', $id);

            Response::success(null, 'Destination archived');
        });
    }

    public function cities(): void
    {
        $this->run(static function () {
            $destinationId = Request::queryInt('destination_id');
            if ($destinationId < 1) {
                Response::success([]);
                return;
            }
            Response::success(Destination::cities($destinationId));
        });
    }

    public function storeCity(): void
    {
        $this->run(function () {
            $data = $this->validate(
                Request::only(['destination_id', 'name', 'airport_code']),
                [
                    'destination_id' => 'required|int|min:1',
                    'name'           => 'required|string|max:120',
                    'airport_code'   => 'nullable|string|max:5',
                ]
            );

            if (!Destination::exists((int) $data['destination_id'])) {
                throw new ValidationException(['destination_id' => ['Destination not found']]);
            }

            $id = Database::insert('cities', $data, ['destination_id', 'name', 'airport_code']);
            Response::created(Database::fetch('SELECT * FROM cities WHERE id = ?', [$id]), 'City added');
        });
    }

    // --- Suppliers ----------------------------------------------------------

    public function suppliers(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();
            [$rows, $total] = Supplier::paginate([
                'search'         => Request::query('search'),
                'supplier_type'  => Request::query('supplier_type'),
                'destination_id' => Request::query('destination_id'),
                'is_active'      => Request::queryBool('is_active'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function supplierOptions(): void
    {
        $this->run(static function () {
            Response::success(Supplier::options(
                Request::query('type'),
                Request::queryInt('destination_id') ?: null
            ));
        });
    }

    public function showSupplier(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $supplier = Supplier::find($id);
            if ($supplier === null) {
                Response::notFound('Supplier not found');
                return;
            }
            $supplier['ledger'] = Supplier::ledger($id, Request::query('from'), Request::query('to'));
            Response::success($supplier);
        });
    }

    public function storeSupplier(): void
    {
        $this->run(function () {
            $data = $this->supplierPayload(true);
            $data['code'] = $data['code'] ?? Supplier::nextCode();

            $id = Supplier::create($data);
            Audit::log('create', 'supplier', $id, null, ['name' => $data['name']]);

            Response::created(Supplier::find($id), 'Supplier created');
        });
    }

    public function updateSupplier(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Supplier::findOrFail($id);

            $data = $this->supplierPayload(false);
            Supplier::updateById($id, $data);
            Audit::logDiff('update', 'supplier', $id, $before, $data);

            Response::success(Supplier::find($id), 'Supplier updated');
        });
    }

    public function deleteSupplier(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Supplier::findOrFail($id);

            $unpaid = (float) Database::scalar(
                "SELECT COALESCE(SUM(grand_total - amount_paid), 0) FROM supplier_bills
                  WHERE supplier_id = ? AND status NOT IN ('void','cancelled')",
                [$id]
            );
            if (Money::greaterThan($unpaid, 0)) {
                throw new BusinessRuleException(
                    'This supplier has ' . number_format($unpaid, 2) . ' outstanding. Settle it before archiving.'
                );
            }

            Supplier::softDelete($id);
            Audit::log('delete', 'supplier', $id);

            Response::success(null, 'Supplier archived');
        });
    }

    private function supplierPayload(bool $creating): array
    {
        $required = $creating ? 'required' : 'nullable';

        return $this->validate(
            Request::only([
                'code', 'name', 'supplier_type', 'destination_id', 'contact_person', 'phone',
                'alt_phone', 'email', 'address', 'city', 'state', 'country_id', 'gstin', 'pan',
                'currency', 'credit_days', 'credit_limit', 'bank_name', 'bank_account',
                'bank_ifsc', 'notes', 'is_active',
            ]),
            [
                'code'           => 'nullable|code|max:20',
                'name'           => "$required|string|max:160",
                'supplier_type'  => "$required|in:hotel,transport,activity,dmc,airline,visa,insurance,guide,other",
                'destination_id' => 'nullable|int',
                'contact_person' => 'nullable|string|max:120',
                'phone'          => 'nullable|phone',
                'alt_phone'      => 'nullable|phone',
                'email'          => 'nullable|email',
                'address'        => 'nullable|string|max:400',
                'city'           => 'nullable|string|max:120',
                'state'          => 'nullable|string|max:120',
                'country_id'     => 'nullable|int',
                'gstin'          => 'nullable|gstin',
                'pan'            => 'nullable|pan',
                'currency'       => 'nullable|string|max:3',
                'credit_days'    => 'nullable|int|min:0|max:365',
                'credit_limit'   => 'nullable|money',
                'bank_name'      => 'nullable|string|max:120',
                'bank_account'   => 'nullable|string|max:40',
                'bank_ifsc'      => 'nullable|ifsc',
                'notes'          => 'nullable|string|max:4000',
                'is_active'      => 'nullable|bool',
            ]
        );
    }

    // --- Hotels -------------------------------------------------------------

    public function hotels(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();
            [$rows, $total] = Hotel::paginate([
                'search'         => Request::query('search'),
                'destination_id' => Request::query('destination_id'),
                'city_id'        => Request::query('city_id'),
                'category'       => Request::query('category'),
                'is_active'      => Request::queryBool('is_active'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function hotelOptions(): void
    {
        $this->run(static function () {
            Response::success(Hotel::options(
                Request::queryInt('destination_id') ?: null,
                Request::query('category')
            ));
        });
    }

    public function showHotel(): void
    {
        $this->run(function () {
            $hotel = Hotel::detail(Request::paramInt('id'));
            if ($hotel === null) {
                Response::notFound('Hotel not found');
                return;
            }
            Response::success($hotel);
        });
    }

    public function storeHotel(): void
    {
        $this->run(function () {
            $data = $this->hotelPayload(true);
            $id = Hotel::create($data);
            Audit::log('create', 'hotel', $id, null, ['name' => $data['name']]);
            Response::created(Hotel::detail($id), 'Hotel created');
        });
    }

    public function updateHotel(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Hotel::findOrFail($id);
            $data = $this->hotelPayload(false);

            Hotel::updateById($id, $data);
            Audit::logDiff('update', 'hotel', $id, $before, $data);

            Response::success(Hotel::detail($id), 'Hotel updated');
        });
    }

    public function deleteHotel(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Hotel::findOrFail($id);

            $future = (int) Database::scalar(
                "SELECT COUNT(*) FROM booking_services bs
                   JOIN bookings b ON b.id = bs.booking_id
                  WHERE bs.service_type = 'hotel' AND bs.ref_id = ?
                    AND b.travel_to >= CURDATE() AND b.status NOT IN ('cancelled','completed')",
                [$id]
            );
            if ($future > 0) {
                throw new BusinessRuleException("$future upcoming booking(s) use this hotel. Archive it after they complete.");
            }

            Hotel::softDelete($id);
            Response::success(null, 'Hotel archived');
        });
    }

    private function hotelPayload(bool $creating): array
    {
        $required = $creating ? 'required' : 'nullable';

        return $this->validate(
            Request::only([
                'supplier_id', 'code', 'name', 'destination_id', 'city_id', 'category',
                'address', 'phone', 'email', 'check_in_time', 'check_out_time',
                'child_free_age', 'amenities', 'notes', 'is_active',
            ]),
            [
                'supplier_id'    => 'nullable|int',
                'code'           => "$required|code|max:20",
                'name'           => "$required|string|max:160",
                'destination_id' => "$required|int|min:1",
                'city_id'        => 'nullable|int',
                'category'       => 'nullable|in:budget,3star,4star,5star,luxury,resort,homestay,houseboat,camp',
                'address'        => 'nullable|string|max:400',
                'phone'          => 'nullable|phone',
                'email'          => 'nullable|email',
                'check_in_time'  => 'nullable|time',
                'check_out_time' => 'nullable|time',
                'child_free_age' => 'nullable|int|min:0|max:18',
                'amenities'      => 'nullable|string|max:2000',
                'notes'          => 'nullable|string|max:4000',
                'is_active'      => 'nullable|bool',
            ]
        );
    }

    /** POST /hotels/{id}/room-types */
    public function storeRoomType(): void
    {
        $this->run(function () {
            $hotelId = Request::paramInt('id');
            Hotel::findOrFail($hotelId);

            $data = $this->validate(
                Request::only(['name', 'room_category', 'max_adults', 'max_children', 'extra_beds']),
                [
                    'name'          => 'required|string|max:120',
                    // The client's fixed picklist (Normal/AC/Non-AC/Deluxe/Super Deluxe/
                    // Executive/Suite) tags the room for filtering; `name` stays free text
                    // so a hotel can still call it "Deluxe Garden View".
                    'room_category' => 'nullable|in:normal,ac,non_ac,deluxe,super_deluxe,executive,suite,other',
                    'max_adults'    => 'nullable|int|min:1|max:10',
                    'max_children'  => 'nullable|int|min:0|max:10',
                    'extra_beds'    => 'nullable|int|min:0|max:5',
                ]
            );
            $data['hotel_id'] = $hotelId;

            $id = Database::insert('hotel_room_types', $data, ['hotel_id', 'name', 'room_category', 'max_adults', 'max_children', 'extra_beds']);
            Response::created(Database::fetch('SELECT * FROM hotel_room_types WHERE id = ?', [$id]), 'Room type added');
        });
    }

    /** POST /hotels/{id}/rates — contracted rate card. */
    public function storeRate(): void
    {
        $this->run(function () {
            $hotelId = Request::paramInt('id');
            Hotel::findOrFail($hotelId);

            $data = $this->validate(
                Request::only([
                    'room_type_id', 'season_name', 'valid_from', 'valid_to', 'meal_plan',
                    'rate_basis', 'currency', 'cost_single', 'cost_double', 'cost_triple',
                    'cost_extra_bed', 'cost_child_no_bed', 'tax_pct',
                ]),
                [
                    'room_type_id'      => 'required|int|min:1',
                    'season_name'       => 'nullable|string|max:80',
                    'valid_from'        => 'required|date',
                    'valid_to'          => 'required|date',
                    'meal_plan'         => 'nullable|in:EP,CP,MAP,AP',
                    'rate_basis'        => 'nullable|in:per_room,per_person',
                    'currency'          => 'nullable|string|max:3',
                    'cost_single'       => 'nullable|money',
                    'cost_double'       => 'nullable|money',
                    'cost_triple'       => 'nullable|money',
                    'cost_extra_bed'    => 'nullable|money',
                    'cost_child_no_bed' => 'nullable|money',
                    'tax_pct'           => 'nullable|decimal|min:0|max:100',
                ]
            );

            Validator::assertDateOrder($data['valid_from'], $data['valid_to'], 'valid_to');

            $belongs = Database::scalar(
                'SELECT 1 FROM hotel_room_types WHERE id = ? AND hotel_id = ? LIMIT 1',
                [(int) $data['room_type_id'], $hotelId]
            );
            if ($belongs === null) {
                throw new ValidationException(['room_type_id' => ['That room type does not belong to this hotel']]);
            }

            // Overlapping contracts for the same room + meal plan make rate
            // resolution ambiguous, so reject rather than silently pick one.
            $overlap = Database::scalar(
                'SELECT id FROM hotel_rates
                  WHERE hotel_id = ? AND room_type_id = ? AND meal_plan = ? AND is_active = 1
                    AND valid_from <= ? AND valid_to >= ?
                  LIMIT 1',
                [$hotelId, (int) $data['room_type_id'], $data['meal_plan'] ?? 'CP', $data['valid_to'], $data['valid_from']]
            );
            if ($overlap !== null) {
                throw new BusinessRuleException('An active rate for this room and meal plan already covers those dates (#' . $overlap . ')');
            }

            $data['hotel_id'] = $hotelId;
            $id = Database::insert('hotel_rates', $data, [
                'hotel_id', 'room_type_id', 'season_name', 'valid_from', 'valid_to', 'meal_plan',
                'rate_basis', 'currency', 'cost_single', 'cost_double', 'cost_triple',
                'cost_extra_bed', 'cost_child_no_bed', 'tax_pct',
            ]);

            Audit::log('create', 'hotel_rate', $id, null, ['hotel_id' => $hotelId]);
            Response::created(Database::fetch('SELECT * FROM hotel_rates WHERE id = ?', [$id]), 'Rate added');
        });
    }

    // --- Activities ---------------------------------------------------------

    public function activities(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $clauses = ['a.is_deleted = 0'];
            $params  = [];

            if ($s = Request::query('search')) {
                $clauses[] = '(a.name LIKE ? OR a.code LIKE ?)';
                $params[] = "%$s%";
                $params[] = "%$s%";
            }
            if ($d = Request::queryInt('destination_id')) {
                $clauses[] = 'a.destination_id = ?';
                $params[] = $d;
            }
            if ($t = Request::query('activity_type')) {
                $clauses[] = 'a.activity_type = ?';
                $params[] = $t;
            }

            $where = implode(' AND ', $clauses);
            $total = (int) Database::scalar("SELECT COUNT(*) FROM activities a WHERE $where", $params);

            $rows = Database::fetchAll(
                "SELECT a.*, d.name AS destination_name, s.name AS supplier_name
                   FROM activities a
                   LEFT JOIN destinations d ON d.id = a.destination_id
                   LEFT JOIN suppliers    s ON s.id = a.supplier_id
                  WHERE $where ORDER BY a.name ASC LIMIT $limit OFFSET $offset",
                $params
            );

            if (!in_array(Request::staffRole(), ['owner', 'manager', 'accounts', 'operations'], true)) {
                foreach ($rows as &$r) {
                    unset($r['cost_adult'], $r['cost_child']);
                }
            }

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function storeActivity(): void
    {
        $this->run(function () {
            $data = $this->validate(
                Request::only([
                    'code', 'name', 'destination_id', 'supplier_id', 'activity_type',
                    'duration_hours', 'pricing_basis', 'cost_adult', 'cost_child',
                    'sell_adult', 'sell_child', 'tax_pct', 'min_pax', 'description',
                ]),
                [
                    'code'           => 'required|code|max:20',
                    'name'           => 'required|string|max:160',
                    'destination_id' => 'required|int|min:1',
                    'supplier_id'    => 'nullable|int',
                    'activity_type'  => 'nullable|in:sightseeing,adventure,cruise,show,entry_ticket,wellness,transfer,meal,other',
                    'duration_hours' => 'nullable|decimal|min:0|max:240',
                    'pricing_basis'  => 'nullable|in:per_person,per_group,per_vehicle',
                    'cost_adult'     => 'nullable|money',
                    'cost_child'     => 'nullable|money',
                    'sell_adult'     => 'required|money',
                    'sell_child'     => 'nullable|money',
                    'tax_pct'        => 'nullable|decimal|min:0|max:100',
                    'min_pax'        => 'nullable|int|min:1|max:200',
                    'description'    => 'nullable|string|max:4000',
                ]
            );

            // A sell price below cost is almost always a data-entry slip.
            if (isset($data['cost_adult']) && Money::greaterThan($data['cost_adult'], $data['sell_adult'])) {
                throw new ValidationException(['sell_adult' => ['Selling price is below cost']]);
            }

            $id = Database::insert('activities', array_merge($data, ['created_by' => Request::userId()]), [
                'code', 'name', 'destination_id', 'supplier_id', 'activity_type', 'duration_hours',
                'pricing_basis', 'cost_adult', 'cost_child', 'sell_adult', 'sell_child',
                'tax_pct', 'min_pax', 'description', 'created_by',
            ]);

            Audit::log('create', 'activity', $id, null, ['name' => $data['name']]);
            Response::created(Database::fetch('SELECT * FROM activities WHERE id = ?', [$id]), 'Activity created');
        });
    }

    // --- Customers ----------------------------------------------------------

    public function customers(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();
            [$rows, $total] = Customer::paginate([
                'search'        => Request::query('search'),
                'customer_type' => Request::query('customer_type'),
                'agency_id'     => Request::query('agency_id'),
                'city'          => Request::query('city'),
                'is_active'     => Request::queryBool('is_active'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function showCustomer(): void
    {
        $this->run(function () {
            $customer = Customer::detail(Request::paramInt('id'));
            if ($customer === null) {
                Response::notFound('Customer not found');
                return;
            }
            Response::success($customer);
        });
    }

    public function storeCustomer(): void
    {
        $this->run(function () {
            $data = $this->customerPayload(true);

            $existing = Customer::findByPhone($data['phone']);
            if ($existing !== null) {
                throw new BusinessRuleException(
                    'A customer with this phone number already exists: ' . $existing['full_name'] . ' (' . $existing['code'] . ')'
                );
            }

            $data['code'] = Customer::nextCode();
            $id = Customer::create($data);
            Audit::log('create', 'customer', $id, null, ['name' => $data['full_name']]);

            Response::created(Customer::find($id), 'Customer created');
        });
    }

    public function updateCustomer(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Customer::findOrFail($id);
            $data = $this->customerPayload(false);

            if (isset($data['phone']) && $data['phone'] !== $before['phone']) {
                $clash = Customer::findByPhone($data['phone']);
                if ($clash !== null && (int) $clash['id'] !== $id) {
                    throw new BusinessRuleException('Another customer already uses that phone number');
                }
            }

            Customer::updateById($id, $data);
            Audit::logDiff('update', 'customer', $id, $before, $data);

            Response::success(Customer::find($id), 'Customer updated');
        });
    }

    private function customerPayload(bool $creating): array
    {
        $required = $creating ? 'required' : 'nullable';

        return $this->validate(
            Request::only([
                'full_name', 'email', 'phone', 'alt_phone', 'whatsapp', 'address', 'city',
                'state', 'pincode', 'country_id', 'date_of_birth', 'anniversary', 'gstin',
                'customer_type', 'agency_id', 'source', 'notes', 'is_active',
            ]),
            [
                'full_name'     => "$required|string|max:150",
                'email'         => 'nullable|email',
                'phone'         => "$required|phone",
                'alt_phone'     => 'nullable|phone',
                'whatsapp'      => 'nullable|phone',
                'address'       => 'nullable|string|max:400',
                'city'          => 'nullable|string|max:120',
                'state'         => 'nullable|string|max:120',
                'pincode'       => 'nullable|string|max:10',
                'country_id'    => 'nullable|int',
                'date_of_birth' => 'nullable|date',
                'anniversary'   => 'nullable|date',
                'gstin'         => 'nullable|gstin',
                'customer_type' => 'nullable|in:individual,corporate,agency',
                'agency_id'     => 'nullable|int',
                'source'        => 'nullable|string|max:60',
                'notes'         => 'nullable|string|max:4000',
                'is_active'     => 'nullable|bool',
            ]
        );
    }

    // --- Fleet --------------------------------------------------------------

    public function vehicles(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $clauses = ['v.is_deleted = 0'];
            $params  = [];

            if ($s = Request::query('search')) {
                $clauses[] = '(v.registration_no LIKE ? OR vt.name LIKE ?)';
                $params[] = "%$s%";
                $params[] = "%$s%";
            }
            if (Request::queryBool('owned_only')) {
                $clauses[] = 'v.is_owned = 1';
            }
            // Compliance view: anything expiring inside 45 days.
            if (Request::queryBool('expiring')) {
                $clauses[] = '(v.permit_expiry <= DATE_ADD(CURDATE(), INTERVAL 45 DAY)
                             OR v.insurance_expiry <= DATE_ADD(CURDATE(), INTERVAL 45 DAY)
                             OR v.fitness_expiry <= DATE_ADD(CURDATE(), INTERVAL 45 DAY)
                             OR v.puc_expiry <= DATE_ADD(CURDATE(), INTERVAL 45 DAY))';
            }

            $where = implode(' AND ', $clauses);
            $total = (int) Database::scalar(
                "SELECT COUNT(*) FROM vehicles v JOIN vehicle_types vt ON vt.id = v.vehicle_type_id WHERE $where",
                $params
            );

            $rows = Database::fetchAll(
                "SELECT v.*, vt.name AS vehicle_type_name, vt.seat_count, vt.is_ac,
                        s.name AS supplier_name, d.name AS destination_name,
                        LEAST(
                            COALESCE(DATEDIFF(v.permit_expiry,    CURDATE()), 9999),
                            COALESCE(DATEDIFF(v.insurance_expiry, CURDATE()), 9999),
                            COALESCE(DATEDIFF(v.fitness_expiry,   CURDATE()), 9999),
                            COALESCE(DATEDIFF(v.puc_expiry,       CURDATE()), 9999)
                        ) AS days_to_next_expiry
                   FROM vehicles v
                   JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
                   LEFT JOIN suppliers    s ON s.id = v.supplier_id
                   LEFT JOIN destinations d ON d.id = v.destination_id
                  WHERE $where ORDER BY days_to_next_expiry ASC LIMIT $limit OFFSET $offset",
                $params
            );

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function drivers(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $clauses = ['d.is_deleted = 0'];
            $params  = [];
            if ($s = Request::query('search')) {
                $clauses[] = '(d.full_name LIKE ? OR d.phone LIKE ?)';
                $params[] = "%$s%";
                $params[] = "%$s%";
            }
            if ($dest = Request::queryInt('destination_id')) {
                $clauses[] = 'd.destination_id = ?';
                $params[] = $dest;
            }

            $where = implode(' AND ', $clauses);
            $total = (int) Database::scalar("SELECT COUNT(*) FROM drivers d WHERE $where", $params);

            $rows = Database::fetchAll(
                "SELECT d.*, s.name AS supplier_name, dest.name AS destination_name,
                        DATEDIFF(d.licence_expiry, CURDATE()) AS licence_days_left
                   FROM drivers d
                   LEFT JOIN suppliers    s    ON s.id = d.supplier_id
                   LEFT JOIN destinations dest ON dest.id = d.destination_id
                  WHERE $where ORDER BY d.full_name ASC LIMIT $limit OFFSET $offset",
                $params
            );

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function vehicleTypes(): void
    {
        $this->run(static fn() => Response::success(Database::fetchAll(
            'SELECT id, name, seat_count, luggage_cap, is_ac FROM vehicle_types
              WHERE is_deleted = 0 AND is_active = 1 ORDER BY seat_count ASC, name ASC'
        )));
    }

    public function countries(): void
    {
        $this->run(static fn() => Response::success(Database::fetchAll(
            'SELECT id, iso2, name, currency, dial_code, visa_required FROM countries
              WHERE is_active = 1 ORDER BY name ASC'
        )));
    }
}
