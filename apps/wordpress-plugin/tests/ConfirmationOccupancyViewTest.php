<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') exit(1);

    function add_action(...$args): void {}
    function __(string $value, string $domain = ''): string { return $value; }
    function sanitize_text_field(string $value): string { return trim($value); }
    function wp_unslash($value) { return $value; }
}

namespace MustHotelBooking\Frontend {
    require_once __DIR__ . '/../src/Frontend/confirmation-page.php';
}

namespace MustHotelBooking\Core {
    final class ManagedPages
    {
        public static function getBookingConfirmationPageUrl(): string { return 'https://hotel.example.test/booking-confirmation'; }
    }

    final class MustApiClient
    {
        /** @var array<string, mixed> */
        public static array $booking = [];

        /** @return array{ok: bool, body: array<string, mixed>} */
        public static function get(string $path, array $query = []): array
        {
            return ['ok' => true, 'body' => self::$booking];
        }
    }
}

namespace MustHotelBooking\Frontend {
    function get_must_room_types(string $startsOn = '', string $endsOn = ''): array { return []; }
    function get_booking_page_url(): string { return 'https://hotel.example.test/booking'; }
    function get_booking_accommodation_page_url(): string { return 'https://hotel.example.test/accommodation'; }
    function get_checkout_page_url(): string { return 'https://hotel.example.test/checkout'; }

    $failures = [];

    $twoAdultsOneChild = get_confirmation_occupancy_view_data([
        'adults' => 2,
        'children' => 1,
        'guestCount' => 3,
    ]);
    if ($twoAdultsOneChild !== [
        'guests' => 3,
        'adults' => 2,
        'children' => 1,
        'has_breakdown' => true,
    ]) {
        $failures[] = 'Recorded 2 adults + 1 child should retain its full breakdown.';
    }

    $fourAdultsTwoChildren = get_confirmation_occupancy_view_data([
        'adults' => 4,
        'children' => 2,
        'guestCount' => 6,
    ]);
    if ($fourAdultsTwoChildren['guests'] !== 6 || $fourAdultsTwoChildren['has_breakdown'] !== true) {
        $failures[] = 'Recorded 4 adults + 2 children should show six guests with a breakdown.';
    }

    $legacyMismatch = get_confirmation_occupancy_view_data([
        'adults' => 2,
        'children' => 1,
        'guestCount' => 4,
    ]);
    if ($legacyMismatch !== [
        'guests' => 4,
        'adults' => null,
        'children' => null,
        'has_breakdown' => false,
    ]) {
        $failures[] = 'A legacy total that disagrees with its breakdown must show only the legacy total.';
    }

    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = [];
    \MustHotelBooking\Core\MustApiClient::$booking = [
        'status' => 'CONFIRMED',
        'paymentMethod' => 'PAY_AT_HOTEL',
        'startsOn' => '2027-09-01',
        'endsOn' => '2027-09-03',
        'roomTypeId' => 'room-type-1',
        'ratePlanId' => 'rate-plan-1',
        'adults' => 2,
        'children' => 1,
        'guestCount' => 3,
        'total' => ['amount' => '250.00', 'currency' => 'EUR'],
    ];
    $view = get_confirmation_result_view_data('booking-occupancy-1');
    $reservationOccupancy = $view['reservations'][0]['occupancy'] ?? null;
    if ($reservationOccupancy !== $twoAdultsOneChild) {
        $failures[] = 'Confirmation view data must use the persisted booking occupancy.';
    }

    if ($failures !== []) {
        fwrite(STDERR, implode("\n", $failures) . "\n");
        exit(1);
    }

    echo "Confirmation occupancy view test passed.\n";
}
