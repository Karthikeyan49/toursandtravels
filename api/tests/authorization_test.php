<?php
/**
 * Authorization regression test.   Run:  php api/tests/authorization_test.php
 *
 * This asserts the ROUTE GUARD MAP ITSELF, not the behaviour of a request. The
 * guard is the entire access-control model, so the failure mode that matters is
 * somebody adding a route and forgetting the 4th argument — which silently
 * defaults to 'staff' and hands every staff user the finance module.
 *
 * The route table is built by requiring index.php with ROUTER_TEST_MODE defined,
 * which skips the JWT secret guard, the rate limiter and the dispatch. No
 * database and no configuration are needed.
 */

// index.php defines ROOT_PATH itself; do not pre-define it.
define('ROUTER_TEST_MODE', true);

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI']    = '/__router_test__';
$_SERVER['REMOTE_ADDR']    = '127.0.0.1';

require __DIR__ . '/../index.php';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

$GLOBALS['__passed'] = 0;
$GLOBALS['__failed'] = 0;

function check(bool $condition, string $label, string $detail = ''): void
{
    if ($condition) {
        $GLOBALS['__passed']++;
        fwrite(STDOUT, "  PASS  $label\n");
        return;
    }
    $GLOBALS['__failed']++;
    fwrite(STDOUT, "  FAIL  $label" . ($detail !== '' ? "\n        $detail" : '') . "\n");
}

/** Turn Router's compiled patterns back into readable "METHOD /path/{id}" keys. */
function readableGuardMap(Router $router): array
{
    $map = [];
    foreach ($router->guardMap() as $key => $guard) {
        [$method, $pattern] = explode(' ', $key, 2);
        $path = substr($pattern, 2, -2);            // strip  #^  and  $#
        $path = str_replace('([^/]+)', '{id}', $path);
        $map[$method . ' ' . $path] = $guard;
    }
    return $map;
}

function guardToString($guard): string
{
    if ($guard === false) {
        return 'false (public)';
    }
    if ($guard === true) {
        return 'true (any authenticated)';
    }
    return (string) $guard;
}

/**
 * @param string[]     $routes
 * @param bool|string  $expected guard value, compared strictly (true !== 'staff')
 */
function assertGuarded(array $map, array $routes, $expected, string $group): void
{
    $missing = [];
    $wrong   = [];

    foreach ($routes as $route) {
        if (!array_key_exists($route, $map)) {
            $missing[] = $route;
            continue;
        }
        if ($map[$route] !== $expected) {
            $wrong[] = $route . ' => ' . guardToString($map[$route]);
        }
    }

    check(
        $missing === [] && $wrong === [],
        "$group: all " . count($routes) . " routes guarded '" . guardToString($expected) . "'",
        trim(
            ($missing !== [] ? 'not registered: ' . implode(', ', $missing) . "\n        " : '')
            . ($wrong !== [] ? 'wrong guard: ' . implode('; ', $wrong) : '')
        )
    );
}

// ---------------------------------------------------------------------------

if (!isset($router) || !$router instanceof Router) {
    fwrite(STDERR, "FATAL: index.php did not expose a \$router — is ROUTER_TEST_MODE honoured?\n");
    exit(1);
}

$map = readableGuardMap($router);

fwrite(STDOUT, "\nAuthorization guard map — " . count($map) . " routes\n");
fwrite(STDOUT, str_repeat('-', 72) . "\n");

// --- 1. The public surface is exactly these four routes ---------------------

$expectedPublic = [
    'POST /auth/login',
    'POST /auth/refresh',
    'POST /auth/forgot-password',
    'POST /auth/reset-password',
];

$actualPublic = [];
foreach ($map as $route => $guard) {
    if ($guard === false) {
        $actualPublic[] = $route;
    }
}
sort($actualPublic);
$sortedExpected = $expectedPublic;
sort($sortedExpected);

