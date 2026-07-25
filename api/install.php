<?php
/**
 * One-shot installer:  php api/install.php --email=you@example.com --name="Owner"
 *
 *   1. runs every api/migrations/*.sql in numeric order
 *   2. creates the bootstrap owner account
 *   3. prints a per-table verification summary
 *
 * Idempotent — every migration is written with CREATE TABLE IF NOT EXISTS /
 * INSERT IGNORE, and the owner is skipped when a user already exists.
 *
 * The password comes from the ADMIN_PASSWORD environment variable, or is
 * generated and printed ONCE. No hash is ever hard-coded here: a committed hash
 * is a committed password.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "install.php can only be run from the command line.\n";
    exit(1);
}

define('ROOT_PATH', __DIR__);

$config = require ROOT_PATH . '/config/app.php';

require_once ROOT_PATH . '/core/Response.php';
require_once ROOT_PATH . '/core/Config.php';
require_once ROOT_PATH . '/core/Database.php';
require_once ROOT_PATH . '/core/Request.php';
require_once ROOT_PATH . '/core/Model.php';

Config::load($config);
Database::configure($config['db'] ?? []);
date_default_timezone_set($config['app']['timezone'] ?? 'Asia/Kolkata');

// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = ROOT_PATH . '/migrations';
const BCRYPT_COST    = 12;

$options = parseArguments($argv);

line('');
line('  Tours & Travel ERP — installer');
line('  ' . str_repeat('=', 60));
line('  Database : ' . ($config['db']['name'] ?? '(unset)') . ' @ ' . ($config['db']['host'] ?? 'localhost'));
line('  Env      : ' . ($config['app']['env'] ?? 'production'));
line('');

if (empty($config['db']['name'])) {
    fail('DB_NAME is not set. Create the .env file above the application root first.');
}

try {
    Database::connection();
} catch (Throwable $e) {
    fail('Could not connect to the database: ' . $e->getMessage());
}

$tables = runMigrations();
createBootstrapOwner($options);
verify($tables);

line('');
line('  Done.');
line('');
exit(0);

// ---------------------------------------------------------------------------

/** @return string[] every table name the migrations declare */
function runMigrations(): array
{
    line('  Migrations');
    line('  ' . str_repeat('-', 60));

    $files = glob(MIGRATIONS_DIR . '/*.sql') ?: [];
    if ($files === []) {
        fail('No migration files found in ' . MIGRATIONS_DIR);
    }

    // Numeric order: 002 must run before 010, which a plain sort would get wrong
    // the moment the project reaches a two-digit prefix.
    usort($files, static function (string $a, string $b): int {
        $na = (int) preg_replace('/\D.*$/', '', basename($a));
        $nb = (int) preg_replace('/\D.*$/', '', basename($b));
        return $na === $nb ? strcmp($a, $b) : $na <=> $nb;
    });

    $tables = [];

    foreach ($files as $file) {
        $sql = file_get_contents($file);
        if ($sql === false) {
            fail('Could not read ' . $file);
        }

        foreach (collectTableNames($sql) as $table) {
            $tables[$table] = true;
        }

        $statements = splitStatements($sql);
        $executed   = 0;

        foreach ($statements as $statement) {
            try {
                Database::connection()->exec($statement);
                $executed++;
            } catch (PDOException $e) {
                // 1060 duplicate column, 1061 duplicate key, 1050 table exists:
                // all expected when a migration is re-run against a live database.
                if (in_array((int) $e->errorInfo[1], [1050, 1060, 1061, 1091], true)) {
                    continue;
                }
                fail(sprintf(
                    "%s failed:\n    %s\n    while running: %s",
                    basename($file),
                    $e->getMessage(),
                    substr(preg_replace('/\s+/', ' ', $statement), 0, 160)
                ));
            }
        }

        line(sprintf('  %-24s %3d statement(s)', basename($file), $executed));
    }

    line('');

    return array_keys($tables);
}

/**
 * Split a migration file into individual statements.
 *
 * A naive explode(';') breaks on a semicolon inside a string literal or a
 * comment, so the scanner tracks quoting state. The migrations contain no
 * stored routines, so there is no DELIMITER handling to do.
 */
function splitStatements(string $sql): array
{
    $statements = [];
    $buffer     = '';
    $length     = strlen($sql);

    $inSingle = false;
    $inDouble = false;
    $inTick   = false;
    $inLineComment  = false;
    $inBlockComment = false;

    for ($i = 0; $i < $length; $i++) {
        $char = $sql[$i];
        $next = $i + 1 < $length ? $sql[$i + 1] : '';

        if ($inLineComment) {
            if ($char === "\n") {
                $inLineComment = false;
                $buffer .= $char;
            }
            continue;
        }

        if ($inBlockComment) {
            if ($char === '*' && $next === '/') {
                $inBlockComment = false;
                $i++;
            }
            continue;
        }

        if (!$inSingle && !$inDouble && !$inTick) {
            // `-- ` and `#` line comments, `/* */` block comments.
            if ($char === '-' && $next === '-' && (($sql[$i + 2] ?? "\n") === ' ' || ($sql[$i + 2] ?? "\n") === "\n" || ($sql[$i + 2] ?? "\n") === "\t")) {
                $inLineComment = true;
                continue;
            }
            if ($char === '#') {
                $inLineComment = true;
                continue;
            }
            if ($char === '/' && $next === '*') {
                $inBlockComment = true;
                $i++;
                continue;
            }
            if ($char === ';') {
                $trimmed = trim($buffer);
                if ($trimmed !== '') {
                    $statements[] = $trimmed;
                }
                $buffer = '';
                continue;
            }
        }

        // Quote state. A doubled quote inside a literal is an escaped quote and
        // must not flip the state.
        if ($char === "'" && !$inDouble && !$inTick) {
            if ($inSingle && $next === "'") {
                $buffer .= $char . $next;
                $i++;
                continue;
            }
            if ($inSingle && $sql[$i - 1] === '\\') {
                $buffer .= $char;
                continue;
            }
            $inSingle = !$inSingle;
        } elseif ($char === '"' && !$inSingle && !$inTick) {
            if ($inDouble && $sql[$i - 1] === '\\') {
                $buffer .= $char;
                continue;
            }
            $inDouble = !$inDouble;
        } elseif ($char === '`' && !$inSingle && !$inDouble) {
            $inTick = !$inTick;
        }

        $buffer .= $char;
    }

    $trimmed = trim($buffer);
    if ($trimmed !== '') {
        $statements[] = $trimmed;
    }

    return $statements;
}

