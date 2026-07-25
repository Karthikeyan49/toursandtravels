<?php

class Lead extends Model
{
    protected const TABLE    = 'leads';
    protected const FILLABLE = [
        'lead_no', 'customer_id', 'contact_name', 'phone', 'email', 'city', 'source_id',
        'agency_id', 'destination_id', 'package_id', 'travel_date', 'travel_date_flexible',
        'nights', 'adults', 'children', 'infants', 'budget_min', 'budget_max',
        'requirement', 'status', 'previous_status', 'lost_reason', 'priority',
        'assigned_to', 'next_followup_at', 'last_contacted_at', 'converted_booking_id',
    ];
    protected const SORTABLE = ['id', 'lead_no', 'contact_name', 'travel_date', 'status', 'priority', 'created_at', 'next_followup_at'];

    /** Terminal states — a lead in one of these no longer appears on the pipeline board. */
    public const CLOSED_STATUSES = ['won', 'lost', 'dropped'];

    /** Allowed transitions. Anything else is a 409, not a silent write. */
    private const TRANSITIONS = [
        'new'         => ['contacted', 'quoted', 'dropped'],
        'contacted'   => ['quoted', 'negotiating', 'lost', 'dropped'],
        'quoted'      => ['negotiating', 'won', 'lost', 'dropped'],
        'negotiating' => ['quoted', 'won', 'lost', 'dropped'],
        'won'         => [],
        'lost'        => ['contacted'],   // re-open on a callback
        'dropped'     => ['contacted'],
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
            $clauses[] = ['(l.contact_name LIKE ? OR l.phone LIKE ? OR l.lead_no LIKE ? OR l.email LIKE ?)',
                          [$like, $like, $like, $like]];
        }
        if (!empty($filters['status'])) {
            $statuses = is_array($filters['status']) ? $filters['status'] : explode(',', (string) $filters['status']);
            $statuses = array_values(array_filter(array_map('trim', $statuses)));
            if ($statuses !== []) {
                $marks = implode(',', array_fill(0, count($statuses), '?'));
                $clauses[] = ["l.status IN ($marks)", $statuses];
            }
        }
        if (!empty($filters['open_only'])) {
            $clauses[] = ["l.status NOT IN ('won','lost','dropped')", []];
        }
        if (!empty($filters['priority'])) {
            $clauses[] = ['l.priority = ?', [$filters['priority']]];
        }
        if (!empty($filters['assigned_to'])) {
            $clauses[] = ['l.assigned_to = ?', [(int) $filters['assigned_to']]];
        }
        if (!empty($filters['destination_id'])) {
            $clauses[] = ['l.destination_id = ?', [(int) $filters['destination_id']]];
        }
        if (!empty($filters['source_id'])) {
            $clauses[] = ['l.source_id = ?', [(int) $filters['source_id']]];
        }
        if (!empty($filters['from'])) {
            $clauses[] = ['DATE(l.created_at) >= ?', [$filters['from']]];
        }
        if (!empty($filters['to'])) {
            $clauses[] = ['DATE(l.created_at) <= ?', [$filters['to']]];
        }
        // "Overdue" = a follow-up was scheduled and the time has passed.
        if (!empty($filters['overdue'])) {
            $clauses[] = ["l.next_followup_at IS NOT NULL AND l.next_followup_at < NOW()
                           AND l.status NOT IN ('won','lost','dropped')", []];
        }

        [$scopeSql, $scopeParams] = AuthMiddleware::agencyScope('l.agency_id');
        $clauses[] = [$scopeSql, $scopeParams];

        [$where, $params] = self::buildWhere($clauses);
        $total = (int) Database::scalar("SELECT COUNT(*) FROM leads l WHERE $where", $params);

        $sortCol = self::assertSortable($sort, 'created_at');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            "SELECT l.*, d.name AS destination_name, p.name AS package_name,
                    ls.name AS source_name, u.full_name AS assigned_to_name,
                    (SELECT COUNT(*) FROM lead_followups f WHERE f.lead_id = l.id) AS followup_count,
                    (SELECT COUNT(*) FROM quotations q WHERE q.lead_id = l.id) AS quote_count,
                    TIMESTAMPDIFF(HOUR, COALESCE(l.last_contacted_at, l.created_at), NOW()) AS hours_since_contact
               FROM leads l
               LEFT JOIN destinations  d  ON d.id  = l.destination_id
               LEFT JOIN packages      p  ON p.id  = l.package_id
               LEFT JOIN lead_sources  ls ON ls.id = l.source_id
               LEFT JOIN users         u  ON u.id  = l.assigned_to
              WHERE $where
              ORDER BY l.$sortCol $sortDir
              LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }

