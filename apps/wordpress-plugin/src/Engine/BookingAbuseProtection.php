<?php

namespace MustHotelBooking\Engine;

use MustHotelBooking\Core\MustBookingConfig;

final class BookingAbuseProtection
{
    public const SURFACE_CHECKOUT = 'public_checkout';
    public const SURFACE_CONFIRMATION = 'public_confirmation';

    private const EVENT_TYPE_BLOCKED = 'booking_abuse_blocked';
    private const EVENT_TYPE_SIGNAL = 'booking_abuse_signal';
    private const HONEYPOT_FIELD = 'must_booking_reference_code';

    /**
     * @param array<string, mixed> $context
     */
    public static function markCheckoutStepStarted(array $context): void
    {
        self::markStepStarted($context, 'anti_abuse_checkout_started_at');
    }

    /**
     * @param array<string, mixed> $context
     */
    public static function markConfirmationStepStarted(array $context): void
    {
        self::markStepStarted($context, 'anti_abuse_confirmation_started_at');
    }

    public static function shouldRenderHoneypotField(): bool
    {
        return self::isEnabled() && self::isHoneypotEnabled();
    }

    public static function getHoneypotFieldName(): string
    {
        return self::HONEYPOT_FIELD;
    }

    /**
     * @param array<string, mixed> $context
     * @param array<string, mixed> $guestForm
     * @param array<string, mixed> $options
     * @return array{allowed: bool, message: string}
     */
    public static function guardSubmission(array $context, array $guestForm, array $options = []): array
    {
        if (!self::shouldProtect($options)) {
            return self::allow();
        }

        $request = self::buildRequestContext($context, $guestForm, $options);

        if (self::isThrottlingEnabled()) {
            $activeBlock = self::getActiveThrottleBlock($request);

            if (!empty($activeBlock['blocked'])) {
                self::logBlockedAttempt('throttle_active', $request, $activeBlock);

                return self::deny();
            }
        }

        $reasons = [];

        if (self::isHoneypotEnabled()) {
            $honeypotValue = \trim((string) ($request['honeypot_value'] ?? ''));

            if ($honeypotValue !== '') {
                $reasons[] = [
                    'code' => 'honeypot_triggered',
                    'details' => [
                        'honeypot_value' => \substr($honeypotValue, 0, 200),
                    ],
                ];
            }
        }

        if (self::isMinimumSubmitTimeEnabled()) {
            $startedAt = isset($request['started_at']) ? (int) $request['started_at'] : 0;
            $currentTime = isset($request['current_time']) ? (int) $request['current_time'] : \time();
            $minimumSeconds = self::getMinimumSubmitSeconds();

            if ($startedAt <= 0) {
                self::logSignal(
                    'missing_submit_timing',
                    $request,
                    [
                        'minimum_submit_seconds' => $minimumSeconds,
                    ]
                );
            } elseif (($currentTime - $startedAt) < $minimumSeconds) {
                $reasons[] = [
                    'code' => 'minimum_submit_time',
                    'details' => [
                        'elapsed_seconds' => \max(0, $currentTime - $startedAt),
                        'minimum_submit_seconds' => $minimumSeconds,
                    ],
                ];
            }
        }

        foreach (self::collectConservativeValidationFailures($request) as $failure) {
            $reasons[] = $failure;
        }

        if (self::isThrottlingEnabled()) {
            $throttleResult = self::registerAttempt($request);

            if (!empty($throttleResult['blocked'])) {
                $reasons[] = [
                    'code' => 'throttle_limit_exceeded',
                    'details' => $throttleResult,
                ];
            }
        }

        if (empty($reasons)) {
            return self::allow();
        }

        $primaryReason = $reasons[0];
        $details = isset($primaryReason['details']) && \is_array($primaryReason['details'])
            ? $primaryReason['details']
            : [];

        if (\count($reasons) > 1) {
            $details['additional_reasons'] = \array_values(
                \array_map(
                    static function (array $reason): string {
                        return isset($reason['code']) ? (string) $reason['code'] : '';
                    },
                    \array_slice($reasons, 1)
                )
            );
        }

        self::logBlockedAttempt(
            isset($primaryReason['code']) ? (string) $primaryReason['code'] : 'booking_request_blocked',
            $request,
            $details
        );

        return self::deny();
    }

