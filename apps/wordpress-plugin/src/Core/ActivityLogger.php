<?php

namespace MustHotelBooking\Core;

final class ActivityLogger
{
    public static function registerHooks(): void
    {
        \add_action('must_hotel_booking/reservation_created', [self::class, 'handleReservationCreated'], 10, 1);
        \add_action('must_hotel_booking/reservation_confirmed', [self::class, 'handleReservationConfirmed'], 10, 1);
        \add_action('must_hotel_booking/reservation_cancelled', [self::class, 'handleReservationCancelled'], 10, 1);
        \add_action('must_hotel_booking/payment_recorded', [self::class, 'handlePaymentRecorded'], 10, 1);
        \add_action('must_hotel_booking/email_dispatch_result', [self::class, 'handleEmailDispatchResult'], 10, 1);
    }

    public static function handleReservationCreated(int $reservationId): void
    {
        self::logReservationActivity($reservationId, 'reservation_created', 'info', 'created');
    }

    public static function handleReservationConfirmed(int $reservationId): void
    {
        self::logReservationActivity($reservationId, 'reservation_confirmed', 'info', 'confirmed');
    }

    public static function handleReservationCancelled(int $reservationId): void
    {
        self::logReservationActivity($reservationId, 'reservation_cancelled', 'warning', 'cancelled');
    }

    /**
     * @param array<string, mixed> $payment
     */
    public static function handlePaymentRecorded(array $payment): void
    {
        $reservationId = isset($payment['reservation_id']) ? (int) $payment['reservation_id'] : 0;
        $reservation = $reservationId > 0
            ? \MustHotelBooking\Engine\get_reservation_repository()->getReservation($reservationId)
            : null;
        $reference = self::resolveReservationReference($reservationId, $reservation);
        $status = isset($payment['status']) ? \sanitize_key((string) $payment['status']) : 'pending';
        $method = isset($payment['method']) ? \sanitize_key((string) $payment['method']) : '';
        $amount = isset($payment['amount']) ? (float) $payment['amount'] : 0.0;
        $message = self::buildPaymentMessage($status, $method, $reference, $amount);

        self::persistActivity(
            \array_merge(
                self::buildActorContext(),
                [
                    'event_type'   => $status === 'failed' ? 'payment_failed' : 'payment_recorded',
                    'severity'     => self::resolvePaymentSeverity($status),
                    'entity_type'  => 'payment',
                    'entity_id'    => isset($payment['payment_id']) ? (int) $payment['payment_id'] : 0,
                    'reference'    => $reference,
                    'message'      => $message,
                    'context_json' => self::encodeContext(
                        [
                            'reservation_id' => $reservationId,
                            'payment_id'     => isset($payment['payment_id']) ? (int) $payment['payment_id'] : 0,
                            'method'         => $method,
                            'status'         => $status,
                            'amount'         => $amount,
                            'transaction_id' => isset($payment['transaction_id']) ? (string) $payment['transaction_id'] : '',
                        ]
                    ),
                ]
            )
        );
    }

    /**
     * @param array<string, mixed> $emailEvent
     */
    public static function handleEmailDispatchResult(array $emailEvent): void
    {
        $success = !empty($emailEvent['success']);
        $reservationId = isset($emailEvent['reservation_id']) ? (int) $emailEvent['reservation_id'] : 0;
        $reference = isset($emailEvent['booking_id']) ? \trim((string) $emailEvent['booking_id']) : '';

        if ($reference === '') {
            $reference = self::resolveReservationReference($reservationId);
        }

        $templateKey = isset($emailEvent['template_key']) ? \sanitize_key((string) $emailEvent['template_key']) : '';
        $recipientEmail = isset($emailEvent['recipient_email']) ? \sanitize_email((string) $emailEvent['recipient_email']) : '';
        $emailMode = isset($emailEvent['email_mode']) ? \sanitize_key((string) $emailEvent['email_mode']) : 'automated';
        $templateLabel = $templateKey !== '' ? $templateKey : \__('email notification', 'must-hotel-booking');
        $message = $success
            ? \sprintf(
                /* translators: 1: template key, 2: booking reference. */
                \__('Email %1$s sent for %2$s.', 'must-hotel-booking'),
                $templateLabel,
                $reference
            )
            : \sprintf(
                /* translators: 1: template key, 2: booking reference. */
                \__('Email %1$s failed for %2$s.', 'must-hotel-booking'),
                $templateLabel,
                $reference
            );

        self::persistActivity(
            \array_merge(
                self::buildActorContext(),
                [
                    'event_type'   => $success ? 'email_sent' : 'email_failed',
                    'severity'     => $success ? 'info' : 'error',
                    'entity_type'  => 'reservation',
                    'entity_id'    => $reservationId,
                    'reference'    => $reference,
                    'message'      => $message,
                    'context_json' => self::encodeContext(
                        [
                            'reservation_id'  => $reservationId,
                            'template_key'    => $templateKey,
                            'recipient_email' => $recipientEmail,
                            'email_mode'      => $emailMode,
                        ]
                    ),
                ]
            )
        );
    }

