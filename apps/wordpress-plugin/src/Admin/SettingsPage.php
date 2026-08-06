<?php

namespace MustHotelBooking\Admin;

use MustHotelBooking\Core\MustApiClient;
use MustHotelBooking\Core\MustBookingConfig;

final class SettingsPage
{
    /**
     * @return array<string, array<string, string>>
     */
    public static function getTabs(): array
    {
        return [
            'general' => [
                'label' => \__('MUST API connection', 'must-hotel-booking'),
                'icon' => 'dashicons-admin-generic',
            ],
        ];
    }

    public static function normalizeTab(string $tab): string
    {
        return 'general';
    }

    public static function getActiveTab(): string
    {
        return 'general';
    }

    public static function maybeHandleSaveRequestEarly(): void
    {
        if ((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            return;
        }

        $page = isset($_GET['page']) ? \sanitize_key((string) \wp_unslash($_GET['page'])) : '';
        if ($page !== 'must-hotel-booking-settings') {
            return;
        }

        $action = isset($_POST['must_settings_action']) ? \sanitize_key((string) \wp_unslash($_POST['must_settings_action'])) : '';

        if ($action === 'redeem_pairing_code') {
            self::handlePairingRedeem();
            return;
        }
        if ($action === 'save_calendar_layout') {
            self::handleCalendarLayoutSave();
            return;
        }
        if ($action === 'save_must_connection') {
            self::handleManualConnectionSave();
            return;
        }
    }

    private static function handlePairingRedeem(): void
    {
        if (!\current_user_can('manage_options')) {
            \wp_die(\esc_html__('You do not have permission to manage MUST API settings.', 'must-hotel-booking'));
        }

        \check_admin_referer('must_redeem_pairing_code', 'must_pairing_nonce');

        $code = \trim(\sanitize_text_field((string) \wp_unslash($_POST['must_connection_code'] ?? '')));
        if ($code === '') {
            \set_transient(
                'must_hotel_booking_settings_errors',
                [\__('Enter the connection code shown on your MUST dashboard.', 'must-hotel-booking')],
                MINUTE_IN_SECONDS
            );
            \wp_safe_redirect(get_admin_settings_page_url(['notice' => 'error']));
            exit;
        }

        $result = MustApiClient::redeemPairingCode($code);
        $body = $result['body'];
        if (!$result['ok'] || !\is_array($body) || !isset($body['tenantId'], $body['propertyId'], $body['apiBaseUrl'])) {
            $message = \is_array($body) && \is_string($body['message'] ?? null) && $body['message'] !== ''
                ? $body['message']
                : \__('This connection code is invalid or has expired. Generate a new one from your MUST dashboard.', 'must-hotel-booking');
            \set_transient('must_hotel_booking_settings_errors', [$message], MINUTE_IN_SECONDS);
            \wp_safe_redirect(get_admin_settings_page_url(['notice' => 'error']));
            exit;
        }

        MustBookingConfig::set_setting('must_api_base_url', (string) $body['apiBaseUrl']);
        MustBookingConfig::set_setting('must_tenant_id', (string) $body['tenantId']);
        MustBookingConfig::set_setting('must_property_id', (string) $body['propertyId']);

        \wp_safe_redirect(get_admin_settings_page_url(['notice' => 'paired']));
        exit;
    }

    private static function handleCalendarLayoutSave(): void
    {
        if (!\current_user_can('manage_options')) {
            \wp_die(\esc_html__('You do not have permission to manage MUST API settings.', 'must-hotel-booking'));
        }

        \check_admin_referer('must_save_calendar_layout', 'must_calendar_nonce');

        $calendarLayout = (string) \wp_unslash($_POST['calendar_layout'] ?? 'one_calendar');
        $calendarLayout = $calendarLayout === 'two_calendars' ? 'two_calendars' : 'one_calendar';
        MustBookingConfig::set_setting('calendar_layout', $calendarLayout);

        \wp_safe_redirect(get_admin_settings_page_url(['notice' => 'saved']));
        exit;
    }

    private static function handleManualConnectionSave(): void
    {
        if (!\current_user_can('manage_options')) {
            \wp_die(\esc_html__('You do not have permission to manage MUST API settings.', 'must-hotel-booking'));
        }

        \check_admin_referer('must_save_connection', 'must_settings_nonce');

        $apiBaseUrl = MustBookingConfig::normalize_public_callback_base_url(
            (string) \wp_unslash($_POST['must_api_base_url'] ?? '')
        );
        $tenantId = \strtolower(\trim(\sanitize_text_field((string) \wp_unslash($_POST['must_tenant_id'] ?? ''))));
        $propertyId = \strtolower(\trim(\sanitize_text_field((string) \wp_unslash($_POST['must_property_id'] ?? ''))));

        $errors = [];
        if ($apiBaseUrl === '') {
            $errors[] = \__('MUST API base URL must be a valid HTTPS origin without credentials, query string, or fragment. HTTP is allowed only for local development hosts.', 'must-hotel-booking');
        }
        if (!self::isUuid($tenantId)) {
            $errors[] = \__('MUST tenant ID must be a valid UUID.', 'must-hotel-booking');
        }
        if (!self::isUuid($propertyId)) {
            $errors[] = \__('MUST property ID must be a valid UUID.', 'must-hotel-booking');
        }

        if (!empty($errors)) {
            \set_transient('must_hotel_booking_settings_errors', $errors, MINUTE_IN_SECONDS);
            \wp_safe_redirect(get_admin_settings_page_url(['notice' => 'error']));
            exit;
        }

        MustBookingConfig::set_setting('must_api_base_url', $apiBaseUrl);
        MustBookingConfig::set_setting('must_tenant_id', $tenantId);
        MustBookingConfig::set_setting('must_property_id', $propertyId);

        \wp_safe_redirect(get_admin_settings_page_url(['notice' => 'saved']));
        exit;
    }

    public static function enqueueAssets(): void
    {
    }

    public static function render(): void
    {
        if (!\current_user_can('manage_options')) {
            \wp_die(\esc_html__('You do not have permission to manage MUST API settings.', 'must-hotel-booking'));
        }

        $notice = isset($_GET['notice']) ? \sanitize_key((string) \wp_unslash($_GET['notice'])) : '';
        $errors = $notice === 'error' ? \get_transient('must_hotel_booking_settings_errors') : [];
        if ($notice === 'error') {
            \delete_transient('must_hotel_booking_settings_errors');
        }
        $connected = MustBookingConfig::get_must_tenant_id() !== '' && MustBookingConfig::get_must_property_id() !== '';

        echo '<div class="wrap">';
        echo '<h1>' . \esc_html__('MUST Booking Settings', 'must-hotel-booking') . '</h1>';

        if ($notice === 'paired') {
            echo '<div class="notice notice-success is-dismissible"><p>' . \esc_html__('This site is now connected to MUST.', 'must-hotel-booking') . '</p></div>';
        } elseif ($notice === 'saved') {
            echo '<div class="notice notice-success is-dismissible"><p>' . \esc_html__('Settings saved.', 'must-hotel-booking') . '</p></div>';
        }

        if (\is_array($errors)) {
            foreach ($errors as $error) {
                echo '<div class="notice notice-error"><p>' . \esc_html((string) $error) . '</p></div>';
            }
        }

        self::renderConnectionSection($connected);
        self::renderCalendarSection();

        echo '</div>';
    }

    private static function renderConnectionSection(bool $connected): void
    {
        echo '<h2>' . \esc_html__('Connect to MUST', 'must-hotel-booking') . '</h2>';

        if ($connected) {
            echo '<p>' . \esc_html__('This site is connected to MUST. If you need to move it to a different property, generate a new connection code from your MUST dashboard and enter it below.', 'must-hotel-booking') . '</p>';
        } else {
            echo '<p>' . \esc_html__('In your MUST dashboard, go to Settings → Connect WordPress site, generate a connection code, and paste it below.', 'must-hotel-booking') . '</p>';
        }

        echo '<form method="post" action="' . \esc_url(get_admin_settings_page_url()) . '">';
        \wp_nonce_field('must_redeem_pairing_code', 'must_pairing_nonce');
        echo '<input type="hidden" name="must_settings_action" value="redeem_pairing_code" />';
        echo '<table class="form-table" role="presentation"><tbody>';
        echo '<tr><th scope="row"><label for="must_connection_code">' . \esc_html__('Connection code', 'must-hotel-booking') . '</label></th><td>';
        echo '<input class="regular-text" id="must_connection_code" name="must_connection_code" type="text" placeholder="MUST-HOTEL-XXXX-XXXX" autocomplete="off" required />';
        echo '<p class="description">' . \esc_html__('Single-use and expires 30 minutes after it is generated.', 'must-hotel-booking') . '</p></td></tr>';
        echo '</tbody></table>';
        \submit_button($connected ? \__('Reconnect with a new code', 'must-hotel-booking') : \__('Connect', 'must-hotel-booking'));
        echo '</form>';

        echo '<details><summary>' . \esc_html__('Enter connection details manually', 'must-hotel-booking') . '</summary>';
        echo '<form method="post" action="' . \esc_url(get_admin_settings_page_url()) . '">';
        \wp_nonce_field('must_save_connection', 'must_settings_nonce');
        echo '<input type="hidden" name="must_settings_action" value="save_must_connection" />';
        echo '<table class="form-table" role="presentation"><tbody>';
        self::renderTextField('must_api_base_url', \__('MUST API base URL', 'must-hotel-booking'), MustBookingConfig::get_must_api_base_url(), \__('The MUST API origin. This is not a credential.', 'must-hotel-booking'), 'url');
        self::renderTextField('must_tenant_id', \__('MUST tenant ID', 'must-hotel-booking'), MustBookingConfig::get_must_tenant_id(), \__('The UUID of the tenant that owns this property.', 'must-hotel-booking'));
        self::renderTextField('must_property_id', \__('MUST property ID', 'must-hotel-booking'), MustBookingConfig::get_must_property_id(), \__('The UUID of the property displayed by this installation.', 'must-hotel-booking'));
        echo '</tbody></table>';
        \submit_button(\__('Save connection details', 'must-hotel-booking'));
        echo '</form></details>';
    }

    private static function renderCalendarSection(): void
    {
        $calendarLayout = (string) MustBookingConfig::get_setting('calendar_layout', 'one_calendar');

        echo '<h2>' . \esc_html__('Booking calendar', 'must-hotel-booking') . '</h2>';
        echo '<form method="post" action="' . \esc_url(get_admin_settings_page_url()) . '">';
        \wp_nonce_field('must_save_calendar_layout', 'must_calendar_nonce');
        echo '<input type="hidden" name="must_settings_action" value="save_calendar_layout" />';
        echo '<table class="form-table" role="presentation"><tbody>';
        echo '<tr><th scope="row"><label for="calendar_layout">' . \esc_html__('Date picker', 'must-hotel-booking') . '</label></th><td>';
        echo '<select id="calendar_layout" name="calendar_layout">';
        echo '<option value="one_calendar"' . \selected($calendarLayout, 'one_calendar', false) . '>' . \esc_html__('One calendar (date range picker)', 'must-hotel-booking') . '</option>';
        echo '<option value="two_calendars"' . \selected($calendarLayout, 'two_calendars', false) . '>' . \esc_html__('Two calendars (separate check-in / check-out)', 'must-hotel-booking') . '</option>';
        echo '</select>';
        echo '<p class="description">' . \esc_html__('How the booking page shows the date picker to guests.', 'must-hotel-booking') . '</p></td></tr>';
        echo '</tbody></table>';
        \submit_button(\__('Save calendar setting', 'must-hotel-booking'));
        echo '</form>';
    }

    private static function renderTextField(string $name, string $label, string $value, string $description, string $type = 'text'): void
    {
        echo '<tr><th scope="row"><label for="' . \esc_attr($name) . '">' . \esc_html($label) . '</label></th><td>';
        echo '<input class="regular-text" id="' . \esc_attr($name) . '" name="' . \esc_attr($name) . '" type="' . \esc_attr($type) . '" value="' . \esc_attr($value) . '" required />';
        echo '<p class="description">' . \esc_html($description) . '</p></td></tr>';
    }

    private static function isUuid(string $value): bool
    {
        return \preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
