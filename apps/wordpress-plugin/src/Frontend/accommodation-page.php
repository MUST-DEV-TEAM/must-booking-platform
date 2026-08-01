<?php
namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustApiClient;

function is_frontend_booking_accommodation_page(): bool { return ManagedPages::isCurrentPage('page_booking_accommodation_id', 'booking-accommodation'); }

function get_accommodation_continue_label(bool $can_continue, int $selected_room_count, int $resolved_room_count): string
{
    if ($can_continue) {
        return \sprintf(
            /* translators: %d is selected room count. */
            \_n('Continue with %d Room', 'Continue with %d Rooms', $selected_room_count, 'must-hotel-booking'),
            $selected_room_count
        );
    }
    return \sprintf(
        /* translators: 1: selected room count, 2: target room count label. */
        \__('Selected %1$d / %2$s', 'must-hotel-booking'),
        $selected_room_count,
        format_booking_room_count_label($resolved_room_count)
    );
}

function get_booking_selection_transient_key(): ?string
{
    $guestId = MustApiClient::guestSessionId();
    return $guestId !== null ? 'must_booking_selection_' . $guestId : null;
}

/** @return array<string, mixed>|null */
function get_current_booking_selection(): ?array
{
    $key = get_booking_selection_transient_key();
    if ($key === null) return null;
    $value = \get_transient($key);
    return \is_array($value) ? $value : null;
}

/** @param array<string, mixed> $selection */
function set_current_booking_selection(array $selection): void
{
    $key = get_booking_selection_transient_key();
    if ($key === null) return;
    \set_transient($key, $selection, 30 * \MINUTE_IN_SECONDS);
}

function clear_current_booking_selection(): void
{
    $key = get_booking_selection_transient_key();
    if ($key === null) return;
    \delete_transient($key);
}

/** Handle the room-selection form POST before any output. Redirects on success. */
function maybe_process_accommodation_selection(): string
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return '';
    $action = isset($_POST['must_accommodation_action']) ? \sanitize_key((string) $_POST['must_accommodation_action']) : '';
    if ($action === 'remove_selected_room') {
        clear_current_booking_selection();
        return '';
    }
    if ($action !== 'select_room') return '';
    $postedNonce = isset($_POST['must_accommodation_nonce']) ? (string) \wp_unslash($_POST['must_accommodation_nonce']) : '';
    if ($postedNonce === '' || !\wp_verify_nonce($postedNonce, 'must_accommodation_select_room')) {
        return \__('Your selection could not be verified. Please try again.', 'must-hotel-booking');
    }
    $roomTypeId = isset($_POST['must_room_type_id']) ? \sanitize_text_field((string) \wp_unslash($_POST['must_room_type_id'])) : '';
    $ratePlanId = isset($_POST['must_rate_plan_id']) ? \sanitize_text_field((string) \wp_unslash($_POST['must_rate_plan_id'])) : '';
    $checkin = isset($_POST['checkin']) ? \sanitize_text_field((string) \wp_unslash($_POST['checkin'])) : '';
    $checkout = isset($_POST['checkout']) ? \sanitize_text_field((string) \wp_unslash($_POST['checkout'])) : '';
    if ($roomTypeId === '' || $ratePlanId === '' || $checkin === '' || $checkout === '') {
        return \__('That room could not be selected. Please try again.', 'must-hotel-booking');
    }

    $roomName = '';
    $ratePlanName = '';
    foreach (get_must_room_types() as $roomType) {
        if ((string) ($roomType['id'] ?? '') !== $roomTypeId) continue;
        $roomName = (string) ($roomType['name'] ?? '');
        foreach ((array) ($roomType['ratePlans'] ?? []) as $ratePlan) {
            if ((string) ($ratePlan['id'] ?? '') === $ratePlanId) {
                $ratePlanName = (string) ($ratePlan['name'] ?? '');
            }
        }
    }

    $quote = MustApiClient::post('/quotes', [
        'roomTypeId' => $roomTypeId, 'ratePlanId' => $ratePlanId, 'startsOn' => $checkin, 'endsOn' => $checkout,
    ]);
    if (!$quote['ok'] || !\is_array($quote['body'])) {
        return \__('That room is no longer available for these dates. Please choose another.', 'must-hotel-booking');
    }

    set_current_booking_selection([
        'roomTypeId' => $roomTypeId, 'ratePlanId' => $ratePlanId, 'roomName' => $roomName, 'ratePlanName' => $ratePlanName,
        'checkin' => $checkin, 'checkout' => $checkout, 'quote' => $quote['body'],
    ]);
    \wp_safe_redirect(get_checkout_page_url());
    exit;
}

