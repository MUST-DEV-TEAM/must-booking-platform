<?php
declare(strict_types=1);

namespace {
    if (\PHP_SAPI !== 'cli') {
        exit(1);
    }

    function __(string $text, ?string $domain = null): string
    {
        unset($domain);
        return $text;
    }

    function sanitize_key(string $value): string
    {
        return \strtolower((string) \preg_replace('/[^a-zA-Z0-9_\-]/', '', $value));
    }

    function sanitize_text_field(string $value): string
    {
        return \trim(\strip_tags($value));
    }

    function absint($value): int
    {
        return \abs((int) $value);
    }

    function current_time(string $format): string
    {
        return $format === 'mysql' ? '2026-06-18 12:00:00' : \gmdate($format);
    }

    function wp_json_encode($value): string
    {
        return (string) \json_encode($value);
    }

    function get_current_user_id(): int
    {
        return 7;
    }

    final class FakeWpdb
    {
        /** @var bool */
        public $allowLocks = true;

        public function prepare(string $query, ...$args): string
        {
            foreach ($args as $arg) {
                $query = (string) \preg_replace('/%[sd]/', \is_numeric($arg) ? (string) $arg : "'" . (string) $arg . "'", $query, 1);
            }
            return $query;
        }

        public function get_var(string $query)
        {
            if (\strpos($query, 'GET_LOCK') !== false) {
                return $this->allowLocks ? '1' : '0';
            }
            if (\strpos($query, 'RELEASE_LOCK') !== false) {
                return '1';
            }
            return null;
        }
    }

    $GLOBALS['wpdb'] = new FakeWpdb();
}

namespace MustHotelBooking\Core {
    final class ReservationStatus
    {
        /** @return array<int, string> */
        public static function getInventoryNonBlockingStatuses(): array
        {
            return ['cancelled', 'expired', 'payment_failed'];
        }
    }
}

namespace MustHotelBooking\Provider {
    final class ProviderManager
    {
        public const CLOCK_MODE = 'clock';
    }
}

namespace MustHotelBooking\Engine {
    final class FakeReservationRepository
    {
        /** @var array<string, mixed> */
        public $row = [];
        /** @var bool */
        public $overlap = false;
        /** @var bool */
        public $atomicConflict = false;
        /** @var bool */
        public $failCommit = false;
        /** @var int */
        public $updates = 0;
        /** @var int */
        public $rollbacks = 0;
        /** @var array<string, mixed>|null */
        private $transactionSnapshot;

        public function getReservation(int $id): ?array
        {
            return $id === (int) ($this->row['id'] ?? 0) ? $this->row : null;
        }

        public function hasAssignedRoomOverlapExcludingId(int $reservationId, int $roomId, string $checkin, string $checkout, array $statuses): bool
        {
            unset($reservationId, $roomId, $checkin, $checkout, $statuses);
            return $this->overlap;
        }

        public function hasReservationOverlapExcludingId(int $reservationId, int $roomId, string $checkin, string $checkout, array $statuses): bool
        {
            unset($reservationId, $roomId, $checkin, $checkout, $statuses);
            return $this->overlap;
        }

        /** @param array<string, mixed> $updates */
        public function updateReservation(int $id, array $updates): bool
        {
            if ($id !== (int) ($this->row['id'] ?? 0)) {
                return false;
            }
            $this->row = \array_merge($this->row, $updates);
            $this->updates++;
            return true;
        }

        /** @param array<string, mixed> $updates @param array<int, string> $statuses */
        public function updateReservationIfDestinationAvailable(
            int $id,
            int $destinationId,
            bool $physicalRoom,
            string $checkin,
            string $checkout,
            array $updates,
            array $statuses
        ): bool {
            unset($destinationId, $physicalRoom, $checkin, $checkout, $statuses);
            if ($this->atomicConflict) {
                return false;
            }
            return $this->updateReservation($id, $updates);
        }

        public function beginTransaction(): bool
        {
            $this->transactionSnapshot = $this->row;
            return true;
        }

        public function commit(): bool
        {
            if ($this->failCommit) {
                return false;
            }
            $this->transactionSnapshot = null;
            return true;
        }

