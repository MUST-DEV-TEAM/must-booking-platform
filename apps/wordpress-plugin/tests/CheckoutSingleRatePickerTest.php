<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') exit(1);
    if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
    function esc_html($v): string { return htmlspecialchars((string) $v, ENT_QUOTES); }
    function esc_attr($v): string { return htmlspecialchars((string) $v, ENT_QUOTES); }
    function esc_url($v): string { return (string) $v; }
    function esc_html__($v, string $d = ''): string { return htmlspecialchars((string) $v, ENT_QUOTES); }
    function esc_attr__($v, string $d = ''): string { return htmlspecialchars((string) $v, ENT_QUOTES); }
    function esc_html_e($v, string $d = ''): void { echo htmlspecialchars((string) $v, ENT_QUOTES); }
    function __($v, string $d = ''): string { return (string) $v; }
    function _n($s, $p, $n, string $d = ''): string { return (string) ($n === 1 ? $s : $p); }
    function home_url(string $p = ''): string { return 'https://hotel.example.test' . $p; }
    function must_hotel_booking_asset_url(string $p): string { return 'https://hotel.example.test/' . ltrim($p, '/'); }
    function wp_nonce_field(...$a): void {}
    function wp_kses_post($v): string { return (string) $v; }
    function absint($v): int { return abs((int) $v); }
    function selected($a, $b = true, bool $d = true): string { return $a == $b ? ' selected' : ''; }
    function checked($a, $b = true, bool $d = true): string { return $a == $b ? ' checked' : ''; }
    function disabled($a, $b = true, bool $d = true): string { return $a ? 'disabled' : ''; }
    function number_format_i18n($n, int $d = 0): string { return number_format((float) $n, $d); }
    function esc_textarea($v): string { return htmlspecialchars((string) $v, ENT_QUOTES); }
    function get_header(): void {}
    function get_footer(): void {}
    function wp_json_encode($v, int $f = 0, int $d = 512) { return json_encode($v, $f, $d); }
}

namespace MustHotelBooking\Core {
    final class BookingPerformanceMonitor
    {
        public static function startSpan(string $n): string { return $n; }
        public static function stopSpan($s): void {}
    }
}

namespace MustHotelBooking\Engine {
    final class BookingAbuseProtection
    {
        public static function shouldRenderHoneypotField(): bool { return false; }
        public static function getHoneypotFieldName(): string { return ''; }
    }
}

namespace MustHotelBooking\Core {
    final class MustBookingConfig
    {
        public static function get_checkout_price_breakdown_mode(): string { return 'summary'; }
        public static function get_setting(string $k, $d = null) { return $d; }
    }
}

namespace must_hotel_booking {
    function get_checkout_page_view_data(): array
    {
        $offer = static fn (string $id, string $label, string $amount): array => [
            'rateId' => $id, 'name' => 'Rate ' . $id, 'label' => $label,
            'total' => ['amount' => $amount, 'currency' => 'EUR'],
        ];
        return [
            'is_valid_context' => true, 'checkin' => '2030-05-04', 'checkout' => '2030-05-07', 'guests' => 2,
            'adults' => 2, 'children' => 0, 'room_count' => 1, 'selected_room_count' => 1,
            'rate_offers' => [$offer('1', 'Bed and breakfast', '330.00') + ['originalTotal' => ['amount' => '375.00', 'currency' => 'EUR']], $offer('2', 'Room only', '300.00') + ['requiresCode' => true]],
            'selected_rate_id' => '1', 'summary' => ['total_price' => 330.0, 'currency' => 'EUR'],
            'selected_rooms' => [], 'guest_form' => [], 'messages' => [],
        ];
    }
    function get_checkout_default_phone_option_value(): string { return ''; }
}

namespace MustHotelBooking\Frontend {
    require __DIR__ . '/../src/Frontend/formatting.php';
    function get_checkout_phone_option_details(string $v): array { return []; }

    ob_start();
    include __DIR__ . '/../frontend/templates/checkout.php';
    $html = (string) ob_get_clean();

    $pickers = substr_count($html, 'name="clock_rate_id"');
    if ($pickers !== 2) {
        fwrite(STDERR, "Expected one picker with two rate choices, found $pickers choices.\n");
        exit(1);
    }
    if (substr_count($html, 'class="must-checkout-rates"') !== 1) {
        fwrite(STDERR, "The rate picker must appear exactly once.\n");
        exit(1);
    }
    $coupon = strpos($html, 'must-checkout-coupon-row');
    $rates = strpos($html, 'class="must-checkout-rates"');
    if ($coupon === false || $rates === false || $rates < $coupon) {
        fwrite(STDERR, "The rate picker must sit below the coupon.\n");
        exit(1);
    }
    if (substr_count($html, 'must-checkout-rate-original') !== 1) {
        fwrite(STDERR, "Only the discounted rate shows its price before the discount, crossed out.\n");
        exit(1);
    }
    if (substr_count($html, 'Special rate') !== 1) {
        fwrite(STDERR, "A rate that needs a code is labelled a special rate.\n");
        exit(1);
    }
    fwrite(STDOUT, "Checkout single rate picker test passed.\n");
}
