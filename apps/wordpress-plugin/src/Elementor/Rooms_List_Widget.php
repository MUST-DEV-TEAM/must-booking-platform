<?php

namespace MustHotelBooking\Elementor;

class Rooms_List_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string { return 'must_hotel_booking_rooms_list'; }
    public function get_title(): string { return \esc_html__('Rooms List', 'must-hotel-booking'); }
    public function get_icon(): string { return 'eicon-post-list'; }
    public function get_categories(): array { return ['must-hotel-booking', 'general']; }
    public function get_keywords(): array { return ['rooms', 'hotel', 'suites', 'duplex']; }
    public function get_style_depends(): array { return ['must-hotel-booking-rooms-list-widget']; }
    public function get_script_depends(): array { return ['must-hotel-booking-rooms-list-widget']; }

    protected function register_controls(): void
    {
        $this->start_controls_section('section_content', ['label' => \__('Content', 'must-hotel-booking')]);
        $this->add_control('room_category', ['label' => \__('Room Category', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'default' => 'all', 'options' => get_must_widget_category_options()]);
        $this->add_control('display_mode', ['label' => \__('Display Mode', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'default' => 'room_types', 'options' => ['room_types' => \__('Room Types', 'must-hotel-booking'), 'individual_rooms' => \__('Individual Rooms', 'must-hotel-booking')]]);
        $this->add_control('rooms_limit', ['label' => \__('Rooms Limit', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::NUMBER, 'default' => 20, 'min' => 1, 'max' => 200]);
        $this->add_control('show_category_heading', ['label' => \__('Show Category Heading', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SWITCHER, 'label_on' => \__('Yes', 'must-hotel-booking'), 'label_off' => \__('No', 'must-hotel-booking'), 'default' => 'yes']);
        $this->add_control('empty_text', ['label' => \__('Empty State Text', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::TEXT, 'default' => \__('No rooms found for the selected category.', 'must-hotel-booking')]);
        $this->end_controls_section();
    }

    protected function render(): void
    {
        $settings = $this->get_settings_for_display();
        $category = \sanitize_key((string) ($settings['room_category'] ?? 'all'));
        $displayMode = ($settings['display_mode'] ?? '') === 'individual_rooms' ? 'individual_rooms' : 'room_types';
        $legacyKey = \sanitize_key((string) ($settings['booking_search_connection_key'] ?? ''));
        $limit = \max(1, \min(200, (int) ($settings['rooms_limit'] ?? 20)));
        $emptyText = (string) ($settings['empty_text'] ?? \__('No rooms found for the selected category.', 'must-hotel-booking'));
        $rooms = get_rooms_for_widget_render($category, $limit, $displayMode);
        $categories = get_must_widget_category_options();
        $heading = $category !== 'all' ? ($categories[$category] ?? '') : '';
        $arrow = MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowRight.svg';
        ?>
        <div class="must-hotel-booking-widget must-hotel-booking-rooms-list-widget" data-room-list-widget-id="<?php echo \esc_attr($this->get_id()); ?>" data-room-category="<?php echo \esc_attr($category); ?>" data-display-mode="<?php echo \esc_attr($displayMode); ?>" data-connection-key="<?php echo \esc_attr($legacyKey); ?>">
            <?php if (($settings['show_category_heading'] ?? '') === 'yes' && $heading !== '') : ?><p class="must-hotel-booking-rooms-list-heading">/ <?php echo \esc_html(\strtoupper($heading)); ?></p><?php endif; ?>
            <?php if (empty($rooms)) : ?><p class="must-hotel-booking-rooms-list-empty"><?php echo \esc_html($emptyText); ?></p><?php else : foreach ($rooms as $room) :
                $roomTypeId = (string) ($room['room_type_id'] ?? $room['id']);
                $bookUrl = \add_query_arg(['accommodation_type' => $roomTypeId], get_rooms_widget_booking_page_url());
                ?>
                <article class="must-hotel-booking-rooms-list-card" data-lightbox-images="[]" data-lightbox-title="<?php echo \esc_attr((string) $room['name']); ?>">
                    <div class="must-hotel-booking-rooms-list-media"><div class="must-hotel-booking-rooms-list-placeholder"><?php echo \esc_html__('Image unavailable', 'must-hotel-booking'); ?></div></div>
                    <div class="must-hotel-booking-rooms-list-content">
                        <div class="must-hotel-booking-rooms-list-section must-hotel-booking-rooms-list-section-copy"><div class="must-hotel-booking-rooms-list-header"><h3><?php echo \esc_html((string) $room['name']); ?></h3><?php if ($room['description'] !== '') : ?><p class="must-hotel-booking-rooms-list-description"><?php echo \esc_html((string) $room['description']); ?></p><?php endif; ?></div></div>
                        <div class="must-hotel-booking-rooms-list-section must-hotel-booking-rooms-list-section-media"><div class="must-hotel-booking-rooms-list-thumbs"><span class="must-hotel-booking-thumb-placeholder" aria-hidden="true"></span><span class="must-hotel-booking-thumb-placeholder" aria-hidden="true"></span><span class="must-hotel-booking-thumb-placeholder" aria-hidden="true"></span></div></div>
                        <div class="must-hotel-booking-rooms-list-section must-hotel-booking-rooms-list-section-actions"><div class="must-hotel-booking-rooms-list-actions"><a class="must-hotel-booking-rooms-list-book" href="<?php echo \esc_url($bookUrl); ?>"><span class="must-hotel-booking-rooms-list-book-text"><?php echo \esc_html__('Book Now', 'must-hotel-booking'); ?></span><img class="must-hotel-booking-rooms-list-book-icon" src="<?php echo \esc_url($arrow); ?>" alt="" aria-hidden="true" /></a></div></div>
                    </div>
                </article>
            <?php endforeach; endif; ?>
        </div>
        <?php
    }
}
