<?php

namespace MustHotelBooking\Engine;

use MustHotelBooking\Database\PublicBookingAccessRepository;

/**
 * Central boundary for public confirmation and cancellation authorization.
 */
final class PublicBookingAccessService
{
    public const PURPOSE_VIEW_CONFIRMATION = 'view_confirmation';
    public const PURPOSE_REVIEW_CANCELLATION = 'review_cancellation';
    public const PURPOSE_CONFIRM_CANCELLATION = 'confirm_cancellation';
    public const TOKEN_BYTES = 32;
    public const VIEW_CONFIRMATION_TTL = 2592000;
    public const REVIEW_CANCELLATION_TTL = 2592000;
    public const CONFIRM_CANCELLATION_TTL = 600;
    public const MAX_RESERVATION_GROUP_SIZE = 25;
    public const MAX_RESERVATION_GROUP_INPUT_SIZE = 100;
    public const MAX_RESERVATION_GROUP_JSON_BYTES = 1024;

    /** @var object */
    private $repository;

    /** @var callable */
    private $clock;

    /**
     * @param object|null $repository Test doubles may implement the repository methods used here.
     * @param callable|null $clock Returns the current UTC Unix timestamp.
     */
    public function __construct($repository = null, ?callable $clock = null)
    {
        $this->repository = $repository ?: new PublicBookingAccessRepository();
        $this->clock = $clock ?: static function (): int {
            return time();
        };
    }

    /**
     * @param array<int, mixed> $reservationIds
     * @param array<string, mixed> $metadata
     * @return array<string, mixed>
     */
    public function issueGrant(array $reservationIds, string $purpose, int $ttlSeconds, array $metadata = []): array
    {
        if (!self::areReservationIdsWellFormed($reservationIds)) {
            return self::failure('invalid_grant_request');
        }
        $reservationIds = self::normalizeReservationIds($reservationIds);
        $purpose = sanitize_key($purpose);
        $ttlSeconds = max(1, $ttlSeconds);

        if (empty($reservationIds) || !self::isSupportedPurpose($purpose)) {
            return self::failure('invalid_grant_request');
        }

        try {
            $rawToken = bin2hex(random_bytes(self::TOKEN_BYTES));
        } catch (\Throwable $exception) {
            return self::failure('secure_random_unavailable');
        }

        $tokenHash = self::hashToken($rawToken);
        if ($tokenHash === '') {
            return self::failure('token_hash_unavailable');
        }

        $now = (int) call_user_func($this->clock);
        $expiresAtTimestamp = $now + $ttlSeconds;
        $record = [
            'token_hash' => $tokenHash,
            'purpose' => $purpose,
            'reservation_ids' => self::canonicalReservationIdsJson($reservationIds),
            'reservation_set_hash' => self::reservationSetHash($reservationIds),
            'created_at' => gmdate('Y-m-d H:i:s', $now),
            'expires_at' => gmdate('Y-m-d H:i:s', $expiresAtTimestamp),
            'expires_at_timestamp' => $expiresAtTimestamp,
            'revoked_at' => null,
            'first_used_at' => null,
            'last_used_at' => null,
            'execution_status' => 'available',
            'consumed_at' => null,
            'claimed_at' => null,
            'completed_at' => null,
            'failed_at' => null,
            'metadata_json' => self::encodeMetadata($metadata),
        ];

        if ($purpose === self::PURPOSE_CONFIRM_CANCELLATION) {
            $record['operation_key'] = self::cancellationOperationKey((string) $record['reservation_set_hash']);
        }

        if (strlen((string) $record['reservation_ids']) > self::MAX_RESERVATION_GROUP_JSON_BYTES) {
            return self::failure('invalid_grant_request');
        }

        $grantId = (int) $this->repository->insertGrant($record);
        if ($grantId <= 0) {
            return self::failure('grant_persistence_failed');
        }

        return [
            'success' => true,
            'grant_id' => $grantId,
            'token' => $rawToken,
            'expires_at' => $record['expires_at'],
            'reservation_ids' => $reservationIds,
            'purpose' => $purpose,
        ];
    }

