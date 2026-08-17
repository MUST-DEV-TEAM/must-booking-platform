<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') exit(1);

    function add_action(...$args): void {}
    function add_filter(...$args): void {}
    function __($value, string $domain = ''): string { return (string) $value; }
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
                ['id' => 'large', 'name' => 'Large Room', 'maxOccupancy' => 4, 'ratePlans' => [], 'rooms' => [['id' => 'large-1', 'name' => 'Large 1', 'isAvailable' => true]]],
            ]]];
        }
        public static function post(string $path, array $body): array { return ['ok' => true, 'body' => []]; }
    }
}

namespace MustHotelBooking\Frontend {
    require __DIR__ . '/../src/Frontend/booking-page.php';
    require __DIR__ . '/../src/Frontend/accommodation-page.php';

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = ['checkin' => '2030-01-01', 'checkout' => '2030-01-03', 'guests' => '3', 'room_count' => '0'];
    $singleRoom = get_accommodation_page_view_data();
    if (count($singleRoom['rooms']) !== 1 || $singleRoom['rooms'][0]['must_room_type_uuid'] !== 'large') {
        fwrite(STDERR, "A single-room search must hide room types below the requested guest capacity.\n");
        exit(1);
    }

    $_GET['room_count'] = '2';
    $multiRoom = get_accommodation_page_view_data();
    if (count($multiRoom['rooms']) !== 2) {
        fwrite(STDERR, "A multi-room search must retain room types for future combination handling.\n");
        exit(1);
    }

    echo "Accommodation capacity filter tests passed.\n";
}