/** @return string[] */
function collectTableNames(string $sql): array
{
    preg_match_all('/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/i', $sql, $matches);
    return $matches[1] ?? [];
}

function createBootstrapOwner(array $options): void
{
    line('  Bootstrap account');
    line('  ' . str_repeat('-', 60));

    $existing = (int) Database::scalar('SELECT COUNT(*) FROM users');
    if ($existing > 0) {
        line('  Skipped — ' . $existing . ' user account(s) already exist.');
        line('  Use  POST /users  or  php install.php  on an empty database to add one.');
        line('');
        return;
    }

    $email = trim((string) ($options['email'] ?? ''));
    $phone = trim((string) ($options['phone'] ?? ''));
    $name  = trim((string) ($options['name'] ?? 'System Owner'));

    if ($email === '' && $phone === '') {
        fail("An owner account needs a login identifier.\n"
            . '  Run: php api/install.php --email=owner@example.com --phone=9876543210 --name="Owner Name"');
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('--email is not a valid email address.');
    }

    // Environment variable first so an automated deploy never has to echo a
    // password onto the command line, where it lands in the shell history.
    $envPassword = getenv('ADMIN_PASSWORD');
    $generated   = null;

    if (is_string($envPassword) && $envPassword !== '') {
        if (strlen($envPassword) < 8) {
            fail('ADMIN_PASSWORD must be at least 8 characters.');
        }
        $password = $envPassword;
    } else {
        $password  = randomPassword();
        $generated = $password;
    }

    $id = Database::insert('users', [
        'full_name'      => mb_substr($name, 0, 150),
        'email'          => $email !== '' ? $email : null,
        'phone'          => $phone !== '' ? $phone : null,
        // Hashed here and now; nothing resembling a hash is stored in the repo.
        'password_hash'  => password_hash($password, PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]),
        'user_type'      => 'staff',
        'staff_role'     => 'owner',
        'is_active'      => 1,
        'must_change_pw' => $generated !== null ? 1 : 0,
    ], [
        'full_name', 'email', 'phone', 'password_hash', 'user_type',
        'staff_role', 'is_active', 'must_change_pw',
    ]);

    line('  Created owner #' . $id . ' — ' . $name . ' <' . ($email !== '' ? $email : $phone) . '>');

    if ($generated !== null) {
        line('');
        line('  ' . str_repeat('*', 60));
        line('  TEMPORARY PASSWORD:  ' . $generated);
        line('  Shown once. Sign in and change it immediately.');
        line('  ' . str_repeat('*', 60));
    } else {
        line('  Password taken from the ADMIN_PASSWORD environment variable.');
    }

    line('');
}

function verify(array $tables): void
{
    line('  Verification');
    line('  ' . str_repeat('-', 60));

    sort($tables);
    $missing = 0;

    foreach ($tables as $table) {
        try {
            // $table comes from the migration files on disk, never from input.
            $count = (int) Database::scalar('SELECT COUNT(*) FROM `' . $table . '`');
            line(sprintf('  %-26s %8d row(s)', $table, $count));
        } catch (Throwable $e) {
            $missing++;
            line(sprintf('  %-26s %8s', $table, 'MISSING'));
        }
    }

    line('  ' . str_repeat('-', 60));
    line(sprintf('  %d table(s) checked, %d missing', count($tables), $missing));

    if ($missing > 0) {
        line('');
        line('  WARNING: some tables were not created. Review the migration output above.');
    }
}

/** @return array<string,string> */
function parseArguments(array $argv): array
{
    $options = [];
    foreach (array_slice($argv, 1) as $arg) {
        if (preg_match('/^--([a-z0-9_-]+)(?:=(.*))?$/i', $arg, $m)) {
            $options[strtolower($m[1])] = $m[2] ?? '1';
        }
    }
    return $options;
}

/** 16 characters from a 58-symbol alphabet, no visually ambiguous glyphs. */
function randomPassword(int $length = 16): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $max      = strlen($alphabet) - 1;

    $out = '';
    for ($i = 0; $i < $length; $i++) {
        $out .= $alphabet[random_int(0, $max)];
    }
    return $out;
}

function line(string $text): void
{
    fwrite(STDOUT, $text . PHP_EOL);
}

function fail(string $message): void
{
    fwrite(STDERR, PHP_EOL . '  ERROR: ' . $message . PHP_EOL . PHP_EOL);
    exit(1);
}
