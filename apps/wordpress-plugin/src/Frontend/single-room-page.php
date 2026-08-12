<?php

namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;

function is_frontend_single_room_page(): bool
{
    return ManagedPages::isCurrentPage('page_single_room_id', 'room-details');
}

function get_single_room_page_url(string $roomTypeId = '', string $roomId = ''): string
{
    $args = [];
    if ($roomTypeId !== '') {
        $args['accommodation_type'] = $roomTypeId;
    }
    if ($roomId !== '') {
        $args['room_id'] = $roomId;
    }

    $url = ManagedPages::getSingleRoomPageUrl();

    return $args === [] ? $url : \add_query_arg($args, $url);
}

function get_single_room_booking_url(string $roomTypeId, string $roomId = ''): string
{
    $args = ['accommodation_type' => $roomTypeId];
    if ($roomId !== '') {
        $args['room_id'] = $roomId;
    }

    return \add_query_arg($args, get_booking_page_url());
}

/**
 * Build the page model from the same public catalogue used by the booking
 * pages. A physical room is deliberately resolved through Task 28's shared
 * resolver rather than trusting the room_id query parameter by itself.
 *
 * @param array<string, mixed> $catalog
 * @return array<string, mixed>
 */
function get_single_room_page_view_model_from_catalog(array $catalog, string $roomTypeId, string $roomId): array
{
    $roomTypes = \is_array($catalog['roomTypes'] ?? null) ? $catalog['roomTypes'] : [];
    $bookingMode = \in_array((string) ($catalog['bookingMode'] ?? ''), ['INDIVIDUAL_ROOM_ONLY', 'MIXED'], true)
        ? (string) $catalog['bookingMode']
        : 'ROOM_TYPE_ONLY';
    $roomType = null;

    foreach ($roomTypes as $candidate) {
        if (\is_array($candidate) && (string) ($candidate['id'] ?? '') === $roomTypeId) {
            $roomType = $candidate;
            break;
        }
    }

    if (!\is_array($roomType)) {
        return [
            'is_valid' => false,
            'message' => \__('This accommodation could not be found.', 'must-hotel-booking'),
            'room' => [],
            'related_rooms' => [],
        ];
    }

    // Reuse the Task 28 validation path: an arbitrary room_id is never shown
    // or forwarded unless it is a physical room of this exact room type on a
    // property that supports individual-room booking.
    $fixedRoom = resolve_fixed_physical_room($roomTypes, $bookingMode, $roomTypeId, $roomId);
    $physicalRoomId = $fixedRoom !== null ? (string) ($fixedRoom['physical_room_id'] ?? '') : '';
    $media = get_room_type_media_view_data($roomType);
    $amenities = $fixedRoom !== null
        ? get_room_type_amenities_view_data($fixedRoom)
        : get_room_type_amenities_view_data($roomType);
    $ratePlans = [];
    foreach ((array) ($roomType['ratePlans'] ?? []) as $ratePlan) {
        if (!\is_array($ratePlan)) {
            continue;
        }
        $name = \trim((string) ($ratePlan['name'] ?? ''));
        if ($name !== '') {
            $ratePlans[] = $name;
        }
    }

    $room = [
        'room_type_id' => $roomTypeId,
        'room_id' => $physicalRoomId,
        'name' => $fixedRoom !== null && (string) ($fixedRoom['title'] ?? '') !== ''
            ? (string) $fixedRoom['title']
            : ($fixedRoom !== null && (string) ($fixedRoom['name'] ?? '') !== ''
                ? (string) $fixedRoom['name']
                : (string) ($roomType['name'] ?? '')),
        'category_label' => (string) ($roomType['name'] ?? ''),
        'description' => (string) ($roomType['description'] ?? ''),
        'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
        'room_size' => $fixedRoom !== null ? (string) ($fixedRoom['room_size'] ?? '') : '',
        'rules' => $fixedRoom !== null ? (string) ($fixedRoom['rules'] ?? '') : '',
        'view_type' => $fixedRoom !== null ? (string) ($fixedRoom['view_type'] ?? '') : '',
        'floor' => $fixedRoom !== null ? (int) ($fixedRoom['floor'] ?? 0) : 0,
        'rate_plans' => $ratePlans,
        'amenities' => $amenities,
        ...$media,
    ];

    $relatedRooms = [];
    foreach ($roomTypes as $candidate) {
        if (!\is_array($candidate) || (string) ($candidate['id'] ?? '') === $roomTypeId) {
            continue;
        }
        $candidateId = (string) ($candidate['id'] ?? '');
        if ($candidateId === '') {
            continue;
        }
        $candidateMedia = get_room_type_media_view_data($candidate);
        $relatedRooms[] = [
            'room_type_id' => $candidateId,
            'name' => (string) ($candidate['name'] ?? ''),
            ...$candidateMedia,
        ];
        if (\count($relatedRooms) === 3) {
            break;
        }
    }

    return [
        'is_valid' => true,
        'message' => '',
        'room' => $room,
        'related_rooms' => $relatedRooms,
    ];
}

/** @return array<string, mixed> */
function get_single_room_page_view_data(): array
{
    $raw = \is_array($_GET) ? $_GET : [];
    $roomTypeId = isset($raw['accommodation_type'])
        ? \sanitize_key((string) \wp_unslash($raw['accommodation_type']))
        : '';
    $roomId = isset($raw['room_id'])
        ? \sanitize_text_field((string) \wp_unslash($raw['room_id']))
        : '';
    $view = get_single_room_page_view_model_from_catalog(get_must_catalog(), $roomTypeId, $roomId);

    if (empty($view['is_valid'])) {
        return $view + [
            'booking_url' => get_booking_page_url(),
            'room_url' => get_single_room_page_url(),
        ];
    }

    $room = \is_array($view['room'] ?? null) ? $view['room'] : [];
    $roomTypeId = (string) ($room['room_type_id'] ?? '');
    $roomId = (string) ($room['room_id'] ?? '');
    $view['booking_url'] = get_single_room_booking_url($roomTypeId, $roomId);
    $view['room_url'] = get_single_room_page_url($roomTypeId, $roomId);

    foreach ((array) ($view['related_rooms'] ?? []) as $index => $relatedRoom) {
        if (!\is_array($relatedRoom)) {
            continue;
        }
        $relatedTypeId = (string) ($relatedRoom['room_type_id'] ?? '');
        $view['related_rooms'][$index]['booking_url'] = get_single_room_booking_url($relatedTypeId);
        $view['related_rooms'][$index]['details_url'] = get_single_room_page_url($relatedTypeId);
    }

    return $view;
}

function enqueue_single_room_page_assets(): void
{
    if (!is_frontend_single_room_page()) {
        return;
    }

    \wp_enqueue_style('must-hotel-booking-single-room-page', MUST_HOTEL_BOOKING_URL . 'assets/css/single-room-page.css', [], MUST_HOTEL_BOOKING_VERSION);
    \wp_enqueue_script('must-hotel-booking-single-room-page', MUST_HOTEL_BOOKING_URL . 'assets/js/single-room-page.js', [], MUST_HOTEL_BOOKING_VERSION, true);
}

\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_single_room_page_assets');
