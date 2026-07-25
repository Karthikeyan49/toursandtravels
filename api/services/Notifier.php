<?php
/**
 * Notification writer.
 *
 * Writes to the `notifications` table, which the UI polls. Outbound channels
 * (email / SMS / WhatsApp) are pluggable: configure a provider in settings and
 * implement send() — until then, everything is in-app only and nothing silently
 * fails to reach anyone.
 *
 * Every method here is best-effort. A notification failure must never roll back
 * the business transaction that triggered it.
 */
class Notifier
{
    public static function push(
        string $kind,
        string $title,
        ?string $body = null,
        ?int $userId = null,
        ?string $roleScope = null,
        ?string $entityType = null,
        ?int $entityId = null,
        string $severity = 'info'
    ): void {
        try {
            Database::insert('notifications', [
                'user_id'     => $userId,
                'role_scope'  => $roleScope,
                'kind'        => $kind,
                'title'       => mb_substr($title, 0, 160),
                'body'        => $body !== null ? mb_substr($body, 0, 500) : null,
                'entity_type' => $entityType,
                'entity_id'   => $entityId,
                'severity'    => in_array($severity, ['info', 'warning', 'critical'], true) ? $severity : 'info',
            ], ['user_id', 'role_scope', 'kind', 'title', 'body', 'entity_type', 'entity_id', 'severity']);
        } catch (Throwable $e) {
            error_log('[notify] ' . $e->getMessage());
        }
    }

    public static function bookingConfirmed(int $bookingId): void
    {
        $b = Database::fetch(
            'SELECT b.booking_no, b.travel_from, b.grand_total, c.full_name
               FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
              WHERE b.id = ?',
            [$bookingId]
        );
        if ($b === null) {
            return;
        }

        self::push(
            'booking_confirmed',
            'Booking ' . $b['booking_no'] . ' confirmed',
            sprintf('%s · departs %s · %s', $b['full_name'] ?? '', $b['travel_from'], number_format((float) $b['grand_total'], 2)),
            null, 'operations', 'booking', $bookingId
        );
    }

    public static function paymentOverdue(int $bookingId, float $outstanding, int $daysToDeparture): void
    {
        $bookingNo = Database::scalar('SELECT booking_no FROM bookings WHERE id = ?', [$bookingId]);
        self::push(
            'payment_due',
            'Balance outstanding on ' . $bookingNo,
            sprintf('%s outstanding, departure in %d day(s)', number_format($outstanding, 2), $daysToDeparture),
            null, 'accounts', 'booking', $bookingId,
            $daysToDeparture <= 3 ? 'critical' : 'warning'
        );
    }

    public static function documentExpiring(int $bookingId, string $paxName, string $detail): void
    {
        self::push(
            'doc_expiring',
            'Document issue — ' . $paxName,
            $detail,
            null, 'visa', 'booking', $bookingId, 'warning'
        );
    }

    public static function leadIdle(array $lead): void
    {
        self::push(
            'lead_idle',
            'No follow-up on ' . $lead['lead_no'],
            sprintf('%s · %s · idle %d hours', $lead['contact_name'], $lead['phone'], (int) $lead['idle_hours']),
            !empty($lead['assigned_to']) ? (int) $lead['assigned_to'] : null,
            'sales', 'lead', (int) $lead['id'], 'warning'
        );
    }

    public static function departureSoon(int $bookingId, string $bookingNo, int $days): void
    {
        self::push(
            'departure_soon',
            $bookingNo . ' departs in ' . $days . ' day(s)',
            'Confirm supplier services and issue vouchers.',
            null, 'operations', 'booking', $bookingId,
            $days <= 2 ? 'critical' : 'info'
        );
    }

    /**
     * Password reset delivery.
     *
     * No mail provider is configured out of the box, so the token is written to
     * the error log for the operator to pick up during setup rather than being
     * dropped silently or — worse — returned in the HTTP response.
     */
    public static function passwordReset(array $user, string $token): void
    {
        $appUrl = (string) Config::get('app.url', '');
        $link   = $appUrl !== '' ? rtrim($appUrl, '/') . '/reset-password?token=' . $token : '(set APP_URL to build a link)';

        error_log(sprintf('[password-reset] user=%d link=%s', (int) $user['id'], $link));

        self::push(
            'password_reset',
            'Password reset requested',
            'A reset link was generated for ' . ($user['email'] ?? $user['phone'] ?? 'this account'),
            (int) $user['id'], null, 'user', (int) $user['id']
        );
    }

    /** @return array{0:array,1:int} inbox for the current user + their role */
    public static function inbox(int $userId, ?string $role, bool $unreadOnly, int $limit, int $offset): array
    {
        $clauses = [['(n.user_id = ? OR (n.user_id IS NULL AND n.role_scope = ?))', [$userId, $role]]];
        if ($unreadOnly) {
            $clauses[] = ['n.read_at IS NULL', []];
        }
        $sql = [];
        $params = [];
        foreach ($clauses as [$frag, $bind]) {
            $sql[] = $frag;
            foreach ($bind as $b) {
                $params[] = $b;
            }
        }
        $where = implode(' AND ', $sql);

        $total = (int) Database::scalar("SELECT COUNT(*) FROM notifications n WHERE $where", $params);
        $rows  = Database::fetchAll(
            "SELECT n.* FROM notifications n WHERE $where ORDER BY n.created_at DESC LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }
}
