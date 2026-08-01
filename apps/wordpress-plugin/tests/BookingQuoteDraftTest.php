<?php
declare(strict_types=1);

namespace {
    if (\PHP_SAPI !== 'cli') {
        exit(1);
    }

    function sanitize_text_field($value): string { return \trim((string) $value); }
    function sanitize_key($value): string { return \strtolower((string) \preg_replace('/[^a-z0-9_\-]/i', '', (string) $value)); }
    function wp_json_encode($value, int $flags = 0): string { return (string) \json_encode($value, $flags); }
    function wp_salt(string $scheme = 'auth'): string { return 'test-salt-' . $scheme; }
}

namespace MustHotelBooking\Core {
    final class MustBookingConfig
    {
        public static function get_currency(): string { return 'EUR'; }
    }
}

namespace MustHotelBooking\Engine {
    final class LockEngine
    {
        public static function getTtlSeconds(): int { return 600; }
    }
}

namespace {
    require __DIR__ . '/../src/Engine/BookingQuoteDraft.php';

    $context = [
        'checkin' => '2026-09-15',
        'checkout' => '2026-09-16',
        'guests' => 1,
        'adults' => 1,
        'children' => 0,
        'child_ages' => [],
        'room_count' => 1,
        'accommodation_type' => 'room-40',
    ];
    $selectedRooms = [
        ['room_id' => 63, 'rate_plan_id' => 4],
    ];
    $roomItems = [
        'items' => [
            [
                'room_id' => 63,
                'rate_plan_id' => 4,
                'assigned_guests' => 1,
                'room' => ['id' => 63, 'room_type_id' => 40, 'name' => 'Room 63'],
                'rate_plan' => ['id' => 4, 'name' => 'Flexible'],
                'pricing' => [
                    'success' => true,
                    'room_subtotal' => 100,
                    'taxes_total' => 10,
                    'fees_total' => 5,
                    'total_price' => 115,
                    'nights' => 1,
                    'nightly_rates' => [
                        ['date' => '2026-09-15', 'rate' => 100.0],
                    ],
                    'currency' => 'EUR',
                    'guarantee_policy_id' => 9,
                    'cancellation_policy' => [
                        'cancel_before_days' => 21,
                        'penalty_amount' => 0,
                    ],
                ],
            ],
        ],
        'summary' => [
            'room_subtotal' => 100,
            'taxes_total' => 10,
            'fees_total' => 5,
            'discount_total' => 0,
            'total_price' => 115,
            'nights' => 1,
            'applied_coupon' => '',
        ],
    ];
    $draft = \MustHotelBooking\Engine\BookingQuoteDraft::create(
        $context,
        $selectedRooms,
        $roomItems,
        '',
        [],
        'checkout'
    );
    $failures = [];

    if (!\MustHotelBooking\Engine\BookingQuoteDraft::isValidFor($draft, $context, $selectedRooms)) {
        $failures[] = 'A newly created quote draft should validate for the same booking context.';
    }
    if ((int) ($draft['accommodation_id'] ?? 0) !== 40 || (int) ($draft['inventory_room_id'] ?? 0) !== 63) {
        $failures[] = 'The quote draft should retain accommodation and physical inventory identifiers.';
    }
    if ((string) ($draft['token'] ?? '') === '' || (int) ($draft['expires_at'] ?? 0) <= (int) ($draft['created_at'] ?? 0)) {
        $failures[] = 'The quote draft should contain a secure token and future expiration.';
    }
    if ((int) ($draft['adults'] ?? 0) !== 1 || (int) ($draft['children'] ?? -1) !== 0 || !empty($draft['child_ages'])) {
        $failures[] = 'The quote draft should retain the normalized guest composition.';
    }
    if ((int) ($draft['guarantee_policy_snapshot'][0]['guarantee_policy_id'] ?? 0) !== 9) {
        $failures[] = 'The quote draft should retain the guarantee policy snapshot.';
    }

