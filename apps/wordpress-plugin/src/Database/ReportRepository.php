<?php

namespace MustHotelBooking\Database;

final class ReportRepository extends AbstractRepository
{
    private function inventoryRoomsTable(): string
    {
        return $this->wpdb->prefix . 'mhb_rooms';
    }

    private function inventoryRoomsTableExists(): bool
    {
        $tableName = $this->inventoryRoomsTable();
        $result = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SHOW TABLES LIKE %s',
                $tableName
            )
        );

        return \is_string($result) && $result !== '';
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<int, array<string, mixed>>
     */
    public function getReservationsCreatedInRange(array $filters): array
    {
        if (!$this->tableExists('reservations')) {
            return [];
        }

        $normalized = $this->normalizeFilters($filters);
        $params = [];
        $where = [
            'DATE(r.created_at) >= %s',
            'DATE(r.created_at) <= %s',
        ];
        $params[] = $normalized['date_from'];
        $params[] = $normalized['date_to'];

        if ($normalized['room_id'] > 0) {
            $where[] = '(r.room_id = %d OR r.room_type_id = %d)';
            $params[] = $normalized['room_id'];
            $params[] = $normalized['room_id'];
        }

        if ($normalized['reservation_status'] !== '') {
            $where[] = 'r.status = %s';
            $params[] = $normalized['reservation_status'];
        }

        $roomJoin = $this->tableExists('rooms')
            ? ' LEFT JOIN ' . $this->table('rooms') . ' rm ON rm.id = r.room_id'
            : '';
        $roomSelect = $this->tableExists('rooms')
            ? 'COALESCE(rm.name, \'\') AS room_name'
            : '\'\' AS room_name';

        $sql = 'SELECT
                r.id,
                r.booking_id,
                r.room_id,
                r.room_type_id,
                r.assigned_room_id,
                r.guest_id,
                r.checkin,
                r.checkout,
                r.guests,
                r.status,
                r.total_price,
                r.coupon_id,
                r.coupon_code,
                r.coupon_discount_total,
                r.payment_status,
                r.provider,
                r.provider_booking_id,
                r.provider_reservation_id,
                r.provider_status,
                r.provider_payment_status,
                r.provider_sync_status,
                r.provider_synced_at,
                r.provider_sync_error,
                r.provider_payload_ref,
                r.provider_metadata,
                r.created_at,
                ' . $roomSelect . '
            FROM ' . $this->table('reservations') . ' r
            ' . $roomJoin . '
            WHERE ' . \implode(' AND ', $where) . '
            ORDER BY r.created_at ASC, r.id ASC';

        $prepared = $this->wpdb->prepare($sql, ...$params);
        $rows = $this->wpdb->get_results($prepared, ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<int, array<string, mixed>>
     */
    public function getStayOverlapReservations(array $filters): array
    {
        if (!$this->tableExists('reservations')) {
            return [];
        }

        $normalized = $this->normalizeFilters($filters);
        $params = [];
        $where = [
            'r.checkin <= %s',
            'r.checkout > %s',
        ];
        $params[] = $normalized['date_to'];
        $params[] = $normalized['date_from'];

        if ($normalized['room_id'] > 0) {
            $where[] = '(r.room_id = %d OR r.room_type_id = %d)';
            $params[] = $normalized['room_id'];
            $params[] = $normalized['room_id'];
        }

        if ($normalized['reservation_status'] !== '') {
            $where[] = 'r.status = %s';
            $params[] = $normalized['reservation_status'];
        }

        $roomJoin = $this->tableExists('rooms')
            ? ' LEFT JOIN ' . $this->table('rooms') . ' rm ON rm.id = r.room_id'
            : '';
        $roomSelect = $this->tableExists('rooms')
            ? 'COALESCE(rm.name, \'\') AS room_name'
            : '\'\' AS room_name';

        $sql = 'SELECT
                r.id,
                r.booking_id,
                r.room_id,
                r.room_type_id,
                r.assigned_room_id,
                r.guest_id,
                r.checkin,
                r.checkout,
                r.guests,
                r.status,
                r.total_price,
                r.coupon_id,
                r.coupon_code,
                r.coupon_discount_total,
                r.payment_status,
                r.provider,
                r.provider_booking_id,
                r.provider_reservation_id,
                r.provider_status,
                r.provider_payment_status,
                r.provider_sync_status,
                r.provider_synced_at,
                r.provider_sync_error,
                r.provider_payload_ref,
                r.provider_metadata,
                r.created_at,
                ' . $roomSelect . '
            FROM ' . $this->table('reservations') . ' r
            ' . $roomJoin . '
            WHERE ' . \implode(' AND ', $where) . '
            ORDER BY r.checkin ASC, r.checkout ASC, r.id ASC';

        $prepared = $this->wpdb->prepare($sql, ...$params);
        $rows = $this->wpdb->get_results($prepared, ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }

    public function calculateAvailableInventoryNights(string $dateFrom, string $dateTo, int $roomId = 0): int
    {
        if (
            $dateFrom === '' ||
            $dateTo === '' ||
            $dateTo < $dateFrom ||
            !$this->inventoryRoomsTableExists()
        ) {
            return 0;
        }

        $params = ['available'];
        $where = [
            'status = %s',
            'is_active = 1',
            'is_bookable = 1',
        ];

        if ($roomId > 0) {
            $where[] = 'room_type_id = %d';
            $params[] = $roomId;
        }

        $inventoryRows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    room_type_id,
                    COUNT(*) AS available_units
                FROM ' . $this->inventoryRoomsTable() . '
                WHERE ' . \implode(' AND ', $where) . '
                GROUP BY room_type_id
                ORDER BY room_type_id ASC',
                ...$params
            ),
            ARRAY_A
        );

        if (!\is_array($inventoryRows) || empty($inventoryRows)) {
            return 0;
        }

        $unitsByRoomType = [];

        foreach ($inventoryRows as $inventoryRow) {
            if (!\is_array($inventoryRow)) {
                continue;
            }

            $roomTypeId = isset($inventoryRow['room_type_id']) ? (int) $inventoryRow['room_type_id'] : 0;
            $unitCount = isset($inventoryRow['available_units']) ? (int) $inventoryRow['available_units'] : 0;

            if ($roomTypeId > 0 && $unitCount > 0) {
                $unitsByRoomType[$roomTypeId] = $unitCount;
            }
        }

        if (empty($unitsByRoomType)) {
            return 0;
        }

        // Occupancy capacity should only remove nights that are not sellable at all.
        // Closed-arrival / closed-departure rules still permit occupied stays across the date,
        // so only maintenance blocks are removed from the denominator here.
        $maintenanceBlocks = $this->getMaintenanceBlockMap(\array_keys($unitsByRoomType), $dateFrom, $dateTo);
        $availableNights = 0;
        $cursor = new \DateTimeImmutable($dateFrom);
        $endExclusive = (new \DateTimeImmutable($dateTo))->modify('+1 day');

        while ($cursor < $endExclusive) {
            $dateKey = $cursor->format('Y-m-d');
            $globalMaintenance = !empty($maintenanceBlocks[0][$dateKey]);

            foreach ($unitsByRoomType as $roomTypeId => $unitCount) {
                if ($globalMaintenance || !empty($maintenanceBlocks[$roomTypeId][$dateKey])) {
                    continue;
                }

                $availableNights += $unitCount;
            }

            $cursor = $cursor->modify('+1 day');
        }

        return $availableNights;
    }

    public function countAvailableInventoryUnits(int $roomId = 0): int
    {
        if ($this->inventoryRoomsTableExists()) {
            if ($roomId > 0) {
                $count = $this->wpdb->get_var(
                    $this->wpdb->prepare(
                        'SELECT COUNT(*)
                        FROM ' . $this->inventoryRoomsTable() . '
                        WHERE room_type_id = %d
                            AND is_active = 1
                            AND is_bookable = 1',
                        $roomId
                    )
                );

                return $count !== null ? (int) $count : 0;
            }

            $count = $this->wpdb->get_var(
                'SELECT COUNT(*)
                FROM ' . $this->inventoryRoomsTable() . '
                WHERE is_active = 1
                    AND is_bookable = 1'
            );

            return $count !== null ? (int) $count : 0;
        }

        if (!$this->tableExists('rooms')) {
            return 0;
        }

        if ($roomId > 0) {
            $count = $this->wpdb->get_var(
                $this->wpdb->prepare(
                    'SELECT COUNT(*)
                    FROM ' . $this->table('rooms') . '
                    WHERE id = %d
                        AND is_active = 1
                        AND is_bookable = 1',
                    $roomId
                )
            );

            return $count !== null ? (int) $count : 0;
        }

        $count = $this->wpdb->get_var(
            'SELECT COUNT(*)
            FROM ' . $this->table('rooms') . '
            WHERE is_active = 1
                AND is_bookable = 1'
        );

        return $count !== null ? (int) $count : 0;
    }

    /**
     * @param array<int, int> $roomIds
     * @return array<int, array<string, bool>>
     */
    private function getMaintenanceBlockMap(array $roomIds, string $dateFrom, string $dateTo): array
    {
        $map = [];
        $roomIds = $this->normalizeIds($roomIds);

        if (empty($roomIds) || !$this->tableExists('availability')) {
            return $map;
        }

        $params = [
            'maintenance_block',
            $dateTo,
            '',
            $dateFrom,
        ];
        $roomFilterSql = 'room_id = 0';

        if (!empty($roomIds)) {
            $roomFilterSql .= ' OR room_id IN (' . $this->buildIntegerPlaceholders($roomIds) . ')';
            $params = \array_merge($params, $roomIds);
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    room_id,
                    availability_date,
                    end_date
                FROM ' . $this->table('availability') . '
                WHERE rule_type = %s
                    AND is_active = 1
                    AND availability_date <= %s
                    AND (end_date IS NULL OR end_date = %s OR end_date >= %s)
                    AND (' . $roomFilterSql . ')
                ORDER BY room_id ASC, availability_date ASC, id ASC',
                ...$params
            ),
            ARRAY_A
        );

        if (!\is_array($rows)) {
            return $map;
        }

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $ruleRoomId = isset($row['room_id']) ? (int) $row['room_id'] : 0;
            $startDate = isset($row['availability_date']) ? (string) $row['availability_date'] : '';
            $endDate = isset($row['end_date']) && (string) $row['end_date'] !== ''
                ? (string) $row['end_date']
                : $startDate;

            if ($startDate === '' || $endDate === '') {
                continue;
            }

            $cursor = new \DateTimeImmutable($startDate > $dateFrom ? $startDate : $dateFrom);
            $endInclusive = new \DateTimeImmutable($endDate < $dateTo ? $endDate : $dateTo);

            while ($cursor <= $endInclusive) {
                $map[$ruleRoomId][$cursor->format('Y-m-d')] = true;
                $cursor = $cursor->modify('+1 day');
            }
        }

        return $map;
    }

    public function countPaymentsLinkedToMissingReservations(): int
    {
        if (!$this->tableExists('payments') || !$this->tableExists('reservations')) {
            return 0;
        }

        $count = $this->wpdb->get_var(
            'SELECT COUNT(*)
            FROM ' . $this->table('payments') . ' p
            LEFT JOIN ' . $this->table('reservations') . ' r ON r.id = p.reservation_id
            WHERE p.reservation_id > 0
                AND r.id IS NULL'
        );

        return $count !== null ? (int) $count : 0;
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $filters): array
    {
        $dateFrom = isset($filters['date_from']) ? \sanitize_text_field((string) $filters['date_from']) : '';
        $dateTo = isset($filters['date_to']) ? \sanitize_text_field((string) $filters['date_to']) : '';

        if (!\preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom)) {
            $dateFrom = \current_time('Y-m-01');
        }

        if (!\preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo)) {
            $dateTo = \current_time('Y-m-d');
        }

        if ($dateFrom > $dateTo) {
            $swap = $dateFrom;
            $dateFrom = $dateTo;
            $dateTo = $swap;
        }

        return [
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'room_id' => isset($filters['room_id']) ? \absint($filters['room_id']) : 0,
            'reservation_status' => isset($filters['reservation_status']) ? \sanitize_key((string) $filters['reservation_status']) : '',
        ];
    }
}