    public static function getGenericFailureMessage(): string
    {
        return \__('We could not process your reservation request. Please try again.', 'must-hotel-booking');
    }

    public static function getBlockedEventType(): string
    {
        return self::EVENT_TYPE_BLOCKED;
    }

    /**
     * @param array<string, mixed> $options
     */
    private static function shouldProtect(array $options): bool
    {
        if (!self::isEnabled()) {
            return false;
        }

        if (!empty($options['anti_abuse_prechecked'])) {
            return false;
        }

        if (!self::isPublicWebsitePostRequest()) {
            return false;
        }

        $surface = isset($options['anti_abuse_surface']) ? \sanitize_key((string) $options['anti_abuse_surface']) : '';

        return \in_array($surface, [self::SURFACE_CHECKOUT, self::SURFACE_CONFIRMATION], true);
    }

    private static function isPublicWebsitePostRequest(): bool
    {
        $requestMethod = isset($_SERVER['REQUEST_METHOD']) ? \strtoupper((string) $_SERVER['REQUEST_METHOD']) : '';

        if ($requestMethod !== 'POST' || !\is_array($_POST)) {
            return false;
        }

        if (\function_exists('is_admin') && \is_admin()) {
            return false;
        }

        if (\function_exists('wp_doing_ajax') && \wp_doing_ajax()) {
            return false;
        }

        if (\function_exists('wp_doing_cron') && \wp_doing_cron()) {
            return false;
        }

        if (\defined('REST_REQUEST') && REST_REQUEST) {
            return false;
        }

        return true;
    }

    private static function isEnabled(): bool
    {
        return !empty(MustBookingConfig::get_setting('anti_abuse_enabled', false));
    }

    private static function isHoneypotEnabled(): bool
    {
        return !empty(MustBookingConfig::get_setting('anti_abuse_honeypot_enabled', false));
    }

    private static function isMinimumSubmitTimeEnabled(): bool
    {
        return !empty(MustBookingConfig::get_setting('anti_abuse_min_submit_enabled', false));
    }

    private static function isThrottlingEnabled(): bool
    {
        return !empty(MustBookingConfig::get_setting('anti_abuse_throttle_enabled', false));
    }

    private static function isLoggingEnabled(): bool
    {
        return !empty(MustBookingConfig::get_setting('anti_abuse_logging_enabled', false));
    }

    private static function getMinimumSubmitSeconds(): int
    {
        return \max(1, (int) MustBookingConfig::get_setting('anti_abuse_min_submit_seconds', 5));
    }

    private static function getMaxAttempts(): int
    {
        return \max(1, (int) MustBookingConfig::get_setting('anti_abuse_max_attempts', 5));
    }

    private static function getWindowMinutes(): int
    {
        return \max(1, (int) MustBookingConfig::get_setting('anti_abuse_window_minutes', 10));
    }

    private static function getBlockDurationMinutes(): int
    {
        return \max(1, (int) MustBookingConfig::get_setting('anti_abuse_block_duration_minutes', 30));
    }

