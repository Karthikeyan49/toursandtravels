<?php
/**
 * CSV and JSON export.
 *
 * The one non-obvious thing in here is csvSafe(). A CSV cell beginning with
 * `=`, `+`, `-`, `@`, TAB or CR is interpreted as a FORMULA by Excel, LibreOffice
 * and Google Sheets. A customer called `=cmd|'/c calc'!A1` — or, far more likely,
 * a supplier note pasted in by a user — becomes code the moment an accountant
 * opens the export. Prefixing with an apostrophe forces the cell to text; the
 * apostrophe is not displayed by the spreadsheet.
 *
 * Everything here writes directly to the output stream instead of building a
 * string, so a 50k-row report never sits in memory.
 */
class Exporter
{
    /** Characters that make a spreadsheet treat a cell as a formula. */
    private const FORMULA_TRIGGERS = ['=', '+', '-', '@', "\t", "\r"];

    private static bool $sent = false;

    /**
     * Neutralise formula injection in a single cell.
     *
     * Applied to every value including headers — a column label is just as
     * capable of starting with '-' as a data value is.
     */
    public static function csvSafe($value): string
    {
        if ($value === null || $value === false) {
            return '';
        }
        if (is_bool($value)) {
            return '1';
        }
        if (is_array($value)) {
            $value = implode(' | ', array_map(static fn($v) => is_scalar($v) ? (string) $v : '', $value));
        }

        $text = (string) $value;
        if ($text === '') {
            return '';
        }

        if (in_array($text[0], self::FORMULA_TRIGGERS, true)) {
            return "'" . $text;
        }

        return $text;
    }

    /**
     * Stream rows as CSV.
     *
     * @param array $rows    list of associative rows
     * @param array $columns ['db_key' => 'Header'] — or a plain list of keys, in
     *                       which case headers are derived from the key names
     */
    public static function toCsv(array $rows, array $columns, string $filename): void
    {
        if (self::$sent) {
            return;
        }
        self::$sent = true;

        $map = self::normaliseColumns($columns);

        self::sendHeaders('text/csv; charset=utf-8', self::safeFilename($filename) . '.csv');

        $out = fopen('php://output', 'w');
        if ($out === false) {
            throw new RuntimeException('Unable to open the output stream');
        }

        // UTF-8 BOM: without it Excel on Windows mangles every non-ASCII name.
        fwrite($out, "\xEF\xBB\xBF");

        fputcsv($out, array_map([self::class, 'csvSafe'], array_values($map)));

        foreach ($rows as $row) {
            $line = [];
            foreach (array_keys($map) as $key) {
                $line[] = self::csvSafe($row[$key] ?? '');
            }
            fputcsv($out, $line);
        }

        fclose($out);
    }

    /** Stream a payload as a downloadable JSON file. */
    public static function toJson($payload, string $filename): void
    {
        if (self::$sent) {
            return;
        }
        self::$sent = true;

        self::sendHeaders('application/json; charset=utf-8', self::safeFilename($filename) . '.json');

        echo json_encode(
            ['exported_at' => date('c'), 'data' => $payload],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
        );
    }

    /** True when the caller asked for a file rather than the JSON envelope. */
    public static function requested(?string $format): bool
    {
        return in_array(strtolower((string) $format), ['csv', 'json'], true);
    }

    /**
     * Dispatch on ?format=. Returns true when a file was streamed, so the caller
     * can `return` instead of also emitting a JSON body.
     */
    public static function maybeExport(?string $format, array $rows, array $columns, string $filename): bool
    {
        $format = strtolower((string) $format);

        if ($format === 'csv') {
            self::toCsv($rows, $columns, $filename);
            return true;
        }
        if ($format === 'json') {
            self::toJson($rows, $filename);
            return true;
        }

        return false;
    }

    // -----------------------------------------------------------------------

    /** @return array<string,string> db key => header label */
    private static function normaliseColumns(array $columns): array
    {
        $map = [];
        foreach ($columns as $key => $label) {
            if (is_int($key)) {
                $key   = (string) $label;
                $label = ucwords(str_replace('_', ' ', $key));
            }
            $map[(string) $key] = (string) $label;
        }
        return $map;
    }

    private static function sendHeaders(string $contentType, string $filename): void
    {
        if (headers_sent()) {
            return;
        }

        http_response_code(200);
        header('Content-Type: ' . $contentType);
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Cache-Control: private, no-store');
        header('Pragma: no-cache');
        header('X-Content-Type-Options: nosniff');

        // Any buffered notice would land inside the file and corrupt it.
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
    }

    /** The filename ends up in a header — strip anything that could steer it. */
    private static function safeFilename(string $name): string
    {
        $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name) ?? 'export';
        $name = trim($name, '-.');
        $name = $name === '' ? 'export' : substr($name, 0, 80);

        return $name . '-' . date('Ymd-His');
    }
}
