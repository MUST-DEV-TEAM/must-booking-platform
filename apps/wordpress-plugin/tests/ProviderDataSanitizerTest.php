<?php
declare(strict_types=1);

namespace {
    if (\PHP_SAPI !== 'cli') {
        exit(1);
    }

    require __DIR__ . '/../src/Provider/ProviderDataSanitizer.php';

    $sanitized = \MustHotelBooking\Provider\ProviderDataSanitizer::sanitize([
        'Authorization' => 'Bearer should-not-survive',
        'key_secret' => 'secret-value',
        'accessToken' => 'token-value',
        'card_number' => '4242424242424242',
        'pan_number' => '5555555555554444',
        'guest_phone' => '0691234567',
        'guest_first_name' => 'PrivateGuestName',
        'self_service_pin' => '2286',
        'common_door_codes' => ['1234'],
        'guest' => [
            'email' => 'guest@example.com',
            'phone' => '+355 69 123 4567',
        ],
        'message' => 'Authorization: Bearer abc.def.ghi guest@example.com',
    ]);

    $encoded = (string) \json_encode($sanitized);
    $failures = [];

    foreach (['should-not-survive', 'secret-value', 'token-value', '4242424242424242', '5555555555554444', '0691234567', 'PrivateGuestName', '2286', '1234', 'guest@example.com', '+355 69 123 4567', 'abc.def.ghi'] as $secret) {
        if (\strpos($encoded, $secret) !== false) {
            $failures[] = 'Sensitive value was not redacted: ' . $secret;
        }
    }

    if ((string) ($sanitized['key_secret'] ?? '') !== '[redacted]') {
        $failures[] = 'Key secrets must be recursively redacted.';
    }

    if ((string) ($sanitized['self_service_pin'] ?? '') !== '[redacted]') {
        $failures[] = 'Self-service PINs must be recursively redacted.';
    }

    if ($failures) {
        echo "FAIL\n" . \implode("\n", $failures) . "\n";
        exit(1);
    }

    echo "Provider data sanitizer tests passed.\n";
}
