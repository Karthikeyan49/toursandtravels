<?php
/**
 * Dot-path accessor over the array returned by config/app.php.
 */
class Config
{
    private static array $items = [];

    public static function load(array $config): void
    {
        self::$items = $config;
    }

    public static function get(string $path, $default = null)
    {
        $node = self::$items;
        foreach (explode('.', $path) as $segment) {
            if (!is_array($node) || !array_key_exists($segment, $node)) {
                return $default;
            }
            $node = $node[$segment];
        }
        return $node;
    }

    public static function isProduction(): bool
    {
        return self::get('app.env', 'production') === 'production';
    }
}