    $tampered = $draft;
    $tampered['pricing_snapshot']['summary']['total_price'] = 1;
    if (\MustHotelBooking\Engine\BookingQuoteDraft::isValidFor($tampered, $context, $selectedRooms)) {
        $failures[] = 'A tampered quote total must invalidate the quote signature.';
    }
    if (\MustHotelBooking\Engine\BookingQuoteDraft::validationFailureReason($tampered, $context, $selectedRooms) !== 'tampered') {
        $failures[] = 'Tampered quote drafts should report a tampered validation reason.';
    }

    $expired = $draft;
    $expired['expires_at'] = \time() - 1;
    if (\MustHotelBooking\Engine\BookingQuoteDraft::isValidFor($expired, $context, $selectedRooms)) {
        $failures[] = 'Expired quote drafts must not validate.';
    }
    if (\MustHotelBooking\Engine\BookingQuoteDraft::validationFailureReason($expired, $context, $selectedRooms) !== 'expired') {
        $failures[] = 'Expired quote drafts should report an expired validation reason.';
    }

    $changedContext = $context;
    $changedContext['guests'] = 2;
    if (\MustHotelBooking\Engine\BookingQuoteDraft::isValidFor($draft, $changedContext, $selectedRooms)) {
        $failures[] = 'Changing occupancy must invalidate the stored quote.';
    }
    $changedRooms = [['room_id' => 64, 'rate_plan_id' => 4]];
    if (\MustHotelBooking\Engine\BookingQuoteDraft::isValidFor($draft, $context, $changedRooms)) {
        $failures[] = 'Tampered room values from a URL or form must not replace the server-side room selection.';
    }
    if (\MustHotelBooking\Engine\BookingQuoteDraft::isValidFor($draft, $context, $selectedRooms, 'FAKE')) {
        $failures[] = 'Tampered coupon values must not replace the signed server-side quote context.';
    }

    $freshPricing = $roomItems['items'][0]['pricing'];
    if (!\MustHotelBooking\Engine\BookingQuoteDraft::pricingMatches($draft, 63, 4, $freshPricing)) {
        $failures[] = 'An unchanged fresh price should match the signed quote.';
    }
    $freshPricing['total_price'] = 116;
    if (\MustHotelBooking\Engine\BookingQuoteDraft::pricingMatches($draft, 63, 4, $freshPricing)) {
        $failures[] = 'A changed fresh price must not match the old signed quote.';
    }
    if (!\MustHotelBooking\Engine\BookingQuoteDraft::guaranteePolicyMatches($draft, 63, ['guarantee_policy_id' => 9])) {
        $failures[] = 'An unchanged fresh guarantee policy should match the signed quote.';
    }
    if (\MustHotelBooking\Engine\BookingQuoteDraft::guaranteePolicyMatches($draft, 63, ['guarantee_policy_id' => 10])) {
        $failures[] = 'A changed guarantee policy must require customer review.';
    }
    if (!\MustHotelBooking\Engine\BookingQuoteDraft::cancellationPolicyMatches($draft, 63, [
        'cancellation_policy' => ['penalty_amount' => 0, 'cancel_before_days' => 21],
    ])) {
        $failures[] = 'An unchanged cancellation policy should match the signed quote.';
    }
    if (\MustHotelBooking\Engine\BookingQuoteDraft::cancellationPolicyMatches($draft, 63, [
        'cancellation_policy' => ['penalty_amount' => 50, 'cancel_before_days' => 21],
    ])) {
        $failures[] = 'A changed cancellation policy must require customer review.';
    }

    $cachedItems = \MustHotelBooking\Engine\BookingQuoteDraft::roomItems($draft);
    if ((float) ($cachedItems['summary']['total_price'] ?? 0) !== 115.0 || (string) ($cachedItems['quote_cache'] ?? '') !== 'hit') {
        $failures[] = 'A valid quote should restore the local pricing snapshot without a provider call.';
    }
    if ((float) ($cachedItems['items'][0]['pricing']['nightly_rates'][0]['rate'] ?? 0) !== 100.0) {
        $failures[] = 'A valid quote should retain nightly rate rows for checkout and email display.';
    }

    if ($failures) {
        echo "FAIL\n" . \implode("\n", $failures) . "\n";
        exit(1);
    }

    echo "Booking quote draft tests passed.\n";
}
