<?php
/**
 * DB-backed per-IP rate limiting.
 *
 * No Redis on shared hosting, so the counter lives in a table with an epoch-int
 * `created_at`. Old rows are pruned probabilistically (1 in 50 requests) so no
 * cron job is required.
 */
class RateLimitMiddleware
{
    public static function check(string $bucket): bool
    {
        $limits = Config::get('security.rate_limits', []);
        if (!isset($limits[$bucket])) {
            return true;
        }
        [$max, $window] = $limits[$bucket];

        $ip    = Request::ip();
        $now   = time();
        $since = $now - (int) $window;

        try {
            $used = (int) Database::scalar(
                'SELECT COUNT(*) FROM rate_limits WHERE ip = ? AND bucket = ? AND created_at >= ?',
                [$ip, $bucket, $since]
            );

            if ($used >= $max) {
                $oldest = (int) Database::scalar(
                    'SELECT MIN(created_at) FROM rate_limits WHERE ip = ? AND bucket = ? AND created_at >= ?',
                    [$ip, $bucket, $since]
                );
                $retryAfter = max(1, ($oldest + (int) $window) - $now);

                if (!headers_sent()) {
                    header('X-RateLimit-Limit: ' . $max);
                    header('X-RateLimit-Remaining: 0');
                    header('Retry-After: ' . $retryAfter);
                }
                Response::error('Too many requests. Please try again shortly.', 429);
                return false;
            }

            Database::execute(
                'INSERT INTO rate_limits (ip, bucket, created_at) VALUES (?, ?, ?)',
                [$ip, $bucket, $now]
            );

            if (!headers_sent()) {
                header('X-RateLimit-Limit: ' . $max);
                header('X-RateLimit-Remaining: ' . max(0, $max - $used - 1));
            }

            if (random_int(1, 50) === 1) {
                Database::execute('DELETE FROM rate_limits WHERE created_at < ?', [$now - 86400]);
            }
        } catch (Throwable $e) {
            // Fail OPEN. A rate-limiter outage must not take the whole API down;
            // the event is logged so it is visible.
            error_log('[ratelimit] ' . $e->getMessage());
        }

        return true;
    }

    /** Clear a bucket for an IP — called after a successful login. */
    public static function clear(string $bucket): void
    {
        try {
            Database::execute('DELETE FROM rate_limits WHERE ip = ? AND bucket = ?', [Request::ip(), $bucket]);
        } catch (Throwable $e) {
            error_log('[ratelimit] clear failed: ' . $e->getMessage());
        }
    }
}
