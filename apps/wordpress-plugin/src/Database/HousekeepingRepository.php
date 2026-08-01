<?php

namespace MustHotelBooking\Database;

final class HousekeepingRepository extends AbstractRepository
{
    public const STATUS_DIRTY = 'dirty';
    public const STATUS_CLEAN = 'clean';
    public const STATUS_INSPECTED = 'inspected';
    public const STATUS_OUT_OF_ORDER = 'out_of_order';
    public const ISSUE_STATUS_OPEN = 'open';
    public const ISSUE_STATUS_IN_PROGRESS = 'in_progress';
    public const ISSUE_STATUS_RESOLVED = 'resolved';

    private function housekeepingTable(): string
    {
        return $this->table('room_housekeeping_statuses');
    }

    private function issuesTable(): string
    {
        return $this->table('room_housekeeping_issues');
    }

    private function handoffsTable(): string
    {
        return $this->table('housekeeping_handoffs');
    }

    public function housekeepingTableExists(): bool
    {
        return $this->tableExists('room_housekeeping_statuses');
    }

    public function issuesTableExists(): bool
    {
        return $this->tableExists('room_housekeeping_issues');
    }

    public function handoffsTableExists(): bool
    {
        return $this->tableExists('housekeeping_handoffs');
    }

    /**
     * @return array<int, string>
     */
    public static function getAllowedStatuses(): array
    {
        return [
            self::STATUS_DIRTY,
            self::STATUS_CLEAN,
            self::STATUS_INSPECTED,
            self::STATUS_OUT_OF_ORDER,
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function getStatusLabels(): array
    {
        return [
            self::STATUS_DIRTY => \__('Dirty', 'must-hotel-booking'),
            self::STATUS_CLEAN => \__('Clean', 'must-hotel-booking'),
            self::STATUS_INSPECTED => \__('Inspected', 'must-hotel-booking'),
            self::STATUS_OUT_OF_ORDER => \__('Out of Order', 'must-hotel-booking'),
        ];
    }

    /**
     * @return array<int, string>
     */
    public static function getAllowedIssueStatuses(): array
    {
        return [
            self::ISSUE_STATUS_OPEN,
            self::ISSUE_STATUS_IN_PROGRESS,
            self::ISSUE_STATUS_RESOLVED,
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function getIssueStatusLabels(): array
    {
        return [
            self::ISSUE_STATUS_OPEN => \__('Open', 'must-hotel-booking'),
            self::ISSUE_STATUS_IN_PROGRESS => \__('In Progress', 'must-hotel-booking'),
            self::ISSUE_STATUS_RESOLVED => \__('Resolved', 'must-hotel-booking'),
        ];
    }

    public static function normalizeStatus(string $status): string
    {
        $status = \sanitize_key($status);

        if (!\in_array($status, self::getAllowedStatuses(), true)) {
            return self::STATUS_DIRTY;
        }

        return $status;
    }

    public static function normalizeIssueStatus(string $status): string
    {
        $status = \sanitize_key($status);

        if (!\in_array($status, self::getAllowedIssueStatuses(), true)) {
            return self::ISSUE_STATUS_OPEN;
        }

        return $status;
    }

    /**
     * @param array<int, int> $inventoryRoomIds
     * @return array<int, array<string, mixed>>
     */
    public function getRoomStatusMap(array $inventoryRoomIds): array
    {
        $inventoryRoomIds = $this->normalizeIds($inventoryRoomIds);

        if (empty($inventoryRoomIds) || !$this->housekeepingTableExists()) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT inventory_room_id, status, assigned_to_user_id, assigned_by_user_id, assigned_at, updated_by, updated_at
                FROM ' . $this->housekeepingTable() . '
                WHERE inventory_room_id IN (' . $this->buildIntegerPlaceholders($inventoryRoomIds) . ')
                ORDER BY inventory_room_id ASC',
                ...$inventoryRoomIds
            ),
            ARRAY_A
        );

        if (!\is_array($rows)) {
            return [];
        }

        $statusMap = [];

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $roomId = isset($row['inventory_room_id']) ? (int) $row['inventory_room_id'] : 0;

            if ($roomId <= 0) {
                continue;
            }

            $statusMap[$roomId] = [
                'inventory_room_id' => $roomId,
                'status' => self::normalizeStatus((string) ($row['status'] ?? '')),
                'assigned_to_user_id' => isset($row['assigned_to_user_id']) ? (int) $row['assigned_to_user_id'] : 0,
                'assigned_by_user_id' => isset($row['assigned_by_user_id']) ? (int) $row['assigned_by_user_id'] : 0,
                'assigned_at' => isset($row['assigned_at']) ? (string) $row['assigned_at'] : '',
                'updated_by' => isset($row['updated_by']) ? (int) $row['updated_by'] : 0,
                'updated_at' => isset($row['updated_at']) ? (string) $row['updated_at'] : '',
            ];
        }

        return $statusMap;
    }

    public function updateRoomStatus(int $inventoryRoomId, string $status, int $updatedBy = 0): bool
    {
        if ($inventoryRoomId <= 0 || !$this->housekeepingTableExists()) {
            return false;
        }

        return $this->upsertHousekeepingRow(
            $inventoryRoomId,
            [
                'status' => self::normalizeStatus($status),
                'updated_by' => \max(0, $updatedBy),
                'updated_at' => \current_time('mysql'),
            ]
        );
    }

    public function assignRoom(int $inventoryRoomId, int $assignedToUserId, int $assignedByUserId = 0): bool
    {
        if ($inventoryRoomId <= 0 || !$this->housekeepingTableExists()) {
            return false;
        }

        return $this->upsertHousekeepingRow(
            $inventoryRoomId,
            [
                'assigned_to_user_id' => \max(0, $assignedToUserId),
                'assigned_by_user_id' => \max(0, $assignedByUserId),
                'assigned_at' => \current_time('mysql'),
            ]
        );
    }

    /**
     * @param array<int, int> $inventoryRoomIds
     * @return array<int, array<string, int>>
     */
    public function getRoomIssueCountsMap(array $inventoryRoomIds): array
    {
        $inventoryRoomIds = $this->normalizeIds($inventoryRoomIds);

        if (empty($inventoryRoomIds) || !$this->issuesTableExists()) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    inventory_room_id,
                    SUM(CASE WHEN status = %s THEN 1 ELSE 0 END) AS open_count,
                    SUM(CASE WHEN status = %s THEN 1 ELSE 0 END) AS in_progress_count,
                    SUM(CASE WHEN status = %s THEN 1 ELSE 0 END) AS resolved_count
                FROM ' . $this->issuesTable() . '
                WHERE inventory_room_id IN (' . $this->buildIntegerPlaceholders($inventoryRoomIds) . ')
                GROUP BY inventory_room_id
                ORDER BY inventory_room_id ASC',
                ...\array_merge(
                    [
                        self::ISSUE_STATUS_OPEN,
                        self::ISSUE_STATUS_IN_PROGRESS,
                        self::ISSUE_STATUS_RESOLVED,
                    ],
                    $inventoryRoomIds
                )
            ),
            ARRAY_A
        );

