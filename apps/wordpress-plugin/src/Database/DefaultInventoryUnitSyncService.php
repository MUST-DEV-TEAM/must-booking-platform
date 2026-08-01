<?php

namespace MustHotelBooking\Database;

final class DefaultInventoryUnitSyncService
{
    private const SYNC_OPTION = 'must_hotel_booking_default_inventory_unit_sync_marker';
    private const SYNC_MARKER = 'default_inventory_units_v1';

    /** @var RoomRepository */
    private $roomRepository;

    /** @var InventoryRepository */
    private $inventoryRepository;

    public function __construct(?RoomRepository $roomRepository = null, ?InventoryRepository $inventoryRepository = null)
    {
        $this->roomRepository = $roomRepository instanceof RoomRepository ? $roomRepository : new RoomRepository();
        $this->inventoryRepository = $inventoryRepository instanceof InventoryRepository ? $inventoryRepository : new InventoryRepository();
    }

    public function maybeRunBackfill(): void
    {
        $marker = (string) \get_option(self::SYNC_OPTION, '');

        if ($marker === self::SYNC_MARKER) {
            return;
        }

        $this->syncAllRoomListings();
        \update_option(self::SYNC_OPTION, self::SYNC_MARKER, false);
    }

    /**
     * @return array{processed:int,created:int,updated:int,skipped:int}
     */
    public function syncAllRoomListings(): array
    {
        $summary = [
            'processed' => 0,
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,
        ];

        foreach ($this->roomRepository->getRoomsListRows() as $room) {
            if (!\is_array($room)) {
                continue;
            }

            $summary['processed']++;
            $result = $this->ensureDefaultInventoryUnitForRoom($room);
            $summary[$result] = isset($summary[$result]) ? ((int) $summary[$result] + 1) : 1;
        }

        return $summary;
    }

    public function syncRoomListing(int $roomId): string
    {
        $room = $this->roomRepository->getRoomById($roomId);

        if (!\is_array($room)) {
            return 'skipped';
        }

        return $this->ensureDefaultInventoryUnitForRoom($room);
    }

    /**
     * @param array<string, mixed> $room
     */
    private function ensureDefaultInventoryUnitForRoom(array $room): string
    {
        $roomTypeId = isset($room['id']) ? (int) $room['id'] : 0;

        if ($roomTypeId <= 0) {
            return 'skipped';
        }

        $this->inventoryRepository->syncRoomType(
            $roomTypeId,
            [
                'name' => (string) ($room['name'] ?? ''),
                'description' => (string) ($room['description'] ?? ''),
                'capacity' => (int) ($room['max_guests'] ?? 1),
                'base_price' => (float) ($room['base_price'] ?? 0.0),
            ]
        );

        $units = $this->inventoryRepository->getRoomsByType($roomTypeId);

        if (empty($units)) {
            $created = $this->inventoryRepository->createInventoryRoom($this->buildDefaultUnitPayload($room));

            return $created > 0 ? 'created' : 'skipped';
        }

        if (\count($units) !== 1 || !\is_array($units[0])) {
            return 'skipped';
        }

        $unit = $units[0];
        $unitId = isset($unit['id']) ? (int) $unit['id'] : 0;

        if ($unitId <= 0) {
            return 'skipped';
        }

        $payload = $this->buildSyncedUnitPayload($room, $unit);

        if (!$this->unitNeedsUpdate($unit, $payload)) {
            return 'skipped';
        }

        return $this->inventoryRepository->updateInventoryRoom($unitId, $payload) ? 'updated' : 'skipped';
    }

    /**
     * @param array<string, mixed> $room
     * @return array<string, mixed>
     */
    private function buildDefaultUnitPayload(array $room): array
    {
        $roomTypeId = isset($room['id']) ? (int) $room['id'] : 0;
        $roomName = \trim((string) ($room['name'] ?? ''));

        return [
            'room_type_id' => $roomTypeId,
            'title' => $roomName !== '' ? $roomName : ('Room ' . $roomTypeId),
            'room_number' => $this->generateDefaultRoomNumber($roomTypeId),
            'floor' => 0,
            'status' => 'available',
            'is_active' => !empty($room['is_active']) ? 1 : 0,
            'is_bookable' => !empty($room['is_bookable']) ? 1 : 0,
            'is_calendar_visible' => !empty($room['is_calendar_visible']) ? 1 : 0,
            'sort_order' => 0,
            'capacity_override' => 0,
            'building' => '',
            'section' => '',
            'admin_notes' => '',
        ];
    }

