<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') exit(1);

    function sanitize_key(string $value): string { return $value; }
    function sanitize_text_field(string $value): string { return trim($value); }
    function sanitize_textarea_field(string $value): string { return trim($value); }
    function sanitize_email(string $value): string { return trim($value); }
    function wp_unslash($value) { return $value; }
    function wp_verify_nonce(string $nonce, string $action): bool { return $nonce === 'valid' && $action !== ''; }
    function __($value, string $domain = ''): string { return (string) $value; }
    function add_action(...$args): void {}
    function wp_safe_redirect(string $url): void { throw new \RuntimeException('redirect:' . $url); }
}

namespace MustHotelBooking\Core {
    final class ManagedPages
    {
        public static function getBookingConfirmationPageUrl(): string { return 'https://hotel.example.test/booking-confirmation'; }
    }

    final class MustApiClient
    {
        /** @var array<int, array<string, mixed>> */
        public static array $offers = [];
        /** @var array<string, mixed>|null */
        public static ?array $quoted = null;

        /** @param array<string, mixed> $query @return array{ok: bool, body: array<string, mixed>} */
        public static function get(string $path, array $query = []): array
        {
            return ['ok' => true, 'body' => $path === '/public/rate-offers' ? ['offers' => self::$offers] : []];
        }

        /** @param array<string, mixed> $body @return array{ok: bool, body: array<string, mixed>} */
        public static function post(string $path, array $body, string $idempotencyKey = ''): array
        {
            self::$quoted = ['path' => $path, 'body' => $body];
            return ['ok' => true, 'body' => ['total' => ['amount' => '340.00', 'currency' => 'EUR'], 'quoteToken' => 'token-for-' . ($body['clockRateId'] ?? 'default')]];
        }
    }
}

namespace MustHotelBooking\Frontend {
    $selection = [
        'roomTypeId' => 'room-type-1', 'ratePlanId' => '', 'roomName' => 'APP', 'ratePlanName' => 'Best available rate',
        'checkin' => '2027-09-01', 'checkout' => '2027-09-03', 'guests' => 2, 'adults' => 2, 'children' => 0,
        'quote' => ['total' => ['amount' => '300.00', 'currency' => 'EUR'], 'quoteToken' => 'token-for-default'],
    ];

    function get_current_booking_selection(): ?array { global $selection; return $selection; }
    function set_current_booking_selection(array $value): void { global $selection; $selection = $value; }
    function get_booking_accommodation_page_url(): string { return 'https://hotel.example.test/accommodation'; }
    function get_checkout_page_url(): string { return 'https://hotel.example.test/checkout'; }
    function get_booking_page_url(): string { return 'https://hotel.example.test/booking'; }
    function get_checkout_country_options(): array { return []; }
    function get_checkout_phone_code_options(): array { return []; }
    function enqueue_shared_booking_assets(): void {}

    require __DIR__ . '/../src/Frontend/checkout-page.php';

    $fail = static function (string $message): void {
        fwrite(STDERR, $message . "\n");
        exit(1);
    };

    $offer = static fn (string $id, string $label, string $amount): array => [
        'rateId' => $id, 'name' => 'Rate ' . $id, 'label' => $label, 'mealNames' => [],
        'total' => ['amount' => $amount, 'currency' => 'EUR'],
    ];

    // One rate only: nothing to choose, the picker stays hidden.
    \MustHotelBooking\Core\MustApiClient::$offers = [$offer('1', 'Room only', '300.00')];
    if (get_selection_rate_offers($selection) !== []) $fail('A single rate must not be offered as a choice.');

    // Several rates: the guest sees all of them.
    \MustHotelBooking\Core\MustApiClient::$offers = [$offer('1', 'Room only', '300.00'), $offer('2', 'Bed & breakfast', '340.00')];
    if (count(get_selection_rate_offers($selection)) !== 2) $fail('Several rates must all be offered.');

    // Choosing a rate prices the stay again under it and keeps its signed quote.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = ['must_checkout_action' => 'choose_rate', 'must_checkout_nonce' => 'valid', 'clock_rate_id' => '2'];
    try {
        maybe_process_checkout_submission();
        throw new \RuntimeException('Choosing a rate should redirect back to checkout.');
    } catch (\RuntimeException $error) {
        if ($error->getMessage() !== 'redirect:https://hotel.example.test/checkout') throw $error;
    }
    $quoted = \MustHotelBooking\Core\MustApiClient::$quoted;
    if (($quoted['path'] ?? '') !== '/quotes' || ($quoted['body']['clockRateId'] ?? '') !== '2') $fail('The chosen rate was not sent with the quote.');
    if (($selection['clockRateId'] ?? '') !== '2' || ($selection['quote']['quoteToken'] ?? '') !== 'token-for-2') $fail('The chosen rate and its quote were not kept.');
    if (($selection['ratePlanName'] ?? '') !== 'Bed & breakfast') $fail('The chosen rate name was not kept.');

    // A rate that is not on offer is refused and the selection is left alone.
    $_POST = ['must_checkout_action' => 'choose_rate', 'must_checkout_nonce' => 'valid', 'clock_rate_id' => '999'];
    $message = maybe_process_checkout_submission();
    if ($message === '' || ($selection['clockRateId'] ?? '') !== '2') $fail('An unknown rate must be refused without changing the selection.');

    echo "Checkout rate choice test passed.\n";
}
