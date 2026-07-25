<?php

class User extends Model
{
    protected const TABLE    = 'users';
    protected const FILLABLE = [
        'full_name', 'email', 'phone', 'password_hash', 'user_type', 'staff_role',
        'agency_id', 'avatar_path', 'is_active', 'must_change_pw',
    ];
    protected const SORTABLE = ['id', 'full_name', 'email', 'user_type', 'created_at', 'last_login_at'];

    /** Columns safe to return to a client. Never `password_hash`. */
    private const PUBLIC_COLUMNS = 'id, full_name, email, phone, user_type, staff_role, agency_id,
                                    avatar_path, is_active, last_login_at, must_change_pw, created_at';

    public static function findPublic(int $id): ?array
    {
        return Database::fetch('SELECT ' . self::PUBLIC_COLUMNS . ' FROM users WHERE id = ? LIMIT 1', [$id]);
    }

    /** Login lookup accepts either an email or a phone number. */
    public static function findByIdentifier(string $identifier): ?array
    {
        $column = filter_var($identifier, FILTER_VALIDATE_EMAIL) ? 'email' : 'phone';
        return Database::fetch(
            "SELECT id, full_name, email, phone, password_hash, user_type, staff_role, agency_id,
                    is_active, failed_logins, locked_until, must_change_pw
               FROM users WHERE $column = ? LIMIT 1",
            [$identifier]
        );
    }

    public static function emailTaken(string $email, ?int $exceptId = null): bool
    {
        $sql = 'SELECT 1 FROM users WHERE email = ?';
        $params = [$email];
        if ($exceptId !== null) {
            $sql .= ' AND id <> ?';
            $params[] = $exceptId;
        }
        return Database::scalar($sql . ' LIMIT 1', $params) !== null;
    }

    public static function phoneTaken(string $phone, ?int $exceptId = null): bool
    {
        $sql = 'SELECT 1 FROM users WHERE phone = ?';
        $params = [$phone];
        if ($exceptId !== null) {
            $sql .= ' AND id <> ?';
            $params[] = $exceptId;
        }
        return Database::scalar($sql . ' LIMIT 1', $params) !== null;
    }

    public static function hash(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT, ['cost' => (int) Config::get('security.bcrypt_cost', 12)]);
    }

    public static function isLocked(array $user): bool
    {
        return !empty($user['locked_until']) && strtotime((string) $user['locked_until']) > time();
    }

    public static function registerFailedLogin(int $userId): void
    {
        $max     = (int) Config::get('security.max_failed_logins', 5);
        $minutes = (int) Config::get('security.lockout_minutes', 15);

        Database::execute(
            'UPDATE users
                SET failed_logins = failed_logins + 1,
                    locked_until  = IF(failed_logins + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), locked_until)
              WHERE id = ?',
            [$max, $minutes, $userId]
        );
    }

    public static function registerSuccessfulLogin(int $userId): void
    {
        Database::execute(
            'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?',
            [$userId]
        );
    }

    public static function setPassword(int $userId, string $plain): void
    {
        Database::execute(
            'UPDATE users SET password_hash = ?, must_change_pw = 0, failed_logins = 0, locked_until = NULL WHERE id = ?',
            [self::hash($plain), $userId]
        );
        // Any password change invalidates every outstanding refresh token.
        Database::execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [$userId]);
    }

    /** @return array{0:array, 1:int} rows and total */
    public static function paginate(array $filters, int $limit, int $offset, ?string $sort, ?string $dir): array
    {
        $clauses = [['1=1', []]];

        if (!empty($filters['search'])) {
            $like = '%' . $filters['search'] . '%';
            $clauses[] = ['(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)', [$like, $like, $like]];
        }
        if (!empty($filters['user_type'])) {
            $clauses[] = ['user_type = ?', [$filters['user_type']]];
        }
        if (!empty($filters['staff_role'])) {
            $clauses[] = ['staff_role = ?', [$filters['staff_role']]];
        }
        if (isset($filters['is_active'])) {
            $clauses[] = ['is_active = ?', [(int) $filters['is_active']]];
        }

        [$where, $params] = self::buildWhere($clauses);
        $total = (int) Database::scalar("SELECT COUNT(*) FROM users WHERE $where", $params);

        $sortCol = self::assertSortable($sort, 'created_at');
        $sortDir = self::sortDirection($dir);

        $rows = Database::fetchAll(
            'SELECT ' . self::PUBLIC_COLUMNS . " FROM users WHERE $where ORDER BY $sortCol $sortDir LIMIT $limit OFFSET $offset",
            $params
        );

        return [$rows, $total];
    }
}
