<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') exit(1);

    function add_action(...$args): void {}
    function add_filter(...$args): void {}
    function __($value, string $domain = ''): string { return (string) $value; }
    function sanitize_key(string $value): string { return $value; }
    function sanitize_text_field(string $value): string { return trim($value); }
    function wp_unslash($value) { return $value; }
    function wp_verify_nonce(string $nonce, string $action): bool { return $nonce === 'valid' && $action !== ''; }
    function wp_doing_ajax(): bool { return true; }
    function get_transient(string $key) { return null; }
    function set_transient(string $key, $value, int $expiration): bool { return true; }
    function delete_transient(string $key): bool { return true; }
    function current_time(string $format): string { return '2030-01-01'; }
    function must_hotel_booking_asset_url(string $path): string { return 'https://hotel.example.test/' . $path; }
}

namespace MustHotelBooking\Core {
    final class ManagedPages {
        public static function isCurrentPage(string $setting, string $slug): bool { return false; }
        public static function getBookingPageUrl(): string { return 'https://hotel.example.test/booking'; }
        public static function getBookingAccommodationPageUrl(): string { return 'https://hotel.example.test/accommodation'; }
        public static function getCheckoutPageUrl(): string { return 'https://hotel.example.test/checkout'; }
    }
    final class MustBookingConfig {
        public static function get_max_booking_guests(): int { return 12; }
        public static function get_max_booking_rooms(): int { return 3; }
    }
    final class MustApiClient {
        public static function guestSessionId(): ?string { return null; }
        public static function get(string $path, array $query = []): array {
            return ['ok' => true, 'body' => ['bookingMode' => 'INDIVIDUAL_ROOM_ONLY', 'roomTypes' => [
                ['id' => 'small', 'name' => 'Small Room', 'maxOccupancy' => 2, 'ratePlans' => [], 'rooms' => [['id' => 'small-1', 'name' => 'Small 1', 'isAvailable' => true]]],
                ['id' => 'large', 'name' => 'Large Room', 'maxOccupancy' => 6, 'ratePlans' => [], 'rooms' => [['id' => 'large-1', 'name' => 'Large 1', 'isAvailable' => true]]],
            ]]];
        }
        public static function post(string $path, array $body): array { return ['ok' => true, 'body' => []]; }
    }
}

namespace MustHotelBooking\Frontend {
    require __DIR__ . '/../src/Frontend/booking-page.php';
    require __DIR__ . '/../src/Frontend/accommodation-page.php';

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = ['checkin' => '2030-01-01', 'checkout' => '2030-01-03', 'adults' => '2', 'children' => '1', 'guests' => '3', 'room_count' => '0'];
    $singleRoom = get_accommodation_page_view_data();
    if (($singleRoom['guests'] ?? null) !== 3 || count($singleRoom['rooms']) !== 1 || $singleRoom['rooms'][0]['must_room_type_uuid'] !== 'large') {
        fwrite(STDERR, "A 2-adult, 1-child party must derive a total of 3 and hide undersized rooms.\n");
        exit(1);
    }

    $_GET = ['checkin' => '2030-01-01', 'checkout' => '2030-01-03', 'adults' => '4', 'children' => '2', 'guests' => '6', 'room_count' => '0'];
    $sixGuestRoom = get_accommodation_page_view_data();
    if (($sixGuestRoom['guests'] ?? null) !== 6 || count($sixGuestRoom['rooms']) !== 1 || $sixGuestRoom['rooms'][0]['must_room_type_uuid'] !== 'large') {
        fwrite(STDERR, "A 4-adult, 2-child party must retain a room that can host all 6 guests.\n");
        exit(1);
    }

    $_GET['room_count'] = '2';
    $multiRoom = get_accommodation_page_view_data();
    if (!empty($multiRoom['rooms']) || !empty($multiRoom['can_continue']) || strpos((string) ($multiRoom['no_rooms_message'] ?? ''), 'one room at a time') === false) {
        fwrite(STDERR, "An unsupported multi-room search must be blocked with a clear message.\n");
        exit(1);
    }

    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = [
        'must_accommodation_action' => 'select_room',
        'must_accommodation_nonce' => 'valid',
        'must_room_type_id' => 'small',
        'must_room_id' => 'small-1',
        'must_rate_plan_id' => '',
        'checkin' => '2030-01-01',
        'checkout' => '2030-01-03',
        'adults' => '2',
        'children' => '1',
        'guests' => '3',
        'room_count' => '1',
    ];
    $selectionError = maybe_process_accommodation_selection();
    if (strpos($selectionError, 'selected room accommodates up to 2') === false) {
        fwrite(STDERR, "A selected room below the party capacity must be rejected before quote creation.\n");
        exit(1);
    }

    echo "Accommodation capacity filter tests passed.\n";
}
