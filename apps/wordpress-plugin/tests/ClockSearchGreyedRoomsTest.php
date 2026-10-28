<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') exit(1);
    // The page template refuses to run outside WordPress; this says it is inside.
    if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');

    function sanitize_key($value): string { return strtolower(preg_replace('/[^a-zA-Z0-9_\-]/', '', (string) $value) ?? ''); }
    function sanitize_text_field($value): string { return trim((string) $value); }
    function wp_unslash($value) { return $value; }
    function __($value, string $domain = ''): string { return (string) $value; }
    function _n($single, $plural, $number, string $domain = ''): string { return (string) ($number === 1 ? $single : $plural); }
    function add_action(...$args): void {}
    function add_filter(...$args): void {}
    function current_time(string $format): string { return '2030-01-01'; }
    function wp_date(string $format): string { return '2030-01-01'; }
    function esc_html($value): string { return htmlspecialchars((string) $value, ENT_QUOTES); }
    function esc_attr($value): string { return htmlspecialchars((string) $value, ENT_QUOTES); }
    function esc_url($value): string { return (string) $value; }
    function must_hotel_booking_asset_url(string $path): string { return 'https://hotel.example.test/' . ltrim($path, '/'); }
    function wp_json_encode($value, int $flags = 0, int $depth = 512) { return json_encode($value, $flags, $depth); }
    function wp_create_nonce(string $action): string { return 'nonce-' . $action; }
    function disabled($disabled, $current = true, bool $display = true): string { return $disabled ? 'disabled' : ''; }
    function esc_html__($value, string $domain = ''): string { return htmlspecialchars((string) $value, ENT_QUOTES); }
    function esc_attr__($value, string $domain = ''): string { return htmlspecialchars((string) $value, ENT_QUOTES); }
    function esc_html_e($value, string $domain = ''): void { echo htmlspecialchars((string) $value, ENT_QUOTES); }
    function wp_kses_post($value): string { return (string) $value; }
    function absint($value): int { return abs((int) $value); }
    function selected($selected, $current = true, bool $display = true): string { return $selected == $current ? ' selected' : ''; }
    function checked($checked, $current = true, bool $display = true): string { return $checked == $current ? ' checked' : ''; }
    function number_format_i18n($number, int $decimals = 0): string { return number_format((float) $number, $decimals, '.', ','); }
    function get_header(): void {}
    function get_footer(): void {}
    function get_transient(string $key) { return $GLOBALS['greyed_transients'][$key] ?? false; }
    function set_transient(string $key, $value, int $expiration): bool { $GLOBALS['greyed_transients'][$key] = $value; return true; }
    function delete_transient(string $key): bool { unset($GLOBALS['greyed_transients'][$key]); return true; }
}

namespace MustHotelBooking\Core {
    final class MustBookingConfig
    {
        public static function get_max_booking_guests(): int { return 8; }
        public static function get_max_booking_rooms(): int { return 1; }
        public static function get_setting(string $key, $default = null) { return $default; }
        public static function validate_stay_dates(string $checkin, string $checkout): array { return ['valid' => true]; }
    }

    final class BookingPerformanceMonitor
    {
        public static function startSpan(string $name): string { return $name; }
        public static function stopSpan($span): void {}
    }

    final class ManagedPages
    {
        public static function isCurrentPage(string $setting, string $slug): bool { return false; }
        public static function getBookingPageUrl(): string { return 'https://hotel.example.test/booking'; }
        public static function getBookingAccommodationPageUrl(): string { return 'https://hotel.example.test/accommodation'; }
        public static function getCheckoutPageUrl(): string { return 'https://hotel.example.test/checkout'; }
    }

    final class MustApiClient
    {
        /** @var array<int, string> */
        public static array $calls = [];
        /** @var array<string, array<string, mixed>> */
        public static array $displayAnswers = [];
        public static bool $displayFails = false;

