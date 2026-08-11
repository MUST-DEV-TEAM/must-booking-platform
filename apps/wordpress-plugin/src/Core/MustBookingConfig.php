<?php
namespace MustHotelBooking\Core;
class MustBookingConfig
{
    public const OPTION_NAME = 'must_hotel_booking_settings';
    private const VERSION_KEY = 'settings_version';
    private const VERSION = 6;
    public static function get_option_name(): string
    {
        return self::OPTION_NAME;
    }
    /** @return array<string, array<string, mixed>> */
    public static function get_settings_groups(): array
    {
        $storage = self::storage();
        $groups = [];
        foreach (self::group_defaults() as $group => $defaults) {
            unset($defaults);
            $groups[$group] = isset($storage[$group]) && \is_array($storage[$group]) ? $storage[$group] : [];
        }
        return $groups;
    }
    /** @return array<string, mixed> */
    public static function get_group_settings(string $group): array
    {
        $groups = self::get_settings_groups();
        return isset($groups[$group]) ? $groups[$group] : [];
    }
    /** @return array<string, mixed> */
    public static function get_default_settings(): array
    {
        return self::flatten(self::default_storage());
    }
    /** @return array<string, mixed> */
    public static function get_all_settings(): array
    {
        return self::flatten(self::storage());
    }
    /** @param array<string, mixed> $settings */
    public static function set_all_settings(array $settings): void
    {
        $current = self::storage();
        foreach ($settings as $key => $value) {
            if (!\is_string($key)) {
                continue;
            }
            if (isset(self::group_defaults()[$key]) && \is_array($value) && \is_array($current[$key] ?? null)) {
                $current[$key] = \array_merge((array) $current[$key], $value);
                continue;
            }
            $current[$key] = $value;
        }
        \update_option(self::OPTION_NAME, self::normalize_storage($current));
    }
    /** @param mixed $default */
    public static function get_setting(string $key, $default = null)
    {
        $groups = self::get_settings_groups();
        if (isset($groups[$key])) {
            return $groups[$key];
        }
        $settings = self::get_all_settings();
        return \array_key_exists($key, $settings) ? $settings[$key] : $default;
    }
    /** @param mixed $value */
    public static function set_setting(string $key, $value): void
    {
        $storage = self::storage();
        $map = self::field_group_map();
        if (isset(self::group_defaults()[$key]) && \is_array($value)) {
            $storage[$key] = \array_merge((array) ($storage[$key] ?? []), $value);
        } elseif (isset($map[$key])) {
            $group = $map[$key];
            $storage[$group] = isset($storage[$group]) && \is_array($storage[$group]) ? $storage[$group] : [];
            $storage[$group][$key] = $value;
        } else {
            $storage[$key] = $value;
        }
        \update_option(self::OPTION_NAME, self::normalize_storage($storage));
    }
    /** @param array<string, mixed> $values */
    public static function set_group_settings(string $group, array $values): void
    {
        if (!isset(self::group_defaults()[$group])) {
            return;
        }
        $storage = self::storage();
        $storage[$group] = \array_merge((array) ($storage[$group] ?? []), $values);
        \update_option(self::OPTION_NAME, self::normalize_storage($storage));
    }
    /** Remove legacy local payment credentials and settings on upgrade. */
    public static function remove_legacy_payment_configuration(): void
    {
        $raw = self::get_wp_option(self::OPTION_NAME, []);
        if (!\is_array($raw)) {
            return;
        }

        $changed = !empty($raw['payments_summary']);
        unset($raw['payments_summary']);
        foreach (\array_keys($raw) as $key) {
            if (\is_string($key) && \preg_match('/^(?:stripe|pokpay|payment|pay_at_hotel|deposit|tax_rate|checkout_price)/', $key) === 1) {
                unset($raw[$key]);
                $changed = true;
            }
        }
        if (!$changed) {
            return;
        }
        \update_option(self::OPTION_NAME, self::normalize_storage($raw));
    }
    /** Remove legacy PMS configuration and credentials on upgrade. */
    public static function remove_legacy_clock_configuration(): void
    {
        $raw = self::get_wp_option(self::OPTION_NAME, []);
        if (!\is_array($raw)) {
            return;
        }

        $changed = !empty($raw['provider']);
        unset($raw['provider']);
        foreach (\array_keys($raw) as $key) {
            if (\is_string($key) && \preg_match('/^(?:clock|provider_mode|website_booking_flow_mode)/', $key) === 1) {
                unset($raw[$key]);
                $changed = true;
            }
        }
        if (!$changed) {
            return;
        }
        \update_option(self::OPTION_NAME, self::normalize_storage($raw));
    }
    public static function get_hotel_name(): string
    {
        $value = \trim((string) self::get_setting('hotel_name', self::site_name()));
        return $value !== '' ? $value : self::site_name();
    }
    public static function get_hotel_address(): string
    {
        return \trim((string) self::get_setting('hotel_address', ''));
    }
    public static function get_google_maps_url(): string
    {
        return \esc_url_raw((string) self::get_setting('google_maps_url', ''));
    }
    public static function get_hotel_phone(): string
    {
        return \trim((string) self::get_setting('hotel_phone', ''));
    }
    public static function get_currency(): string
    {
        return self::currency((string) self::get_setting('currency', 'USD'));
    }
    public static function get_timezone(): string
    {
        return self::timezone((string) self::get_setting('timezone', ''), self::wp_timezone());
    }
    public static function get_tax_rate(): float
    {
        return \max(0.0, (float) self::get_setting('tax_rate', 0.0));
    }
    public static function get_booking_window(): int
    {
        return self::int((string) self::get_setting('booking_window', 365), 1, 3650, 365);
    }
    public static function get_cancellation_policy_days(): int
    {
        return self::int(self::get_setting('cancellation_policy_days', 21), 0, 365, 21);
    }
    public static function get_max_booking_guests(): int
    {
        return self::int((string) self::get_setting('max_booking_guests', 12), 1, 100, 12);
    }
    public static function get_max_booking_rooms(): int
    {
        return self::int((string) self::get_setting('max_booking_rooms', 3), 1, 25, 3);
    }
    public static function get_checkin_time(): string
    {
        return self::time((string) self::get_setting('checkin_time', '14:00'), '14:00');
    }
    public static function get_checkout_time(): string
    {
        return self::time((string) self::get_setting('checkout_time', '11:00'), '11:00');
    }
    public static function get_cancellation_notice_hours(): int
    {
        return self::get_cancellation_policy_days() * 24;
    }
    public static function get_cancellation_refund_percent(): float
    {
        return self::decimal(self::get_setting('cancellation_refund_percent', 97.0), 0.0, 100.0, 97.0);
    }
    public static function get_date_picker_calendar_layout(): string
    {
        return self::normalize_calendar_layout((string) self::get_setting('date_picker_calendar_layout', 'two_calendars'));
    }
    public static function get_checkout_price_breakdown_mode(): string
    {
        return self::normalize_price_breakdown_mode((string) self::get_setting('checkout_price_breakdown_mode', 'total_only'));
    }
    public static function get_email_price_breakdown_mode(): string
    {
        return self::normalize_price_breakdown_mode((string) self::get_setting('email_price_breakdown_mode', 'total_only'));
    }
    public static function get_public_callback_base_url(): string
    {
        return self::normalize_public_callback_base_url((string) self::get_setting('public_callback_base_url', ''));
    }
    public static function get_must_api_base_url(): string
    {
        return self::normalize_public_callback_base_url((string) self::get_setting('must_api_base_url', ''));
    }
    public static function get_must_tenant_id(): string
    {
        return self::uuid((string) self::get_setting('must_tenant_id', ''));
    }
    public static function get_must_property_id(): string
    {
        return self::uuid((string) self::get_setting('must_property_id', ''));
    }
    public static function build_public_callback_url(string $url): string
    {
        $base = self::get_public_callback_base_url();
        if ($base === '') {
            return $url;
        }
        $parts = \wp_parse_url($url);
        $path = isset($parts['path']) ? (string) $parts['path'] : '/';
        $query = isset($parts['query']) && (string) $parts['query'] !== '' ? '?' . (string) $parts['query'] : '';
        return $base . '/' . \ltrim($path, '/') . $query;
    }
    public static function build_public_rest_url(string $route): string
    {
        $route = '/' . \ltrim($route, '/');
        return self::build_public_callback_url(\rest_url($route));
    }
    public static function normalize_public_callback_base_url(string $url): string
    {
        $url = \trim($url);
        if ($url === '') {
            return '';
        }
        $parts = \wp_parse_url($url);
        if (!\is_array($parts)) {
            return '';
        }
        $scheme = isset($parts['scheme']) ? \strtolower((string) $parts['scheme']) : '';
        $host = isset($parts['host']) ? \strtolower((string) $parts['host']) : '';
        if (!\in_array($scheme, ['https', 'http'], true) || $host === '') {
            return '';
        }
        if (isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            return '';
        }
        if ($scheme !== 'https' && !self::is_local_callback_host($host)) {
            return '';
        }
        if (\preg_match('/[\x00-\x1F\x7F]/', $url) === 1) {
            return '';
        }
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        $path = isset($parts['path']) ? '/' . \trim((string) $parts['path'], '/') : '';
        if ($path === '/') {
            $path = '';
        }
        return $scheme . '://' . $host . $port . $path;
    }
    public static function get_booking_notification_email(): string
    {
        $email = \sanitize_email((string) self::get_setting('booking_notification_email', ''));
        return \is_email($email) ? $email : self::admin_email();
    }
    public static function get_email_from_name(): string
    {
        $value = \trim((string) self::get_setting('email_from_name', ''));
        return $value !== '' ? $value : self::get_hotel_name();
    }
    public static function get_email_from_email(): string
    {
        $email = \sanitize_email((string) self::get_setting('email_from_email', ''));
        return \is_email($email) ? $email : self::get_booking_notification_email();
    }
    public static function get_email_reply_to(): string
    {
        $email = \sanitize_email((string) self::get_setting('email_reply_to', ''));
        return \is_email($email) ? $email : '';
    }
    public static function get_email_logo_url(): string
    {
        $emailLogoUrl = \esc_url_raw((string) self::get_setting('email_logo_url', ''));
        if ($emailLogoUrl !== '') {
            return $emailLogoUrl;
        }
        $hotelLogoUrl = \esc_url_raw((string) self::get_setting('hotel_logo_url', ''));
        if ($hotelLogoUrl !== '') {
            return $hotelLogoUrl;
        }
        $customLogoId = (int) \get_theme_mod('custom_logo');
        if ($customLogoId > 0) {
            $customLogoUrl = \wp_get_attachment_image_url($customLogoId, 'full');
            if (\is_string($customLogoUrl) && $customLogoUrl !== '') {
                return \esc_url_raw($customLogoUrl);
            }
        }
        return '';
    }
    public static function get_email_footer_text(): string
    {
        return \trim((string) self::get_setting('email_footer_text', \__('We look forward to welcoming you.', 'must-hotel-booking')));
    }
    public static function get_email_layout_type(): string
    {
        return self::email_layout((string) self::get_setting('email_layout_type', 'classic'));
    }
    public static function get_custom_email_layout_html(): string
    {
        return \str_replace(["\r\n", "\r"], "\n", (string) self::get_setting('custom_email_layout_html', ''));
    }
    public static function get_email_button_color(): string
    {
        return self::hex((string) self::get_setting('email_button_color', '#141414'), '#141414');
    }
    /** @param mixed $default */
    public static function get_wp_option(string $option_name, $default = null)
    {
        return \get_option($option_name, $default);
    }
    /** @return array<string, mixed> */
    private static function storage(): array
    {
        return self::normalize_storage(self::get_wp_option(self::OPTION_NAME, []));
    }
    /** @param mixed $value @return array<string, mixed> */
    private static function normalize_storage($value): array
    {
        $raw = \is_array($value) ? $value : [];
        $groups = self::group_defaults();
        $map = self::field_group_map();
        $inputs = [];
        $normalized = [self::VERSION_KEY => self::VERSION];
        foreach ($groups as $group => $defaults) {
            $inputs[$group] = isset($raw[$group]) && \is_array($raw[$group]) ? $raw[$group] : [];
            unset($defaults);
        }
        foreach ($map as $field => $group) {
            if (\array_key_exists($field, $raw)) {
                $inputs[$group][$field] = $raw[$field];
            }
        }
        $normalized['general'] = self::normalize_general($inputs['general']);
        $normalized['booking_rules'] = self::normalize_booking_rules($inputs['booking_rules']);
        $normalized['checkin_checkout'] = self::normalize_checkin_checkout($inputs['checkin_checkout']);
        $normalized['payments_summary'] = self::normalize_payments($inputs['payments_summary']);
        $normalized['staff_access'] = self::normalize_staff_access($inputs['staff_access']);
        $normalized['branding'] = self::normalize_branding($inputs['branding']);
        $normalized['managed_pages'] = self::normalize_managed_pages($inputs['managed_pages']);
        $normalized['notifications_summary'] = self::normalize_notifications($inputs['notifications_summary']);
        $normalized['provider'] = self::normalize_provider($inputs['provider']);
        $normalized['maintenance'] = isset($inputs['maintenance']) && \is_array($inputs['maintenance']) ? $inputs['maintenance'] : [];
        foreach ($raw as $key => $item) {
            if (!\is_string($key) || $key === self::VERSION_KEY || isset($groups[$key]) || isset($map[$key])) {
                continue;
            }
            $normalized[$key] = $item;
        }
        return $normalized;
    }
    /** @return array<string, mixed> */
    private static function flatten(array $storage): array
    {
        $flat = $storage;
        foreach (self::field_group_map() as $field => $group) {
            $flat[$field] = $storage[$group][$field] ?? self::group_defaults()[$group][$field] ?? null;
        }
        return $flat;
    }
    /** @return array<string, string> */
    private static function field_group_map(): array
    {
        static $map = null;
        if (\is_array($map)) {
            return $map;
        }
        $map = [];
        foreach (self::group_defaults() as $group => $fields) {
            foreach ($fields as $field => $default) {
                unset($default);
                $map[$field] = $group;
            }
        }
        return $map;
    }
    /** @return array<string, array<string, mixed>> */
    private static function group_defaults(): array
    {
        $storage = self::default_storage();
        unset($storage[self::VERSION_KEY]);
        return $storage;
    }
    /** @return array<string, mixed> */
    private static function default_storage(): array
    {
        return [
            self::VERSION_KEY => self::VERSION,
            'general' => [
                'hotel_name' => self::site_name(),
                'hotel_legal_name' => '',
                'hotel_address' => '',
                'google_maps_url' => '',
                'hotel_phone' => '',
                'hotel_email' => self::admin_email(),
                'default_country' => self::country_fallback(),
                'timezone' => self::wp_timezone(),
                'currency' => 'USD',
                'currency_display' => 'symbol_code',
                'date_format' => (string) self::get_wp_option('date_format', 'F j, Y'),
                'time_format' => (string) self::get_wp_option('time_format', 'H:i'),
                'hotel_logo_url' => '',
                'portal_logo_url' => '',
                'site_environment' => '',
                'public_callback_base_url' => '',
                'must_api_base_url' => '',
                'must_tenant_id' => '',
                'must_property_id' => '',
            ],
            'booking_rules' => [
                'booking_window' => 365,
                'same_day_booking_allowed' => true,
                'same_day_booking_cutoff_time' => '18:00',
                'minimum_nights' => 1,
                'maximum_nights' => 30,
                'max_booking_guests' => 12,
                'max_booking_rooms' => 3,
                'allow_multi_room_booking' => true,
                'default_reservation_source' => 'website',
                'pending_reservation_expiration_minutes' => 35,
                'require_phone' => true,
                'require_country' => true,
                'enable_special_requests' => true,
                'require_terms_acceptance' => true,
                'default_reservation_status' => 'confirmed',
                'date_picker_calendar_layout' => 'two_calendars',
                'cancellation_allowed' => true,
                'cancellation_policy_days' => 21,
                'cancellation_notice_hours' => 504,
                'cancellation_refund_percent' => 97.0,
                'anti_abuse_enabled' => false,
                'anti_abuse_honeypot_enabled' => false,
                'anti_abuse_min_submit_enabled' => false,
                'anti_abuse_min_submit_seconds' => 5,
                'anti_abuse_throttle_enabled' => false,
                'anti_abuse_max_attempts' => 5,
                'anti_abuse_window_minutes' => 10,
                'anti_abuse_block_duration_minutes' => 30,
                'anti_abuse_logging_enabled' => false
            ],
            'checkin_checkout' => ['checkin_time' => '14:00', 'checkout_time' => '11:00', 'allow_early_checkin_request' => true, 'allow_late_checkout_request' => true, 'arrival_instructions' => '', 'departure_instructions' => '', 'guest_checkin_label' => \__('Check-in', 'must-hotel-booking'), 'guest_checkout_label' => \__('Check-out', 'must-hotel-booking')],
            'payments_summary' => [],
            'staff_access' => ['enable_staff_portal' => false, 'redirect_worker_after_login' => 'dashboard', 'hide_wp_admin_for_workers' => true, 'portal_access_roles' => self::staff_access_role_defaults(), 'capability_matrix' => self::staff_matrix_defaults(), 'portal_module_visibility' => self::portal_module_visibility_defaults()],
            'branding' => ['primary_color' => '#0f766e', 'secondary_color' => '#155e75', 'accent_color' => '#f59e0b', 'text_color' => '#16212b', 'border_radius' => 18, 'font_family' => 'Instrument Sans', 'inherit_elementor_colors' => false, 'inherit_elementor_typography' => false, 'portal_welcome_title' => \__('Welcome back', 'must-hotel-booking'), 'portal_welcome_text' => \__('Manage arrivals, departures, guest requests, and stay operations from one place.', 'must-hotel-booking'), 'booking_form_style_preset' => 'balanced'],
            'managed_pages' => ['page_rooms_id' => 0, 'page_booking_id' => 0, 'page_booking_accommodation_id' => 0, 'page_single_room_id' => 0, 'page_checkout_id' => 0, 'page_booking_confirmation_id' => 0],
            'notifications_summary' => ['booking_notification_email' => '', 'email_from_name' => '', 'email_from_email' => '', 'email_reply_to' => '', 'email_logo_url' => '', 'email_button_color' => '#141414', 'email_footer_text' => \__('We look forward to welcoming you.', 'must-hotel-booking'), 'email_layout_type' => 'classic', 'email_price_breakdown_mode' => 'total_only', 'custom_email_layout_html' => '', 'email_templates' => []],
            'provider' => [],
            'maintenance' => [],
        ];
    }
    private static function normalize_calendar_layout(string $layout): string
    {
        return self::choice(\sanitize_key($layout), ['one_calendar', 'two_calendars'], 'two_calendars');
    }
    private static function normalize_price_breakdown_mode(string $mode): string
    {
        return self::choice(\sanitize_key($mode), ['total_only', 'date_price_rows'], 'total_only');
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_general(array $v): array
    {
        $d = self::group_defaults()['general'];
        $email = \sanitize_email((string) ($v['hotel_email'] ?? $d['hotel_email']));
        return [
            'hotel_name' => \trim(\sanitize_text_field((string) ($v['hotel_name'] ?? $d['hotel_name']))) ?: (string) $d['hotel_name'],
            'hotel_legal_name' => \sanitize_text_field((string) ($v['hotel_legal_name'] ?? $d['hotel_legal_name'])),
            'hotel_address' => \sanitize_textarea_field((string) ($v['hotel_address'] ?? $d['hotel_address'])),
            'google_maps_url' => \esc_url_raw((string) ($v['google_maps_url'] ?? $d['google_maps_url'])),
            'hotel_phone' => \sanitize_text_field((string) ($v['hotel_phone'] ?? $d['hotel_phone'])),
            'hotel_email' => \is_email($email) ? $email : (string) $d['hotel_email'],
            'default_country' => self::country((string) ($v['default_country'] ?? $d['default_country'])),
            'timezone' => self::timezone((string) ($v['timezone'] ?? $d['timezone']), (string) $d['timezone']),
            'currency' => self::currency((string) ($v['currency'] ?? $d['currency'])),
            'currency_display' => self::choice((string) ($v['currency_display'] ?? $d['currency_display']), ['symbol', 'symbol_code', 'code'], (string) $d['currency_display']),
            'date_format' => \trim((string) ($v['date_format'] ?? $d['date_format'])) ?: (string) $d['date_format'],
            'time_format' => \trim((string) ($v['time_format'] ?? $d['time_format'])) ?: (string) $d['time_format'],
            'hotel_logo_url' => \esc_url_raw((string) ($v['hotel_logo_url'] ?? $d['hotel_logo_url'])),
            'portal_logo_url' => \esc_url_raw((string) ($v['portal_logo_url'] ?? $d['portal_logo_url'])),
            'site_environment' => \sanitize_key((string) ($v['site_environment'] ?? $d['site_environment'])),
            'public_callback_base_url' => self::normalize_public_callback_base_url((string) ($v['public_callback_base_url'] ?? $d['public_callback_base_url'])),
            'must_api_base_url' => self::normalize_public_callback_base_url((string) ($v['must_api_base_url'] ?? $d['must_api_base_url'])),
            'must_tenant_id' => self::uuid((string) ($v['must_tenant_id'] ?? $d['must_tenant_id'])),
            'must_property_id' => self::uuid((string) ($v['must_property_id'] ?? $d['must_property_id'])),
        ];
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_booking_rules(array $v): array
    {
        $d = self::group_defaults()['booking_rules'];
        return [
            'booking_window' => self::int($v['booking_window'] ?? $d['booking_window'], 1, 3650, (int) $d['booking_window']),
            'same_day_booking_allowed' => self::bool($v['same_day_booking_allowed'] ?? $d['same_day_booking_allowed']),
            'same_day_booking_cutoff_time' => self::time_or_blank((string) ($v['same_day_booking_cutoff_time'] ?? $d['same_day_booking_cutoff_time']), (string) $d['same_day_booking_cutoff_time']),
            'minimum_nights' => self::int($v['minimum_nights'] ?? $d['minimum_nights'], 1, 365, (int) $d['minimum_nights']),
            'maximum_nights' => self::int($v['maximum_nights'] ?? $d['maximum_nights'], 1, 365, (int) $d['maximum_nights']),
            'max_booking_guests' => self::int($v['max_booking_guests'] ?? $d['max_booking_guests'], 1, 100, (int) $d['max_booking_guests']),
            'max_booking_rooms' => self::int($v['max_booking_rooms'] ?? $d['max_booking_rooms'], 1, 25, (int) $d['max_booking_rooms']),
            'allow_multi_room_booking' => self::bool($v['allow_multi_room_booking'] ?? $d['allow_multi_room_booking']),
            'default_reservation_source' => self::choice(\sanitize_key((string) ($v['default_reservation_source'] ?? $d['default_reservation_source'])), ['website', 'phone', 'walk_in', 'email', 'portal', 'admin'], (string) $d['default_reservation_source']),
            'pending_reservation_expiration_minutes' => self::int($v['pending_reservation_expiration_minutes'] ?? $d['pending_reservation_expiration_minutes'], 5, 1440, (int) $d['pending_reservation_expiration_minutes']),
            'require_phone' => self::bool($v['require_phone'] ?? $d['require_phone']),
            'require_country' => self::bool($v['require_country'] ?? $d['require_country']),
            'enable_special_requests' => self::bool($v['enable_special_requests'] ?? $d['enable_special_requests']),
            'require_terms_acceptance' => self::bool($v['require_terms_acceptance'] ?? $d['require_terms_acceptance']),
            'default_reservation_status' => self::choice(\sanitize_key((string) ($v['default_reservation_status'] ?? $d['default_reservation_status'])), ['pending', 'pending_payment', 'confirmed', 'completed', 'cancelled'], (string) $d['default_reservation_status']),
            'date_picker_calendar_layout' => self::normalize_calendar_layout((string) ($v['date_picker_calendar_layout'] ?? $d['date_picker_calendar_layout'])),
            'cancellation_allowed' => self::bool($v['cancellation_allowed'] ?? $d['cancellation_allowed']),
            'cancellation_policy_days' => self::int($v['cancellation_policy_days'] ?? $d['cancellation_policy_days'], 0, 365, (int) $d['cancellation_policy_days']),
            'cancellation_notice_hours' => self::int($v['cancellation_notice_hours'] ?? ((int) ($v['cancellation_policy_days'] ?? $d['cancellation_policy_days']) * 24), 0, 8760, (int) $d['cancellation_notice_hours']),
            'cancellation_refund_percent' => self::decimal($v['cancellation_refund_percent'] ?? $d['cancellation_refund_percent'], 0.0, 100.0, (float) $d['cancellation_refund_percent']),
            'anti_abuse_enabled' => self::bool($v['anti_abuse_enabled'] ?? $d['anti_abuse_enabled']),
            'anti_abuse_honeypot_enabled' => self::bool($v['anti_abuse_honeypot_enabled'] ?? $d['anti_abuse_honeypot_enabled']),
            'anti_abuse_min_submit_enabled' => self::bool($v['anti_abuse_min_submit_enabled'] ?? $d['anti_abuse_min_submit_enabled']),
            'anti_abuse_min_submit_seconds' => self::int($v['anti_abuse_min_submit_seconds'] ?? $d['anti_abuse_min_submit_seconds'], 1, 60, (int) $d['anti_abuse_min_submit_seconds']),
            'anti_abuse_throttle_enabled' => self::bool($v['anti_abuse_throttle_enabled'] ?? $d['anti_abuse_throttle_enabled']),
            'anti_abuse_max_attempts' => self::int($v['anti_abuse_max_attempts'] ?? $d['anti_abuse_max_attempts'], 1, 50, (int) $d['anti_abuse_max_attempts']),
            'anti_abuse_window_minutes' => self::int($v['anti_abuse_window_minutes'] ?? $d['anti_abuse_window_minutes'], 1, 1440, (int) $d['anti_abuse_window_minutes']),
            'anti_abuse_block_duration_minutes' => self::int($v['anti_abuse_block_duration_minutes'] ?? $d['anti_abuse_block_duration_minutes'], 1, 1440, (int) $d['anti_abuse_block_duration_minutes']),
            'anti_abuse_logging_enabled' => self::bool($v['anti_abuse_logging_enabled'] ?? $d['anti_abuse_logging_enabled'])
        ];
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_checkin_checkout(array $v): array
    {
        $d = self::group_defaults()['checkin_checkout'];
        return ['checkin_time' => self::time((string) ($v['checkin_time'] ?? $d['checkin_time']), (string) $d['checkin_time']), 'checkout_time' => self::time((string) ($v['checkout_time'] ?? $d['checkout_time']), (string) $d['checkout_time']), 'allow_early_checkin_request' => self::bool($v['allow_early_checkin_request'] ?? $d['allow_early_checkin_request']), 'allow_late_checkout_request' => self::bool($v['allow_late_checkout_request'] ?? $d['allow_late_checkout_request']), 'arrival_instructions' => \sanitize_textarea_field((string) ($v['arrival_instructions'] ?? $d['arrival_instructions'])), 'departure_instructions' => \sanitize_textarea_field((string) ($v['departure_instructions'] ?? $d['departure_instructions'])), 'guest_checkin_label' => \sanitize_text_field((string) ($v['guest_checkin_label'] ?? $d['guest_checkin_label'])), 'guest_checkout_label' => \sanitize_text_field((string) ($v['guest_checkout_label'] ?? $d['guest_checkout_label']))];
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_payments(array $v): array
    {
        unset($v);
        return [];
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_staff_access(array $v): array
    {
        $d = self::group_defaults()['staff_access'];
        $portal = [];
        $roles = \array_keys(StaffAccess::getRoleLabels());
        $redirect = \sanitize_key((string) ($v['redirect_worker_after_login'] ?? $d['redirect_worker_after_login']));
        if ($redirect === 'portal_page' || $redirect === 'wordpress_dashboard') {
            $redirect = 'dashboard';
        }
        foreach ((isset($v['portal_access_roles']) && \is_array($v['portal_access_roles']) ? $v['portal_access_roles'] : (array) $d['portal_access_roles']) as $role) {
            $role = self::normalize_staff_role_slug((string) $role);
            if (\in_array($role, $roles, true)) {
                $portal[$role] = $role;
            }
        }
        return [
            'enable_staff_portal' => self::bool($v['enable_staff_portal'] ?? $d['enable_staff_portal']),
            'redirect_worker_after_login' => self::choice(
                $redirect,
                \array_keys(self::portal_module_visibility_defaults()),
                (string) $d['redirect_worker_after_login']
            ),
            'hide_wp_admin_for_workers' => self::bool($v['hide_wp_admin_for_workers'] ?? $d['hide_wp_admin_for_workers']),
            'portal_access_roles' => !empty($portal) ? \array_values($portal) : (array) $d['portal_access_roles'],
            'capability_matrix' => self::staff_matrix(isset($v['capability_matrix']) && \is_array($v['capability_matrix']) ? $v['capability_matrix'] : (array) $d['capability_matrix']),
            'portal_module_visibility' => self::portal_module_visibility(isset($v['portal_module_visibility']) && \is_array($v['portal_module_visibility']) ? $v['portal_module_visibility'] : (array) $d['portal_module_visibility']),
        ];
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_branding(array $v): array
    {
        $d = self::group_defaults()['branding'];
        return ['primary_color' => self::hex((string) ($v['primary_color'] ?? $d['primary_color']), (string) $d['primary_color']), 'secondary_color' => self::hex((string) ($v['secondary_color'] ?? $d['secondary_color']), (string) $d['secondary_color']), 'accent_color' => self::hex((string) ($v['accent_color'] ?? $d['accent_color']), (string) $d['accent_color']), 'text_color' => self::hex((string) ($v['text_color'] ?? $d['text_color']), (string) $d['text_color']), 'border_radius' => self::int($v['border_radius'] ?? $d['border_radius'], 0, 40, (int) $d['border_radius']), 'font_family' => \trim(\sanitize_text_field((string) ($v['font_family'] ?? $d['font_family']))) ?: (string) $d['font_family'], 'inherit_elementor_colors' => self::bool($v['inherit_elementor_colors'] ?? $d['inherit_elementor_colors']), 'inherit_elementor_typography' => self::bool($v['inherit_elementor_typography'] ?? $d['inherit_elementor_typography']), 'portal_welcome_title' => \sanitize_text_field((string) ($v['portal_welcome_title'] ?? $d['portal_welcome_title'])), 'portal_welcome_text' => \sanitize_textarea_field((string) ($v['portal_welcome_text'] ?? $d['portal_welcome_text'])), 'booking_form_style_preset' => self::choice(\sanitize_key((string) ($v['booking_form_style_preset'] ?? $d['booking_form_style_preset'])), ['balanced', 'editorial', 'minimal'], (string) $d['booking_form_style_preset'])];
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_managed_pages(array $v): array
    {
        $out = self::group_defaults()['managed_pages'];
        foreach ($out as $key => $default) {
            $out[$key] = \absint($v[$key] ?? $default);
        }
        return $out;
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_notifications(array $v): array
    {
        $d = self::group_defaults()['notifications_summary'];
        $notify = \sanitize_email((string) ($v['booking_notification_email'] ?? ''));
        $from = \sanitize_email((string) ($v['email_from_email'] ?? ''));
        $reply = \sanitize_email((string) ($v['email_reply_to'] ?? ''));
        return ['booking_notification_email' => \is_email($notify) ? $notify : (string) $d['booking_notification_email'], 'email_from_name' => \sanitize_text_field((string) ($v['email_from_name'] ?? $d['email_from_name'])), 'email_from_email' => \is_email($from) ? $from : (string) $d['email_from_email'], 'email_reply_to' => \is_email($reply) ? $reply : '', 'email_logo_url' => \esc_url_raw((string) ($v['email_logo_url'] ?? $d['email_logo_url'])), 'email_button_color' => self::hex((string) ($v['email_button_color'] ?? $d['email_button_color']), (string) $d['email_button_color']), 'email_footer_text' => \sanitize_textarea_field((string) ($v['email_footer_text'] ?? $d['email_footer_text'])), 'email_layout_type' => self::email_layout((string) ($v['email_layout_type'] ?? $d['email_layout_type'])), 'email_price_breakdown_mode' => self::normalize_price_breakdown_mode((string) ($v['email_price_breakdown_mode'] ?? $d['email_price_breakdown_mode'])), 'custom_email_layout_html' => (string) ($v['custom_email_layout_html'] ?? $d['custom_email_layout_html']), 'email_templates' => isset($v['email_templates']) && \is_array($v['email_templates']) ? $v['email_templates'] : (array) $d['email_templates']];
    }
    /** @param array<string, mixed> $v @return array<string, mixed> */
    private static function normalize_provider(array $v): array
    {
        unset($v);
        return [];
    }
    private static function site_name(): string
    {
        $name = \function_exists('get_bloginfo') ? \trim((string) \get_bloginfo('name')) : '';
        return $name !== '' ? $name : 'Hotel';
    }
    private static function admin_email(): string
    {
        $email = \sanitize_email((string) self::get_wp_option('admin_email', ''));
        return \is_email($email) ? $email : '';
    }
    private static function wp_timezone(): string
    {
        $timezone = \function_exists('wp_timezone_string') ? \trim((string) \wp_timezone_string()) : '';
        return $timezone !== '' ? $timezone : 'UTC';
    }
    private static function country_fallback(): string
    {
        $locale = \function_exists('get_locale') ? (string) \get_locale() : '';
        $parts = \preg_split('/[_-]/', $locale);
        $country = \is_array($parts) && isset($parts[1]) ? self::country((string) $parts[1]) : '';
        return $country !== '' ? $country : 'US';
    }
    private static function uuid(string $value): string
    {
        $value = \strtolower(\trim($value));
        return \preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $value) === 1
            ? $value
            : '';
    }
    private static function currency(string $value): string
    {
        $value = (string) \preg_replace('/[^A-Z]/', '', \strtoupper(\trim($value)));
        return $value !== '' ? (\strlen($value) > 10 ? \substr($value, 0, 10) : $value) : 'USD';
    }
    private static function country(string $value): string
    {
        $value = (string) \preg_replace('/[^A-Z]/', '', \strtoupper(\trim($value)));
        return \strlen($value) === 2 ? $value : self::country_fallback();
    }
    private static function timezone(string $value, string $fallback): string
    {
        $value = \trim($value);
        return $value !== '' && (\in_array($value, \timezone_identifiers_list(), true) || \preg_match('/^UTC[+-]\d{1,2}(?::\d{2})?$/', $value) === 1) ? $value : $fallback;
    }
    private static function email_layout(string $value): string
    {
        return self::choice(\sanitize_key($value), ['classic', 'luxury', 'compact', 'custom'], 'classic');
    }
    private static function time(string $value, string $fallback): string
    {
        $value = \trim($value);
        if (\preg_match('/^\d{2}:\d{2}$/', $value) !== 1) {
            return $fallback;
        }
        $h = (int) \substr($value, 0, 2);
        $m = (int) \substr($value, 3, 2);
        return ($h >= 0 && $h <= 23 && $m >= 0 && $m <= 59) ? \sprintf('%02d:%02d', $h, $m) : $fallback;
    }
    private static function time_or_blank(string $value, string $fallback = ''): string
    {
        return \trim($value) === '' ? $fallback : self::time($value, $fallback !== '' ? $fallback : '18:00');
    }
    private static function is_local_callback_host(string $host): bool
    {
        return $host === 'localhost'
            || $host === '127.0.0.1'
            || $host === '::1'
            || \substr($host, -10) === '.localhost'
            || \substr($host, -6) === '.local'
            || \substr($host, -5) === '.test';
    }
    private static function api_path(string $value, string $fallback): string
    {
        $value = \trim(\sanitize_text_field($value));
        if ($value === '') {
            return $fallback;
        }
        if (\preg_match('/^https?:\/\//i', $value) === 1) {
            return \esc_url_raw($value);
        }
        return '/' . \ltrim($value, '/');
    }
    private static function api_path_or_blank(string $value): string
    {
        $value = \trim($value);
        return $value !== '' ? self::api_path($value, '') : '';
    }
    /** @param mixed $value */
    private static function bool($value): bool
    {
        if (\is_bool($value)) {
            return $value;
        }
        return \in_array(\strtolower(\trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }
    /** @param mixed $value */
    private static function int($value, int $min, int $max, int $fallback): int
    {
        $value = \absint((string) $value);
        return ($value >= $min && $value <= $max) ? $value : $fallback;
    }
    /** @param mixed $value */
    private static function decimal($value, float $min, float $max, float $fallback): float
    {
        $value = \is_numeric($value) ? (float) $value : $fallback;
        return ($value >= $min && $value <= $max) ? $value : $fallback;
    }
    private static function hex(string $value, string $fallback): string
    {
        $color = \sanitize_hex_color($value);
        return \is_string($color) && $color !== '' ? $color : $fallback;
    }
    /** @param array<int, string> $allowed */
    private static function choice(string $value, array $allowed, string $fallback): string
    {
        return \in_array($value, $allowed, true) ? $value : $fallback;
    }
    /** @return array<string, array<string, bool>> */
    private static function staff_matrix_defaults(): array
    {
        return \class_exists(StaffAccess::class) ? StaffAccess::getDefaultCapabilityMatrix() : [];
    }
    /** @param array<string, mixed> $matrix @return array<string, array<string, bool>> */
    private static function staff_matrix(array $matrix): array
    {
        $defaults = self::staff_matrix_defaults();
        $normalizedMatrix = [];
        foreach ($matrix as $role => $capabilities) {
            if (!\is_string($role) || !\is_array($capabilities)) {
                continue;
            }
            $normalizedRole = self::normalize_staff_role_slug($role);
            if (!isset($defaults[$normalizedRole])) {
                continue;
            }
            $normalizedMatrix[$normalizedRole] = isset($normalizedMatrix[$normalizedRole]) && \is_array($normalizedMatrix[$normalizedRole])
                ? $normalizedMatrix[$normalizedRole]
                : [];
            foreach ($capabilities as $capability => $enabled) {
                if (!\is_string($capability) || !isset($defaults[$normalizedRole][$capability])) {
                    continue;
                }
                $normalizedMatrix[$normalizedRole][$capability] = self::bool($enabled);
            }
        }
        foreach ($defaults as $role => $caps) {
            $posted = isset($normalizedMatrix[$role]) && \is_array($normalizedMatrix[$role]) ? $normalizedMatrix[$role] : [];
            foreach ($caps as $cap => $enabled) {
                $defaults[$role][$cap] = !empty($posted[$cap]);
                unset($enabled);
            }
        }
        return $defaults;
    }
    /** @return array<int, string> */
    private static function staff_access_role_defaults(): array
    {
        return [
            StaffAccess::ROLE_FRONT_DESK,
            StaffAccess::ROLE_SUPERVISOR,
            StaffAccess::ROLE_HOUSEKEEPING,
            StaffAccess::ROLE_FINANCE,
            StaffAccess::ROLE_OPS_MANAGER,
        ];
    }
    /** @return array<string, bool> */
    private static function portal_module_visibility_defaults(): array
    {
        $defaults = [
            'dashboard' => true,
            'reservations' => true,
            'calendar' => true,
            'front_desk' => true,
            'guests' => true,
            'payments' => true,
            'housekeeping' => true,
            'reports' => true,
            'rooms_availability' => true,
        ];
        if (\class_exists(\MustHotelBooking\Portal\PortalRegistry::class)) {
            return \MustHotelBooking\Portal\PortalRegistry::getDefaultModuleVisibility();
        }
        return $defaults;
    }
    /** @param array<string, mixed> $visibility @return array<string, bool> */
    private static function portal_module_visibility(array $visibility): array
    {
        $defaults = self::portal_module_visibility_defaults();
        foreach ($defaults as $key => $enabled) {
            $defaults[$key] = self::bool($visibility[$key] ?? $enabled);
        }
        return $defaults;
    }
    private static function normalize_staff_role_slug(string $role): string
    {
        $role = \sanitize_key($role);
        $legacyMap = [
            'receptionist' => StaffAccess::ROLE_FRONT_DESK,
            'accountant' => StaffAccess::ROLE_FINANCE,
            'manager' => StaffAccess::ROLE_SUPERVISOR,
            'housekeeping' => StaffAccess::ROLE_HOUSEKEEPING,
            'mhb_worker' => StaffAccess::ROLE_FRONT_DESK,
            'mhb_manager' => StaffAccess::ROLE_SUPERVISOR,
        ];
        return isset($legacyMap[$role]) ? $legacyMap[$role] : $role;
    }
}
