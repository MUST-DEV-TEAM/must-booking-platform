<?php

namespace MustHotelBooking\Core;

final class BookingPerformanceMonitor
{
    private const TIMELINE_OPTION = 'must_hotel_booking_performance_timeline';
    private const CORRELATION_COOKIE = 'must_hotel_booking_flow_correlation';
    private const MAX_TIMELINE_ROWS = 40;
    private const SLOW_REQUEST_MS = 1500;

    /** @var bool */
    private static $bootstrapped = false;

    /** @var bool */
    private static $finished = false;

    /** @var float */
    private static $startedAt = 0.0;

    /** @var int */
    private static $startingQueryCount = 0;

    /** @var string */
    private static $correlationId = '';

    /** @var array<string, float> */
    private static $durations = [];

    /** @var array<string, array{label: string, started_at: float}> */
    private static $openSpans = [];

    /** @var array<string, int|float|string|bool> */
    private static $metadata = [];

    public static function bootstrap(): void
    {
        if (self::$bootstrapped) {
            return;
        }

        self::$bootstrapped = true;
        self::$startedAt = isset($_SERVER['REQUEST_TIME_FLOAT'])
            ? (float) $_SERVER['REQUEST_TIME_FLOAT']
            : \microtime(true);
        self::$startingQueryCount = self::queryCount();
        self::$correlationId = self::resolveCorrelationId();

        \add_action('init', [self::class, 'markWordPressInitialized'], -999);
        \add_action('template_redirect', [self::class, 'startDiagnosticOutputBuffer'], -999);
        \register_shutdown_function([self::class, 'finish']);
    }

    public static function markWordPressInitialized(): void
    {
        self::addDuration('wordpress_init', self::elapsedMs(self::$startedAt));
    }

    public static function startDiagnosticOutputBuffer(): void
    {
        if (!self::isMonitoredRequest() || !self::isDiagnosticMode() || \headers_sent()) {
            return;
        }

        \ob_start([self::class, 'finalizeDiagnosticOutput']);
    }

    public static function finalizeDiagnosticOutput(string $buffer): string
    {
        self::sendTimingHeaders();

        return $buffer;
    }

    public static function startSpan(string $label): string
    {
        $label = self::normalizeMetricName($label);
        $token = $label . '_' . \str_replace('.', '', \uniqid('', true));
        self::$openSpans[$token] = [
            'label' => $label,
            'started_at' => \microtime(true),
        ];

        return $token;
    }

    public static function stopSpan(string $token): float
    {
        if (!isset(self::$openSpans[$token])) {
            return 0.0;
        }

        $span = self::$openSpans[$token];
        unset(self::$openSpans[$token]);
        $duration = self::elapsedMs((float) $span['started_at']);
        self::addDuration((string) $span['label'], $duration);

        return $duration;
    }

    /**
     * @param callable $callback
     * @return mixed
     */
    public static function measure(string $label, callable $callback)
    {
        $token = self::startSpan($label);

        try {
            return $callback();
        } finally {
            self::stopSpan($token);
        }
    }

    public static function addDuration(string $label, float $durationMs): void
    {
        $label = self::normalizeMetricName($label);

        if ($label === '') {
            return;
        }

        self::$durations[$label] = (float) (self::$durations[$label] ?? 0.0) + \max(0.0, $durationMs);
    }

    /**
     * @param int|float|string|bool $value
     */
    public static function setMetadata(string $key, $value): void
    {
        $key = self::normalizeMetricName($key);

        if ($key !== '') {
            self::$metadata[$key] = $value;
        }
    }

    public static function recordCache(string $area, bool $hit): void
    {
        self::setMetadata(self::normalizeMetricName($area) . '_cache', $hit ? 'hit' : 'miss');
    }


