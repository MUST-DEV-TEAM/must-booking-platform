<?php

namespace MustHotelBooking\Admin;

/**
 * @param array<string, scalar|int|bool> $args
 */
function get_admin_settings_page_url(array $args = []): string
{
    $baseUrl = \admin_url('admin.php?page=must-hotel-booking-settings');

    if (empty($args)) {
        return $baseUrl;
    }

    return \add_query_arg($args, $baseUrl);
}

/**
 * @return array<string, string>
 */
function get_settings_tabs(): array
{
    $tabs = [];

    foreach (SettingsPage::getTabs() as $tabKey => $tabMeta) {
        $tabs[$tabKey] = (string) ($tabMeta['label'] ?? $tabKey);
    }

    return $tabs;
}

function get_settings_page_active_tab(): string
{
    return SettingsPage::getActiveTab();
}

function render_admin_settings_page(): void
{
    SettingsPage::render();
}

function maybe_handle_settings_save_request_early(): void
{
    SettingsPage::maybeHandleSaveRequestEarly();
}

function enqueue_admin_settings_assets(): void
{
    SettingsPage::enqueueAssets();
}

\add_action('admin_init', __NAMESPACE__ . '\maybe_handle_settings_save_request_early', 1);
\add_action('admin_enqueue_scripts', __NAMESPACE__ . '\enqueue_admin_settings_assets');
\add_action(
    'admin_menu',
    static function (): void {
        \add_options_page(
            'MUST Booking Settings',
            'MUST Booking',
            'manage_options',
            'must-hotel-booking-settings',
            __NAMESPACE__ . '\render_admin_settings_page'
        );
    }
);
