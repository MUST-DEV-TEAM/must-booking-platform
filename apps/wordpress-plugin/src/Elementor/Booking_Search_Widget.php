<?php

namespace MustHotelBooking\Elementor;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustBookingConfig;

class Booking_Search_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string { return 'must_hotel_booking_booking_search'; }
    public function get_title(): string { return \esc_html__('Booking Search', 'must-hotel-booking'); }
    public function get_icon(): string { return 'eicon-search'; }
    public function get_categories(): array { return ['must-hotel-booking', 'general']; }
    public function get_keywords(): array { return ['booking', 'hotel', 'reservation', 'search']; }
    public function get_style_depends(): array { return ['must-hotel-booking-flatpickr', 'must-hotel-booking-booking-search-widget']; }
    public function get_script_depends(): array { return ['must-hotel-booking-flatpickr', 'must-hotel-booking-booking-search-widget']; }

    protected function register_controls(): void
    {
        $this->start_controls_section('section_content', ['label' => \__('Content', 'must-hotel-booking')]);
        $this->add_control('linked_rooms_list_widget_id', [
            'label' => \__('Linked Rooms List', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT,
            'default' => '', 'options' => get_rooms_list_widget_options_for_booking_search(),
            'description' => \__('Choose a Rooms List widget from this page. The search will submit that widget category automatically. Select Not Connected to keep this search independent.', 'must-hotel-booking'),
        ]);
        $this->add_control('direct_to_accommodation', [
            'label' => \__('Direct to Accommodation Page', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SWITCHER,
            'label_on' => \__('Yes', 'must-hotel-booking'), 'label_off' => \__('No', 'must-hotel-booking'), 'return_value' => 'yes', 'default' => '',
            'description' => \__('When enabled, the search form will send the user directly to the Select Accommodation page instead of the Booking page.', 'must-hotel-booking'),
        ]);
        $this->end_controls_section();
    }

    protected function render(): void
    {
        $settings = $this->get_settings_for_display();
        $widgetId = \wp_unique_id('must-hotel-booking-search-');
        $linkedId = \sanitize_key((string) ($settings['linked_rooms_list_widget_id'] ?? ''));
        $legacyKey = \sanitize_key((string) ($settings['rooms_list_connection_key'] ?? ''));
        $bookingUrl = ($settings['direct_to_accommodation'] ?? '') === 'yes' ? ManagedPages::getBookingAccommodationPageUrl() : get_booking_page_url_for_widget();
        $icons = [
            'calendar' => \must_hotel_booking_asset_url('assets/img/Calendar2Date.svg'),
            'people' => \must_hotel_booking_asset_url('assets/img/PeopleFill.svg'),
            'arrow' => \must_hotel_booking_asset_url('assets/img/ArrowRight.svg'),
        ];
        ?>
        <div class="must-hotel-booking-widget must-hotel-booking-widget-booking-search" data-linked-room-list-id="<?php echo \esc_attr($linkedId); ?>" data-connection-key="<?php echo \esc_attr($legacyKey); ?>">
            <form class="must-hotel-booking-booking-search" method="get" action="<?php echo \esc_url($bookingUrl); ?>" data-must-hotel-booking-mode="plugin_checkout">
                <div class="must-hotel-booking-booking-search-fields">
                    <?php foreach ([['checkin', 'Check In Date', 'calendar'], ['checkout', 'Check Out Date', 'calendar'], ['guests', 'Guests Number', 'people']] as $field) : $id = $widgetId . '-' . $field[0]; ?>
                        <div class="must-hotel-booking-field must-hotel-booking-field-<?php echo \esc_attr($field[0]); ?><?php echo $field[0] === 'guests' ? ' must-hotel-booking-field-guests' : ' must-hotel-booking-field-date'; ?>">
                            <label class="screen-reader-text" for="<?php echo \esc_attr($id); ?>"><?php echo \esc_html__($field[1], 'must-hotel-booking'); ?></label>
                            <input id="<?php echo \esc_attr($id); ?>" type="<?php echo $field[0] === 'guests' ? 'number' : 'text'; ?>" name="<?php echo \esc_attr($field[0]); ?>" class="must-hotel-booking-<?php echo $field[0] === 'guests' ? 'guests' : 'date-input must-hotel-booking-' . $field[0]; ?>" placeholder="<?php echo \esc_attr__($field[1], 'must-hotel-booking'); ?>" autocomplete="off" <?php echo $field[0] === 'guests' ? 'min="1" max="' . \esc_attr((string) MustBookingConfig::get_max_booking_guests()) . '" step="1" inputmode="numeric" pattern="[0-9]*"' : 'required'; ?> />
                            <img class="must-hotel-booking-field-icon" src="<?php echo \esc_url($icons[$field[2]]); ?>" alt="" aria-hidden="true" />
                        </div>
                    <?php endforeach; ?>
                </div>
                <div class="must-hotel-booking-submit"><button type="submit"><span class="must-hotel-booking-submit-text"><?php echo \esc_html__('Check Availability', 'must-hotel-booking'); ?></span><img class="must-hotel-booking-submit-icon" src="<?php echo \esc_url($icons['arrow']); ?>" alt="" aria-hidden="true" /></button></div>
            </form>
        </div>
        <?php
    }
}
