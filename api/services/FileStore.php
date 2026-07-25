<?php
/**
 * Hardened upload store.
 *
 * Threat model, in order of what actually happens to small PHP apps:
 *   1. Upload a .php (or .phtml/.phar) and request it back → remote code execution.
 *   2. Upload an SVG or HTML file and have a browser render it → stored XSS.
 *   3. Claim a benign Content-Type in the multipart part while the bytes are not.
 *   4. Traverse out of the uploads root when reading a file back.
 *
 * The defences, in the same order:
 *   1. Per-category extension allowlist PLUS a hard denylist, and a stored name of
 *      random bytes so the client never controls the path at all.
 *   2. No renderable type is ever on an allowlist, and downloads are served with
 *      nosniff and a private, no-store cache policy.
 *   3. The MIME is taken from finfo on the temporary file, never from the client.
 *   4. resolveLocalPath() rejects '..' and realpath-confines to the uploads root.
 */
class FileStore
{
    /**
     * category => [ext allowlist, MIME allowlist, max bytes]
     *
     * Both lists must match: an allowed extension carrying a disallowed MIME is
     * rejected, and vice versa.
     */
    private const CATEGORIES = [
        'passport' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'pdf'],
            'mime' => ['image/jpeg', 'image/png', 'application/pdf'],
            'max'  => 5242880,          // 5 MB — a passport scan is never bigger
        ],
        'visa' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'pdf'],
            'mime' => ['image/jpeg', 'image/png', 'application/pdf'],
            'max'  => 5242880,
        ],
        'customer_doc' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'pdf'],
            'mime' => ['image/jpeg', 'image/png', 'application/pdf'],
            'max'  => 8388608,
        ],
        'voucher' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'pdf'],
            'mime' => ['image/jpeg', 'image/png', 'application/pdf'],
            'max'  => 8388608,
        ],
        'supplier_bill' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'pdf'],
            'mime' => ['image/jpeg', 'image/png', 'application/pdf'],
            'max'  => 8388608,
        ],
        'expense_receipt' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'pdf'],
            'mime' => ['image/jpeg', 'image/png', 'application/pdf'],
            'max'  => 5242880,
        ],
        'package_image' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'webp'],
            'mime' => ['image/jpeg', 'image/png', 'image/webp'],
            'max'  => 4194304,
        ],
        'hotel_image' => [
            'ext'  => ['jpg', 'jpeg', 'png', 'webp'],
            'mime' => ['image/jpeg', 'image/png', 'image/webp'],
            'max'  => 4194304,
        ],
        'import' => [
            'ext'  => ['csv', 'xlsx'],
            // finfo reports spreadsheets inconsistently across libmagic builds, so
            // the accepted set is deliberately wide here — the extension allowlist
            // and the fact that imports are parsed, never executed, carry the risk.
            'mime' => [
                'text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/zip', 'application/octet-stream',
            ],
            'max'  => 10485760,        // 10 MB
        ],
    ];

    /**
     * Never storable, whatever the category says. Every entry here is either
     * executable by the web server or renderable (and therefore scriptable) by a
     * browser. `svg` is on the list because an SVG is an XML document that can
     * carry <script>.
     */
    private const DANGEROUS_EXTENSIONS = [
        'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phtml', 'phar',
        'exe', 'dll', 'bat', 'cmd', 'com', 'sh', 'bash', 'cgi', 'pl', 'py',
        'js', 'mjs', 'jsp', 'asp', 'aspx', 'html', 'htm', 'xhtml', 'svg', 'swf', 'htaccess',
    ];

    private const DEFAULT_MAX_BYTES = 8388608;   // 8 MB

    /** Types a browser may render inline; everything else is forced to download. */
    private const INLINE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

    public static function categories(): array
    {
        return array_keys(self::CATEGORIES);
    }

    /**
     * Validate and move one uploaded file.
     *
     * @param array $file one entry of $_FILES
     * @return array{path:string, original_name:string, mime_type:string, size_bytes:int}
     */
    public static function store(array $file, string $category): array
    {
        $rules = self::CATEGORIES[$category] ?? null;
        if ($rules === null) {
            throw new ValidationException(['category' => ['Unknown upload category: ' . $category]]);
        }

        self::assertUploadOk($file);

        $tmp = (string) $file['tmp_name'];
        // is_uploaded_file is the only way to know the path came from this
        // request's multipart body and not from an attacker-controlled string.
        if (!is_uploaded_file($tmp)) {
            throw new ValidationException(['file' => ['Upload could not be verified']]);
        }

        $size = (int) $file['size'];
        $max  = (int) ($rules['max'] ?? self::DEFAULT_MAX_BYTES);
        if ($size <= 0) {
            throw new ValidationException(['file' => ['The uploaded file is empty']]);
        }
        if ($size > $max) {
            throw new ValidationException(['file' => [
                'File exceeds the ' . self::humanBytes($max) . ' limit for ' . $category . ' uploads',
            ]]);
        }

        $originalName = self::sanitiseName((string) ($file['name'] ?? 'upload'));
        $ext = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));

        if ($ext === '' || in_array($ext, self::DANGEROUS_EXTENSIONS, true)) {
            throw new ValidationException(['file' => ['This file type is not permitted']]);
        }
        if (!in_array($ext, $rules['ext'], true)) {
            throw new ValidationException(['file' => [
                'Allowed file types for ' . $category . ': ' . implode(', ', $rules['ext']),
            ]]);
        }

        // The real content type, read from the bytes — the client-supplied
        // $file['type'] is attacker-controlled and is never consulted.
        $mime = self::detectMime($tmp);
        if (!in_array($mime, $rules['mime'], true)) {
            throw new ValidationException(['file' => [
                'File content (' . $mime . ') does not match the ' . strtoupper($ext) . ' extension',
            ]]);
        }

        // For image categories, a second opinion: a file that libmagic calls an
        // image but GD cannot parse is not an image we want to serve.
        if (in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)
            && function_exists('getimagesize')
            && @getimagesize($tmp) === false) {
            throw new ValidationException(['file' => ['The image file is corrupt or not a real image']]);
        }

        $relativeDir = $category . '/' . date('Y') . '/' . date('m');
        $absoluteDir = self::root() . '/' . $relativeDir;
        self::ensureDirectory($absoluteDir);

        // The stored name carries no client input whatsoever.
        $storedName   = bin2hex(random_bytes(16)) . '.' . $ext;
        $relativePath = $relativeDir . '/' . $storedName;
        $absolutePath = $absoluteDir . '/' . $storedName;

        if (!move_uploaded_file($tmp, $absolutePath)) {
            throw new RuntimeException('Failed to store the uploaded file');
        }
        @chmod($absolutePath, 0644);

        return [
            'path'          => $relativePath,
            'original_name' => $originalName,
            'mime_type'     => $mime,
            'size_bytes'    => $size,
        ];
    }

    /**
     * Store a file and record it against any entity in the polymorphic table.
     *
     * @return int attachments.id
     */
    public static function createAttachment(
        string $entityType,
        int $entityId,
        array $file,
        string $category,
        ?array $metadata = null
    ): int {
        $stored = self::store($file, $category);

        $id = Database::insert('attachments', [
            'entity_type'   => mb_substr($entityType, 0, 60),
            'entity_id'     => $entityId,
            'category'      => mb_substr($category, 0, 40),
            'file_path'     => $stored['path'],
            'original_name' => mb_substr($stored['original_name'], 0, 255),
            'mime_type'     => mb_substr($stored['mime_type'], 0, 100),
            'size_bytes'    => $stored['size_bytes'],
            'metadata_json' => $metadata !== null
                ? (string) json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                : null,
            'uploaded_by'   => Request::userId(),
        ], [
            'entity_type', 'entity_id', 'category', 'file_path', 'original_name',
            'mime_type', 'size_bytes', 'metadata_json', 'uploaded_by',
        ]);

        Audit::log('attachment_uploaded', $entityType, $entityId, null, [
            'attachment_id' => $id,
            'category'      => $category,
            'original_name' => $stored['original_name'],
            'size_bytes'    => $stored['size_bytes'],
        ]);

        return $id;
    }

    public static function find(int $id): ?array
    {
        return Database::fetch(
            'SELECT a.*, u.full_name AS uploaded_by_name
               FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
              WHERE a.id = ? LIMIT 1',
            [$id]
        );
    }

    public static function forEntity(string $entityType, int $entityId, ?string $category = null): array
    {
        $sql = 'SELECT a.id, a.category, a.original_name, a.mime_type, a.size_bytes,
                       a.metadata_json, a.created_at, u.full_name AS uploaded_by_name
                  FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
                 WHERE a.entity_type = ? AND a.entity_id = ?';
        $params = [$entityType, $entityId];

        if ($category !== null && $category !== '') {
            $sql .= ' AND a.category = ?';
            $params[] = $category;
        }

        return Database::fetchAll($sql . ' ORDER BY a.id ASC', $params);
    }

    /**
     * Turn a stored relative path into an absolute one that is provably inside
     * the uploads root. Any traversal attempt, symlink escape or missing file is
     * a NotFoundException — never a partially-resolved path.
     */
    public static function resolveLocalPath(string $relativePath): string
    {
        $relativePath = str_replace('\\', '/', trim($relativePath));

        if ($relativePath === ''
            || strpos($relativePath, "\0") !== false
            || strpos($relativePath, '..') !== false
            || $relativePath[0] === '/') {
            throw new NotFoundException('File not found');
        }

        $root = realpath(self::root());
        if ($root === false) {
            throw new NotFoundException('File not found');
        }

        $absolute = realpath($root . '/' . $relativePath);
        if ($absolute === false || !is_file($absolute)) {
            throw new NotFoundException('File not found');
        }

        // realpath() has resolved every symlink by now, so a prefix test is a
        // real containment test rather than a string trick.
        if (strncmp($absolute, $root . DIRECTORY_SEPARATOR, strlen($root) + 1) !== 0) {
            throw new NotFoundException('File not found');
        }

        return $absolute;
    }

    /** Send an attachment to the client. Terminates the request. */
    public static function stream(int $id): void
    {
        $attachment = self::find($id);
        if ($attachment === null) {
            throw new NotFoundException('Attachment not found');
        }

        $absolute = self::resolveLocalPath((string) $attachment['file_path']);
        $mime     = (string) $attachment['mime_type'];
        $inline   = in_array($mime, self::INLINE_MIME, true);
        $name     = self::sanitiseName((string) $attachment['original_name']);

        if (!headers_sent()) {
            header('Content-Type: ' . $mime);
            header('Content-Length: ' . (string) filesize($absolute));
            header(($inline ? 'Content-Disposition: inline' : 'Content-Disposition: attachment')
                . '; filename="' . $name . '"');
            // Customer passports and supplier bills must not sit in a shared proxy
            // cache or on disk in the browser cache.
            header('Cache-Control: private, no-store');
            header('Pragma: no-cache');
            header('X-Content-Type-Options: nosniff');
            header("Content-Security-Policy: default-src 'none'; sandbox");
        }

        // Drop any buffered output so the body is exactly the file bytes.
        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        readfile($absolute);

        Audit::log('attachment_downloaded', (string) $attachment['entity_type'], (int) $attachment['entity_id'], null, [
            'attachment_id' => $id,
        ]);
    }

    /** Remove the row and the file. A missing file is not an error. */
    public static function delete(int $id): void
    {
        $attachment = self::find($id);
        if ($attachment === null) {
            throw new NotFoundException('Attachment not found');
        }

        try {
            $absolute = self::resolveLocalPath((string) $attachment['file_path']);
            @unlink($absolute);
        } catch (NotFoundException $e) {
            // Row without a file: still remove the row, so the list stays honest.
            error_log('[filestore] missing file for attachment ' . $id . ': ' . $attachment['file_path']);
        }

        Database::execute('DELETE FROM attachments WHERE id = ?', [$id]);

        Audit::log('attachment_deleted', (string) $attachment['entity_type'], (int) $attachment['entity_id'], $attachment, null);
    }

    // -----------------------------------------------------------------------

    private static function root(): string
    {
        return rtrim((string) Config::get('uploads.root', ROOT_PATH . '/uploads'), '/');
    }

    private static function assertUploadOk(array $file): void
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error === UPLOAD_ERR_OK) {
            return;
        }

        $messages = [
            UPLOAD_ERR_INI_SIZE   => 'The file is larger than the server allows',
            UPLOAD_ERR_FORM_SIZE  => 'The file is larger than the form allows',
            UPLOAD_ERR_PARTIAL    => 'The upload was interrupted — please retry',
            UPLOAD_ERR_NO_FILE    => 'No file was uploaded',
            UPLOAD_ERR_NO_TMP_DIR => 'Server upload directory is missing',
            UPLOAD_ERR_CANT_WRITE => 'Server could not write the uploaded file',
            UPLOAD_ERR_EXTENSION  => 'The upload was blocked by a server extension',
        ];

        throw new ValidationException(['file' => [$messages[$error] ?? 'Upload failed']]);
    }

    private static function detectMime(string $path): string
    {
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo !== false) {
                $mime = finfo_file($finfo, $path);
                finfo_close($finfo);
                if (is_string($mime) && $mime !== '') {
                    return strtolower(trim(explode(';', $mime)[0]));
                }
            }
        }
        // Without fileinfo we cannot verify content, so nothing is accepted —
        // failing closed is the only safe behaviour for an upload endpoint.
        throw new RuntimeException('Server cannot verify file types (ext-fileinfo is not installed)');
    }

    /** Keep a readable download name without letting it steer a path or a header. */
    private static function sanitiseName(string $name): string
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = preg_replace('/[^\w.\- ]+/u', '_', $name) ?? 'file';
        $name = trim(preg_replace('/\s+/', ' ', $name) ?? 'file');
        $name = ltrim($name, '.');                       // no dotfiles
        return $name === '' ? 'file' : mb_substr($name, 0, 120);
    }

    /**
     * Create the target directory, and on first use drop a hardening .htaccess in
     * the uploads root. Defence in depth: even if a bad file ever lands here,
     * Apache will not execute it and will not serve it inline.
     */
    private static function ensureDirectory(string $absoluteDir): void
    {
        if (!is_dir($absoluteDir) && !@mkdir($absoluteDir, 0755, true) && !is_dir($absoluteDir)) {
            throw new RuntimeException('Failed to create the upload directory');
        }

        $guard = self::root() . '/.htaccess';
        if (!file_exists($guard)) {
            @file_put_contents($guard, implode("\n", [
                '# Generated by FileStore. Uploads are data, never code.',
                '<IfModule mod_php.c>',
                '  php_flag engine off',
                '</IfModule>',
                '<IfModule mod_headers.c>',
                '  Header set X-Content-Type-Options "nosniff"',
                '  Header set Content-Security-Policy "default-src \'none\'; sandbox"',
                '</IfModule>',
                'Options -Indexes -ExecCGI',
                'AddType text/plain .php .phtml .phar .cgi .pl .py .sh .html .htm .svg',
                '<FilesMatch "\.(php[0-9]?|phtml|phar|cgi|pl|py|sh|exe|dll|bat|cmd)$">',
                '  Require all denied',
                '</FilesMatch>',
                '',
            ]));
        }
    }

    private static function humanBytes(int $bytes): string
    {
        if ($bytes >= 1048576) {
            return round($bytes / 1048576, 1) . ' MB';
        }
        return round($bytes / 1024) . ' KB';
    }
}
