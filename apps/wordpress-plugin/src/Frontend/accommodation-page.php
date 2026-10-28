<?php
namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustApiClient;
use MustHotelBooking\Core\MustBookingConfig;

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
    $roomId = isset($_POST['must_room_id']) ? \sanitize_text_field((string) \wp_unslash($_POST['must_room_id'])) : '';
    $ratePlanId = isset($_POST['must_rate_plan_id']) ? \sanitize_text_field((string) \wp_unslash($_POST['must_rate_plan_id'])) : '';
    $checkin = isset($_POST['checkin']) ? \sanitize_text_field((string) \wp_unslash($_POST['checkin'])) : '';
    $checkout = isset($_POST['checkout']) ? \sanitize_text_field((string) \wp_unslash($_POST['checkout'])) : '';
    $legacyGuests = isset($_POST['guests']) ? \max(1, (int) $_POST['guests']) : 1;
    $adults = isset($_POST['adults']) ? \max(1, (int) $_POST['adults']) : $legacyGuests;
    $children = isset($_POST['children']) ? \max(0, (int) $_POST['children']) : 0;
    $guests = $adults + $children;
    $roomCount = isset($_POST['room_count']) ? \min(get_max_booking_rooms_limit(), \max(0, (int) $_POST['room_count'])) : 0;
    if ($roomTypeId === '' || $checkin === '' || $checkout === '') {
        return \__('That room could not be selected. Please try again.', 'must-hotel-booking');
    }
    $stayError = MustBookingConfig::validate_stay_dates($checkin, $checkout);
    if ($stayError !== '') {
        return $stayError;
    }
    if ($guests > get_max_booking_guests_limit()) {
        return \sprintf(
            /* translators: %d is the property's maximum party size. */
            __('This property accepts up to %d guests in one booking.', 'must-hotel-booking'),
            get_max_booking_guests_limit()
        );
    }
    if ($roomCount > 1) {
        return \__('This booking flow can confirm one room at a time. Please choose 1 room.', 'must-hotel-booking');
    }

    $roomName = '';
    $ratePlanName = '';
    $requiresRatePlanSelection = true;
    $roomCapacity = 0;
    foreach (get_must_room_types($checkin, $checkout) as $roomType) {
        if ((string) ($roomType['id'] ?? '') !== $roomTypeId) continue;
        $roomCapacity = \max(0, (int) ($roomType['maxOccupancy'] ?? 0));
        $requiresRatePlanSelection = !isset($roomType['requiresRatePlanSelection']) || (bool) $roomType['requiresRatePlanSelection'];
        if ($roomId !== '') {
            foreach ((array) ($roomType['rooms'] ?? []) as $physicalRoom) {
                if ((string) ($physicalRoom['id'] ?? '') === $roomId) {
                    $roomName = (string) ($physicalRoom['name'] ?? '');
                }
            }
        }
        if ($roomName === '') {
            $roomName = (string) ($roomType['name'] ?? '');
        }
        foreach ((array) ($roomType['ratePlans'] ?? []) as $ratePlan) {
            if ((string) ($ratePlan['id'] ?? '') === $ratePlanId) {
                $ratePlanName = (string) ($ratePlan['name'] ?? '');
            }
        }
    }
    if ($roomCapacity < $guests) {
        return \sprintf(
            /* translators: 1: requested guest count, 2: selected room capacity. */
            __('This party has %1$d guests, but the selected room accommodates up to %2$d. Please choose another room.', 'must-hotel-booking'),
            $guests,
            $roomCapacity
        );
    }
    // A Clock-connected room type is priced live by Clock, with no local rate
    // plan for the guest to pick — must_rate_plan_id is legitimately empty then.
    if ($requiresRatePlanSelection && $ratePlanId === '') {
        return \__('That room could not be selected. Please try again.', 'must-hotel-booking');
    }
    if (!$requiresRatePlanSelection && $ratePlanName === '') {
        $ratePlanName = \__('Best available rate', 'must-hotel-booking');
    }

    // Clock-connected catalog entries are priced without a local rate plan.
    // Ask the same advisory endpoint used by the calendar before moving the
    // guest to details; failures remain fail-open because the quote/payment
    // path performs the authoritative final check.
    if (!$requiresRatePlanSelection) {
        $availabilityQuery = [
            'roomTypeId' => $roomTypeId,
            'startsOn' => $checkin, 'endsOn' => $checkout,
            'adults' => $adults, 'children' => $children,
        ];
        if ($roomId !== '') $availabilityQuery['roomId'] = $roomId;
        $availability = MustApiClient::get('/public/availability-check', $availabilityQuery);
        $availabilityBody = $availability['body'] ?? null;
        if (
            $availability['ok'] && \is_array($availabilityBody) &&
            ($availabilityBody['checked'] ?? false) === true &&
            ($availabilityBody['isAvailable'] ?? true) === false
        ) {
            return \__('That room is no longer available for these dates. Please choose another.', 'must-hotel-booking');
        }
    }

    $quoteInput = [
        'roomTypeId' => $roomTypeId, 'ratePlanId' => $ratePlanId,
        'startsOn' => $checkin, 'endsOn' => $checkout,
        'adults' => $adults, 'children' => $children, 'guestCount' => $guests,
    ];
    if ($roomId !== '') {
        $quoteInput['roomId'] = $roomId;
    }
    $quote = MustApiClient::post('/quotes', $quoteInput);
    if (!$quote['ok'] || !\is_array($quote['body'])) {
        return \__('That room is no longer available for these dates. Please choose another.', 'must-hotel-booking');
    }

    set_current_booking_selection([
        'roomTypeId' => $roomTypeId, 'roomId' => $roomId, 'ratePlanId' => $ratePlanId,
        'roomName' => $roomName, 'ratePlanName' => $ratePlanName,
        'checkin' => $checkin, 'checkout' => $checkout, 'guests' => $guests,
        'adults' => $adults, 'children' => $children, 'quote' => $quote['body'],
    ]);
    if (!\wp_doing_ajax()) {
        \wp_safe_redirect(get_checkout_page_url());
        exit;
    }
    return '';
}

