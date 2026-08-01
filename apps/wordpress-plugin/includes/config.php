<?php

if (!\defined('ABSPATH')) {
    exit;
}

$class_aliases = [
    \MustHotelBooking\Core\MustBookingConfig::class => [
        'MustHotelBooking\\Admin\\MustBookingConfig',
        'MustHotelBooking\\Engine\\MustBookingConfig',
        'MustHotelBooking\\Elementor\\MustBookingConfig',
        'MustHotelBooking\\Frontend\\MustBookingConfig',
        'must_hotel_booking\\MustBookingConfig',
    ],
];

foreach ($class_aliases as $original => $aliases) {
    if (!\class_exists($original)) {
        continue;
    }

    foreach ($aliases as $alias) {
        if (!\class_exists($alias, false)) {
            \class_alias($original, $alias);
        }
    }
}

$bootstrap_files = [
    MUST_HOTEL_BOOKING_PATH . 'src/legacy-functions.php',
];

foreach ($bootstrap_files as $bootstrap_file) {
    if (\is_file($bootstrap_file)) {
        require_once $bootstrap_file;
    }
}

$module_directories = [
    MUST_HOTEL_BOOKING_PATH . 'src/Core',
    MUST_HOTEL_BOOKING_PATH . 'src/Database',
    MUST_HOTEL_BOOKING_PATH . 'src/Admin',
    MUST_HOTEL_BOOKING_PATH . 'src/Frontend',
    MUST_HOTEL_BOOKING_PATH . 'src/Engine',
    MUST_HOTEL_BOOKING_PATH . 'src/Elementor',
];

foreach ($module_directories as $module_directory) {
    if (!\is_dir($module_directory)) {
        continue;
    }

    $files = \glob($module_directory . DIRECTORY_SEPARATOR . '*.php');

    if ($files === false) {
        continue;
    }

    \sort($files);

    foreach ($files as $file) {
        $basename = \basename($file);
        $first_character = $basename !== '' ? $basename[0] : '';

        if ($basename === '00-dependencies.php' || $basename === 'index.php') {
            continue;
        }

        if ($first_character === '' || !\preg_match('/^[a-z0-9]/', $first_character)) {
            continue;
        }

        require_once $file;
    }
}