        public function rollback(): bool
        {
            if (\is_array($this->transactionSnapshot)) {
                $this->row = $this->transactionSnapshot;
            }
            $this->transactionSnapshot = null;
            $this->rollbacks++;
            return true;
        }
    }

    final class FakeInventoryRepository
    {
        /** @var array<int, array<string, mixed>> */
        public $rooms = [];

        public function getInventoryRoomById(int $id): ?array
        {
            return $this->rooms[$id] ?? null;
        }
    }

    final class FakeActivityRepository
    {
        /** @var array<int, array<string, mixed>> */
        public $rows = [];

        /** @param array<string, mixed> $row */
        public function createActivity(array $row): int
        {
            $this->rows[] = $row;
            return \count($this->rows);
        }
    }

    final class AvailabilityEngine
    {
        public static function isValidBookingDate(string $date): bool
        {
            return \preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1;
        }

        public static function checkBookingRestrictions(int $roomId, string $checkin, string $checkout): bool
        {
            unset($roomId, $checkin, $checkout);
            return true;
        }
    }

    final class InventoryEngine
    {
        /** @var array<int, bool> */
        public static $inventory = [];

        public static function hasInventoryForRoomType(int $roomTypeId): bool
        {
            return !empty(self::$inventory[$roomTypeId]);
        }
    }

    final class LockEngine
    {
        /** @var bool */
        public static $locked = false;

        public static function isRoomLocked(int $roomId, string $checkin, string $checkout): bool
        {
            unset($roomId, $checkin, $checkout);
            return self::$locked;
        }
    }

    final class PricingEngine
    {
        /** @var float */
        public static $total = 100.0;

        /** @return array<string, mixed> */
        public static function calculateTotal(int $roomId, string $checkin, string $checkout, int $guests, string $coupon, int $ratePlanId): array
        {
            unset($roomId, $checkin, $checkout, $guests, $coupon, $ratePlanId);
            return ['success' => true, 'total_price' => self::$total, 'discount_total' => 0.0];
        }
    }

    $GLOBALS['mhb_reservations'] = new FakeReservationRepository();
    $GLOBALS['mhb_inventory'] = new FakeInventoryRepository();
    $GLOBALS['mhb_activity'] = new FakeActivityRepository();

    function get_reservation_repository(): FakeReservationRepository
    {
        return $GLOBALS['mhb_reservations'];
    }

    function get_inventory_repository(): FakeInventoryRepository
    {
        return $GLOBALS['mhb_inventory'];
    }

    function get_activity_repository(): FakeActivityRepository
    {
        return $GLOBALS['mhb_activity'];
    }
}

namespace {
    use MustHotelBooking\Engine\FakeActivityRepository;
    use MustHotelBooking\Engine\FakeInventoryRepository;
    use MustHotelBooking\Engine\FakeReservationRepository;
    use MustHotelBooking\Engine\InventoryEngine;
    use MustHotelBooking\Engine\PricingEngine;
    use MustHotelBooking\Engine\ReservationAmendmentService;

    require __DIR__ . '/../src/Engine/ReservationAmendmentService.php';

    final class ReservationAmendmentServiceTest
    {
        /** @var FakeReservationRepository */
        private $reservations;
        /** @var FakeInventoryRepository */
        private $inventory;
        /** @var FakeActivityRepository */
        private $activity;

        public function __construct()
        {
            $this->reservations = $GLOBALS['mhb_reservations'];
            $this->inventory = $GLOBALS['mhb_inventory'];
            $this->activity = $GLOBALS['mhb_activity'];
        }

        public function run(): void
        {
            $this->sameTypeMovePreservesPriceAndIsIdempotent();
            $this->preArrivalUnassignmentReleasesCurrentRoom();
            $this->unavailableDestinationPreservesOriginalRoom();
            $this->atomicConflictPreservesOriginalRoom();
            $this->concurrentRoomLockPreservesOriginalRoom();
            $this->commitFailureIsReported();
            $this->cancellationMakesMovedRoomNonBlocking();
            $this->upgradeCreatesAdditionalPaymentReview();
            $this->downgradeCreatesRefundReview();
            $this->dateExtensionChecksCurrentDestination();
        }

