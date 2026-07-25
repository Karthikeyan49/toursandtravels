<?php

class PackageController extends Controller
{
    /** GET /packages */
    public function index(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            [$rows, $total] = Package::paginate([
                'search'         => Request::query('search'),
                'destination_id' => Request::query('destination_id'),
                'package_type'   => Request::query('package_type'),
                'scope'          => Request::query('scope'),
                'status'         => Request::query('status'),
                'nights_min'     => Request::query('nights_min'),
                'nights_max'     => Request::query('nights_max'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    public function options(): void
    {
        $this->run(static fn() => Response::success(
            Package::options(Request::queryInt('destination_id') ?: null)
        ));
    }

    /** GET /packages/{id} */
    public function show(): void
    {
        $this->run(function () {
            $pkg = Package::detail(Request::paramInt('id'));
            if ($pkg === null) {
                Response::notFound('Package not found');
                return;
            }

            // Buying prices on the rate card are internal.
            if (!in_array(Request::staffRole(), ['owner', 'manager', 'accounts', 'operations'], true)) {
                foreach ($pkg['prices'] as &$p) {
                    unset($p['cost_per_adult']);
                }
                foreach ($pkg['day_items'] as &$di) {
                    unset($di['unit_cost']);
                }
            }

            Response::success($pkg);
        });
    }

    /** POST /packages */
    public function store(): void
    {
        $this->run(function () {
            $data = $this->payload(true);
            $data['code']   = $data['code'] ?? Package::nextCode();
            $data['status'] = 'draft';

            if (Database::scalar('SELECT 1 FROM packages WHERE code = ? LIMIT 1', [$data['code']]) !== null) {
                throw new ValidationException(['code' => ['That package code is already in use']]);
            }

            $id = Package::create($data);
            Audit::log('create', 'package', $id, null, ['code' => $data['code'], 'name' => $data['name']]);

            Response::created(Package::detail($id), 'Package created');
        });
    }

    /** PUT /packages/{id} */
    public function update(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Package::findOrFail($id);
            $data = $this->payload(false);

            Package::updateById($id, $data);
            Audit::logDiff('update', 'package', $id, $before, $data);

            Response::success(Package::detail($id), 'Package updated');
        });
    }

    /** PUT /packages/{id}/itinerary */
    public function saveItinerary(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Package::findOrFail($id);

            $days = Request::input('days', []);
            if (!is_array($days) || $days === []) {
                throw new ValidationException(['days' => ['Provide at least one itinerary day']]);
            }
            if (count($days) > 60) {
                throw new ValidationException(['days' => ['An itinerary cannot exceed 60 days']]);
            }

            Package::replaceItinerary($id, $days);
            Audit::log('itinerary_updated', 'package', $id, null, ['day_count' => count($days)]);

            Response::success(Package::detail($id), 'Itinerary saved');
        });
    }

    /** POST /packages/{id}/prices — add a rate slab. */
    public function storePrice(): void
    {
        $this->run(function () {
            $packageId = Request::paramInt('id');
            Package::findOrFail($packageId);

            $data = $this->validate(
                Request::only([
                    'label', 'hotel_category', 'pax_from', 'pax_to', 'valid_from', 'valid_to',
                    'currency', 'cost_per_adult', 'price_single', 'price_double', 'price_triple',
                    'price_child_bed', 'price_child_nobed', 'price_infant', 'extra_bed_price',
                ]),
                [
                    'label'             => 'nullable|string|max:80',
                    'hotel_category'    => 'nullable|in:budget,3star,4star,5star,luxury',
                    'pax_from'          => 'nullable|int|min:1|max:999',
                    'pax_to'            => 'nullable|int|min:1|max:999',
                    'valid_from'        => 'required|date',
                    'valid_to'          => 'required|date',
                    'currency'          => 'nullable|string|max:3',
                    'cost_per_adult'    => 'nullable|money',
                    'price_single'      => 'nullable|money',
                    'price_double'      => 'required|money',
                    'price_triple'      => 'nullable|money',
                    'price_child_bed'   => 'nullable|money',
                    'price_child_nobed' => 'nullable|money',
                    'price_infant'      => 'nullable|money',
                    'extra_bed_price'   => 'nullable|money',
                ]
            );

            Validator::assertDateOrder($data['valid_from'], $data['valid_to'], 'valid_to');

            $paxFrom = (int) ($data['pax_from'] ?? 1);
            $paxTo   = (int) ($data['pax_to'] ?? 999);
            if ($paxTo < $paxFrom) {
                throw new ValidationException(['pax_to' => ['Upper pax bound cannot be below the lower bound']]);
            }

            // Overlapping slabs make resolution ambiguous.
            $overlap = Database::scalar(
                'SELECT id FROM package_prices
                  WHERE package_id = ? AND hotel_category = ? AND is_active = 1
                    AND valid_from <= ? AND valid_to >= ?
                    AND pax_from <= ? AND pax_to >= ?
                  LIMIT 1',
                [
                    $packageId, $data['hotel_category'] ?? '3star',
                    $data['valid_to'], $data['valid_from'], $paxTo, $paxFrom,
                ]
            );
            if ($overlap !== null) {
                throw new BusinessRuleException(
                    'An active slab already covers that date and pax range (#' . $overlap . '). Deactivate it first.'
                );
            }

            $data['package_id'] = $packageId;
            $data['pax_from']   = $paxFrom;
            $data['pax_to']     = $paxTo;

            $id = Database::insert('package_prices', $data, [
                'package_id', 'label', 'hotel_category', 'pax_from', 'pax_to', 'valid_from',
                'valid_to', 'currency', 'cost_per_adult', 'price_single', 'price_double',
                'price_triple', 'price_child_bed', 'price_child_nobed', 'price_infant', 'extra_bed_price',
            ]);

            Audit::log('price_slab_added', 'package', $packageId, null, ['slab_id' => $id]);
            Response::created(Database::fetch('SELECT * FROM package_prices WHERE id = ?', [$id]), 'Rate slab added');
        });
    }

