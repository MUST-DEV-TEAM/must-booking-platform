<?php

namespace MustHotelBooking\Elementor;

use MustHotelBooking\Core\ManagedPages;

function register_elementor_rooms_list_widget_styles(): void
{
    \wp_register_style('must-hotel-booking-rooms-list-widget', MUST_HOTEL_BOOKING_URL . 'assets/css/rooms-list-widget.css', [], MUST_HOTEL_BOOKING_VERSION);
}

function register_elementor_rooms_list_widget_scripts(): void
{
    \wp_register_script('must-hotel-booking-rooms-list-widget', MUST_HOTEL_BOOKING_URL . 'assets/js/rooms-list-widget.js', [], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_localize_script('must-hotel-booking-rooms-list-widget', 'mustBookingRoomsListWidgetConfig', ['icons' => [
        'lightboxPrev' => MUST_HOTEL_BOOKING_URL . 'assets/img/lightboxleft.svg',
        'lightboxNext' => MUST_HOTEL_BOOKING_URL . 'assets/img/lightboxright.svg',
    ]]);
}

/** @return array<int, array<string, mixed>> */
function get_rooms_for_widget_render(string $category, int $limit, string $displayMode = 'room_types'): array
{
    $roomTypes = [];
    $individualRooms = [];
    foreach (get_must_widget_room_types() as $roomType) {
        $roomTypeId = isset($roomType['id']) ? \sanitize_key((string) $roomType['id']) : '';
        if ($roomTypeId === '' || ($category !== 'all' && $category !== $roomTypeId)) continue;
        $roomTypes[] = [
            'id' => $roomTypeId,
            'room_type_id' => $roomTypeId,
            'name' => (string) ($roomType['name'] ?? ''),
            'description' => (string) ($roomType['description'] ?? ''),
            'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
        ];
        foreach ((array) ($roomType['rooms'] ?? []) as $physicalRoom) {
            $roomId = isset($physicalRoom['id']) ? \sanitize_key((string) $physicalRoom['id']) : '';
            if ($roomId === '') continue;
            $individualRooms[] = [
                'id' => $roomId,
                'room_type_id' => $roomTypeId,
                'name' => (string) ($physicalRoom['name'] ?? $roomType['name'] ?? ''),
                'description' => (string) ($roomType['description'] ?? ''),
                'max_guests' => (int) ($roomType['maxOccupancy'] ?? 0),
                'is_available' => !empty($physicalRoom['isAvailable']),
            ];
        }
    }
    $rooms = $displayMode === 'individual_rooms' && !empty($individualRooms) ? $individualRooms : $roomTypes;
    return \array_slice($rooms, 0, $limit);
}

function get_rooms_widget_booking_page_url(): string
{
    return ManagedPages::getBookingPageUrl();
}

/** @param mixed $widgetsManager */
function register_elementor_rooms_list_widget($widgetsManager): void
{
    static $registered = false;
    if ($registered || !\class_exists('\\Elementor\\Widget_Base') || !\is_object($widgetsManager)) return;
    $widget = new Rooms_List_Widget();
    if (\method_exists($widgetsManager, 'register')) { $widgetsManager->register($widget); $registered = true; }
    elseif (\method_exists($widgetsManager, 'register_widget_type')) { $widgetsManager->register_widget_type($widget); $registered = true; }
}

function register_elementor_rooms_list_widget_legacy(): void
{
    $plugin = \class_exists('\\Elementor\\Plugin') ? \Elementor\Plugin::$instance : null;
    if (\is_object($plugin) && isset($plugin->widgets_manager)) register_elementor_rooms_list_widget($plugin->widgets_manager);
}

\add_action('elementor/frontend/after_register_styles', __NAMESPACE__ . '\\register_elementor_rooms_list_widget_styles');
\add_action('elementor/frontend/after_register_scripts', __NAMESPACE__ . '\\register_elementor_rooms_list_widget_scripts');
\add_action('elementor/widgets/register', __NAMESPACE__ . '\\register_elementor_rooms_list_widget');
\add_action('elementor/widgets/widgets_registered', __NAMESPACE__ . '\\register_elementor_rooms_list_widget_legacy');
