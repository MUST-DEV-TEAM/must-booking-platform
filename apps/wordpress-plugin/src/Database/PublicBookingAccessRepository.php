<?php

namespace MustHotelBooking\Database;

final class PublicBookingAccessRepository extends AbstractRepository
{
    private function accessTable(): string
    {
        return $this->table('public_booking_access');
    }

    private function contextTable(): string
    {
        return $this->table('public_booking_access_contexts');
    }

    public function publicAccessTableExists(): bool
    {
        return parent::tableExists('public_booking_access');
    }

    public function contextTableExists(): bool
    {
        return parent::tableExists('public_booking_access_contexts');
    }

    /** @param array<string, mixed> $grant */
    public function insertGrant(array $grant): int
    {
        if (!$this->publicAccessTableExists()) {
            return 0;
        }

        $data = $this->grantData($grant);
        if ((string) ($grant['operation_key'] ?? '') !== '') {
            return $this->insertCancellationOperationGrant($data, $grant);
        }

        $inserted = $this->wpdb->insert($this->accessTable(), $data, $this->grantFormats());
        return $inserted === false ? 0 : (int) $this->wpdb->insert_id;
    }

    /** @param array<string, mixed> $grant @return array<string, mixed> */
    private function grantData(array $grant): array
    {
        return [
            'token_hash' => (string) ($grant['token_hash'] ?? ''),
            'purpose' => (string) ($grant['purpose'] ?? ''),
            'reservation_ids' => (string) ($grant['reservation_ids'] ?? '[]'),
            'reservation_set_hash' => (string) ($grant['reservation_set_hash'] ?? ''),
            'created_at' => (string) ($grant['created_at'] ?? ''),
            'expires_at' => (string) ($grant['expires_at'] ?? ''),
            'revoked_at' => $grant['revoked_at'] ?? null,
            'first_used_at' => $grant['first_used_at'] ?? null,
            'last_used_at' => $grant['last_used_at'] ?? null,
            'execution_status' => (string) ($grant['execution_status'] ?? 'available'),
            'consumed_at' => $grant['consumed_at'] ?? null,
            'claimed_at' => $grant['claimed_at'] ?? null,
            'completed_at' => $grant['completed_at'] ?? null,
            'failed_at' => $grant['failed_at'] ?? null,
            'metadata_json' => (string) ($grant['metadata_json'] ?? '{}'),
            'operation_key' => $grant['operation_key'] ?? null,
        ];
    }

    /** @return array<int, string> */
    private function grantFormats(): array
    {
        return [
            '%s', '%s', '%s', '%s', '%s', '%s',
            '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s',
        ];
    }

    /** @param array<string, mixed> $data @param array<string, mixed> $grant */
    private function insertCancellationOperationGrant(array $data, array $grant): int
    {
        $operationKey = trim((string) ($grant['operation_key'] ?? ''));
        if ($operationKey === '') {
            return 0;
        }

        if ($this->wpdb->query('START TRANSACTION') === false) {
            return 0;
        }

        try {
            $existing = $this->wpdb->get_row(
                $this->wpdb->prepare(
                    'SELECT id, execution_status, consumed_at, claimed_at, revoked_at, expires_at
                    FROM ' . $this->accessTable() . '
                    WHERE operation_key = %s
                    LIMIT 1
                    FOR UPDATE',
                    $operationKey
                ),
                ARRAY_A
            );

            if (is_array($existing)) {
                $status = (string) ($existing['execution_status'] ?? '');
                $hasStarted = $status !== 'available'
                    || trim((string) ($existing['consumed_at'] ?? '')) !== ''
                    || trim((string) ($existing['claimed_at'] ?? '')) !== ''
                    || in_array($status, ['claimed', 'completed', 'failed_manual_review'], true);
                $isAvailable = $status === 'available'
                    && trim((string) ($existing['revoked_at'] ?? '')) === ''
                    && (string) ($existing['expires_at'] ?? '') > (string) ($grant['created_at'] ?? '');
                if ($hasStarted || $isAvailable) {
                    $this->wpdb->query('ROLLBACK');
                    return 0;
                }

                $updated = $this->wpdb->update(
                    $this->accessTable(),
                    $data,
                    ['id' => (int) ($existing['id'] ?? 0)],
                    $this->grantFormats(),
                    ['%d']
                );
                if ($updated === false) {
                    $this->wpdb->query('ROLLBACK');
                    return 0;
                }
                $this->wpdb->query('COMMIT');
                return (int) ($existing['id'] ?? 0);
            }

            $inserted = $this->wpdb->insert($this->accessTable(), $data, $this->grantFormats());
            if ($inserted === false) {
                $this->wpdb->query('ROLLBACK');
                return 0;
            }
            $grantId = (int) $this->wpdb->insert_id;
            $this->wpdb->query('COMMIT');
            return $grantId;
        } catch (\Throwable $exception) {
            $this->wpdb->query('ROLLBACK');
            return 0;
        }
    }

    /** @return array<string, mixed>|null */
    public function findByTokenHash(string $tokenHash): ?array
    {
        if ($tokenHash === '' || !$this->publicAccessTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, token_hash, purpose, reservation_ids, reservation_set_hash,
                    created_at, expires_at, revoked_at, first_used_at, last_used_at,
                    execution_status, consumed_at, claimed_at, completed_at, failed_at, metadata_json
                FROM ' . $this->accessTable() . '
                WHERE token_hash = %s
                LIMIT 1',
                $tokenHash
            ),
            ARRAY_A
        );

