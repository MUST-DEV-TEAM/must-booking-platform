<?php

namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustApiClient;
use MustHotelBooking\Core\MustBookingConfig;

function get_settings_option_name(): string { return MustBookingConfig::get_option_name(); }
/** @return array<string, mixed> */
function get_plugin_settings(): array { return MustBookingConfig::get_all_settings(); }
/** @param array<string, mixed> $settings */
function update_plugin_settings(array $settings): void { MustBookingConfig::set_all_settings($settings); }
/** @return array<string, array<string, mixed>> */
function get_frontend_pages_config(): array { return ManagedPages::getConfig(); }
function install_frontend_pages(): void { ManagedPages::install(); }
function get_booking_page_url(): string { return ManagedPages::getBookingPageUrl(); }
function get_booking_accommodation_page_url(): string { return ManagedPages::getBookingAccommodationPageUrl(); }
function get_checkout_page_url(): string { return ManagedPages::getCheckoutPageUrl(); }

function maybe_load_frontend_template(string $template): string
{
    if (\is_admin()) return $template;
    foreach (get_frontend_pages_config() as $key => $config) {
        if (!ManagedPages::isCurrentPage($key, (string) ($config['slug'] ?? ''))) continue;
        $candidate = MUST_HOTEL_BOOKING_PATH . (string) ($config['template'] ?? '');
        if (\is_file($candidate)) return $candidate;
    }
    return $template;
}

function is_frontend_booking_page(): bool { return ManagedPages::isCurrentPage('page_booking_id', 'booking'); }

function get_calendar_layout(): string
{
    return MustBookingConfig::get_setting('calendar_layout', 'one_calendar') === 'two_calendars' ? 'two_calendars' : 'one_calendar';
}

/**
 * A property with an individual-room-capable bookingMode (MIXED,
 * INDIVIDUAL_ROOM_ONLY) requires startsOn/endsOn on every catalog call, even
 * one that only wants room-type names — the endpoint 400s without them.
 * Cached per date-range (not just once) so a page that queries with real
 * dates and one that queries without (e.g. the search page's room-type
 * filter, before dates are chosen) don't clobber each other's cache entry.
 * @return array<string, mixed>
 */
function get_must_catalog(string $startsOn = '', string $endsOn = ''): array
{
    static $cache = [];
    $key = $startsOn . '|' . $endsOn;
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    $query = $startsOn !== '' && $endsOn !== '' ? ['startsOn' => $startsOn, 'endsOn' => $endsOn] : [];
    $response = MustApiClient::get('/public/catalog', $query);
    // Individual-room catalogues need a stay range so the API can report each
    // physical room's availability. Widgets and the first booking-page view do
    // not have guest-selected dates yet, so use a one-night display range only
    // when the range-less catalogue request is rejected. It is presentation
    // data, never the availability authority for a later booking.
    if (!$response['ok'] && $startsOn === '' && $endsOn === '') {
        $displayStartsOn = \current_time('Y-m-d');
        $displayEndsOn = (new \DateTimeImmutable($displayStartsOn))->modify('+1 day')->format('Y-m-d');
        $response = MustApiClient::get('/public/catalog', [
            'startsOn' => $displayStartsOn,
            'endsOn' => $displayEndsOn,
        ]);
    }
    $cache[$key] = $response['ok'] && \is_array($response['body']) ? $response['body'] : [];
    return $cache[$key];
}

/** @return array<int, array<string, mixed>> */
function get_must_room_types(string $startsOn = '', string $endsOn = ''): array
{
    $catalog = get_must_catalog($startsOn, $endsOn);
    return \is_array($catalog['roomTypes'] ?? null) ? $catalog['roomTypes'] : [];
}

/** @return string the property's bookingMode, e.g. 'ROOM_TYPE_ONLY'/'INDIVIDUAL_ROOM_ONLY'/'MIXED' (defaults to 'ROOM_TYPE_ONLY' if unknown) */
function get_must_booking_mode(string $startsOn = '', string $endsOn = ''): string
{
    $catalog = get_must_catalog($startsOn, $endsOn);
    $mode = isset($catalog['bookingMode']) ? (string) $catalog['bookingMode'] : '';
    return \in_array($mode, ['INDIVIDUAL_ROOM_ONLY', 'MIXED'], true) ? $mode : 'ROOM_TYPE_ONLY';
}

/** @return array<int, string> the property's enabled guest payment methods, e.g. ['stripe', 'pay_at_hotel'] */
function get_must_payment_methods(string $startsOn = '', string $endsOn = ''): array
{
    $catalog = get_must_catalog($startsOn, $endsOn);
    $methods = \is_array($catalog['paymentMethods'] ?? null) ? $catalog['paymentMethods'] : [];
    return \array_values(\array_filter($methods, static fn ($method) => \is_string($method)));
}

/** @return array<string, string> slug (room type id) => label (room type name) */
function get_booking_categories(string $startsOn = '', string $endsOn = ''): array
{
    $categories = [];
    foreach (get_must_room_types($startsOn, $endsOn) as $roomType) {
        $id = isset($roomType['id']) ? (string) $roomType['id'] : '';
        $name = isset($roomType['name']) ? (string) $roomType['name'] : '';
        if ($id !== '' && $name !== '') {
            $categories[$id] = $name;
        }
    }
    return $categories;
}