    /**
     * @param array<int, mixed> $trustedReservationIds
     * @return array<string, mixed>
     */
    public function authorizeToken(string $rawToken, string $purpose, array $trustedReservationIds = []): array
    {
        $purpose = sanitize_key($purpose);
        if (!self::isValidRawToken($rawToken) || !self::isSupportedPurpose($purpose)) {
            return self::failure('invalid_public_access');
        }

        $tokenHash = self::hashToken($rawToken);
        $row = $this->repository->findByTokenHash($tokenHash);
        if (!is_array($row)) {
            return self::failure('invalid_public_access');
        }

        $storedHash = strtolower(trim((string) ($row['token_hash'] ?? '')));
        if ($storedHash === '' || !hash_equals($storedHash, strtolower($tokenHash))) {
            return self::failure('invalid_public_access');
        }

        if ((string) ($row['purpose'] ?? '') !== $purpose) {
            return self::failure('invalid_public_access');
        }

        $reservationIds = self::decodeCanonicalReservationIds((string) ($row['reservation_ids'] ?? ''));
        if (empty($reservationIds)) {
            return self::failure('invalid_public_access');
        }

        $canonicalJson = self::canonicalReservationIdsJson($reservationIds);
        $storedJson = (string) ($row['reservation_ids'] ?? '');
        if ($canonicalJson !== $storedJson) {
            return self::failure('invalid_public_access');
        }

        $calculatedSetHash = self::reservationSetHash($reservationIds);
        $storedSetHash = strtolower(trim((string) ($row['reservation_set_hash'] ?? '')));
        if ($storedSetHash === '' || !hash_equals($storedSetHash, $calculatedSetHash)) {
            return self::failure('invalid_public_access');
        }

        $expiresAt = self::parseUtcTimestamp((string) ($row['expires_at'] ?? ''));
        $now = (int) call_user_func($this->clock);
        if ($expiresAt <= 0 || $now >= $expiresAt || trim((string) ($row['revoked_at'] ?? '')) !== '') {
            return self::failure('invalid_public_access');
        }

        if ($purpose === self::PURPOSE_CONFIRM_CANCELLATION) {
            if (
                (string) ($row['execution_status'] ?? '') !== 'available'
                || trim((string) ($row['consumed_at'] ?? '')) !== ''
            ) {
                return self::failure('invalid_public_access');
            }
        }

        if (!self::areReservationIdsWellFormed($trustedReservationIds)) {
            return self::failure('invalid_public_access');
        }
        $trustedReservationIds = self::normalizeReservationIds($trustedReservationIds);
        if (!empty($trustedReservationIds) && $trustedReservationIds !== $reservationIds) {
            return self::failure('invalid_public_access');
        }

        $grantId = (int) ($row['id'] ?? 0);
        if ($grantId > 0 && $purpose !== self::PURPOSE_CONFIRM_CANCELLATION) {
            $this->repository->touchUsage($grantId, gmdate('Y-m-d H:i:s', $now));
        }

        return [
            'success' => true,
            'grant_id' => $grantId,
            'purpose' => $purpose,
            'reservation_ids' => $reservationIds,
            'reservation_set_hash' => $calculatedSetHash,
            'expires_at' => (string) ($row['expires_at'] ?? ''),
            'execution_status' => (string) ($row['execution_status'] ?? 'available'),
        ];
    }