        return is_array($row) ? $row : null;
    }

    /** @param array<string, mixed> $context */
    public function createAccessContext(array $context): int
    {
        if (!$this->contextTableExists()) {
            return 0;
        }

        $inserted = $this->wpdb->insert(
            $this->contextTable(),
            [
                'context_hash' => (string) ($context['context_hash'] ?? ''),
                'grant_id' => (int) ($context['grant_id'] ?? 0),
                'purpose' => (string) ($context['purpose'] ?? ''),
                'reservation_set_hash' => (string) ($context['reservation_set_hash'] ?? ''),
                'created_at' => (string) ($context['created_at'] ?? ''),
                'expires_at' => (string) ($context['expires_at'] ?? ''),
                'revoked_at' => $context['revoked_at'] ?? null,
            ],
            ['%s', '%d', '%s', '%s', '%s', '%s', '%s']
        );

        return $inserted === false ? 0 : (int) $this->wpdb->insert_id;
    }

    /** @return array<string, mixed>|null */
    public function findAccessContextByHash(string $contextHash): ?array
    {
        if ($contextHash === '' || !$this->contextTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, context_hash, grant_id, purpose, reservation_set_hash,
                    created_at, expires_at, revoked_at
                FROM ' . $this->contextTable() . '
                WHERE context_hash = %s
                LIMIT 1',
                $contextHash
            ),
            ARRAY_A
        );

        return is_array($row) ? $row : null;
    }

    public function revokeAccessContext(int $contextId, string $timestamp): bool
    {
        if ($contextId <= 0 || !$this->contextTableExists()) {
            return false;
        }

        $updated = $this->wpdb->query(
            $this->wpdb->prepare(
                'UPDATE ' . $this->contextTable() . '
                SET revoked_at = %s
                WHERE id = %d AND revoked_at IS NULL',
                $timestamp,
                $contextId
            )
        );

        return $updated !== false;
    }

    public function deleteExpiredAccessContexts(string $timestamp, int $limit = 100): bool
    {
        if (!$this->contextTableExists()) {
            return false;
        }

        $limit = max(1, min(100, $limit));
        $deleted = $this->wpdb->query(
            $this->wpdb->prepare(
                'DELETE FROM ' . $this->contextTable() . '
                WHERE expires_at <= %s
                LIMIT %d',
                $timestamp,
                $limit
            )
        );

        return $deleted !== false;
    }

    public function touchUsage(int $grantId, string $timestamp): bool
    {
        if ($grantId <= 0 || !$this->publicAccessTableExists()) {
            return false;
        }

        $updated = $this->wpdb->query(
            $this->wpdb->prepare(
                'UPDATE ' . $this->accessTable() . '
                SET first_used_at = COALESCE(first_used_at, %s), last_used_at = %s
                WHERE id = %d',
                $timestamp,
                $timestamp,
                $grantId
            )
        );

        return $updated !== false;
    }

    public function revoke(int $grantId, string $timestamp): bool
    {
        if ($grantId <= 0 || !$this->publicAccessTableExists()) {
            return false;
        }

        $updated = $this->wpdb->query(
            $this->wpdb->prepare(
                'UPDATE ' . $this->accessTable() . '
                SET revoked_at = %s
                WHERE id = %d AND revoked_at IS NULL',
                $timestamp,
                $grantId
            )
        );

        return $updated !== false;
    }

    public function hasActiveCancellationExecution(string $reservationSetHash, string $timestamp = ''): bool
    {
        if ($reservationSetHash === '' || !$this->publicAccessTableExists()) {
            return false;
        }

        $timestamp = $timestamp !== '' ? $timestamp : gmdate('Y-m-d H:i:s');
        $count = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT COUNT(*)
                FROM ' . $this->accessTable() . '
                WHERE purpose = %s
                    AND reservation_set_hash = %s
                    AND (
                        execution_status <> %s
                        OR (
                            execution_status = %s
                            AND consumed_at IS NULL
                            AND revoked_at IS NULL
                            AND expires_at > %s
                        )
                    )',
                'confirm_cancellation',
                $reservationSetHash,
                'available',
                'available',
                $timestamp
            )
        );

        return (int) $count > 0;
    }

    public function claimCancellation(int $grantId, string $timestamp): bool
    {
        if ($grantId <= 0 || !$this->publicAccessTableExists()) {
            return false;
        }

        $updated = $this->wpdb->query(
            $this->wpdb->prepare(
                'UPDATE ' . $this->accessTable() . '
                SET execution_status = %s, claimed_at = %s, consumed_at = %s
                WHERE id = %d
                    AND purpose = %s
                    AND execution_status = %s
                    AND consumed_at IS NULL
                    AND revoked_at IS NULL
                    AND expires_at > %s',
                'claimed',
                $timestamp,
                $timestamp,
                $grantId,
                'confirm_cancellation',
                'available',
                $timestamp
            )
        );

        return (int) $updated === 1;
    }

    public function markCancellationCompleted(int $grantId, string $timestamp): bool
    {
        return $this->updateCancellationStatus($grantId, 'completed', $timestamp, 'completed_at');
    }

    public function markCancellationFailedManualReview(int $grantId, string $timestamp): bool
    {
        return $this->updateCancellationStatus($grantId, 'failed_manual_review', $timestamp, 'failed_at');
    }

    private function updateCancellationStatus(int $grantId, string $status, string $timestamp, string $timestampColumn): bool
    {
        if ($grantId <= 0 || !$this->publicAccessTableExists() || !in_array($timestampColumn, ['completed_at', 'failed_at'], true)) {
            return false;
        }

        $updated = $this->wpdb->query(
            $this->wpdb->prepare(
                'UPDATE ' . $this->accessTable() . '
                SET execution_status = %s, ' . $timestampColumn . ' = %s
                WHERE id = %d AND execution_status = %s',
                $status,
                $timestamp,
                $grantId,
                'claimed'
            )
        );

        return (int) $updated === 1;
    }
}
