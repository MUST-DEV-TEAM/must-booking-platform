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
    function wp_generate_uuid4(): string { return '00000000-0000-4000-8000-000000000050'; }
    function add_query_arg(array $args, string $url): string { return $url . '?' . http_build_query($args); }
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
        /** @var array<string, mixed>|null */
        public static ?array $postedBody = null;

        /** @return array{ok: bool, body: array<string, mixed>} */
        public static function get(string $path): array
        {
            return ['ok' => true, 'body' => $path === '/public/catalog' ? ['paymentMethods' => ['pay_at_hotel']] : []];
        }

        /** @param array<string, mixed> $body @return array{ok: bool, body: array<string, mixed>} */
        public static function post(string $path, array $body, string $idempotencyKey = ''): array
        {
            self::$postedBody = ['path' => $path, 'body' => $body, 'idempotencyKey' => $idempotencyKey];
            return ['ok' => true, 'body' => ['ok' => true, 'value' => ['id' => 'booking-50']]];
        }
    }
}

namespace MustHotelBooking\Frontend {
    /** @var array<string, mixed>|null $selection */
    $selection = [
        'roomTypeId' => 'room-type-50', 'ratePlanId' => 'rate-plan-50',
        'checkin' => '2027-09-01', 'checkout' => '2027-09-03', 'guests' => 2,
        'roomName' => 'Guest Count Suite', 'ratePlanName' => 'Flexible',
        'quote' => ['total' => ['amount' => '190.00', 'currency' => 'EUR'], 'quoteToken' => 'signed-quote'],
    ];

    function get_current_booking_selection(): ?array { global $selection; return $selection; }
    function set_current_booking_selection(array $value): void { global $selection; $selection = $value; }
    function clear_current_booking_selection(): void { global $selection; $selection = null; }
    function get_booking_accommodation_page_url(): string { return 'https://hotel.example.test/accommodation'; }
    function get_checkout_page_url(): string { return 'https://hotel.example.test/checkout'; }
    function get_booking_page_url(): string { return 'https://hotel.example.test/booking'; }
    function get_checkout_country_options(): array { return []; }
    function get_checkout_phone_code_options(): array { return []; }
    function enqueue_shared_booking_assets(): void {}
    function get_must_payment_methods(string $startsOn = '', string $endsOn = ''): array { return ['pay_at_hotel']; }

    require __DIR__ . '/../src/Frontend/checkout-page.php';

    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_POST = [
        'must_checkout_action' => 'continue_to_confirmation',
        'must_checkout_nonce' => 'valid',
        'room_guest_count' => ['1' => '2'],
        'first_name' => 'Two', 'last_name' => 'Guests', 'email' => 'two@example.test',
    ];
    try {
        maybe_process_checkout_submission();
        throw new \RuntimeException('Checkout should redirect after storing guest information.');
    } catch (\RuntimeException $error) {
        if (!str_starts_with($error->getMessage(), 'redirect:')) throw $error;
    }
    if (($selection['guestInfo']['guestCount'] ?? null) !== 2) {
        fwrite(STDERR, "Checkout did not retain the submitted guest count.\n");
        exit(1);
    }

    require __DIR__ . '/../src/Frontend/confirmation-page.php';
    $_POST = [
        'must_confirmation_action' => 'confirm_booking',
        'must_confirmation_nonce' => 'valid',
        'first_name' => 'Two', 'last_name' => 'Guests', 'email' => 'two@example.test',
        'payment_method' => 'pay_at_hotel',
    ];
    try {
        maybe_process_confirm_booking_submission();
        throw new \RuntimeException('Confirmation should redirect after booking creation.');
    } catch (\RuntimeException $error) {
        if (!str_starts_with($error->getMessage(), 'redirect:')) throw $error;
    }

    $posted = \MustHotelBooking\Core\MustApiClient::$postedBody;
    if (($posted['path'] ?? null) !== '/bookings' || ($posted['body']['guestCount'] ?? null) !== 2) {
        fwrite(STDERR, "Booking creation did not receive the guest count collected at checkout.\n");
        exit(1);
    }

    echo "Guest count checkout-to-booking payload test passed.\n";
}
