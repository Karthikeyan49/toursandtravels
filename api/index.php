<?php
/**
 * Front controller.
 *
 * The order of the sections below is deliberate and load-bearing:
 *
 *   1  paths + Response          every later failure path needs to emit JSON
 *   2  error reporting           display_errors off before anything can warn
 *   3  handlers                  no PHP notice ever reaches the client as HTML
 *   4  timezone                  before any date() in a query
 *   5  CORS                      before the preflight short-circuit
 *   6  OPTIONS → 204             before any database work
 *   7  security headers          on every response, including errors
 *   8  JWT secret guard          fail closed rather than sign with a weak key
 *   9  415 gate                  reject bodies we will not parse
 *  10  config + DB               still no connection: PDO is lazy
 *  11  class loading             manual, in dependency order (no Composer)
 *  12  rate limiting             first statement that touches the database
 *  13  route table               the authorization model, declaratively
 *  14  dispatch
 *
 * ROUTER_TEST_MODE lets api/tests/authorization_test.php build the route table
 * and assert every guard without a database, a secret, or a dispatch.
 */

// --- 1. Paths and the response envelope ------------------------------------

define('ROOT_PATH', __DIR__);

$config = require ROOT_PATH . '/config/app.php';
require_once ROOT_PATH . '/core/Response.php';

$isTestMode = defined('ROUTER_TEST_MODE') && ROUTER_TEST_MODE === true;

// --- 2. Error reporting -----------------------------------------------------

$isProduction = ($config['app']['env'] ?? 'production') === 'production';

error_reporting($isProduction ? (E_ALL & ~E_DEPRECATED & ~E_NOTICE) : E_ALL);
ini_set('display_errors', $isProduction ? '0' : '1');
ini_set('display_startup_errors', $isProduction ? '0' : '1');
ini_set('log_errors', '1');

// --- 3. Fatal handlers ------------------------------------------------------
// A stack trace in a response body is a map of the application. In production the
// client gets a generic message and the detail goes to the error log only.

set_exception_handler(static function (Throwable $e) use ($isProduction) {
    error_log(sprintf('[uncaught] %s: %s in %s:%d', get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()));
    Response::error($isProduction ? 'Internal server error' : $e->getMessage(), 500);
});