    /**
     * @param array<string, mixed> $room
     * @param array<string, mixed> $unit
     * @return array<string, mixed>
     */
    private function buildSyncedUnitPayload(array $room, array $unit): array
    {
        $roomTypeId = isset($room['id']) ? (int) $room['id'] : 0;
        $unitId = isset($unit['id']) ? (int) $unit['id'] : 0;
        $roomName = \trim((string) ($room['name'] ?? ''));
        $title = \trim((string) ($unit['title'] ?? ''));
        $roomNumber = \trim((string) ($unit['room_number'] ?? ''));

        return [
            'room_type_id' => $roomTypeId,
            'title' => $title !== '' ? $title : ($roomName !== '' ? $roomName : ('Room ' . $roomTypeId)),
            'room_number' => $roomNumber !== '' ? $roomNumber : $this->generateDefaultRoomNumber($roomTypeId, $unitId),
            'floor' => isset($unit['floor']) ? (int) $unit['floor'] : 0,
            'status' => $this->normalizeInventoryStatus((string) ($unit['status'] ?? 'available')),
            'is_active' => !empty($room['is_active']) ? 1 : 0,
            'is_bookable' => !empty($room['is_bookable']) ? 1 : 0,
            'is_calendar_visible' => !empty($room['is_calendar_visible']) ? 1 : 0,
            'sort_order' => isset($unit['sort_order']) ? (int) $unit['sort_order'] : 0,
            'capacity_override' => isset($unit['capacity_override']) ? (int) $unit['capacity_override'] : 0,
            'building' => (string) ($unit['building'] ?? ''),
            'section' => (string) ($unit['section'] ?? ''),
            'admin_notes' => (string) ($unit['admin_notes'] ?? ''),
        ];
    }

    /**
     * @param array<string, mixed> $unit
     * @param array<string, mixed> $payload
     */
    private function unitNeedsUpdate(array $unit, array $payload): bool
    {
        return
            (int) ($unit['room_type_id'] ?? 0) !== (int) ($payload['room_type_id'] ?? 0) ||
            (string) ($unit['title'] ?? '') !== (string) ($payload['title'] ?? '') ||
            (string) ($unit['room_number'] ?? '') !== (string) ($payload['room_number'] ?? '') ||
            (int) ($unit['floor'] ?? 0) !== (int) ($payload['floor'] ?? 0) ||
            (string) ($unit['status'] ?? '') !== (string) ($payload['status'] ?? '') ||
            (int) (!empty($unit['is_active'])) !== (int) (!empty($payload['is_active'])) ||
            (int) (!empty($unit['is_bookable'])) !== (int) (!empty($payload['is_bookable'])) ||
            (int) (!empty($unit['is_calendar_visible'])) !== (int) (!empty($payload['is_calendar_visible'])) ||
            (int) ($unit['sort_order'] ?? 0) !== (int) ($payload['sort_order'] ?? 0) ||
            (int) ($unit['capacity_override'] ?? 0) !== (int) ($payload['capacity_override'] ?? 0) ||
            (string) ($unit['building'] ?? '') !== (string) ($payload['building'] ?? '') ||
            (string) ($unit['section'] ?? '') !== (string) ($payload['section'] ?? '') ||
            (string) ($unit['admin_notes'] ?? '') !== (string) ($payload['admin_notes'] ?? '');
    }

    private function normalizeInventoryStatus(string $status): string
    {
        $status = \sanitize_key($status);
        $allowedStatuses = ['available', 'maintenance', 'out_of_service', 'blocked'];

        return \in_array($status, $allowedStatuses, true) ? $status : 'available';
    }

    private function generateDefaultRoomNumber(int $roomTypeId, int $excludeRoomId = 0): string
    {
        $base = 'RT-' . \max(1, $roomTypeId) . '-1';

        if (!$this->inventoryRepository->roomNumberExists($base, $excludeRoomId)) {
            return $base;
        }

        $index = 2;

        while (true) {
            $candidate = 'RT-' . \max(1, $roomTypeId) . '-' . $index;

            if (!$this->inventoryRepository->roomNumberExists($candidate, $excludeRoomId)) {
                return $candidate;
            }

            $index++;
        }
    }
}
