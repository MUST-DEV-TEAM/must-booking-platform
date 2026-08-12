<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') {
        exit(1);
    }

    define('MUST_HOTEL_BOOKING_URL', 'https://example.test/plugin/');

    function add_action(...$args): void {}
}

namespace MustHotelBooking\Frontend {
    require_once dirname(__DIR__) . '/src/Frontend/accommodation-page.php';

    $icons = [
        'CABLE_CHANNELS' => 'cablechannels.svg',
        'REFRIGERATOR' => 'refrigerator.svg',
        'FLAT_SCREEN_TV' => 'flatscreentv.svg',
        'LINEN' => 'linen.svg',
        'TELEPHONE' => 'telephone.svg',
        'DRYER' => 'dryer.svg',
        'STREAMING' => 'streaming.svg',
        'SAFETY_DEPOSIT_BOX' => 'safetydepositbox.svg',
    ];
    $view = get_room_type_amenities_view_data([
        'amenities' => array_map(
            static function (string $icon): array {
                return ['name' => $icon, 'icon' => $icon];
            },
            array_keys($icons),
        ),
    ]);
    $failures = [];
    foreach ($view as $index => $amenity) {
        $icon = array_keys($icons)[$index];
        $expected = MUST_HOTEL_BOOKING_URL . 'assets/img/' . $icons[$icon];
        if (($amenity['icon'] ?? '') !== $expected) {
            $failures[] = sprintf('%s should resolve to its canonical icon URL.', $icon);
        }
    }

    if ($failures !== []) {
        fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
        exit(1);
    }

    echo "Amenity icon view-data tests passed.\n";
}
