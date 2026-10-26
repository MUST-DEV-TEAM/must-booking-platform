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
        /** @var array<int, array<string, mixed>> */
        public static array $quotes = [];

        /** @param array<string, mixed> $query @return array{ok: bool, body: array<string, mixed>} */
        public static function get(string $path, array $query = []): array
        {
            return ['ok' => true, 'body' => $path === '/public/rate-offers' ? ['offers' => self::$offers] : []];
        }

        /** @param array<string, mixed> $body @return array{ok: bool, body: array<string, mixed>} */
        public static function post(string $path, array $body, string $idempotencyKey = ''): array
        {
            self::$quotes[] = $body;
            $code = (string) ($body['promoCode'] ?? '');
            if ($code === 'BADCODE') {
                return ['ok' => false, 'body' => ['message' => 'This code cannot be used.']];
            }
            $base = ($body['clockRateId'] ?? '') === '2' ? 340.0 : 300.0;
            if ($code === 'WELCOME10') {
                return ['ok' => true, 'body' => [
                    'total' => ['amount' => number_format($base * 0.9, 2, '.', ''), 'currency' => 'EUR'],
                    'quoteToken' => 'promo-token',
                    'promo' => [
                        'code' => 'WELCOME10', 'kind' => 'PERCENT', 'value' => '10',
                        'discount' => ['amount' => number_format($base * 0.1, 2, '.', ''), 'currency' => 'EUR'],
                        'originalTotal' => ['amount' => number_format($base, 2, '.', ''), 'currency' => 'EUR'],
                    ],
                ]];
            }
            return ['ok' => true, 'body' => ['total' => ['amount' => number_format($base, 2, '.', ''), 'currency' => 'EUR'], 'quoteToken' => 'plain-token']];
        }
    }
}

namespace MustHotelBooking\Frontend {
    $selection = [
        'roomTypeId' => 'room-type-1', 'ratePlanId' => '', 'roomName' => 'APP', 'ratePlanName' => 'Room only',
        'checkin' => '2027-09-01', 'checkout' => '2027-09-03', 'guests' => 2, 'adults' => 2, 'children' => 0,
        'quote' => ['total' => ['amount' => '300.00', 'currency' => 'EUR'], 'quoteToken' => 'plain-token'],
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
    $submit = static function (array $post): void {
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_POST = $post + ['must_checkout_nonce' => 'valid'];
        try {
            maybe_process_checkout_submission();
            throw new \RuntimeException('Expected a redirect back to checkout.');
        } catch (\RuntimeException $error) {
            if ($error->getMessage() !== 'redirect:https://hotel.example.test/checkout') throw $error;
        }
    };

    // A valid code re-prices the stay, keeps the signed quote and records the code.
    $submit(['must_checkout_action' => 'preview_coupon', 'coupon_code' => 'WELCOME10', 'first_name' => 'Ada', 'email' => 'ada@example.test']);
    if (($selection['promoCode'] ?? '') !== 'WELCOME10') $fail('The applied code was not kept.');
    if (($selection['quote']['quoteToken'] ?? '') !== 'promo-token') $fail('The quote with the code was not kept.');
    if (($selection['couponNotice']['type'] ?? '') !== 'success') $fail('The guest was not told the code applied.');
    if (($selection['guestInfo']['firstName'] ?? '') !== 'Ada') $fail('What the guest had typed was lost.');

    // The page shows the original price, the discount and the discounted total.
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_POST = [];
    $view = get_checkout_page_view_data();
    if ($view['applied_coupon_code'] !== 'WELCOME10') $fail('The applied code is not shown.');
    if (abs($view['summary']['total_price'] - 270.0) > 0.001) $fail('The total must be the discounted price.');
    if (abs($view['summary']['discount_total'] - 30.0) > 0.001) $fail('The discount must be shown.');
    if (abs($view['summary']['room_subtotal'] - 300.0) > 0.001) $fail('The original price must be shown.');
    if (($view['coupon_notice']['type'] ?? '') !== 'success') $fail('The notice must reach the page.');
    if (isset($selection['couponNotice'])) $fail('A notice must show only once.');

    // Choosing another rate keeps the code and prices it under the new rate.
    \MustHotelBooking\Core\MustApiClient::$offers = [
        ['rateId' => '1', 'name' => 'Rate 1', 'label' => 'Room only', 'mealNames' => [], 'total' => ['amount' => '300.00', 'currency' => 'EUR']],
        ['rateId' => '2', 'name' => 'Rate 2', 'label' => 'Bed & breakfast', 'mealNames' => [], 'total' => ['amount' => '340.00', 'currency' => 'EUR']],
    ];
    $submit(['must_checkout_action' => 'choose_rate', 'clock_rate_id' => '2']);
    if (($selection['promoCode'] ?? '') !== 'WELCOME10' || ($selection['clockRateId'] ?? '') !== '2') $fail('The code must survive a change of rate.');
    $last = end(\MustHotelBooking\Core\MustApiClient::$quotes);
    if (($last['promoCode'] ?? '') !== 'WELCOME10' || ($last['clockRateId'] ?? '') !== '2') $fail('The new rate must be priced with the code.');

    // A code that is refused leaves the price and the applied code alone and says why.
    $submit(['must_checkout_action' => 'preview_coupon', 'coupon_code' => 'BADCODE']);
    if (($selection['promoCode'] ?? '') !== 'WELCOME10') $fail('A refused code must not remove the applied one.');
    if (($selection['couponNotice']['type'] ?? '') !== 'error' || $selection['couponNotice']['message'] !== 'This code cannot be used.') $fail('The refusal must be shown.');

    // An empty code removes the coupon and restores the full price.
    $submit(['must_checkout_action' => 'preview_coupon', 'coupon_code' => '']);
    if (isset($selection['promoCode'])) $fail('Emptying the field must remove the code.');
    if (($selection['quote']['quoteToken'] ?? '') !== 'plain-token') $fail('Removing the code must restore the normal quote.');

    echo "Checkout coupon test passed.\n";
}