    /**
     * @param array<string, mixed> $context
     * @param array<string, mixed> $guestForm
     * @param array<string, mixed> $options
     * @return array<string, mixed>
     */
    private static function buildRequestContext(array $context, array $guestForm, array $options): array
    {
        $flowData = \MustHotelBooking\Frontend\get_booking_selection_flow_data();
        $source = \is_array($_POST) ? $_POST : [];
        $sessionId = LockEngine::getOrCreateSessionId();
        $currentTime = \time();
        $phoneNumber = isset($guestForm['phone_number']) ? (string) $guestForm['phone_number'] : '';
        $email = self::normalizeEmail((string) ($guestForm['email'] ?? ''));
        $startTimes = \array_values(
            \array_filter(
                [
                    isset($flowData['anti_abuse_checkout_started_at']) ? (int) $flowData['anti_abuse_checkout_started_at'] : 0,
                    isset($flowData['anti_abuse_confirmation_started_at']) ? (int) $flowData['anti_abuse_confirmation_started_at'] : 0,
                ],
                static function (int $value) use ($currentTime): bool {
                    return $value > 0 && $value <= $currentTime;
                }
            )
        );
        $startedAt = 0;

        if (!empty($startTimes)) {
            \sort($startTimes, \SORT_NUMERIC);
            $startedAt = (int) $startTimes[0];
        }

        return [
            'surface' => isset($options['anti_abuse_surface']) ? \sanitize_key((string) $options['anti_abuse_surface']) : '',
            'current_time' => $currentTime,
            'started_at' => $startedAt,
            'context_hash' => self::buildContextHash($context),
            'checkin' => isset($context['checkin']) ? (string) $context['checkin'] : '',
            'checkout' => isset($context['checkout']) ? (string) $context['checkout'] : '',
            'ip' => self::getClientIp(),
            'user_agent' => self::getUserAgent(),
            'session_id' => $sessionId,
            'session_hash' => self::hashValue($sessionId),
            'email' => $email,
            'payment_method' => self::resolvePaymentMethod($source, $flowData),
            'honeypot_value' => isset($source[self::getHoneypotFieldName()])
                ? \sanitize_text_field((string) \wp_unslash($source[self::getHoneypotFieldName()]))
                : '',
            'first_name' => isset($guestForm['first_name']) ? \trim((string) $guestForm['first_name']) : '',
            'last_name' => isset($guestForm['last_name']) ? \trim((string) $guestForm['last_name']) : '',
            'phone_number' => \MustHotelBooking\Frontend\sanitize_checkout_phone_number($phoneNumber),
        ];
    }

    /**
     * @param array<string, mixed> $request
     * @return array<int, array{code: string, details: array<string, mixed>}>
     */
    private static function collectConservativeValidationFailures(array $request): array
    {
        $failures = [];
        $firstName = isset($request['first_name']) ? \trim((string) $request['first_name']) : '';
        $lastName = isset($request['last_name']) ? \trim((string) $request['last_name']) : '';
        $phoneNumber = isset($request['phone_number']) ? (string) $request['phone_number'] : '';
        $email = isset($request['email']) ? (string) $request['email'] : '';

        if ($firstName !== '' && !self::containsLetter($firstName)) {
            $failures[] = [
                'code' => 'invalid_first_name',
                'details' => ['first_name' => \substr($firstName, 0, 120)],
            ];
        }

        if ($lastName !== '' && !self::containsLetter($lastName)) {
            $failures[] = [
                'code' => 'invalid_last_name',
                'details' => ['last_name' => \substr($lastName, 0, 120)],
            ];
        }

        if ($phoneNumber !== '') {
            $phoneLength = \strlen($phoneNumber);

            if ($phoneLength < 6 || $phoneLength > 20) {
                $failures[] = [
                    'code' => 'invalid_phone_length',
                    'details' => ['phone_length' => $phoneLength],
                ];
            }
        }

        if ($email !== '' && \strlen($email) > 190) {
            $failures[] = [
                'code' => 'invalid_email_length',
                'details' => ['email_length' => \strlen($email)],
            ];
        }

        return $failures;
    }

    /**
     * @param array<string, mixed> $request
     * @return array<string, mixed>
     */
    private static function getActiveThrottleBlock(array $request): array
    {
        $currentTime = isset($request['current_time']) ? (int) $request['current_time'] : \time();

        foreach (self::getThrottleSignals($request) as $signal) {
            $state = self::getThrottleState($signal['key']);
            $blockedUntil = isset($state['blocked_until']) ? (int) $state['blocked_until'] : 0;

            if ($blockedUntil > $currentTime) {
                return [
                    'blocked' => true,
                    'signal_type' => $signal['type'],
                    'blocked_until' => $blockedUntil,
                    'remaining_seconds' => $blockedUntil - $currentTime,
                ];
            }
        }

        return ['blocked' => false];
    }

