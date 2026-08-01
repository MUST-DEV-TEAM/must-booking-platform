<?php

namespace MustHotelBooking\Core;

final class PublicCallbackUrl
{
    public static function registerHooks(): void
    {
        \add_filter('redirect_canonical', [self::class, 'maybeDisableCanonicalRedirect'], 10, 2);
        \add_filter('home_url', [self::class, 'maybeRewriteGeneratedUrl'], 10, 4);
        \add_filter('site_url', [self::class, 'maybeRewriteGeneratedUrl'], 10, 4);
        \add_filter('rest_url', [self::class, 'maybeRewriteGeneratedUrl'], 10, 4);
        \add_filter('script_loader_src', [self::class, 'maybeRewriteAssetUrl']);
        \add_filter('style_loader_src', [self::class, 'maybeRewriteAssetUrl']);
        \add_filter('plugins_url', [self::class, 'maybeRewriteAssetUrl']);
        \add_filter('content_url', [self::class, 'maybeRewriteAssetUrl']);
        \add_action('template_redirect', [self::class, 'maybeStartOutputBuffer'], 0);
    }

    /**
     * @param string|false $redirectUrl
     * @param string $requestedUrl
     * @return string|false
     */
    public static function maybeDisableCanonicalRedirect($redirectUrl, string $requestedUrl)
    {
        unset($requestedUrl);

        return self::isPublicCallbackRequest() ? false : $redirectUrl;
    }

    public static function isPublicCallbackRequest(): bool
    {
        $base = MustBookingConfig::get_public_callback_base_url();

        if ($base === '') {
            return false;
        }

        $baseParts = \wp_parse_url($base);
        $baseHost = isset($baseParts['host']) ? \strtolower((string) $baseParts['host']) : '';

        if ($baseHost === '') {
            return false;
        }

        $requestHost = isset($_SERVER['HTTP_HOST']) ? \strtolower((string) \wp_unslash($_SERVER['HTTP_HOST'])) : '';

        if ($requestHost === '') {
            return false;
        }

        $requestHost = \preg_replace('/:\d+$/', '', $requestHost);

        return $requestHost === $baseHost;
    }

    /**
     * @param string $url
     * @param string $path
     * @param string|null $scheme
     * @param int|null $blogId
     */
    public static function maybeRewriteGeneratedUrl(string $url, $arg1 = null, $arg2 = null, $arg3 = null): string
    {
        unset($arg1, $arg2, $arg3);

        return self::isPublicCallbackRequest() ? MustBookingConfig::build_public_callback_url($url) : $url;
    }

    public static function maybeRewriteAssetUrl(string $url): string
    {
        return self::isPublicCallbackRequest() ? MustBookingConfig::build_public_callback_url($url) : $url;
    }

    public static function maybeStartOutputBuffer(): void
    {
        if (!self::isPublicCallbackRequest()) {
            return;
        }

        if (\is_admin() || \wp_doing_ajax()) {
            return;
        }

        \ob_start([self::class, 'rewriteBufferedOutput']);
    }

    public static function rewriteBufferedOutput(string $content): string
    {
        $base = MustBookingConfig::get_public_callback_base_url();

        if ($content === '' || $base === '') {
            return $content;
        }

        foreach (self::getLocalOrigins() as $origin) {
            $escapedOrigin = \str_replace('/', '\\/', $origin);
            $escapedBase = \str_replace('/', '\\/', $base);

            $content = \str_replace($origin . '//', $base . '/', $content);
            $content = \str_replace($origin . '/', $base . '/', $content);
            $content = \str_replace($origin, $base, $content);
            $content = \str_replace($escapedOrigin . '\\/\\/', $escapedBase . '\\/', $content);
            $content = \str_replace($escapedOrigin . '\\/', $escapedBase . '\\/', $content);
            $content = \str_replace($escapedOrigin, $escapedBase, $content);
        }

        $publicHost = self::getPublicCallbackHost($base);

        if ($publicHost !== '') {
            foreach (self::getLocalHosts() as $host) {
                $content = \str_replace('//' . $host, '//' . $publicHost, $content);
            }
        }

        return $content;
    }

    /**
     * @return string[]
     */
    private static function getLocalOrigins(): array
    {
        $origins = [];
        $urls = [
            (string) \get_option('home'),
            (string) \get_option('siteurl'),
        ];

        foreach ($urls as $url) {
            $parts = \wp_parse_url($url);
            $host = isset($parts['host']) ? (string) $parts['host'] : '';

            if ($host === '') {
                continue;
            }

            $port = isset($parts['port']) ? ':' . (string) $parts['port'] : '';

            foreach (['http', 'https'] as $scheme) {
                $origins[] = $scheme . '://' . $host . $port;
            }
        }

        $origins = \array_values(\array_unique($origins));
        \usort($origins, static function (string $a, string $b): int {
            return \strlen($b) <=> \strlen($a);
        });

        return $origins;
    }

    /**
     * @return string[]
     */
    private static function getLocalHosts(): array
    {
        $hosts = [];
        $urls = [
            (string) \get_option('home'),
            (string) \get_option('siteurl'),
        ];

        foreach ($urls as $url) {
            $parts = \wp_parse_url($url);

            if (!empty($parts['host'])) {
                $hosts[] = (string) $parts['host'];
            }
        }

        return \array_values(\array_unique($hosts));
    }

    private static function getPublicCallbackHost(string $base): string
    {
        $parts = \wp_parse_url($base);

        return isset($parts['host']) ? (string) $parts['host'] : '';
    }
}
