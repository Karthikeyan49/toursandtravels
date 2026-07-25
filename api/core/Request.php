<?php
/**
 * Request accessor. Parses the body once and exposes typed, filtered readers.
 */
class Request
{
    private static ?array $body = null;
    private static array $routeParams = [];
    /** @var array<string,mixed>|null Authenticated user, set by AuthMiddleware */
    private static ?array $user = null;

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function path(): string
    {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        // Strip a /api prefix so the same route table works whether the app is
        // mounted at the docroot or behind the public_html/api bridge.
        $uri = preg_replace('#^/api#', '', $uri) ?: '/';
        return '/' . trim($uri, '/');
    }

    /** Decoded request body (JSON or form-encoded). */
    public static function body(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }

        $contentType = strtolower($_SERVER['CONTENT_TYPE'] ?? '');

        if (strpos($contentType, 'application/json') !== false) {
            $raw = file_get_contents('php://input') ?: '';
            $decoded = json_decode($raw, true);
            self::$body = is_array($decoded) ? $decoded : [];
        } elseif (strpos($contentType, 'multipart/form-data') !== false) {
            self::$body = $_POST;
        } elseif (self::method() === 'GET') {
            self::$body = [];
        } else {
            // form-urlencoded on PUT/PATCH/DELETE does not populate $_POST.
            $raw = file_get_contents('php://input') ?: '';
            parse_str($raw, $parsed);
            self::$body = $_POST !== [] ? $_POST : (is_array($parsed) ? $parsed : []);
        }

        return self::$body;
    }

    /** Single body field. */
    public static function input(string $key, $default = null)
    {
        $b = self::body();
        return array_key_exists($key, $b) ? $b[$key] : $default;
    }

    /**
     * Pick only the listed keys from the body. This is the ONLY way controllers
     * should read a payload — it makes mass-assignment structurally impossible.
     */
    public static function only(array $keys): array
    {
        $b = self::body();
        $out = [];
        foreach ($keys as $k) {
            if (array_key_exists($k, $b)) {
                $out[$k] = $b[$k];
            }
        }
        return $out;
    }

    public static function has(string $key): bool
    {
        return array_key_exists($key, self::body());
    }

    public static function query(string $key, $default = null)
    {
        return array_key_exists($key, $_GET) ? $_GET[$key] : $default;
    }

    public static function queryInt(string $key, int $default = 0): int
    {
        $v = self::query($key);
        return is_numeric($v) ? (int) $v : $default;
    }

    public static function queryBool(string $key, ?bool $default = null): ?bool
    {
        $v = self::query($key);
        if ($v === null || $v === '') {
            return $default;
        }
        return in_array(strtolower((string) $v), ['1', 'true', 'yes', 'on'], true);
    }

    /** Page/limit with a hard ceiling so a client cannot request 1e9 rows. */
    public static function pagination(int $defaultLimit = 50, int $maxLimit = 200): array
    {
        $page  = max(1, self::queryInt('page', 1));
        $limit = self::queryInt('limit', $defaultLimit);
        $limit = max(1, min($limit, $maxLimit));
        return [$page, $limit, ($page - 1) * $limit];
    }

    public static function setRouteParams(array $params): void
    {
        self::$routeParams = $params;
    }

    public static function param(string $key, $default = null)
    {
        return self::$routeParams[$key] ?? $default;
    }

    public static function paramInt(string $key): int
    {
        return (int) self::param($key, 0);
    }

    /**
     * Bearer token. The `?token=` query fallback is accepted ONLY on GET — a
     * token in an access log must never be replayable against a state change.
     */
    public static function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($header === '' && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            foreach ($headers as $k => $v) {
                if (strcasecmp($k, 'Authorization') === 0) {
                    $header = $v;
                    break;
                }
            }
        }
        if (preg_match('/^Bearer\s+(\S+)$/i', trim($header), $m)) {
            return $m[1];
        }
        if (self::method() === 'GET' && !empty($_GET['token'])) {
            return (string) $_GET['token'];
        }
        return null;
    }

    public static function clientType(): string
    {
        $t = strtolower($_SERVER['HTTP_X_CLIENT_TYPE'] ?? 'web');
        return $t === 'mobile' ? 'mobile' : 'web';
    }

    /** Client IP, trusting X-Forwarded-For only when it parses as a real IP. */
    public static function ip(): string
    {
        $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if ($xff !== '') {
            $first = trim(explode(',', $xff)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP)) {
                return $first;
            }
        }
        $remote = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        return filter_var($remote, FILTER_VALIDATE_IP) ? $remote : '0.0.0.0';
    }

    public static function userAgent(): string
    {
        return substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    }

    public static function setUser(?array $user): void
    {
        self::$user = $user;
    }

    public static function user(): ?array
    {
        return self::$user;
    }

    public static function userId(): ?int
    {
        return isset(self::$user['id']) ? (int) self::$user['id'] : null;
    }

    public static function staffRole(): ?string
    {
        return self::$user['staff_role'] ?? null;
    }
}