    /**
     * Issue a short-lived cancellation execution grant only after the caller
     * has verified the review grant, current eligibility, and WordPress nonce.
     *
     * @param array<int, mixed> $trustedReservationIds
     * @param array<string, mixed> $metadata
     * @return array<string, mixed>
     */
    public function issueCancellationConfirmationGrant(
        string $reviewToken,
        array $trustedReservationIds,
        bool $currentEligibility,
        bool $nonceVerified,
        array $metadata = []
    ): array {
        if (!$currentEligibility || !$nonceVerified) {
            return self::failure('invalid_cancellation_precondition');
        }

        $review = $this->authorizeToken($reviewToken, self::PURPOSE_REVIEW_CANCELLATION, $trustedReservationIds);
        if (empty($review['success'])) {
            return self::failure('invalid_public_access');
        }

        $reservationSetHash = (string) ($review['reservation_set_hash'] ?? '');
        if ($reservationSetHash === '' || $this->repository->hasActiveCancellationExecution($reservationSetHash, gmdate('Y-m-d H:i:s', (int) call_user_func($this->clock)))) {
            return self::failure('cancellation_execution_exists');
        }

        $metadata['parent_grant_id'] = (int) ($review['grant_id'] ?? 0);
        return $this->issueGrant(
            (array) ($review['reservation_ids'] ?? []),
            self::PURPOSE_CONFIRM_CANCELLATION,
            self::CONFIRM_CANCELLATION_TTL,
            $metadata
        );
    }

    /**
     * Atomically consume a confirmation grant before any cancellation mutation.
     *
     * @param array<int, mixed> $trustedReservationIds
     * @return array<string, mixed>
     */
    public function claimCancellation(string $rawToken, array $trustedReservationIds = []): array
    {
        $grant = $this->authorizeToken($rawToken, self::PURPOSE_CONFIRM_CANCELLATION, $trustedReservationIds);
        if (empty($grant['success'])) {
            return self::failure('invalid_public_access');
        }

        $now = (int) call_user_func($this->clock);
        if (!$this->repository->claimCancellation((int) ($grant['grant_id'] ?? 0), gmdate('Y-m-d H:i:s', $now))) {
            return self::failure('cancellation_already_claimed');
        }

        $grant['execution_status'] = 'claimed';
        $grant['consumed_at'] = gmdate('Y-m-d H:i:s', $now);
        return $grant;
    }

    public function revokeGrant(int $grantId): bool
    {
        if ($grantId <= 0) {
            return false;
        }
        return (bool) $this->repository->revoke($grantId, gmdate('Y-m-d H:i:s', (int) call_user_func($this->clock)));
    }

    public function markCancellationCompleted(int $grantId): bool
    {
        if ($grantId <= 0 || !method_exists($this->repository, 'markCancellationCompleted')) {
            return false;
        }

        return (bool) $this->repository->markCancellationCompleted(
            $grantId,
            gmdate('Y-m-d H:i:s', (int) call_user_func($this->clock))
        );
    }

    public function markCancellationFailedManualReview(int $grantId): bool
    {
        if ($grantId <= 0 || !method_exists($this->repository, 'markCancellationFailedManualReview')) {
            return false;
        }

        return (bool) $this->repository->markCancellationFailedManualReview(
            $grantId,
            gmdate('Y-m-d H:i:s', (int) call_user_func($this->clock))
        );
    }

    /** @param array<string, mixed> $refundResult */
    public static function canCompleteRefundOutcome(array $refundResult): bool
    {
        return !empty($refundResult['success'])
            && (string) ($refundResult['status'] ?? '') === 'succeeded';
    }

    /** @param array<string, mixed> $cancelResult */
    public static function canCompleteLocalCancellationOutcome(array $cancelResult): bool
    {
        return !empty($cancelResult['success']) && empty($cancelResult['queued']);
    }