/** AJAX counterpart for the Select Accommodation form.  It shares the exact
 * validation and transient update path above, while keeping ordinary form POST
 * navigation as a no-JavaScript fallback. */
function update_accommodation_selection(): void
{
    $message = maybe_process_accommodation_selection();
    if ($message !== '') {
        \wp_send_json_error(['messages' => [$message]], 400);
    }
    $action = isset($_POST['must_accommodation_action']) ? \sanitize_key((string) \wp_unslash($_POST['must_accommodation_action'])) : '';
    if ($action === 'select_room') {
        \wp_send_json_success(['redirect_url' => get_checkout_page_url()]);
    }
    \wp_send_json_success([
        'messages' => [],
        'selected_room_ids' => [],
        'selected_room_rate_plans' => [],
        'can_continue' => false,
        'selection_status_message' => '',
        'selection_status_tone' => 'neutral',
    ]);
}

/** @param array<string, mixed> $roomType @return array<int, array<string, mixed>> */
function get_room_type_rate_plans_view_data(array $roomType, int $index): array
{
    $ratePlans = [];
    foreach ((array) ($roomType['ratePlans'] ?? []) as $ratePlan) {
        $ratePlans[] = [
            'id' => $index, 'must_rate_plan_uuid' => (string) ($ratePlan['id'] ?? ''),
            'name' => (string) ($ratePlan['name'] ?? ''), 'description' => '',
            'nightly_price' => 0.0, 'total_price' => 0.0,
        ];
    }
    $requiresRatePlanSelection = !isset($roomType['requiresRatePlanSelection']) || (bool) $roomType['requiresRatePlanSelection'];
    if (!$requiresRatePlanSelection && empty($ratePlans)) {
        // Clock-connected room type: priced live by Clock, no local rate plan
        // to pick — a placeholder keeps the existing template's "select room"
        // button rendering unchanged (it requires a rate plan to be present);
        // must_rate_plan_uuid stays empty on purpose.
        $ratePlans[] = [
            'id' => $index, 'must_rate_plan_uuid' => '',
            'name' => \__('Best available rate', 'must-hotel-booking'), 'description' => '',
            'nightly_price' => 0.0, 'total_price' => 0.0,
        ];
    }
    return $ratePlans;
}

/** @param array<string, mixed> $roomType @return array<int, array<string, mixed>> */
function get_room_type_amenities_view_data(array $roomType): array
{
    // Every amenity key the system stores has its own icon in assets/img/amenities/, generated from the
    // dashboard's amenity catalog (apps/web/scripts/generate-plugin-amenity-icons.mjs). An amenity with no
    // icon chosen gets a neutral tick instead of an empty square.
    $amenities = [];
    foreach ((array) ($roomType['amenities'] ?? []) as $amenity) {
        $icon = (string) ($amenity['icon'] ?? '');
        $file = \preg_match('/^[A-Z][A-Z_]*$/', $icon) === 1
            ? 'amenities/' . \strtolower($icon) . '.svg'
            : 'check.svg';
        $amenities[] = [
            'label' => (string) ($amenity['name'] ?? ''),
            'icon' => \must_hotel_booking_asset_url('assets/img/' . $file),
        ];
    }
    return $amenities;
}

