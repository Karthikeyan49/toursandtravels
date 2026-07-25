<?php
/**
 * JSON response envelope. Every endpoint in the API returns this shape:
 *
 *   { "success": bool, "data": mixed, "message": string?, "pagination": object? }
 *
 * Loaded before anything else in index.php because every fatal path needs it.
 */
class Response
{
    private static bool $sent = false;

    public static function json(array $payload, int $status = 200): void
    {
        if (self::$sent) {
            return; // never emit two bodies (e.g. exception during shutdown)
        }
        self::$sent = true;

        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('X-Content-Type-Options: nosniff');
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function success($data = null, ?string $message = null, int $status = 200): void
    {
        $out = ['success' => true, 'data' => $data];
        if ($message !== null) {
            $out['message'] = $message;
        }
        self::json($out, $status);
    }

    public static function created($data = null, ?string $message = 'Created'): void
    {
        self::success($data, $message, 201);
    }

    public static function error(string $message, int $status = 400, $errors = null): void
    {
        $out = ['success' => false, 'message' => $message];
        if ($errors !== null) {
            $out['errors'] = $errors;
        }
        self::json($out, $status);
    }

    public static function paginated(array $rows, int $page, int $limit, int $total, ?string $message = null): void
    {
        $out = [
            'success'    => true,
            'data'       => $rows,
            'pagination' => [
                'page'        => $page,
                'limit'       => $limit,
                'total'       => $total,
                'total_pages' => $limit > 0 ? (int) ceil($total / $limit) : 0,
            ],
        ];
        if ($message !== null) {
            $out['message'] = $message;
        }
        self::json($out, 200);
    }

    public static function unauthorized(string $message = 'Unauthorized'): void
    {
        self::error($message, 401);
    }

    public static function forbidden(string $message = 'Forbidden'): void
    {
        self::error($message, 403);
    }

    public static function notFound(string $message = 'Not found'): void
    {
        self::error($message, 404);
    }

    public static function validationFailed(array $errors, string $message = 'Validation failed'): void
    {
        self::error($message, 422, $errors);
    }
}
