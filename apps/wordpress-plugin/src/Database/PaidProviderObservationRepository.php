<?php

namespace MustHotelBooking\Database;

/** Durable evidence that a provider is paid while booking completion is blocked. */
final class PaidProviderObservationRepository extends AbstractRepository
{
    public function tablesExist(): bool
    {
        return $this->tableExists('paid_provider_observations') && $this->tableExists('paid_provider_observation_allocations');
    }

    /** @param array<string, mixed> $observation @param array<int, array<string, mixed>> $allocations */
    public function record(array $observation, array $allocations): array
    {
        if (!$this->tablesExist()) {
            return ['success' => false, 'reason_code' => 'paid_observation_schema_missing'];
        }
        $ownershipKey = (string) ($observation['ownership_key'] ?? '');
        if ($ownershipKey === '') {
            return ['success' => false, 'reason_code' => 'paid_observation_ownership_missing'];
        }
        if ($this->wpdb->query('START TRANSACTION') === false) {
            return ['success' => false, 'reason_code' => 'paid_observation_transaction_failed'];
        }
        try {
            $columns = \array_keys($observation);
            $formats = [];
            foreach ($columns as $column) {
                $formats[] = \in_array($column, ['amount_minor', 'observation_count'], true) ? '%d' : '%s';
            }
            $assignments = [
                'last_seen_at = VALUES(last_seen_at)',
                'observation_count = observation_count + 1',
                'failure_code = VALUES(failure_code)',
                "recovery_status = CASE
                    WHEN recovery_status = 'resolved' THEN recovery_status
                    WHEN recovery_status = 'partial_manual_review' THEN recovery_status
                    WHEN recovery_status = 'manual_review' AND VALUES(recovery_status) = 'processing_pending' THEN recovery_status
                    ELSE VALUES(recovery_status)
                END",
                "provider_mode = IF(provider_mode = '', VALUES(provider_mode), provider_mode)",
                "provider_account_fingerprint = IF(provider_account_fingerprint = '', VALUES(provider_account_fingerprint), provider_account_fingerprint)",
                "provider_attempt_reference = IF(provider_attempt_reference = '', VALUES(provider_attempt_reference), provider_attempt_reference)",
                "provider_event_reference = IF(provider_event_reference = '', VALUES(provider_event_reference), provider_event_reference)",
                "verification_source = IF(verification_source = '', VALUES(verification_source), verification_source)",
                "currency = IF(currency = '', VALUES(currency), currency)",
                'amount_minor = IF(amount_minor < 0, VALUES(amount_minor), amount_minor)',
                "expected_allocation_set_hash = IF(expected_allocation_set_hash = '', VALUES(expected_allocation_set_hash), expected_allocation_set_hash)",
                'rejected_context_hash = VALUES(rejected_context_hash)',
            ];
            $sql = 'INSERT INTO ' . $this->table('paid_provider_observations')
                . ' (' . \implode(', ', $columns) . ') VALUES (' . \implode(', ', $formats) . ')'
                . ' ON DUPLICATE KEY UPDATE ' . \implode(', ', $assignments);
            $values = [];
            foreach ($columns as $column) {
                $values[] = $observation[$column];
            }
            $upserted = $this->wpdb->query($this->wpdb->prepare($sql, $values));
            if ($upserted === false) {
                throw new \RuntimeException('paid_observation_upsert_failed');
            }
            $observationId = (int) $this->wpdb->get_var($this->wpdb->prepare(
                'SELECT id FROM ' . $this->table('paid_provider_observations') . ' WHERE ownership_key = %s LIMIT 1 FOR UPDATE',
                $ownershipKey
            ));
            if ($observationId <= 0) {
                throw new \RuntimeException('paid_observation_lookup_failed');
            }
            foreach ($allocations as $allocation) {
                $allocation['observation_id'] = $observationId;
                if ($this->wpdb->query($this->wpdb->prepare(
                    'INSERT IGNORE INTO ' . $this->table('paid_provider_observation_allocations') . '
                     (observation_id, reservation_id, allocation_role, amount_minor, currency, allocation_hash, created_at)
                     VALUES (%d, %d, %s, %d, %s, %s, %s)',
                    (int) $allocation['observation_id'],
                    (int) ($allocation['reservation_id'] ?? 0),
                    (string) ($allocation['allocation_role'] ?? 'expected'),
                    (int) ($allocation['amount_minor'] ?? -1),
                    (string) ($allocation['currency'] ?? ''),
                    (string) ($allocation['allocation_hash'] ?? ''),
                    (string) ($allocation['created_at'] ?? '')
                )) === false) {
                    throw new \RuntimeException('paid_observation_allocation_failed');
                }
            }
            if ($this->wpdb->query('COMMIT') === false) {
                throw new \RuntimeException('paid_observation_commit_failed');
            }
            return ['success' => true, 'observation_id' => $observationId, 'idempotent' => $upserted !== 1];
        } catch (\Throwable $error) {
            $this->wpdb->query('ROLLBACK');
            return ['success' => false, 'reason_code' => \sanitize_key($error->getMessage())];
        }
    }

    /** @return array<int, array<string, mixed>> */
    public function getForReservation(int $reservationId): array
    {
        if ($reservationId <= 0 || !$this->tablesExist()) {
            return [];
        }
        $rows = $this->wpdb->get_results($this->wpdb->prepare(
            'SELECT o.*, a.allocation_role, a.amount_minor AS allocation_amount_minor, a.currency AS allocation_currency
             FROM ' . $this->table('paid_provider_observation_allocations') . ' a
             INNER JOIN ' . $this->table('paid_provider_observations') . ' o ON o.id = a.observation_id
             WHERE a.reservation_id = %d ORDER BY o.last_seen_at DESC, o.id DESC',
            $reservationId
        ), ARRAY_A);
        return \is_array($rows) ? $rows : [];
    }

    /** @return array<string, int> */
    public function getStatusCounts(): array
    {
        if (!$this->tablesExist()) {
            return [];
        }
        $rows = $this->wpdb->get_results(
            'SELECT recovery_status, COUNT(*) AS total FROM ' . $this->table('paid_provider_observations') . ' GROUP BY recovery_status',
            ARRAY_A
        );
        $counts = [];
        foreach (\is_array($rows) ? $rows : [] as $row) {
            $counts[\sanitize_key((string) ($row['recovery_status'] ?? 'unknown'))] = (int) ($row['total'] ?? 0);
        }
        return $counts;
    }

    public function markResolved(string $provider, string $providerReference, string $providerMode, string $providerAccountFingerprint): bool
    {
        $provider = \sanitize_key($provider);
        $providerReference = \sanitize_text_field($providerReference);
        $providerMode = \sanitize_key($providerMode);
        $providerAccountFingerprint = \strtolower(\trim($providerAccountFingerprint));
        if ($provider === '' || $providerReference === '' || !$this->tablesExist()) {
            return false;
        }
        $ownershipKey = \hash('sha256', \implode('|', [$provider, $providerMode, $providerAccountFingerprint, $providerReference]));
        $updated = $this->wpdb->update(
            $this->table('paid_provider_observations'),
            ['recovery_status' => 'resolved', 'last_seen_at' => \current_time('mysql')],
            ['ownership_key' => $ownershipKey],
            ['%s', '%s'],
            ['%s']
        );
        return \is_int($updated);
    }
}