/** @param array<string, mixed> $roomType @return array{primary_image_url: string, gallery_images: array<int, string>, lightbox_images: array<int, string>} */
function get_room_type_media_view_data(array $roomType): array
{
    $primaryImageUrl = (string) ($roomType['mainImageUrl'] ?? '');
    $galleryImages = [];
    foreach ((array) ($roomType['galleryImageUrls'] ?? []) as $url) {
        if (!\is_string($url) || $url === '') continue;
        $galleryImages[] = $url;
    }
    $lightboxImages = $primaryImageUrl === '' ? $galleryImages : \array_values(\array_unique([$primaryImageUrl, ...$galleryImages]));
    return [
        'primary_image_url' => $primaryImageUrl,
        'gallery_images' => $galleryImages,
        'lightbox_images' => $lightboxImages,
    ];
}

/** @return array<string, mixed> */
function get_accommodation_page_view_data(): array
{
    $selectionError = maybe_process_accommodation_selection();
    $messages = $selectionError !== '' ? [$selectionError] : [];

    $raw = \is_array($_GET) ? $_GET : [];
    $checkin = isset($raw['checkin']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $raw['checkin']) === 1 ? (string) $raw['checkin'] : '';
    $checkout = isset($raw['checkout']) && \preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $raw['checkout']) === 1 ? (string) $raw['checkout'] : '';
    $legacyGuests = isset($raw['guests']) ? \max(1, (int) $raw['guests']) : 1;
    $adults = isset($raw['adults']) ? \max(1, (int) $raw['adults']) : $legacyGuests;
    $children = isset($raw['children']) ? \max(0, (int) $raw['children']) : 0;
    $guests = $adults + $children;
    $roomCount = isset($raw['room_count']) ? \min(get_max_booking_rooms_limit(), \max(0, (int) $raw['room_count'])) : 0;
    $accommodationType = isset($raw['accommodation_type']) ? \sanitize_key((string) $raw['accommodation_type']) : '';
    $hasContext = $checkin !== '' && $checkout !== '';

    $selection = get_current_booking_selection();
    $selectionMatchesContext = $selection !== null &&
        (string) ($selection['checkin'] ?? '') === $checkin &&
        (string) ($selection['checkout'] ?? '') === $checkout &&
        (int) ($selection['adults'] ?? $selection['guests'] ?? 1) === $adults &&
        (int) ($selection['children'] ?? 0) === $children;
    $selectedRoomCount = $selectionMatchesContext ? 1 : 0;

    $rooms = [];
    $partyCapacityMessage = '';
    if ($guests > get_max_booking_guests_limit()) {
        $partyCapacityMessage = \sprintf(
            /* translators: %d is the property's maximum party size. */
            __('This property accepts up to %d guests in one booking.', 'must-hotel-booking'),
            get_max_booking_guests_limit()
        );
    } elseif ($roomCount > 1) {
        $partyCapacityMessage = \__('This booking flow can confirm one room at a time. Please choose 1 room.', 'must-hotel-booking');
    }
    if ($partyCapacityMessage !== '') {
        $messages[] = $partyCapacityMessage;
    }
    $hasRoomWithSufficientCapacity = false;
    if ($hasContext && $partyCapacityMessage === '') {
        $index = 0;
        // The selection flow quotes and books one room only. It must therefore
        // never present a multi-room search as if it could allocate rooms.
        // A property configured INDIVIDUAL_ROOM_ONLY requires an explicit
        // roomId on every booking (LocalPmsProvider.validateRoomSelection
        // rejects otherwise) — the catalog already returns each room type's
        // own physical rooms with per-day availability for exactly this case
        // (Milestone 10), so one card per available physical room is shown
        // here instead of one per room type. MIXED properties keep today's
        // simpler per-room-type flow — the backend auto-assigns a same-priced
        // room, no picker needed.
        $bookingMode = get_must_booking_mode($checkin, $checkout);
        $allRoomTypes = get_must_room_types($checkin, $checkout);
        // A hotel system such as Clock answers availability, rooms left and the price of every room type in ONE
        // request, so the room types are not asked about one by one. Room types that cannot be booked are shown
        // greyed out with the reason. If that one request fails, the old room-by-room path below still works.
        $searchAnswers = [];
        if ($bookingMode !== 'INDIVIDUAL_ROOM_ONLY' && get_must_pricing_source($checkin, $checkout) === 'CLOCK_PMS') {
            $searchItems = [];
            foreach ($allRoomTypes as $searchRoomType) {
                $searchRoomTypeId = (string) ($searchRoomType['id'] ?? '');
                if ($searchRoomTypeId === '' || ($accommodationType !== '' && $searchRoomTypeId !== $accommodationType)) continue;
                $searchItems[] = ['key' => $searchRoomTypeId, 'room_type_id' => $searchRoomTypeId, 'room_id' => '', 'rate_plan_id' => '', 'currency' => ''];
            }
            $searchAnswers = get_must_display_prices($searchItems, $checkin, $checkout, $adults, $children, $guests, 1);
        }
        foreach ($allRoomTypes as $roomType) {
            $roomTypeId = (string) ($roomType['id'] ?? '');
            if ($roomTypeId === '' || ($accommodationType !== '' && $roomTypeId !== $accommodationType)) continue;
            $searchAnswer = isset($searchAnswers[$roomTypeId]) && \is_array($searchAnswers[$roomTypeId]) ? $searchAnswers[$roomTypeId] : null;
            if ($searchAnswer !== null) {
                $fits = (int) ($roomType['maxOccupancy'] ?? 0) >= $guests;
                if ($fits) $hasRoomWithSufficientCapacity = true;
                $answerReason = $fits ? (string) ($searchAnswer['reason'] ?? '') : 'capacity';
                $answerAvailable = $fits && !empty($searchAnswer['available']);
                if (!$answerAvailable && $answerReason !== '') {
                    $index++;
                    $rooms[] = [
                        'id' => $index, 'room_type_id' => $index, 'physical_room_id' => 0,
                        'must_room_type_uuid' => $roomTypeId, 'must_room_uuid' => '',
                        'name' => (string) ($roomType['name'] ?? ''), 'description' => (string) ($roomType['description'] ?? ''),
                        'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
                        'view_type' => '', 'floor' => null, 'available_count' => 0,
                        'currency' => (string) ($roomType['ratePlans'][0]['currency'] ?? 'USD'),
                        ...get_room_type_media_view_data($roomType),
                        'room_rules' => '', 'amenities' => get_room_type_amenities_view_data($roomType),
                        'rate_plans' => [], 'is_selected' => false, 'selected_rate_plan_id' => 0,
                        'is_unavailable' => true,
                        'unavailable_reason' => get_must_unavailable_reason_label($answerReason, $roomType),
                        'display_price' => ['key' => (string) $index, 'available' => false],
                    ];
                    continue;
                }
                if ($answerAvailable) {
                    $index++;
                    $freeRooms = isset($searchAnswer['freeRooms']) && $searchAnswer['freeRooms'] !== null ? (int) $searchAnswer['freeRooms'] : 0;
                    $rooms[] = [
                        'id' => $index, 'room_type_id' => $index, 'physical_room_id' => 0,
                        'must_room_type_uuid' => $roomTypeId, 'must_room_uuid' => '',
                        'name' => (string) ($roomType['name'] ?? ''), 'description' => (string) ($roomType['description'] ?? ''),
                        'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
                        'view_type' => '', 'floor' => null,
                        // Only a short supply is worth saying; a long list of free rooms is noise.
                        'available_count' => ($freeRooms >= 1 && $freeRooms <= 3) ? $freeRooms : 0,
                        'scarce' => $freeRooms >= 1 && $freeRooms <= 3,
                        'currency' => (string) ($roomType['ratePlans'][0]['currency'] ?? 'USD'),
                        ...get_room_type_media_view_data($roomType),
                        'room_rules' => '', 'amenities' => get_room_type_amenities_view_data($roomType),
                        'rate_plans' => get_room_type_rate_plans_view_data($roomType, $index),
                        'is_selected' => $selectionMatchesContext && ($selection['roomTypeId'] ?? '') === $roomTypeId,
                        'selected_rate_plan_id' => 0,
                        'display_price' => \array_merge($searchAnswer, ['key' => (string) $index]),
                    ];
                    continue;
                }
                // Clock could not be asked about this room type: show it as before and let the final check decide.
            }
            if ((int) ($roomType['maxOccupancy'] ?? 0) < $guests) continue;
            $hasRoomWithSufficientCapacity = true;

            if ($bookingMode === 'INDIVIDUAL_ROOM_ONLY') {
                $roomCurrency = (string) ($roomType['ratePlans'][0]['currency'] ?? 'USD');
                $amenities = get_room_type_amenities_view_data($roomType);
                $media = get_room_type_media_view_data($roomType);
                foreach ((array) ($roomType['rooms'] ?? []) as $physicalRoom) {
                    if (empty($physicalRoom['isAvailable'])) continue;
                    $physicalRoomId = (string) ($physicalRoom['id'] ?? '');
                    if ($physicalRoomId === '') continue;
                    $index++;
                    $ratePlans = get_room_type_rate_plans_view_data($roomType, $index);
                    $rooms[] = [
                        'id' => $index, 'room_type_id' => $index, 'physical_room_id' => 0,
                        'must_room_type_uuid' => $roomTypeId, 'must_room_uuid' => $physicalRoomId,
                        'name' => (string) ($physicalRoom['name'] ?? $roomType['name'] ?? ''),
                        'description' => (string) ($roomType['description'] ?? ''),
                        'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
                        'view_type' => (string) ($physicalRoom['viewType'] ?? ''),
                        'floor' => \array_key_exists('floor', $physicalRoom) && $physicalRoom['floor'] !== null ? (int) $physicalRoom['floor'] : null,
                        'available_count' => 1,
                        'currency' => $roomCurrency,
                        ...$media,
                        'room_rules' => '',
                        'amenities' => $amenities, 'rate_plans' => $ratePlans,
                        'is_selected' => $selectionMatchesContext && ($selection['roomId'] ?? '') === $physicalRoomId,
                        'selected_rate_plan_id' => 0,
                    ];
                }
                continue;
            }

            $availability = MustApiClient::get('/public/availability', ['roomTypeId' => $roomTypeId, 'startsOn' => $checkin, 'endsOn' => $checkout]);
            $available = $availability['ok'] && !empty($availability['body']['isAvailable']);
            if (!$available) continue;
            $index++;
            $ratePlans = get_room_type_rate_plans_view_data($roomType, $index);
            $roomCurrency = (string) ($roomType['ratePlans'][0]['currency'] ?? 'USD');
            $amenities = get_room_type_amenities_view_data($roomType);
            $media = get_room_type_media_view_data($roomType);
            $rooms[] = [
                'id' => $index, 'room_type_id' => $index, 'physical_room_id' => 0,
                'must_room_type_uuid' => $roomTypeId, 'must_room_uuid' => '',
                'name' => (string) ($roomType['name'] ?? ''), 'description' => (string) ($roomType['description'] ?? ''),
                'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
                'view_type' => '', 'floor' => null,
                'available_count' => (int) ($availability['body']['availableUnits'] ?? 0),
                'currency' => $roomCurrency,
                ...$media,
                'room_rules' => '',
                'amenities' => $amenities, 'rate_plans' => $ratePlans,
                'is_selected' => $selectionMatchesContext && ($selection['roomTypeId'] ?? '') === $roomTypeId,
                'selected_rate_plan_id' => 0,
            ];
        }
    }

    // Bookable room types first, the ones that cannot be booked after them.
    \usort($rooms, static fn (array $a, array $b): int => (int) !empty($a['is_unavailable']) <=> (int) !empty($b['is_unavailable']));

    $displayPriceItems = [];
    foreach ($rooms as $room) {
        if (isset($room['display_price'])) continue; // already answered by the one search request
        $ratePlans = isset($room['rate_plans']) && \is_array($room['rate_plans']) ? $room['rate_plans'] : [];
        $firstRatePlan = \is_array($ratePlans[0] ?? null) ? $ratePlans[0] : [];
        $displayPriceItems[] = [
            'key' => (string) ($room['id'] ?? ''),
            'room_type_id' => (string) ($room['must_room_type_uuid'] ?? ''),
            'room_id' => (string) ($room['must_room_uuid'] ?? ''),
            'rate_plan_id' => (string) ($firstRatePlan['must_rate_plan_uuid'] ?? ''),
            'currency' => (string) ($room['currency'] ?? ''),
        ];
    }
    $displayPrices = get_must_display_prices($displayPriceItems, $checkin, $checkout, $adults, $children, $guests, 1);
    foreach ($rooms as &$room) {
        if (isset($room['display_price'])) continue;
        $roomKey = (string) ($room['id'] ?? '');
        $room['display_price'] = $displayPrices[$roomKey] ?? ['key' => $roomKey, 'available' => false];
    }
    unset($room);
    $allUnavailable = $rooms !== [] && \count(\array_filter($rooms, static fn (array $r): bool => empty($r['is_unavailable']))) === 0;

    // Nothing can be booked: offer the closest dates that work (only where one request answers every room type).
    $alternativeDates = [];
    if ($allUnavailable && !empty($searchItems)) {
        $alternativeDates = get_must_alternative_dates($searchItems, $checkin, $checkout, $adults, $children, $guests);
    }

    $noRoomsMessage = $hasContext
        ? __('No rooms are available for the selected dates.', 'must-hotel-booking')
        : __('Choose your dates to see available rooms.', 'must-hotel-booking');
    if ($partyCapacityMessage !== '') {
        $noRoomsMessage = $partyCapacityMessage;
    } elseif ($hasContext && !$hasRoomWithSufficientCapacity) {
        $noRoomsMessage = \sprintf(
            /* translators: %d is requested guest count. */
            __('No available room type can accommodate %d guests. Please adjust your party or choose another stay.', 'must-hotel-booking'),
            $guests
        );
    }

    return [
        'messages' => $messages, 'rooms' => $rooms, 'has_context' => $hasContext, 'is_valid' => true,
        'checkin' => $checkin, 'checkout' => $checkout, 'guests' => $guests,
        'adults' => $adults, 'children' => $children,
        'room_count' => $roomCount, 'resolved_room_count' => 1,
        'accommodation_type' => $accommodationType, 'selected_rooms' => [], 'selected_room_count' => $selectedRoomCount,
        'can_continue' => $selectedRoomCount > 0 && $partyCapacityMessage === '', 'selection_limit_reached' => $selectedRoomCount > 0, 'single_room_mode' => true,
        'no_rooms_message' => $noRoomsMessage, 'all_unavailable' => $allUnavailable,
        'alternative_dates' => $alternativeDates,
        'selection_status_message' => '', 'selection_status_tone' => 'neutral',
        'booking_url' => get_booking_page_url(), 'checkout_url' => get_checkout_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(),
    ];
}

