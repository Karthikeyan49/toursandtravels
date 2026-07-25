<?php
/**
 * Test runner.   Run:  php api/tests/run_all.php
 *
 * Each suite runs in its OWN php process. authorization_test.php requires
 * index.php, which registers global error handlers and defines constants — that
 * must not leak into any other suite, and a fatal in one must not hide the rest.
 *
 * Exits non-zero if any suite fails, so it can gate a deploy.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo "Tests can only be run from the command line.\n";
    exit(1);
}

$suites = [
    'money'         => __DIR__ . '/money_test.php',
    'authorization' => __DIR__ . '/authorization_test.php',
];

$php     = PHP_BINARY !== '' ? PHP_BINARY : 'php';
$results = [];
$started = microtime(true);

fwrite(STDOUT, "\n" . str_repeat('=', 72) . "\n");
fwrite(STDOUT, "  Tours & Travel ERP — test suite\n");
fwrite(STDOUT, '  PHP ' . PHP_VERSION . "\n");
fwrite(STDOUT, str_repeat('=', 72) . "\n");

foreach ($suites as $name => $file) {
    if (!is_file($file)) {
        fwrite(STDERR, "\n  MISSING SUITE: $file\n");
        $results[$name] = 1;
        continue;
    }

    $exitCode = 0;
    passthru(escapeshellarg($php) . ' ' . escapeshellarg($file), $exitCode);
    $results[$name] = $exitCode;
}

$elapsed = round(microtime(true) - $started, 2);
$failed  = array_filter($results, static fn(int $code) => $code !== 0);

fwrite(STDOUT, str_repeat('=', 72) . "\n");
foreach ($results as $name => $code) {
    fwrite(STDOUT, sprintf("  %-16s %s\n", $name, $code === 0 ? 'PASS' : 'FAIL (exit ' . $code . ')'));
}
fwrite(STDOUT, sprintf(
    "  %-16s %d/%d suites passed in %ss\n",
    'total',
    count($results) - count($failed),
    count($results),
    $elapsed
));
fwrite(STDOUT, str_repeat('=', 72) . "\n\n");

exit($failed === [] ? 0 : 1);
