<?php

class AuthController extends Controller
{
    /** POST /auth/login — public, rate-limited to 5 per 15 minutes per IP. */
    public function login(): void
    {
        $this->run(function () {
            $data = $this->validate(Request::only(['identifier', 'password']), [
                'identifier' => 'required|string|max:190',
                'password'   => 'required|string|max:200',
            ]);

            $user = User::findByIdentifier($data['identifier']);

            // Uniform failure message and a dummy hash comparison on the
            // not-found path, so response timing does not reveal which accounts
            // exist.
            if ($user === null) {
                password_verify($data['password'], '$2y$12$usesomesillystringfore7hnbRJHxXVLeakoG8K30M1p1DR.0c6');
                Response::unauthorized('Invalid credentials');
                return;
            }

            if (User::isLocked($user)) {
                Audit::log('login_blocked', 'user', (int) $user['id'], null, ['reason' => 'locked']);
                Response::error('Account temporarily locked after repeated failed attempts. Try again later.', 423);
                return;
            }

            if (!password_verify($data['password'], (string) $user['password_hash'])) {
                User::registerFailedLogin((int) $user['id']);
                Audit::log('login_failed', 'user', (int) $user['id']);
                Response::unauthorized('Invalid credentials');
                return;
            }

            if ((int) $user['is_active'] !== 1) {
                Response::forbidden('This account has been deactivated');
                return;
            }

            User::registerSuccessfulLogin((int) $user['id']);
            RateLimitMiddleware::clear('login');

            $session = $this->issueSession($user);
            Audit::log('login', 'user', (int) $user['id']);

            Response::success($session, 'Signed in');
        });
    }

    /** POST /auth/refresh — public; the refresh token itself is the credential. */
    public function refresh(): void
    {
        $this->run(function () {
            $token = (string) Request::input('refresh_token', '');
            if ($token === '') {
                Response::unauthorized('Refresh token required');
                return;
            }

            $row = Database::fetch(
                'SELECT rt.*, u.id AS uid, u.full_name, u.email, u.phone, u.user_type,
                        u.staff_role, u.agency_id, u.is_active
                   FROM refresh_tokens rt
                   JOIN users u ON u.id = rt.user_id
                  WHERE rt.token_hash = ? AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
                  LIMIT 1',
                [hash('sha256', $token)]
            );

            if ($row === null || (int) $row['is_active'] !== 1) {
                Response::unauthorized('Refresh token is invalid or expired');
                return;
            }

            // Rotate: the presented refresh token is burned as it is exchanged,
            // so a stolen copy is single-use and its reuse is detectable.
            Database::execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?', [(int) $row['id']]);

            $user = [
                'id'         => (int) $row['uid'],
                'full_name'  => $row['full_name'],
                'email'      => $row['email'],
                'phone'      => $row['phone'],
                'user_type'  => $row['user_type'],
                'staff_role' => $row['staff_role'],
                'agency_id'  => $row['agency_id'],
            ];

            Response::success($this->issueSession($user), 'Session refreshed');
        });
    }

    /** POST /auth/logout — authenticated. */
    public function logout(): void
    {
        $this->run(function () {
            $access = Request::bearerToken();
            if ($access !== null) {
                AuthMiddleware::revoke($access);
            }

            $refresh = (string) Request::input('refresh_token', '');
            if ($refresh !== '') {
                Database::execute(
                    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?',
                    [hash('sha256', $refresh)]
                );
            }

            Audit::log('logout', 'user', Request::userId());
            Response::success(null, 'Signed out');
        });
    }

    /** GET /auth/me — authenticated. */
    public function me(): void
    {
        $this->run(function () {
            $user = User::findPublic((int) Request::userId());
            if ($user === null) {
                Response::notFound('User not found');
                return;
            }
            $user['permissions'] = $this->permissionsFor($user);
            Response::success($user);
        });
    }

    /** POST /auth/change-password — authenticated. */
    public function changePassword(): void
    {
        $this->run(function () {
            $minLen = (int) Config::get('security.password_min_length', 8);

            $data = $this->validate(Request::only(['current_password', 'new_password']), [
                'current_password' => 'required|string',
                'new_password'     => 'required|string|min:' . $minLen . '|max:200',
            ]);

            $userId = (int) Request::userId();
            $hash = Database::scalar('SELECT password_hash FROM users WHERE id = ?', [$userId]);

            if ($hash === null || !password_verify($data['current_password'], (string) $hash)) {
                Response::error('Current password is incorrect', 422);
                return;
            }
            if ($data['current_password'] === $data['new_password']) {
                Response::error('The new password must differ from the current one', 422);
                return;
            }

            User::setPassword($userId, $data['new_password']);
            Audit::log('password_changed', 'user', $userId);

            Response::success(null, 'Password updated. Please sign in again on your other devices.');
        });
    }