        if (!\is_array($rows)) {
            return [];
        }

        $counts = [];

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $roomId = isset($row['inventory_room_id']) ? (int) $row['inventory_room_id'] : 0;

            if ($roomId <= 0) {
                continue;
            }

            $openCount = isset($row['open_count']) ? (int) $row['open_count'] : 0;
            $inProgressCount = isset($row['in_progress_count']) ? (int) $row['in_progress_count'] : 0;
            $resolvedCount = isset($row['resolved_count']) ? (int) $row['resolved_count'] : 0;

            $counts[$roomId] = [
                'open_count' => $openCount,
                'in_progress_count' => $inProgressCount,
                'resolved_count' => $resolvedCount,
                'unresolved_count' => $openCount + $inProgressCount,
            ];
        }

        return $counts;
    }

    /**
     * @param array<int, int> $inventoryRoomIds
     * @return array<int, array<string, mixed>>
     */
    public function getIssues(array $inventoryRoomIds = [], bool $includeResolved = true, int $limit = 100): array
    {
        if (!$this->issuesTableExists()) {
            return [];
        }

        $inventoryRoomIds = $this->normalizeIds($inventoryRoomIds);
        $limit = \max(1, \min(200, $limit));
        $where = [];
        $params = [];

        if (!empty($inventoryRoomIds)) {
            $where[] = 'inventory_room_id IN (' . $this->buildIntegerPlaceholders($inventoryRoomIds) . ')';
            $params = \array_merge($params, $inventoryRoomIds);
        }

        if (!$includeResolved) {
            $where[] = 'status IN (%s, %s)';
            $params[] = self::ISSUE_STATUS_OPEN;
            $params[] = self::ISSUE_STATUS_IN_PROGRESS;
        }

        $params[] = self::ISSUE_STATUS_OPEN;
        $params[] = self::ISSUE_STATUS_IN_PROGRESS;
        $params[] = self::ISSUE_STATUS_RESOLVED;
        $params[] = $limit;
        $sql = 'SELECT
                id,
                inventory_room_id,
                issue_title,
                issue_details,
                status,
                created_by,
                updated_by,
                created_at,
                updated_at
            FROM ' . $this->issuesTable();

        if (!empty($where)) {
            $sql .= ' WHERE ' . \implode(' AND ', $where);
        }

        $sql .= ' ORDER BY FIELD(status, %s, %s, %s), updated_at DESC, id DESC LIMIT %d';
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare($sql, ...$params),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getIssue(int $issueId): ?array
    {
        if ($issueId <= 0 || !$this->issuesTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT
                    id,
                    inventory_room_id,
                    issue_title,
                    issue_details,
                    status,
                    created_by,
                    updated_by,
                    created_at,
                    updated_at
                FROM ' . $this->issuesTable() . '
                WHERE id = %d
                LIMIT 1',
                $issueId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    public function createIssue(int $inventoryRoomId, string $title, string $details, int $createdBy = 0): int
    {
        if ($inventoryRoomId <= 0 || !$this->issuesTableExists()) {
            return 0;
        }

        $inserted = $this->wpdb->insert(
            $this->issuesTable(),
            [
                'inventory_room_id' => $inventoryRoomId,
                'issue_title' => \sanitize_text_field($title),
                'issue_details' => \sanitize_textarea_field($details),
                'status' => self::ISSUE_STATUS_OPEN,
                'created_by' => \max(0, $createdBy),
                'updated_by' => \max(0, $createdBy),
                'created_at' => \current_time('mysql'),
                'updated_at' => \current_time('mysql'),
            ],
            ['%d', '%s', '%s', '%s', '%d', '%d', '%s', '%s']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    public function updateIssueStatus(int $issueId, string $status, int $updatedBy = 0): bool
    {
        if ($issueId <= 0 || !$this->issuesTableExists()) {
            return false;
        }

        $updated = $this->wpdb->update(
            $this->issuesTable(),
            [
                'status' => self::normalizeIssueStatus($status),
                'updated_by' => \max(0, $updatedBy),
                'updated_at' => \current_time('mysql'),
            ],
            ['id' => $issueId],
            ['%s', '%d', '%s'],
            ['%d']
        );

        return $updated !== false;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRecentHandoffs(int $limit = 20): array
    {
        if (!$this->handoffsTableExists()) {
            return [];
        }

        $limit = \max(1, \min(100, $limit));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    id,
                    shift_label,
                    notes,
                    dirty_count,
                    clean_count,
                    inspected_count,
                    out_of_order_count,
                    assigned_count,
                    open_issue_count,
                    created_by,
                    created_at
                FROM ' . $this->handoffsTable() . '
                ORDER BY created_at DESC, id DESC
                LIMIT %d',
                $limit
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @param array<string, int> $snapshot
     */
    public function createHandoff(string $shiftLabel, string $notes, array $snapshot, int $createdBy = 0): int
    {
        if (!$this->handoffsTableExists()) {
            return 0;
        }

        $inserted = $this->wpdb->insert(
            $this->handoffsTable(),
            [
                'shift_label' => \sanitize_text_field($shiftLabel),
                'notes' => \sanitize_textarea_field($notes),
                'dirty_count' => isset($snapshot['dirty_count']) ? (int) $snapshot['dirty_count'] : 0,
                'clean_count' => isset($snapshot['clean_count']) ? (int) $snapshot['clean_count'] : 0,
                'inspected_count' => isset($snapshot['inspected_count']) ? (int) $snapshot['inspected_count'] : 0,
                'out_of_order_count' => isset($snapshot['out_of_order_count']) ? (int) $snapshot['out_of_order_count'] : 0,
                'assigned_count' => isset($snapshot['assigned_count']) ? (int) $snapshot['assigned_count'] : 0,
                'open_issue_count' => isset($snapshot['open_issue_count']) ? (int) $snapshot['open_issue_count'] : 0,
                'created_by' => \max(0, $createdBy),
                'created_at' => \current_time('mysql'),
            ],
            ['%s', '%s', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%s']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    /**
     * @param array<string, mixed> $changes
     */
    private function upsertHousekeepingRow(int $inventoryRoomId, array $changes): bool
    {
        $existing = $this->getExistingHousekeepingRow($inventoryRoomId);

        if ($existing !== null) {
            $updated = $this->wpdb->update(
                $this->housekeepingTable(),
                $changes,
                ['inventory_room_id' => $inventoryRoomId],
                $this->getHousekeepingFormats($changes),
                ['%d']
            );

            return $updated !== false;
        }

        $payload = [
            'inventory_room_id' => $inventoryRoomId,
            'status' => self::STATUS_DIRTY,
            'assigned_to_user_id' => 0,
            'assigned_by_user_id' => 0,
            'assigned_at' => null,
            'updated_by' => 0,
            'updated_at' => \current_time('mysql'),
        ];

        foreach ($changes as $key => $value) {
            $payload[$key] = $value;
        }

        if (!isset($payload['updated_at']) || (string) $payload['updated_at'] === '') {
            $payload['updated_at'] = \current_time('mysql');
        }

        $inserted = $this->wpdb->insert(
            $this->housekeepingTable(),
            $payload,
            ['%d', '%s', '%d', '%d', '%s', '%d', '%s']
        );

        return $inserted !== false;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function getExistingHousekeepingRow(int $inventoryRoomId): ?array
    {
        if ($inventoryRoomId <= 0 || !$this->housekeepingTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT
                    inventory_room_id,
                    status,
                    assigned_to_user_id,
                    assigned_by_user_id,
                    assigned_at,
                    updated_by,
                    updated_at
                FROM ' . $this->housekeepingTable() . '
                WHERE inventory_room_id = %d
                LIMIT 1',
                $inventoryRoomId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $data
     * @return array<int, string>
     */
    private function getHousekeepingFormats(array $data): array
    {
        $formats = [];

        foreach (\array_keys($data) as $key) {
            if (\in_array($key, ['inventory_room_id', 'assigned_to_user_id', 'assigned_by_user_id', 'updated_by'], true)) {
                $formats[] = '%d';
                continue;
            }

            $formats[] = '%s';
        }

        return $formats;
    }
}
