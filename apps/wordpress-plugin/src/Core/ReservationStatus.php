<?php

namespace MustHotelBooking\Core;

/**
 * Minimal status-vocabulary helper for the confirmation template, which checks
 * whether a booking's status (as returned by the MUST API) counts as confirmed.
 * Deliberately narrow: no domain logic, just a status-name comparison.
 */
final class ReservationStatus
{
    public static function isConfirmed(string $status): bool
    {
        return \strtoupper($status) === 'CONFIRMED';
    }
}
