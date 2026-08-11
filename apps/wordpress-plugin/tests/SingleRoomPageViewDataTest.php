<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') {
        exit(1);
    }

    function add_action(...$args): void {}
    function __(string $text, string $domain = ''): string { return $text; }
}

namespace MustHotelBooking\Frontend {
    /** @return array<string, mixed>|null */
    function resolve_fixed_physical_room(array $roomTypes, string $bookingMode, string $roomTypeId, string $roomId): ?array
    {
        if (!in_array($bookingMode, ['INDIVIDUAL_ROOM_ONLY', 'MIXED'], true)) {
            return null;
        }
        foreach ($roomTypes as $roomType) {
            if (($roomType['id'] ?? '') !== $roomTypeId) {
                continue;
            }
            foreach (($roomType['rooms'] ?? []) as $room) {
                if (($room['id'] ?? '') === $roomId) {
                    return [
                        'physical_room_id' => $roomId,
                        'name' => $room['name'] ?? '',
                        'view_type' => $room['viewType'] ?? '',
                        'floor' => $room['floor'] ?? 0,
                    ];
                }
            }
        }
        return null;
    }

    /** @return array<string, mixed> */
    function get_room_type_media_view_data(array $roomType): array
    {
        return [
            'primary_image_url' => (string) ($roomType['mainImageUrl'] ?? ''),
            'gallery_images' => (array) ($roomType['galleryImageUrls'] ?? []),
            'lightbox_images' => (array) ($roomType['galleryImageUrls'] ?? []),
        ];
    }

    /** @return array<int, array<string, string>> */
    function get_room_type_amenities_view_data(array $roomType): array
    {
        return [['label' => 'Wi-Fi', 'icon' => 'https://example.test/wifi.svg']];
    }

    require_once dirname(__DIR__) . '/src/Frontend/single-room-page.php';

    $catalog = [
        'bookingMode' => 'INDIVIDUAL_ROOM_ONLY',
        'roomTypes' => [
            [
                'id' => 'suite', 'name' => 'Sea Suite', 'description' => 'Sea-facing room.', 'maxOccupancy' => 3,
                'mainImageUrl' => 'https://example.test/suite-main.jpg',
                'galleryImageUrls' => ['https://example.test/suite-gallery.jpg'],
                'amenities' => [['name' => 'Wi-Fi']],
                'ratePlans' => [['name' => 'Flexible rate']],
                'rooms' => [['id' => 'suite-101', 'name' => 'Sea Suite 101', 'viewType' => 'Sea', 'floor' => 1]],
            ],
            [
                'id' => 'studio', 'name' => 'Garden Studio',
                'mainImageUrl' => 'https://example.test/studio-main.jpg',
                'galleryImageUrls' => ['https://example.test/studio-gallery.jpg'],
            ],
        ],
    ];
    $view = get_single_room_page_view_model_from_catalog($catalog, 'suite', 'suite-101');
    $failures = [];
    if (empty($view['is_valid'])) $failures[] = 'A known room type should produce a valid room-detail view.';
    if (($view['room']['name'] ?? '') !== 'Sea Suite 101') $failures[] = 'A validated physical room should supply the detail-page title.';
    if (($view['room']['room_id'] ?? '') !== 'suite-101') $failures[] = 'A validated physical room ID should stay in the detail-page model.';
    if (($view['room']['primary_image_url'] ?? '') !== 'https://example.test/suite-main.jpg') $failures[] = 'Catalog media should be carried into the detail-page model.';
    if (($view['room']['amenities'][0]['icon'] ?? '') !== 'https://example.test/wifi.svg') $failures[] = 'Catalog amenity icons should be carried into the detail-page model.';
    if (($view['room']['rate_plans'] ?? []) !== ['Flexible rate']) $failures[] = 'Catalog rate plans should be carried into the detail-page model.';
    if (($view['related_rooms'][0]['room_type_id'] ?? '') !== 'studio') $failures[] = 'Other catalogue room types should populate related rooms.';

    $unresolved = get_single_room_page_view_model_from_catalog($catalog, 'suite', 'not-a-room');
    if (($unresolved['room']['room_id'] ?? null) !== '') $failures[] = 'An unvalidated room ID must not remain in the detail-page model.';
    if (($unresolved['room']['name'] ?? '') !== 'Sea Suite') $failures[] = 'An invalid room ID should fall back to the room-type detail.';
    if (!empty(get_single_room_page_view_model_from_catalog($catalog, 'missing', '')['is_valid'])) $failures[] = 'An unknown room type must not produce a detail page.';

    if ($failures !== []) {
        fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
        exit(1);
    }

    echo "Single room page view-data tests passed.\n";
}