    /** DELETE /packages/{id}/prices/{priceId} — deactivate rather than delete. */
    public function deactivatePrice(): void
    {
        $this->run(function () {
            $packageId = Request::paramInt('id');
            $priceId   = Request::paramInt('priceId');

            $affected = Database::execute(
                'UPDATE package_prices SET is_active = 0 WHERE id = ? AND package_id = ?',
                [$priceId, $packageId]
            );
            if ($affected === 0) {
                Response::notFound('Rate slab not found');
                return;
            }

            Audit::log('price_slab_deactivated', 'package', $packageId, null, ['slab_id' => $priceId]);
            Response::success(null, 'Rate slab deactivated');
        });
    }

    /** POST /packages/{id}/departures — fixed-departure batch. */
    public function storeDeparture(): void
    {
        $this->run(function () {
            $packageId = Request::paramInt('id');
            $pkg = Package::findOrFail($packageId);

            $data = $this->validate(
                Request::only([
                    'batch_code', 'departure_date', 'return_date', 'departure_city_id',
                    'seats_total', 'price_override', 'tour_manager_id', 'notes',
                ]),
                [
                    'batch_code'        => 'nullable|code|max:30',
                    'departure_date'    => 'required|date',
                    'return_date'       => 'nullable|date',
                    'departure_city_id' => 'nullable|int',
                    'seats_total'       => 'required|int|min:1|max:2000',
                    'price_override'    => 'nullable|money',
                    'tour_manager_id'   => 'nullable|int',
                    'notes'             => 'nullable|string|max:500',
                ]
            );

            // Derive the return date from the package length when not supplied.
            $data['return_date'] ??= date('Y-m-d', strtotime($data['departure_date'] . ' +' . (int) $pkg['nights'] . ' days'));
            Validator::assertDateOrder($data['departure_date'], $data['return_date'], 'return_date');

            if (strtotime($data['departure_date']) < strtotime('today')) {
                throw new ValidationException(['departure_date' => ['Departure date cannot be in the past']]);
            }

            $data['batch_code'] ??= strtoupper(date('ymd', strtotime($data['departure_date'])));
            $data['package_id'] = $packageId;

            $clash = Database::scalar(
                'SELECT 1 FROM package_departures WHERE package_id = ? AND batch_code = ? LIMIT 1',
                [$packageId, $data['batch_code']]
            );
            if ($clash !== null) {
                throw new ValidationException(['batch_code' => ['That batch code already exists for this package']]);
            }

            $id = Database::insert('package_departures', array_merge($data, ['created_by' => Request::userId()]), [
                'package_id', 'batch_code', 'departure_date', 'return_date', 'departure_city_id',
                'seats_total', 'price_override', 'tour_manager_id', 'notes', 'created_by',
            ]);

            Audit::log('departure_added', 'package', $packageId, null, ['departure_id' => $id]);
            Response::created(Database::fetch('SELECT * FROM package_departures WHERE id = ?', [$id]), 'Departure created');
        });
    }