    /**
     * POST /auth/forgot-password — public.
     * Always returns the same response whether or not the account exists.
     */
    public function forgotPassword(): void
    {
        $this->run(function () {
            $identifier = trim((string) Request::input('identifier', ''));
            $generic = 'If an account matches, a reset link has been sent.';

            if ($identifier === '') {
                Response::success(null, $generic);
                return;
            }

            $user = User::findByIdentifier($identifier);
            if ($user !== null && (int) $user['is_active'] === 1) {
                $token = bin2hex(random_bytes(32));
                $ttl   = (int) Config::get('security.reset_token_ttl', 900);

                Database::execute(
                    'INSERT INTO password_resets (user_id, token_hash, expires_at)
                     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
                    [(int) $user['id'], hash('sha256', $token), $ttl]
                );

                // Delivery (email/SMS) is wired in Notifier; the raw token is
                // never returned in the response body.
                Notifier::passwordReset($user, $token);
                Audit::log('password_reset_requested', 'user', (int) $user['id']);
            }

            Response::success(null, $generic);
        });
    }

    /** POST /auth/reset-password — public, consumes a reset token. */
    public function resetPassword(): void
    {
        $this->run(function () {
            $minLen = (int) Config::get('security.password_min_length', 8);

            $data = $this->validate(Request::only(['token', 'new_password']), [
                'token'        => 'required|string',
                'new_password' => 'required|string|min:' . $minLen . '|max:200',
            ]);

            $row = Database::fetch(
                'SELECT * FROM password_resets
                  WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
                [hash('sha256', $data['token'])]
            );

            if ($row === null) {
                Response::error('This reset link is invalid or has expired', 422);
                return;
            }

            Database::transaction(static function () use ($row, $data) {
                User::setPassword((int) $row['user_id'], $data['new_password']);
                Database::execute('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [(int) $row['id']]);
                // Burn every other outstanding reset for this user.
                Database::execute(
                    'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
                    [(int) $row['user_id']]
                );
            });

            Audit::log('password_reset', 'user', (int) $row['user_id']);
            Response::success(null, 'Password reset. You can now sign in.');
        });
    }

    // -----------------------------------------------------------------------

    private function issueSession(array $user): array
    {
        $clientType = Request::clientType();
        $ttl = Config::get('jwt.ttl.' . $clientType, ['access' => 86400, 'refresh' => 604800]);
        $secret = (string) Config::get('jwt.secret');

        $accessToken = JWT::encode([
            'sub'  => (int) $user['id'],
            'typ'  => $user['user_type'],
            'ctx'  => $clientType,
        ], $secret, (int) $ttl['access']);

        $refreshToken = bin2hex(random_bytes(32));
        Database::execute(
            'INSERT INTO refresh_tokens (user_id, token_hash, client_type, user_agent, ip_address, expires_at)
             VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
            [
                (int) $user['id'], hash('sha256', $refreshToken), $clientType,
                Request::userAgent(), Request::ip(), (int) $ttl['refresh'],
            ]
        );

        $publicUser = [
            'id'         => (int) $user['id'],
            'full_name'  => $user['full_name'],
            'email'      => $user['email'],
            'phone'      => $user['phone'],
            'user_type'  => $user['user_type'],
            'staff_role' => AuthMiddleware::staffRole($user),
            'agency_id'  => $user['agency_id'] ?? null,
        ];
        $publicUser['permissions'] = $this->permissionsFor($publicUser);

        return [
            'user'          => $publicUser,
            'token'         => $accessToken,
            'refresh_token' => $refreshToken,
            'expires_at'    => (time() + (int) $ttl['access']) * 1000, // ms, for JS
            'must_change_password' => !empty($user['must_change_pw']),
        ];
    }

    /**
     * Coarse capability flags for the UI. These drive what is *shown*; the
     * route guards are what actually enforce access.
     */
    private function permissionsFor(array $user): array
    {
        $role = $user['staff_role'] ?? null;
        $isStaff = ($user['user_type'] ?? '') === 'staff';
        $in = static fn(array $roles) => $isStaff && in_array($role, $roles, true);

        return [
            'view_costs'        => $in(['owner', 'manager', 'accounts', 'operations']),
            'view_margins'      => $in(['owner', 'manager', 'accounts']),
            'edit_prices'       => $in(['owner', 'manager']),
            'manage_users'      => $in(['owner']),
            'manage_settings'   => $in(['owner']),
            'confirm_booking'   => $in(['owner', 'manager', 'sales']),
            'cancel_booking'    => $in(['owner', 'manager']),
            'record_payment'    => $in(['owner', 'manager', 'accounts']),
            'void_document'     => $in(['owner', 'accounts']),
            'approve_expense'   => $in(['owner', 'accounts']),
            'manage_operations' => $in(['owner', 'manager', 'operations']),
            'manage_visa'       => $in(['owner', 'manager', 'visa', 'operations']),
        ];
    }
}