    /**
     * @param array<string, mixed> $request
     * @return array<string, mixed>
     */
    private static function registerAttempt(array $request): array
    {
        $windowMinutes = self::getWindowMinutes();
        $blockDurationMinutes = self::getBlockDurationMinutes();
        $windowSeconds = $windowMinutes * 60;
        $blockDurationSeconds = $blockDurationMinutes * 60;
        $currentTime = isset($request['current_time']) ? (int) $request['current_time'] : \time();

        foreach (self::getThrottleSignals($request) as $signal) {
            $state = self::getThrottleState($signal['key']);
            $attempts = isset($state['attempts']) && \is_array($state['attempts']) ? $state['attempts'] : [];
            $cutoff = $currentTime - $windowSeconds;
            $attempts = \array_values(
                \array_filter(
                    \array_map('intval', $attempts),
                    static function (int $attemptTimestamp) use ($cutoff): bool {
                        return $attemptTimestamp >= $cutoff;
                    }
                )
            );
            $attempts[] = $currentTime;
            $threshold = self::getThrottleThreshold((string) $signal['type']);
            $blockedUntil = 0;
            $blocked = \count($attempts) > $threshold;

            if ($blocked) {
                $blockedUntil = $currentTime + $blockDurationSeconds;
            }

            self::setThrottleState(
                $signal['key'],
                [
                    'attempts' => $attempts,
                    'blocked_until' => $blockedUntil,
                ],
                $windowSeconds + $blockDurationSeconds + 300
            );

            if ($blocked) {
                return [
                    'blocked' => true,
                    'signal_type' => $signal['type'],
                    'attempt_count' => \count($attempts),
                    'threshold' => $threshold,
                    'window_minutes' => $windowMinutes,
                    'block_duration_minutes' => $blockDurationMinutes,
                    'blocked_until' => $blockedUntil,
                ];
            }
        }

        return ['blocked' => false];
    }

    private static function getThrottleThreshold(string $signalType): int
    {
        $maxAttempts = self::getMaxAttempts();

        if ($signalType === 'ip') {
            return \max($maxAttempts * 2, $maxAttempts + 2);
        }

        return $maxAttempts;
    }

    /**
     * @param array<string, mixed> $request
     * @return array<int, array{type: string, key: string}>
     */
    private static function getThrottleSignals(array $request): array
    {
        $signals = [];
        $sessionHash = isset($request['session_hash']) ? (string) $request['session_hash'] : '';
        $email = isset($request['email']) ? (string) $request['email'] : '';
        $ip = isset($request['ip']) ? (string) $request['ip'] : '';

        if ($sessionHash !== '') {
            $signals[] = ['type' => 'session', 'key' => self::buildThrottleKey('session', $sessionHash)];
        }

        if ($email !== '') {
            $signals[] = ['type' => 'email', 'key' => self::buildThrottleKey('email', $email)];
        }

        if ($ip !== '' && $email !== '') {
            $signals[] = ['type' => 'combo', 'key' => self::buildThrottleKey('combo', $ip . '|' . $email)];
        }

        if ($ip !== '') {
            $signals[] = ['type' => 'ip', 'key' => self::buildThrottleKey('ip', $ip)];
        }

        return $signals;
    }

    private static function buildThrottleKey(string $type, string $value): string
    {
        return 'must_hotel_booking_abuse_' . $type . '_' . \substr(\hash('sha256', $value), 0, 40);
    }

    /**
     * @return array<string, mixed>
     */
    private static function getThrottleState(string $key): array
    {
        $state = \get_transient($key);

        return \is_array($state) ? $state : [];
    }

    /**
     * @param array<string, mixed> $state
     */
    private static function setThrottleState(string $key, array $state, int $expiration): void
    {
        \set_transient($key, $state, \max(60, $expiration));
    }

