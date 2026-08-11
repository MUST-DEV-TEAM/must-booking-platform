<?php

namespace MustHotelBooking\Elementor;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustBookingConfig;

function register_elementor_rooms_text_grid_widget_styles(): void
{
    \wp_register_style('must-hotel-booking-rooms-text-grid-widget', MUST_HOTEL_BOOKING_URL . 'assets/css/rooms-text-grid-widget.css', [], MUST_HOTEL_BOOKING_VERSION);
}

/** @return array<string, string> */
function get_rooms_text_grid_room_options(): array
{
    $options = ['' => \__('Select a room', 'must-hotel-booking')];
    foreach (get_must_widget_room_types() as $roomType) {
        $id = isset($roomType['id']) ? \sanitize_key((string) $roomType['id']) : '';
        $name = \trim((string) ($roomType['name'] ?? ''));
        if ($id !== '' && $name !== '') $options[$id] = $name;
        foreach ((array) ($roomType['rooms'] ?? []) as $physicalRoom) {
            $roomId = isset($physicalRoom['id']) ? \sanitize_key((string) $physicalRoom['id']) : '';
            $roomName = \trim((string) ($physicalRoom['name'] ?? ''));
            if ($roomId !== '' && $roomName !== '') {
                $options[$roomId] = \sprintf(
                    /* translators: 1: individual room name, 2: room type name. */
                    \__('%1$s (%2$s)', 'must-hotel-booking'),
                    $roomName,
                    $name
                );
            }
        }
    }
    return $options;
}

/** @param array<int, mixed> $selectedRooms @return array<int, array<string, mixed>> */
function normalize_rooms_text_grid_selected_rooms(array $selectedRooms): array
{
    $normalized = [];
    foreach ($selectedRooms as $selectedRoom) {
        if (!\is_array($selectedRoom)) continue;
        $id = \sanitize_key((string) ($selectedRoom['room_id'] ?? ''));
        if ($id === '' || isset($normalized[$id])) continue;
        $customLink = \is_array($selectedRoom['custom_link'] ?? null) ? $selectedRoom['custom_link'] : [];
        $normalized[$id] = ['room_id' => $id, 'custom_link' => [
            'url' => \esc_url_raw((string) ($customLink['url'] ?? '')),
            'is_external' => !empty($customLink['is_external']),
            'nofollow' => !empty($customLink['nofollow']),
        ]];
    }
    return \array_values($normalized);
}

/** @param array<int, mixed> $selectedRooms @return array<int, array<string, mixed>> */
function get_rooms_for_text_grid_widget_render(string $sourceMode, array $selectedRooms, int $limit, string $displayMode = 'room_types'): array
{
    $roomTypes = [];
    $individualRooms = [];
    foreach (get_must_widget_room_types() as $roomType) {
        $roomTypeId = isset($roomType['id']) ? \sanitize_key((string) $roomType['id']) : '';
        if ($roomTypeId === '') continue;
        $presentation = get_rooms_widget_presentation_data($roomType);
        $roomTypes[$roomTypeId] = [
            'id' => $roomTypeId, 'room_type_id' => $roomTypeId,
            'name' => (string) ($roomType['name'] ?? ''), 'custom_link' => [],
            ...$presentation,
        ];
        foreach ((array) ($roomType['rooms'] ?? []) as $physicalRoom) {
            $roomId = isset($physicalRoom['id']) ? \sanitize_key((string) $physicalRoom['id']) : '';
            if ($roomId === '') continue;
            $individualRooms[$roomId] = [
                'id' => $roomId,
                'room_type_id' => $roomTypeId,
                'name' => (string) ($physicalRoom['name'] ?? $roomType['name'] ?? ''),
                'custom_link' => [],
                ...$presentation,
            ];
        }
    }
    // ROOM_TYPE_ONLY catalogues have no physical-room rows. Keep their current
    // room-type rendering if an editor selects Individual Rooms on such a site.
    $catalog = $displayMode === 'individual_rooms' && !empty($individualRooms) ? $individualRooms : $roomTypes;
    $rooms = [];
    if ($sourceMode === 'selected_rooms') {
        foreach (normalize_rooms_text_grid_selected_rooms($selectedRooms) as $selected) {
            $id = (string) $selected['room_id'];
            if (!isset($catalog[$id])) continue;
            $room = $catalog[$id];
            $room['custom_link'] = $selected['custom_link'];
            $rooms[] = $room;
            if ($limit > 0 && \count($rooms) >= $limit) break;
        }
        return $rooms;
    }
    foreach ($catalog as $room) {
        $rooms[] = $room;
        if ($limit > 0 && \count($rooms) >= $limit) break;
    }
    return $rooms;
}