    public static function getCorrelationId(): string
    {
        if (self::$correlationId === '') {
            self::$correlationId = self::resolveCorrelationId();
        }

        return self::$correlationId;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function getSlowRequests(int $limit = 20): array
    {
        $rows = \get_option(self::TIMELINE_OPTION, []);

        if (!\is_array($rows)) {
            return [];
        }

        \usort(
            $rows,
            static function (array $left, array $right): int {
                return (int) ($right['total_ms'] ?? 0) <=> (int) ($left['total_ms'] ?? 0);
            }
        );

        return \array_slice($rows, 0, \max(1, \min(100, $limit)));
    }

    public static function finish(): void
    {
        if (self::$finished || !self::isMonitoredRequest()) {
            return;
        }

        self::$finished = true;
        self::closeOpenSpans();
        $entry = self::buildEntry();

        if ((int) ($entry['total_ms'] ?? 0) < self::SLOW_REQUEST_MS && !self::isDiagnosticMode()) {
            return;
        }

        $writeStarted = \microtime(true);
        self::storeEntry($entry);
        self::addDuration('diagnostics_write', self::elapsedMs($writeStarted));
    }

    /**
     * @return array<string, mixed>
     */
    private static function buildEntry(): array
    {
        global $wpdb;
        $totalMs = (int) \round(self::elapsedMs(self::$startedAt));
        $status = \http_response_code();
        $lastError = \error_get_last();

        if (\is_array($lastError) && \in_array((int) ($lastError['type'] ?? 0), [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
            $status = 500;
        }

        return [
            'recorded_at' => \function_exists('current_time') ? \current_time('mysql') : \gmdate('Y-m-d H:i:s'),
            'route' => self::route(),
            'method' => isset($_SERVER['REQUEST_METHOD']) ? \strtoupper((string) $_SERVER['REQUEST_METHOD']) : 'GET',
            'correlation_id' => self::getCorrelationId(),
            'http_status' => $status > 0 ? $status : 200,
            'total_ms' => $totalMs,
            'database_query_count' => \max(0, self::queryCount() - self::$startingQueryCount),
            'database_query_time_ms' => self::databaseQueryTimeMs($wpdb),
            'durations' => self::roundedDurations(),
            'metadata' => self::$metadata,
        ];
    }

    /** @param array<string, mixed> $entry */
    private static function storeEntry(array $entry): void
    {
        $rows = \get_option(self::TIMELINE_OPTION, []);

        if (!\is_array($rows)) {
            $rows = [];
        }

        $rows[] = $entry;
        \usort(
            $rows,
            static function (array $left, array $right): int {
                return \strcmp((string) ($right['recorded_at'] ?? ''), (string) ($left['recorded_at'] ?? ''));
            }
        );
        $rows = \array_slice($rows, 0, self::MAX_TIMELINE_ROWS);
        \update_option(self::TIMELINE_OPTION, $rows, false);
    }

    private static function sendTimingHeaders(): void
    {
        if (\headers_sent()) {
            return;
        }

        $metrics = self::roundedDurations();
        $metrics['request'] = (int) \round(self::elapsedMs(self::$startedAt));
        $parts = [];

        foreach ($metrics as $name => $duration) {
            if (\count($parts) >= 12) {
                break;
            }

            $parts[] = self::normalizeMetricName((string) $name) . ';dur=' . \max(0, (int) $duration);
        }

        if (!empty($parts)) {
            \header('Server-Timing: ' . \implode(', ', $parts), true);
        }

        \header('X-MHB-Correlation-ID: ' . self::getCorrelationId(), true);
    }

    private static function isDiagnosticMode(): bool
    {
        if (\defined('MUST_HOTEL_BOOKING_PERFORMANCE_DIAGNOSTICS') && MUST_HOTEL_BOOKING_PERFORMANCE_DIAGNOSTICS) {
            return true;
        }

        $requested = isset($_GET['mhb_performance']) && !\is_array($_GET['mhb_performance'])
            ? (string) $_GET['mhb_performance']
            : '';

        return $requested === '1' && \function_exists('current_user_can') && \current_user_can('manage_options');
    }

    private static function isMonitoredRequest(): bool
    {
        $route = self::route();

        if (\in_array($route, ['/booking/', '/booking-accommodation/', '/checkout/', '/booking-confirmation/'], true)) {
            return true;
        }

        if ($route === '/wp-admin/admin-ajax.php') {
            $action = isset($_REQUEST['action']) && !\is_array($_REQUEST['action'])
                ? self::normalizeMetricName((string) $_REQUEST['action'])
                : '';

            return $action === 'must_check_availability';
        }

        return false;
    }

    private static function route(): string
    {
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $path = \parse_url($uri, PHP_URL_PATH);
        $path = \is_string($path) && $path !== '' ? $path : '/';

        if ($path !== '/') {
            $path = '/' . \trim($path, '/') . '/';
        }

        if ($path === '/wp-admin/admin-ajax.php/') {
            return '/wp-admin/admin-ajax.php';
        }

        return $path;
    }

    private static function resolveCorrelationId(): string
    {
        $existing = isset($_COOKIE[self::CORRELATION_COOKIE]) && !\is_array($_COOKIE[self::CORRELATION_COOKIE])
            ? (string) $_COOKIE[self::CORRELATION_COOKIE]
            : '';
        $existing = \strtolower((string) \preg_replace('/[^a-f0-9]/i', '', $existing));

        if (\strlen($existing) < 24) {
            try {
                $existing = \bin2hex(\random_bytes(16));
            } catch (\Throwable $exception) {
                $existing = \substr(\hash('sha256', \uniqid('mhb_flow_', true)), 0, 32);
            }
        }

        $existing = \substr($existing, 0, 48);

        if (self::isMonitoredRequest() && !\headers_sent()) {
            $path = \defined('COOKIEPATH') && COOKIEPATH ? COOKIEPATH : '/';
            $domain = \defined('COOKIE_DOMAIN') && \is_string(COOKIE_DOMAIN) ? COOKIE_DOMAIN : '';
            \setcookie(
                self::CORRELATION_COOKIE,
                $existing,
                [
                    'expires' => \time() + (\defined('DAY_IN_SECONDS') ? DAY_IN_SECONDS : 86400),
                    'path' => $path,
                    'domain' => $domain,
                    'secure' => \function_exists('is_ssl') && \is_ssl(),
                    'httponly' => true,
                    'samesite' => 'Lax',
                ]
            );
            $_COOKIE[self::CORRELATION_COOKIE] = $existing;
        }

        return $existing;
    }

    private static function closeOpenSpans(): void
    {
        foreach (\array_keys(self::$openSpans) as $token) {
            self::stopSpan((string) $token);
        }
    }

    /** @return array<string, int> */
    private static function roundedDurations(): array
    {
        $rounded = [];

        foreach (self::$durations as $label => $duration) {
            $rounded[$label] = (int) \round($duration);
        }

        \arsort($rounded);

        return $rounded;
    }

    private static function elapsedMs(float $startedAt): float
    {
        return \max(0.0, (\microtime(true) - $startedAt) * 1000);
    }

    private static function normalizeMetricName(string $name): string
    {
        $name = \strtolower((string) \preg_replace('/[^a-zA-Z0-9_\-\.]/', '_', $name));

        return \substr(\trim($name, '_'), 0, 80);
    }

    private static function queryCount(): int
    {
        global $wpdb;

        return \is_object($wpdb) && isset($wpdb->num_queries) ? (int) $wpdb->num_queries : 0;
    }

    /**
     * @param mixed $wpdb
     */
    private static function databaseQueryTimeMs($wpdb): int
    {
        if (!\defined('SAVEQUERIES') || !SAVEQUERIES || !\is_object($wpdb) || empty($wpdb->queries) || !\is_array($wpdb->queries)) {
            return 0;
        }

        $seconds = 0.0;

        foreach ($wpdb->queries as $query) {
            if (\is_array($query) && isset($query[1])) {
                $seconds += (float) $query[1];
            }
        }

        return (int) \round($seconds * 1000);
    }
}
