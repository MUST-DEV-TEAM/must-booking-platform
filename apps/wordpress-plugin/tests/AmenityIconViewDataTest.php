<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') {
        exit(1);
    }

    define('MUST_HOTEL_BOOKING_URL', 'https://example.test/plugin/');
    define('MUST_HOTEL_BOOKING_VERSION', 'test-version');

    require_once dirname(__DIR__) . '/includes/asset-url.php';

    function add_action(...$args): void {}
}

namespace MustHotelBooking\Frontend {
    require_once dirname(__DIR__) . '/src/Frontend/accommodation-page.php';

    $failures = [];

    // Every icon the system can store (the AmenityIcon enum in the API schema) must have a plugin icon file,
    // so adding an amenity without regenerating the icons fails here instead of showing an empty square.
    $schema = (string) file_get_contents(dirname(__DIR__, 2) . '/api/prisma/schema.prisma');
    if (preg_match('/enum AmenityIcon \{(.*?)\}/s', $schema, $block) !== 1) {
        $failures[] = 'Could not read the AmenityIcon enum from the API schema.';
        $keys = [];
    } else {
        $keys = preg_split('/\s+/', trim($block[1])) ?: [];
    }
    $legacyOnly = [];
    foreach ($keys as $key) {
        if (!is_file(dirname(__DIR__) . '/assets/img/amenities/' . strtolower($key) . '.svg')) {
            $legacyOnly[] = $key;
        }
    }
    if ($legacyOnly !== []) {
        $failures[] = 'No plugin icon for: ' . implode(', ', $legacyOnly) . '. Run apps/web/scripts/generate-plugin-amenity-icons.mjs.';
    }

    $view = get_room_type_amenities_view_data([
        'amenities' => [
            ['name' => 'Sea view', 'icon' => 'SEA_VIEW'],
            ['name' => 'Wi-Fi', 'icon' => 'WIFI'],
            ['name' => 'Custom', 'icon' => null],
        ],
    ]);
    $expected = [
        must_hotel_booking_asset_url('assets/img/amenities/sea_view.svg'),
        must_hotel_booking_asset_url('assets/img/amenities/wifi.svg'),
        must_hotel_booking_asset_url('assets/img/check.svg'),
    ];
    foreach ($expected as $i => $url) {
        if (($view[$i]['icon'] ?? '') !== $url) {
            $failures[] = sprintf('Amenity %d should use %s.', $i, $url);
        }
    }

    if ($failures !== []) {
        fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
        exit(1);
    }

    echo "Amenity icon view-data tests passed.\n";
}
