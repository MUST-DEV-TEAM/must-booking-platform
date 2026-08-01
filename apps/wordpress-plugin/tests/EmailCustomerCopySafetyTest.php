<?php
declare(strict_types=1);

if (\PHP_SAPI !== 'cli') {
    exit(1);
}

$root = \dirname(__DIR__);
$emailEngine = (string) \file_get_contents($root . '/src/Engine/EmailEngine.php');
$checkoutTemplate = (string) \file_get_contents($root . '/frontend/templates/checkout.php');
$failures = [];

$forbiddenEmailPhrases = [
    'Nightly Prices',
    'Nightly prices',
    'Stored reservation snapshot',
    'reservation snapshot',
    'pricing snapshot',
];

foreach ($forbiddenEmailPhrases as $phrase) {
    if (\stripos($emailEngine, $phrase) !== false) {
        $failures[] = "Customer email rendering must not contain technical phrase: {$phrase}";
    }
}

if (\strpos($emailEngine, "Price details") === false) {
    $failures[] = 'Multi-night email price breakdown heading should be customer-facing "Price details".';
}
if (\strpos($emailEngine, "Total price") === false || \strpos($emailEngine, "Balance due") === false || \strpos($emailEngine, "Paid") === false) {
    $failures[] = 'Email summary labels should use customer-facing payment wording.';
}
if (\strpos($emailEngine, 'buildPaymentSummaryRows') === false) {
    $failures[] = 'Email summaries should centralize paid/balance-due rows.';
}

if (\strpos($checkoutTemplate, 'Nightly Prices') !== false) {
    $failures[] = 'Customer checkout template should not display "Nightly Prices".';
}
if (\strpos($checkoutTemplate, 'Price details') === false) {
    $failures[] = 'Customer checkout template should use "Price details" for multi-night breakdowns.';
}

if ($failures) {
    echo "FAIL\n" . \implode("\n", $failures) . "\n";
    exit(1);
}

echo "Email customer copy safety tests passed.\n";