/** @param array<string, mixed> $room */
function get_rooms_text_grid_room_url(array $room): string
{
    $roomTypeId = \sanitize_key((string) ($room['room_type_id'] ?? $room['id'] ?? ''));
    $roomId = \sanitize_key((string) ($room['id'] ?? ''));
    if ($roomTypeId === '') return '';
    $args = ['accommodation_type' => $roomTypeId];
    if ($roomId !== '' && $roomId !== $roomTypeId) {
        $args['room_id'] = $roomId;
    }
    return \add_query_arg($args, ManagedPages::getBookingPageUrl());
}

/** @param array<string, mixed> $room */
function get_rooms_text_grid_details_url(array $room): string
{
    return \function_exists(__NAMESPACE__ . '\\get_rooms_widget_single_room_page_url')
        ? get_rooms_widget_single_room_page_url($room)
        : '';
}

/** @param array<string, mixed> $room */
function get_rooms_text_grid_item_link_url(array $room, string $linkBehavior): string
{
    if ($linkBehavior === 'no_link') return '';
    $custom = \is_array($room['custom_link'] ?? null) ? $room['custom_link'] : [];
    if ($linkBehavior === 'custom_override_or_single_room_page' && !empty($custom['url'])) return \esc_url_raw((string) $custom['url']);
    return get_rooms_text_grid_room_url($room);
}

function get_rooms_text_grid_wrapper_inline_styles(): string
{
    $styles = ['--must-hotel-booking-rooms-text-grid-radius:' . \max(0, \min(40, (int) MustBookingConfig::get_setting('border_radius', 18))) . 'px'];
    if (!MustBookingConfig::get_setting('inherit_elementor_colors', false)) {
        $styles[] = '--must-hotel-booking-rooms-text-grid-text-color:' . (\sanitize_hex_color((string) MustBookingConfig::get_setting('text_color', '#16212b')) ?: '#16212b');
        $styles[] = '--must-hotel-booking-rooms-text-grid-hover-color:' . (\sanitize_hex_color((string) MustBookingConfig::get_setting('primary_color', '#0f766e')) ?: '#0f766e');
        $styles[] = '--must-hotel-booking-rooms-text-grid-current-color:' . (\sanitize_hex_color((string) MustBookingConfig::get_setting('primary_color', '#0f766e')) ?: '#0f766e');
    }
    if (!MustBookingConfig::get_setting('inherit_elementor_typography', false)) $styles[] = '--must-hotel-booking-rooms-text-grid-font-family:' . \sanitize_text_field((string) MustBookingConfig::get_setting('font_family', 'Instrument Sans'));
    return \implode(';', $styles);
}

/** @param mixed $widgetsManager */
function register_elementor_rooms_text_grid_widget($widgetsManager): void
{
    static $registered = false;
    if ($registered || !\class_exists('\\Elementor\\Widget_Base') || !\is_object($widgetsManager)) return;
    $widget = new Rooms_Text_Grid_Widget();
    if (\method_exists($widgetsManager, 'register')) { $widgetsManager->register($widget); $registered = true; }
    elseif (\method_exists($widgetsManager, 'register_widget_type')) { $widgetsManager->register_widget_type($widget); $registered = true; }
}

function register_elementor_rooms_text_grid_widget_legacy(): void
{
    $plugin = \class_exists('\\Elementor\\Plugin') ? \Elementor\Plugin::$instance : null;
    if (\is_object($plugin) && isset($plugin->widgets_manager)) register_elementor_rooms_text_grid_widget($plugin->widgets_manager);
}

\add_action('elementor/frontend/after_register_styles', __NAMESPACE__ . '\\register_elementor_rooms_text_grid_widget_styles');
\add_action('elementor/widgets/register', __NAMESPACE__ . '\\register_elementor_rooms_text_grid_widget');
\add_action('elementor/widgets/widgets_registered', __NAMESPACE__ . '\\register_elementor_rooms_text_grid_widget_legacy');