        /** @param array<string, mixed> $query @return array{ok: bool, body: array<string, mixed>} */
        public static function get(string $path, array $query = []): array
        {
            self::$calls[] = $path;
            if ($path === '/public/catalog') {
                $roomType = static fn (string $id, string $name, int $max): array => [
                    'id' => $id, 'name' => $name, 'description' => '', 'maxOccupancy' => $max,
                    'ratePlans' => [], 'requiresRatePlanSelection' => false, 'amenities' => [], 'galleryImageUrls' => [], 'mainImageUrl' => null,
                ];
                return ['ok' => true, 'body' => [
                    'pricingSource' => 'CLOCK_PMS', 'paymentMethods' => ['pokpay'],
                    'roomTypes' => [
                        $roomType('rt-open', 'Open Double', 2),
                        $roomType('rt-sold', 'Sold Out Suite', 4),
                        $roomType('rt-tiny', 'Tiny Single', 1),
                    ],
                ]];
            }
            if ($path === '/public/availability') {
                return ['ok' => true, 'body' => ['isAvailable' => true, 'availableUnits' => 5]];
            }
            return ['ok' => true, 'body' => []];
        }

        /** @param array<string, mixed> $body @return array{ok: bool, body: array<string, mixed>} */
        public static function post(string $path, array $body, string $idempotencyKey = ''): array
        {
            self::$calls[] = $path;
            if ($path === '/quotes/display-prices') {
                if (self::$displayFails) return ['ok' => false, 'body' => []];
                $prices = [];
                foreach ($body['items'] as $item) {
                    $answer = self::$displayAnswers[$item['roomTypeId']] ?? ['available' => false];
                    $prices[] = ['key' => $item['key'], 'roomTypeId' => $item['roomTypeId']] + $answer;
                }
                return ['ok' => true, 'body' => ['prices' => $prices]];
            }
            if ($path === '/quotes/alternative-dates') {
                return ['ok' => true, 'body' => ['alternatives' => [['startsOn' => '2030-05-05', 'endsOn' => '2030-05-08', 'shiftDays' => 1, 'availableRoomTypes' => 1, 'fromPrice' => ['amount' => '310.00', 'currency' => 'EUR']]]]];
            }
            return ['ok' => true, 'body' => []];
        }

        public static function guestSessionId(): string { return 'session'; }
    }
}

namespace MustHotelBooking\Frontend {

    require __DIR__ . '/../src/Frontend/booking-page.php';
    require __DIR__ . '/../src/Frontend/accommodation-page.php';
    require __DIR__ . '/../src/Frontend/formatting.php';
    // The page template reaches these helpers through the plugin's older function names.
    require __DIR__ . '/../src/legacy-functions.php';

    $fail = static function (string $message): void {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    };

    $_GET = ['checkin' => '2030-05-04', 'checkout' => '2030-05-07', 'adults' => '2', 'children' => '0', 'guests' => '2'];

    // One search request answers every room type: one with rooms left, one sold out, one too small for the party.
    \MustHotelBooking\Core\MustApiClient::$displayAnswers = [
        'rt-open' => ['available' => true, 'total' => ['amount' => '330.00', 'currency' => 'EUR'], 'freeRooms' => 2],
        'rt-sold' => ['available' => false, 'reason' => 'sold_out'],
        'rt-tiny' => ['available' => false],
    ];
    $view = get_accommodation_page_view_data();
    $rooms = $view['rooms'];
    $names = array_map(static fn (array $room): string => (string) $room['name'], $rooms);
    if ($names !== ['Open Double', 'Sold Out Suite', 'Tiny Single']) {
        $fail('Bookable rooms come first and the greyed ones after: ' . json_encode($names));
    }
    if (!empty($rooms[0]['is_unavailable'])) $fail('The room with rooms left must be bookable.');
    if (($rooms[0]['available_count'] ?? 0) !== 2 || empty($rooms[0]['scarce'])) $fail('Two rooms left is worth saying.');
    if (($rooms[0]['display_price']['total']['amount'] ?? '') !== '330.00') $fail('The price comes from the one search request.');
    if (empty($rooms[1]['is_unavailable']) || $rooms[1]['unavailable_reason'] !== 'Sold out for these dates') {
        $fail('A sold-out room is shown greyed out with its reason.');
    }
    if (empty($rooms[2]['is_unavailable']) || $rooms[2]['unavailable_reason'] !== 'Sleeps up to 1 guests') {
        $fail('A room that is too small is shown greyed out with its capacity.');
    }
    if (in_array('/public/availability', \MustHotelBooking\Core\MustApiClient::$calls, true)) {
        $fail('A hotel-system property must not be asked room type by room type.');
    }
    if (count(array_keys(\MustHotelBooking\Core\MustApiClient::$calls, '/quotes/display-prices', true)) !== 1) {
        $fail('Prices must be asked for once, not twice.');
    }
    if (!empty($view['all_unavailable'])) $fail('Something is bookable, so the page must not say nothing is.');

