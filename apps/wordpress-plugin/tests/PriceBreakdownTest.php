<?php
declare(strict_types=1);

namespace {
    if (\PHP_SAPI !== 'cli') exit(1);
    define('ABSPATH', __DIR__);
    function sanitize_text_field($value): string { return trim((string) $value); }
}

namespace {
    require __DIR__ . '/../src/Frontend/price-breakdown.php';
    require __DIR__ . '/../src/Core/MustBookingConfig.php';

    if (\MustHotelBooking\Core\MustBookingConfig::get_checkout_price_breakdown_mode() !== 'date_price_rows') {
        fwrite(STDERR, "FAIL\nCheckout must show per-date prices by default.\n");
        exit(1);
    }

    $rows = \MustHotelBooking\Frontend\get_price_breakdown_rows_from_pricing([
        'nightly_rates' => [
            ['date' => '2031-07-10', 'amount' => '119.50'],
            ['date' => '2031-07-11', 'rate' => 132],
            ['date' => '', 'amount' => 1],
        ],
    ]);
    if ($rows !== [
        ['date' => '2031-07-10', 'amount' => 119.5],
        ['date' => '2031-07-11', 'amount' => 132.0],
    ]) {
        fwrite(STDERR, "FAIL\nNightly API rows were not normalized for both checkout and confirmation.\n");
        exit(1);
    }
    echo "Price breakdown tests passed.\n";
}
