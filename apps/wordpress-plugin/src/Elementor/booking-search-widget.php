<?php

namespace MustHotelBooking\Elementor;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustBookingConfig;

function register_elementor_booking_search_widget_styles(): void
{
    \wp_register_style('must-hotel-booking-flatpickr', 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css', [], '4.6.13');
    \wp_register_style('must-hotel-booking-booking-search-widget', MUST_HOTEL_BOOKING_URL . 'assets/css/booking-search-widget.css', [], MUST_HOTEL_BOOKING_VERSION);
}

function register_elementor_booking_search_widget_scripts(): void
{
    $today = \current_time('Y-m-d');
    $maxDate = (new \DateTimeImmutable($today))->modify('+' . MustBookingConfig::get_booking_window() . ' day')->format('Y-m-d');
    \wp_register_script('must-hotel-booking-flatpickr', 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js', [], '4.6.13', true);
    \wp_register_script('must-hotel-booking-booking-search-widget', MUST_HOTEL_BOOKING_URL . 'assets/js/booking-search-widget.js', ['must-hotel-booking-flatpickr'], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_localize_script('must-hotel-booking-booking-search-widget', 'mustHotelBookingWidgetConfig', [
        'today' => $today,
        'maxDate' => $maxDate,
        'bookingWindowDays' => MustBookingConfig::get_booking_window(),
        'maxGuests' => MustBookingConfig::get_max_booking_guests(),
        'displayDateFormat' => 'd/m/Y',
        'queryDateFormat' => 'Y-m-d',
    ]);
}

function get_booking_page_url_for_widget(): string
{
    return ManagedPages::getBookingPageUrl();
}

/** @return array<int, array<string, mixed>> */
function get_must_widget_room_types(): array
{
    return \function_exists('\\MustHotelBooking\\Frontend\\get_must_room_types')
        ? \MustHotelBooking\Frontend\get_must_room_types()
        : [];
}

/** @return array<string, string> */
function get_must_widget_category_options(): array
{
    $options = ['all' => \__('All room types', 'must-hotel-booking')];
    foreach (get_must_widget_room_types() as $roomType) {
        $id = isset($roomType['id']) ? \sanitize_key((string) $roomType['id']) : '';
        $name = isset($roomType['name']) ? \trim((string) $roomType['name']) : '';
        if ($id !== '' && $name !== '') $options[$id] = $name;
    }
    return $options;
}

function get_elementor_document_post_id_for_booking_search_widget(): int
{
    foreach (['post', 'post_id', 'editor_post_id', 'initial_document_id', 'preview_id'] as $key) {
        if (isset($_REQUEST[$key]) && \is_scalar($_REQUEST[$key])) {
            $id = \absint(\wp_unslash($_REQUEST[$key]));
            if ($id > 0) return $id;
        }
    }
    return \get_queried_object_id() ?: (int) \get_the_ID();
}

/** @return array<int, array<string, mixed>> */
function get_elementor_elements_data_for_booking_search_widget(): array
{
    $postId = get_elementor_document_post_id_for_booking_search_widget();
    $data = $postId > 0 ? \get_post_meta($postId, '_elementor_data', true) : [];
    if (\is_string($data) && $data !== '') $data = \json_decode($data, true);
    return \is_array($data) ? $data : [];
}

/** @param array<int, array<string, mixed>> $elements @return array<int, array<string, mixed>> */
function collect_rooms_list_widgets_for_booking_search(array $elements): array
{
    $widgets = [];
    foreach ($elements as $element) {
        if (!\is_array($element)) continue;
        if (($element['widgetType'] ?? '') === 'must_hotel_booking_rooms_list') $widgets[] = $element;
        if (\is_array($element['elements'] ?? null)) $widgets = \array_merge($widgets, collect_rooms_list_widgets_for_booking_search($element['elements']));
    }
    return $widgets;
}

/** @return array<string, string> */
function get_rooms_list_widget_options_for_booking_search(): array
{
    $options = ['' => \__('Not Connected', 'must-hotel-booking')];
    $categories = get_must_widget_category_options();
    $index = 1;
    foreach (collect_rooms_list_widgets_for_booking_search(get_elementor_elements_data_for_booking_search_widget()) as $widget) {
        $id = isset($widget['id']) ? \sanitize_key((string) $widget['id']) : '';
        if ($id === '') continue;
        $category = \sanitize_key((string) ($widget['settings']['room_category'] ?? 'all'));
        $options[$id] = \sprintf(\__('Rooms List %1$d (%2$s)', 'must-hotel-booking'), $index++, $categories[$category] ?? $categories['all']);
    }
    return $options;
}

/** @param mixed $widgetsManager */
function register_elementor_booking_search_widget($widgetsManager): void
{
    static $registered = false;
    if ($registered || !\class_exists('\\Elementor\\Widget_Base') || !\is_object($widgetsManager)) return;
    $widget = new Booking_Search_Widget();
    if (\method_exists($widgetsManager, 'register')) { $widgetsManager->register($widget); $registered = true; }
    elseif (\method_exists($widgetsManager, 'register_widget_type')) { $widgetsManager->register_widget_type($widget); $registered = true; }
}

function register_elementor_booking_search_widget_legacy(): void
{
    $plugin = \class_exists('\\Elementor\\Plugin') ? \Elementor\Plugin::$instance : null;
    if (\is_object($plugin) && isset($plugin->widgets_manager)) register_elementor_booking_search_widget($plugin->widgets_manager);
}

/** @param mixed $elementsManager */
function register_elementor_booking_widget_category($elementsManager): void
{
    if (\is_object($elementsManager) && \method_exists($elementsManager, 'add_category')) {
        $elementsManager->add_category('must-hotel-booking', ['title' => \esc_html__('MUST Hotel Booking', 'must-hotel-booking'), 'icon' => 'fa fa-calendar']);
    }
}

\add_action('elementor/frontend/after_register_styles', __NAMESPACE__ . '\\register_elementor_booking_search_widget_styles');
\add_action('elementor/frontend/after_register_scripts', __NAMESPACE__ . '\\register_elementor_booking_search_widget_scripts');
\add_action('elementor/elements/categories_registered', __NAMESPACE__ . '\\register_elementor_booking_widget_category');
\add_action('elementor/widgets/register', __NAMESPACE__ . '\\register_elementor_booking_search_widget');
\add_action('elementor/widgets/widgets_registered', __NAMESPACE__ . '\\register_elementor_booking_search_widget_legacy');
