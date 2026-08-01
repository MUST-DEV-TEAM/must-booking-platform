<?php

namespace MustHotelBooking\Database;

/**
 * Authoritative repository for sellable room/listing records stored in must_rooms.
 *
 * In the current plugin version, must_rooms is the source of truth for
 * room/listing content and the IDs used across pricing, availability,
 * reservations, and admin flows. mhb_room_types is only a derived mirror used
 * by internal inventory/rate-plan structures.
 */
final class RoomRepository extends AbstractRepository
{
    public function getRoomsTableName(): string
    {
        return $this->table('rooms');
    }

    public function getRoomMetaTableName(): string
    {
        return $this->table('room_meta');
    }

    public function roomsTableExists(): bool
    {
        return $this->tableExists('rooms');
    }

    public function roomMetaTableExists(): bool
    {
        return $this->tableExists('room_meta');
    }

    private function inventoryLockTable(): string
    {
        return $this->wpdb->prefix . 'mhb_inventory_locks';
    }

    private function inventoryLockTableExists(): bool
    {
        $tableName = $this->inventoryLockTable();
        $result = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SHOW TABLES LIKE %s',
                $tableName
            )
        );

        return \is_string($result) && $result !== '';
    }

    private function lockTableName(): string
    {
        if ($this->inventoryLockTableExists()) {
            return $this->inventoryLockTable();
        }

        return $this->table('locks');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getRoomById(int $roomId): ?array
    {
        if ($roomId <= 0) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT *
                FROM ' . $this->table('rooms') . '
                WHERE id = %d
                LIMIT 1',
                $roomId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @param array<int, int> $roomIds
     * @return array<int, array<string, mixed>>
     */
    public function getRoomsByIds(array $roomIds): array
    {
        $roomIds = $this->normalizeIds($roomIds);

        if (empty($roomIds) || !$this->roomsTableExists()) {
            return [];
        }

        $sql = \sprintf(
            'SELECT id, name, slug, category, description, is_active, is_bookable, is_online_bookable, sort_order, max_guests, base_price, room_size, beds
            FROM %s
            WHERE id IN (%s)
            ORDER BY sort_order ASC, name ASC, id ASC',
            $this->getRoomsTableName(),
            $this->buildIntegerPlaceholders($roomIds)
        );

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare($sql, $roomIds),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRoomSelectorRows(bool $includeInactive = true, bool $onlyBookable = false): array
    {
        if (!$this->roomsTableExists()) {
            return [];
        }

        $where = [];

        if (!$includeInactive) {
            $where[] = 'is_active = 1';
        }

        if ($onlyBookable) {
            $where[] = 'is_bookable = 1';
        }

        $sql = 'SELECT id, name, category, is_active, is_bookable
            FROM ' . $this->getRoomsTableName();

        if (!empty($where)) {
            $sql .= ' WHERE ' . \implode(' AND ', $where);
        }

        $sql .= '
            ORDER BY sort_order ASC, name ASC, id ASC';

        $rows = $this->wpdb->get_results(
            $sql,
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRoomsForTextGrid(int $limit = 0): array
    {
        if (!$this->roomsTableExists()) {
            return [];
        }

        $limit = $limit > 0 ? \max(1, \min(200, $limit)) : 0;
        $sql = 'SELECT id, name, slug, category, description, is_active, is_bookable, is_online_bookable, sort_order
            FROM ' . $this->getRoomsTableName() . '
            WHERE is_active = 1
            ORDER BY sort_order ASC, name ASC, id ASC';

        if ($limit > 0) {
            $sql = $this->wpdb->prepare(
                $sql . '
                LIMIT %d',
                $limit
            );
        }

        $rows = $this->wpdb->get_results(
            $sql,
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getRoomBySlug(string $slug): ?array
    {
        $slug = \sanitize_title($slug);

        if ($slug === '') {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT *
                FROM ' . $this->table('rooms') . '
                WHERE slug = %s
                LIMIT 1',
                $slug
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    public function roomSlugExists(string $slug, int $excludeRoomId = 0): bool
    {
        $slug = \sanitize_title($slug);

        if ($slug === '' || !$this->roomsTableExists()) {
            return false;
        }

        if ($excludeRoomId > 0) {
            $count = (int) $this->wpdb->get_var(
                $this->wpdb->prepare(
                    'SELECT COUNT(*)
                    FROM ' . $this->getRoomsTableName() . '
                    WHERE slug = %s
                        AND id <> %d',
                    $slug,
                    $excludeRoomId
                )
            );
        } else {
            $count = (int) $this->wpdb->get_var(
                $this->wpdb->prepare(
                    'SELECT COUNT(*)
                    FROM ' . $this->getRoomsTableName() . '
                    WHERE slug = %s',
                    $slug
                )
            );
        }

        return $count > 0;
    }

    /**
     * @param array<string, mixed> $roomData
     */
    public function createRoom(array $roomData): int
    {
        if (!$this->roomsTableExists()) {
            return 0;
        }

        $inserted = $this->wpdb->insert(
            $this->getRoomsTableName(),
            [
                'name' => (string) ($roomData['name'] ?? ''),
                'slug' => (string) ($roomData['slug'] ?? ''),
                'category' => (string) ($roomData['category'] ?? ''),
                'description' => (string) ($roomData['description'] ?? ''),
                'internal_code' => (string) ($roomData['internal_code'] ?? ''),
                'is_active' => !empty($roomData['is_active']) ? 1 : 0,
                'is_bookable' => !empty($roomData['is_bookable']) ? 1 : 0,
                'is_online_bookable' => !empty($roomData['is_online_bookable']) ? 1 : 0,
                'is_calendar_visible' => !empty($roomData['is_calendar_visible']) ? 1 : 0,
                'sort_order' => (int) ($roomData['sort_order'] ?? 0),
                'max_adults' => (int) ($roomData['max_adults'] ?? 1),
                'max_children' => (int) ($roomData['max_children'] ?? 0),
                'max_guests' => (int) ($roomData['max_guests'] ?? 1),
                'default_occupancy' => (int) ($roomData['default_occupancy'] ?? 1),
                'base_price' => (float) ($roomData['base_price'] ?? 0.0),
                'extra_guest_price' => (float) ($roomData['extra_guest_price'] ?? 0.0),
                'room_size' => (string) ($roomData['room_size'] ?? ''),
                'beds' => (string) ($roomData['beds'] ?? ''),
                'admin_notes' => (string) ($roomData['admin_notes'] ?? ''),
                'created_at' => isset($roomData['created_at']) ? (string) $roomData['created_at'] : \current_time('mysql'),
            ],
            ['%s', '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%f', '%f', '%s', '%s', '%s', '%s']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    /**
     * @param array<string, mixed> $roomData
     */
    public function updateRoom(int $roomId, array $roomData): bool
    {
        if ($roomId <= 0 || !$this->roomsTableExists()) {
            return false;
        }

        $updated = $this->wpdb->update(
            $this->getRoomsTableName(),
            [
                'name' => (string) ($roomData['name'] ?? ''),
                'slug' => (string) ($roomData['slug'] ?? ''),
                'category' => (string) ($roomData['category'] ?? ''),
                'description' => (string) ($roomData['description'] ?? ''),
                'internal_code' => (string) ($roomData['internal_code'] ?? ''),
                'is_active' => !empty($roomData['is_active']) ? 1 : 0,
                'is_bookable' => !empty($roomData['is_bookable']) ? 1 : 0,
                'is_online_bookable' => !empty($roomData['is_online_bookable']) ? 1 : 0,
                'is_calendar_visible' => !empty($roomData['is_calendar_visible']) ? 1 : 0,
                'sort_order' => (int) ($roomData['sort_order'] ?? 0),
                'max_adults' => (int) ($roomData['max_adults'] ?? 1),
                'max_children' => (int) ($roomData['max_children'] ?? 0),
                'max_guests' => (int) ($roomData['max_guests'] ?? 1),
                'default_occupancy' => (int) ($roomData['default_occupancy'] ?? 1),
                'base_price' => (float) ($roomData['base_price'] ?? 0.0),
                'extra_guest_price' => (float) ($roomData['extra_guest_price'] ?? 0.0),
                'room_size' => (string) ($roomData['room_size'] ?? ''),
                'beds' => (string) ($roomData['beds'] ?? ''),
                'admin_notes' => (string) ($roomData['admin_notes'] ?? ''),
            ],
            ['id' => $roomId],
            ['%s', '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%d', '%f', '%f', '%s', '%s', '%s'],
            ['%d']
        );

        return $updated !== false;
    }

    /**
     * @param array<int, string> $amenityKeys
     * @param array<int, int> $galleryIds
     */
    public function saveRoomMeta(
        int $roomId,
        int $mainImageId,
        string $roomRules,
        string $amenitiesIntro,
        array $amenityKeys,
        array $galleryIds
    ): bool {
        if ($roomId <= 0 || !$this->tableExists('room_meta')) {
            return false;
        }

        $metaTable = $this->getRoomMetaTableName();
        $deleted = $this->wpdb->query(
            $this->wpdb->prepare(
                "DELETE FROM {$metaTable}
                WHERE room_id = %d
                    AND meta_key IN ('main_image_id', 'room_rules', 'amenities_intro', 'amenity', 'gallery_image_id')",
                $roomId
            )
        );

        if ($deleted === false) {
            return false;
        }

        if ($mainImageId > 0 && !$this->insertRoomMetaRow($roomId, 'main_image_id', (string) $mainImageId)) {
            return false;
        }

        if ($roomRules !== '' && !$this->insertRoomMetaRow($roomId, 'room_rules', $roomRules)) {
            return false;
        }

        if ($amenitiesIntro !== '' && !$this->insertRoomMetaRow($roomId, 'amenities_intro', $amenitiesIntro)) {
            return false;
        }

        foreach ($amenityKeys as $amenityKey) {
            if (!$this->insertRoomMetaRow($roomId, 'amenity', (string) $amenityKey)) {
                return false;
            }
        }

        foreach ($galleryIds as $galleryId) {
            $galleryId = (int) $galleryId;

            if ($galleryId <= 0 || $galleryId === $mainImageId) {
                continue;
            }

            if (!$this->insertRoomMetaRow($roomId, 'gallery_image_id', (string) $galleryId)) {
                return false;
            }
        }

        return true;
    }

    public function deleteRoom(int $roomId): bool
    {
        if ($roomId <= 0 || !$this->roomsTableExists()) {
            return false;
        }

        if (!$this->canDeleteRoom($roomId)) {
            return false;
        }

        $deleted = $this->wpdb->delete(
            $this->getRoomsTableName(),
            ['id' => $roomId],
            ['%d']
        );

        if ($deleted === false) {
            return false;
        }

        if ($this->tableExists('room_meta')) {
            $this->wpdb->delete(
                $this->getRoomMetaTableName(),
                ['room_id' => $roomId],
                ['%d']
            );
        }

        return true;
    }

    /**
     * @return array<string, int|array<int, string>>
     */
    public function getRoomDeletionGuardSummary(int $roomId): array
    {
        if ($roomId <= 0) {
            return [
                'inventory_units' => 0,
                'rate_plan_assignments' => 0,
                'pricing_rules' => 0,
                'availability_rules' => 0,
                'reservations' => 0,
                'blockers' => [],
            ];
        }

        $inventoryRepository = new InventoryRepository();
        $ratePlanRepository = new RatePlanRepository();
        $pricingRuleRepository = new PricingRuleRepository();
        $availabilityRepository = new AvailabilityRepository();
        $reservationRepository = new ReservationRepository();

        $inventorySummaryRows = $inventoryRepository->getRoomTypeInventorySummaries([$roomId]);
        $inventorySummary = \is_array($inventorySummaryRows) && isset($inventorySummaryRows[0]) && \is_array($inventorySummaryRows[0])
            ? $inventorySummaryRows[0]
            : [];
        $ratePlanSummary = $ratePlanRepository->getRoomTypeRatePlanSummaryMap([$roomId])[$roomId] ?? [];
        $pricingSummary = $pricingRuleRepository->getRoomPricingRuleSummaryMap([$roomId])[$roomId] ?? [];
        $availabilitySummary = $availabilityRepository->getRoomAvailabilityRuleSummaryMap([$roomId])[$roomId] ?? [];
        $reservationSummary = $reservationRepository->getAccommodationReservationSummaryMap([$roomId], \current_time('Y-m-d'))[$roomId] ?? [];

        $inventoryUnits = isset($inventorySummary['total_units']) ? (int) $inventorySummary['total_units'] : 0;
        $ratePlanAssignments = isset($ratePlanSummary['assignment_count']) ? (int) $ratePlanSummary['assignment_count'] : 0;
        $pricingRules = isset($pricingSummary['rule_count']) ? (int) $pricingSummary['rule_count'] : 0;
        $availabilityRules = isset($availabilitySummary['rule_count']) ? (int) $availabilitySummary['rule_count'] : 0;
        $reservations = isset($reservationSummary['reservation_count']) ? (int) $reservationSummary['reservation_count'] : 0;
        $blockers = [];

        if ($inventoryUnits > 0) {
            $blockers[] = 'inventory_units';
        }

        if ($ratePlanAssignments > 0) {
            $blockers[] = 'rate_plan_assignments';
        }

        if ($pricingRules > 0) {
            $blockers[] = 'pricing_rules';
        }

        if ($availabilityRules > 0) {
            $blockers[] = 'availability_rules';
        }

        if ($reservations > 0) {
            $blockers[] = 'reservations';
        }

        return [
            'inventory_units' => $inventoryUnits,
            'rate_plan_assignments' => $ratePlanAssignments,
            'pricing_rules' => $pricingRules,
            'availability_rules' => $availabilityRules,
            'reservations' => $reservations,
            'blockers' => $blockers,
        ];
    }

    public function canDeleteRoom(int $roomId): bool
    {
        $summary = $this->getRoomDeletionGuardSummary($roomId);
        $blockers = isset($summary['blockers']) && \is_array($summary['blockers']) ? $summary['blockers'] : [];

        return empty($blockers);
    }

    public function countRooms(): int
    {
        if (!$this->roomsTableExists()) {
            return 0;
        }

        return (int) $this->wpdb->get_var(
            'SELECT COUNT(*) FROM ' . $this->getRoomsTableName()
        );
    }

    /**
     * @return array<string, array<string, int>>
     */
    public function getCategoryUsageSummaryMap(): array
    {
        if (!$this->roomsTableExists()) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            'SELECT
                category,
                COUNT(*) AS room_count,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_room_count,
                SUM(CASE WHEN is_bookable = 1 THEN 1 ELSE 0 END) AS bookable_room_count
            FROM ' . $this->getRoomsTableName() . '
            WHERE category <> \'\'
            GROUP BY category
            ORDER BY category ASC',
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

            $category = \sanitize_key((string) ($row['category'] ?? ''));

            if ($category === '') {
                continue;
            }

            $summary[$category] = [
                'room_count' => isset($row['room_count']) ? (int) $row['room_count'] : 0,
                'active_room_count' => isset($row['active_room_count']) ? (int) $row['active_room_count'] : 0,
                'bookable_room_count' => isset($row['bookable_room_count']) ? (int) $row['bookable_room_count'] : 0,
            ];
        }

        return $summary;
    }

    public function countRoomsForCategory(string $categorySlug): int
    {
        $categorySlug = \sanitize_key($categorySlug);

        if ($categorySlug === '' || !$this->roomsTableExists()) {
            return 0;
        }

        return (int) $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT COUNT(*)
                FROM ' . $this->getRoomsTableName() . '
                WHERE category = %s',
                $categorySlug
            )
        );
    }

    public function countRoomsMissingBasePrice(): int
    {
        if (!$this->roomsTableExists()) {
            return 0;
        }

        return (int) $this->wpdb->get_var(
            'SELECT COUNT(*)
            FROM ' . $this->getRoomsTableName() . '
            WHERE base_price <= 0'
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRoomsMissingBasePrice(int $limit = 5): array
    {
        if (!$this->roomsTableExists()) {
            return [];
        }

        $limit = \max(1, \min(20, $limit));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT id, name, category, base_price
                FROM ' . $this->getRoomsTableName() . '
                WHERE base_price <= 0
                ORDER BY created_at DESC, id DESC
                LIMIT %d',
                $limit
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRoomsByType(string $category, int $guests = 1): array
    {
        $normalizedCategory = \sanitize_key($category);

        if ($normalizedCategory === 'all') {
            $rows = $this->wpdb->get_results(
                $this->wpdb->prepare(
                    'SELECT id, name, slug, category, description, max_guests, base_price, room_size, beds
                    FROM ' . $this->table('rooms') . '
                    WHERE max_guests >= %d
                    ORDER BY id ASC',
                    \max(1, $guests)
                ),
                ARRAY_A
            );
        } else {
            $rows = $this->wpdb->get_results(
                $this->wpdb->prepare(
                    'SELECT id, name, slug, category, description, max_guests, base_price, room_size, beds
                    FROM ' . $this->table('rooms') . '
                    WHERE category = %s
                        AND max_guests >= %d
                    ORDER BY id ASC',
                    $normalizedCategory,
                    \max(1, $guests)
                ),
                ARRAY_A
            );
        }

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRoomsListRows(): array
    {
        $rows = $this->wpdb->get_results(
            'SELECT
                id,
                name,
                slug,
                category,
                description,
                internal_code,
                is_active,
                is_bookable,
                is_online_bookable,
                is_calendar_visible,
                sort_order,
                max_adults,
                max_children,
                max_guests,
                default_occupancy,
                base_price,
                extra_guest_price,
                room_size,
                beds,
                admin_notes,
                created_at
            FROM ' . $this->getRoomsTableName() . '
            ORDER BY sort_order ASC, name ASC, id ASC',
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getAccommodationAdminRows(): array
    {
        return $this->getRoomsListRows();
    }

    private function insertRoomMetaRow(int $roomId, string $metaKey, string $metaValue): bool
    {
        return $this->wpdb->insert(
            $this->getRoomMetaTableName(),
            [
                'room_id' => $roomId,
                'meta_key' => $metaKey,
                'meta_value' => $metaValue,
            ],
            ['%d', '%s', '%s']
        ) !== false;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRoomsForDisplay(string $category = 'all', int $limit = 50): array
    {
        $limit = \max(1, \min(200, $limit));
        $table = $this->getRoomsTableName();
        $categorySlug = \sanitize_key($category);

        if ($categorySlug !== '' && $categorySlug !== 'all') {
            $sql = $this->wpdb->prepare(
                "SELECT id, name, slug, category, description, max_guests, base_price, room_size, beds
                FROM {$table}
                WHERE category = %s
                ORDER BY created_at DESC, id DESC
                LIMIT %d",
                $categorySlug,
                $limit
            );
        } else {
            $sql = $this->wpdb->prepare(
                "SELECT id, name, slug, category, description, max_guests, base_price, room_size, beds
                FROM {$table}
                ORDER BY created_at DESC, id DESC
                LIMIT %d",
                $limit
            );
        }

        $rows = $this->wpdb->get_results($sql, ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }

    public function getRoomMetaTextValue(int $roomId, string $metaKey): string
    {
        if ($roomId <= 0 || $metaKey === '') {
            return '';
        }

        $value = $this->wpdb->get_var(
            $this->wpdb->prepare(
                "SELECT meta_value
                FROM " . $this->getRoomMetaTableName() . "
                WHERE room_id = %d AND meta_key = %s
                LIMIT 1",
                $roomId,
                $metaKey
            )
        );

        return \is_string($value) ? $value : '';
    }

    /**
     * @return array<int, string>
     */
    public function getRoomAmenities(int $roomId): array
    {
        $rows = $this->wpdb->get_col(
            $this->wpdb->prepare(
                "SELECT meta_value
                FROM " . $this->getRoomMetaTableName() . "
                WHERE room_id = %d AND meta_key = 'amenity'",
                $roomId
            )
        );

        if (!\is_array($rows)) {
            return [];
        }

        return \array_values(
            \array_filter(
                \array_map(
                    static function ($value): string {
                        return \trim((string) $value);
                    },
                    $rows
                )
            )
        );
    }

    /**
     * @return array<int, int>
     */
    public function getRoomGalleryImageIds(int $roomId): array
    {
        $rows = $this->wpdb->get_col(
            $this->wpdb->prepare(
                "SELECT meta_value
                FROM " . $this->getRoomMetaTableName() . "
                WHERE room_id = %d AND meta_key = 'gallery_image_id'",
                $roomId
            )
        );

        if (!\is_array($rows)) {
            return [];
        }

        $ids = [];

        foreach ($rows as $value) {
            $id = \absint($value);

            if ($id > 0) {
                $ids[$id] = $id;
            }
        }

        return \array_values($ids);
    }

    public function getRoomMainImageId(int $roomId): int
    {
        $value = $this->wpdb->get_var(
            $this->wpdb->prepare(
                "SELECT meta_value
                FROM " . $this->getRoomMetaTableName() . "
                WHERE room_id = %d AND meta_key = 'main_image_id'
                LIMIT 1",
                $roomId
            )
        );

        return \absint($value);
    }

    /**
     * @param array<int, string> $nonBlockingStatuses
     * @return array<int, array<string, mixed>>
     */
    public function getAvailableRooms(
        string $checkin,
        string $checkout,
        int $guests,
        string $category,
        array $nonBlockingStatuses,
        string $now,
        string $sessionId = ''
    ): array {
        $statuses = $this->normalizeNonBlockingStatuses($nonBlockingStatuses);
        $roomsTable = $this->table('rooms');
        $reservationsTable = $this->table('reservations');
        $locksTable = $this->lockTableName();
        $normalizedCategory = \sanitize_key($category);
        $categoryFilterSql = $normalizedCategory === 'all' ? '' : 'r.category = %s AND ';

        if ($sessionId !== '') {
            $sqlTemplate = "SELECT r.*
                FROM {$roomsTable} r
                WHERE {$categoryFilterSql}r.max_guests >= %d
                    AND NOT EXISTS (
                        SELECT 1
                        FROM {$reservationsTable} res
                        WHERE res.room_id = r.id
                            AND res.checkin < %s
                            AND res.checkout > %s
                            AND res.status NOT IN (%s, %s, %s)
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM {$locksTable} l
                        WHERE l.room_id = r.id
                            AND l.checkin < %s
                            AND l.checkout > %s
                            AND l.expires_at > %s
                            AND l.session_id <> %s
                    )
                ORDER BY r.id ASC";

            $sql = $normalizedCategory === 'all'
                ? $this->wpdb->prepare(
                    $sqlTemplate,
                    \max(1, $guests),
                    $checkout,
                    $checkin,
                    $statuses[0],
                    $statuses[1],
                    $statuses[2],
                    $checkout,
                    $checkin,
                    $now,
                    $sessionId
                )
                : $this->wpdb->prepare(
                    $sqlTemplate,
                    $normalizedCategory,
                    \max(1, $guests),
                    $checkout,
                    $checkin,
                    $statuses[0],
                    $statuses[1],
                    $statuses[2],
                    $checkout,
                    $checkin,
                    $now,
                    $sessionId
                );
        } else {
            $sqlTemplate = "SELECT r.*
                FROM {$roomsTable} r
                WHERE {$categoryFilterSql}r.max_guests >= %d
                    AND NOT EXISTS (
                        SELECT 1
                        FROM {$reservationsTable} res
                        WHERE res.room_id = r.id
                            AND res.checkin < %s
                            AND res.checkout > %s
                            AND res.status NOT IN (%s, %s, %s)
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM {$locksTable} l
                        WHERE l.room_id = r.id
                            AND l.checkin < %s
                            AND l.checkout > %s
                            AND l.expires_at > %s
                    )
                ORDER BY r.id ASC";

            $sql = $normalizedCategory === 'all'
                ? $this->wpdb->prepare(
                    $sqlTemplate,
                    \max(1, $guests),
                    $checkout,
                    $checkin,
                    $statuses[0],
                    $statuses[1],
                    $statuses[2],
                    $checkout,
                    $checkin,
                    $now
                )
                : $this->wpdb->prepare(
                    $sqlTemplate,
                    $normalizedCategory,
                    \max(1, $guests),
                    $checkout,
                    $checkin,
                    $statuses[0],
                    $statuses[1],
                    $statuses[2],
                    $checkout,
                    $checkin,
                    $now
                );
        }

        $rows = $this->wpdb->get_results($sql, ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRandomRoomsByType(string $category, int $excludeRoomId = 0, int $limit = 3): array
    {
        if ($excludeRoomId <= 0 || $category === '') {
            return [];
        }

        $limit = \max(1, \min(6, $limit));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT id, name, slug, category, description, max_guests, room_size
                FROM ' . $this->table('rooms') . '
                WHERE category = %s
                    AND id <> %d
                ORDER BY RAND()
                LIMIT %d',
                \sanitize_key($category),
                $excludeRoomId,
                $limit
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, int>
     */
    public function getRoomCategoryCapacityMap(): array
    {
        $rows = $this->wpdb->get_results(
            'SELECT category, MAX(max_guests) AS max_guests FROM ' . $this->table('rooms') . ' GROUP BY category',
            ARRAY_A
        );
        $capacityMap = [];

        if (!\is_array($rows)) {
            return $capacityMap;
        }

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $category = \sanitize_key((string) ($row['category'] ?? ''));
            $maxGuests = isset($row['max_guests']) ? \max(1, (int) $row['max_guests']) : 1;

            if ($category !== '') {
                $capacityMap[$category] = $maxGuests;
            }
        }

        return $capacityMap;
    }

    /**
     * @return array<int, int>
     */
    public function getRoomIdsByTypeAndGuests(string $category, int $guests): array
    {
        $normalizedCategory = \sanitize_key($category);

        if ($normalizedCategory === 'all') {
            $rows = $this->wpdb->get_col(
                $this->wpdb->prepare(
                    'SELECT id
                    FROM ' . $this->table('rooms') . '
                    WHERE max_guests >= %d
                    ORDER BY id ASC',
                    \max(1, $guests)
                )
            );
        } else {
            $rows = $this->wpdb->get_col(
                $this->wpdb->prepare(
                    'SELECT id
                    FROM ' . $this->table('rooms') . '
                    WHERE category = %s
                        AND max_guests >= %d
                    ORDER BY id ASC',
                    $normalizedCategory,
                    \max(1, $guests)
                )
            );
        }

        return $this->normalizeIds(\is_array($rows) ? $rows : []);
    }

    /**
     * @param array<int, int> $roomIds
     * @return array<int, int>
     */
    public function getRoomCapacityMap(array $roomIds): array
    {
        $roomIds = $this->normalizeIds($roomIds);

        if (empty($roomIds)) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            'SELECT id, max_guests FROM ' . $this->table('rooms') . ' WHERE id IN (' . \implode(',', $roomIds) . ')',
            ARRAY_A
        );
        $capacityMap = [];

        if (!\is_array($rows)) {
            return $capacityMap;
        }

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $roomId = isset($row['id']) ? (int) $row['id'] : 0;
            $maxGuests = isset($row['max_guests']) ? \max(1, (int) $row['max_guests']) : 1;

            if ($roomId > 0) {
                $capacityMap[$roomId] = $maxGuests;
            }
        }

        return $capacityMap;
    }

    /**
     * @return array<string, int|float>|null
     */
    public function getRoomPricingContext(int $roomId): ?array
    {
        if ($roomId <= 0) {
            return null;
        }

        $room = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT *
                FROM ' . $this->table('rooms') . '
                WHERE id = %d
                LIMIT 1',
                $roomId
            ),
            ARRAY_A
        );

        if (!\is_array($room)) {
            return null;
        }

        $metaRows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT meta_key, meta_value
                FROM ' . $this->table('room_meta') . '
                WHERE room_id = %d
                    AND meta_key IN (\'base_capacity\')',
                $roomId
            ),
            ARRAY_A
        );

        $baseCapacity = isset($room['max_guests']) ? (int) $room['max_guests'] : 1;

        if (\is_array($metaRows)) {
            foreach ($metaRows as $metaRow) {
                if (!\is_array($metaRow) || !isset($metaRow['meta_key'])) {
                    continue;
                }

                if ((string) $metaRow['meta_key'] === 'base_capacity') {
                    $parsedCapacity = (int) ($metaRow['meta_value'] ?? 0);

                    if ($parsedCapacity > 0) {
                        $baseCapacity = $parsedCapacity;
                    }
                }
            }
        }

        if ($baseCapacity <= 0) {
            $baseCapacity = 1;
        }

        return [
            'room_id' => (int) $room['id'],
            'room_base_price' => (float) $room['base_price'],
            'base_capacity' => $baseCapacity,
            'extra_guest_price' => 0.0,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getApplicableSeasonalPricingRules(int $roomId, string $checkin, string $checkout, int $nights): array
    {
        if ($roomId <= 0 || $nights <= 0) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    id,
                    name,
                    room_id,
                    start_date,
                    end_date,
                    price_override,
                    weekend_price,
                    minimum_nights,
                    priority,
                    is_active
                FROM ' . $this->table('pricing') . '
                WHERE start_date < %s
                    AND end_date >= %s
                    AND minimum_nights <= %d
                    AND is_active = 1
                    AND (room_id = 0 OR room_id = %d)
                ORDER BY room_id DESC, priority DESC, minimum_nights DESC, start_date DESC, end_date ASC, id DESC',
                $checkout,
                $checkin,
                $nights,
                $roomId
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }
}
