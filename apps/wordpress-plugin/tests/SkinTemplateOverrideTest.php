<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

// Minimal WordPress stand-ins so the real lookup function can run in CLI.
function locate_template(array $names, bool $load = false, bool $require_once = true): string
{
    return $GLOBALS['skin_fixture'][$names[0]] ?? '';
}

function apply_filters(string $hook, $value, ...$args)
{
    return $value;
}

$src = (string) file_get_contents(dirname(__DIR__) . '/src/Frontend/booking-page.php');
if (!preg_match('/function locate_skin_template\(.*?\n}\n/s', $src, $m)) {
    fwrite(STDERR, "locate_skin_template not found.\n");
    exit(1);
}
eval($m[0]);

$real = __FILE__;
$GLOBALS['skin_fixture'] = ['must-booking/checkout.php' => $real, 'must-booking/gone.php' => '/nope/gone.php'];

$cases = [
    ['checkout.php', $real, 'a skin template that exists is used'],
    ['gone.php', '', 'a skin path that is not a real file falls back to the plugin'],
    ['booking.php', '', 'no skin template falls back to the plugin'],
    ['../../wp-config.php', '', 'path traversal is rejected'],
    ['checkout.PHP', '', 'only lowercase php file names are accepted'],
];
foreach ($cases as [$file, $expected, $label]) {
    if (locate_skin_template($file) !== $expected) {
        fwrite(STDERR, "FAILED: {$label}\n");
        exit(1);
    }
}
echo "Skin template override tests passed.\n";