    /**
     * Build a public URL whose reservation scope comes only from the new grant.
     *
     * @param array<int, mixed> $reservationIds
     * @param array<string, mixed> $query
     */
    public function buildPublicUrl(
        string $baseUrl,
        array $reservationIds,
        string $purpose,
        array $query = [],
        ?int $ttlSeconds = null
    ): string {
        $purpose = sanitize_key($purpose);
        if (!self::isSupportedPurpose($purpose)) {
            return '';
        }

        if ($ttlSeconds === null) {
            $ttlSeconds = $purpose === self::PURPOSE_CONFIRM_CANCELLATION
                ? self::CONFIRM_CANCELLATION_TTL
                : ($purpose === self::PURPOSE_REVIEW_CANCELLATION
                    ? self::REVIEW_CANCELLATION_TTL
                    : self::VIEW_CONFIRMATION_TTL);
        }

        $grant = $this->issueGrant($reservationIds, $purpose, $ttlSeconds, ['source' => 'public_url']);
        if (empty($grant['success']) || (string) ($grant['token'] ?? '') === '') {
            return '';
        }

        $safeQuery = [];
        foreach ($query as $key => $value) {
            $key = sanitize_key((string) $key);
            if ($key === '' || in_array($key, [
                'access_token',
                'access_context',
                'token',
                'auth_token',
                'refresh_token',
                'id_token',
                'authorization',
                'client_secret',
                'api_key',
                'webhook_secret',
                'payment_token',
                'reservation_ids',
                'reservation_id',
                'booking_id',
                'cancel_token',
            ], true)) {
                continue;
            }
            if (is_scalar($value)) {
                $safeQuery[$key] = (string) $value;
            }
        }
        $safeQuery['access_token'] = (string) $grant['token'];
        return function_exists('add_query_arg')
            ? (string) add_query_arg($safeQuery, $baseUrl)
            : $baseUrl;
    }

