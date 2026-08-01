<?php

namespace MustHotelBooking\Database;

final class PricingRuleRepository extends AbstractRepository
{
    public function pricingTableExists(): bool
    {
        return $this->tableExists('pricing');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getRuleById(int $ruleId): ?array
    {
        if ($ruleId <= 0 || !$this->pricingTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT
                    p.id,
                    p.room_id,
                    p.name,
                    p.start_date,
                    p.end_date,
                    p.price_override,
                    p.weekend_price,
                    p.minimum_nights,
                    p.priority,
                    p.is_active,
                    p.created_at,
                    COALESCE(r.name, \'\') AS room_name
                FROM ' . $this->table('pricing') . ' p
                LEFT JOIN ' . $this->table('rooms') . ' r ON r.id = p.room_id
                WHERE p.id = %d
                LIMIT 1',
                $ruleId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<int, array<string, mixed>>
     */
    public function getRules(array $filters = []): array
    {
        if (!$this->pricingTableExists()) {
            return [];
        }

        $includeInactive = !empty($filters['include_inactive']);
        $roomId = isset($filters['room_id']) ? (int) $filters['room_id'] : -1;
        $timeline = isset($filters['timeline']) ? \sanitize_key((string) $filters['timeline']) : '';
        $search = isset($filters['search']) ? \sanitize_text_field((string) $filters['search']) : '';
        $today = isset($filters['today']) ? \sanitize_text_field((string) $filters['today']) : \current_time('Y-m-d');
        $scope = isset($filters['scope']) ? \sanitize_key((string) $filters['scope']) : '';
        $ruleType = isset($filters['rule_type']) ? \sanitize_key((string) $filters['rule_type']) : '';
        $where = [];
        $params = [];

        if (!$includeInactive) {
            $where[] = 'p.is_active = 1';
        }

        if ($roomId >= 0) {
            if ($roomId === 0) {
                $where[] = 'p.room_id = 0';
            } else {
                $where[] = 'p.room_id = %d';
                $params[] = $roomId;
            }
        }

        if ($scope === 'global') {
            $where[] = 'p.room_id = 0';
        } elseif ($scope === 'room') {
            $where[] = 'p.room_id > 0';
        }

        if ($timeline === 'current') {
            $where[] = 'p.start_date <= %s AND p.end_date >= %s';
            $params[] = $today;
            $params[] = $today;
        } elseif ($timeline === 'future') {
            $where[] = 'p.end_date >= %s';
            $params[] = $today;
        } elseif ($timeline === 'past') {
            $where[] = 'p.end_date < %s';
            $params[] = $today;
        }

        if ($ruleType === 'weekend') {
            $where[] = 'p.weekend_price > 0 AND p.price_override <= 0';
        } elseif ($ruleType === 'nightly') {
            $where[] = 'p.price_override > 0 AND p.weekend_price <= 0';
        } elseif ($ruleType === 'mixed') {
            $where[] = 'p.price_override > 0 AND p.weekend_price > 0';
        }

        if ($search !== '') {
            $where[] = '(p.name LIKE %s OR COALESCE(r.name, \'\') LIKE %s)';
            $params[] = '%' . $this->wpdb->esc_like($search) . '%';
            $params[] = '%' . $this->wpdb->esc_like($search) . '%';
        }

        $sql = 'SELECT
                p.id,
                p.room_id,
                p.name,
                p.start_date,
                p.end_date,
                p.price_override,
                p.weekend_price,
                p.minimum_nights,
                p.priority,
                p.is_active,
                p.created_at,
                COALESCE(r.name, \'\') AS room_name,
                COALESCE(r.is_active, 1) AS room_is_active,
                COALESCE(r.is_bookable, 1) AS room_is_bookable
            FROM ' . $this->table('pricing') . ' p
            LEFT JOIN ' . $this->table('rooms') . ' r ON r.id = p.room_id';

        if (!empty($where)) {
            $sql .= ' WHERE ' . \implode(' AND ', $where);
        }

        $sql .= ' ORDER BY p.room_id ASC, p.priority DESC, p.minimum_nights DESC, p.start_date DESC, p.end_date ASC, p.id DESC';

        $rows = !empty($params)
            ? $this->wpdb->get_results($this->wpdb->prepare($sql, ...$params), ARRAY_A)
            : $this->wpdb->get_results($sql, ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @param array<int, int> $roomIds
     * @return array<int, array<string, int>>
     */
    public function getRoomPricingRuleSummaryMap(array $roomIds): array
    {
        $roomIds = \array_values(
            \array_filter(
                \array_map('intval', $roomIds),
                static function (int $roomId): bool {
                    return $roomId > 0;
                }
            )
        );

        if (empty($roomIds) || !$this->pricingTableExists()) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    room_id,
                    COUNT(*) AS rule_count,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_rule_count
                FROM ' . $this->table('pricing') . '
                WHERE room_id IN (' . \implode(', ', \array_fill(0, \count($roomIds), '%d')) . ')
                GROUP BY room_id
                ORDER BY room_id ASC',
                ...$roomIds
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

            $roomId = isset($row['room_id']) ? (int) $row['room_id'] : 0;

            if ($roomId <= 0) {
                continue;
            }

            $summary[$roomId] = [
                'rule_count' => isset($row['rule_count']) ? (int) $row['rule_count'] : 0,
                'active_rule_count' => isset($row['active_rule_count']) ? (int) $row['active_rule_count'] : 0,
            ];
        }

        return $summary;
    }

    /**
     * @param array<string, mixed> $ruleData
     */
    public function saveRule(array $ruleData): int
    {
        if (!$this->pricingTableExists()) {
            return 0;
        }

        $ruleId = isset($ruleData['id']) ? (int) $ruleData['id'] : 0;
        $payload = [
            'room_id' => isset($ruleData['room_id']) ? (int) $ruleData['room_id'] : 0,
            'name' => isset($ruleData['name']) ? (string) $ruleData['name'] : '',
            'start_date' => isset($ruleData['start_date']) ? (string) $ruleData['start_date'] : '',
            'end_date' => isset($ruleData['end_date']) ? (string) $ruleData['end_date'] : '',
            'price_override' => isset($ruleData['price_override']) ? (float) $ruleData['price_override'] : 0.0,
            'weekend_price' => isset($ruleData['weekend_price']) ? (float) $ruleData['weekend_price'] : 0.0,
            'minimum_nights' => isset($ruleData['minimum_nights']) ? (int) $ruleData['minimum_nights'] : 1,
            'priority' => isset($ruleData['priority']) ? (int) $ruleData['priority'] : 10,
            'is_active' => !empty($ruleData['is_active']) ? 1 : 0,
        ];

        if ($ruleId > 0) {
            $updated = $this->wpdb->update(
                $this->table('pricing'),
                $payload,
                ['id' => $ruleId],
                ['%d', '%s', '%s', '%s', '%f', '%f', '%d', '%d', '%d'],
                ['%d']
            );

            return $updated === false ? 0 : $ruleId;
        }

        $payload['created_at'] = isset($ruleData['created_at']) ? (string) $ruleData['created_at'] : \current_time('mysql');
        $inserted = $this->wpdb->insert(
            $this->table('pricing'),
            $payload,
            ['%d', '%s', '%s', '%s', '%f', '%f', '%d', '%d', '%d', '%s']
        );

        return $inserted === false ? 0 : (int) $this->wpdb->insert_id;
    }

    public function deleteRule(int $ruleId): bool
    {
        if ($ruleId <= 0 || !$this->pricingTableExists()) {
            return false;
        }

        return $this->wpdb->delete($this->table('pricing'), ['id' => $ruleId], ['%d']) !== false;
    }

    public function duplicateRule(int $ruleId): int
    {
        $rule = $this->getRuleById($ruleId);

        if (!\is_array($rule)) {
            return 0;
        }

        $rule['id'] = 0;
        $rule['name'] = \sprintf(__('%s Copy', 'must-hotel-booking'), (string) ($rule['name'] ?? __('Pricing Rule', 'must-hotel-booking')));

        return $this->saveRule($rule);
    }

    public function toggleRuleStatus(int $ruleId, bool $isActive): bool
    {
        if ($ruleId <= 0 || !$this->pricingTableExists()) {
            return false;
        }

        return $this->wpdb->update(
            $this->table('pricing'),
            ['is_active' => $isActive ? 1 : 0],
            ['id' => $ruleId],
            ['%d'],
            ['%d']
        ) !== false;
    }

    /**
     * @param array<string, mixed> $ruleData
     * @return array<int, array<string, mixed>>
     */
    public function getOverlappingRules(array $ruleData, int $excludeRuleId = 0): array
    {
        if (!$this->pricingTableExists()) {
            return [];
        }

        $roomId = isset($ruleData['room_id']) ? (int) $ruleData['room_id'] : 0;
        $startDate = isset($ruleData['start_date']) ? (string) $ruleData['start_date'] : '';
        $endDate = isset($ruleData['end_date']) ? (string) $ruleData['end_date'] : '';
        $isActive = !empty($ruleData['is_active']);

        if ($startDate === '' || $endDate === '' || !$isActive) {
            return [];
        }

        $sql = 'SELECT id, room_id, name, start_date, end_date, priority, is_active
            FROM ' . $this->table('pricing') . '
            WHERE room_id = %d
                AND is_active = 1
                AND start_date <= %s
                AND end_date >= %s';
        $params = [$roomId, $endDate, $startDate];

        if ($excludeRuleId > 0) {
            $sql .= ' AND id <> %d';
            $params[] = $excludeRuleId;
        }

        $sql .= ' ORDER BY priority DESC, start_date DESC, end_date ASC, id DESC';
        $rows = $this->wpdb->get_results($this->wpdb->prepare($sql, ...$params), ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }
}
