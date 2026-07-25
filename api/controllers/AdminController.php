<?php
/**
 * Owner-only administration: user accounts, settings, numbering and the audit log.
 *
 * `password_hash` never leaves this file — every read goes through
 * User::findPublic() / User::paginate(), which select an explicit column list.
 */
class AdminController extends Controller
{
    /** Settings an operator may change through the API. Anything else is code. */
    private const WRITABLE_SETTING_PREFIXES = ['company_', 'bank_', 'default_', 'seq_'];

    private const WRITABLE_SETTINGS = [
        'iata_number', 'quote_validity_days', 'advance_percent', 'balance_due_days_before',
        'lead_idle_alert_hours', 'passport_expiry_alert_days', 'hold_expiry_hours',
    ];

    // --- Users --------------------------------------------------------------

    /** GET /users */
    public function users(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            [$rows, $total] = User::paginate([
                'search'     => Request::query('search'),
                'user_type'  => Request::query('user_type'),
                'staff_role' => Request::query('staff_role'),
                'is_active'  => Request::queryBool('is_active'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** GET /users/{id} */
    public function showUser(): void
    {
        $this->run(function () {
            $user = User::findPublic(Request::paramInt('id'));
            if ($user === null) {
                Response::notFound('User not found');
                return;
            }
            Response::success($user);
        });
    }

    /** POST /users */
    public function storeUser(): void
    {
        $this->run(function () {
            $data = $this->validate(
                Request::only(['full_name', 'email', 'phone', 'password', 'user_type', 'staff_role', 'agency_id']),
                [
                    'full_name'  => 'required|string|max:150',
                    'email'      => 'nullable|email|max:190',
                    'phone'      => 'nullable|phone',
                    'password'   => 'nullable|string|min:' . (int) Config::get('security.password_min_length', 8) . '|max:200',
                    'user_type'  => 'required|in:staff,agent,customer',
                    'staff_role' => 'nullable|in:' . implode(',', AuthMiddleware::ROLES),
                    'agency_id'  => 'nullable|int|min:1',
                ]
            );

            // Login is by email or phone, so at least one must exist and be unique.
            if (empty($data['email']) && empty($data['phone'])) {
                throw new ValidationException(['email' => ['Provide an email address or a phone number']]);
            }
            if (!empty($data['email']) && User::emailTaken($data['email'])) {
                throw new ValidationException(['email' => ['That email address is already registered']]);
            }
            if (!empty($data['phone']) && User::phoneTaken($data['phone'])) {
                throw new ValidationException(['phone' => ['That phone number is already registered']]);
            }
            if ($data['user_type'] === 'staff' && empty($data['staff_role'])) {
                throw new ValidationException(['staff_role' => ['A staff user needs a role']]);
            }
            if ($data['user_type'] === 'agent' && empty($data['agency_id'])) {
                throw new ValidationException(['agency_id' => ['An agent user must belong to an agency']]);
            }
            if (!empty($data['agency_id'])
                && Database::scalar('SELECT 1 FROM agencies WHERE id = ? AND is_deleted = 0 LIMIT 1', [(int) $data['agency_id']]) === null) {
                throw new ValidationException(['agency_id' => ['Agency not found']]);
            }

            // A generated password is returned exactly once, in this response, and
            // the account is forced to change it on first login.
            $generated = empty($data['password']) ? self::randomPassword() : null;
            $plain     = $data['password'] ?? $generated;

            $id = Database::transaction(static function () use ($data, $plain, $generated) {
                $newId = User::create([
                    'full_name'      => $data['full_name'],
                    'email'          => $data['email'] ?? null,
                    'phone'          => $data['phone'] ?? null,
                    'password_hash'  => User::hash($plain),
                    'user_type'      => $data['user_type'],
                    'staff_role'     => $data['user_type'] === 'staff' ? ($data['staff_role'] ?? null) : null,
                    'agency_id'      => !empty($data['agency_id']) ? (int) $data['agency_id'] : null,
                    'is_active'      => 1,
                    'must_change_pw' => $generated !== null ? 1 : 0,
                ]);

                Audit::log('create', 'user', $newId, null, [
                    'full_name'  => $data['full_name'],
                    'user_type'  => $data['user_type'],
                    'staff_role' => $data['staff_role'] ?? null,
                ]);

                return $newId;
            });

            Response::created([
                'user'                => User::findPublic($id),
                'temporary_password'  => $generated,
            ], $generated !== null
                ? 'User created. Share the temporary password securely — it is shown only once.'
                : 'User created');
        });
    }

    /** PUT /users/{id} */
    public function updateUser(): void
    {
        $this->run(function () {
            $id     = Request::paramInt('id');
            $before = User::findOrFail($id);

            $data = $this->validate(
                Request::only(['full_name', 'email', 'phone', 'staff_role', 'agency_id', 'is_active']),
                [
                    'full_name'  => 'nullable|string|max:150',
                    'email'      => 'nullable|email|max:190',
                    'phone'      => 'nullable|phone',
                    'staff_role' => 'nullable|in:' . implode(',', AuthMiddleware::ROLES),
                    'agency_id'  => 'nullable|int|min:1',
                    'is_active'  => 'nullable|bool',
                ]
            );

            if (!empty($data['email']) && User::emailTaken($data['email'], $id)) {
                throw new ValidationException(['email' => ['That email address is already registered']]);
            }
            if (!empty($data['phone']) && User::phoneTaken($data['phone'], $id)) {
                throw new ValidationException(['phone' => ['That phone number is already registered']]);
            }

            // Do not let the last active owner demote or disable themselves — that
            // locks everyone out of administration permanently.
            $losingOwner = (array_key_exists('staff_role', $data) && $data['staff_role'] !== 'owner')
                || (array_key_exists('is_active', $data) && (int) $data['is_active'] === 0);

            if ($before['staff_role'] === 'owner' && $losingOwner && $this->activeOwnerCount() <= 1) {
                throw new BusinessRuleException('This is the last active owner account — assign another owner first');
            }

            Database::transaction(static function () use ($id, $before, $data) {
                User::updateById($id, $data);
                Audit::logDiff('update', 'user', $id, $before, $data);
            });

            Response::success(User::findPublic($id), 'User updated');
        });
    }

    /** POST /users/{id}/deactivate */
    public function deactivateUser(): void
    {
        $this->run(function () {
            $id   = Request::paramInt('id');
            $user = User::findOrFail($id);

            if ((int) $user['is_active'] === 0) {
                throw new BusinessRuleException('User is already deactivated');
            }
            if ((int) $id === (int) Request::userId()) {
                throw new BusinessRuleException('You cannot deactivate your own account');
            }
            if ($user['staff_role'] === 'owner' && $this->activeOwnerCount() <= 1) {
                throw new BusinessRuleException('This is the last active owner account — assign another owner first');
            }

            Database::transaction(static function () use ($id) {
                Database::execute('UPDATE users SET is_active = 0 WHERE id = ?', [$id]);
                // Kill every live session immediately rather than waiting out the
                // access-token TTL.
                Database::execute(
                    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
                    [$id]
                );
                Audit::log('deactivate', 'user', $id);
            });

            Response::success(User::findPublic($id), 'User deactivated and sessions revoked');
        });
    }

    /** POST /users/{id}/activate */
    public function activateUser(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            User::findOrFail($id);

            Database::execute('UPDATE users SET is_active = 1, failed_logins = 0, locked_until = NULL WHERE id = ?', [$id]);
            Audit::log('activate', 'user', $id);

            Response::success(User::findPublic($id), 'User reactivated');
        });
    }

    /** POST /users/{id}/reset-password */
    public function resetUserPassword(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            User::findOrFail($id);

            $data = $this->validate(Request::only(['password']), [
                'password' => 'nullable|string|min:' . (int) Config::get('security.password_min_length', 8) . '|max:200',
            ]);

            $generated = empty($data['password']) ? self::randomPassword() : null;
            $plain     = $data['password'] ?? $generated;

            Database::transaction(static function () use ($id, $plain) {
                // setPassword() also revokes every refresh token for the account.
                User::setPassword($id, $plain);
                Database::execute('UPDATE users SET must_change_pw = 1 WHERE id = ?', [$id]);
                Audit::log('password_reset_by_admin', 'user', $id);
            });

            Response::success([
                'user'               => User::findPublic($id),
                'temporary_password' => $generated,
            ], 'Password reset. The user must change it at next sign-in.');
        });
    }

