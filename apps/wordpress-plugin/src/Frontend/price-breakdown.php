<?php

namespace MustHotelBooking\Frontend;

if (!\defined('ABSPATH')) {
    exit;
}

/**
 * @param array<string, mixed> $pricing
 * @return array<int, array{date: string, amount: float}>
 */
function get_price_breakdown_rows_from_pricing(array $pricing): array
{
    $rows = isset($pricing['nightly_rates']) && \is_array($pricing['nightly_rates'])
        ? $pricing['nightly_rates']
        : [];
    $normalized = [];

    foreach ($rows as $row) {
        if (!\is_array($row)) {
            continue;
        }

        $date = isset($row['date']) ? \sanitize_text_field((string) $row['date']) : '';
        $amount = null;

        foreach (['rate', 'price', 'amount', 'base_price'] as $amountKey) {
            if (isset($row[$amountKey]) && \is_numeric($row[$amountKey])) {
                $amount = (float) $row[$amountKey];
                break;
            }
        }

        if ($date === '' || $amount === null || $amount < 0) {
            continue;
        }

        $normalized[] = [
            'date' => $date,
            'amount' => \round($amount, 2),
        ];
    }

    return $normalized;
}

/**
 * @param array<string, mixed> $pricing
 * @return array<string, mixed>
 */
function build_price_breakdown_snapshot(array $pricing, string $currency = ''): array
{
    return [
        'nightly_rates' => get_price_breakdown_rows_from_pricing($pricing),
        'total_price' => isset($pricing['total_price']) ? \round((float) $pricing['total_price'], 2) : 0.0,
        'room_subtotal' => isset($pricing['room_subtotal']) ? \round((float) $pricing['room_subtotal'], 2) : 0.0,
        'fees_total' => isset($pricing['fees_total']) ? \round((float) $pricing['fees_total'], 2) : 0.0,
        'discount_total' => isset($pricing['discount_total']) ? \round((float) $pricing['discount_total'], 2) : 0.0,
        'taxes_total' => isset($pricing['taxes_total']) ? \round((float) $pricing['taxes_total'], 2) : 0.0,
        'currency' => $currency !== '' ? \sanitize_text_field($currency) : \sanitize_text_field((string) ($pricing['currency'] ?? '')),
    ];
}

/**
 * @param array<string, mixed> $metadata
 * @return array<int, array{date: string, amount: float}>
 */
function get_price_breakdown_rows_from_metadata(array $metadata): array
{
    $snapshot = isset($metadata['pricing_snapshot']) && \is_array($metadata['pricing_snapshot'])
        ? $metadata['pricing_snapshot']
        : [];

    return get_price_breakdown_rows_from_pricing($snapshot);
}

/**
 * @param array<string, mixed> $reservation
 * @return array<string, mixed>
 */
function get_reservation_provider_metadata(array $reservation): array
{
    $metadata = $reservation['provider_metadata'] ?? [];

    if (\is_array($metadata)) {
        return $metadata;
    }

    if (!\is_string($metadata) || \trim($metadata) === '') {
        return [];
    }

    $decoded = \json_decode($metadata, true);

    return \is_array($decoded) ? $decoded : [];
}