    /**
     * @param array<string, mixed> $context
     */
    private static function markStepStarted(array $context, string $field): void
    {
        if (!self::isEnabled() || !self::isMinimumSubmitTimeEnabled()) {
            return;
        }

        if (empty($context['is_valid'])) {
            return;
        }

        $flowData = \MustHotelBooking\Frontend\get_booking_selection_flow_data();
        $contextHash = self::buildContextHash($context);
        $storedHash = isset($flowData['anti_abuse_context_hash']) ? (string) $flowData['anti_abuse_context_hash'] : '';
        $updates = [];

        if ($storedHash !== $contextHash) {
            $updates['anti_abuse_context_hash'] = $contextHash;
            $updates['anti_abuse_checkout_started_at'] = 0;
            $updates['anti_abuse_confirmation_started_at'] = 0;
        }

        if (!isset($flowData[$field]) || (int) $flowData[$field] <= 0 || !empty($updates)) {
            $updates[$field] = \time();
        }

        if (!empty($updates)) {
            \MustHotelBooking\Frontend\update_booking_selection_flow_data($updates);
        }
    }

    /**
     * @param array<string, mixed> $context
     */
    private static function buildContextHash(array $context): string
    {
        $roomIds = \function_exists('\MustHotelBooking\Frontend\get_booking_selected_room_ids')
            ? \MustHotelBooking\Frontend\get_booking_selected_room_ids()
            : [];
        $payload = [
            'checkin' => isset($context['checkin']) ? (string) $context['checkin'] : '',
            'checkout' => isset($context['checkout']) ? (string) $context['checkout'] : '',
            'guests' => isset($context['guests']) ? (int) $context['guests'] : 0,
            'room_count' => isset($context['room_count']) ? (int) $context['room_count'] : 0,
            'room_ids' => \array_map('intval', $roomIds),
        ];

        return \substr(\hash('sha256', \wp_json_encode($payload) ?: \serialize($payload)), 0, 32);
    }

    private static function normalizeEmail(string $email): string
    {
        return \strtolower(\sanitize_email($email));
    }

    private static function getClientIp(): string
    {
        if (!isset($_SERVER['REMOTE_ADDR'])) {
            return '';
        }

        return \sanitize_text_field((string) \wp_unslash($_SERVER['REMOTE_ADDR']));
    }

    private static function getUserAgent(): string
    {
        if (!isset($_SERVER['HTTP_USER_AGENT'])) {
            return '';
        }

        return \substr(\sanitize_text_field((string) \wp_unslash($_SERVER['HTTP_USER_AGENT'])), 0, 255);
    }

    /**
     * @param array<string, mixed> $source
     * @param array<string, mixed> $flowData
     */
    private static function resolvePaymentMethod(array $source, array $flowData): string
    {
        if (isset($source['payment_method'])) {
            return \sanitize_key((string) \wp_unslash($source['payment_method']));
        }

        return isset($flowData['payment_method']) ? \sanitize_key((string) $flowData['payment_method']) : '';
    }

    private static function containsLetter(string $value): bool
    {
        return \preg_match('/\p{L}/u', $value) === 1;
    }

    private static function hashValue(string $value): string
    {
        if ($value === '') {
            return '';
        }

        return \substr(\hash('sha256', $value), 0, 24);
    }

    /**
     * @param array<string, mixed> $request
     * @param array<string, mixed> $details
     */
    private static function logBlockedAttempt(string $reasonCode, array $request, array $details = []): void
    {
        if (!self::isLoggingEnabled()) {
            return;
        }

        $reasonLabel = self::getReasonLabel($reasonCode);

        get_activity_repository()->createActivity(
            [
                'event_type' => self::EVENT_TYPE_BLOCKED,
                'severity' => 'warning',
                'entity_type' => 'booking_attempt',
                'entity_id' => 0,
                'reference' => self::getLogReference($request),
                'message' => \sprintf(
                    /* translators: %s is the booking abuse protection reason label. */
                    \__('Booking request blocked by abuse protection: %s.', 'must-hotel-booking'),
                    $reasonLabel
                ),
                'context_json' => \wp_json_encode(self::buildLogContext($reasonCode, $request, $details)),
                'actor_user_id' => \get_current_user_id(),
                'actor_role' => '',
                'actor_ip' => isset($request['ip']) ? (string) $request['ip'] : '',
                'created_at' => \current_time('mysql'),
            ]
        );
    }

