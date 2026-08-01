<?php

namespace MustHotelBooking\Database;

final class PaymentRepository extends AbstractRepository
{
    public function paymentsTableExists(): bool
    {
        return $this->tableExists('payments');
    }

    private function paymentColumnExists(string $column): bool
    {
        if ($column === '' || !$this->paymentsTableExists() || !\preg_match('/^[A-Za-z0-9_]+$/', $column)) {
            return false;
        }

        $found = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SHOW COLUMNS FROM ' . $this->table('payments') . ' LIKE %s',
                $column
            )
        );

        return (string) $found === $column;
    }

    public function getLatestPaymentIdForReservationMethod(int $reservationId, string $method): int
    {
        if ($reservationId <= 0 || \trim($method) === '') {
            return 0;
        }

        return (int) $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT id
                FROM ' . $this->table('payments') . '
                WHERE reservation_id = %d
                    AND method = %s
                ORDER BY id DESC
                LIMIT 1',
                $reservationId,
                $method
            )
        );
    }

    public function getLatestPaymentIdForReservationMethodTransaction(int $reservationId, string $method, string $transactionId): int
    {
        $transactionId = \trim($transactionId);
        if ($reservationId <= 0 || \trim($method) === '' || $transactionId === '') {
            return 0;
        }

        return (int) $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT id
                FROM ' . $this->table('payments') . '
                WHERE reservation_id = %d
                    AND method = %s
                    AND transaction_id = %s
                ORDER BY CASE WHEN status = \'paid\' THEN 0 ELSE 1 END ASC, id DESC
                LIMIT 1',
                $reservationId,
                $method,
                $transactionId
            )
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getPayment(int $paymentId): ?array
    {
        if ($paymentId <= 0 || !$this->paymentsTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT *
                FROM ' . $this->table('payments') . '
                WHERE id = %d
                LIMIT 1',
                $paymentId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $paymentData
     */
    public function createPayment(array $paymentData): int
    {
        $paymentData = $this->filterExistingPaymentColumns($paymentData);
        $inserted = $this->wpdb->insert(
            $this->table('payments'),
            $paymentData,
            $this->resolvePaymentFormats($paymentData)
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    /**
     * @param array<string, mixed> $paymentData
     */
    public function updatePayment(int $paymentId, array $paymentData): bool
    {
        if ($paymentId <= 0 || empty($paymentData)) {
            return false;
        }

        $paymentData = $this->filterExistingPaymentColumns($paymentData);

        if (empty($paymentData)) {
            return false;
        }

        $updated = $this->wpdb->update(
            $this->table('payments'),
            $paymentData,
            ['id' => $paymentId],
            $this->resolvePaymentFormats($paymentData),
            ['%d']
        );

        return \is_int($updated);
    }

    /**
     * @return array<int, int>
     */
    public function findReservationIdsByTransactionId(string $transactionId): array
    {
        if (\trim($transactionId) === '') {
            return [];
        }

        $rows = $this->wpdb->get_col(
            $this->wpdb->prepare(
                'SELECT reservation_id
                FROM ' . $this->table('payments') . '
                WHERE transaction_id = %s',
                $transactionId
            )
        );

        return $this->normalizeIds(\is_array($rows) ? $rows : []);
    }

    /** @return array<int, array<string, mixed>> */
    public function getPaymentAttemptRows(string $method, string $attemptReference): array
    {
        $method = \sanitize_key($method);
        $attemptReference = \trim($attemptReference);
        if ($method === '' || $attemptReference === '' || !$this->paymentsTableExists()) {
            return [];
        }
        $hasAttemptReference = $this->paymentColumnExists('provider_attempt_reference');
        $where = $hasAttemptReference
            ? '(provider_attempt_reference = %s OR (provider_attempt_reference = \'\' AND transaction_id = %s))'
            : 'transaction_id = %s';
        $args = $hasAttemptReference
            ? [$method, $attemptReference, $attemptReference]
            : [$method, $attemptReference];
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT * FROM ' . $this->table('payments') . ' WHERE method = %s AND ' . $where . ' ORDER BY reservation_id, id',
                $args
            ),
            ARRAY_A
        );
        return \is_array($rows) ? $rows : [];
    }

    /** @param array<int, int> $paymentIds @param array<string, mixed> $paymentData */
    public function updatePaymentAttemptRows(array $paymentIds, array $paymentData): bool
    {
        $paymentIds = $this->normalizeIds($paymentIds);
        $paymentData = $this->filterExistingPaymentColumns($paymentData);
        if (empty($paymentIds) || empty($paymentData)) {
            return false;
        }
        $updated = $this->wpdb->query(
            $this->wpdb->prepare(
                'UPDATE ' . $this->table('payments') . ' SET '
                . \implode(', ', \array_map(static function (string $column): string { return $column . ' = %s'; }, \array_keys($paymentData)))
                . ' WHERE id IN (' . \implode(', ', \array_fill(0, \count($paymentIds), '%d')) . ')',
                \array_merge(\array_values($paymentData), $paymentIds)
            )
        );
        return \is_int($updated);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getTaxFeeRules(): array
    {
        if (!$this->tableExists('taxes')) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            'SELECT id, name, rule_type, rule_value, apply_mode
            FROM ' . $this->table('taxes') . '
            ORDER BY id ASC',
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    public function getRevenueReceivedForDate(string $date): float
    {
        if ($date === '' || !$this->paymentsTableExists()) {
            return 0.0;
        }

        $amount = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT COALESCE(SUM(amount), 0)
                FROM ' . $this->table('payments') . '
                WHERE status = %s
                    AND DATE(COALESCE(paid_at, created_at)) = %s',
                'paid',
                $date
            )
        );

        return $amount !== null ? (float) $amount : 0.0;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRecentPaymentRows(int $limit = 10): array
    {
        if (!$this->paymentsTableExists()) {
            return [];
        }

        $limit = \max(1, \min(50, $limit));
        $reservationSelect = '\'\' AS booking_id, \'\' AS reservation_status, \'\' AS room_name, \'\' AS guest_name';
        $reservationJoin = '';

        if ($this->tableExists('reservations')) {
            $reservationSelect = 'COALESCE(r.booking_id, \'\') AS booking_id, COALESCE(r.status, \'\') AS reservation_status, \'\' AS room_name, \'\' AS guest_name';
            $reservationJoin = ' LEFT JOIN ' . $this->table('reservations') . ' r ON r.id = p.reservation_id';

            if ($this->tableExists('rooms')) {
                $reservationSelect = \str_replace('\'\' AS room_name', 'COALESCE(rm.name, \'\') AS room_name', $reservationSelect);
                $reservationJoin .= ' LEFT JOIN ' . $this->table('rooms') . ' rm ON rm.id = r.room_id';
            }

            if ($this->tableExists('guests')) {
                $reservationSelect = \str_replace('\'\' AS guest_name', 'CONCAT_WS(\' \', g.first_name, g.last_name) AS guest_name', $reservationSelect);
                $reservationJoin .= ' LEFT JOIN ' . $this->table('guests') . ' g ON g.id = r.guest_id';
            }
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    p.id,
                    p.reservation_id,
                    p.amount,
                    p.currency,
                    p.method,
                    p.status,
                    p.transaction_id,
                    p.paid_at,
                    p.created_at,
                    ' . $reservationSelect . '
                FROM ' . $this->table('payments') . ' p
                ' . $reservationJoin . '
                ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id DESC
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
    public function getStripeIssueRows(string $cutoffDatetime, int $limit = 5): array
    {
        if ($cutoffDatetime === '' || !$this->paymentsTableExists()) {
            return [];
        }

        $limit = \max(1, \min(20, $limit));
        $reservationSelect = '\'\' AS booking_id, \'\' AS payment_status, \'\' AS reservation_status, \'\' AS room_name, \'\' AS guest_name';
        $reservationJoin = '';

        if ($this->tableExists('reservations')) {
            $reservationSelect = 'COALESCE(r.booking_id, \'\') AS booking_id, COALESCE(r.payment_status, \'\') AS payment_status, COALESCE(r.status, \'\') AS reservation_status, \'\' AS room_name, \'\' AS guest_name';
            $reservationJoin = ' LEFT JOIN ' . $this->table('reservations') . ' r ON r.id = p.reservation_id';

            if ($this->tableExists('rooms')) {
                $reservationSelect = \str_replace('\'\' AS room_name', 'COALESCE(rm.name, \'\') AS room_name', $reservationSelect);
                $reservationJoin .= ' LEFT JOIN ' . $this->table('rooms') . ' rm ON rm.id = r.room_id';
            }

            if ($this->tableExists('guests')) {
                $reservationSelect = \str_replace('\'\' AS guest_name', 'CONCAT_WS(\' \', g.first_name, g.last_name) AS guest_name', $reservationSelect);
                $reservationJoin .= ' LEFT JOIN ' . $this->table('guests') . ' g ON g.id = r.guest_id';
            }
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    p.id,
                    p.reservation_id,
                    p.amount,
                    p.currency,
                    p.method,
                    p.status,
                    p.transaction_id,
                    p.paid_at,
                    p.created_at,
                    ' . $reservationSelect . '
                FROM ' . $this->table('payments') . ' p
                ' . $reservationJoin . '
                WHERE p.method = %s
                    AND (
                        p.status = %s
                        OR (p.status = %s AND p.created_at <= %s)
                    )
                ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id DESC
                LIMIT %d',
                'stripe',
                'failed',
                'pending',
                $cutoffDatetime,
                $limit
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getPaymentsForReservation(int $reservationId): array
    {
        if ($reservationId <= 0 || !$this->paymentsTableExists()) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT *
                FROM ' . $this->table('payments') . '
                WHERE reservation_id = %d
                ORDER BY COALESCE(paid_at, created_at) DESC, id DESC',
                $reservationId
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @param array<int, int> $reservationIds
     * @return array<int, array<int, array<string, mixed>>>
     */
    public function getPaymentsForReservationIds(array $reservationIds): array
    {
        $grouped = [];
        $reservationIds = $this->normalizeIds($reservationIds);

        if (empty($reservationIds) || !$this->paymentsTableExists()) {
            return $grouped;
        }

        $placeholders = \implode(', ', \array_fill(0, \count($reservationIds), '%d'));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT *
                FROM ' . $this->table('payments') . '
                WHERE reservation_id IN (' . $placeholders . ')
                ORDER BY reservation_id ASC, COALESCE(paid_at, created_at) DESC, id DESC',
                ...$reservationIds
            ),
            ARRAY_A
        );

        if (!\is_array($rows)) {
            return $grouped;
        }

        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $reservationId = isset($row['reservation_id']) ? (int) $row['reservation_id'] : 0;

            if ($reservationId <= 0) {
                continue;
            }

            if (!isset($grouped[$reservationId])) {
                $grouped[$reservationId] = [];
            }

            $grouped[$reservationId][] = $row;
        }

        return $grouped;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getLatestPaymentForReservation(int $reservationId): ?array
    {
        $rows = $this->getPaymentsForReservation($reservationId);

        return isset($rows[0]) && \is_array($rows[0]) ? $rows[0] : null;
    }

    /**
     * @return array{amount_paid: float, latest_method: string, latest_status: string, latest_transaction_id: string, latest_paid_at: string, latest_created_at: string}
     */
    public function getReservationPaymentSummary(int $reservationId): array
    {
        $summary = [
            'amount_paid' => 0.0,
            'payment_count' => 0,
            'latest_method' => '',
            'latest_status' => '',
            'latest_transaction_id' => '',
            'latest_paid_at' => '',
            'latest_created_at' => '',
        ];

        if ($reservationId <= 0 || !$this->paymentsTableExists()) {
            return $summary;
        }

        $paidAmount = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT COALESCE(SUM(amount), 0)
                FROM ' . $this->table('payments') . '
                WHERE reservation_id = %d
                    AND status = %s',
                $reservationId,
                'paid'
            )
        );

        if ($paidAmount !== null) {
            $summary['amount_paid'] = (float) $paidAmount;
        }

        $paymentCount = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SELECT COUNT(*)
                FROM ' . $this->table('payments') . '
                WHERE reservation_id = %d',
                $reservationId
            )
        );

        if ($paymentCount !== null) {
            $summary['payment_count'] = (int) $paymentCount;
        }

        $latestPayment = $this->getLatestPaymentForReservation($reservationId);

        if (!\is_array($latestPayment)) {
            return $summary;
        }

        $summary['latest_method'] = isset($latestPayment['method']) ? (string) $latestPayment['method'] : '';
        $summary['latest_status'] = isset($latestPayment['status']) ? (string) $latestPayment['status'] : '';
        $summary['latest_transaction_id'] = isset($latestPayment['transaction_id']) ? (string) $latestPayment['transaction_id'] : '';
        $summary['latest_paid_at'] = isset($latestPayment['paid_at']) ? (string) $latestPayment['paid_at'] : '';
        $summary['latest_created_at'] = isset($latestPayment['created_at']) ? (string) $latestPayment['created_at'] : '';

        return $summary;
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<int, array<string, mixed>>
     */
    public function getAdminPaymentListRows(array $filters = []): array
    {
        if (!$this->tableExists('reservations')) {
            return [];
        }

        $where = [];
        $params = [];
        $reservationsTable = $this->table('reservations');
        $roomsJoin = $this->tableExists('rooms')
            ? ' LEFT JOIN ' . $this->table('rooms') . ' rm ON rm.id = r.room_id'
            : '';
        $guestsJoin = $this->tableExists('guests')
            ? ' LEFT JOIN ' . $this->table('guests') . ' g ON g.id = r.guest_id'
            : '';
        $paymentsJoin = '';

        if ($this->paymentsTableExists()) {
            $paymentsTable = $this->table('payments');
            $paymentsJoin = '
                LEFT JOIN (
                    SELECT reservation_id, SUM(CASE WHEN status = \'paid\' THEN amount ELSE 0 END) AS amount_paid, COUNT(*) AS payment_count
                    FROM ' . $paymentsTable . '
                    GROUP BY reservation_id
                ) pay_sum ON pay_sum.reservation_id = r.id
                LEFT JOIN (
                    SELECT p1.id, p1.reservation_id, p1.amount, p1.currency, p1.method, p1.status, p1.transaction_id, p1.paid_at, p1.created_at
                    FROM ' . $paymentsTable . ' p1
                    INNER JOIN (
                        SELECT reservation_id, MAX(id) AS latest_id
                        FROM ' . $paymentsTable . '
                        GROUP BY reservation_id
                    ) latest_pay ON latest_pay.latest_id = p1.id
                ) latest_pay ON latest_pay.reservation_id = r.id';
        }

        $search = isset($filters['search']) ? \trim((string) $filters['search']) : '';

        if ($search !== '') {
            $searchLike = '%' . $this->wpdb->esc_like($search) . '%';
            $where[] = '(r.booking_id LIKE %s OR CAST(r.id AS CHAR) = %s OR CONCAT_WS(\' \', COALESCE(g.first_name, \'\'), COALESCE(g.last_name, \'\')) LIKE %s OR COALESCE(g.email, \'\') LIKE %s OR COALESCE(latest_pay.transaction_id, \'\') LIKE %s)';
            $params[] = $searchLike;
            $params[] = $search;
            $params[] = $searchLike;
            $params[] = $searchLike;
            $params[] = $searchLike;
        }

        $reservationStatus = isset($filters['reservation_status']) ? \sanitize_key((string) $filters['reservation_status']) : '';

        if ($reservationStatus !== '') {
            $where[] = 'r.status = %s';
            $params[] = $reservationStatus;
        }

        $method = isset($filters['method']) ? \sanitize_key((string) $filters['method']) : '';

        if ($method !== '') {
            $where[] = 'COALESCE(latest_pay.method, \'\') = %s';
            $params[] = $method;
        }

        $dateFrom = isset($filters['date_from']) ? \trim((string) $filters['date_from']) : '';

        if ($dateFrom !== '') {
            $where[] = 'DATE(COALESCE(latest_pay.paid_at, latest_pay.created_at, r.created_at)) >= %s';
            $params[] = $dateFrom;
        }

        $dateTo = isset($filters['date_to']) ? \trim((string) $filters['date_to']) : '';

        if ($dateTo !== '') {
            $where[] = 'DATE(COALESCE(latest_pay.paid_at, latest_pay.created_at, r.created_at)) <= %s';
            $params[] = $dateTo;
        }

        $sql = 'SELECT
                r.id,
                r.booking_id,
                r.room_id,
                r.guest_id,
                r.checkin,
                r.checkout,
                r.status,
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
                r.total_price,
                r.created_at,
                COALESCE(rm.name, \'\') AS room_name,
                CONCAT_WS(\' \', COALESCE(g.first_name, \'\'), COALESCE(g.last_name, \'\')) AS guest_name,
                COALESCE(g.email, \'\') AS guest_email,
                COALESCE(g.phone, \'\') AS guest_phone,
                COALESCE(pay_sum.amount_paid, 0) AS amount_paid,
                COALESCE(pay_sum.payment_count, 0) AS payment_count,
                COALESCE(latest_pay.method, \'\') AS latest_method,
                COALESCE(latest_pay.status, \'\') AS latest_status,
                COALESCE(latest_pay.transaction_id, \'\') AS latest_transaction_id,
                COALESCE(latest_pay.paid_at, \'\') AS latest_paid_at,
                COALESCE(latest_pay.created_at, \'\') AS latest_created_at
            FROM ' . $reservationsTable . ' r' . $roomsJoin . $guestsJoin . $paymentsJoin;

        if (!empty($where)) {
            $sql .= ' WHERE ' . \implode(' AND ', $where);
        }

        $sql .= ' ORDER BY COALESCE(latest_pay.paid_at, latest_pay.created_at, r.created_at) DESC, r.id DESC';

        if (!empty($params)) {
            $sql = $this->wpdb->prepare($sql, ...$params);
        }

        $rows = $this->wpdb->get_results($sql, ARRAY_A);

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @param array<string, mixed> $paymentData
     * @return array<int, string>
     */
    private function resolvePaymentFormats(array $paymentData): array
    {
        $formats = [];

        foreach (\array_keys($paymentData) as $field) {
            if (\in_array($field, ['amount', 'provider_fee_amount', 'provider_net_amount'], true)) {
                $formats[] = '%f';
                continue;
            }

            if (\in_array($field, ['reservation_id', 'provider_fee_absorbed_by_customer', 'attempt_group_amount_minor'], true)) {
                $formats[] = '%d';
                continue;
            }

            $formats[] = '%s';
        }

        return $formats;
    }

    /** @param array<string, mixed> $paymentData @return array<string, mixed> */
    private function filterExistingPaymentColumns(array $paymentData): array
    {
        $knownBase = [
            'id' => true,
            'reservation_id' => true,
            'amount' => true,
            'currency' => true,
            'method' => true,
            'status' => true,
            'transaction_id' => true,
            'paid_at' => true,
            'created_at' => true,
        ];
        $filtered = [];

        foreach ($paymentData as $key => $value) {
            if (isset($knownBase[$key]) || $this->paymentColumnExists((string) $key)) {
                $filtered[$key] = $value;
            }
        }

        return $filtered;
    }
}
