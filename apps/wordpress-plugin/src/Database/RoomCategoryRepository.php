<?php

namespace MustHotelBooking\Database;

final class RoomCategoryRepository extends AbstractRepository
{
    public function getTableName(): string
    {
        return $this->table('room_categories');
    }

    public function categoriesTableExists(): bool
    {
        return parent::tableExists('room_categories');
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getCategories(): array
    {
        if (!$this->categoriesTableExists()) {
            return [];
        }

        $rows = $this->wpdb->get_results(
            'SELECT id, name, slug, description, sort_order, created_at
            FROM ' . $this->getTableName() . '
            ORDER BY sort_order ASC, name ASC, id ASC',
            ARRAY_A
        );

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, string>
     */
    public function getCategoryOptions(): array
    {
        $options = [];

        foreach ($this->getCategories() as $row) {
            if (!\is_array($row)) {
                continue;
            }

            $slug = \sanitize_key((string) ($row['slug'] ?? ''));
            $name = \sanitize_text_field((string) ($row['name'] ?? ''));

            if ($slug === '' || $name === '') {
                continue;
            }

            $options[$slug] = $name;
        }

        return $options;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getCategoryById(int $categoryId): ?array
    {
        if ($categoryId <= 0 || !$this->categoriesTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, name, slug, description, sort_order, created_at
                FROM ' . $this->getTableName() . '
                WHERE id = %d
                LIMIT 1',
                $categoryId
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getCategoryBySlug(string $slug): ?array
    {
        $slug = \sanitize_key($slug);

        if ($slug === '' || !$this->categoriesTableExists()) {
            return null;
        }

        $row = $this->wpdb->get_row(
            $this->wpdb->prepare(
                'SELECT id, name, slug, description, sort_order, created_at
                FROM ' . $this->getTableName() . '
                WHERE slug = %s
                LIMIT 1',
                $slug
            ),
            ARRAY_A
        );

        return \is_array($row) ? $row : null;
    }

    public function slugExists(string $slug, int $excludeCategoryId = 0): bool
    {
        $slug = \sanitize_key($slug);

        if ($slug === '' || !$this->categoriesTableExists()) {
            return false;
        }

        $sql = 'SELECT COUNT(*)
            FROM ' . $this->getTableName() . '
            WHERE slug = %s';
        $params = [$slug];

        if ($excludeCategoryId > 0) {
            $sql .= ' AND id <> %d';
            $params[] = $excludeCategoryId;
        }

        $count = (int) $this->wpdb->get_var(
            $this->wpdb->prepare($sql, ...$params)
        );

        return $count > 0;
    }

    /**
     * @param array<string, mixed> $data
     */
    public function createCategory(array $data): int
    {
        if (!$this->categoriesTableExists()) {
            return 0;
        }

        $inserted = $this->wpdb->insert(
            $this->getTableName(),
            [
                'name' => (string) ($data['name'] ?? ''),
                'slug' => (string) ($data['slug'] ?? ''),
                'description' => (string) ($data['description'] ?? ''),
                'sort_order' => (int) ($data['sort_order'] ?? 0),
                'created_at' => isset($data['created_at']) ? (string) $data['created_at'] : \current_time('mysql'),
            ],
            ['%s', '%s', '%s', '%d', '%s']
        );

        if ($inserted === false) {
            return 0;
        }

        return (int) $this->wpdb->insert_id;
    }

    /**
     * @param array<string, mixed> $data
     */
    public function updateCategory(int $categoryId, array $data): bool
    {
        if ($categoryId <= 0 || !$this->categoriesTableExists()) {
            return false;
        }

        $updated = $this->wpdb->update(
            $this->getTableName(),
            [
                'name' => (string) ($data['name'] ?? ''),
                'slug' => (string) ($data['slug'] ?? ''),
                'description' => (string) ($data['description'] ?? ''),
                'sort_order' => (int) ($data['sort_order'] ?? 0),
            ],
            ['id' => $categoryId],
            ['%s', '%s', '%s', '%d'],
            ['%d']
        );

        return $updated !== false;
    }

    public function deleteCategory(int $categoryId): bool
    {
        if ($categoryId <= 0 || !$this->categoriesTableExists()) {
            return false;
        }

        $deleted = $this->wpdb->delete(
            $this->getTableName(),
            ['id' => $categoryId],
            ['%d']
        );

        return $deleted !== false;
    }

    public function countCategories(): int
    {
        if (!$this->categoriesTableExists()) {
            return 0;
        }

        return (int) $this->wpdb->get_var(
            'SELECT COUNT(*) FROM ' . $this->getTableName()
        );
    }
}