check(
    $actualPublic === $sortedExpected,
    'public routes are exactly the four /auth/* endpoints',
    'expected: ' . implode(', ', $sortedExpected) . "\n        actual:   " . implode(', ', $actualPublic)
);

// Stated separately because this is the assertion that catches the dangerous
// mistake: a NEW route registered with guard `false`.
$unexpectedPublic = array_values(array_diff($actualPublic, $sortedExpected));
check(
    $unexpectedPublic === [],
    'no route outside /auth/* is public',
    'unexpectedly public: ' . implode(', ', $unexpectedPublic)
);

foreach ($expectedPublic as $route) {
    check(
        array_key_exists($route, $map) && $map[$route] === false,
        "public route registered: $route",
        array_key_exists($route, $map) ? 'guard is ' . guardToString($map[$route]) : 'route not registered'
    );
}

// --- 2. Authenticated-but-unroled routes ------------------------------------

assertGuarded($map, [
    'GET /auth/me',
    'POST /auth/logout',
    'POST /auth/change-password',
    'GET /notifications',
    'GET /notifications/unread-count',
    'POST /notifications/read-all',
    'POST /notifications/{id}/read',
], true, 'session + notifications');

// --- 3. Finance is owner / manager / accounts, without exception -------------

assertGuarded($map, [
    // payments
    'GET /payments/daybook',
    'POST /payments/{id}/mark-paid',
    'POST /payments/{id}/void',
    'GET /bookings/{id}/payments',
    'POST /bookings/{id}/payments',
    'POST /bookings/{id}/payment-plan',
    // invoices
    'GET /invoices',
    'GET /invoices/{id}',
    'POST /bookings/{id}/invoice',
    'POST /bookings/{id}/cash-bill',
    'POST /invoices/{id}/payments',
    'POST /invoices/{id}/void',
    // payables
    'GET /supplier-bills',
    'GET /supplier-bills/{id}',
    'POST /supplier-bills',
    'POST /supplier-bills/{id}/approve',
    'POST /supplier-bills/{id}/payments',
    // statements
    'GET /finance/payables',
    'GET /finance/receivables',
    'GET /finance/gst-summary',
    'GET /finance/pl',
    // expenses
    'GET /expenses',
    'GET /expenses/summary',
    'GET /expenses/categories',
    'GET /expenses/{id}',
    'POST /expenses',
    'PUT /expenses/{id}',
    'POST /expenses/{id}/submit',
    'POST /expenses/{id}/approve',
    'POST /expenses/{id}/reject',
    'POST /expenses/{id}/mark-paid',
    'POST /expenses/{id}/void',
], 'staff:owner,manager,accounts', 'finance');

// Belt and braces: nothing whose path lives in a finance namespace may be
// reachable by any other role, however it came to be registered.
$financePrefixes = ['/finance/', '/invoices', '/supplier-bills', '/payments/', '/expenses'];
$leaks = [];
foreach ($map as $route => $guard) {
    [, $path] = explode(' ', $route, 2);
    foreach ($financePrefixes as $prefix) {
        if (strncmp($path, $prefix, strlen($prefix)) === 0 && $guard !== 'staff:owner,manager,accounts') {
            $leaks[] = $route . ' => ' . guardToString($guard);
        }
    }
}
check($leaks === [], 'no finance-namespace route escapes the accounts guard', implode('; ', $leaks));

// --- 4. Administration is owner-only ----------------------------------------

assertGuarded($map, [
    'GET /users',
    'GET /users/{id}',
    'POST /users',
    'PUT /users/{id}',
    'POST /users/{id}/deactivate',
    'POST /users/{id}/activate',
    'POST /users/{id}/reset-password',
    'GET /settings',
    'PUT /settings',
    'GET /settings/numbering',
    'GET /audit-log',
], 'staff:owner', 'administration');

