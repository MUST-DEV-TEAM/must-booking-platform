<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') {
        exit(1);
    }

    function add_action(...$args): void {}
    function add_filter(...$args): void {}
}

namespace MustHotelBooking\Tests {
    require_once dirname(__DIR__) . '/src/Frontend/booking-page.php';

    $roomTypes = [[
        'id' => 'type-1',
        'name' => 'Garden Suite',
        'description' => 'A quiet suite.',
        'maxOccupancy' => 3,
        'mainImageUrl' => 'https://example.test/suite.jpg',
        'ratePlans' => [['id' => 'rate-1']],
        'rooms' => [['id' => 'room-1', 'name' => 'Garden Suite 101', 'viewType' => 'Garden', 'floor' => 1]],
    ]];
    $failures = [];

    $resolved = \MustHotelBooking\Frontend\resolve_fixed_physical_room(
        $roomTypes,
        'INDIVIDUAL_ROOM_ONLY',
        'type-1',
        'room-1'
    );
    if ($resolved === null || $resolved['physical_room_id'] !== 'room-1' || $resolved['room_type_id'] !== 'type-1') {
        $failures[] = 'A physical room should resolve only with its parent room type.';
    }
    if ($resolved === null || $resolved['rate_plan_id'] !== 'rate-1') {
        $failures[] = 'A URL room selection should use the room type primary rate plan.';
    }
    if (\MustHotelBooking\Frontend\resolve_fixed_physical_room($roomTypes, 'ROOM_TYPE_ONLY', 'type-1', 'room-1') !== null) {
        $failures[] = 'A physical room URL must not activate fixed-room mode for ROOM_TYPE_ONLY.';
    }
    if (\MustHotelBooking\Frontend\resolve_fixed_physical_room($roomTypes, 'MIXED', 'type-1', 'room-2') !== null) {
        $failures[] = 'An unknown physical room must not activate fixed-room mode.';
    }
    if (\MustHotelBooking\Frontend\resolve_fixed_physical_room($roomTypes, 'MIXED', 'type-2', 'room-1') !== null) {
        $failures[] = 'A room from another room type must not activate fixed-room mode.';
    }
    $storedRate = \MustHotelBooking\Frontend\resolve_fixed_physical_room(
        $roomTypes,
        'MIXED',
        'type-1',
        'room-1',
        ['ratePlanId' => 'rate-stored']
    );
    if ($storedRate === null || $storedRate['rate_plan_id'] !== 'rate-stored') {
        $failures[] = 'A validated stored selection should preserve its selected rate plan.';
    }

    if ($failures !== []) {
        fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
        exit(1);
    }

    echo "Fixed physical room resolution tests passed.\n";
}
