<?php

if (!\function_exists('must_hotel_booking_asset_url')) {
    function must_hotel_booking_asset_url(string $relativePath): string
    {
        return MUST_HOTEL_BOOKING_URL . \ltrim($relativePath, '/') . '?ver=' . MUST_HOTEL_BOOKING_VERSION;
    }
}