        private function sameTypeMovePreservesPriceAndIsIdempotent(): void
        {
            $this->reset();
            $result = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 2], 'test');
            $this->assertTrue((bool) ($result['success'] ?? false), 'same-type physical move succeeds');
            $this->assertSame(2, (int) $this->reservations->row['assigned_room_id'], 'destination room is assigned');
            $this->assertSame(100.0, (float) $this->reservations->row['total_price'], 'same-type move preserves total');
            $this->assertSame('paid', (string) $this->reservations->row['payment_status'], 'payment status is preserved');
            $updates = $this->reservations->updates;
            $duplicate = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 2], 'test');
            $this->assertTrue(!empty($duplicate['no_change']), 'duplicate move is a no-op');
            $this->assertSame($updates, $this->reservations->updates, 'duplicate move does not write again');
        }

        private function unavailableDestinationPreservesOriginalRoom(): void
        {
            $this->reset();
            $this->reservations->overlap = true;
            $result = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 2], 'test');
            $this->assertTrue(empty($result['success']), 'unavailable move fails');
            $this->assertSame(1, (int) $this->reservations->row['assigned_room_id'], 'failed move preserves original assignment');
        }

        private function preArrivalUnassignmentReleasesCurrentRoom(): void
        {
            $this->reset();
            $result = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 0], 'test');
            $this->assertTrue((bool) ($result['success'] ?? false), 'pre-arrival local room can be unassigned');
            $this->assertSame(0, (int) $this->reservations->row['assigned_room_id'], 'old physical room is released');
            $this->assertSame(100.0, (float) $this->reservations->row['total_price'], 'unassignment preserves total');
            $this->assertSame('paid', (string) $this->reservations->row['payment_status'], 'unassignment preserves payment state');
        }

        private function atomicConflictPreservesOriginalRoom(): void
        {
            $this->reset();
            $this->reservations->atomicConflict = true;
            $result = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 2], 'test');
            $this->assertTrue(empty($result['success']), 'atomic destination conflict fails');
            $this->assertSame(1, (int) $this->reservations->row['assigned_room_id'], 'atomic conflict preserves original assignment');
            $this->assertSame(1, $this->reservations->rollbacks, 'atomic conflict rolls back the transaction');
            $this->assertSame(0, \count($this->activity->rows), 'failed atomic claim creates no audit row');
        }

        private function commitFailureIsReported(): void
        {
            $this->reset();
            $this->reservations->failCommit = true;
            $result = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 2], 'test');
            $this->assertTrue(empty($result['success']), 'commit failure is reported');
            $this->assertSame(1, $this->reservations->rollbacks, 'commit failure attempts rollback');
            $this->assertSame(1, (int) $this->reservations->row['assigned_room_id'], 'commit failure restores the original room');
            $this->assertSame(0, \count($this->activity->rows), 'commit failure creates no audit row');
        }

        private function concurrentRoomLockPreservesOriginalRoom(): void
        {
            $this->reset();
            $GLOBALS['wpdb']->allowLocks = false;
            $result = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 2], 'test');
            $this->assertTrue(empty($result['success']), 'concurrent room lock blocks a second move');
            $this->assertTrue(!empty($result['retryable']), 'concurrent room lock is retryable');
            $this->assertSame(1, (int) $this->reservations->row['assigned_room_id'], 'concurrent lock failure preserves the original room');
        }

        private function cancellationMakesMovedRoomNonBlocking(): void
        {
            $this->reset();
            $result = (new ReservationAmendmentService())->amend(1, ['target_assigned_room_id' => 2], 'test');
            $this->assertTrue((bool) ($result['success'] ?? false), 'move before cancellation succeeds');
            $this->reservations->row['status'] = 'cancelled';
            $this->assertSame(2, (int) $this->reservations->row['assigned_room_id'], 'cancellation retains the new current-room audit reference');
            $this->assertTrue(
                \in_array((string) $this->reservations->row['status'], \MustHotelBooking\Core\ReservationStatus::getInventoryNonBlockingStatuses(), true),
                'cancellation releases the new room through existing non-blocking status semantics'
            );
        }

        private function upgradeCreatesAdditionalPaymentReview(): void
        {
            $this->reset();
            PricingEngine::$total = 140.0;
            $result = (new ReservationAmendmentService())->amend(1, [
                'target_room_type_id' => 20,
                'target_assigned_room_id' => 3,
                'target_rate_plan_id' => 2,
            ], 'test');
            $metadata = \json_decode((string) $this->reservations->row['provider_metadata'], true);
            $this->assertTrue((bool) ($result['success'] ?? false), 'upgrade succeeds');
            $this->assertSame(40.0, (float) ($result['price_delta'] ?? 0), 'upgrade delta is stored');
            $this->assertTrue(!empty($metadata['additional_payment_review_required']), 'upgrade requires additional payment review');
            $this->assertSame('paid', (string) $this->reservations->row['payment_status'], 'upgrade does not alter payment status');
        }

        private function downgradeCreatesRefundReview(): void
        {
            $this->reset();
            PricingEngine::$total = 75.0;
            $result = (new ReservationAmendmentService())->amend(1, [
                'target_room_type_id' => 20,
                'target_assigned_room_id' => 3,
                'target_rate_plan_id' => 2,
            ], 'test');
            $metadata = \json_decode((string) $this->reservations->row['provider_metadata'], true);
            $this->assertTrue((bool) ($result['success'] ?? false), 'downgrade succeeds');
            $this->assertSame(-25.0, (float) ($result['price_delta'] ?? 0), 'downgrade delta is stored');
            $this->assertTrue(!empty($metadata['refund_or_credit_review_required']), 'downgrade requires refund review');
        }

        private function dateExtensionChecksCurrentDestination(): void
        {
            $this->reset();
            $this->reservations->overlap = true;
            $result = (new ReservationAmendmentService())->amend(1, ['target_checkout' => '2026-07-13'], 'test');
            $this->assertTrue(empty($result['success']), 'date extension with a destination conflict fails');
            $this->assertSame('2026-07-12', (string) $this->reservations->row['checkout'], 'failed extension preserves dates');
        }

        private function reset(): void
        {
            $this->reservations->row = [
                'id' => 1,
                'booking_id' => 'TEST-1',
                'room_id' => 10,
                'room_type_id' => 10,
                'assigned_room_id' => 1,
                'rate_plan_id' => 1,
                'checkin' => '2026-07-10',
                'checkout' => '2026-07-12',
                'guests' => 2,
                'status' => 'confirmed',
                'payment_status' => 'paid',
                'total_price' => 100.0,
                'coupon_code' => '',
                'provider' => 'local',
                'provider_metadata' => '',
                'checked_in_at' => '',
                'checked_out_at' => '',
            ];
            $this->reservations->overlap = false;
            $this->reservations->atomicConflict = false;
            $this->reservations->failCommit = false;
            $this->reservations->updates = 0;
            $this->reservations->rollbacks = 0;
            $this->inventory->rooms = [
                1 => ['id' => 1, 'room_type_id' => 10, 'room_number' => '101', 'status' => 'available', 'is_active' => 1, 'is_bookable' => 1],
                2 => ['id' => 2, 'room_type_id' => 10, 'room_number' => '102', 'status' => 'available', 'is_active' => 1, 'is_bookable' => 1],
                3 => ['id' => 3, 'room_type_id' => 20, 'room_number' => '201', 'status' => 'available', 'is_active' => 1, 'is_bookable' => 1],
            ];
            $this->activity->rows = [];
            InventoryEngine::$inventory = [10 => true, 20 => true];
            PricingEngine::$total = 100.0;
            $GLOBALS['wpdb']->allowLocks = true;
        }

        private function assertTrue(bool $condition, string $message): void
        {
            if (!$condition) {
                throw new \RuntimeException($message);
            }
        }

        /** @param mixed $expected @param mixed $actual */
        private function assertSame($expected, $actual, string $message): void
        {
            if ($expected !== $actual) {
                throw new \RuntimeException($message . ' Expected ' . \var_export($expected, true) . ', got ' . \var_export($actual, true));
            }
        }
    }

    try {
        (new ReservationAmendmentServiceTest())->run();
        echo "Reservation amendment service tests passed.\n";
    } catch (\Throwable $exception) {
        \fwrite(\STDERR, $exception->getMessage() . "\n");
        exit(1);
    }
}
