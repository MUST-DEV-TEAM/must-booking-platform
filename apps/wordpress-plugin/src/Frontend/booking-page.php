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

/**
 * Resolve a physical room only when it belongs to the supplied room type and
 * the property supports individual-room booking.
 *
 * @param array<int, array<string, mixed>> $roomTypes
 * @param array<string, mixed>|null $selection
 * @return array<string, mixed>|null
 */
function resolve_fixed_physical_room(array $roomTypes, string $bookingMode, string $roomTypeId, string $roomId, ?array $selection = null): ?array
{
    if (
        $roomTypeId === '' ||
        $roomId === '' ||
        !\in_array($bookingMode, ['INDIVIDUAL_ROOM_ONLY', 'MIXED'], true)
    ) {
        return null;
    }

    foreach ($roomTypes as $roomType) {
        if ((string) ($roomType['id'] ?? '') !== $roomTypeId) {
            continue;
        }

        foreach ((array) ($roomType['rooms'] ?? []) as $room) {
            if ((string) ($room['id'] ?? '') !== $roomId) {
                continue;
            }

            $defaultRatePlan = \is_array($roomType['ratePlans'][0] ?? null) ? $roomType['ratePlans'][0] : [];
            return [
                'id' => $roomId,
                'physical_room_id' => $roomId,
                'room_type_id' => $roomTypeId,
                'name' => (string) ($room['name'] ?? ($selection['roomName'] ?? '')),
                'category_label' => (string) ($roomType['name'] ?? ''),
                'description' => (string) ($room['description'] ?? $roomType['description'] ?? ''),
                'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
                'title' => (string) ($room['title'] ?? ''),
                'room_size' => (string) ($room['roomSize'] ?? ''), 'beds' => '',
                'rules' => (string) ($room['rules'] ?? ''),
                'amenities' => \is_array($room['amenities'] ?? null) ? $room['amenities'] : [],
                'view_type' => (string) ($room['viewType'] ?? ''),
                'floor' => \array_key_exists('floor', $room) && $room['floor'] !== null ? (int) $room['floor'] : 0,
                'primary_image_url' => (string) ($roomType['mainImageUrl'] ?? ''),
                'rate_plan_id' => (string) (($selection['ratePlanId'] ?? '') ?: ($defaultRatePlan['id'] ?? '')),
            ];
        }
    }

    return null;
}

/** @return array<string, mixed>|null */
function get_url_fixed_physical_room(string $checkin = '', string $checkout = ''): ?array
{
    $raw = \is_array($_GET) ? $_GET : [];
    $roomTypeId = isset($raw['accommodation_type']) ? \sanitize_key((string) $raw['accommodation_type']) : '';
    $roomId = isset($raw['room_id']) ? \sanitize_text_field((string) $raw['room_id']) : '';
    $roomTypes = get_must_room_types($checkin, $checkout);

    return resolve_fixed_physical_room(
        $roomTypes,
        get_must_booking_mode($checkin, $checkout),
        $roomTypeId,
        $roomId
    );
}

/**
 * The calendar AJAX request deliberately reads the physical room from the
 * guest-session transient rather than accepting it from the browser. A
 * validated widget URL therefore records just enough selection context for
 * that calendar; the existing select_room POST later replaces it with the
 * date-specific quote.
 *
 * @param array<string, mixed> $fixedRoom
 */
