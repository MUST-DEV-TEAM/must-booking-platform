<?php

namespace MustHotelBooking\Database;

abstract class AbstractRepository
{
    /** @var \wpdb */
    protected $wpdb;

    public function __construct($wpdb = null)
    {
        if ($wpdb !== null) {
            $this->wpdb = $wpdb;

            return;
        }

        global $wpdb;

        $this->wpdb = $wpdb;
    }

    protected function table(string $suffix): string
    {
        return $this->wpdb->prefix . 'must_' . $suffix;
    }

    protected function tableExists(string $suffix): bool
    {
        $tableName = $this->table($suffix);
        $result = $this->wpdb->get_var(
            $this->wpdb->prepare(
                'SHOW TABLES LIKE %s',
                $tableName
            )
        );

        return \is_string($result) && $result !== '';
    }

    /**
     * @param array<int, int> $ids
     * @return array<int, int>
     */
    protected function normalizeIds(array $ids): array
    {
        return \array_values(
            \array_filter(
                \array_map('intval', $ids),
                static function (int $id): bool {
                    return $id > 0;
                }
            )
        );
    }

    /**
     * @param array<int, string> $statuses
     * @return array<int, string>
     */
    protected function normalizeNonBlockingStatuses(array $statuses): array
    {
        $defaults = ['cancelled', 'expired', 'payment_failed'];
        $statuses = \array_values(
            \array_filter(
                \array_map('strval', $statuses),
                static function (string $status): bool {
                    return $status !== '';
                }
            )
        );

        for ($index = 0; $index < 3; $index++) {
            if (!isset($statuses[$index])) {
                $statuses[$index] = $defaults[$index];
            }
        }

        return \array_slice($statuses, 0, 3);
    }

    protected function buildIntegerPlaceholders(array $ids): string
    {
        return \implode(', ', \array_fill(0, \count($ids), '%d'));
    }

    public function beginTransaction(): bool
    {
        return $this->wpdb->query('START TRANSACTION') !== false;
    }

    public function commit(): bool
    {
        return $this->wpdb->query('COMMIT') !== false;
    }

    public function rollback(): bool
    {
        return $this->wpdb->query('ROLLBACK') !== false;
    }
}
