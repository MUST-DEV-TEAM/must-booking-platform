<?php

namespace MustHotelBooking\Core;

final class ManagedPages
{
    private const SUSPENDED_OPTION = 'must_hotel_booking_managed_pages_suspended';

    /**
     * @return array<string, string>
     */
    public static function getGroupLabels(): array
    {
        return [
            'public_booking' => \__('Public booking pages', 'must-hotel-booking'),
            'guest_pages' => \__('Guest pages', 'must-hotel-booking'),
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function getConfig(): array
    {
        return [
            'page_rooms_id' => [
                'title' => \__('Rooms', 'must-hotel-booking'),
                'slug' => 'rooms',
                'template' => '',
                'group' => 'public_booking',
                'fallback_path' => '/rooms',
                'required' => false,
                'auto_create' => false,
            ],
            'page_booking_id' => [
                'title' => \__('Booking', 'must-hotel-booking'),
                'slug' => 'booking',
                'template' => 'frontend/templates/booking.php',
                'group' => 'public_booking',
                'fallback_path' => '/booking',
                'required' => true,
                'auto_create' => true,
            ],
            'page_booking_accommodation_id' => [
                'title' => \__('Select Accommodation', 'must-hotel-booking'),
                'slug' => 'booking-accommodation',
                'template' => 'frontend/templates/booking-accommodation.php',
                'group' => 'public_booking',
                'fallback_path' => '/booking-accommodation',
                'required' => true,
                'auto_create' => true,
            ],
            'page_checkout_id' => [
                'title' => \__('Checkout', 'must-hotel-booking'),
                'slug' => 'checkout',
                'template' => 'frontend/templates/checkout.php',
                'group' => 'guest_pages',
                'fallback_path' => '/checkout',
                'required' => true,
                'auto_create' => true,
            ],
            'page_booking_confirmation_id' => [
                'title' => \__('Booking Confirmation', 'must-hotel-booking'),
                'slug' => 'booking-confirmation',
                'template' => 'frontend/templates/booking-confirmation.php',
                'group' => 'guest_pages',
                'fallback_path' => '/booking-confirmation',
                'required' => true,
                'auto_create' => true,
            ],
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function getConfigForGroup(string $group): array
    {
        $items = [];

        foreach (self::getConfig() as $settingKey => $config) {
            if ((string) ($config['group'] ?? '') === $group) {
                $items[$settingKey] = $config;
            }
        }

        return $items;
    }

    public static function isRequired(string $settingKey): bool
    {
        $config = self::getConfig();
        $page = isset($config[$settingKey]) && \is_array($config[$settingKey]) ? $config[$settingKey] : [];
        $required = !empty($page['required']);

        return $required;
    }

    public static function shouldAutoCreate(string $settingKey): bool
    {
        $config = self::getConfig();
        $page = isset($config[$settingKey]) && \is_array($config[$settingKey]) ? $config[$settingKey] : [];

        if (!empty($page['auto_create'])) {
            return true;
        }

        return false;
    }

    public static function isManagementSuspended(): bool
    {
        return !empty(\get_option(self::SUSPENDED_OPTION, false));
    }

    public static function suspendAutoManagement(): void
    {
        \update_option(self::SUSPENDED_OPTION, true);
    }

    public static function resumeAutoManagement(): void
    {
        \delete_option(self::SUSPENDED_OPTION);
    }

    public static function install(): void
    {
        if (self::isManagementSuspended()) {
            return;
        }

        foreach (self::getConfig() as $settingKey => $config) {
            if (!self::shouldAutoCreate($settingKey)) {
                continue;
            }

            self::ensurePage($settingKey);
            unset($config);
        }
    }

    public static function sync(): void
    {
        if (self::isManagementSuspended()) {
            return;
        }

        foreach (self::getConfig() as $settingKey => $config) {
            if (!self::shouldAutoCreate($settingKey)) {
                continue;
            }

            $page = self::getAssignedPage($settingKey);
            $template = (string) ($config['template'] ?? '');
            $templateExists = $template === '' || \is_file(MUST_HOTEL_BOOKING_PATH . $template);
            $needsRepair = !$page instanceof \WP_Post
                || $page->post_type !== 'page'
                || $page->post_status === 'trash'
                || !$templateExists;

            if ($needsRepair) {
                self::ensurePage($settingKey, true);
            }
        }
    }

    public static function ensurePage(string $settingKey, bool $forceAssign = false): int
    {
        $config = self::getConfig();

        if (!isset($config[$settingKey])) {
            return 0;
        }

        $assignedPage = self::getAssignedPage($settingKey);

        if (!$forceAssign && $assignedPage instanceof \WP_Post && $assignedPage->post_type === 'page' && $assignedPage->post_status !== 'trash') {
            return (int) $assignedPage->ID;
        }

        $slug = (string) ($config[$settingKey]['slug'] ?? '');
        $title = (string) ($config[$settingKey]['title'] ?? $settingKey);
        $existingPage = $slug !== '' ? \get_page_by_path($slug, OBJECT, 'page') : null;

        if ($existingPage instanceof \WP_Post && $existingPage->post_type === 'page' && $existingPage->post_status !== 'trash') {
            self::assignPage($settingKey, (int) $existingPage->ID);

            return (int) $existingPage->ID;
        }

        $createdPageId = \wp_insert_post(
            [
                'post_title' => $title,
                'post_name' => $slug,
                'post_type' => 'page',
                'post_status' => 'publish',
                'post_content' => '',
                'comment_status' => 'closed',
                'ping_status' => 'closed',
            ],
            true
        );

        if (\is_wp_error($createdPageId)) {
            return 0;
        }

        $pageId = (int) $createdPageId;
        self::assignPage($settingKey, $pageId);

        return $pageId;
    }

    public static function recreatePage(string $settingKey): int
    {
        self::assignPage($settingKey, 0);

        return self::ensurePage($settingKey, true);
    }

    public static function assignPage(string $settingKey, int $pageId): bool
    {
        if (!isset(self::getConfig()[$settingKey])) {
            return false;
        }

        if ($pageId > 0) {
            $page = \get_post($pageId);

            if (!$page instanceof \WP_Post || $page->post_type !== 'page') {
                return false;
            }
        }

        MustBookingConfig::set_setting($settingKey, \absint($pageId));

        if ($pageId > 0) {
            self::resumeAutoManagement();
        }

        return true;
    }

    public static function getAssignedPageId(string $settingKey): int
    {
        return \absint(MustBookingConfig::get_setting($settingKey, 0));
    }

    public static function getAssignedPage(string $settingKey): ?\WP_Post
    {
        $pageId = self::getAssignedPageId($settingKey);

        if ($pageId <= 0) {
            return null;
        }

        $page = \get_post($pageId);

        return $page instanceof \WP_Post ? $page : null;
    }

    public static function hasAssignedPage(string $settingKey): bool
    {
        $page = self::getAssignedPage($settingKey);

        if (!$page instanceof \WP_Post || $page->post_type !== 'page') {
            return false;
        }

        return $page->post_status === 'publish';
    }

    /**
     * @return array<string, mixed>
     */
    public static function getPageHealth(string $settingKey): array
    {
        $config = self::getConfig();
        $pageConfig = isset($config[$settingKey]) && \is_array($config[$settingKey]) ? $config[$settingKey] : [];
        $page = self::getAssignedPage($settingKey);
        $pageId = self::getAssignedPageId($settingKey);
        $required = self::isRequired($settingKey);
        $template = (string) ($pageConfig['template'] ?? '');
        $templateExists = $template === '' || \is_file(MUST_HOTEL_BOOKING_PATH . $template);
        $statusLabel = \__('Missing', 'must-hotel-booking');
        $health = $required ? 'missing' : 'disabled';
        $message = $required
            ? \__('No valid page is assigned.', 'must-hotel-booking')
            : \__('This page is optional until the related feature is enabled.', 'must-hotel-booking');

        if ($page instanceof \WP_Post && $page->post_type === 'page') {
            $pageStatus = (string) $page->post_status;
            $statusLabel = \ucfirst($pageStatus);
            $health = 'ok';
            $message = \sprintf(
                /* translators: 1: page title, 2: page status. */
                \__('Assigned to "%1$s" (%2$s).', 'must-hotel-booking'),
                (string) $page->post_title,
                $pageStatus
            );

            if ($pageStatus === 'trash') {
                $health = 'missing';
                $message = \__('Assigned page is in Trash.', 'must-hotel-booking');
            } elseif ($pageStatus !== 'publish') {
                $health = 'warning';
                $message = \sprintf(
                    /* translators: %s is a page status. */
                    \__('Assigned page is not published yet (%s).', 'must-hotel-booking'),
                    $pageStatus
                );
            }

            if (!$templateExists) {
                $health = 'invalid';
                $message = \__('Expected managed-page template file is missing from the plugin.', 'must-hotel-booking');
            }

            if (\in_array($settingKey, ['portal_page_id', 'portal_login_page_id'], true)) {
                $expectedSlug = \trim((string) ($pageConfig['slug'] ?? ''), '/');
                $actualPath = \trim((string) \get_page_uri($page), '/');

                if ($expectedSlug !== '' && $actualPath !== '' && $expectedSlug !== $actualPath && $health === 'ok') {
                    $health = 'warning';
                    $message = \sprintf(
                        /* translators: 1: assigned page path, 2: default path. */
                        \__('Assigned page currently resolves to "/%1$s". The canonical managed path is "/%2$s".', 'must-hotel-booking'),
                        $actualPath,
                        $expectedSlug
                    );
                }
            }
        } elseif ($pageId > 0) {
            $health = 'invalid';
            $statusLabel = \__('Invalid', 'must-hotel-booking');
            $message = \__('Assigned page ID does not point to a valid WordPress page.', 'must-hotel-booking');
        }

        return [
            'setting_key' => $settingKey,
            'group' => (string) ($pageConfig['group'] ?? ''),
            'group_label' => (string) (self::getGroupLabels()[(string) ($pageConfig['group'] ?? '')] ?? ''),
            'label' => (string) ($pageConfig['title'] ?? $settingKey),
            'slug' => (string) ($pageConfig['slug'] ?? ''),
            'template' => $template,
            'page_id' => $pageId,
            'required' => $required,
            'auto_create' => self::shouldAutoCreate($settingKey),
            'page_status' => $page instanceof \WP_Post ? (string) $page->post_status : '',
            'status_label' => $statusLabel,
            'health' => $health,
            'message' => $message,
            'edit_url' => $page instanceof \WP_Post ? \get_edit_post_link((int) $page->ID, 'raw') : '',
            'view_url' => $page instanceof \WP_Post && $page->post_status !== 'trash' ? self::safePermalink((int) $page->ID) : '',
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function getHealthRows(): array
    {
        $rows = [];

        foreach (\array_keys(self::getConfig()) as $settingKey) {
            $rows[] = self::getPageHealth($settingKey);
        }

        return $rows;
    }

    public static function getPageUrl(string $settingKey, string $fallbackPath): string
    {
        if (self::isManagementSuspended()) {
            return '';
        }

        $pageId = self::getAssignedPageId($settingKey);

        if ($pageId > 0) {
            $permalink = self::safePermalink($pageId);

            if (\is_string($permalink) && $permalink !== '') {
                return $permalink;
            }
        }

        return \home_url($fallbackPath);
    }

    public static function getAssignedPageUrl(string $settingKey): string
    {
        if (!self::hasAssignedPage($settingKey)) {
            return '';
        }

        return self::safePermalink(self::getAssignedPageId($settingKey));
    }

    public static function getRoomsPageUrl(): string
    {
        return self::getAssignedPageUrl('page_rooms_id');
    }

    public static function getBookingPageUrl(): string
    {
        return self::getPageUrl('page_booking_id', '/booking');
    }

    public static function getBookingAccommodationPageUrl(): string
    {
        return self::getPageUrl('page_booking_accommodation_id', '/booking-accommodation');
    }

    public static function getCheckoutPageUrl(): string
    {
        return self::getPageUrl('page_checkout_id', '/checkout');
    }

    public static function getBookingConfirmationPageUrl(): string
    {
        return self::getPageUrl('page_booking_confirmation_id', '/booking-confirmation');
    }

    public static function getConfiguredPagePath(string $settingKey, string $fallbackSlug): string
    {
        if (self::isManagementSuspended()) {
            return '';
        }

        $page = self::getAssignedPage($settingKey);

        if ($page instanceof \WP_Post && $page->post_type === 'page') {
            $pagePath = \trim((string) \get_page_uri($page), '/');

            if ($pagePath !== '') {
                return $pagePath;
            }
        }

        return \trim($fallbackSlug, '/');
    }

    public static function isCurrentPage(string $settingKey, string $fallbackSlug): bool
    {
        if (\is_admin() || self::isManagementSuspended()) {
            return false;
        }

        $pageId = self::getAssignedPageId($settingKey);

        if ($pageId > 0 && \is_page($pageId)) {
            return true;
        }

        return \is_page($fallbackSlug);
    }

    public static function isAssignedCurrentPage(string $settingKey): bool
    {
        if (\is_admin() || self::isManagementSuspended()) {
            return false;
        }

        $pageId = self::getAssignedPageId($settingKey);

        return $pageId > 0 && \is_page($pageId);
    }

    private static function safePermalink(int $pageId): string
    {
        if ($pageId <= 0) {
            return '';
        }

        global $wp_rewrite;

        if (!\did_action('init') || !$wp_rewrite instanceof \WP_Rewrite) {
            return '';
        }

        $permalink = \get_permalink($pageId);

        return \is_string($permalink) ? $permalink : '';
    }
}