    public static function detail(int $id): ?array
    {
        $lead = Database::fetch(
            'SELECT l.*, d.name AS destination_name, p.name AS package_name,
                    ls.name AS source_name, u.full_name AS assigned_to_name,
                    c.full_name AS customer_name, c.code AS customer_code
               FROM leads l
               LEFT JOIN destinations d  ON d.id  = l.destination_id
               LEFT JOIN packages     p  ON p.id  = l.package_id
               LEFT JOIN lead_sources ls ON ls.id = l.source_id
               LEFT JOIN users        u  ON u.id  = l.assigned_to
               LEFT JOIN customers    c  ON c.id  = l.customer_id
              WHERE l.id = ? LIMIT 1',
            [$id]
        );
        if ($lead === null) {
            return null;
        }

        $lead['followups'] = Database::fetchAll(
            'SELECT f.*, u.full_name AS actor_name
               FROM lead_followups f
               LEFT JOIN users u ON u.id = f.actor_id
              WHERE f.lead_id = ? ORDER BY f.done_at DESC, f.id DESC',
            [$id]
        );

        $lead['quotations'] = Database::fetchAll(
            'SELECT id, quote_no, version, quote_date, valid_until, grand_total, status
               FROM quotations WHERE lead_id = ? ORDER BY version DESC, id DESC',
            [$id]
        );

        return $lead;
    }

    /** Pipeline board: counts and value by status. */
    public static function pipeline(array $filters = []): array
    {
        $clauses = [['1=1', []]];
        if (!empty($filters['assigned_to'])) {
            $clauses[] = ['assigned_to = ?', [(int) $filters['assigned_to']]];
        }
        if (!empty($filters['from'])) {
            $clauses[] = ['DATE(created_at) >= ?', [$filters['from']]];
        }
        if (!empty($filters['to'])) {
            $clauses[] = ['DATE(created_at) <= ?', [$filters['to']]];
        }
        [$where, $params] = self::buildWhere($clauses);

        return Database::fetchAll(
            "SELECT status,
                    COUNT(*) AS lead_count,
                    COALESCE(SUM(budget_max), 0) AS potential_value,
                    SUM(adults + children) AS total_pax
               FROM leads WHERE $where
              GROUP BY status",
            $params
        );
    }

    /** Leads with no follow-up logged within the configured idle window. */
    public static function idle(int $hours, int $limit = 100): array
    {
        return Database::fetchAll(
            "SELECT l.id, l.lead_no, l.contact_name, l.phone, l.status, l.priority,
                    l.assigned_to, u.full_name AS assigned_to_name,
                    COALESCE(l.last_contacted_at, l.created_at) AS last_touch,
                    TIMESTAMPDIFF(HOUR, COALESCE(l.last_contacted_at, l.created_at), NOW()) AS idle_hours
               FROM leads l
               LEFT JOIN users u ON u.id = l.assigned_to
              WHERE l.status NOT IN ('won','lost','dropped')
                AND TIMESTAMPDIFF(HOUR, COALESCE(l.last_contacted_at, l.created_at), NOW()) >= ?
              ORDER BY idle_hours DESC
              LIMIT " . (int) $limit,
            [$hours]
        );
    }

    public static function touch(int $leadId, ?string $nextDueAt): void
    {
        Database::execute(
            'UPDATE leads SET last_contacted_at = NOW(), next_followup_at = ? WHERE id = ?',
            [$nextDueAt, $leadId]
        );
    }
}