/** @return array<string, mixed> */
function get_booking_page_view_data(): array
{
    $raw = \is_array($_GET) ? $_GET : [];
    $checkin = isset($raw['checkin']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $raw['checkin']) === 1 ? (string) $raw['checkin'] : '';
    $checkout = isset($raw['checkout']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $raw['checkout']) === 1 ? (string) $raw['checkout'] : '';
    $guests = isset($raw['guests']) ? \max(1, (int) $raw['guests']) : 1;
    $roomCount = isset($raw['room_count']) ? \max(0, (int) $raw['room_count']) : 0;
    $accommodationType = isset($raw['accommodation_type']) ? \sanitize_key((string) $raw['accommodation_type']) : '';
    $categories = get_booking_categories($checkin, $checkout);

    return [
        'messages' => [], 'rooms' => [],
        'checkin' => $checkin, 'checkout' => $checkout,
        'guests' => $guests, 'room_count' => $roomCount, 'resolved_room_count' => \max(1, $roomCount),
        'max_booking_guests' => get_max_booking_guests_limit(), 'max_booking_rooms' => get_max_booking_rooms_limit(),
        'accommodation_type' => $accommodationType, 'booking_categories' => $categories,
        'has_search' => $checkin !== '' && $checkout !== '', 'is_valid' => true,
        'booking_url' => get_booking_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(), 'checkout_url' => get_checkout_page_url(),
        'fixed_room_mode' => false, 'fixed_room_id' => 0, 'fixed_room' => null,
        'calendar_layout' => get_calendar_layout(), 'initial_step' => 1,
    ];
}

function format_booking_results_date_range(string $checkin, string $checkout): string
{
    if ($checkin === '' || $checkout === '') {
        return \__('Select dates', 'must-hotel-booking');
    }
    $checkin_timestamp = \strtotime($checkin . ' 00:00:00');
    $checkout_timestamp = \strtotime($checkout . ' 00:00:00');
    if ($checkin_timestamp === false || $checkout_timestamp === false) {
        return \__('Select dates', 'must-hotel-booking');
    }
    return \sprintf(
        /* translators: 1: check-in day, 2: check-in month, 3: check-out day, 4: check-out month, 5: year. */
        \__('%1$s %2$s - %3$s %4$s %5$s', 'must-hotel-booking'),
        \wp_date('d', $checkin_timestamp),
        \wp_date('F', $checkin_timestamp),
        \wp_date('d', $checkout_timestamp),
        \wp_date('F', $checkout_timestamp),
        \wp_date('Y', $checkout_timestamp)
    );
}
function format_booking_room_count_label(int $room_count): string
{
    return \sprintf(
        /* translators: %d is room count. */
        \_n('%d Room', '%d Rooms', \max(1, $room_count), 'must-hotel-booking'),
        \max(1, $room_count)
    );
}
function get_max_booking_guests_limit(): int
{
    return \max(1, MustBookingConfig::get_max_booking_guests());
}
function get_max_booking_rooms_limit(): int
{
    return \max(1, MustBookingConfig::get_max_booking_rooms());
}
function format_booking_category_label(string $accommodation_type): string
{
    $categories = get_booking_categories();
    if (isset($categories[$accommodation_type])) {
        return $categories[$accommodation_type];
    }
    $label = \trim((string) \preg_replace('/\s+/', ' ', \str_replace(['-', '_'], ' ', $accommodation_type)));
    return $label !== '' ? \ucwords($label) : \__('Any room type', 'must-hotel-booking');
}
function format_booking_results_selection_summary(string $accommodation_type, int $guests, int $room_count = 0): string
{
    $resolved_room_count = $room_count > 0 ? \min(get_max_booking_rooms_limit(), $room_count) : 1;
    return \sprintf(
        /* translators: 1: accommodation type label, 2: guests count, 3: room count label. */
        \__('%1$s / %2$d Guests / %3$s', 'must-hotel-booking'),
        format_booking_category_label($accommodation_type),
        \max(1, $guests),
        format_booking_room_count_label($resolved_room_count)
    );
}

function enqueue_shared_booking_assets(): void
{
    \wp_enqueue_style('must-hotel-booking-booking-page', MUST_HOTEL_BOOKING_URL . 'assets/css/booking-page.css', [], MUST_HOTEL_BOOKING_VERSION);
}

function enqueue_booking_page_assets(): void
{
    if (!is_frontend_booking_page()) return;
    enqueue_shared_booking_assets();
    \wp_enqueue_style('must-hotel-booking-flatpickr', 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css', [], MUST_HOTEL_BOOKING_VERSION);
    \wp_enqueue_script('must-hotel-booking-flatpickr', 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js', [], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_enqueue_script('must-hotel-booking-calendar', MUST_HOTEL_BOOKING_URL . 'assets/js/must-booking-calendar.js', ['must-hotel-booking-flatpickr'], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_localize_script('must-hotel-booking-calendar', 'mustHotelBookingCalendar', ['calendarLayout' => get_calendar_layout()]);
}
\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_booking_page_assets');
\add_filter('template_include', __NAMESPACE__ . '\\maybe_load_frontend_template', 99);
