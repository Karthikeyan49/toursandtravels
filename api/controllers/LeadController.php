<?php

class LeadController extends Controller
{
    /** GET /leads */
    public function index(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            $filters = [
                'search'         => Request::query('search'),
                'status'         => Request::query('status'),
                'open_only'      => Request::queryBool('open_only'),
                'priority'       => Request::query('priority'),
                'assigned_to'    => Request::query('assigned_to'),
                'destination_id' => Request::query('destination_id'),
                'source_id'      => Request::query('source_id'),
                'from'           => Request::query('from'),
                'to'             => Request::query('to'),
                'overdue'        => Request::queryBool('overdue'),
            ];

            [$rows, $total] = Lead::paginate($filters, $limit, $offset, Request::query('sort'), Request::query('dir'));
            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** GET /leads/{id} */
    public function show(): void
    {
        $this->run(function () {
            $lead = Lead::detail(Request::paramInt('id'));
            if ($lead === null) {
                Response::notFound('Lead not found');
                return;
            }
            Response::success($lead);
        });
    }

    /** POST /leads */
    public function store(): void
    {
        $this->run(function () {
            $input = Request::only([
                'contact_name', 'phone', 'email', 'city', 'source_id', 'agency_id',
                'destination_id', 'package_id', 'travel_date', 'travel_date_flexible',
                'nights', 'adults', 'children', 'infants', 'budget_min', 'budget_max',
                'requirement', 'priority', 'assigned_to', 'next_followup_at', 'customer_id',
            ]);

            $data = $this->validate($input, [
                'contact_name'   => 'required|string|max:150',
                'phone'          => 'required|phone',
                'email'          => 'nullable|email',
                'city'           => 'nullable|string|max:120',
                'source_id'      => 'nullable|int',
                'agency_id'      => 'nullable|int',
                'destination_id' => 'nullable|int',
                'package_id'     => 'nullable|int',
                'travel_date'    => 'nullable|date',
                'travel_date_flexible' => 'nullable|bool',
                'nights'         => 'nullable|int|min:0|max:120',
                'adults'         => 'nullable|int|min:1|max:200',
                'children'       => 'nullable|int|min:0|max:200',
                'infants'        => 'nullable|int|min:0|max:100',
                'budget_min'     => 'nullable|money',
                'budget_max'     => 'nullable|money',
                'requirement'    => 'nullable|string|max:4000',
                'priority'       => 'nullable|in:low,medium,high,hot',
                'assigned_to'    => 'nullable|int',
                'next_followup_at' => 'nullable|datetime',
                'customer_id'    => 'nullable|int',
            ]);

            if (isset($data['budget_min'], $data['budget_max'])
                && Money::greaterThan($data['budget_min'], $data['budget_max'])) {
                throw new ValidationException(['budget_max' => ['Maximum budget cannot be below the minimum']]);
            }

            // Link to an existing customer automatically when the phone matches —
            // repeat enquiries should not create orphan records.
            if (empty($data['customer_id'])) {
                $existing = Customer::findByPhone($data['phone']);
                if ($existing !== null) {
                    $data['customer_id'] = (int) $existing['id'];
                }
            }

            $data['lead_no'] = NumberSequence::next('LEAD');
            $data['status']  = 'new';
            $data['adults']  = $data['adults'] ?? 1;
            $data['assigned_to'] = $data['assigned_to'] ?? Request::userId();

            $id = Lead::create($data);
            Audit::log('create', 'lead', $id, null, ['lead_no' => $data['lead_no']]);

            Response::created(Lead::detail($id), 'Enquiry captured');
        });
    }

    /** PUT /leads/{id} */
    public function update(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $before = Lead::findOrFail($id);

            if (in_array($before['status'], ['won'], true)) {
                throw new BusinessRuleException('A converted lead can no longer be edited');
            }

            $input = Request::only([
                'contact_name', 'phone', 'email', 'city', 'source_id', 'destination_id',
                'package_id', 'travel_date', 'travel_date_flexible', 'nights', 'adults',
                'children', 'infants', 'budget_min', 'budget_max', 'requirement',
                'priority', 'assigned_to', 'next_followup_at', 'customer_id',
            ]);

            $data = $this->validate($input, [
                'contact_name'   => 'nullable|string|max:150',
                'phone'          => 'nullable|phone',
                'email'          => 'nullable|email',
                'city'           => 'nullable|string|max:120',
                'source_id'      => 'nullable|int',
                'destination_id' => 'nullable|int',
                'package_id'     => 'nullable|int',
                'travel_date'    => 'nullable|date',
                'travel_date_flexible' => 'nullable|bool',
                'nights'         => 'nullable|int|min:0|max:120',
                'adults'         => 'nullable|int|min:1|max:200',
                'children'       => 'nullable|int|min:0|max:200',
                'infants'        => 'nullable|int|min:0|max:100',
                'budget_min'     => 'nullable|money',
                'budget_max'     => 'nullable|money',
                'requirement'    => 'nullable|string|max:4000',
                'priority'       => 'nullable|in:low,medium,high,hot',
                'assigned_to'    => 'nullable|int',
                'next_followup_at' => 'nullable|datetime',
                'customer_id'    => 'nullable|int',
            ]);

            Lead::updateById($id, $data);
            Audit::logDiff('update', 'lead', $id, $before, $data);

            Response::success(Lead::detail($id), 'Lead updated');
        });
    }

    /** POST /leads/{id}/status */
    public function changeStatus(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $to = (string) Request::input('status', '');

            $lead = Lead::findOrFail($id);

            if (!Lead::canTransition($lead['status'], $to)) {
                throw new BusinessRuleException(
                    'Cannot move a lead from "' . $lead['status'] . '" to "' . $to . '"'
                );
            }
            if (in_array($to, ['lost', 'dropped'], true) && trim((string) Request::input('reason', '')) === '') {
                throw new ValidationException(['reason' => ['A reason is required when closing a lead']]);
            }

            Lead::updateById($id, [
                'previous_status' => $lead['status'],
                'status'          => $to,
                'lost_reason'     => in_array($to, ['lost', 'dropped'], true)
                    ? mb_substr((string) Request::input('reason'), 0, 255) : null,
            ]);

            Database::insert('workflow_history', [
                'entity_type' => 'lead', 'entity_id' => $id,
                'from_status' => $lead['status'], 'to_status' => $to,
                'note'        => Request::input('reason'), 'actor_id' => Request::userId(),
            ], ['entity_type', 'entity_id', 'from_status', 'to_status', 'note', 'actor_id']);

            Response::success(Lead::detail($id), 'Lead marked ' . $to);
        });
    }

    /** POST /leads/{id}/followups */
    public function addFollowup(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Lead::findOrFail($id);

            $data = $this->validate(
                Request::only(['channel', 'direction', 'outcome', 'note', 'next_action', 'next_due_at', 'done_at']),
                [
                    'channel'     => 'nullable|in:call,whatsapp,email,meeting,sms,other',
                    'direction'   => 'nullable|in:outbound,inbound',
                    'outcome'     => 'nullable|in:connected,no_answer,busy,interested,not_interested,callback,quoted,closed',
                    'note'        => 'nullable|string|max:1000',
                    'next_action' => 'nullable|string|max:255',
                    'next_due_at' => 'nullable|datetime',
                    'done_at'     => 'nullable|datetime',
                ]
            );

            $followupId = Database::transaction(static function () use ($id, $data) {
                $fid = Database::insert('lead_followups', [
                    'lead_id'     => $id,
                    'channel'     => $data['channel']   ?? 'call',
                    'direction'   => $data['direction'] ?? 'outbound',
                    'outcome'     => $data['outcome']   ?? 'connected',
                    'note'        => $data['note']        ?? null,
                    'next_action' => $data['next_action'] ?? null,
                    'next_due_at' => $data['next_due_at'] ?? null,
                    'done_at'     => $data['done_at'] ?? date('Y-m-d H:i:s'),
                    'actor_id'    => Request::userId(),
                ], ['lead_id', 'channel', 'direction', 'outcome', 'note', 'next_action', 'next_due_at', 'done_at', 'actor_id']);

                Lead::touch($id, $data['next_due_at'] ?? null);

                // A "new" lead becomes "contacted" the moment it is worked.
                Database::execute(
                    "UPDATE leads SET previous_status = status, status = 'contacted'
                      WHERE id = ? AND status = 'new'",
                    [$id]
                );

                return $fid;
            });

            Audit::log('followup', 'lead', $id, null, ['followup_id' => $followupId]);
            Response::created(Lead::detail($id), 'Follow-up logged');
        });
    }

    /** GET /leads/pipeline */
    public function pipeline(): void
    {
        $this->run(function () {
            $rows = Lead::pipeline([
                'assigned_to' => Request::query('assigned_to'),
                'from'        => Request::query('from'),
                'to'          => Request::query('to'),
            ]);

            // Present every status, including empty ones, so the board is stable.
            $order = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost', 'dropped'];
            $byStatus = array_column($rows, null, 'status');

            $board = array_map(static fn($s) => [
                'status'          => $s,
                'lead_count'      => (int)   ($byStatus[$s]['lead_count'] ?? 0),
                'potential_value' => (float) ($byStatus[$s]['potential_value'] ?? 0),
                'total_pax'       => (int)   ($byStatus[$s]['total_pax'] ?? 0),
            ], $order);

            $open = array_filter($board, static fn($c) => !in_array($c['status'], Lead::CLOSED_STATUSES, true));
            $won  = (int) ($byStatus['won']['lead_count'] ?? 0);
            $lost = (int) ($byStatus['lost']['lead_count'] ?? 0);

            Response::success([
                'board'       => $board,
                'open_count'  => array_sum(array_column($open, 'lead_count')),
                'win_rate'    => ($won + $lost) > 0 ? round($won / ($won + $lost) * 100, 1) : 0.0,
                'overdue'     => Lead::idle(Setting::int('lead_idle_alert_hours', 48), 25),
            ]);
        });
    }

    /** GET /leads/sources */
    public function sources(): void
    {
        $this->run(static function () {
            Response::success(Database::fetchAll(
                'SELECT id, name, is_paid FROM lead_sources WHERE is_active = 1 ORDER BY name ASC'
            ));
        });
    }

    /** POST /leads/{id}/convert-customer — promote an enquirer to a customer record. */
    public function convertToCustomer(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            $lead = Lead::findOrFail($id);

            if (!empty($lead['customer_id'])) {
                Response::success(Customer::find((int) $lead['customer_id']), 'Lead is already linked to a customer');
                return;
            }

            $customerId = Database::transaction(static function () use ($lead) {
                $existing = Customer::findByPhone((string) $lead['phone']);
                if ($existing !== null) {
                    return (int) $existing['id'];
                }

                return Customer::create([
                    'code'      => Customer::nextCode(),
                    'full_name' => $lead['contact_name'],
                    'phone'     => $lead['phone'],
                    'email'     => $lead['email'],
                    'city'      => $lead['city'],
                    'agency_id' => $lead['agency_id'],
                    'source'    => 'lead:' . $lead['lead_no'],
                ]);
            });

            Lead::updateById($id, ['customer_id' => $customerId]);
            Audit::log('lead_converted_customer', 'lead', $id, null, ['customer_id' => $customerId]);

            Response::success(Customer::find($customerId), 'Customer record created');
        });
    }
}