/** @return array<string, mixed> */
function get_accommodation_page_view_data(): array
{
    $selectionError = maybe_process_accommodation_selection();
    $messages = $selectionError !== '' ? [$selectionError] : [];

    $raw = \is_array($_GET) ? $_GET : [];
    $checkin = isset($raw['checkin']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $raw['checkin']) === 1 ? (string) $raw['checkin'] : '';
    $checkout = isset($raw['checkout']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $raw['checkout']) === 1 ? (string) $raw['checkout'] : '';
    $guests = isset($raw['guests']) ? \max(1, (int) $raw['guests']) : 1;
    $roomCount = isset($raw['room_count']) ? \max(0, (int) $raw['room_count']) : 0;
    $accommodationType = isset($raw['accommodation_type']) ? \sanitize_key((string) $raw['accommodation_type']) : '';
    $hasContext = $checkin !== '' && $checkout !== '';

    $selection = get_current_booking_selection();
    $selectedRoomCount = $selection !== null ? 1 : 0;

    $rooms = [];
    if ($hasContext) {
        $index = 0;
        foreach (get_must_room_types() as $roomType) {
            $roomTypeId = (string) ($roomType['id'] ?? '');
            if ($roomTypeId === '' || ($accommodationType !== '' && $roomTypeId !== $accommodationType)) continue;
            $availability = MustApiClient::get('/public/availability', ['roomTypeId' => $roomTypeId, 'startsOn' => $checkin, 'endsOn' => $checkout]);
            $available = $availability['ok'] && !empty($availability['body']['isAvailable']);
            if (!$available) continue;
            $index++;
            $ratePlans = [];
            $roomCurrency = 'USD';
            foreach ((array) ($roomType['ratePlans'] ?? []) as $ratePlan) {
                $roomCurrency = (string) ($ratePlan['currency'] ?? $roomCurrency);
                $ratePlans[] = [
                    'id' => $index, 'must_rate_plan_uuid' => (string) ($ratePlan['id'] ?? ''),
                    'name' => (string) ($ratePlan['name'] ?? ''), 'description' => '',
                    'nightly_price' => 0.0, 'total_price' => 0.0,
                ];
            }
            $amenities = [];
            foreach ((array) ($roomType['amenities'] ?? []) as $amenity) {
                $amenities[] = ['label' => (string) ($amenity['name'] ?? ''), 'icon' => ''];
            }
            $rooms[] = [
                'id' => $index, 'room_type_id' => $index, 'physical_room_id' => 0,
                'must_room_type_uuid' => $roomTypeId,
                'name' => (string) ($roomType['name'] ?? ''), 'description' => (string) ($roomType['description'] ?? ''),
                'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
                'available_count' => (int) ($availability['body']['availableUnits'] ?? 0),
                'currency' => $roomCurrency,
                'primary_image_url' => '', 'gallery_images' => [], 'lightbox_images' => [], 'room_rules' => '',
                'amenities' => $amenities, 'rate_plans' => $ratePlans,
                'is_selected' => $selection !== null && ($selection['roomTypeId'] ?? '') === $roomTypeId,
                'selected_rate_plan_id' => 0,
            ];
        }
    }

    return [
        'messages' => $messages, 'rooms' => $rooms, 'has_context' => $hasContext, 'is_valid' => true,
        'checkin' => $checkin, 'checkout' => $checkout, 'guests' => $guests, 'room_count' => $roomCount, 'resolved_room_count' => 1,
        'accommodation_type' => $accommodationType, 'selected_rooms' => [], 'selected_room_count' => $selectedRoomCount,
        'can_continue' => $selectedRoomCount > 0, 'selection_limit_reached' => $selectedRoomCount > 0, 'single_room_mode' => true,
        'no_rooms_message' => $hasContext ? \__('No rooms are available for the selected dates.', 'must-hotel-booking') : \__('Choose your dates to see available rooms.', 'must-hotel-booking'),
        'selection_status_message' => '', 'selection_status_tone' => 'neutral',
        'booking_url' => get_booking_page_url(), 'checkout_url' => get_checkout_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(),
    ];
}

function enqueue_booking_accommodation_page_assets(): void { if (is_frontend_booking_accommodation_page()) enqueue_shared_booking_assets(); }
\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_booking_accommodation_page_assets');
