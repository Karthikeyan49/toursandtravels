<?php
/**
 * Minimal HS256 JWT. Hand-rolled because this deploys with no Composer.
 *
 * Only HS256 is accepted. The `alg` header from the token is never used to pick
 * the verification algorithm — that is the classic "alg: none" / algorithm
 * confusion bug. We verify with our configured algorithm and compare in
 * constant time.
 */
class JWT
{
    public static function encode(array $claims, string $secret, int $ttlSeconds): string
    {
        $now = time();
        $payload = array_merge([
            'iss' => Config::get('jwt.issuer', 'tours-travel-erp'),
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + $ttlSeconds,
            'jti' => bin2hex(random_bytes(16)),
        ], $claims);

        $header  = self::b64(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
        $body    = self::b64(json_encode($payload));
        $sig     = self::b64(hash_hmac('sha256', $header . '.' . $body, $secret, true));

        return $header . '.' . $body . '.' . $sig;
    }

    /**
     * @return array<string,mixed>|null decoded claims, or null when invalid/expired
     */
    public static function decode(string $token, string $secret): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$header, $body, $sig] = $parts;

        $expected = self::b64(hash_hmac('sha256', $header . '.' . $body, $secret, true));
        if (!hash_equals($expected, $sig)) {
            return null;
        }

        $head = json_decode(self::unb64($header), true);
        if (!is_array($head) || ($head['alg'] ?? '') !== 'HS256') {
            return null;
        }

        $claims = json_decode(self::unb64($body), true);
        if (!is_array($claims)) {
            return null;
        }

        $now = time();
        // 60s leeway absorbs clock skew between the app server and a mobile client.
        if (isset($claims['exp']) && $now >= ((int) $claims['exp'] + 60)) {
            return null;
        }
        if (isset($claims['nbf']) && $now < ((int) $claims['nbf'] - 60)) {
            return null;
        }
        if (isset($claims['iss']) && $claims['iss'] !== Config::get('jwt.issuer', 'tours-travel-erp')) {
            return null;
        }

        return $claims;
    }

    private static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function unb64(string $b64): string
    {
        $pad = strlen($b64) % 4;
        if ($pad) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        return (string) base64_decode(strtr($b64, '-_', '+/'));
    }
}
