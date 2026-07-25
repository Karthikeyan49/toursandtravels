<?php
/**
 * Static PDO facade.
 *
 * Every query in the application goes through here, and every one of them is a
 * prepared statement with bound parameters. There is no method that accepts an
 * interpolated WHERE clause built from request data.
 *
 * Column/table identifiers that must be dynamic (sort keys, filter columns) are
 * validated against an explicit allowlist by the caller before reaching here —
 * see Model::assertSortable().
 */
class Database
{
    private static ?PDO $pdo = null;
    private static array $config = [];
    private static int $txDepth = 0;

    public static function configure(array $dbConfig): void
    {
        self::$config = $dbConfig;
    }

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $c = self::$config;
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $c['host'] ?? 'localhost',
            $c['port'] ?? 3306,
            $c['name'] ?? '',
            $c['charset'] ?? 'utf8mb4'
        );

        try {
            self::$pdo = new PDO($dsn, $c['user'] ?? '', $c['pass'] ?? '', [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Real prepared statements. Emulation would re-open the door to
                // injection via multi-statement payloads on some MySQL builds.
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::ATTR_STRINGIFY_FETCHES  => false,
                // Pin the collation on the CONNECTION too. The server default on
                // MariaDB 11.x is utf8mb4_uca1400_ai_ci, which breaks every JOIN
                // against our utf8mb4_unicode_ci tables with errno 1267.
                PDO::MYSQL_ATTR_INIT_COMMAND =>
                    "SET NAMES utf8mb4 COLLATE " . ($c['collate'] ?? 'utf8mb4_unicode_ci')
                    . ", time_zone = '+05:30', sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'",
            ]);
        } catch (PDOException $e) {
            error_log('[db] connection failed: ' . $e->getMessage());
            // Never leak DSN, credentials or driver detail to the client.
            Response::error('Database connection failed', 503);
            exit;
        }

        return self::$pdo;
    }

    /** @param array<string|int, mixed> $params */
    public static function query(string $sql, array $params = []): PDOStatement
    {
        $stmt = self::connection()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    /** @return array<string, mixed>|null */
    public static function fetch(string $sql, array $params = []): ?array
    {
        $row = self::query($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<int, array<string, mixed>> */
    public static function fetchAll(string $sql, array $params = []): array
    {
        return self::query($sql, $params)->fetchAll();
    }

    /** Scalar value from the first column of the first row. */
    public static function scalar(string $sql, array $params = [])
    {
        $v = self::query($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function execute(string $sql, array $params = []): int
    {
        return self::query($sql, $params)->rowCount();
    }

    public static function lastInsertId(): int
    {
        return (int) self::connection()->lastInsertId();
    }

    /**
     * Insert with an explicit column allowlist. Keys not in $allowed are dropped
     * silently, so a client cannot set is_active / created_by / amount_paid by
     * smuggling extra JSON fields (mass-assignment).
     */
    public static function insert(string $table, array $data, array $allowed): int
    {
        $data = array_intersect_key($data, array_flip($allowed));
        if ($data === []) {
            throw new InvalidArgumentException('No insertable columns supplied');
        }
        $cols  = array_keys($data);
        $marks = array_map(static fn($c) => ':' . $c, $cols);
        $sql = 'INSERT INTO `' . $table . '` (`' . implode('`, `', $cols) . '`) VALUES (' . implode(', ', $marks) . ')';
        self::query($sql, array_combine($marks, array_values($data)));
        return self::lastInsertId();
    }

    /** Update with an explicit column allowlist. Returns affected row count. */
    public static function update(string $table, int $id, array $data, array $allowed, string $pk = 'id'): int
    {
        $data = array_intersect_key($data, array_flip($allowed));
        if ($data === []) {
            return 0;
        }
        $sets = [];
        $params = [':__id' => $id];
        foreach ($data as $col => $val) {
            $sets[] = '`' . $col . '` = :' . $col;
            $params[':' . $col] = $val;
        }
        $sql = 'UPDATE `' . $table . '` SET ' . implode(', ', $sets) . ' WHERE `' . $pk . '` = :__id';
        return self::execute($sql, $params);
    }

    // --- Transactions -------------------------------------------------------
    // Nested begin/commit are counted, so a service method can open a transaction
    // without knowing whether its caller already did.

    public static function begin(): void
    {
        if (self::$txDepth === 0) {
            self::connection()->beginTransaction();
        }
        self::$txDepth++;
    }

    public static function commit(): void
    {
        if (self::$txDepth === 0) {
            return;
        }
        self::$txDepth--;
        if (self::$txDepth === 0) {
            self::connection()->commit();
        }
    }

    public static function rollBack(): void
    {
        if (self::$txDepth === 0) {
            return;
        }
        self::$txDepth = 0;
        if (self::connection()->inTransaction()) {
            self::connection()->rollBack();
        }
    }

    /**
     * Run $fn inside a transaction, rolling back on any throwable.
     * Use this for every multi-statement write.
     */
    public static function transaction(callable $fn)
    {
        self::begin();
        try {
            $result = $fn();
            self::commit();
            return $result;
        } catch (Throwable $e) {
            self::rollBack();
            throw $e;
        }
    }
}
