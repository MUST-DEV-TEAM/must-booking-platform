<?php

namespace MustHotelBooking\Database;

final class RatePlanRepository extends AbstractRepository
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

    private function mhbColumnExists(string $suffix, string $column): bool
    {
        if ($column === '' || !$this->mhbTableExists($suffix)) {
            return false;
        }

        $result = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SHOW COLUMNS FROM ' . $this->mhbTable($suffix) . ' LIKE %s',
                $column
            )
        );

        return \is_string($result) && $result !== '';
    }

    private function seasonalModifierTypeColumn(): string
    {
        return $this->mhbColumnExists('seasonal_prices', 'modifier_type')
            ? 'modifier_type'
            : 'price_modifier_type';
    }

    public function ratePlansTableExists(): bool
    {
        return $this->mhbTableExists('rate_plans');
    }

    public function roomTypeRatePlansTableExists(): bool
    {
        return $this->mhbTableExists('room_type_rate_plans');
    }

    public function ratePlanPricesTableExists(): bool
    {
        return $this->mhbTableExists('rate_plan_prices');
    }

    public function seasonsTableExists(): bool
    {
        return $this->mhbTableExists('seasons');
    }

    public function seasonalPricesTableExists(): bool
    {
        return $this->mhbTableExists('seasonal_prices');
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRatePlansForRoomType(int $roomTypeId, bool $onlyActive = true): array
    {
        if (
            $roomTypeId <= 0 ||
            !$this->mhbTableExists('rate_plans') ||
            !$this->mhbTableExists('room_type_rate_plans')
        ) {
            return [];
        }

        $sql = 'SELECT
                rp.id,
                rp.name,
                rp.description,
                rp.cancellation_policy_id,
                rp.is_active,
                rtrp.room_type_id,
                rtrp.base_price,
                rtrp.max_occupancy,
                rtrp.created_at
            FROM ' . $this->mhbTable('room_type_rate_plans') . ' rtrp
            INNER JOIN ' . $this->mhbTable('rate_plans') . ' rp
                ON rp.id = rtrp.rate_plan_id
            WHERE rtrp.room_type_id = %d';

        if ($onlyActive) {
            $sql .= ' AND rp.is_active = 1';
        }

        $sql .= ' ORDER BY rtrp.base_price ASC, rp.name ASC, rp.id ASC';
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare($sql, $roomTypeId),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getRoomTypeRatePlan(int $roomTypeId, int $ratePlanId, bool $onlyActive = true): ?array
    {
        if (
            $roomTypeId <= 0 ||
            $ratePlanId <= 0 ||
            !$this->mhbTableExists('rate_plans') ||
            !$this->mhbTableExists('room_type_rate_plans')
        ) {
            return null;
        }

        $sql = 'SELECT
                rp.id,
                rp.name,
                rp.description,
                rp.cancellation_policy_id,
                rp.is_active,
                rtrp.room_type_id,
                rtrp.base_price,
                rtrp.max_occupancy,
                rtrp.created_at
            FROM ' . $this->mhbTable('room_type_rate_plans') . ' rtrp
            INNER JOIN ' . $this->mhbTable('rate_plans') . ' rp
                ON rp.id = rtrp.rate_plan_id
            WHERE rtrp.room_type_id = %d
                AND rp.id = %d';

        if ($onlyActive) {
            $sql .= ' AND rp.is_active = 1';
        }

        $sql .= ' LIMIT 1';
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare($sql, $roomTypeId, $ratePlanId),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getRatePlanById(int $ratePlanId): ?array
    {
        if ($ratePlanId <= 0 || !$this->mhbTableExists('rate_plans')) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, name, description, cancellation_policy_id, is_active, created_at
                FROM ' . $this->mhbTable('rate_plans') . '
                WHERE id = %d
                LIMIT 1',
                $ratePlanId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    public function getRatePlanPrice(int $ratePlanId, string $date): ?float
    {
        if (
            $ratePlanId <= 0 ||
            $date === '' ||
            !$this->mhbTableExists('rate_plan_prices')
        ) {
            return null;
        }

        $price = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT price
                FROM ' . $this->mhbTable('rate_plan_prices') . '
                WHERE rate_plan_id = %d
                    AND `date` = %s
                LIMIT 1',
                $ratePlanId,
                $date
            )
        );

        return $price !== null ? (float) $price : null;
    }

    /**
     * @return array<string, float>
     */
    public function getRatePlanPricesInRange(int $ratePlanId, string $checkin, string $checkout): array
    {
        if (
            $ratePlanId <= 0 ||
            $checkin === '' ||
            $checkout === '' ||
            !$this->mhbTableExists('rate_plan_prices')
        ) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT `date`, price
                FROM ' . $this->mhbTable('rate_plan_prices') . '
                WHERE rate_plan_id = %d
                    AND `date` >= %s
                    AND `date` < %s
                ORDER BY `date` ASC',
                $ratePlanId,
                $checkin,
                $checkout
            ),
            ARRAY_A
        );
        $prices = [];

        if (!\is_array($rows)) {
            return $prices;
        }

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $date = isset($row['date']) ? (string) $row['date'] : '';

            if ($date === '') {
                continue;
            }

            $prices[$date] = isset($row['price']) ? (float) $row['price'] : 0.0;
        }

        return $prices;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRatePlans(bool $includeInactive = true): array
    {
        if (!$this->mhbTableExists('rate_plans')) {
            return [];
        }

        $sql = 'SELECT id, name, description, cancellation_policy_id, is_active, created_at
            FROM ' . $this->mhbTable('rate_plans');

        if (!$includeInactive) {
            $sql .= ' WHERE is_active = 1';
        }

        $sql .= ' ORDER BY is_active DESC, name ASC, id DESC';
        $rows = $this->wpdb->get_results($sql, ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRoomTypesMissingPricing(int $limit = 5): array
    {
        if (
            !$this->mhbTableExists('room_types') ||
            !$this->mhbTableExists('room_type_rate_plans') ||
            !$this->mhbTableExists('rate_plans')
        ) {
            return [];
        }

        $limit = \max(1, \min(20, $limit));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    rt.id,
                    rt.name,
                    rt.base_price
                FROM ' . $this->mhbTable('room_types') . ' rt
                LEFT JOIN ' . $this->mhbTable('room_type_rate_plans') . ' rtrp
                    ON rtrp.room_type_id = rt.id
                LEFT JOIN ' . $this->mhbTable('rate_plans') . ' rp
                    ON rp.id = rtrp.rate_plan_id
                    AND rp.is_active = 1
                GROUP BY rt.id, rt.name, rt.base_price
                HAVING COUNT(rp.id) = 0 AND MAX(rt.base_price) <= 0
                ORDER BY rt.name ASC, rt.id ASC
                LIMIT %d',
                $limit
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @param array<int, int> $roomTypeIds
     * @return array<int, array<string, mixed>>
     */
    public function getRoomTypeRatePlanSummaryMap(array $roomTypeIds): array
    {
        $roomTypeIds = \array_values(
            \array_filter(
                \array_map('intval', $roomTypeIds),
                static function (int $roomTypeId): bool {
                    return $roomTypeId > 0;
                }
            )
        );

        if (
            empty($roomTypeIds) ||
            !$this->mhbTableExists('room_type_rate_plans') ||
            !$this->mhbTableExists('rate_plans')
        ) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    rtrp.room_type_id,
                    COUNT(DISTINCT rtrp.rate_plan_id) AS assignment_count,
                    COUNT(DISTINCT CASE WHEN rp.is_active = 1 THEN rtrp.rate_plan_id END) AS active_assignment_count,
                    MAX(rtrp.base_price) AS assigned_base_price,
                    MAX(rtrp.max_occupancy) AS max_assigned_occupancy
                FROM ' . $this->mhbTable('room_type_rate_plans') . ' rtrp
                LEFT JOIN ' . $this->mhbTable('rate_plans') . ' rp ON rp.id = rtrp.rate_plan_id
                WHERE rtrp.room_type_id IN (' . \implode(', ', \array_fill(0, \count($roomTypeIds), '%d')) . ')
                GROUP BY rtrp.room_type_id
                ORDER BY rtrp.room_type_id ASC',
                ...$roomTypeIds
            ),
            ARRAY_A
        );
        $summary = [];

        if (!\is_array($rows)) {
            return $summary;
        }

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $roomTypeId = isset($row['room_type_id']) ? (int) $row['room_type_id'] : 0;

            if ($roomTypeId <= 0) {
                continue;
            }

            $summary[$roomTypeId] = [
                'assignment_count' => isset($row['assignment_count']) ? (int) $row['assignment_count'] : 0,
                'active_assignment_count' => isset($row['active_assignment_count']) ? (int) $row['active_assignment_count'] : 0,
                'assigned_base_price' => isset($row['assigned_base_price']) ? (float) $row['assigned_base_price'] : 0.0,
                'max_assigned_occupancy' => isset($row['max_assigned_occupancy']) ? (int) $row['max_assigned_occupancy'] : 0,
            ];
        }

        return $summary;
    }

    public function createRatePlan(array $data): int
    {
        if (!$this->mhbTableExists('rate_plans')) {
            return 0;
        }

        $inserted = $this->wpdb->insert(
            $this->mhbTable('rate_plans'),
            [
                'name' => isset($data['name']) ? (string) $data['name'] : '',
                'description' => isset($data['description']) ? (string) $data['description'] : '',
                'cancellation_policy_id' => isset($data['cancellation_policy_id']) ? (int) $data['cancellation_policy_id'] : 0,
                'is_active' => !empty($data['is_active']) ? 1 : 0,
                'created_at' => isset($data['created_at']) ? (string) $data['created_at'] : \current_time('mysql'),
            ],
            ['%s', '%s', '%d', '%d', '%s']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    public function updateRatePlan(int $ratePlanId, array $data): bool
    {
        if ($ratePlanId <= 0 || !$this->mhbTableExists('rate_plans')) {
            return false;
        }

        $updated = $this->wpdb->update(
            $this->mhbTable('rate_plans'),
            [
                'name' => isset($data['name']) ? (string) $data['name'] : '',
                'description' => isset($data['description']) ? (string) $data['description'] : '',
                'cancellation_policy_id' => isset($data['cancellation_policy_id']) ? (int) $data['cancellation_policy_id'] : 0,
                'is_active' => !empty($data['is_active']) ? 1 : 0,
            ],
            ['id' => $ratePlanId],
            ['%s', '%s', '%d', '%d'],
            ['%d']
        );

        return \is_int($updated);
    }

    public function deleteRatePlan(int $ratePlanId): bool
    {
        if ($ratePlanId <= 0 || !$this->mhbTableExists('rate_plans')) {
            return false;
        }

        if ($this->mhbTableExists('room_type_rate_plans')) {
            $this->wpdb->delete(
                $this->mhbTable('room_type_rate_plans'),
                ['rate_plan_id' => $ratePlanId],
                ['%d']
            );
        }

        if ($this->mhbTableExists('rate_plan_prices')) {
            $this->wpdb->delete(
                $this->mhbTable('rate_plan_prices'),
                ['rate_plan_id' => $ratePlanId],
                ['%d']
            );
        }

        if ($this->mhbTableExists('seasonal_prices')) {
            $this->wpdb->delete(
                $this->mhbTable('seasonal_prices'),
                ['rate_plan_id' => $ratePlanId],
                ['%d']
            );
        }

        $deleted = $this->wpdb->delete(
            $this->mhbTable('rate_plans'),
            ['id' => $ratePlanId],
            ['%d']
        );

        return $deleted !== false;
    }

    public function saveRoomTypeAssignment(int $ratePlanId, int $roomTypeId, float $basePrice, int $maxOccupancy): int
    {
        if (
            $ratePlanId <= 0 ||
            $roomTypeId <= 0 ||
            !$this->mhbTableExists('room_type_rate_plans')
        ) {
            return 0;
        }

        $basePrice = \round(\max(0.0, $basePrice), 2);
        $maxOccupancy = \max(1, $maxOccupancy);
        $existingId = (int) $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT id
                FROM ' . $this->mhbTable('room_type_rate_plans') . '
                WHERE rate_plan_id = %d
                    AND room_type_id = %d
                LIMIT 1',
                $ratePlanId,
                $roomTypeId
            )
        );

        if ($existingId > 0) {
            $updated = $this->wpdb->update(
                $this->mhbTable('room_type_rate_plans'),
                [
                    'base_price' => $basePrice,
                    'max_occupancy' => $maxOccupancy,
                ],
                ['id' => $existingId],
                ['%f', '%d'],
                ['%d']
            );

            return $updated === false ? 0 : $existingId;
        }

        $inserted = $this->wpdb->insert(
            $this->mhbTable('room_type_rate_plans'),
            [
                'room_type_id' => $roomTypeId,
                'rate_plan_id' => $ratePlanId,
                'base_price' => $basePrice,
                'max_occupancy' => $maxOccupancy,
                'created_at' => \current_time('mysql'),
            ],
            ['%d', '%d', '%f', '%d', '%s']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    public function deleteRoomTypeAssignment(int $assignmentId): bool
    {
        if ($assignmentId <= 0 || !$this->mhbTableExists('room_type_rate_plans')) {
            return false;
        }

        $deleted = $this->wpdb->delete(
            $this->mhbTable('room_type_rate_plans'),
            ['id' => $assignmentId],
            ['%d']
        );

        return $deleted !== false;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getAssignmentsByRatePlanId(int $ratePlanId): array
    {
        if (
            $ratePlanId <= 0 ||
            !$this->mhbTableExists('room_type_rate_plans')
        ) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    rtrp.id,
                    rtrp.room_type_id,
                    rtrp.rate_plan_id,
                    rtrp.base_price,
                    rtrp.max_occupancy,
                    rtrp.created_at,
                    COALESCE(rm.name, CONCAT(\'#\', rtrp.room_type_id)) AS room_name,
                    rm.category AS room_category
                FROM ' . $this->mhbTable('room_type_rate_plans') . ' rtrp
                LEFT JOIN ' . $this->table('rooms') . ' rm ON rm.id = rtrp.room_type_id
                WHERE rtrp.rate_plan_id = %d
                ORDER BY COALESCE(rm.name, CONCAT(\'#\', rtrp.room_type_id)) ASC, rtrp.id ASC',
                $ratePlanId
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getSeasonForDate(string $date): ?array
    {
        if ($date === '' || !$this->mhbTableExists('seasons')) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, name, start_date, end_date, priority
                FROM ' . $this->mhbTable('seasons') . '
                WHERE start_date <= %s
                    AND end_date >= %s
                ORDER BY priority DESC, start_date DESC, id DESC
                LIMIT 1',
                $date,
                $date
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getSeasonsForRange(string $checkin, string $checkout): array
    {
        if (
            $checkin === '' ||
            $checkout === '' ||
            !$this->mhbTableExists('seasons')
        ) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT id, name, start_date, end_date, priority
                FROM ' . $this->mhbTable('seasons') . '
                WHERE start_date < %s
                    AND end_date >= %s
                ORDER BY priority DESC, start_date DESC, id DESC',
                $checkout,
                $checkin
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getSeasonalPriceModifier(int $seasonId, int $ratePlanId): ?array
    {
        if (
            $seasonId <= 0 ||
            $ratePlanId <= 0 ||
            !$this->mhbTableExists('seasonal_prices')
        ) {
            return null;
        }

        $modifierTypeColumn = $this->seasonalModifierTypeColumn();
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, season_id, rate_plan_id, ' . $modifierTypeColumn . ' AS modifier_type, ' . $modifierTypeColumn . ' AS price_modifier_type, modifier_value
                FROM ' . $this->mhbTable('seasonal_prices') . '
                WHERE season_id = %d
                    AND rate_plan_id = %d
                LIMIT 1',
                $seasonId,
                $ratePlanId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getSeasonalModifiersForRatePlan(int $ratePlanId): array
    {
        if ($ratePlanId <= 0 || !$this->mhbTableExists('seasonal_prices')) {
            return [];
        }

        $modifierTypeColumn = $this->seasonalModifierTypeColumn();
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT id, season_id, rate_plan_id, ' . $modifierTypeColumn . ' AS modifier_type, ' . $modifierTypeColumn . ' AS price_modifier_type, modifier_value
                FROM ' . $this->mhbTable('seasonal_prices') . '
                WHERE rate_plan_id = %d
                ORDER BY id ASC',
                $ratePlanId
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    public function getRatePlanDefaultBasePrice(int $ratePlanId): ?float
    {
        if (
            $ratePlanId <= 0 ||
            !$this->mhbTableExists('room_type_rate_plans')
        ) {
            return null;
        }

        $price = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT base_price
                FROM ' . $this->mhbTable('room_type_rate_plans') . '
                WHERE rate_plan_id = %d
                ORDER BY id ASC
                LIMIT 1',
                $ratePlanId
            )
        );

        return $price !== null ? (float) $price : null;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRatePlanPriceRows(int $ratePlanId): array
    {
        if ($ratePlanId <= 0 || !$this->mhbTableExists('rate_plan_prices')) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT id, rate_plan_id, `date`, price
                FROM ' . $this->mhbTable('rate_plan_prices') . '
                WHERE rate_plan_id = %d
                ORDER BY `date` ASC, id ASC',
                $ratePlanId
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    public function saveRatePlanPrice(int $ratePlanId, string $date, float $price): int
    {
        if (
            $ratePlanId <= 0 ||
            $date === '' ||
            !$this->mhbTableExists('rate_plan_prices')
        ) {
            return 0;
        }

        $price = \round(\max(0.0, $price), 2);
        $existingId = (int) $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT id
                FROM ' . $this->mhbTable('rate_plan_prices') . '
                WHERE rate_plan_id = %d
                    AND `date` = %s
                LIMIT 1',
                $ratePlanId,
                $date
            )
        );

        if ($existingId > 0) {
            $updated = $this->wpdb->update(
                $this->mhbTable('rate_plan_prices'),
                ['price' => $price],
                ['id' => $existingId],
                ['%f'],
                ['%d']
            );

            return $updated === false ? 0 : $existingId;
        }

        $inserted = $this->wpdb->insert(
            $this->mhbTable('rate_plan_prices'),
            [
                'rate_plan_id' => $ratePlanId,
                'date' => $date,
                'price' => $price,
            ],
            ['%d', '%s', '%f']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    public function deleteRatePlanPrice(int $priceId): bool
    {
        if ($priceId <= 0 || !$this->mhbTableExists('rate_plan_prices')) {
            return false;
        }

        $deleted = $this->wpdb->delete(
            $this->mhbTable('rate_plan_prices'),
            ['id' => $priceId],
            ['%d']
        );

        return $deleted !== false;
    }
}
