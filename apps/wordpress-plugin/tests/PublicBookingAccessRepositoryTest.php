<?php
declare(strict_types=1);

if (\PHP_SAPI !== 'cli') {
    exit(1);
}

final class PublicBookingAccessRepositoryTestWpdb
{
    /** @var string */
    public $prefix = 'wp_';

    /** @var array<int, string> */
    public $checkedTables = [];

    public function prepare(string $query, string $tableName): string
    {
        return $tableName;
    }

    public function get_var(string $tableName): string
    {
        $this->checkedTables[] = $tableName;
        return $tableName === 'wp_must_public_booking_access' ? $tableName : '';
    }
}

require __DIR__ . '/../src/Database/AbstractRepository.php';
require __DIR__ . '/../src/Database/PublicBookingAccessRepository.php';

$wpdb = new PublicBookingAccessRepositoryTestWpdb();
$repository = new \MustHotelBooking\Database\PublicBookingAccessRepository($wpdb);
$failures = [];

if (!$repository->publicAccessTableExists()) {
    $failures[] = 'The public-access table guard should resolve the public booking access table.';
}

if ($wpdb->checkedTables !== ['wp_must_public_booking_access']) {
    $failures[] = 'The public-access table guard should use the inherited table-name resolution.';
}

if ($failures) {
    echo "FAIL\n" . \implode("\n", $failures) . "\n";
    exit(1);
}

echo "Public booking access repository tests passed.\n";
