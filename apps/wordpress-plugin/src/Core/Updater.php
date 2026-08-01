<?php

namespace MustHotelBooking\Core;

use YahnisElsts\PluginUpdateChecker\v5\PucFactory;

final class Updater
{
    /** @var object|null */
    private static $updateChecker = null;

    public static function boot(): void
    {
        if (self::$updateChecker !== null) {
            return;
        }

        if (!self::isEnabled()) {
            return;
        }

        $libraryFile = MUST_HOTEL_BOOKING_PATH . 'lib/plugin-update-checker/plugin-update-checker.php';

        if (!\is_file($libraryFile)) {
            return;
        }

        require_once $libraryFile;

        $repositoryUrl = self::getRepositoryUrl();

        if (!self::isRepositoryConfigured($repositoryUrl)) {
            return;
        }

        $updateChecker = PucFactory::buildUpdateChecker(
            $repositoryUrl,
            MUST_HOTEL_BOOKING_FILE,
            MUST_HOTEL_BOOKING_PLUGIN_SLUG
        );

        $updateChecker->setBranch(self::getBranch());

        $token = self::getToken();

        if ($token !== '') {
            $updateChecker->setAuthentication($token);
        }

        $assetPattern = self::getReleaseAssetPattern();

        if ($assetPattern !== '') {
            $updateChecker->getVcsApi()->enableReleaseAssets($assetPattern);
        } else {
            $updateChecker->getVcsApi()->enableReleaseAssets();
        }

        self::$updateChecker = $updateChecker;
    }

    /**
     * @return array<string, mixed>
     */
    public static function getStatus(): array
    {
        $repositoryUrl = self::getRepositoryUrl();
        $readmeStableTag = self::getReadmeStableTag();
        $expectedAssetName = self::getExpectedReleaseAssetName();
        $tokenConfigured = self::getToken() !== '';
        $versionConsistent = $readmeStableTag !== '' && $readmeStableTag === MUST_HOTEL_BOOKING_VERSION;
        $assetPatternStrict = self::getReleaseAssetPattern() === self::getRecommendedReleaseAssetPattern();

        return [
            'enabled' => self::isEnabled(),
            'configured' => self::isRepositoryConfigured($repositoryUrl),
            'repository' => $repositoryUrl,
            'branch' => self::getBranch(),
            'plugin_slug' => MUST_HOTEL_BOOKING_PLUGIN_SLUG,
            'release_asset_pattern' => self::getReleaseAssetPattern(),
            'recommended_release_asset_pattern' => self::getRecommendedReleaseAssetPattern(),
            'expected_release_asset_name' => $expectedAssetName,
            'version' => MUST_HOTEL_BOOKING_VERSION,
            'readme_stable_tag' => $readmeStableTag,
            'version_consistent' => $versionConsistent,
            'asset_pattern_strict' => $assetPatternStrict,
            'token_configured' => $tokenConfigured,
            'release_readiness_message' => self::buildReleaseReadinessMessage(
                self::isRepositoryConfigured($repositoryUrl),
                $versionConsistent,
                $assetPatternStrict,
                $tokenConfigured,
                $expectedAssetName
            ),
            'library_loaded' => self::$updateChecker !== null,
        ];
    }

    private static function isEnabled(): bool
    {
        return \defined('MUST_HOTEL_BOOKING_UPDATER_ENABLED')
            && (bool) MUST_HOTEL_BOOKING_UPDATER_ENABLED;
    }

    private static function getRepositoryUrl(): string
    {
        return \trailingslashit(\trim((string) MUST_HOTEL_BOOKING_GITHUB_REPOSITORY));
    }

    private static function getBranch(): string
    {
        $branch = \trim((string) MUST_HOTEL_BOOKING_GITHUB_BRANCH);

        return $branch !== '' ? $branch : 'main';
    }

    private static function getReleaseAssetPattern(): string
    {
        return (string) MUST_HOTEL_BOOKING_GITHUB_RELEASE_ASSET_PATTERN;
    }

    private static function getRecommendedReleaseAssetPattern(): string
    {
        return '/^must-hotel-booking-[0-9]+\.[0-9]+\.[0-9]+\.zip$/i';
    }

    private static function getToken(): string
    {
        return \trim((string) MUST_HOTEL_BOOKING_GITHUB_TOKEN);
    }

    private static function getReadmeStableTag(): string
    {
        $readmePath = MUST_HOTEL_BOOKING_PATH . 'readme.txt';

        if (!\is_file($readmePath)) {
            return '';
        }

        $contents = \file_get_contents($readmePath);

        if (!\is_string($contents)) {
            return '';
        }

        if (!\preg_match('/^Stable tag:\s*([0-9A-Za-z._-]+)\s*$/mi', $contents, $matches)) {
            return '';
        }

        return isset($matches[1]) ? \trim((string) $matches[1]) : '';
    }

    private static function getExpectedReleaseAssetName(string $version = ''): string
    {
        $version = \trim($version);

        if ($version === '') {
            $version = MUST_HOTEL_BOOKING_VERSION;
        }

        return MUST_HOTEL_BOOKING_PLUGIN_SLUG . '-' . $version . '.zip';
    }

    private static function buildReleaseReadinessMessage(
        bool $repositoryConfigured,
        bool $versionConsistent,
        bool $assetPatternStrict,
        bool $tokenConfigured,
        string $expectedAssetName
    ): string {
        if (!$repositoryConfigured) {
            return \__('GitHub updater is enabled but the repository URL is not configured correctly.', 'must-hotel-booking');
        }

        if (!$versionConsistent) {
            return \__('Plugin header version, version constant, and readme stable tag must match before publishing a release.', 'must-hotel-booking');
        }

        if (!$assetPatternStrict) {
            return \__('Release asset matching is broader than the recommended single-ZIP production pattern.', 'must-hotel-booking');
        }

        if (!$tokenConfigured) {
            return \sprintf(
                /* translators: %s: expected release asset file name. */
                \__('Updater metadata is aligned. Publish exactly one public release ZIP named %s, or define MUST_HOTEL_BOOKING_GITHUB_TOKEN for private releases.', 'must-hotel-booking'),
                $expectedAssetName
            );
        }

        return \sprintf(
            /* translators: %s: expected release asset file name. */
            \__('Updater metadata is aligned. Publish exactly one release ZIP named %s from the configured branch.', 'must-hotel-booking'),
            $expectedAssetName
        );
    }

    private static function isRepositoryConfigured(string $repositoryUrl): bool
    {
        if ($repositoryUrl === '') {
            return false;
        }

        if (\strpos($repositoryUrl, 'replace-with-your-org') !== false) {
            return false;
        }

        return \filter_var($repositoryUrl, \FILTER_VALIDATE_URL) !== false;
    }
}
