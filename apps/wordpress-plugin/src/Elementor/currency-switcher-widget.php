<?php

namespace MustHotelBooking\Elementor;

use MustHotelBooking\Core\MustApiClient;

/** @return array<string, string> code => label */
function get_currency_switcher_currency_options(): array
{
    $names = [
        'EUR' => 'Euro', 'USD' => 'US Dollar', 'GBP' => 'British Pound', 'ALL' => 'Albanian Lek', 'CHF' => 'Swiss Franc',
        'CAD' => 'Canadian Dollar', 'AUD' => 'Australian Dollar', 'SEK' => 'Swedish Krona', 'NOK' => 'Norwegian Krone',
        'DKK' => 'Danish Krone', 'PLN' => 'Polish Zloty', 'CZK' => 'Czech Koruna', 'HUF' => 'Hungarian Forint',
        'RON' => 'Romanian Leu', 'BGN' => 'Bulgarian Lev', 'TRY' => 'Turkish Lira', 'MKD' => 'Macedonian Denar',
        'RSD' => 'Serbian Dinar', 'BAM' => 'Bosnian Mark', 'ILS' => 'Israeli Shekel', 'AED' => 'UAE Dirham',
        'JPY' => 'Japanese Yen', 'CNY' => 'Chinese Yuan', 'INR' => 'Indian Rupee', 'BRL' => 'Brazilian Real',
    ];
    $options = [];
    foreach ($names as $code => $name) $options[$code] = $code . ' - ' . $name;
    return $options;
}

/** @param mixed $value @return array<int, string> */
function normalize_currency_switcher_list($value): array
{
    $codes = [];
    foreach ((array) $value as $code) {
        $code = \strtoupper(\trim((string) $code));
        if (\preg_match('/^[A-Z]{3}$/', $code) === 1) $codes[$code] = $code;
    }
    return \array_values($codes);
}

function register_elementor_currency_switcher_assets(): void
{
    \wp_register_style('must-hotel-booking-currency-switcher', MUST_HOTEL_BOOKING_URL . 'assets/css/currency-switcher.css', [], MUST_HOTEL_BOOKING_VERSION);
    \wp_register_script('must-hotel-booking-currency-switcher', MUST_HOTEL_BOOKING_URL . 'assets/js/currency-switcher.js', [], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_localize_script('must-hotel-booking-currency-switcher', 'mustCurrencyConfig', ['ajaxUrl' => \admin_url('admin-ajax.php')]);
}

/** @return array{base: string, date: string, rates: array<string, float>}|null euro-based rates from a free daily feed */
function fetch_currency_switcher_rates_directly(): ?array
{
    $feeds = [
        ['https://open.er-api.com/v6/latest/EUR', 'rates', null],
        ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json', 'eur', 'date'],
    ];
    foreach ($feeds as [$url, $ratesKey, $dateKey]) {
        $response = \wp_remote_get($url, ['timeout' => 8]);
        if (\is_wp_error($response) || (int) \wp_remote_retrieve_response_code($response) !== 200) continue;
        $body = \json_decode((string) \wp_remote_retrieve_body($response), true);
        if (!\is_array($body) || !\is_array($body[$ratesKey] ?? null)) continue;
        $rates = [];
        foreach ($body[$ratesKey] as $code => $value) {
            $code = \strtoupper((string) $code);
            if (\preg_match('/^[A-Z]{3}$/', $code) === 1 && \is_numeric($value) && (float) $value > 0) $rates[$code] = (float) $value;
        }
        if (\count($rates) < 20) continue;
        $date = $dateKey !== null && \is_string($body[$dateKey] ?? null) ? $body[$dateKey] : \gmdate('Y-m-d');
        return ['base' => 'EUR', 'date' => $date, 'rates' => $rates];
    }
    return null;
}

/**
 * Approximate conversion rates from the hotel currency, kept for a few hours so a page view does not
 * ask the platform every time. Display only: guests are always charged in the hotel currency.
 */
function ajax_get_currency_switcher_rates(): void
{
    // The caller's list only filters the answer. Rates are fetched and stored once for the whole fixed
    // set of supported currencies, so a caller cannot create cache entries or options.
    $supported = \array_keys(get_currency_switcher_currency_options());
    $requested = normalize_currency_switcher_list(\explode(',', (string) \wp_unslash($_GET['currencies'] ?? '')));
    $currencies = \array_values(\array_intersect($supported, $requested));
    if ($currencies === []) \wp_send_json_error(['message' => 'Invalid currencies.'], 400);
    $cacheKey = 'must_fx_rates';
    $payload = \get_transient($cacheKey);
    if (!\is_array($payload)) {
        $response = MustApiClient::get('/public/exchange-rates', ['currencies' => \implode(',', $supported)]);
        $data = $response['body'] ?? null;
        if ($response['ok'] && \is_array($data) && !empty($data['rates'])) {
            $payload = ['base' => (string) ($data['base'] ?? ''), 'date' => (string) ($data['date'] ?? ''), 'rates' => (array) $data['rates']];
            \set_transient($cacheKey, $payload, 3 * HOUR_IN_SECONDS);
            \update_option($cacheKey . '_last', $payload, false);
        } else {
            // Until the platform API serves rates, read the free daily euro feed directly. Prices on the
            // site are in euro, so euro-based rates are what the converter needs.
            $payload = fetch_currency_switcher_rates_directly();
            if (\is_array($payload)) {
                \set_transient($cacheKey, $payload, 3 * HOUR_IN_SECONDS);
                \update_option($cacheKey . '_last', $payload, false);
            } else {
                $payload = \get_option($cacheKey . '_last');
            }
        }
    }
    if (!\is_array($payload)) \wp_send_json_error(['message' => 'Rates are not available right now.'], 502);
    $payload['rates'] = \array_intersect_key((array) $payload['rates'], \array_flip($currencies));
    \wp_send_json_success($payload);
}

/** @param mixed $widgetsManager */
function register_elementor_currency_switcher_widget($widgetsManager): void
{
    static $registered = false;
    if ($registered || !\class_exists('\\Elementor\\Widget_Base') || !\is_object($widgetsManager)) return;
    $widget = new Currency_Switcher_Widget();
    if (\method_exists($widgetsManager, 'register')) { $widgetsManager->register($widget); $registered = true; }
    elseif (\method_exists($widgetsManager, 'register_widget_type')) { $widgetsManager->register_widget_type($widget); $registered = true; }
}

function register_elementor_currency_switcher_widget_legacy(): void
{
    $plugin = \class_exists('\\Elementor\\Plugin') ? \Elementor\Plugin::$instance : null;
    if (\is_object($plugin) && isset($plugin->widgets_manager)) register_elementor_currency_switcher_widget($plugin->widgets_manager);
}

\add_action('elementor/frontend/after_register_styles', __NAMESPACE__ . '\\register_elementor_currency_switcher_assets');
\add_action('elementor/frontend/after_register_scripts', __NAMESPACE__ . '\\register_elementor_currency_switcher_assets');
\add_action('elementor/widgets/register', __NAMESPACE__ . '\\register_elementor_currency_switcher_widget');
\add_action('elementor/widgets/widgets_registered', __NAMESPACE__ . '\\register_elementor_currency_switcher_widget_legacy');
\add_action('wp_ajax_must_hotel_booking_exchange_rates', __NAMESPACE__ . '\\ajax_get_currency_switcher_rates');
\add_action('wp_ajax_nopriv_must_hotel_booking_exchange_rates', __NAMESPACE__ . '\\ajax_get_currency_switcher_rates');
