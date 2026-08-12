<?php
declare(strict_types=1);

namespace {
    if (PHP_SAPI !== 'cli') {
        exit(1);
    }

    define('OBJECT', 'OBJECT');
    $GLOBALS['must_single_room_test_admin_email'] = 'hello@example.test';
    $GLOBALS['must_single_room_test_pages'] = [
        'terms-conditions' => (object) ['ID' => 42, 'post_status' => 'publish'],
    ];

    function add_action(...$args): void {}
    function get_option(string $option, $default = false) {
        return $option === 'admin_email' ? $GLOBALS['must_single_room_test_admin_email'] : $default;
    }
    function sanitize_email(string $email): string { return filter_var($email, FILTER_SANITIZE_EMAIL) ?: ''; }
    function is_email(string $email): bool { return filter_var($email, FILTER_VALIDATE_EMAIL) !== false; }
    function get_page_by_path(string $slug, $output = OBJECT, string $postType = 'page') {
        return $GLOBALS['must_single_room_test_pages'][$slug] ?? null;
    }
    function get_permalink(int $pageId): string { return 'https://example.test/terms-and-conditions/'; }
}

namespace MustHotelBooking\Frontend {
    require_once dirname(__DIR__) . '/src/Frontend/single-room-page.php';

    $failures = [];
    if (get_single_room_inquiry_url() !== 'mailto:hello@example.test') {
        $failures[] = 'The inquiry CTA should use the WordPress admin-email fallback.';
    }
    if (get_single_room_terms_url() !== 'https://example.test/terms-and-conditions/') {
        $failures[] = 'The terms CTA should resolve a published common terms-page slug.';
    }

    $GLOBALS['must_single_room_test_admin_email'] = '';
    $GLOBALS['must_single_room_test_pages'] = [];
    if (get_single_room_inquiry_url() !== '') {
        $failures[] = 'The inquiry CTA should be hidden when no fallback email exists.';
    }
    if (get_single_room_terms_url() !== '') {
        $failures[] = 'The terms CTA should be hidden when no matching page exists.';
    }

    if ($failures !== []) {
        fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
        exit(1);
    }

    echo "Single room presentation tests passed.\n";
}
