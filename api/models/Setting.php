<?php

class Setting
{
    private static ?array $cache = null;

    public static function all(bool $publicOnly = false): array
    {
        if (self::$cache === null) {
            self::$cache = [];
            foreach (Database::fetchAll('SELECT setting_key, setting_value, value_type, description, is_public FROM settings') as $row) {
                self::$cache[$row['setting_key']] = $row;
            }
        }
        if (!$publicOnly) {
            return self::$cache;
        }
        return array_filter(self::$cache, static fn($r) => (int) $r['is_public'] === 1);
    }

    public static function get(string $key, $default = null)
    {
        $row = self::all()[$key] ?? null;
        if ($row === null || $row['setting_value'] === null || $row['setting_value'] === '') {
            return $default;
        }
        return self::cast($row['setting_value'], $row['value_type']);
    }

    public static function decimal(string $key, float $default = 0.0): float
    {
        $v = self::get($key, $default);
        return is_numeric($v) ? (float) $v : $default;
    }

    public static function int(string $key, int $default = 0): int
    {
        $v = self::get($key, $default);
        return is_numeric($v) ? (int) $v : $default;
    }

    /** Flat key => value map for the client. */
    public static function map(bool $publicOnly = false): array
    {
        $out = [];
        foreach (self::all($publicOnly) as $key => $row) {
            $out[$key] = self::cast($row['setting_value'], $row['value_type']);
        }
        return $out;
    }

    /**
     * Upsert. Only keys that already exist are written — a client cannot create
     * arbitrary settings rows, so the key space stays a closed set.
     */
    public static function put(string $key, $value): bool
    {
        $known = self::all();
        if (!array_key_exists($key, $known)) {
            return false;
        }
        Database::execute(
            'UPDATE settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
            [is_array($value) ? json_encode($value) : (string) $value, Request::userId(), $key]
        );
        self::$cache = null;
        return true;
    }

    private static function cast(?string $value, string $type)
    {
        if ($value === null) {
            return null;
        }
        switch ($type) {
            case 'int':     return (int) $value;
            case 'decimal': return (float) $value;
            case 'bool':    return in_array(strtolower($value), ['1', 'true', 'yes'], true);
            case 'json':    return json_decode($value, true);
            default:        return $value;
        }
    }

    /** Company block used by invoices, quotations and vouchers. */
    public static function companyProfile(): array
    {
        $m = self::map();
        return [
            'name'          => $m['company_name']          ?? '',
            'legal_name'    => $m['company_legal_name']    ?? '',
            'address'       => $m['company_address']       ?? '',
            'city'          => $m['company_city']          ?? '',
            'state'         => $m['company_state']         ?? '',
            'pincode'       => $m['company_pincode']       ?? '',
            'phone'         => $m['company_phone']         ?? '',
            'email'         => $m['company_email']         ?? '',
            'website'       => $m['company_website']       ?? '',
            'gstin'         => $m['company_gstin']         ?? '',
            'pan'           => $m['company_pan']           ?? '',
            'logo'          => $m['company_logo']          ?? '',
            'primary_color' => $m['company_primary_color'] ?? '#0F766E',
            'iata_number'   => $m['iata_number']           ?? '',
            'bank' => [
                'name'         => $m['bank_name']         ?? '',
                'account_name' => $m['bank_account_name'] ?? '',
                'account_no'   => $m['bank_account_no']   ?? '',
                'ifsc'         => $m['bank_ifsc']         ?? '',
                'upi_id'       => $m['bank_upi_id']       ?? '',
            ],
        ];
    }
}