    /** GET /departures — cross-package departure board. */
    public function departures(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $clauses = ['1=1'];
            $params  = [];

            if ($from = Request::query('from')) {
                $clauses[] = 'pd.departure_date >= ?';
                $params[] = $from;
            } else {
                $clauses[] = 'pd.departure_date >= CURDATE()';
            }
            if ($to = Request::query('to')) {
                $clauses[] = 'pd.departure_date <= ?';
                $params[] = $to;
            }
            if ($status = Request::query('status')) {
                $clauses[] = 'pd.status = ?';
                $params[] = $status;
            }
            if ($pkgId = Request::queryInt('package_id')) {
                $clauses[] = 'pd.package_id = ?';
                $params[] = $pkgId;
            }
            if (Request::queryBool('available_only')) {
                $clauses[] = '(pd.seats_total - pd.seats_booked - pd.seats_held) > 0';
            }

            $where = implode(' AND ', $clauses);
            $total = (int) Database::scalar("SELECT COUNT(*) FROM package_departures pd WHERE $where", $params);

            $rows = Database::fetchAll(
                "SELECT pd.*, (pd.seats_total - pd.seats_booked - pd.seats_held) AS seats_available,
                        ROUND(pd.seats_booked / NULLIF(pd.seats_total, 0) * 100, 1) AS fill_pct,
                        p.name AS package_name, p.code AS package_code, p.nights,
                        d.name AS destination_name, u.full_name AS tour_manager_name,
                        DATEDIFF(pd.departure_date, CURDATE()) AS days_to_departure
                   FROM package_departures pd
                   JOIN packages p      ON p.id = pd.package_id
                   LEFT JOIN destinations d ON d.id = p.destination_id
                   LEFT JOIN users u    ON u.id = pd.tour_manager_id
                  WHERE $where
                  ORDER BY pd.departure_date ASC
                  LIMIT $limit OFFSET $offset",
                $params
            );

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** POST /packages/{id}/publish */
    public function publish(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $pkg = Package::findOrFail($id);

            // Publishing a package with no itinerary or no rate makes it
            // unsellable and unquotable, so both are hard prerequisites.
            $dayCount = (int) Database::scalar('SELECT COUNT(*) FROM package_days WHERE package_id = ?', [$id]);
            if ($dayCount === 0) {
                throw new BusinessRuleException('Add the day-by-day itinerary before publishing');
            }

            $liveRates = (int) Database::scalar(
                'SELECT COUNT(*) FROM package_prices WHERE package_id = ? AND is_active = 1 AND valid_to >= CURDATE()',
                [$id]
            );
            if ($liveRates === 0) {
                throw new BusinessRuleException('Add at least one current rate slab before publishing');
            }

            Package::updateById($id, ['status' => 'active']);
            Audit::log('published', 'package', $id, ['status' => $pkg['status']], ['status' => 'active']);

            Response::success(Package::detail($id), 'Package published');
        });
    }

    /** POST /packages/{id}/archive */
    public function archive(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Package::findOrFail($id);

            $upcoming = (int) Database::scalar(
                "SELECT COUNT(*) FROM bookings
                  WHERE package_id = ? AND travel_from >= CURDATE() AND status NOT IN ('cancelled','completed')",
                [$id]
            );
            if ($upcoming > 0) {
                throw new BusinessRuleException("$upcoming upcoming booking(s) use this package. Archive it after they travel.");
            }

            Package::updateById($id, ['status' => 'archived']);
            Response::success(null, 'Package archived');
        });
    }

    private function payload(bool $creating): array
    {
        $required = $creating ? 'required' : 'nullable';

        return $this->validate(
            Request::only([
                'code', 'name', 'destination_id', 'package_type', 'scope', 'nights', 'days',
                'min_pax', 'max_pax', 'summary', 'description', 'inclusions', 'exclusions',
                'terms', 'cancellation_policy', 'hero_image', 'base_price_adult',
                'currency', 'markup_pct', 'gst_pct',
            ]),
            [
                'code'                => 'nullable|code|max:20',
                'name'                => "$required|string|max:200",
                'destination_id'      => "$required|int|min:1",
                'package_type'        => 'nullable|in:fixed_departure,customised,fit,group,honeymoon,pilgrimage,corporate,mice',
                'scope'               => 'nullable|in:domestic,international',
                'nights'              => 'nullable|int|min:0|max:60',
                'days'                => 'nullable|int|min:1|max:61',
                'min_pax'             => 'nullable|int|min:1|max:500',
                'max_pax'             => 'nullable|int|min:0|max:2000',
                'summary'             => 'nullable|string|max:500',
                'description'         => 'nullable|string|max:20000',
                'inclusions'          => 'nullable|string|max:8000',
                'exclusions'          => 'nullable|string|max:8000',
                'terms'               => 'nullable|string|max:8000',
                'cancellation_policy' => 'nullable|string|max:8000',
                'hero_image'          => 'nullable|string|max:255',
                'base_price_adult'    => 'nullable|money',
                'currency'            => 'nullable|string|max:3',
                'markup_pct'          => 'nullable|decimal|min:0|max:100',
                'gst_pct'             => 'nullable|decimal|min:0|max:100',
            ]
        );
    }
}
