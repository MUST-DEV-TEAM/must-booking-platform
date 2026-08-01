<?php

namespace MustHotelBooking\Database;

final class RefundRepository extends AbstractRepository
{
    public function refundsTableExists(): bool
    {
        return $this->tableExists('refunds');
    }

    private function refundColumnExists(string $column): bool
    {
        if ($column === '' || !$this->refundsTableExists() || !\preg_match('/^[A-Za-z0-9_]+$/', $column)) {
            return false;
        }

        $found = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SHOW COLUMNS FROM ' . $this->table('refunds') . ' LIKE %s',
                $column
            )
        );

        return (string) $found === $column;
    }

    /** @param array<string, mixed> $data */
    public function createRefund(array $data): int
    {
        $data = $this->filterExistingRefundColumns($data);
        $inserted = $this->wpdb->insert(
            $this->table('refunds'),
            $data,
            $this->formats($data)
        );

        return $inserted === false ? 0 : (int) $this->wpdb->insert_id;
    }

    /**
     * Atomically claim one provider refund operation for a reservation/reference
     * tuple. MySQL advisory locks are used because older installations may
     * contain duplicate/blank legacy idempotency values, so adding a unique
     * index during upgrade would not be safe by itself.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function claimProviderRefund(
        array $data,
        int $reservationId,
        string $gateway,
        string $providerPaymentReference,
        float $amount,
        int $preferredRefundId = 0
    ): array {
        $gateway = \sanitize_key($gateway);
        $providerPaymentReference = \trim($providerPaymentReference);
        $amount = \round($amount, 2);
        $idempotencyKey = \trim((string) ($data['idempotency_key'] ?? ''));

        if (
            $reservationId <= 0
            || $gateway === ''
            || $providerPaymentReference === ''
            || $amount <= 0.0
            || $idempotencyKey === ''
            || !$this->refundsTableExists()
        ) {
            return [
                'success' => false,
                'action' => 'invalid',
                'refund_id' => 0,
                'message' => 'Invalid refund claim data.',
            ];
        }

        $lockName = 'mhb_refund_claim_' . \substr(
            \hash('sha256', $reservationId . '|' . $gateway . '|' . $providerPaymentReference . '|' . \number_format($amount, 2, '.', '')),
            0,
            48
        );
        $lockAcquired = (int) $this->wpdb->get_var(
            $this->wpdb->prepare('SELECT GET_LOCK(%s, %d)', $lockName, 5)
        ) === 1;

        if (!$lockAcquired) {
            return [
                'success' => false,
                'action' => 'lock_failed',
                'refund_id' => 0,
                'message' => 'Unable to claim the refund operation lock.',
            ];
        }

        try {
            $blockingRefund = $this->findBlockingProviderRefund($reservationId, $gateway, $providerPaymentReference, $amount);
            if (
                \is_array($blockingRefund)
                && (int) ($blockingRefund['id'] ?? 0) !== $preferredRefundId
            ) {
                return [
                    'success' => true,
                    'action' => 'blocked',
                    'refund_id' => (int) ($blockingRefund['id'] ?? 0),
                    'status' => (string) ($blockingRefund['status'] ?? ''),
                ];
            }

            $candidate = null;
            if ($preferredRefundId > 0) {
                $candidate = $this->getRefund($preferredRefundId);
            }
            if (!\is_array($candidate)) {
                $candidate = $this->findRetryableProviderRefund($reservationId, $gateway, $providerPaymentReference, $amount);
            }
            if (!\is_array($candidate)) {
                $candidate = $this->findByIdempotencyKey($idempotencyKey);
            }

            if (\is_array($candidate)) {
                $candidateId = (int) ($candidate['id'] ?? 0);
                if (!$this->matchesProviderRefundTuple($candidate, $reservationId, $gateway, $providerPaymentReference, $amount)) {
                    return [
                        'success' => false,
                        'action' => 'claim_conflict',
                        'refund_id' => 0,
                        'message' => 'Refund claim data conflicts with the existing refund record.',
                    ];
                }

                $candidateStatus = \sanitize_key((string) ($candidate['status'] ?? ''));
                if (
                    $candidateId <= 0
                    || \in_array($candidateStatus, ['pending', 'processing', 'succeeded', 'completed', 'manual_pending', 'manual_completed'], true)
                ) {
                    return [
                        'success' => true,
                        'action' => 'blocked',
                        'refund_id' => $candidateId,
                        'status' => $candidateStatus,
                    ];
                }

                $updateData = $data;
                unset($updateData['created_at']);
                if (!$this->updateRefund($candidateId, $updateData)) {
                    return [
                        'success' => false,
                        'action' => 'update_failed',
                        'refund_id' => $candidateId,
                        'message' => 'Unable to claim the existing refund record.',
                    ];
                }

                return [
                    'success' => true,
                    'action' => 'claimed',
                    'refund_id' => $candidateId,
                    'status' => (string) ($data['status'] ?? ''),
                ];
            }

            $refundId = $this->createRefund($data);
            if ($refundId > 0) {
                return [
                    'success' => true,
                    'action' => 'created',
                    'refund_id' => $refundId,
                    'status' => (string) ($data['status'] ?? ''),
                ];
            }

            // A concurrent process may have inserted the same deterministic key
            // between the SELECT and INSERT. Re-read it before reporting failure.
            $existing = $this->findByIdempotencyKey($idempotencyKey);
            if (\is_array($existing)) {
                return [
                    'success' => true,
                    'action' => 'blocked',
                    'refund_id' => (int) ($existing['id'] ?? 0),
                    'status' => (string) ($existing['status'] ?? ''),
                ];
            }

            return [
                'success' => false,
                'action' => 'create_failed',
                'refund_id' => 0,
                'message' => 'Unable to create the refund record.',
            ];
        } finally {
            $this->wpdb->query(
                $this->wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lockName)
            );
        }
    }

    /** @param array<string, mixed> $data */
    public function updateRefund(int $refundId, array $data): bool
    {
        if ($refundId <= 0 || empty($data)) {
            return false;
        }

        $data = $this->filterExistingRefundColumns($data);

        if (empty($data)) {
            return false;
        }

        $updated = $this->wpdb->update(
            $this->table('refunds'),
            $data,
            ['id' => $refundId],
            $this->formats($data),
            ['%d']
        );

        return \is_int($updated);
    }

    /** @return array<string, mixed>|null */
    public function getRefund(int $refundId): ?array
    {
        if ($refundId <= 0 || !$this->refundsTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . ' WHERE id = %d',
                $refundId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /** @return array<string, mixed>|null */
    public function findByStripeRefundId(string $stripeRefundId): ?array
    {
        $stripeRefundId = \trim($stripeRefundId);

        if ($stripeRefundId === '' || !$this->refundsTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . ' WHERE stripe_refund_id = %s ORDER BY id DESC LIMIT 1',
                $stripeRefundId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /** @return array<string, mixed>|null */
    public function findOpenByPaymentReference(string $paymentIntentId, string $chargeId = ''): ?array
    {
        $paymentIntentId = \trim($paymentIntentId);
        $chargeId = \trim($chargeId);

        if (!$this->refundsTableExists() || ($paymentIntentId === '' && $chargeId === '')) {
            return null;
        }

        if ($paymentIntentId !== '' && $chargeId !== '') {
            $row = $this->wpdb->get_row(
                $this->wpdb->prepare(
                    'SELECT * FROM ' . $this->table('refunds') . '
                    WHERE stripe_refund_id = \'\'
                        AND (stripe_payment_intent_id = %s OR stripe_charge_id = %s)
                    ORDER BY id DESC
                    LIMIT 1',
                    $paymentIntentId,
                    $chargeId
                ),
                ARRAY_A
            );

            return \is_array($row) ? $row : null;
        }

        $column = $paymentIntentId !== '' ? 'stripe_payment_intent_id' : 'stripe_charge_id';
        $value = $paymentIntentId !== '' ? $paymentIntentId : $chargeId;
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . '
                WHERE stripe_refund_id = \'\'
                    AND ' . $column . ' = %s
                ORDER BY id DESC
                LIMIT 1',
                $value
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /** @return array<string, mixed>|null */
    public function findOpenManualByProviderReference(int $reservationId, string $gateway, string $providerPaymentReference): ?array
    {
        $gateway = \sanitize_key($gateway);
        $providerPaymentReference = \trim($providerPaymentReference);

        if ($reservationId <= 0 || $gateway === '' || $providerPaymentReference === '' || !$this->refundsTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . '
                WHERE reservation_id = %d
                    AND gateway = %s
                    AND provider_payment_reference = %s
                    AND status IN (\'manual_pending\', \'pending\', \'processing\')
                ORDER BY id DESC
                LIMIT 1',
                $reservationId,
                $gateway,
                $providerPaymentReference
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /** @return array<string, mixed>|null */
    public function findBlockingProviderRefund(int $reservationId, string $gateway, string $providerPaymentReference, float $amount): ?array
    {
        $gateway = \sanitize_key($gateway);
        $providerPaymentReference = \trim($providerPaymentReference);
        $amount = \round($amount, 2);

        if ($reservationId <= 0 || $gateway === '' || $providerPaymentReference === '' || $amount <= 0.0 || !$this->refundsTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . '
                WHERE reservation_id = %d
                    AND gateway = %s
                    AND provider_payment_reference = %s
                    AND ABS(amount - %f) < 0.01
                    AND status IN (\'pending\', \'processing\', \'succeeded\', \'completed\', \'manual_pending\', \'manual_completed\')
                ORDER BY id DESC
                LIMIT 1',
                $reservationId,
                $gateway,
                $providerPaymentReference,
                $amount
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /** @return array<string, mixed>|null */
    public function findRetryableProviderRefund(int $reservationId, string $gateway, string $providerPaymentReference, float $amount): ?array
    {
        $gateway = \sanitize_key($gateway);
        $providerPaymentReference = \trim($providerPaymentReference);
        $amount = \round($amount, 2);

        if ($reservationId <= 0 || $gateway === '' || $providerPaymentReference === '' || $amount <= 0.0 || !$this->refundsTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . '
                WHERE reservation_id = %d
                    AND gateway = %s
                    AND provider_payment_reference = %s
                    AND ABS(amount - %f) < 0.01
                    AND status = %s
                    AND provider_refund_id = \'\'
                    AND provider_refund_reference = \'\'
                ORDER BY id DESC
                LIMIT 1',
                $reservationId,
                $gateway,
                $providerPaymentReference,
                $amount,
                'failed'
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /** @return array<string, mixed>|null */
    private function findByIdempotencyKey(string $idempotencyKey): ?array
    {
        if ($idempotencyKey === '' || !$this->refundsTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . ' WHERE idempotency_key = %s ORDER BY id DESC LIMIT 1',
                $idempotencyKey
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    private function matchesProviderRefundTuple(array $row, int $reservationId, string $gateway, string $reference, float $amount): bool
    {
        return (int) ($row['reservation_id'] ?? 0) === $reservationId
            && \sanitize_key((string) ($row['gateway'] ?? '')) === $gateway
            && \trim((string) ($row['provider_payment_reference'] ?? '')) === $reference
            && \abs((float) ($row['amount'] ?? 0.0) - $amount) < 0.01;
    }

    /** @return array<string, mixed>|null */
    public function findCancellationReview(int $reservationId, string $gateway, string $providerPaymentReference): ?array
    {
        $gateway = \sanitize_key($gateway);
        $providerPaymentReference = \trim($providerPaymentReference);

        if ($reservationId <= 0 || $gateway === '' || !$this->refundsTableExists()) {
            return null;
        }

        $sql = 'SELECT * FROM ' . $this->table('refunds') . '
            WHERE reservation_id = %d
                AND gateway = %s
                AND refund_type = %s
                AND status = %s';
        $params = [
            $reservationId,
            $gateway,
            'clock_cancellation_review',
            'refund_review_required',
        ];

        if ($providerPaymentReference !== '') {
            $sql .= ' AND provider_payment_reference = %s';
            $params[] = $providerPaymentReference;
        }

        $sql .= ' ORDER BY id DESC LIMIT 1';
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare($sql, ...$params),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /** @return array<int, array<string, mixed>> */
    public function getRefundsForReservation(int $reservationId): array
    {
        if ($reservationId <= 0 || !$this->refundsTableExists()) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . '
                WHERE reservation_id = %d
                ORDER BY created_at DESC, id DESC',
                $reservationId
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /** @return array<int, array<string, mixed>> */
    public function getRetryableClockSyncRefunds(int $limit = 20): array
    {
        if (!$this->refundsTableExists()) {
            return [];
        }

        $limit = \max(1, \min(100, $limit));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('refunds') . '
                WHERE status IN (\'succeeded\', \'processing\')
                    AND clock_refund_item_id = \'\'
                    AND clock_sync_status IN (\'pending\', \'failed\', \'retrying\')
                ORDER BY updated_at ASC, id ASC
                LIMIT %d',
                $limit
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /** @param array<string, mixed> $data @return array<int, string> */
    private function formats(array $data): array
    {
        $formats = [];

        foreach ($data as $key => $value) {
            if (\in_array($key, ['id', 'reservation_id', 'payment_id', 'requested_by_user_id'], true)) {
                $formats[] = '%d';
                continue;
            }

            if (\in_array($key, ['amount', 'original_paid_amount', 'provider_fee_retained', 'cancellation_fee_amount', 'final_refund_amount'], true)) {
                $formats[] = '%f';
                continue;
            }

            $formats[] = '%s';
        }

        return $formats;
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private function filterExistingRefundColumns(array $data): array
    {
        $knownBase = [
            'id' => true,
            'reservation_id' => true,
            'booking_id' => true,
            'payment_id' => true,
            'provider' => true,
            'clock_booking_id' => true,
            'clock_reservation_id' => true,
            'clock_folio_id' => true,
            'clock_refund_item_id' => true,
            'gateway' => true,
            'provider_payment_reference' => true,
            'provider_refund_id' => true,
            'provider_refund_reference' => true,
            'raw_provider_status' => true,
            'stripe_payment_intent_id' => true,
            'stripe_charge_id' => true,
            'stripe_refund_id' => true,
            'amount' => true,
            'currency' => true,
            'reason' => true,
            'refund_type' => true,
            'status' => true,
            'clock_sync_status' => true,
            'requested_by_user_id' => true,
            'idempotency_key' => true,
            'clock_idempotency_key' => true,
            'failed_reason' => true,
            'manual_note' => true,
            'metadata' => true,
            'created_at' => true,
            'updated_at' => true,
            'completed_at' => true,
            'manual_completed_at' => true,
        ];
        $filtered = [];

        foreach ($data as $key => $value) {
            if (isset($knownBase[$key]) || $this->refundColumnExists((string) $key)) {
                $filtered[$key] = $value;
            }
        }

        return $filtered;
    }
}
