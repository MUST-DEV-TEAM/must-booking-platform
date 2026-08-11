<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') {
        exit(1);
    }

    function add_action(...$args): void {}
    function sanitize_key(string $value): string { return $value; }
    function add_query_arg(array $args, string $url): string { return $url . '?' . http_build_query($args); }
}

namespace MustHotelBooking\Core {
    class ManagedPages
    {
        public static function getBookingPageUrl(): string { return 'https://example.test/booking'; }
        public static function getSingleRoomPageUrl(): string { return 'https://example.test/room-details'; }
    }
}

namespace MustHotelBooking\Frontend {
    function get_room_type_media_view_data(array $roomType): array
    {
        return [
            'primary_image_url' => (string) ($roomType['mainImageUrl'] ?? ''),
            'gallery_images' => (array) ($roomType['galleryImageUrls'] ?? []),
            'lightbox_images' => (array) ($roomType['galleryImageUrls'] ?? []),
        ];
    }

    function get_room_type_amenities_view_data(array $roomType): array
    {
        return [['label' => 'Wi-Fi', 'icon' => 'https://example.test/wifi.svg']];
    }
}

namespace MustHotelBooking\Elementor {
    function get_must_widget_room_types(): array
    {
        return [[
            'id' => 'type-1', 'name' => 'Suite', 'description' => 'Sea view', 'maxOccupancy' => 2,
            'mainImageUrl' => 'https://example.test/main.jpg',
            'galleryImageUrls' => ['https://example.test/gallery-1.jpg'],
            'rooms' => [['id' => 'room-1', 'name' => 'Suite 101', 'isAvailable' => true]],
        ]];
    }

    require_once dirname(__DIR__) . '/src/Elementor/rooms-list-widget.php';
    require_once dirname(__DIR__) . '/src/Elementor/rooms-text-grid-widget.php';

    $failures = [];
    $roomType = get_rooms_for_widget_render('all', 1, 'room_types')[0] ?? [];
    $individualRoom = get_rooms_for_widget_render('all', 1, 'individual_rooms')[0] ?? [];
    $textGridRoom = get_rooms_for_text_grid_widget_render('all_rooms', [], 1, 'individual_rooms')[0] ?? [];
    foreach ([$roomType, $individualRoom, $textGridRoom] as $room) {
        if (($room['main_image_url'] ?? '') !== 'https://example.test/main.jpg') $failures[] = 'Main image was not carried into every widget render model.';
        if (($room['gallery_image_urls'] ?? []) !== ['https://example.test/gallery-1.jpg']) $failures[] = 'Gallery images were not carried into every widget render model.';
        if (($room['amenities'][0]['icon'] ?? '') !== 'https://example.test/wifi.svg') $failures[] = 'Amenity icons were not carried into every widget render model.';
    }
    $detailsUrl = get_rooms_widget_single_room_page_url($individualRoom);
    if ($detailsUrl !== 'https://example.test/room-details?accommodation_type=type-1&room_id=room-1') $failures[] = 'Individual-room More Details links must carry both room IDs.';
    $typeDetailsUrl = get_rooms_widget_single_room_page_url($roomType);
    if ($typeDetailsUrl !== 'https://example.test/room-details?accommodation_type=type-1') $failures[] = 'Room-type More Details links must not invent a physical room ID.';

    if ($failures !== []) {
        fwrite(STDERR, implode(PHP_EOL, array_unique($failures)) . PHP_EOL);
        exit(1);
    }

    echo "Widget presentation data tests passed.\n";
}
