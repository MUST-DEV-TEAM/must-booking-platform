<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') exit(1);
    const MINUTE_IN_SECONDS = 60;

    final class TestAjaxResponse extends \RuntimeException
    {
        /** @param array<string, mixed> $payload */
        public function __construct(public array $payload, public int $status = 200)
        {
            parent::__construct('AJAX response');
        }
    }

    function add_action(...$args): void {}
    function add_filter(...$args): void {}
    function __($value, string $domain = ''): string { return (string) $value; }
    function sanitize_key(string $value): string { return $value; }
    function sanitize_text_field(string $value): string { return trim($value); }
    function wp_unslash($value) { return $value; }
    function wp_verify_nonce(string $nonce, string $action): bool { return $nonce === 'valid' && $action !== ''; }
    function wp_doing_ajax(): bool { return true; }
    function wp_send_json_success($data = null, ?int $status_code = null, int $flags = 0): void
    {
        throw new TestAjaxResponse(['success' => true, 'data' => $data], $status_code ?? 200);
    }
    function wp_send_json_error($data = null, ?int $status_code = null, int $flags = 0): void
    {
        throw new TestAjaxResponse(['success' => false, 'data' => $data], $status_code ?? 200);
    }
    function get_transient(string $key) { return $GLOBALS['clock_gate_transients'][$key] ?? null; }
    function set_transient(string $key, $value, int $expiration): bool
    {
        $GLOBALS['clock_gate_transients'][$key] = $value;
        return true;
    }
    function delete_transient(string $key): bool
    {
        unset($GLOBALS['clock_gate_transients'][$key]);
        return true;
    }
    function current_time(string $format): string { return '2030-01-01'; }
}

namespace MustHotelBooking\Core {
    final class ManagedPages
    {
        public static function isCurrentPage(string $setting, string $slug): bool { return false; }
        public static function getBookingPageUrl(): string { return 'https://hotel.example.test/booking'; }
        public static function getBookingAccommodationPageUrl(): string { return 'https://hotel.example.test/accommodation'; }
        public static function getCheckoutPageUrl(): string { return 'https://hotel.example.test/checkout'; }
    }

    final class MustBookingConfig
    {
        public static function get_max_booking_guests(): int { return 6; }
        public static function get_max_booking_rooms(): int { return 3; }
        public static function get_setting(string $key, $default = null) { return $default; }
    }

    final class MustApiClient
    {
        /** @var array<string, mixed> */
        public static array $availabilityResponse = [
            'ok' => true,
            'body' => ['checked' => true, 'isAvailable' => true],
        ];
        /** @var array<int, array{path: string, query: array<string, mixed>}> */
        public static array $getCalls = [];
        public static int $quoteCalls = 0;

        public static function guestSessionId(): ?string { return 'clock-gate-test-guest'; }

        /** @return array<string, mixed> */
        public static function get(string $path, array $query = []): array
        {
            self::$getCalls[] = ['path' => $path, 'query' => $query];
            if ($path === '/public/catalog') {
                return [
                    'ok' => true,
                    'body' => [
                        'bookingMode' => 'MIXED',
                        'roomTypes' => [[
                            'id' => 'clock-type-1',
                            'name' => 'Clock Suite',
                            'maxOccupancy' => 2,
                            'requiresRatePlanSelection' => false,
                            'ratePlans' => [],
                            'rooms' => [['id' => 'clock-room-1', 'name' => 'Room 1']],
                        ]],
                    ],
                ];
            }
            if ($path === '/public/availability-check') return self::$availabilityResponse;
            return ['ok' => true, 'body' => []];
        }

        /** @return array<string, mixed> */
        public static function post(string $path, array $body, string $idempotencyKey = ''): array
        {
            if ($path === '/quotes') self::$quoteCalls++;
            return ['ok' => true, 'body' => ['total' => ['amount' => '100.00', 'currency' => 'EUR']]];
        }
    }
}

namespace MustHotelBooking\Frontend {
    require __DIR__ . '/../src/Frontend/booking-page.php';
    require __DIR__ . '/../src/Frontend/accommodation-page.php';

    $GLOBALS['clock_gate_transients']['must_booking_selection_clock-gate-test-guest'] = [
        'roomTypeId' => 'clock-type-1',
        'roomId' => 'clock-room-1',
    ];

    function assert_test(bool $condition, string $message): void
    {
        if (!$condition) {
            fwrite(STDERR, $message . "\n");
            exit(1);
        }
    }

    function run_ajax_check(array $post): \TestAjaxResponse
    {
        $_POST = $post;
        try {
            get_selected_room_availability_check();
        } catch (\TestAjaxResponse $response) {
            return $response;
        }
        throw new \RuntimeException('The availability AJAX handler did not return JSON.');
    }

    \MustHotelBooking\Core\MustApiClient::$availabilityResponse = [
        'ok' => true,
        'body' => ['checked' => true, 'isAvailable' => false],
    ];
    $conflictResponse = run_ajax_check([
        'nonce' => 'valid',
        'checkin' => '2030-01-10',
        'checkout' => '2030-01-12',
        'adults' => '2',
        'children' => '0',
    ]);
    assert_test($conflictResponse->payload['success'] === true, 'Conflict AJAX response must be successful JSON.');
    assert_test(($conflictResponse->payload['data']['is_available'] ?? null) === false, 'Conflict AJAX response must report unavailable.');
    assert_test(($conflictResponse->payload['data']['availability_status'] ?? null) === 'ok', 'Confirmed conflict must retain the ok status.');

    \MustHotelBooking\Core\MustApiClient::$availabilityResponse = ['ok' => false, 'body' => null];
    $failureResponse = run_ajax_check([
        'nonce' => 'valid',
        'checkin' => '2030-01-10',
        'checkout' => '2030-01-12',
        'adults' => '1',
        'children' => '0',
    ]);
    assert_test(($failureResponse->payload['data']['is_available'] ?? null) === true, 'Failed availability AJAX calls must fail open.');
    assert_test(($failureResponse->payload['data']['availability_status'] ?? null) === 'provider_unconfirmed', 'Failed availability AJAX calls must be marked unconfirmed.');

    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = [
        'must_accommodation_action' => 'select_room',
        'must_accommodation_nonce' => 'valid',
        'must_room_type_id' => 'clock-type-1',
        'must_room_id' => 'clock-room-1',
        'must_rate_plan_id' => '',
        'checkin' => '2030-01-10',
        'checkout' => '2030-01-12',
        'adults' => '1',
        'children' => '0',
        'room_count' => '1',
    ];
    \MustHotelBooking\Core\MustApiClient::$availabilityResponse = [
        'ok' => true,
        'body' => ['checked' => true, 'isAvailable' => false],
    ];
    \MustHotelBooking\Core\MustApiClient::$quoteCalls = 0;
    $selectionError = maybe_process_accommodation_selection();
    assert_test(strpos($selectionError, 'no longer available') !== false, 'Accommodation selection must stop on a confirmed conflict.');
    assert_test(\MustHotelBooking\Core\MustApiClient::$quoteCalls === 0, 'Accommodation conflict gate must run before quote creation.');

    \MustHotelBooking\Core\MustApiClient::$availabilityResponse = ['ok' => false, 'body' => null];
    \MustHotelBooking\Core\MustApiClient::$quoteCalls = 0;
    $failureSelection = maybe_process_accommodation_selection();
    assert_test($failureSelection === '', 'Accommodation availability failures must fail open.');
    assert_test(\MustHotelBooking\Core\MustApiClient::$quoteCalls === 1, 'Fail-open accommodation selection must continue to quote creation.');

    echo "Clock search availability gate tests passed.\n";
}