    // --- Settings -----------------------------------------------------------

    /** GET /settings */
    public function settings(): void
    {
        $this->run(static function () {
            $all = Setting::all();

            $rows = [];
            foreach ($all as $key => $row) {
                $rows[] = [
                    'key'         => $key,
                    'value'       => Setting::get($key),
                    'type'        => $row['value_type'],
                    'description' => $row['description'],
                    'is_public'   => (int) $row['is_public'] === 1,
                    'updated_at'  => $row['updated_at'] ?? null,
                ];
            }

            Response::success([
                'settings' => $rows,
                'map'      => Setting::map(),
                'company'  => Setting::companyProfile(),
            ]);
        });
    }

    /**
     * PUT /settings  body {settings: {key: value, ...}}
     * Only known keys are written (Setting::put refuses anything else) and only
     * keys on the writable list are accepted, so the key space stays closed.
     */
    public function updateSettings(): void
    {
        $this->run(function () {
            $input = Request::input('settings');
            if (!is_array($input) || $input === []) {
                throw new ValidationException(['settings' => ['Provide a settings object']]);
            }
            if (count($input) > 100) {
                throw new ValidationException(['settings' => ['Too many settings in one request']]);
            }

            $known   = Setting::all();
            $updated = [];
            $ignored = [];
            $before  = Setting::map();

            foreach ($input as $key => $value) {
                $key = (string) $key;

                if (!array_key_exists($key, $known) || !$this->isWritable($key)) {
                    $ignored[] = $key;
                    continue;
                }
                if (is_array($value)) {
                    if ($known[$key]['value_type'] !== 'json') {
                        $ignored[] = $key;
                        continue;
                    }
                } elseif (!is_scalar($value) && $value !== null) {
                    $ignored[] = $key;
                    continue;
                }

                $this->assertSettingValue($key, $known[$key]['value_type'], $value);

                if (Setting::put($key, $value)) {
                    $updated[] = $key;
                }
            }

            if ($updated !== []) {
                $after = [];
                foreach ($updated as $key) {
                    $after[$key] = is_array($input[$key]) ? json_encode($input[$key]) : $input[$key];
                }
                Audit::logDiff('settings_updated', 'settings', 0, $before, $after);
            }

            Response::success([
                'updated' => $updated,
                'ignored' => $ignored,
                'map'     => Setting::map(),
            ], count($updated) . ' setting(s) updated');
        });
    }