function enqueue_booking_accommodation_page_assets(): void
{
    if (!is_frontend_booking_accommodation_page()) return;
    enqueue_shared_booking_assets();
    \wp_enqueue_style('must-hotel-booking-flatpickr', 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css', [], MUST_HOTEL_BOOKING_VERSION);
    \wp_enqueue_script('must-hotel-booking-flatpickr', 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js', [], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_enqueue_script('must-hotel-booking-accommodation', MUST_HOTEL_BOOKING_URL . 'assets/js/booking-accommodation.js', ['must-hotel-booking-flatpickr'], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_localize_script('must-hotel-booking-accommodation', 'mustBookingAccommodationConfig', [
        'ajaxUrl' => \admin_url('admin-ajax.php'),
        'ajaxAction' => 'must_booking_accommodation_selection',
        'today' => \wp_date('Y-m-d'),
        'bookingWindowDays' => 365,
        'queryDateFormat' => 'Y-m-d',
        'displayDateFormat' => 'd/m/Y',
        'labels' => [
            'requestFailed' => \__('Unable to update your room selection right now. Please try again.', 'must-hotel-booking'),
            'removeSelection' => \__('Remove Selection', 'must-hotel-booking'),
            'chooseRate' => \__('Choose This Rate', 'must-hotel-booking'),
            'bookNow' => \__('Book Now', 'must-hotel-booking'),
            'selectionFull' => \__('Selection Full', 'must-hotel-booking'),
            'addRoom' => \__('Add Room', 'must-hotel-booking'),
            'propertyCapacity' => \__('This property accepts up to %d guests in one booking.', 'must-hotel-booking'),
            'singleRoomOnly' => \__('This booking flow can confirm one room at a time. Please choose 1 room.', 'must-hotel-booking'),
            'totalGuests' => \__('Total guests: %d', 'must-hotel-booking'),
        ],
        'icons' => [
            'lightboxPrev' => \must_hotel_booking_asset_url('assets/img/lightboxleft.svg'),
            'lightboxNext' => \must_hotel_booking_asset_url('assets/img/lightboxright.svg'),
        ],
    ]);
}
\add_action('wp_ajax_must_booking_accommodation_selection', __NAMESPACE__ . '\\update_accommodation_selection');
\add_action('wp_ajax_nopriv_must_booking_accommodation_selection', __NAMESPACE__ . '\\update_accommodation_selection');
\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_booking_accommodation_page_assets');