    private static function logReservationActivity(int $reservationId, string $eventType, string $severity, string $verb): void
    {
        if ($reservationId <= 0) {
            return;
        }

        $reservation = \MustHotelBooking\Engine\get_reservation_repository()->getReservation($reservationId);
        $reference = self::resolveReservationReference($reservationId, $reservation);

        self::persistActivity(
            \array_merge(
                self::buildActorContext(),
                [
                    'event_type'   => $eventType,
                    'severity'     => $severity,
                    'entity_type'  => 'reservation',
                    'entity_id'    => $reservationId,
                    'reference'    => $reference,
                    'message'      => \sprintf(
                        /* translators: 1: booking reference, 2: action verb. */
                        \__('Reservation %1$s %2$s.', 'must-hotel-booking'),
                        $reference,
                        $verb
                    ),
                    'context_json' => self::encodeContext(
                        [
                            'reservation_id' => $reservationId,
                            'booking_id'     => isset($reservation['booking_id']) ? (string) $reservation['booking_id'] : '',
                        ]
                    ),
                ]
            )
        );
    }

    /**
     * Builds actor attribution fields for the current request.
     *
     * @return array<string, mixed>
     */
    private static function buildActorContext(): array
    {
        $userId = \get_current_user_id();
        $role   = '';

        if ($userId > 0) {
            $user = \wp_get_current_user();

            if ($user instanceof \WP_User && !empty($user->roles)) {
                $role = (string) \reset($user->roles);
            }
        }

        $ip = '';

        if (isset($_SERVER['REMOTE_ADDR'])) {
            $ip = \sanitize_text_field(\wp_unslash((string) $_SERVER['REMOTE_ADDR']));
        }

        return [
            'actor_user_id' => $userId,
            'actor_role'    => $role,
            'actor_ip'      => $ip,
        ];
    }

    /**
     * @param array<string, mixed>|null $reservation
     */
    private static function resolveReservationReference(int $reservationId, ?array $reservation = null): string
    {
        if (\is_array($reservation)) {
            $bookingId = isset($reservation['booking_id']) ? \trim((string) $reservation['booking_id']) : '';

            if ($bookingId !== '') {
                return $bookingId;
            }
        }

        if ($reservationId > 0) {
            return 'RES-' . $reservationId;
        }

        return \__('Reservation', 'must-hotel-booking');
    }

    private static function resolvePaymentSeverity(string $status): string
    {
        if ($status === 'failed') {
            return 'error';
        }

        if ($status === 'refunded') {
            return 'warning';
        }

        if ($status === 'pending') {
            return 'warning';
        }

        return 'info';
    }

    private static function buildPaymentMessage(string $status, string $method, string $reference, float $amount): string
    {
        $methodLabel = self::formatPaymentMethodLabel($method);
        $amountLabel = \number_format_i18n($amount, 2);

        if ($status === 'paid') {
            return \sprintf(
                /* translators: 1: payment method label, 2: booking reference, 3: amount. */
                \__('%1$s payment received for %2$s (%3$s).', 'must-hotel-booking'),
                $methodLabel,
                $reference,
                $amountLabel
            );
        }

        if ($status === 'failed') {
            return \sprintf(
                /* translators: 1: payment method label, 2: booking reference. */
                \__('%1$s payment failed for %2$s.', 'must-hotel-booking'),
                $methodLabel,
                $reference
            );
        }

        if ($status === 'refunded') {
            return \sprintf(
                /* translators: 1: payment method label, 2: booking reference, 3: amount. */
                \__('%1$s refund issued for %2$s (%3$s).', 'must-hotel-booking'),
                $methodLabel,
                $reference,
                $amountLabel
            );
        }

        return \sprintf(
            /* translators: 1: payment method label, 2: booking reference. */
            \__('%1$s payment recorded for %2$s.', 'must-hotel-booking'),
            $methodLabel,
            $reference
        );
    }

    private static function formatPaymentMethodLabel(string $method): string
    {
        if ($method === 'stripe') {
            return \__('Stripe', 'must-hotel-booking');
        }

        if ($method === 'pay_at_hotel') {
            return \__('Pay at hotel', 'must-hotel-booking');
        }

        return $method !== '' ? $method : \__('Payment', 'must-hotel-booking');
    }

    /**
     * @param array<string, mixed> $context
     */
    private static function encodeContext(array $context): string
    {
        $encoded = \wp_json_encode($context);

        return \is_string($encoded) ? $encoded : '';
    }

    /**
     * @param array<string, mixed> $activity
     */
    private static function persistActivity(array $activity): void
    {
        \MustHotelBooking\Engine\get_activity_repository()->createActivity($activity);
    }
}
