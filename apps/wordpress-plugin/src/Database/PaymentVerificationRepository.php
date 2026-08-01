<?php

namespace MustHotelBooking\Database;

final class PaymentVerificationRepository extends AbstractRepository
{
    public function tablesExist(): bool
    {
        return $this->tableExists('payment_verification_groups') && $this->tableExists('payment_verifications');
    }

    public function findGroupByOwnershipKeyForUpdate(string $ownershipKey): ?array
    {
        if ($ownershipKey === '' || !$this->tablesExist()) {
            return null;
        }
        $row = $this->wpdb->get_row($this->wpdb->prepare(
            'SELECT * FROM ' . $this->table('payment_verification_groups') . ' WHERE ownership_key = %s LIMIT 1 FOR UPDATE',
            $ownershipKey
        ), ARRAY_A);
        return \is_array($row) ? $row : null;
    }

    /** @return array<int, array<string, mixed>> */
    public function getAllocations(int $groupId): array
    {
        if ($groupId <= 0 || !$this->tablesExist()) {
            return [];
        }
        $rows = $this->wpdb->get_results($this->wpdb->prepare(
            'SELECT reservation_id, payment_id, amount_minor, currency, claim_hash FROM ' . $this->table('payment_verifications') . ' WHERE verification_group_id = %d ORDER BY reservation_id, payment_id',
            $groupId
        ), ARRAY_A);
        return \is_array($rows) ? $rows : [];
    }

    /** @return array<int, array<string, mixed>> */
    public function getForReservation(int $reservationId): array
    {
        if ($reservationId <= 0 || !$this->tablesExist()) {
            return [];
        }
        $rows = $this->wpdb->get_results($this->wpdb->prepare(
            'SELECT v.*, g.provider, g.provider_mode, g.provider_account_fingerprint, g.provider_transaction_reference, g.provider_attempt_reference, g.total_amount_minor, g.currency AS group_currency, g.ownership_key, g.allocation_set_hash, g.allocation_count
             FROM ' . $this->table('payment_verifications') . ' v
             INNER JOIN ' . $this->table('payment_verification_groups') . ' g ON g.id = v.verification_group_id
             WHERE v.reservation_id = %d ORDER BY v.id DESC',
            $reservationId
        ), ARRAY_A);
        return \is_array($rows) ? $rows : [];
    }

    /** @param array<string, mixed> $group @param array<int, array<string, mixed>> $allocations */
    public function createGroupWithAllocations(array $group, array $allocations): array
    {
        if (!$this->tablesExist()) {
            return ['success' => false, 'reason_code' => 'verification_schema_missing'];
        }
        $ownershipKey = (string) ($group['ownership_key'] ?? '');
        $existing = $this->findGroupByOwnershipKeyForUpdate($ownershipKey);
        if (\is_array($existing)) {
            return $this->matches($existing, $group, $this->getAllocations((int) $existing['id']), $allocations)
                ? ['success' => true, 'idempotent' => true, 'group_id' => (int) $existing['id']]
                : ['success' => false, 'reason_code' => 'provider_payment_ownership_mismatch'];
        }

        if ($this->wpdb->insert($this->table('payment_verification_groups'), $group) === false) {
            $raced = $this->findGroupByOwnershipKeyForUpdate($ownershipKey);
            return \is_array($raced) && $this->matches($raced, $group, $this->getAllocations((int) $raced['id']), $allocations)
                ? ['success' => true, 'idempotent' => true, 'group_id' => (int) $raced['id']]
                : ['success' => false, 'reason_code' => 'verification_group_insert_failed'];
        }
        $groupId = (int) $this->wpdb->insert_id;
        foreach ($allocations as $allocation) {
            $row = $allocation;
            $row['verification_group_id'] = $groupId;
            if ($this->wpdb->insert($this->table('payment_verifications'), $row) === false) {
                return ['success' => false, 'reason_code' => 'verification_allocation_insert_failed'];
            }
        }
        return ['success' => true, 'idempotent' => false, 'group_id' => $groupId];
    }

    /** @param array<string, mixed> $storedGroup @param array<string, mixed> $candidateGroup @param array<int, array<string, mixed>> $stored @param array<int, array<string, mixed>> $candidate */
    private function matches(array $storedGroup, array $candidateGroup, array $stored, array $candidate): bool
    {
        foreach (['provider', 'provider_mode', 'provider_account_fingerprint', 'provider_transaction_reference', 'provider_attempt_reference', 'total_amount_minor', 'currency', 'ownership_key', 'allocation_set_hash', 'allocation_count'] as $field) {
            if ((string) ($storedGroup[$field] ?? '') !== (string) ($candidateGroup[$field] ?? '')) {
                return false;
            }
        }
        $normalize = static function (array $rows): array {
            $result = [];
            foreach ($rows as $row) {
                $result[] = [(int) ($row['reservation_id'] ?? 0), (int) ($row['payment_id'] ?? 0), (int) ($row['amount_minor'] ?? 0), \strtoupper((string) ($row['currency'] ?? ''))];
            }
            \sort($result);
            return $result;
        };
        return $normalize($stored) === $normalize($candidate);
    }
}
