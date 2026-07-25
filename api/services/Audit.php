<?php
/**
 * Audit trail.
 *
 * Every write in the application calls this. Failures are swallowed on purpose:
 * a full disk or a locked audit table must never take down a booking save.
 */
class Audit
{
    public static function log(
        string $action,
        string $entityType,
        ?int $entityId = null,
        ?array $old = null,
        ?array $new = null,
        ?string $note = null
    ): void {
        try {
            Database::execute(
                'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value, note, ip_address)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    Request::userId(),
                    $action,
                    $entityType,
                    $entityId,
                    $old !== null ? self::encode(self::redact($old)) : null,
                    $new !== null ? self::encode(self::redact($new)) : null,
                    $note !== null ? mb_substr($note, 0, 255) : null,
                    Request::ip(),
                ]
            );
        } catch (Throwable $e) {
            error_log('[audit] write failed: ' . $e->getMessage());
        }
    }

    /** Record only the columns that actually changed — keeps the log readable. */
    public static function logDiff(string $action, string $entityType, int $entityId, array $before, array $after, ?string $note = null): void
    {
        $oldDiff = [];
        $newDiff = [];
        foreach ($after as $k => $v) {
            $prev = $before[$k] ?? null;
            if ((string) $prev !== (string) $v) {
                $oldDiff[$k] = $prev;
                $newDiff[$k] = $v;
            }
        }
        if ($newDiff === []) {
            return;
        }
        self::log($action, $entityType, $entityId, $oldDiff, $newDiff, $note);
    }

    /** Authorization denials are audited — they are the signal that matters most. */
    public static function denied(string $guard, string $reason): void
    {
        self::log('permission_denied', 'route', null, null, [
            'method' => Request::method(),
            'path'   => Request::path(),
            'guard'  => $guard,
            'reason' => $reason,
        ]);
    }

    private const REDACTED = ['password', 'password_hash', 'token', 'refresh_token', 'token_hash', 'jwt_secret', 'otp_code'];

    private static function redact(array $data): array
    {
        foreach ($data as $k => $v) {
            if (in_array(strtolower((string) $k), self::REDACTED, true)) {
                $data[$k] = '***';
            }
        }
        return $data;
    }

    private static function encode(array $data): string
    {
        return (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Read the trail for one entity — powers the "History" tab on every record. */
    public static function forEntity(string $entityType, int $entityId, int $limit = 100): array
    {
        return Database::fetchAll(
            'SELECT a.id, a.action, a.old_value, a.new_value, a.note, a.created_at,
                    u.full_name AS actor_name
               FROM audit_log a
               LEFT JOIN users u ON u.id = a.user_id
              WHERE a.entity_type = ? AND a.entity_id = ?
              ORDER BY a.created_at DESC, a.id DESC
              LIMIT ' . (int) $limit,
            [$entityType, $entityId]
        );
    }
}