$adminPrefixes = ['/users', '/settings', '/audit-log'];
$leaks = [];
foreach ($map as $route => $guard) {
    [, $path] = explode(' ', $route, 2);
    foreach ($adminPrefixes as $prefix) {
        if (strncmp($path, $prefix, strlen($prefix)) === 0 && $guard !== 'staff:owner') {
            $leaks[] = $route . ' => ' . guardToString($guard);
        }
    }
}
check($leaks === [], 'no admin-namespace route escapes the owner guard', implode('; ', $leaks));

// --- 5. Operations and vouchers ---------------------------------------------

assertGuarded($map, [
    'GET /ops/board',
    'GET /ops/calendar',
    'GET /ops/departures-checklist',
    'GET /ops/incidents',
    'POST /ops/daysheets/{id}/checklist',
    'POST /ops/daysheets/{id}/issue',
    'GET /trip-assignments',
    'GET /trip-assignments/{id}',
    'PUT /trip-assignments/{id}',
    'POST /trip-assignments/{id}/status',
    'POST /trip-assignments/{id}/trip-sheet',
    'POST /bookings/{id}/trip-assignments',
    'POST /trip-sheets/{id}/approve',
    'POST /trip-sheets/{id}/reject',
    'POST /booking-services/{id}/confirm',
    'POST /bookings/{id}/incidents',
    'POST /incidents/{id}/resolve',
    'GET /bookings/{id}/travel-legs',
    'PUT /bookings/{id}/travel-legs',
    'POST /bookings/{id}/travel-legs',
    'PUT /bookings/{id}/travel-legs/{id}',
    'DELETE /bookings/{id}/travel-legs/{id}',
    'POST /bookings/{id}/travel-legs/{id}/confirm',
    'GET /vouchers',
    'GET /vouchers/{id}',
    'GET /bookings/{id}/vouchers',
    'POST /bookings/{id}/vouchers',
    'POST /bookings/{id}/vouchers/issue-all',
    'POST /vouchers/{id}/cancel',
    'POST /vouchers/{id}/send',
], 'staff:owner,manager,operations', 'operations + vouchers');

// --- 6. Selling and pricing --------------------------------------------------

assertGuarded($map, [
    'POST /leads',
    'PUT /leads/{id}',
    'POST /leads/{id}/status',
    'POST /leads/{id}/followups',
    'POST /leads/{id}/convert-customer',
    'POST /quotations',
    'PUT /quotations/{id}',
    'PUT /quotations/{id}/items',
    'PUT /quotations/{id}/options',
    'POST /quotations/{id}/price-from-package',
    'POST /quotations/{id}/send',
    'POST /quotations/{id}/status',
    'POST /quotations/{id}/revise',
    'POST /quotations/{id}/convert',
    'POST /bookings',
    'PUT /bookings/{id}',
    'PUT /bookings/{id}/services',
    'PUT /bookings/{id}/options',
    'POST /bookings/{id}/services/from-package',
    'POST /bookings/{id}/confirm',
], 'staff:owner,manager,sales', 'selling');

assertGuarded($map, [
    'POST /bookings/{id}/cancel',
    'POST /packages/{id}/publish',
    'POST /packages/{id}/archive',
    'POST /packages/{id}/prices',
    'DELETE /packages/{id}/prices/{id}',
    'POST /hotels/{id}/rates',
], 'staff:owner,manager', 'pricing + cancellation');

assertGuarded($map, [
    'GET /bookings/{id}/margin',
    'GET /reports/sales',
    'GET /reports/margin',
    'GET /reports/supplier-performance',
], 'staff:owner,manager,accounts,operations', 'cost-bearing reports');

// --- 7. Structural invariants ------------------------------------------------

$missingGuard = [];
$badType      = [];
$badRole      = [];

