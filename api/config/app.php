<?php
/**
 * Application configuration.
 *
 * .env lives ABOVE the web root and is parsed by hand — no Composer, no dotenv
 * package, because this deploys to shared hosting with no vendor/ directory.
 */

if (!defined('ROOT_PATH')) {
    define('ROOT_PATH', dirname(__DIR__));
}

/**
 * Parse the .env file once into a static map.
 *
 * Supports `KEY=value`, `KEY="value with spaces"`, `#` comments and blank lines.
 * Deliberately does NOT touch $_ENV/getenv() so a leaked phpinfo() cannot dump it.
 */
function env(string $key, $default = null)
{
    static $vars = null;

    if ($vars === null) {
        $vars = [];
        // In production the bundle layout is  <site>/.env  and  <site>/backend/…
        // so .env sits two levels above this file. Locally it sits one level above.
        $candidates = [
            dirname(ROOT_PATH) . '/.env',
            ROOT_PATH . '/.env',
        ];
        foreach ($candidates as $path) {
            if (!is_readable($path)) {
                continue;
            }
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) {
                    continue;
                }
                [$k, $v] = explode('=', $line, 2);
                $k = trim($k);
                $v = trim($v);
                $len = strlen($v);
                if ($len >= 2 && (($v[0] === '"' && $v[$len - 1] === '"') || ($v[0] === "'" && $v[$len - 1] === "'"))) {
                    $v = substr($v, 1, -1);
                }
                if (!array_key_exists($k, $vars)) {
                    $vars[$k] = $v;
                }
            }
            break; // first readable .env wins
        }
    }

    return array_key_exists($key, $vars) ? $vars[$key] : $default;
}

return [
    'app' => [
        'name'      => env('APP_NAME', 'Tours & Travel ERP'),
        'env'       => env('APP_ENV', 'production'),   // fail closed: assume prod
        'debug'     => env('APP_ENV', 'production') === 'development',
        'timezone'  => env('APP_TIMEZONE', 'Asia/Kolkata'),
        'url'       => env('APP_URL', ''),
        'currency'  => env('APP_CURRENCY', 'INR'),
    ],

    'db' => [
        'host'    => env('DB_HOST', 'localhost'),
        'port'    => (int) env('DB_PORT', '3306'),
        'name'    => env('DB_NAME', ''),
        'user'    => env('DB_USER', ''),
        'pass'    => env('DB_PASS', ''),
        'charset' => 'utf8mb4',
        'collate' => 'utf8mb4_unicode_ci',
    ],

    'jwt' => [
        'secret' => env('JWT_SECRET', ''),
        'issuer' => env('JWT_ISSUER', 'tours-travel-erp'),
        'alg'    => 'HS256',
        // Client-type dependent lifetimes. A phone in a driver's pocket cannot be
        // asked to re-login daily; a browser on a shared office PC must be.
        'ttl' => [
            'web'    => ['access' => 86400,   'refresh' => 604800],    // 1d / 7d
            'mobile' => ['access' => 2592000, 'refresh' => 15552000],  // 30d / 180d
        ],
    ],

    'cors' => [
        // Comma-separated exact-match allowlist. Never '*'.
        'origins' => array_values(array_filter(array_map('trim', explode(',', (string) env('CORS_ORIGIN', ''))))),
        'max_age' => 86400,
    ],

    'security' => [
        'password_min_length' => 8,
        'bcrypt_cost'         => 12,
        'max_failed_logins'   => 5,
        'lockout_minutes'     => 15,
        'reset_token_ttl'     => 900,  // 15 minutes, not 30 days
        'rate_limits' => [
            // bucket => [max requests, window seconds]
            'general'  => [300, 60],
            'login'    => [5,   900],
            'register' => [3,   3600],
            'reset'    => [5,   3600],
            'export'   => [30,  3600],
        ],
    ],

    'uploads' => [
        'root'      => ROOT_PATH . '/uploads',
        'max_bytes' => 8 * 1024 * 1024,
    ],
];
