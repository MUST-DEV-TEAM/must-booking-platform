<?php

namespace MustHotelBooking\Database;

final class CancellationPolicyRepository extends AbstractRepository
{
    private function mhbTable(string $suffix): string
    {
        return $this->wpdb->prefix . 'mhb_' . $suffix;
    }

    private function mhbTableExists(string $suffix): bool
    {
        $tableName = $this->mhbTable($suffix);
        $result = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SHOW TABLES LIKE %s',
                $tableName
            )
        );

        return \is_string($result) && $result !== '';
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getPolicies(): array
    {
        if (!$this->mhbTableExists('cancellation_policies')) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            'SELECT id, name, hours_before_checkin, penalty_percent, description
            FROM ' . $this->mhbTable('cancellation_policies') . '
            ORDER BY hours_before_checkin DESC, penalty_percent ASC, id ASC',
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getPolicyById(int $policyId): ?array
    {
        if ($policyId <= 0 || !$this->mhbTableExists('cancellation_policies')) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, name, hours_before_checkin, penalty_percent, description
                FROM ' . $this->mhbTable('cancellation_policies') . '
                WHERE id = %d
                LIMIT 1',
                $policyId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getPolicyByRatePlanId(int $ratePlanId): ?array
    {
        if (
            $ratePlanId <= 0 ||
            !$this->mhbTableExists('cancellation_policies') ||
            !$this->mhbTableExists('rate_plans')
        ) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT cp.id, cp.name, cp.hours_before_checkin, cp.penalty_percent, cp.description
                FROM ' . $this->mhbTable('rate_plans') . ' rp
                INNER JOIN ' . $this->mhbTable('cancellation_policies') . ' cp
                    ON cp.id = rp.cancellation_policy_id
                WHERE rp.id = %d
                LIMIT 1',
                $ratePlanId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }
}
