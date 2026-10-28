<?php

namespace MustHotelBooking\Elementor;

use MustHotelBooking\Core\MustApiClient;

/** @return array<string, string> code => name */
function get_currency_switcher_currency_names(): array
{
    return [
        'EUR' => 'Euro', 'USD' => 'US Dollar', 'GBP' => 'British Pound', 'ALL' => 'Albanian Lek', 'CHF' => 'Swiss Franc',
        'CAD' => 'Canadian Dollar', 'AUD' => 'Australian Dollar', 'SEK' => 'Swedish Krona', 'NOK' => 'Norwegian Krone',
        'DKK' => 'Danish Krone', 'PLN' => 'Polish Zloty', 'CZK' => 'Czech Koruna', 'HUF' => 'Hungarian Forint',
        'RON' => 'Romanian Leu', 'BGN' => 'Bulgarian Lev', 'TRY' => 'Turkish Lira', 'MKD' => 'Macedonian Denar',
        'RSD' => 'Serbian Dinar', 'BAM' => 'Bosnian Mark', 'ILS' => 'Israeli Shekel', 'AED' => 'UAE Dirham',
        'JPY' => 'Japanese Yen', 'CNY' => 'Chinese Yuan', 'INR' => 'Indian Rupee', 'BRL' => 'Brazilian Real',
    ];
}

/** @return array<string, string> code => label */
function get_currency_switcher_currency_options(): array
{
    $names = get_currency_switcher_currency_names();
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
    \wp_localize_script('must-hotel-booking-currency-switcher', 'mustCurrencyConfig', ['ajaxUrl' => \admin_url('admin-ajax.php'), 'currencyNames' => get_currency_switcher_currency_names()]);
}

/**
 * The platform is the only rate authority. Revalidate every ten minutes; an outage uses the last good
 * scoped payload and never asks an internet feed. The payload's base is the hotel's money currency.
 */
function ajax_get_currency_switcher_rates(): void
{
    $supported = \array_keys(get_currency_switcher_currency_options());
    $requested = normalize_currency_switcher_list(\explode(',', (string) \wp_unslash($_GET['currencies'] ?? '')));
    $currencies = \array_values(\array_intersect($supported, $requested));
    if ($currencies === []) \wp_send_json_error(['message' => 'Invalid currencies.'], 400);
    $scope = MustApiClient::basePath();
    $cacheKey = 'must_fx_rates_' . \md5($scope);
    $payload = \get_transient($cacheKey);
    if (!\is_array($payload)) {
        $last = \get_option('must_fx_rates_last');
        if (!\is_array($last) || ($last['_scope'] ?? '') !== $scope) $last = null;
        $headers = \is_array($last) && !empty($last['_etag']) ? ['If-None-Match' => (string) $last['_etag']] : [];
        $response = MustApiClient::get('/public/exchange-rates', ['currencies' => \implode(',', $supported)], $headers);
        $data = $response['body'] ?? null;
        if (($response['status'] ?? 0) === 304 && \is_array($last)) {
            $payload = $last;
        } elseif (!empty($response['ok']) && \is_array($data) && \preg_match('/^[A-Z]{3}$/', (string) ($data['base'] ?? '')) === 1 && !empty($data['rates']) && \is_array($data['rates'])) {
            $payload = $data;
            $payload['_etag'] = (string) ($response['etag'] ?? '');
            $payload['_scope'] = $scope;
            \update_option('must_fx_rates_last', $payload, false);
        } else {
            $payload = $last;
        }
        if (\is_array($payload)) \set_transient($cacheKey, $payload, 10 * MINUTE_IN_SECONDS);
    }
    if (!\is_array($payload)) \wp_send_json_error(['message' => 'Rates are not available right now.'], 502);
    $allowed = isset($payload['displayCurrencies']) && \is_array($payload['displayCurrencies'])
        ? \array_merge([(string) $payload['base']], $payload['displayCurrencies']) : $currencies;
    $payload['rates'] = \array_intersect_key((array) $payload['rates'], \array_flip($allowed));
    if (isset($payload['sources'])) $payload['sources'] = \array_intersect_key((array) $payload['sources'], \array_flip($allowed));
    unset($payload['_etag'], $payload['_scope']);
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
