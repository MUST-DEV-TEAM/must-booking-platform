<?php

if (!\defined('ABSPATH')) {
    exit;
}

\spl_autoload_register(
    static function (string $class): void {
        $prefix = 'MustHotelBooking\\';

        if (\strncmp($class, $prefix, \strlen($prefix)) !== 0) {
            return;
        }

        $relative_class = \substr($class, \strlen($prefix));
        $relative_path = \str_replace('\\', DIRECTORY_SEPARATOR, $relative_class) . '.php';
        $file = \dirname(__DIR__) . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . $relative_path;

        if (\is_file($file)) {
            require_once $file;
        }
    }
);
