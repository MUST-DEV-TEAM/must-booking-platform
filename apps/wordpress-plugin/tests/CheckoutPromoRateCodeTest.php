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

    /**
     * A hotel whose "Special" rate needs the code TESTCODE. Without the code the API offers only the regular
     * rate; with it, both. A coupon the hotel does not know is refused by the quote, like the real API does.
     */
    final class MustApiClient
    {
        /** @var array<int, array<string, mixed>> */
        public static array $quotes = [];
        /** @var array<int, array<string, mixed>> */
        public static array $offerQueries = [];

        /** @param array<string, mixed> $query @return array{ok: bool, body: array<string, mixed>} */
        public static function get(string $path, array $query = []): array
        {
            if ($path !== '/public/rate-offers') return ['ok' => true, 'body' => []];
            self::$offerQueries[] = $query;
            $regular = ['rateId' => '1', 'name' => 'Normal', 'label' => 'Room only', 'mealNames' => [], 'total' => ['amount' => '300.00', 'currency' => 'EUR']];
            $other = ['rateId' => '3', 'name' => 'Early', 'label' => 'Bed & breakfast', 'mealNames' => [], 'total' => ['amount' => '264.00', 'currency' => 'EUR'], 'originalTotal' => ['amount' => '300.00', 'currency' => 'EUR']];
            $special = ['rateId' => '2', 'name' => 'Members', 'label' => 'Room only', 'mealNames' => [], 'total' => ['amount' => '270.00', 'currency' => 'EUR'], 'requiresCode' => true];
            $offers = [$regular, $other];
            if (strtoupper((string) ($query['code'] ?? '')) === 'TESTCODE') $offers[] = $special;
            return ['ok' => true, 'body' => ['offers' => $offers]];
        }

        /** @param array<string, mixed> $body @return array{ok: bool, body: array<string, mixed>} */
        public static function post(string $path, array $body, string $idempotencyKey = ''): array
        {
            self::$quotes[] = $body;
            $code = strtoupper((string) ($body['promoCode'] ?? ''));
            $rate = (string) ($body['clockRateId'] ?? '');
            if ($code !== '' && !($code === 'TESTCODE' && $rate === '2')) {
                return ['ok' => false, 'body' => ['message' => 'This code is not valid.']];
            }
            $amount = $rate === '2' ? '270.00' : ($rate === '3' ? '264.00' : '300.00');
            return ['ok' => true, 'body' => ['total' => ['amount' => $amount, 'currency' => 'EUR'], 'quoteToken' => 'token-' . $rate]];
        }
    }
}

namespace MustHotelBooking\Frontend {
    $selection = [
        'roomTypeId' => 'room-type-1', 'ratePlanId' => '', 'roomName' => 'APP', 'ratePlanName' => 'Room only',
        'checkin' => '2027-09-01', 'checkout' => '2027-09-03', 'guests' => 2, 'adults' => 2, 'children' => 0,
        'clockRateId' => '1',
        'quote' => ['total' => ['amount' => '300.00', 'currency' => 'EUR'], 'quoteToken' => 'token-1'],
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
    $ids = static fn (array $offers): array => array_map(static fn (array $offer): string => (string) $offer['rateId'], $offers);
    $post = static function (array $fields) {
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_POST = ['must_checkout_nonce' => 'valid'] + $fields;
        try {
            maybe_process_checkout_submission();
            throw new \RuntimeException('Expected a redirect back to checkout.');
        } catch (\RuntimeException $error) {
            if ($error->getMessage() !== 'redirect:https://hotel.example.test/checkout') throw $error;
        }
    };

    // Without a code the guest does not see the special rate.
    if ($ids(get_selection_rate_offers($selection)) !== ['1', '3']) $fail('The special rate must stay hidden without its code.');

    // The coupon box: a code that is not one of the hotel's coupons but unlocks a rate reveals that rate.
    $post(['must_checkout_action' => 'preview_coupon', 'coupon_code' => 'testcode']);
    if (($selection['rateCode'] ?? '') !== 'testcode') $fail('The unlocking code was not kept.');
    if (($selection['couponNotice']['type'] ?? '') !== 'success') $fail('A code that unlocks a rate must be accepted.');
    if (isset($selection['promoCode'])) $fail('An unlocking code is not a coupon discount.');
    if ($ids(get_selection_rate_offers($selection)) !== ['1', '3', '2']) $fail('The special rate must appear once its code is entered.');

    // The guest chooses it: the stay is priced under that rate WITH the code, and the rate is remembered as special.
    $post(['must_checkout_action' => 'choose_rate', 'clock_rate_id' => '2']);
    $last = \MustHotelBooking\Core\MustApiClient::$quotes[count(\MustHotelBooking\Core\MustApiClient::$quotes) - 1];
    if (($last['clockRateId'] ?? '') !== '2' || ($last['promoCode'] ?? '') !== 'testcode') $fail('The special rate must be priced with its code.');
    if (($selection['clockRateId'] ?? '') !== '2' || empty($selection['rateNeedsCode'])) $fail('The chosen special rate was not kept.');

    // Choosing a regular rate again does not send the code along as if it were a coupon.
    $post(['must_checkout_action' => 'choose_rate', 'clock_rate_id' => '1']);
    $last = \MustHotelBooking\Core\MustApiClient::$quotes[count(\MustHotelBooking\Core\MustApiClient::$quotes) - 1];
    if (isset($last['promoCode'])) $fail('A regular rate must not be priced with the unlocking code.');
    if (!empty($selection['rateNeedsCode'])) $fail('A regular rate is not a special rate.');

    // A code that is neither a coupon nor an unlocking code is refused with the API's own message.
    $post(['must_checkout_action' => 'preview_coupon', 'coupon_code' => 'NOPE']);
    if (($selection['couponNotice']['type'] ?? '') !== 'error') $fail('An unknown code must be refused.');
    if (($selection['rateCode'] ?? '') !== 'testcode') $fail('A refused code must not remove the code already accepted.');

    // Removing the code takes the special rate away and goes back to the regular price.
    $post(['must_checkout_action' => 'choose_rate', 'clock_rate_id' => '2']);
    $post(['must_checkout_action' => 'preview_coupon', 'coupon_code' => '']);
    if (isset($selection['rateCode']) || ($selection['clockRateId'] ?? '') !== '' && isset($selection['clockRateId'])) $fail('Removing the code must remove the special rate.');
    if ($ids(get_selection_rate_offers($selection)) !== ['1', '3']) $fail('Without the code the special rate is hidden again.');

    // The crossed-out price of the chosen rate comes from the rate list.
    $selection['clockRateId'] = '3';
    $offer = selected_rate_offer($selection);
    if (($offer['originalTotal']['amount'] ?? '') !== '300.00') $fail('The chosen rate must bring its price before the discount.');

    fwrite(STDOUT, "Checkout promo rate code test passed.\n");
}
