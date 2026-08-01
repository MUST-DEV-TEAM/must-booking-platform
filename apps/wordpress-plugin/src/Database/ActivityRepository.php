<?php

namespace MustHotelBooking\Database;

final class ActivityRepository extends AbstractRepository
{
    public function activityTableExists(): bool
    {
        return $this->tableExists('activity_log');
    }

    /**
     * @param array<string, mixed> $activityData
     */
    public function createActivity(array $activityData): int
    {
        if (!$this->activityTableExists()) {
            return 0;
        }

        $inserted = $this->wpdb->insert(
            $this->table('activity_log'),
            [
                'event_type'    => isset($activityData['event_type']) ? (string) $activityData['event_type'] : '',
                'severity'      => isset($activityData['severity']) ? (string) $activityData['severity'] : 'info',
                'entity_type'   => isset($activityData['entity_type']) ? (string) $activityData['entity_type'] : '',
                'entity_id'     => isset($activityData['entity_id']) ? (int) $activityData['entity_id'] : 0,
                'reference'     => isset($activityData['reference']) ? (string) $activityData['reference'] : '',
                'message'       => isset($activityData['message']) ? (string) $activityData['message'] : '',
                'context_json'  => isset($activityData['context_json']) ? (string) $activityData['context_json'] : '',
                'actor_user_id' => isset($activityData['actor_user_id']) ? (int) $activityData['actor_user_id'] : 0,
                'actor_role'    => isset($activityData['actor_role']) ? (string) $activityData['actor_role'] : '',
                'actor_ip'      => isset($activityData['actor_ip']) ? (string) $activityData['actor_ip'] : '',
                'created_at'    => isset($activityData['created_at']) ? (string) $activityData['created_at'] : \current_time('mysql'),
            ],
            ['%s', '%s', '%s', '%d', '%s', '%s', '%s', '%d', '%s', '%s', '%s']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRecentActivities(int $limit = 10): array
    {
        if (!$this->activityTableExists()) {
            return [];
        }

        $limit = \max(1, \min(50, $limit));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    id,
                    event_type,
                    severity,
                    entity_type,
                    entity_id,
                    reference,
                    message,
                    context_json,
                    actor_user_id,
                    actor_role,
                    actor_ip,
                    created_at
                FROM ' . $this->table('activity_log') . '
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
    public function getActivitiesInDateRange(string $dateFrom, string $dateTo, int $limit = 50): array
    {
        if (!$this->activityTableExists() || $dateFrom === '' || $dateTo === '') {
            return [];
        }

        if ($dateFrom > $dateTo) {
            $swap = $dateFrom;
            $dateFrom = $dateTo;
            $dateTo = $swap;
        }

        $limit = \max(1, \min(200, $limit));
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    id,
                    event_type,
                    severity,
                    entity_type,
                    entity_id,
                    reference,
                    message,
                    context_json,
                    actor_user_id,
                    actor_role,
                    actor_ip,
                    created_at
                FROM ' . $this->table('activity_log') . '
                WHERE DATE(created_at) >= %s
                    AND DATE(created_at) <= %s
                ORDER BY created_at DESC, id DESC
                LIMIT %d',
                $dateFrom,
                $dateTo,
                $limit
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @param array<int, string> $eventTypes
     * @return array<int, array<string, mixed>>
     */
    public function getRecentActivitiesByEventTypes(array $eventTypes, int $limit = 10): array
    {
        $eventTypes = \array_values(
            \array_filter(
                \array_map('sanitize_key', $eventTypes),
                static function (string $eventType): bool {
                    return $eventType !== '';
                }
            )
        );

        if (empty($eventTypes) || !$this->activityTableExists()) {
            return [];
        }

        $limit = \max(1, \min(50, $limit));
        $placeholders = \implode(', ', \array_fill(0, \count($eventTypes), '%s'));
        $params = $eventTypes;
        $params[] = $limit;
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    id,
                    event_type,
                    severity,
                    entity_type,
                    entity_id,
                    reference,
                    message,
                    context_json,
                    actor_user_id,
                    actor_role,
                    actor_ip,
                    created_at
                FROM ' . $this->table('activity_log') . '
                WHERE event_type IN (' . $placeholders . ')
                ORDER BY created_at DESC, id DESC
                LIMIT %d',
                ...$params
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRecentActivitiesForReservation(int $reservationId, string $reference = '', int $limit = 20): array
    {
        if (!$this->activityTableExists()) {
            return [];
        }

        $limit = \max(1, \min(100, $limit));
        $where = [];
        $params = [];

        if ($reservationId > 0) {
            $where[] = '(entity_type = %s AND entity_id = %d)';
            $params[] = 'reservation';
            $params[] = $reservationId;

            $where[] = 'context_json LIKE %s';
            $params[] = '%"reservation_id":' . $reservationId . '%';
        }

        $reference = \trim($reference);

        if ($reference !== '') {
            $where[] = 'reference = %s';
            $params[] = $reference;
        }

        if (empty($where)) {
            return [];
        }

        $params[] = $limit;
        $rows = $this->wpdb->get_results(
            $this->wpdb->prepare(
                'SELECT
                    id,
                    event_type,
                    severity,
                    entity_type,
                    entity_id,
                    reference,
                    message,
                    context_json,
                    actor_user_id,
                    actor_role,
                    actor_ip,
                    created_at
                FROM ' . $this->table('activity_log') . '
                WHERE ' . \implode(' OR ', $where) . '
                ORDER BY created_at DESC, id DESC
                LIMIT %d',
                ...$params
            ),
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }
}
