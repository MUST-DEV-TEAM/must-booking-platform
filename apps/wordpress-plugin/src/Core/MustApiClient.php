<?php

namespace MustHotelBooking\Core;

/**
 * Server-side client for the MUST Public API. WordPress's own server makes these
 * calls on the guest's behalf (not the guest's browser), so there is no CORS or
 * cross-origin cookie concern here. This class relays the anonymous guest-session
 * cookie MUST issues (must_guest_session) through a first-party WordPress cookie
 * (must_wp_guest_session), so the same guest session is reused across page loads.
 */
final class MustApiClient
{
    private const WP_GUEST_COOKIE = 'must_wp_guest_session';

    /** @param array<string, mixed> $query @return array{ok: bool, status: int, body: array<string, mixed>|null} */
    public static function get(string $path, array $query = []): array
    {
        return self::request('GET', $path, $query);
    }

    /** @param array<string, mixed> $body @return array{ok: bool, status: int, body: array<string, mixed>|null} */
    public static function post(string $path, array $body, ?string $idempotencyKey = null): array
    {
        return self::request('POST', $path, [], $body, $idempotencyKey);
    }

    /** @param array<string, mixed> $body @return array{ok: bool, status: int, body: array<string, mixed>|null} */
    public static function patch(string $path, array $body, ?string $idempotencyKey = null): array
    {
        return self::request('PATCH', $path, [], $body, $idempotencyKey);
    }

    /** @param array<string, mixed> $body @return array{ok: bool, status: int, body: array<string, mixed>|null} */
    public static function delete(string $path, array $body = [], ?string $idempotencyKey = null): array
    {
        return self::request('DELETE', $path, [], $body, $idempotencyKey);
    }

    public static function basePath(): string
    {
        return '/tenants/' . \rawurlencode(MustBookingConfig::get_must_tenant_id())
            . '/properties/' . \rawurlencode(MustBookingConfig::get_must_property_id());
    }

    /** The current guest's session identifier, if a MUST API call has already established one. */
    public static function guestSessionId(): ?string
    {
        return self::guestCookieValue();
    }

    /**
     * @param array<string, mixed> $query
     * @param array<string, mixed>|null $body
     * @return array{ok: bool, status: int, body: array<string, mixed>|null}
     */
    private static function request(string $method, string $path, array $query = [], ?array $body = null, ?string $idempotencyKey = null): array
    {
        $baseUrl = MustBookingConfig::get_must_api_base_url();
        if ($baseUrl === '') {
            return ['ok' => false, 'status' => 0, 'body' => null];
        }

        $url = \rtrim($baseUrl, '/') . self::basePath() . $path;
        if (!empty($query)) {
            $url .= (\strpos($path, '?') === false ? '?' : '&') . \http_build_query($query);
        }

        $headers = ['Content-Type' => 'application/json'];
        $guestSession = self::guestCookieValue();
        if ($guestSession !== null) {
            $headers['Cookie'] = 'must_guest_session=' . $guestSession;
        }
        if ($idempotencyKey !== null) {
            $headers['Idempotency-Key'] = $idempotencyKey;
        }

        $host = (string) (\wp_parse_url($url, \PHP_URL_HOST) ?? '');
        $args = [
            'method' => $method,
            'headers' => $headers,
            'timeout' => 15,
            'redirection' => 0,
            // Local dev only: the API's self-signed cert on localhost isn't in PHP's trusted
            // CA bundle. A real deployment always points must_api_base_url at a real host with
            // a properly-issued certificate, so this never applies outside local development.
            'sslverify' => !\in_array($host, ['localhost', '127.0.0.1'], true),
        ];
        if ($body !== null) {
            $args['body'] = \wp_json_encode($body);
        }

        $response = \wp_remote_request($url, $args);
        if (\is_wp_error($response)) {
            return ['ok' => false, 'status' => 0, 'body' => null];
        }

        self::relayCookieFromResponse($response);

        $status = (int) \wp_remote_retrieve_response_code($response);
        $decoded = \json_decode((string) \wp_remote_retrieve_body($response), true);

        return [
            'ok' => $status >= 200 && $status < 300,
            'status' => $status,
            'body' => \is_array($decoded) ? $decoded : null,
        ];
    }

    private static function guestCookieValue(): ?string
    {
        $value = isset($_COOKIE[self::WP_GUEST_COOKIE]) ? \sanitize_text_field((string) \wp_unslash($_COOKIE[self::WP_GUEST_COOKIE])) : '';
        return $value !== '' ? $value : null;
    }

    /** @param array<string, mixed>|\WP_HTTP_Requests_Response|array $response */
    private static function relayCookieFromResponse($response): void
    {
        if (\headers_sent()) {
            return;
        }
        $setCookieHeaders = \wp_remote_retrieve_header($response, 'set-cookie');
        $setCookieHeaders = \is_array($setCookieHeaders) ? $setCookieHeaders : (empty($setCookieHeaders) ? [] : [$setCookieHeaders]);
        foreach ($setCookieHeaders as $setCookie) {
            if (\preg_match('/^must_guest_session=([^;]+)/', (string) $setCookie, $matches) !== 1) {
                continue;
            }
            $existing = self::guestCookieValue();
            if ($existing === $matches[1]) {
                continue;
            }
            \setcookie(self::WP_GUEST_COOKIE, $matches[1], [
                'expires' => \time() + \DAY_IN_SECONDS,
                'path' => '/',
                'httponly' => true,
                'samesite' => 'Lax',
                'secure' => \is_ssl(),
            ]);
            $_COOKIE[self::WP_GUEST_COOKIE] = $matches[1];
            return;
        }
    }
}