    /** GET /settings/numbering */
    public function numbering(): void
    {
        $this->run(static fn() => Response::success(NumberSequence::summary()));
    }

    // --- Audit log ----------------------------------------------------------

    /** GET /audit-log */
    public function auditLog(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page(50, 200);

            $clauses = ['1=1'];
            $params  = [];

            if ($entityType = Request::query('entity_type')) {
                $clauses[] = 'a.entity_type = ?';
                $params[]  = $entityType;
            }
            if ($entityId = Request::queryInt('entity_id')) {
                $clauses[] = 'a.entity_id = ?';
                $params[]  = $entityId;
            }
            if ($userId = Request::queryInt('user_id')) {
                $clauses[] = 'a.user_id = ?';
                $params[]  = $userId;
            }
            if ($action = Request::query('action')) {
                $clauses[] = 'a.action = ?';
                $params[]  = $action;
            }
            if ($from = Request::query('from')) {
                $clauses[] = 'a.created_at >= ?';
                $params[]  = $from . ' 00:00:00';
            }
            if ($to = Request::query('to')) {
                $clauses[] = 'a.created_at <= ?';
                $params[]  = $to . ' 23:59:59';
            }
            if ($search = Request::query('search')) {
                $clauses[] = '(a.note LIKE ? OR a.action LIKE ? OR u.full_name LIKE ?)';
                array_push($params, "%$search%", "%$search%", "%$search%");
            }

            $where = implode(' AND ', $clauses);

            $total = (int) Database::scalar(
                "SELECT COUNT(*) FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE $where",
                $params
            );

            $rows = Database::fetchAll(
                "SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.old_value,
                        a.new_value, a.note, a.ip_address, a.created_at,
                        u.full_name AS actor_name, u.staff_role AS actor_role
                   FROM audit_log a
                   LEFT JOIN users u ON u.id = a.user_id
                  WHERE $where
                  ORDER BY a.created_at DESC, a.id DESC
                  LIMIT $limit OFFSET $offset",
                $params
            );

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'created_at'  => 'When',
                'actor_name'  => 'User',
                'actor_role'  => 'Role',
                'action'      => 'Action',
                'entity_type' => 'Entity',
                'entity_id'   => 'Entity Id',
                'note'        => 'Note',
                'ip_address'  => 'IP',
                'old_value'   => 'Before',
                'new_value'   => 'After',
            ], 'audit-log')) {
                return;
            }

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    // -----------------------------------------------------------------------

    private function activeOwnerCount(): int
    {
        return (int) Database::scalar(
            "SELECT COUNT(*) FROM users WHERE user_type = 'staff' AND staff_role = 'owner' AND is_active = 1"
        );
    }

    private function isWritable(string $key): bool
    {
        if (in_array($key, self::WRITABLE_SETTINGS, true)) {
            return true;
        }
        foreach (self::WRITABLE_SETTING_PREFIXES as $prefix) {
            if (strncmp($key, $prefix, strlen($prefix)) === 0) {
                return true;
            }
        }
        return false;
    }

    /** Type-check before writing: settings feed pricing and document numbering. */
    private function assertSettingValue(string $key, string $type, $value): void
    {
        if ($value === null || $value === '') {
            return;
        }

        if (($type === 'int' || $type === 'decimal') && !is_numeric($value)) {
            throw new ValidationException([$key => ['This setting must be a number']]);
        }
        if ($type === 'int' && (int) $value < 0) {
            throw new ValidationException([$key => ['This setting cannot be negative']]);
        }
        // Percentage settings that silently accept 500 would corrupt every quote.
        if ($type === 'decimal' && str_ends_with($key, '_pct') && ((float) $value < 0 || (float) $value > 100)) {
            throw new ValidationException([$key => ['Percentage must be between 0 and 100']]);
        }
        if ($type === 'bool' && !in_array(strtolower((string) $value), ['0', '1', 'true', 'false', 'yes', 'no'], true)) {
            throw new ValidationException([$key => ['This setting must be true or false']]);
        }
        if (is_string($value) && mb_strlen($value) > 5000) {
            throw new ValidationException([$key => ['Value is too long']]);
        }
    }

    /** Readable but high-entropy: 12 chars from a 58-symbol alphabet ≈ 70 bits. */
    private static function randomPassword(int $length = 12): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
        $max      = strlen($alphabet) - 1;

        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= $alphabet[random_int(0, $max)];
        }
        return $out;
    }
}
