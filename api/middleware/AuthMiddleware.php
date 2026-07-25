<?php
/**
 * Authentication + authorization for a route guard.
 *
 * Guard grammar (4th argument of every route registration):
 *   false              public
 *   true               any authenticated, active user
 *   'staff'            user_type = 'staff'
 *   'staff:owner,ops'  user_type = 'staff' AND staff_role IN (owner, ops)
 *   'agent'            user_type = 'agent' (data scoped to their agency)
 *
 * Returns false and emits the response when access is denied; the router then
 * stops without ever constructing the controller.
 */
class AuthMiddleware
{
    /** Canonical staff roles. A value outside this list is treated as no role. */
    public const ROLES = ['owner', 'manager', 'sales', 'operations', 'accounts', 'visa'];

    /** Legacy/blank staff_role is treated as 'owner' only for the bootstrap account. */
    private const IMPLICIT_OWNER_ID = 1;

    public static function handle($guard): bool
    {
        if ($guard === false) {
            return true;
        }

        $user = self::authenticate();
        if ($user === null) {
            Response::unauthorized('Authentication required');
            return false;
        }

        Request::setUser($user);

        if ($guard === true) {
            return true;
        }

        [$requiredType, $roles] = self::parseGuard((string) $guard);

        if ($user['user_type'] !== $requiredType) {
            Audit::denied((string) $guard, 'wrong user_type: ' . $user['user_type']);
            Response::forbidden('You do not have access to this resource');
            return false;
        }

        if ($roles !== [] && !in_array(self::staffRole($user), $roles, true)) {
            Audit::denied((string) $guard, 'role ' . (self::staffRole($user) ?? 'none') . ' not in [' . implode(',', $roles) . ']');
            Response::forbidden('Your role does not permit this action');
            return false;
        }

        return true;
    }

    /** @return array{0:string, 1:string[]} */
    public static function parseGuard(string $guard): array
    {
        if (strpos($guard, ':') === false) {
            return [$guard, []];
        }
        [$type, $roleList] = explode(':', $guard, 2);
        $roles = array_values(array_filter(array_map('trim', explode(',', $roleList))));
        return [$type, $roles];
    }

    public static function staffRole(array $user): ?string
    {
        $role = $user['staff_role'] ?? null;
        if ($role !== null && in_array($role, self::ROLES, true)) {
            return $role;
        }
        // The bootstrap account created by install.php predates role assignment.
        return ((int) $user['id'] === self::IMPLICIT_OWNER_ID) ? 'owner' : null;
    }

    /** @return array<string,mixed>|null */
    private static function authenticate(): ?array
    {
        $token = Request::bearerToken();
        if ($token === null) {
            return null;
        }

        $claims = JWT::decode($token, (string) Config::get('jwt.secret'));
        if ($claims === null || empty($claims['sub'])) {
            return null;
        }

        // Access-token denylist: a logout or a forced revoke kills the token
        // immediately rather than waiting out its TTL.
        if (!empty($claims['jti']) && self::isRevoked((string) $claims['jti'])) {
            return null;
        }

        $user = Database::fetch(
            'SELECT id, full_name, email, phone, user_type, staff_role, agency_id, is_active
               FROM users WHERE id = ? LIMIT 1',
            [(int) $claims['sub']]
        );

        if ($user === null || (int) $user['is_active'] !== 1) {
            return null;
        }

        // A token minted before a role change must not carry the old role.
        // The DB row is authoritative; claims are only used for identity.
        return $user;
    }

    private static function isRevoked(string $jti): bool
    {
        return Database::scalar(
            'SELECT 1 FROM revoked_tokens WHERE jti_hash = ? AND expires_at > NOW() LIMIT 1',
            [hash('sha256', $jti)]
        ) !== null;
    }

    /** Called by AuthController::logout(). */
    public static function revoke(string $token): void
    {
        $claims = JWT::decode($token, (string) Config::get('jwt.secret'));
        if ($claims === null || empty($claims['jti'])) {
            return;
        }
        Database::execute(
            'INSERT IGNORE INTO revoked_tokens (jti_hash, expires_at) VALUES (?, FROM_UNIXTIME(?))',
            [hash('sha256', (string) $claims['jti']), (int) ($claims['exp'] ?? time())]
        );
        // Opportunistic cleanup; no cron needed on shared hosting.
        if (random_int(1, 100) === 1) {
            Database::execute('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
        }
    }

    /**
     * Row-level scope for agency users: a B2B agent may only ever see their own
     * agency's records. Controllers call this and append it to their WHERE.
     * @return array{0:string, 1:array}
     */
    public static function agencyScope(string $columnAlias = 'agency_id'): array
    {
        $user = Request::user();
        if ($user !== null && $user['user_type'] === 'agent' && !empty($user['agency_id'])) {
            return [$columnAlias . ' = ?', [(int) $user['agency_id']]];
        }
        return ['1=1', []];
    }
}
