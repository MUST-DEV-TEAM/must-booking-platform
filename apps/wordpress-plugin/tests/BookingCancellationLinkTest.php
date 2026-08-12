<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') {
        exit(1);
    }

    function sanitize_text_field(string $value): string { return trim($value); }
    function wp_unslash($value) { return $value; }
    function add_action(...$args): void {}
    function add_query_arg(array $args, string $url): string {
        return $url . '?' . http_build_query($args);
    }
}

namespace MustHotelBooking\Frontend {
    require_once dirname(__DIR__) . '/src/Frontend/confirmation-page.php';

    $url = get_confirmation_cancellation_form_url('https://example.test/booking-confirmation/', [
        'booking_id' => 'booking-123',
        'cancellationToken' => 'header.payload.signature',
        'access_context' => str_repeat('a', 64),
    ]);
    $expected = 'https://example.test/booking-confirmation/?access_context=' . str_repeat('a', 64)
        . '&booking_id=booking-123&cancellationToken=header.payload.signature';
    if ($url !== $expected) {
        fwrite(STDERR, "Cancellation form URLs must preserve booking identity.\n");
        exit(1);
    }

    echo "Booking cancellation link tests passed.\n";
}