    /**
     * @param array<string, mixed> $request
     * @param array<string, mixed> $details
     */
    private static function logSignal(string $reasonCode, array $request, array $details = []): void
    {
        if (!self::isLoggingEnabled()) {
            return;
        }

        $reasonLabel = self::getReasonLabel($reasonCode);

        get_activity_repository()->createActivity(
            [
                'event_type' => self::EVENT_TYPE_SIGNAL,
                'severity' => 'info',
                'entity_type' => 'booking_attempt',
                'entity_id' => 0,
                'reference' => self::getLogReference($request),
                'message' => \sprintf(
                    /* translators: %s is the booking abuse protection reason label. */
                    \__('Booking request noted by abuse protection: %s.', 'must-hotel-booking'),
                    $reasonLabel
                ),
                'context_json' => \wp_json_encode(self::buildLogContext($reasonCode, $request, $details)),
                'actor_user_id' => \get_current_user_id(),
                'actor_role' => '',
                'actor_ip' => isset($request['ip']) ? (string) $request['ip'] : '',
                'created_at' => \current_time('mysql'),
            ]
        );
    }

    /**
     * @param array<string, mixed> $request
     * @param array<string, mixed> $details
     * @return array<string, mixed>
     */
    private static function buildLogContext(string $reasonCode, array $request, array $details = []): array
    {
        $context = [
            'reason_code' => $reasonCode,
            'reason_label' => self::getReasonLabel($reasonCode),
            'surface' => isset($request['surface']) ? (string) $request['surface'] : '',
            'submitted_email' => isset($request['email']) ? (string) $request['email'] : '',
            'payment_method' => isset($request['payment_method']) ? (string) $request['payment_method'] : '',
            'checkin' => isset($request['checkin']) ? (string) $request['checkin'] : '',
            'checkout' => isset($request['checkout']) ? (string) $request['checkout'] : '',
            'session_hash' => isset($request['session_hash']) ? (string) $request['session_hash'] : '',
            'user_agent' => isset($request['user_agent']) ? (string) $request['user_agent'] : '',
        ];

        if (!empty($details)) {
            $context['details'] = $details;
        }

        return $context;
    }

    /**
     * @param array<string, mixed> $request
     */
    private static function getLogReference(array $request): string
    {
        return isset($request['email']) && (string) $request['email'] !== ''
            ? (string) $request['email']
            : \__('Website booking', 'must-hotel-booking');
    }

    private static function getReasonLabel(string $reasonCode): string
    {
        $labels = [
            'honeypot_triggered' => \__('hidden field completed', 'must-hotel-booking'),
            'minimum_submit_time' => \__('submitted too quickly', 'must-hotel-booking'),
            'missing_submit_timing' => \__('missing submit timing metadata', 'must-hotel-booking'),
            'throttle_active' => \__('temporary booking throttle active', 'must-hotel-booking'),
            'throttle_limit_exceeded' => \__('booking attempt limit exceeded', 'must-hotel-booking'),
            'invalid_first_name' => \__('invalid first name pattern', 'must-hotel-booking'),
            'invalid_last_name' => \__('invalid last name pattern', 'must-hotel-booking'),
            'invalid_phone_length' => \__('invalid phone number length', 'must-hotel-booking'),
            'invalid_email_length' => \__('invalid email length', 'must-hotel-booking'),
        ];

        return isset($labels[$reasonCode]) ? (string) $labels[$reasonCode] : \__('request validation failed', 'must-hotel-booking');
    }

    /**
     * @return array{allowed: true, message: string}
     */
    private static function allow(): array
    {
        return [
            'allowed' => true,
            'message' => '',
        ];
    }

    /**
     * @return array{allowed: false, message: string}
     */
    private static function deny(): array
    {
        return [
            'allowed' => false,
            'message' => self::getGenericFailureMessage(),
        ];
    }
}
