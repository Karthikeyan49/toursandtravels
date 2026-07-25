<?php
/**
 * Rule-string validator.
 *
 *   Validator::make($data, [
 *       'full_name'   => 'required|string|max:150',
 *       'phone'       => 'required|phone',
 *       'travel_from' => 'required|date',
 *       'adults'      => 'required|int|min:1|max:99',
 *       'status'      => 'in:draft,confirmed',
 *       'email'       => 'nullable|email',
 *   ]);
 *
 * Returns the coerced payload (ints as int, decimals as float, trimmed strings)
 * or throws ValidationException with a field => [messages] map.
 */
class Validator
{
    public static function make(array $data, array $rules): array
    {
        $out    = [];
        $errors = [];

        foreach ($rules as $field => $ruleString) {
            $rulesList = explode('|', $ruleString);
            $value     = $data[$field] ?? null;
            $present   = array_key_exists($field, $data);
            $nullable  = in_array('nullable', $rulesList, true);
            $required  = in_array('required', $rulesList, true);

            if (is_string($value)) {
                $value = trim($value);
            }

            $isEmpty = $value === null || $value === '';

            if ($required && $isEmpty) {
                $errors[$field][] = self::label($field) . ' is required';
                continue;
            }
            if ($isEmpty) {
                if ($present && $nullable) {
                    $out[$field] = null;
                }
                continue;
            }

            foreach ($rulesList as $rule) {
                if ($rule === '' || $rule === 'required' || $rule === 'nullable') {
                    continue;
                }
                [$name, $arg] = array_pad(explode(':', $rule, 2), 2, null);
                $error = self::apply($name, $arg, $field, $value);
                if ($error !== null) {
                    $errors[$field][] = $error;
                    continue 2;
                }
                $value = self::coerce($name, $value);
            }

            $out[$field] = $value;
        }

        if ($errors !== []) {
            throw new ValidationException($errors);
        }

        return $out;
    }

    private static function apply(string $rule, ?string $arg, string $field, $value): ?string
    {
        $label = self::label($field);

        switch ($rule) {
            case 'string':
                return is_scalar($value) ? null : "$label must be text";

            case 'int':
                return (is_int($value) || (is_string($value) && preg_match('/^-?\d+$/', $value)))
                    ? null : "$label must be a whole number";

            case 'decimal':
            case 'numeric':
                return is_numeric($value) ? null : "$label must be a number";

            case 'money':
                if (!is_numeric($value)) {
                    return "$label must be an amount";
                }
                return ((float) $value) >= 0 ? null : "$label cannot be negative";

            case 'bool':
                return in_array((string) $value, ['0', '1', 'true', 'false', 'yes', 'no', 'on', 'off'], true)
                    ? null : "$label must be true or false";

            case 'email':
                return filter_var($value, FILTER_VALIDATE_EMAIL) ? null : "$label must be a valid email address";

            case 'phone':
                return preg_match('/^\+?[0-9][0-9\s\-]{6,19}$/', (string) $value)
                    ? null : "$label must be a valid phone number";

            case 'url':
                return filter_var($value, FILTER_VALIDATE_URL) ? null : "$label must be a valid URL";

            case 'date':
                return self::isDate((string) $value, 'Y-m-d') ? null : "$label must be a date (YYYY-MM-DD)";

            case 'datetime':
                return (self::isDate((string) $value, 'Y-m-d H:i:s') || self::isDate((string) $value, 'Y-m-d\TH:i:s') || self::isDate((string) $value, 'Y-m-d H:i'))
                    ? null : "$label must be a date and time";

            case 'time':
                return self::isDate((string) $value, 'H:i:s') || self::isDate((string) $value, 'H:i')
                    ? null : "$label must be a time (HH:MM)";

            case 'min':
                if (is_numeric($value)) {
                    return ((float) $value) >= (float) $arg ? null : "$label must be at least $arg";
                }
                return mb_strlen((string) $value) >= (int) $arg ? null : "$label must be at least $arg characters";

            case 'max':
                if (is_numeric($value)) {
                    return ((float) $value) <= (float) $arg ? null : "$label must not exceed $arg";
                }
                return mb_strlen((string) $value) <= (int) $arg ? null : "$label must not exceed $arg characters";

            case 'in':
                $allowed = explode(',', (string) $arg);
                return in_array((string) $value, $allowed, true)
                    ? null : "$label must be one of: " . implode(', ', $allowed);

            case 'gstin':
                return preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/', strtoupper((string) $value))
                    ? null : "$label is not a valid GSTIN";

            case 'pan':
                return preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', strtoupper((string) $value))
                    ? null : "$label is not a valid PAN";

            case 'ifsc':
                return preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', strtoupper((string) $value))
                    ? null : "$label is not a valid IFSC code";

            case 'passport':
                return preg_match('/^[A-Z0-9]{6,15}$/i', (string) $value)
                    ? null : "$label is not a valid passport number";

            case 'array':
                return is_array($value) ? null : "$label must be a list";

            case 'code':
                return preg_match('/^[A-Za-z0-9_\-]{1,30}$/', (string) $value)
                    ? null : "$label may only contain letters, numbers, hyphen and underscore";

            default:
                return null; // unknown rule = no-op, so a typo never blocks a save silently
        }
    }

    private static function coerce(string $rule, $value)
    {
        switch ($rule) {
            case 'int':
                return (int) $value;
            case 'decimal':
            case 'numeric':
            case 'money':
                return (float) $value;
            case 'bool':
                return in_array((string) $value, ['1', 'true', 'yes', 'on'], true) ? 1 : 0;
            case 'gstin':
            case 'pan':
            case 'ifsc':
                return strtoupper((string) $value);
            default:
                return $value;
        }
    }

    private static function isDate(string $value, string $format): bool
    {
        $d = DateTime::createFromFormat($format, $value);
        return $d !== false && $d->format($format) === $value;
    }

    private static function label(string $field): string
    {
        return ucfirst(str_replace('_', ' ', $field));
    }

    /** Convenience: assert $to is on or after $from. */
    public static function assertDateOrder(?string $from, ?string $to, string $field = 'travel_to'): void
    {
        if ($from === null || $to === null) {
            return;
        }
        if (strtotime($to) < strtotime($from)) {
            throw new ValidationException([$field => ['End date cannot be before start date']]);
        }
    }
}