    // When nothing can be booked, say so and still show every room with its reason.
    \MustHotelBooking\Core\MustApiClient::$displayAnswers['rt-open'] = ['available' => false, 'reason' => 'closed'];
    $view = get_accommodation_page_view_data();
    if (empty($view['all_unavailable']) || count($view['rooms']) !== 3) $fail('All greyed: the page must say nothing is available and list the rooms.');
    if (count($view['alternative_dates'] ?? []) !== 1) $fail('When nothing is available, nearby dates that work are offered.');
    ob_start();
    include __DIR__ . '/../frontend/templates/booking-accommodation.php';
    $greyHtml = (string) ob_get_clean();
    if (strpos($greyHtml, 'checkin=2030-05-05') === false || strpos($greyHtml, 'checkout=2030-05-08') === false) $fail('The nearby dates must be links back to the search.');

    // If the search request itself fails, the old room-by-room path takes over (nothing breaks).
    \MustHotelBooking\Core\MustApiClient::$calls = [];
    \MustHotelBooking\Core\MustApiClient::$displayFails = true;
    $view = get_accommodation_page_view_data();
    if (!in_array('/public/availability', \MustHotelBooking\Core\MustApiClient::$calls, true)) {
        $fail('A failed search request must fall back to the old availability checks.');
    }
    if (count($view['rooms']) < 1) $fail('The fallback must still list rooms.');

    // The page itself: greyed cards carry the reason and have no way to be selected.
    \MustHotelBooking\Core\MustApiClient::$displayFails = false;
    \MustHotelBooking\Core\MustApiClient::$displayAnswers['rt-open'] = ['available' => true, 'total' => ['amount' => '330.00', 'currency' => 'EUR'], 'freeRooms' => 9];
    $view = get_accommodation_page_view_data();
    ob_start();
    include __DIR__ . '/../frontend/templates/booking-accommodation.php';
    $html = (string) ob_get_clean();
    if (substr_count($html, 'is-unavailable') < 2) $fail('Both greyed rooms must carry the greyed class.');
    if (strpos($html, 'Sold out for these dates') === false) $fail('The reason must be on the page.');
    if (substr_count($html, 'must-hotel-booking-select-room-form') !== 1) $fail('Only the bookable room can be selected.');
    if (strpos($html, 'must-booking-alternative-dates') !== false) $fail('Nearby dates are only offered when nothing is available.');
    if (strpos($html, 'Only 9 left') !== false) $fail('Nine free rooms is not scarce and must not be announced as scarce.');

    if (strpos($html, 'must-booking-room-original-price') !== false) $fail('A room without an included discount has no crossed-out price.');

    foreach (['300.00' => true, '264.00' => false, '250.00' => false] as $originalAmount => $expected) {
        \MustHotelBooking\Core\MustApiClient::$displayAnswers['rt-open'] = ['available' => true, 'total' => ['amount' => '264.00', 'currency' => 'EUR'], 'originalTotal' => ['amount' => $originalAmount, 'currency' => 'EUR']];
        $view = get_accommodation_page_view_data();
        if (($view['rooms'][0]['display_price']['originalTotal']['amount'] ?? '') !== $originalAmount) $fail('The search answer must keep originalTotal.');
        ob_start();
        include __DIR__ . '/../frontend/templates/booking-accommodation.php';
        $discountHtml = (string) ob_get_clean();
        if ((substr_count($discountHtml, '<del class="must-booking-room-original-price">') === 1) !== $expected) $fail('Only a higher original total gets crossed out.');
        if ($expected && strpos($discountHtml, '300') === false) $fail('The original amount must be visible.');
    }
    // Even a stale discounted answer cannot put a price on a greyed-out card.
    $view['rooms'][0]['is_unavailable'] = true;
    $view['rooms'][0]['display_price']['originalTotal']['amount'] = '300.00';
    ob_start();
    include __DIR__ . '/../frontend/templates/booking-accommodation.php';
    $unavailableHtml = (string) ob_get_clean();
    if (strpos($unavailableHtml, 'must-booking-room-original-price') !== false) $fail('Greyed rooms keep their existing appearance.');

    fwrite(STDOUT, "Clock search greyed rooms test passed.\n");
}