    public function removeAccessTokenFromUrl(string $url): string
    {
        if (function_exists('remove_query_arg')) {
            return (string) remove_query_arg('access_token', $url);
        }

        $parts = parse_url($url);
        if (!is_array($parts)) {
            return $url;
        }
        $query = [];
        if (isset($parts['query'])) {
            parse_str((string) $parts['query'], $query);
        }
        unset($query['access_token']);
        $clean = '';
        if (isset($parts['scheme'])) {
            $clean .= $parts['scheme'] . '://';
        }
        $clean .= (string) ($parts['host'] ?? '');
        $clean .= (string) ($parts['path'] ?? '');
        return $clean . (!empty($query) ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
    }

    public function removeAccessContextFromUrl(string $url): string
    {
        if (function_exists('remove_query_arg')) {
            return (string) remove_query_arg('access_context', $url);
        }

        $parts = parse_url($url);
        if (!is_array($parts)) {
            return $url;
        }
        $query = [];
        if (isset($parts['query'])) {
            parse_str((string) $parts['query'], $query);
        }
        unset($query['access_context']);
        $clean = '';
        if (isset($parts['scheme'])) {
            $clean .= $parts['scheme'] . '://';
        }
        $clean .= (string) ($parts['host'] ?? '');
        $clean .= (string) ($parts['path'] ?? '');
        return $clean . (!empty($query) ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
    }

    /**
     * Exchange a validated grant for a short-lived per-tab context.
     * The context stores only a digest and the grant's reservation-set hash.
     *
     * @param array<int, mixed> $trustedReservationIds
     * @return array<string, mixed>
     */
    public function createAccessContext(
        string $rawToken,
        string $purpose,
        array $trustedReservationIds = [],
        ?int $ttlSeconds = null
    ): array {
        if (!method_exists($this->repository, 'createAccessContext')) {
            return self::failure('context_persistence_unavailable');
        }

        $authorization = $this->authorizeToken($rawToken, $purpose, $trustedReservationIds);
        if (empty($authorization['success'])) {
            return self::failure('invalid_public_access');
        }

        $now = (int) call_user_func($this->clock);
        $grantExpiresAt = self::parseUtcTimestamp((string) ($authorization['expires_at'] ?? ''));
        $remaining = $grantExpiresAt - $now;
        if ($remaining <= 0) {
            return self::failure('invalid_public_access');
        }
        $ttlSeconds = $ttlSeconds === null ? $remaining : max(1, $ttlSeconds);
        $ttlSeconds = min($ttlSeconds, $remaining);

        try {
            $selector = bin2hex(random_bytes(self::TOKEN_BYTES));
        } catch (\Throwable $exception) {
            return self::failure('secure_random_unavailable');
        }

        $contextHash = self::hashContext($selector);
        $record = [
            'context_hash' => $contextHash,
            'grant_id' => (int) ($authorization['grant_id'] ?? 0),
            'purpose' => sanitize_key($purpose),
            'reservation_set_hash' => (string) ($authorization['reservation_set_hash'] ?? ''),
            'created_at' => gmdate('Y-m-d H:i:s', $now),
            'expires_at' => gmdate('Y-m-d H:i:s', $now + $ttlSeconds),
            'revoked_at' => null,
        ];
        $contextId = (int) $this->repository->createAccessContext($record);
        if ($contextId <= 0) {
            return self::failure('context_persistence_failed');
        }

        return [
            'success' => true,
            'context' => $selector,
            'context_id' => $contextId,
            'grant_id' => (int) ($authorization['grant_id'] ?? 0),
            'purpose' => sanitize_key($purpose),
            'reservation_ids' => (array) ($authorization['reservation_ids'] ?? []),
            'expires_at' => $record['expires_at'],
        ];
    }

    /**
     * Authorize a per-tab context and the raw grant held by its matching cookie.
     *
     * @param array<int, mixed> $trustedReservationIds
     * @return array<string, mixed>
     */
    public function authorizeContext(
        string $contextSelector,
        string $rawToken,
        string $purpose,
        array $trustedReservationIds = []
    ): array {
        $purpose = sanitize_key($purpose);
        if (
            !self::isValidContextSelector($contextSelector)
            || !self::isValidRawToken($rawToken)
            || !self::isSupportedPurpose($purpose)
            || !method_exists($this->repository, 'findAccessContextByHash')
        ) {
            return self::failure('invalid_public_access');
        }

        $contextHash = self::hashContext($contextSelector);
        $context = $this->repository->findAccessContextByHash($contextHash);
        if (!is_array($context)) {
            return self::failure('invalid_public_access');
        }
        $storedContextHash = strtolower(trim((string) ($context['context_hash'] ?? '')));
        if ($storedContextHash === '' || !hash_equals($storedContextHash, strtolower($contextHash))) {
            return self::failure('invalid_public_access');
        }
        if ((string) ($context['purpose'] ?? '') !== $purpose) {
            return self::failure('invalid_public_access');
        }

        $now = (int) call_user_func($this->clock);
        $expiresAt = self::parseUtcTimestamp((string) ($context['expires_at'] ?? ''));
        if ($expiresAt <= 0 || $now >= $expiresAt || trim((string) ($context['revoked_at'] ?? '')) !== '') {
            return self::failure('invalid_public_access');
        }

        $authorization = $this->authorizeToken($rawToken, $purpose, $trustedReservationIds);
        if (empty($authorization['success'])) {
            return self::failure('invalid_public_access');
        }
        if ((int) ($context['grant_id'] ?? 0) !== (int) ($authorization['grant_id'] ?? 0)) {
            return self::failure('invalid_public_access');
        }
        if (
            (string) ($context['reservation_set_hash'] ?? '') === ''
            || !hash_equals(
                strtolower((string) ($context['reservation_set_hash'] ?? '')),
                strtolower((string) ($authorization['reservation_set_hash'] ?? ''))
            )
        ) {
            return self::failure('invalid_public_access');
        }

        $authorization['context'] = $contextSelector;
        $authorization['context_id'] = (int) ($context['id'] ?? 0);
        return $authorization;
    }

    /** @return array<string, mixed> */
    public function authorizeRequest(
        string $purpose,
        array $query,
        array $cookies,
        array $trustedReservationIds = []
    ): array {
        $token = $this->getRequestToken($purpose, $query, $cookies);
        if ($token === '') {
            return self::failure('invalid_public_access');
        }
        $contextSelector = isset($query['access_context'])
            ? trim((string) $query['access_context'])
            : '';
        if ($contextSelector !== '') {
            return $this->authorizeContext($contextSelector, $token, $purpose, $trustedReservationIds);
        }
        return $this->authorizeToken($token, $purpose, $trustedReservationIds);
    }

    public function getRequestContextSelector(array $query): string
    {
        $selector = isset($query['access_context']) ? trim((string) $query['access_context']) : '';
        return self::isValidContextSelector($selector) ? $selector : '';
    }

    public function getContextCookieName(string $purpose, string $contextSelector): string
    {
        $purpose = sanitize_key($purpose);
        if (!self::isSupportedPurpose($purpose) || !self::isValidContextSelector($contextSelector)) {
            return '';
        }

        $purposeShort = [
            self::PURPOSE_VIEW_CONFIRMATION => 'view',
            self::PURPOSE_REVIEW_CANCELLATION => 'review',
            self::PURPOSE_CONFIRM_CANCELLATION => 'confirm',
        ][$purpose] ?? '';
        if ($purposeShort === '') {
            return '';
        }

        return 'mhb_public_ctx_' . $purposeShort . '_' . substr(hash('sha256', $contextSelector), 0, 20);
    }

    public function setAccessContextCookie(string $purpose, string $contextSelector, string $rawToken, int $maxAge): bool
    {
        $cookieName = $this->getContextCookieName($purpose, $contextSelector);
        if ($cookieName === '' || !self::isValidRawToken($rawToken) || $maxAge <= 0 || !function_exists('setcookie')) {
            return false;
        }

        return (bool) setcookie(
            $cookieName,
            $rawToken,
            [
                'expires' => time() + $maxAge,
                'path' => '/',
                'secure' => !function_exists('is_ssl') || (bool) is_ssl(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]
        );
    }

    public function clearAccessContextCookie(string $purpose, string $contextSelector): bool
    {
        $cookieName = $this->getContextCookieName($purpose, $contextSelector);
        if ($cookieName === '' || !function_exists('setcookie')) {
            return false;
        }

        return (bool) setcookie(
            $cookieName,
            '',
            [
                'expires' => time() - 3600,
                'path' => '/',
                'secure' => !function_exists('is_ssl') || (bool) is_ssl(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]
        );
    }

    /**
     * @param array<string, mixed> $query
     * @param array<string, mixed> $cookies
     */
    public function getRequestToken(string $purpose, array $query, array $cookies): string
    {
        $purpose = sanitize_key($purpose);
        if (!self::isSupportedPurpose($purpose)) {
            return '';
        }

        if (array_key_exists('access_token', $query)) {
            $queryToken = trim((string) $query['access_token']);
            return self::isValidRawToken($queryToken) ? $queryToken : '';
        }

        $contextSelector = $this->getRequestContextSelector($query);
        $cookieName = $this->getContextCookieName($purpose, $contextSelector);
        $cookieToken = isset($cookies[$cookieName]) ? trim((string) $cookies[$cookieName]) : '';
        return self::isValidRawToken($cookieToken) ? $cookieToken : '';
    }

    public function getAccessCookieName(string $purpose): string
    {
        // There is intentionally no shared purpose cookie: a shared bearer
        // cookie lets concurrent tabs cross-authorize different grants.
        return '';
    }

    public function setAccessCookie(string $purpose, string $rawToken, int $maxAge): bool
    {
        return false;
    }

    public function clearAccessCookie(string $purpose): bool
    {
        return false;
    }

    /** @param array<int, mixed> $reservationIds */
    public static function normalizeReservationIds(array $reservationIds): array
    {
        if (count($reservationIds) > self::MAX_RESERVATION_GROUP_INPUT_SIZE) {
            return [];
        }

        $ids = [];
        foreach ($reservationIds as $reservationId) {
            if (!self::isValidReservationId($reservationId)) {
                return [];
            }
            $normalizedId = (int) $reservationId;
            $ids[$normalizedId] = $normalizedId;
        }
        $ids = array_values($ids);
        if (count($ids) > self::MAX_RESERVATION_GROUP_SIZE) {
            return [];
        }
        sort($ids, SORT_NUMERIC);
        return $ids;
    }

    /** @param array<int, mixed> $reservationIds */
    private static function areReservationIdsWellFormed(array $reservationIds): bool
    {
        if (count($reservationIds) > self::MAX_RESERVATION_GROUP_INPUT_SIZE) {
            return false;
        }

        foreach ($reservationIds as $reservationId) {
            if (!self::isValidReservationId($reservationId)) {
                return false;
            }
        }

        return count(self::normalizeReservationIds($reservationIds)) <= self::MAX_RESERVATION_GROUP_SIZE;
    }

    /** @param mixed $reservationId */
    private static function isValidReservationId($reservationId): bool
    {
        if (is_int($reservationId)) {
            return $reservationId > 0;
        }

        if (!is_string($reservationId) || !preg_match('/\A[1-9][0-9]*\z/D', $reservationId)) {
            return false;
        }

        return filter_var($reservationId, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]) !== false;
    }

    /** @param array<int, int> $reservationIds */
    public static function canonicalReservationIdsJson(array $reservationIds): string
    {
        $json = wp_json_encode(self::normalizeReservationIds($reservationIds), JSON_UNESCAPED_SLASHES);
        return is_string($json) ? $json : '[]';
    }

    /** @param array<int, int> $reservationIds */
    public static function reservationSetHash(array $reservationIds): string
    {
        return hash('sha256', implode(',', self::normalizeReservationIds($reservationIds)));
    }

    public static function cancellationOperationKey(string $reservationSetHash): string
    {
        return hash('sha256', self::PURPOSE_CONFIRM_CANCELLATION . '|' . $reservationSetHash);
    }

    public static function hashToken(string $rawToken): string
    {
        $salt = function_exists('wp_salt') ? (string) wp_salt('auth') : '';
        if ($salt === '' || $rawToken === '') {
            return '';
        }
        return hash_hmac('sha256', $rawToken, $salt);
    }

    public static function hashContext(string $contextSelector): string
    {
        return self::hashToken($contextSelector);
    }

    private static function isValidRawToken(string $rawToken): bool
    {
        return (bool) preg_match('/\A[a-f0-9]{64}\z/i', trim($rawToken));
    }

    private static function isValidContextSelector(string $contextSelector): bool
    {
        return (bool) preg_match('/\A[a-f0-9]{64}\z/i', trim($contextSelector));
    }

    private static function isSupportedPurpose(string $purpose): bool
    {
        return in_array($purpose, [
            self::PURPOSE_VIEW_CONFIRMATION,
            self::PURPOSE_REVIEW_CANCELLATION,
            self::PURPOSE_CONFIRM_CANCELLATION,
        ], true);
    }

    /** @return array<int, int> */
    private static function decodeCanonicalReservationIds(string $json): array
    {
        if ($json === '' || strlen($json) > self::MAX_RESERVATION_GROUP_JSON_BYTES) {
            return [];
        }
        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            return [];
        }
        $normalized = self::normalizeReservationIds($decoded);
        return self::canonicalReservationIdsJson($normalized) === $json ? $normalized : [];
    }

    private static function parseUtcTimestamp(string $value): int
    {
        if ($value === '') {
            return 0;
        }
        $timestamp = strtotime($value . ' UTC');
        return $timestamp === false ? 0 : (int) $timestamp;
    }

    /** @param array<string, mixed> $metadata */
    private static function encodeMetadata(array $metadata): string
    {
        $safe = [];
        foreach (['source', 'operation', 'provider', 'flow', 'parent_grant_id'] as $key) {
            if (!array_key_exists($key, $metadata) || !is_scalar($metadata[$key])) {
                continue;
            }
            if ($key === 'parent_grant_id') {
                $safe[$key] = (int) $metadata[$key];
                continue;
            }
            $value = sanitize_key((string) $metadata[$key]);
            if ($value !== '') {
                $safe[$key] = $value;
            }
        }
        ksort($safe);
        $json = wp_json_encode($safe, JSON_UNESCAPED_SLASHES);
        return is_string($json) ? $json : '{}';
    }

    /** @return array<string, mixed> */
    private static function failure(string $reason): array
    {
        return [
            'success' => false,
            'reason' => $reason,
        ];
    }
}
