<?php

namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\MustBookingConfig;

/**
 * Get the frontend currency symbol for a currency code.
 */
function get_frontend_currency_symbol(string $currency = ''): string
{
    $normalized_currency = \strtoupper(\trim($currency));

    if ($normalized_currency === '' && \class_exists(MustBookingConfig::class)) {
        $normalized_currency = MustBookingConfig::get_currency();
    }

    $symbols = [
        'AED' => 'AED',
        'ALL' => 'Lek',
        'AUD' => '$',
        'BGN' => 'lv',
        'CAD' => '$',
        'CHF' => 'CHF',
        'CNY' => 'Yuan',
        'CZK' => 'Kc',
        'DKK' => 'kr',
        'EUR' => \html_entity_decode('&euro;', \ENT_QUOTES, 'UTF-8'),
        'GBP' => \html_entity_decode('&pound;', \ENT_QUOTES, 'UTF-8'),
        'HKD' => '$',
        'HUF' => 'Ft',
        'JPY' => 'Yen',
        'MKD' => 'den',
        'NOK' => 'kr',
        'NZD' => '$',
        'PLN' => 'zl',
        'RON' => 'lei',
        'RSD' => 'din',
        'SAR' => 'SAR',
        'SEK' => 'kr',
        'SGD' => '$',
        'TRY' => 'TL',
        'USD' => '$',
    ];

    return $symbols[$normalized_currency] ?? $normalized_currency;
}

/**
 * Format frontend money in amount-first style.
 */
function format_frontend_money(float $amount, string $currency = ''): string
{
    $symbol = get_frontend_currency_symbol($currency);

    return \trim(\number_format_i18n($amount, 2) . ' ' . $symbol);
}