foreach ($map as $route => $guard) {
    if ($guard === null || $guard === '' || $guard === []) {
        $missingGuard[] = $route;
        continue;
    }
    if (is_bool($guard)) {
        continue;
    }
    if (!is_string($guard)) {
        $badType[] = $route . ' => ' . gettype($guard);
        continue;
    }

    [$type, $roles] = AuthMiddleware::parseGuard($guard);

    if (!in_array($type, ['staff', 'agent', 'customer'], true)) {
        $badType[] = $route . ' => user_type "' . $type . '"';
    }
    foreach ($roles as $role) {
        if (!in_array($role, AuthMiddleware::ROLES, true)) {
            $badRole[] = $route . ' => role "' . $role . '"';
        }
    }
}

check($missingGuard === [], 'every route declares a guard', implode(', ', $missingGuard));
check($badType === [],      'every guard names a known user_type', implode('; ', $badType));
check($badRole === [],      'every guard names roles from AuthMiddleware::ROLES', implode('; ', $badRole));

// A duplicate registration is dead code: Router returns on the first match, so
// the second copy — and any tighter guard it carries — never runs.
$seen       = [];
$duplicates = [];
foreach (array_keys($map) as $route) {
    if (isset($seen[$route])) {
        $duplicates[] = $route;
    }
    $seen[$route] = true;
}
check($duplicates === [], 'no duplicate method+path registrations', implode(', ', $duplicates));

// Router matches in insertion order, so a literal path registered AFTER its
// `{id}` sibling is unreachable — `/suppliers/options` would resolve to
// showSupplier('options').
$order     = array_keys($map);
$shadowed  = [];
foreach ($order as $i => $route) {
    [$method, $path] = explode(' ', $route, 2);
    if (strpos($path, '{id}') !== false) {
        continue;
    }
    foreach (array_slice($order, 0, $i) as $earlier) {
        [$earlierMethod, $earlierPath] = explode(' ', $earlier, 2);
        if ($earlierMethod !== $method || strpos($earlierPath, '{id}') === false) {
            continue;
        }
        $regex = '#^' . str_replace('\{id\}', '[^/]+', preg_quote($earlierPath, '#')) . '$#';
        if (preg_match($regex, $path)) {
            $shadowed[] = $route . ' is shadowed by ' . $earlier;
        }
    }
}
check($shadowed === [], 'no literal route is shadowed by an earlier {id} route', implode('; ', $shadowed));

// --- 8. AuthMiddleware::parseGuard ------------------------------------------

$cases = [
    ['staff',                        ['staff', []]],
    ['agent',                        ['agent', []]],
    ['staff:owner',                  ['staff', ['owner']]],
    ['staff:owner,manager',          ['staff', ['owner', 'manager']]],
    ['staff:owner, manager , sales', ['staff', ['owner', 'manager', 'sales']]],
    ['staff:',                       ['staff', []]],
];

foreach ($cases as [$input, $expected]) {
    $actual = AuthMiddleware::parseGuard($input);
    check(
        $actual === $expected,
        "parseGuard('$input')",
        'got ' . json_encode($actual) . ', expected ' . json_encode($expected)
    );
}

// staffRole() must never return a role that is not on the canonical list.
check(
    AuthMiddleware::staffRole(['id' => 99, 'staff_role' => 'superuser']) === null,
    'staffRole() rejects a role outside AuthMiddleware::ROLES'
);
check(
    AuthMiddleware::staffRole(['id' => 99, 'staff_role' => 'accounts']) === 'accounts',
    'staffRole() returns a canonical role'
);
check(
    AuthMiddleware::staffRole(['id' => 1, 'staff_role' => null]) === 'owner',
    'staffRole() treats the bootstrap account (id 1) as owner'
);
check(
    AuthMiddleware::staffRole(['id' => 2, 'staff_role' => null]) === null,
    'staffRole() gives no implicit role to any other account'
);

// --- Result ------------------------------------------------------------------

fwrite(STDOUT, str_repeat('-', 72) . "\n");
fwrite(STDOUT, sprintf(
    "authorization_test: %d passed, %d failed (%d routes checked)\n\n",
    $GLOBALS['__passed'],
    $GLOBALS['__failed'],
    count($map)
));

exit($GLOBALS['__failed'] > 0 ? 1 : 0);
