<?php
declare(strict_types=1);

namespace MustHotelBooking\Core {
    final class MustApiClient
    {
        public static function basePath(): string { return '/tenants/test-tenant/properties/test-property'; }
        public static function get(string $path, array $query = [], array $headers = []): array
        {
            if ($path !== '/public/exchange-rates') throw new \RuntimeException('Only MUST may supply rates.');
            return ['ok' => true, 'status' => 200, 'etag' => '"test"', 'body' => [
                'base' => 'ALL', 'version' => '8', 'displayCurrencies' => ['USD'],
                'rates' => ['ALL' => 1, 'EUR' => 1 / 90, 'USD' => 1 / 81.4, 'GBP' => 1 / 108],
                'sources' => ['ALL' => 'feed', 'EUR' => 'hotel', 'USD' => 'hotel', 'GBP' => 'hotel'],
            ]];
        }
    }
}

namespace {
    if (PHP_SAPI !== 'cli') exit(1);
    define('MINUTE_IN_SECONDS', 60);
    final class JsonResponse extends RuntimeException
    {
        public array $data;
        public function __construct(array $data) { parent::__construct('JSON response'); $this->data = $data; }
    }
    function add_action(...$args): void {}
    function wp_unslash($value) { return $value; }
    function get_transient(string $key) { return false; }
    function get_option(string $key) { return false; }
    function update_option(...$args): void {}
    function set_transient(...$args): void {}
    function wp_send_json_success(array $data): void { throw new JsonResponse($data); }
    function wp_send_json_error(array $data, int $status): void { throw new RuntimeException('Unexpected AJAX error: ' . $status); }

    require_once dirname(__DIR__) . '/src/Elementor/currency-switcher-widget.php';
    $_GET['currencies'] = 'EUR,USD'; // EUR is the room's source currency, not a menu choice.
    try {
        \MustHotelBooking\Elementor\ajax_get_currency_switcher_rates();
        throw new RuntimeException('The AJAX handler did not return JSON.');
    } catch (JsonResponse $response) {
        $data = $response->data;
        if (!isset($data['rates']['EUR'], $data['rates']['USD'], $data['rates']['ALL'])) throw new RuntimeException('Missing source/target/base conversion leg.');
        if ($data['displayCurrencies'] !== ['USD']) throw new RuntimeException('Source rates must not change the selected menu currencies.');
        if (($data['sources']['EUR'] ?? null) !== 'hotel') throw new RuntimeException('Preserve source metadata for the original currency.');
        if (isset($data['rates']['GBP']) || isset($data['sources']['GBP'])) throw new RuntimeException('Unrequested rates should remain filtered.');
        if (isset($data['_etag']) || isset($data['_scope'])) throw new RuntimeException('Private cache fields must not escape.');
        // The same fixture is the input of the JavaScript converter test, so what PHP emits and what the
        // browser code consumes cannot drift apart unnoticed.
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/fixtures/currency-switcher-ajax.json'), true);
        foreach (['base', 'version', 'displayCurrencies', 'sources'] as $field)
            if (($data[$field] ?? null) !== $fixture[$field]) throw new RuntimeException('The AJAX ' . $field . ' differs from the shared fixture.');
        if (array_keys($data['rates']) !== array_keys($fixture['rates'])) throw new RuntimeException('The AJAX rate currencies differ from the shared fixture.');
        foreach ($fixture['rates'] as $code => $rate)
            if (abs($data['rates'][$code] - $rate) > 1e-12) throw new RuntimeException('The AJAX ' . $code . ' rate differs from the shared fixture.');
    }
    echo "Currency switcher rate-leg test passed.\n";
}