set_error_handler(static function (int $severity, string $message, string $file = '', int $line = 0) {
    // Respect the error_reporting level; @-suppressed notices stay suppressed.
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

register_shutdown_function(static function () use ($isProduction) {
    $error = error_get_last();
    if ($error === null || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }
    error_log(sprintf('[fatal] %s in %s:%d', $error['message'], $error['file'], $error['line']));
    Response::error($isProduction ? 'Internal server error' : $error['message'], 500);
});

// --- 4. Timezone ------------------------------------------------------------

date_default_timezone_set($config['app']['timezone'] ?? 'Asia/Kolkata');

// --- 5. CORS ----------------------------------------------------------------
// Exact-match allowlist only — never '*', and never a substring or regex match.
// A localhost origin is honoured outside production so the Vite dev server works
// without anyone being tempted to add it to the production allowlist.

$origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $config['cors']['origins'] ?? [];

$originAllowed = $origin !== '' && in_array($origin, $allowed, true);

if (!$originAllowed && $origin !== '' && !$isProduction) {
    $host = parse_url($origin, PHP_URL_HOST);
    $originAllowed = in_array($host, ['localhost', '127.0.0.1', '::1'], true);
}

if (!headers_sent()) {
    // Vary is required even when the origin is rejected: a shared cache must not
    // serve one origin's CORS decision to another.
    header('Vary: Origin');

    if ($originAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Client-Type, X-Requested-With');
        header('Access-Control-Expose-Headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After, Content-Disposition');
        header('Access-Control-Max-Age: ' . (int) ($config['cors']['max_age'] ?? 86400));
    }
}

// --- 6. Preflight -----------------------------------------------------------
// Answered before the database, the class loader and the rate limiter: a
// preflight must be cheap, and it carries no credentials to authorise.

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- 7. Security headers ----------------------------------------------------
// This is a JSON API: it never frames, never loads a subresource and never wants
// its content type guessed.

if (!headers_sent()) {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header_remove('X-Powered-By');
}

// --- 8. JWT secret guard ----------------------------------------------------
// A missing, short or placeholder secret means every token in the system is
// forgeable. Refusing to boot is the only safe response.

if (!$isTestMode) {
    $jwtSecret = (string) ($config['jwt']['secret'] ?? '');

    if ($jwtSecret === '' || strlen($jwtSecret) < 32 || $jwtSecret === 'change-me') {
        error_log('[boot] JWT_SECRET is missing, too short (<32 chars) or still the placeholder value');
        Response::error('Server misconfiguration', 500);
        exit;
    }
}

// --- 9. Content-Type gate ---------------------------------------------------
// Request::body() only understands these three. Anything else would silently
// parse as an empty body and look like a validation failure.

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    $acceptable  = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'];

    // An empty Content-Type on a body-less POST (a pure action endpoint such as
    // /bookings/{id}/confirm) is legitimate and must not be rejected.
    $hasBody = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0;

    if ($contentType !== '' && !in_array($contentType, $acceptable, true)) {
        Response::error('Unsupported media type. Use application/json.', 415);
        exit;
    }
    if ($contentType === '' && $hasBody) {
        Response::error('A Content-Type header is required for requests with a body.', 415);
        exit;
    }
}

// --- 10. Configuration and database -----------------------------------------

require_once ROOT_PATH . '/core/Config.php';
require_once ROOT_PATH . '/core/Database.php';

Config::load($config);
Database::configure($config['db'] ?? []);

// --- 11. Class loading ------------------------------------------------------
// No Composer on shared hosting, so every class is required explicitly, in
// dependency order: core → helpers → services → middleware → models → controllers.

require_once ROOT_PATH . '/core/Request.php';
require_once ROOT_PATH . '/core/Model.php';          // also defines the domain exceptions
require_once ROOT_PATH . '/core/Controller.php';
require_once ROOT_PATH . '/core/Router.php';

require_once ROOT_PATH . '/helpers/JWT.php';
require_once ROOT_PATH . '/helpers/Money.php';
require_once ROOT_PATH . '/helpers/Validator.php';

require_once ROOT_PATH . '/services/Audit.php';
require_once ROOT_PATH . '/services/NumberSequence.php';
require_once ROOT_PATH . '/services/Notifier.php';
require_once ROOT_PATH . '/services/Pricing.php';
require_once ROOT_PATH . '/services/OpsDaysheet.php';
require_once ROOT_PATH . '/services/FileStore.php';
require_once ROOT_PATH . '/services/Exporter.php';

require_once ROOT_PATH . '/middleware/AuthMiddleware.php';
require_once ROOT_PATH . '/middleware/RateLimitMiddleware.php';

require_once ROOT_PATH . '/models/Setting.php';
require_once ROOT_PATH . '/models/User.php';
require_once ROOT_PATH . '/models/Destination.php';
require_once ROOT_PATH . '/models/Customer.php';
require_once ROOT_PATH . '/models/Supplier.php';
require_once ROOT_PATH . '/models/Hotel.php';
require_once ROOT_PATH . '/models/Package.php';
require_once ROOT_PATH . '/models/Lead.php';
require_once ROOT_PATH . '/models/Quotation.php';
require_once ROOT_PATH . '/models/QuotationOption.php';
require_once ROOT_PATH . '/models/Booking.php';
require_once ROOT_PATH . '/models/BookingOption.php';
require_once ROOT_PATH . '/models/TravelLeg.php';
require_once ROOT_PATH . '/models/Payment.php';
require_once ROOT_PATH . '/models/Invoice.php';
require_once ROOT_PATH . '/models/Voucher.php';
require_once ROOT_PATH . '/models/Expense.php';
require_once ROOT_PATH . '/models/TripAssignment.php';

require_once ROOT_PATH . '/controllers/AuthController.php';
require_once ROOT_PATH . '/controllers/MasterController.php';
require_once ROOT_PATH . '/controllers/PackageController.php';
require_once ROOT_PATH . '/controllers/LeadController.php';
require_once ROOT_PATH . '/controllers/QuotationController.php';
require_once ROOT_PATH . '/controllers/BookingController.php';
require_once ROOT_PATH . '/controllers/FinanceController.php';
require_once ROOT_PATH . '/controllers/ExpenseController.php';
require_once ROOT_PATH . '/controllers/VoucherController.php';
require_once ROOT_PATH . '/controllers/OpsController.php';
require_once ROOT_PATH . '/controllers/DashboardController.php';
require_once ROOT_PATH . '/controllers/ReportController.php';
require_once ROOT_PATH . '/controllers/NotificationController.php';
require_once ROOT_PATH . '/controllers/AdminController.php';

// --- 12. Rate limiting ------------------------------------------------------
// Credential endpoints get a tight bucket; everything else shares a generous one
// that only catches runaway clients and scrapers.

if (!$isTestMode) {
    $path = Request::path();

    if ($method === 'POST' && $path === '/auth/login') {
        $bucket = 'login';
    } elseif ($method === 'POST' && in_array($path, ['/auth/forgot-password', '/auth/reset-password'], true)) {
        $bucket = 'reset';
    } else {
        $bucket = 'general';
    }

    if (!RateLimitMiddleware::check($bucket)) {
        exit;   // 429 already emitted
    }
}

// --- 13. Routes -------------------------------------------------------------
//
// The 4th argument is the authorization guard and is the whole access model:
//
//   false                             public
//   true                              any authenticated, active user
//   'staff'                           any staff user  (default for reads + CRUD)
//   'staff:owner,manager,sales'       selling: leads, quotes, bookings
//   'staff:owner,manager'             pricing, cancellation, publishing
//   'staff:owner,manager,accounts'    every money movement
//   'staff:owner,manager,operations'  the ops board, transport, vouchers
//   'staff:owner'                     users, settings, audit log
//
// Literal paths are registered BEFORE their `{id}` siblings: Router matches in
// insertion order, so `/suppliers/options` must be seen before `/suppliers/{id}`.

$router = new Router();

// -- Authentication ----------------------------------------------------------
$router->post('/auth/login',           [AuthController::class, 'login'],          false);
$router->post('/auth/refresh',         [AuthController::class, 'refresh'],        false);
$router->post('/auth/forgot-password', [AuthController::class, 'forgotPassword'], false);
$router->post('/auth/reset-password',  [AuthController::class, 'resetPassword'],  false);

$router->get('/auth/me',               [AuthController::class, 'me'],             true);
$router->post('/auth/logout',          [AuthController::class, 'logout'],         true);
$router->post('/auth/change-password', [AuthController::class, 'changePassword'], true);

// -- Notifications (every authenticated user has an inbox) -------------------
$router->get('/notifications',              [NotificationController::class, 'index'],       true);
$router->get('/notifications/unread-count', [NotificationController::class, 'unreadCount'], true);
$router->post('/notifications/read-all',    [NotificationController::class, 'markAllRead'], true);
$router->post('/notifications/{id}/read',   [NotificationController::class, 'markRead'],    true);

// -- Dashboard ---------------------------------------------------------------
$router->get('/dashboard/overview',     [DashboardController::class, 'overview'],    'staff');
$router->get('/dashboard/sales-funnel', [DashboardController::class, 'salesFunnel'], 'staff');
$router->get('/dashboard/my-work',      [DashboardController::class, 'myWork'],      'staff');

// -- Masters: geography ------------------------------------------------------
$router->get('/countries',            [MasterController::class, 'countries'],          'staff');
$router->get('/destinations',         [MasterController::class, 'destinations'],       'staff');
$router->get('/destinations/options', [MasterController::class, 'destinationOptions'], 'staff');
$router->post('/destinations',        [MasterController::class, 'storeDestination'],   'staff');
$router->put('/destinations/{id}',    [MasterController::class, 'updateDestination'],  'staff');
$router->delete('/destinations/{id}', [MasterController::class, 'deleteDestination'],  'staff:owner,manager');
$router->get('/cities',               [MasterController::class, 'cities'],             'staff');
$router->post('/cities',              [MasterController::class, 'storeCity'],          'staff');

// -- Masters: suppliers ------------------------------------------------------
$router->get('/suppliers',         [MasterController::class, 'suppliers'],       'staff');
$router->get('/suppliers/options', [MasterController::class, 'supplierOptions'], 'staff');
$router->get('/suppliers/{id}',    [MasterController::class, 'showSupplier'],    'staff');
$router->post('/suppliers',        [MasterController::class, 'storeSupplier'],   'staff');
$router->put('/suppliers/{id}',    [MasterController::class, 'updateSupplier'],  'staff');
$router->delete('/suppliers/{id}', [MasterController::class, 'deleteSupplier'],  'staff:owner,manager');

// -- Masters: hotels ---------------------------------------------------------
$router->get('/hotels',                [MasterController::class, 'hotels'],        'staff');
$router->get('/hotels/options',        [MasterController::class, 'hotelOptions'],  'staff');
$router->get('/hotels/{id}',           [MasterController::class, 'showHotel'],     'staff');
$router->post('/hotels',               [MasterController::class, 'storeHotel'],    'staff');
$router->put('/hotels/{id}',           [MasterController::class, 'updateHotel'],   'staff');
$router->delete('/hotels/{id}',        [MasterController::class, 'deleteHotel'],   'staff:owner,manager');
$router->post('/hotels/{id}/room-types', [MasterController::class, 'storeRoomType'], 'staff');
// Contracted buying rates are pricing data.
$router->post('/hotels/{id}/rates',    [MasterController::class, 'storeRate'],     'staff:owner,manager');

// -- Masters: activities, customers, fleet -----------------------------------
$router->get('/activities',      [MasterController::class, 'activities'],     'staff');
$router->post('/activities',     [MasterController::class, 'storeActivity'],  'staff');
$router->get('/customers',       [MasterController::class, 'customers'],      'staff');
$router->get('/customers/{id}',  [MasterController::class, 'showCustomer'],   'staff');
$router->post('/customers',      [MasterController::class, 'storeCustomer'],  'staff');
$router->put('/customers/{id}',  [MasterController::class, 'updateCustomer'], 'staff');
$router->get('/vehicles',        [MasterController::class, 'vehicles'],       'staff');
$router->get('/vehicle-types',   [MasterController::class, 'vehicleTypes'],   'staff');
$router->get('/drivers',         [MasterController::class, 'drivers'],        'staff');

// -- Packages ----------------------------------------------------------------
$router->get('/packages',                    [PackageController::class, 'index'],           'staff');
$router->get('/packages/options',            [PackageController::class, 'options'],         'staff');
$router->get('/packages/{id}',               [PackageController::class, 'show'],            'staff');
$router->post('/packages',                   [PackageController::class, 'store'],           'staff:owner,manager,sales');
$router->put('/packages/{id}',               [PackageController::class, 'update'],          'staff:owner,manager,sales');
$router->put('/packages/{id}/itinerary',     [PackageController::class, 'saveItinerary'],   'staff:owner,manager,sales');
$router->post('/packages/{id}/prices',       [PackageController::class, 'storePrice'],      'staff:owner,manager');
$router->delete('/packages/{id}/prices/{priceId}', [PackageController::class, 'deactivatePrice'], 'staff:owner,manager');
$router->post('/packages/{id}/departures',   [PackageController::class, 'storeDeparture'],  'staff:owner,manager,sales');
$router->post('/packages/{id}/publish',      [PackageController::class, 'publish'],         'staff:owner,manager');
$router->post('/packages/{id}/archive',      [PackageController::class, 'archive'],         'staff:owner,manager');
$router->get('/departures',                  [PackageController::class, 'departures'],      'staff');

// -- Leads -------------------------------------------------------------------
$router->get('/leads',                     [LeadController::class, 'index'],            'staff');
$router->get('/leads/pipeline',            [LeadController::class, 'pipeline'],         'staff');
$router->get('/leads/sources',             [LeadController::class, 'sources'],          'staff');
$router->get('/leads/{id}',                [LeadController::class, 'show'],             'staff');
$router->post('/leads',                    [LeadController::class, 'store'],            'staff:owner,manager,sales');
$router->put('/leads/{id}',                [LeadController::class, 'update'],           'staff:owner,manager,sales');
$router->post('/leads/{id}/status',        [LeadController::class, 'changeStatus'],     'staff:owner,manager,sales');
$router->post('/leads/{id}/followups',     [LeadController::class, 'addFollowup'],      'staff:owner,manager,sales');
$router->post('/leads/{id}/convert-customer', [LeadController::class, 'convertToCustomer'], 'staff:owner,manager,sales');

// -- Quotations --------------------------------------------------------------
$router->get('/quotations',      [QuotationController::class, 'index'], 'staff');
$router->get('/quotations/{id}', [QuotationController::class, 'show'],  'staff');
$router->post('/quotations',                        [QuotationController::class, 'store'],            'staff:owner,manager,sales');
$router->put('/quotations/{id}',                    [QuotationController::class, 'update'],           'staff:owner,manager,sales');
$router->put('/quotations/{id}/items',              [QuotationController::class, 'saveItems'],        'staff:owner,manager,sales');
$router->put('/quotations/{id}/options',            [QuotationController::class, 'saveOptions'],      'staff:owner,manager,sales');
$router->post('/quotations/{id}/price-from-package',[QuotationController::class, 'priceFromPackage'], 'staff:owner,manager,sales');
$router->post('/quotations/{id}/send',              [QuotationController::class, 'send'],             'staff:owner,manager,sales');
$router->post('/quotations/{id}/status',            [QuotationController::class, 'changeStatus'],     'staff:owner,manager,sales');
$router->post('/quotations/{id}/revise',            [QuotationController::class, 'revise'],           'staff:owner,manager,sales');
$router->post('/quotations/{id}/convert',           [QuotationController::class, 'convert'],          'staff:owner,manager,sales');

// -- Bookings ----------------------------------------------------------------
$router->get('/bookings',              [BookingController::class, 'index'],   'staff');
$router->get('/bookings/{id}',         [BookingController::class, 'show'],    'staff');
$router->get('/bookings/{id}/history', [BookingController::class, 'history'], 'staff');
$router->post('/bookings',                              [BookingController::class, 'store'],               'staff:owner,manager,sales');
$router->put('/bookings/{id}',                          [BookingController::class, 'update'],              'staff:owner,manager,sales');
$router->put('/bookings/{id}/services',                 [BookingController::class, 'saveServices'],        'staff:owner,manager,sales');
$router->post('/bookings/{id}/services/from-package',   [BookingController::class, 'servicesFromPackage'], 'staff:owner,manager,sales');
$router->put('/bookings/{id}/options',                  [BookingController::class, 'saveOptions'],         'staff:owner,manager,sales');
$router->post('/bookings/{id}/confirm',                 [BookingController::class, 'confirm'],             'staff:owner,manager,sales');
// Ops fill in passports and move a live booking through the trip.
$router->put('/bookings/{id}/pax',     [BookingController::class, 'savePax'],      'staff');
$router->post('/bookings/{id}/status', [BookingController::class, 'changeStatus'], 'staff:owner,manager,operations');
// Cancellation moves money (retention + refund) — managers only.
$router->post('/bookings/{id}/cancel', [BookingController::class, 'cancel'],       'staff:owner,manager');
$router->get('/bookings/{id}/margin',  [BookingController::class, 'margin'],       'staff:owner,manager,accounts,operations');

// Travel legs are operational/logistics data for the printable itinerary handout.
$router->get('/bookings/{id}/travel-legs',                    [BookingController::class, 'travelLegs'],       'staff:owner,manager,operations');
$router->put('/bookings/{id}/travel-legs',                    [BookingController::class, 'saveTravelLegs'],   'staff:owner,manager,operations');
$router->post('/bookings/{id}/travel-legs',                   [BookingController::class, 'addTravelLeg'],     'staff:owner,manager,operations');
$router->put('/bookings/{id}/travel-legs/{legId}',             [BookingController::class, 'updateTravelLeg'],  'staff:owner,manager,operations');
$router->delete('/bookings/{id}/travel-legs/{legId}',          [BookingController::class, 'removeTravelLeg'],  'staff:owner,manager,operations');
$router->post('/bookings/{id}/travel-legs/{legId}/confirm',    [BookingController::class, 'confirmTravelLeg'], 'staff:owner,manager,operations');

// -- Finance: payments -------------------------------------------------------
$router->get('/payments/daybook',            [FinanceController::class, 'daybook'],              'staff:owner,manager,accounts');
$router->post('/payments/{id}/mark-paid',    [FinanceController::class, 'markPaid'],             'staff:owner,manager,accounts');
$router->post('/payments/{id}/void',         [FinanceController::class, 'voidPayment'],          'staff:owner,manager,accounts');
$router->get('/bookings/{id}/payments',      [FinanceController::class, 'bookingPayments'],      'staff:owner,manager,accounts');
$router->post('/bookings/{id}/payments',     [FinanceController::class, 'recordBookingPayment'], 'staff:owner,manager,accounts');
$router->post('/bookings/{id}/payment-plan', [FinanceController::class, 'schedulePlan'],         'staff:owner,manager,accounts');

// -- Finance: invoices -------------------------------------------------------
$router->get('/invoices',                [FinanceController::class, 'invoices'],             'staff:owner,manager,accounts');
$router->get('/invoices/{id}',           [FinanceController::class, 'showInvoice'],          'staff:owner,manager,accounts');
$router->post('/bookings/{id}/invoice',  [FinanceController::class, 'raiseInvoice'],         'staff:owner,manager,accounts');
$router->post('/bookings/{id}/cash-bill', [FinanceController::class, 'raiseCashBill'],       'staff:owner,manager,accounts');
$router->post('/invoices/{id}/payments', [FinanceController::class, 'recordInvoicePayment'], 'staff:owner,manager,accounts');
$router->post('/invoices/{id}/void',     [FinanceController::class, 'voidInvoice'],          'staff:owner,manager,accounts');

// -- Finance: payables -------------------------------------------------------
$router->get('/supplier-bills',                [FinanceController::class, 'supplierBills'],        'staff:owner,manager,accounts');
$router->get('/supplier-bills/{id}',           [FinanceController::class, 'showSupplierBill'],     'staff:owner,manager,accounts');
$router->post('/supplier-bills',               [FinanceController::class, 'storeSupplierBill'],    'staff:owner,manager,accounts');
$router->post('/supplier-bills/{id}/approve',  [FinanceController::class, 'approveSupplierBill'],  'staff:owner,manager,accounts');
$router->post('/supplier-bills/{id}/payments', [FinanceController::class, 'paySupplierBill'],      'staff:owner,manager,accounts');

// -- Finance: statements -----------------------------------------------------
$router->get('/finance/payables',    [FinanceController::class, 'payables'],       'staff:owner,manager,accounts');
$router->get('/finance/receivables', [FinanceController::class, 'receivables'],    'staff:owner,manager,accounts');
$router->get('/finance/gst-summary', [FinanceController::class, 'gstSummary'],     'staff:owner,manager,accounts');
$router->get('/finance/pl',          [FinanceController::class, 'profitAndLoss'],  'staff:owner,manager,accounts');

// -- Expenses (a financial document: read, approve and void are accounts) -----
$router->get('/expenses',                 [ExpenseController::class, 'index'],      'staff:owner,manager,accounts');
$router->get('/expenses/summary',         [ExpenseController::class, 'summary'],    'staff:owner,manager,accounts');
$router->get('/expenses/categories',      [ExpenseController::class, 'categories'], 'staff:owner,manager,accounts');
$router->get('/expenses/{id}',            [ExpenseController::class, 'show'],       'staff:owner,manager,accounts');
$router->post('/expenses',                [ExpenseController::class, 'store'],      'staff:owner,manager,accounts');
$router->put('/expenses/{id}',            [ExpenseController::class, 'update'],     'staff:owner,manager,accounts');
$router->post('/expenses/{id}/submit',    [ExpenseController::class, 'submit'],     'staff:owner,manager,accounts');
$router->post('/expenses/{id}/approve',   [ExpenseController::class, 'approve'],    'staff:owner,manager,accounts');
$router->post('/expenses/{id}/reject',    [ExpenseController::class, 'reject'],     'staff:owner,manager,accounts');
$router->post('/expenses/{id}/mark-paid', [ExpenseController::class, 'markPaid'],   'staff:owner,manager,accounts');
$router->post('/expenses/{id}/void',      [ExpenseController::class, 'void'],       'staff:owner,manager,accounts');

// -- Vouchers ----------------------------------------------------------------
$router->get('/vouchers',                          [VoucherController::class, 'index'],      'staff:owner,manager,operations');
$router->get('/vouchers/{id}',                     [VoucherController::class, 'show'],       'staff:owner,manager,operations');
$router->get('/bookings/{id}/vouchers',            [VoucherController::class, 'forBooking'], 'staff:owner,manager,operations');
$router->post('/bookings/{id}/vouchers',           [VoucherController::class, 'issue'],      'staff:owner,manager,operations');
$router->post('/bookings/{id}/vouchers/issue-all', [VoucherController::class, 'issueAll'],   'staff:owner,manager,operations');
$router->post('/vouchers/{id}/cancel',             [VoucherController::class, 'cancel'],     'staff:owner,manager,operations');
$router->post('/vouchers/{id}/send',               [VoucherController::class, 'markSent'],   'staff:owner,manager,operations');

// -- Operations --------------------------------------------------------------
$router->get('/ops/board',                 [OpsController::class, 'board'],               'staff:owner,manager,operations');
$router->get('/ops/calendar',              [OpsController::class, 'calendar'],            'staff:owner,manager,operations');
$router->get('/ops/departures-checklist',  [OpsController::class, 'departuresChecklist'], 'staff:owner,manager,operations');
$router->get('/ops/incidents',             [OpsController::class, 'incidents'],           'staff:owner,manager,operations');
$router->post('/ops/daysheets/{id}/checklist', [OpsController::class, 'toggleChecklist'], 'staff:owner,manager,operations');
$router->post('/ops/daysheets/{id}/issue',     [OpsController::class, 'flagIssue'],       'staff:owner,manager,operations');

$router->get('/trip-assignments',                 [OpsController::class, 'tripAssignments'],       'staff:owner,manager,operations');
$router->get('/trip-assignments/{id}',            [OpsController::class, 'showTripAssignment'],    'staff:owner,manager,operations');
$router->post('/bookings/{id}/trip-assignments',  [OpsController::class, 'storeTripAssignment'],   'staff:owner,manager,operations');
$router->put('/trip-assignments/{id}',            [OpsController::class, 'updateTripAssignment'],  'staff:owner,manager,operations');
$router->post('/trip-assignments/{id}/status',    [OpsController::class, 'changeTripStatus'],      'staff:owner,manager,operations');
$router->post('/trip-assignments/{id}/trip-sheet',[OpsController::class, 'submitTripSheet'],       'staff:owner,manager,operations');
$router->post('/trip-sheets/{id}/approve',        [OpsController::class, 'approveTripSheet'],      'staff:owner,manager,operations');
$router->post('/trip-sheets/{id}/reject',         [OpsController::class, 'rejectTripSheet'],       'staff:owner,manager,operations');

$router->post('/booking-services/{id}/confirm', [OpsController::class, 'confirmService'],   'staff:owner,manager,operations');
$router->post('/bookings/{id}/incidents',       [OpsController::class, 'storeIncident'],    'staff:owner,manager,operations');
$router->post('/incidents/{id}/resolve',        [OpsController::class, 'resolveIncident'],  'staff:owner,manager,operations');

// Attachments are cross-module (passports, receipts, bills), so any staff user
// may upload and read; only senior roles may destroy.
$router->get('/attachments',       [OpsController::class, 'listAttachments'],  'staff');
$router->post('/attachments',      [OpsController::class, 'uploadAttachment'], 'staff');
$router->get('/attachments/{id}',  [OpsController::class, 'streamAttachment'], 'staff');
$router->delete('/attachments/{id}', [OpsController::class, 'deleteAttachment'], 'staff:owner,manager,operations');

// -- Reports -----------------------------------------------------------------
// Anything exposing buying prices or margin is restricted to cost-visible roles.
$router->get('/reports/sales',                [ReportController::class, 'sales'],               'staff:owner,manager,accounts,operations');
$router->get('/reports/margin',               [ReportController::class, 'margin'],              'staff:owner,manager,accounts,operations');
$router->get('/reports/supplier-performance', [ReportController::class, 'supplierPerformance'], 'staff:owner,manager,accounts,operations');
$router->get('/reports/outstanding',          [ReportController::class, 'outstanding'],         'staff:owner,manager,accounts');
$router->get('/reports/pax-manifest',         [ReportController::class, 'paxManifest'],         'staff:owner,manager,operations');
$router->get('/reports/lead-source-roi',      [ReportController::class, 'leadSourceRoi'],       'staff:owner,manager,sales');

// -- Administration ----------------------------------------------------------
$router->get('/users',                       [AdminController::class, 'users'],             'staff:owner');
$router->get('/users/{id}',                  [AdminController::class, 'showUser'],          'staff:owner');
$router->post('/users',                      [AdminController::class, 'storeUser'],         'staff:owner');
$router->put('/users/{id}',                  [AdminController::class, 'updateUser'],        'staff:owner');
$router->post('/users/{id}/deactivate',      [AdminController::class, 'deactivateUser'],    'staff:owner');
$router->post('/users/{id}/activate',        [AdminController::class, 'activateUser'],      'staff:owner');
$router->post('/users/{id}/reset-password',  [AdminController::class, 'resetUserPassword'], 'staff:owner');

$router->get('/settings',           [AdminController::class, 'settings'],       'staff:owner');
$router->put('/settings',           [AdminController::class, 'updateSettings'], 'staff:owner');
$router->get('/settings/numbering', [AdminController::class, 'numbering'],      'staff:owner');
$router->get('/audit-log',          [AdminController::class, 'auditLog'],       'staff:owner');

// --- 14. Dispatch -----------------------------------------------------------

if (!defined('ROUTER_TEST_MODE')) {
    $router->dispatch();
}