function store_url_fixed_physical_room_selection(array $fixedRoom): void
{
    set_current_booking_selection([
        'roomTypeId' => (string) $fixedRoom['room_type_id'],
        'roomId' => (string) $fixedRoom['physical_room_id'],
        'roomName' => (string) $fixedRoom['name'],
        'ratePlanId' => (string) $fixedRoom['rate_plan_id'],
    ]);
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
    $urlRoomId = isset($raw['room_id']) ? \sanitize_text_field((string) $raw['room_id']) : '';
    $urlHasRoomInput = $urlRoomId !== '';
    $urlFixedRoom = get_url_fixed_physical_room($checkin, $checkout);
    if ($urlFixedRoom !== null) {
        store_url_fixed_physical_room_selection($urlFixedRoom);
    }
    $selection = get_current_booking_selection();
    $selectedRoomId = $selection !== null && isset($selection['roomId']) ? \sanitize_text_field((string) $selection['roomId']) : '';
    $selectedRoomTypeId = $selection !== null && isset($selection['roomTypeId']) ? \sanitize_text_field((string) $selection['roomTypeId']) : '';
    if ($selection !== null && $checkin === '' && isset($selection['checkin']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $selection['checkin']) === 1) {
        $checkin = (string) $selection['checkin'];
    }
    if ($selection !== null && $checkout === '' && isset($selection['checkout']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $selection['checkout']) === 1) {
        $checkout = (string) $selection['checkout'];
    }
    if ($selection !== null && !isset($raw['guests']) && isset($selection['guests'])) {
        $guests = \max(1, (int) $selection['guests']);
    }
    $categories = get_booking_categories($checkin, $checkout);
    $bookingMode = get_must_booking_mode($checkin, $checkout);
    $roomTypes = get_must_room_types($checkin, $checkout);
    // A URL room_id wins only when the complete URL pair resolves. An invalid
    // physical-room URL must not accidentally reuse an older room selection.
    $fixedRoom = $urlFixedRoom;
    if ($fixedRoom === null && !$urlHasRoomInput) {
        $fixedRoom = resolve_fixed_physical_room($roomTypes, $bookingMode, $selectedRoomTypeId, $selectedRoomId, $selection);
    }

    // A widget's accommodation_type is a clearable search filter. Only a
    // validated physical room (room_id) may activate the locked room flow.

    return [
        'messages' => [], 'rooms' => [],
        'checkin' => $checkin, 'checkout' => $checkout,
        'guests' => $guests, 'room_count' => $roomCount, 'resolved_room_count' => \max(1, $roomCount),
        'max_booking_guests' => get_max_booking_guests_limit(), 'max_booking_rooms' => get_max_booking_rooms_limit(),
        'accommodation_type' => $accommodationType, 'booking_categories' => $categories,
        'has_search' => $checkin !== '' && $checkout !== '', 'is_valid' => true,
        'booking_url' => get_booking_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(), 'checkout_url' => get_checkout_page_url(),
        'fixed_room_mode' => $fixedRoom !== null, 'fixed_room_id' => $fixedRoom['id'] ?? '', 'fixed_room' => $fixedRoom,
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
    $urlFixedRoom = get_url_fixed_physical_room();
    if ($urlFixedRoom !== null) {
        store_url_fixed_physical_room_selection($urlFixedRoom);
    }
    $selection = get_current_booking_selection();
    $roomId = $selection !== null && isset($selection['roomId']) ? \sanitize_text_field((string) $selection['roomId']) : '';
    $roomTypeId = $selection !== null && isset($selection['roomTypeId']) ? \sanitize_text_field((string) $selection['roomTypeId']) : '';
    \wp_localize_script('must-hotel-booking-calendar', 'mustHotelBookingCalendar', [
        'calendarLayout' => get_calendar_layout(),
        'roomAvailability' => $roomId !== '' && $roomTypeId !== '' ? [
            'ajaxUrl' => \admin_url('admin-ajax.php'),
            'nonce' => \wp_create_nonce('must_booking_room_calendar'),
        ] : null,
    ]);
}

function get_selected_room_calendar(): void
{
    $nonce = isset($_POST['nonce']) ? (string) \wp_unslash($_POST['nonce']) : '';
    if ($nonce === '' || !\wp_verify_nonce($nonce, 'must_booking_room_calendar')) {
        \wp_send_json_error(['message' => \__('Your request could not be verified. Please refresh and try again.', 'must-hotel-booking')], 403);
    }
    $selection = get_current_booking_selection();
    $roomId = $selection !== null && isset($selection['roomId']) ? \sanitize_text_field((string) $selection['roomId']) : '';
    $roomTypeId = $selection !== null && isset($selection['roomTypeId']) ? \sanitize_text_field((string) $selection['roomTypeId']) : '';
    $month = isset($_POST['month']) ? \sanitize_text_field((string) \wp_unslash($_POST['month'])) : '';
    if ($roomId === '' || $roomTypeId === '' || \preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month) !== 1) {
        \wp_send_json_error(['message' => \__('Selected room availability is unavailable. Please choose the room again.', 'must-hotel-booking')], 400);
    }
    $response = MustApiClient::get('/public/availability-calendar', [
        'roomTypeId' => $roomTypeId, 'roomId' => $roomId, 'month' => $month,
    ]);
    if (!$response['ok'] || !\is_array($response['body']) || !\is_array($response['body']['days'] ?? null)) {
        \wp_send_json_error(['message' => \__('Room availability could not be loaded. Please try again.', 'must-hotel-booking')], 502);
    }
    \wp_send_json_success(['days' => $response['body']['days']]);
}
\add_action('wp_ajax_must_booking_room_calendar', __NAMESPACE__ . '\\get_selected_room_calendar');
\add_action('wp_ajax_nopriv_must_booking_room_calendar', __NAMESPACE__ . '\\get_selected_room_calendar');
\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_booking_page_assets');
\add_filter('template_include', __NAMESPACE__ . '\\maybe_load_frontend_template', 99);
