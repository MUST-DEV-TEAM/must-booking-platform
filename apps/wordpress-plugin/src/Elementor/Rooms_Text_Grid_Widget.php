<?php

namespace MustHotelBooking\Elementor;

class Rooms_Text_Grid_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string { return 'must-rooms-text-grid'; }
    public function get_title(): string { return \esc_html__('Rooms Text Grid', 'must-hotel-booking'); }
    public function get_icon(): string { return 'eicon-editor-list-ul'; }
    public function get_categories(): array { return ['must-hotel-booking', 'general']; }
    public function get_keywords(): array { return ['rooms', 'accommodation', 'grid', 'text', 'hotel']; }
    public function get_style_depends(): array { return ['must-hotel-booking-rooms-text-grid-widget']; }

    protected function register_controls(): void
    {
        $repeater = new \Elementor\Repeater();
        $repeater->add_control('room_id', ['label' => \__('Room', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'options' => get_rooms_text_grid_room_options(), 'default' => '']);
        $repeater->add_control('custom_link', ['label' => \__('Custom Link Override', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::URL, 'show_external' => false, 'dynamic' => ['active' => true], 'placeholder' => 'https://example.com/room']);

        $this->start_controls_section('section_content', ['label' => \__('Content', 'must-hotel-booking')]);
        $this->add_control('display_mode', ['label' => \__('Display Mode', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'default' => 'room_types', 'options' => ['room_types' => \__('Room Types', 'must-hotel-booking'), 'individual_rooms' => \__('Individual Rooms', 'must-hotel-booking')]]);
        $this->add_control('source_mode', ['label' => \__('Source Mode', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'default' => 'all_rooms', 'options' => ['all_rooms' => \__('All Rooms', 'must-hotel-booking'), 'selected_rooms' => \__('Selected Rooms', 'must-hotel-booking')]]);
        $this->add_control('selected_rooms_note', ['type' => \Elementor\Controls_Manager::RAW_HTML, 'raw' => \__('Add rooms below and drag them into the order you want to display.', 'must-hotel-booking'), 'content_classes' => 'elementor-panel-alert elementor-panel-alert-info', 'condition' => ['source_mode' => 'selected_rooms']]);
        $this->add_control('selected_rooms', ['label' => \__('Selected Rooms', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::REPEATER, 'fields' => $repeater->get_controls(), 'default' => [], 'title_field' => '#{{{ room_id }}}', 'condition' => ['source_mode' => 'selected_rooms']]);
        $this->add_control('items_limit', ['label' => \__('Items Limit', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::NUMBER, 'default' => 9, 'min' => 0, 'max' => 200, 'step' => 1, 'description' => \__('Use 0 to show all matching rooms.', 'must-hotel-booking')]);
        $this->add_control('link_behavior', ['label' => \__('Link Behavior', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'default' => 'single_room_page', 'options' => ['single_room_page' => \__('Single Accommodation Page', 'must-hotel-booking'), 'custom_override_or_single_room_page' => \__('Custom Override When Set', 'must-hotel-booking'), 'no_link' => \__('No Link', 'must-hotel-booking')]]);
        $this->add_control('custom_link_note', ['type' => \Elementor\Controls_Manager::RAW_HTML, 'raw' => \__('Custom link overrides are available on each selected-room item and fall back to the single accommodation page when left empty.', 'must-hotel-booking'), 'content_classes' => 'elementor-panel-alert elementor-panel-alert-warning', 'condition' => ['source_mode' => 'selected_rooms', 'link_behavior' => 'custom_override_or_single_room_page']]);
        $this->add_control('open_in_new_tab', ['label' => \__('Open Links In New Tab', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SWITCHER, 'label_on' => \__('Yes', 'must-hotel-booking'), 'label_off' => \__('No', 'must-hotel-booking'), 'default' => '', 'condition' => ['link_behavior!' => 'no_link']]);
        $this->end_controls_section();

        $this->start_controls_section('section_layout', ['label' => \__('Layout', 'must-hotel-booking')]);
        $this->add_responsive_control('columns', ['label' => \__('Columns', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'default' => '3', 'tablet_default' => '2', 'mobile_default' => '1', 'options' => ['1' => '1', '2' => '2', '3' => '3', '4' => '4', '5' => '5', '6' => '6'], 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-list' => 'grid-template-columns: repeat({{VALUE}}, minmax(0, 1fr));']]);
        $this->add_responsive_control('column_gap', ['label' => \__('Column Gap', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SLIDER, 'size_units' => ['px'], 'range' => ['px' => ['min' => 0, 'max' => 160, 'step' => 1]], 'default' => ['size' => 24, 'unit' => 'px'], 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-list' => 'column-gap: {{SIZE}}{{UNIT}};']]);
        $this->add_responsive_control('row_gap', ['label' => \__('Row Gap', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SLIDER, 'size_units' => ['px'], 'range' => ['px' => ['min' => 0, 'max' => 160, 'step' => 1]], 'default' => ['size' => 16, 'unit' => 'px'], 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-list' => 'row-gap: {{SIZE}}{{UNIT}};']]);
        $this->add_responsive_control('text_align', ['label' => \__('Text Alignment', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::CHOOSE, 'default' => 'left', 'options' => ['left' => ['title' => \__('Left', 'must-hotel-booking'), 'icon' => 'eicon-text-align-left'], 'center' => ['title' => \__('Center', 'must-hotel-booking'), 'icon' => 'eicon-text-align-center'], 'right' => ['title' => \__('Right', 'must-hotel-booking'), 'icon' => 'eicon-text-align-right']], 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner' => 'text-align: {{VALUE}};']]);
        $this->end_controls_section();

        $this->start_controls_section('section_style', ['label' => \__('Items', 'must-hotel-booking'), 'tab' => \Elementor\Controls_Manager::TAB_STYLE]);
        $this->add_group_control(\Elementor\Group_Control_Typography::get_type(), ['name' => 'item_typography', 'selector' => '{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner']);
        $this->add_group_control(\Elementor\Group_Control_Text_Shadow::get_type(), ['name' => 'item_text_shadow', 'selector' => '{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner']);
        $this->start_controls_tabs('item_style_tabs');
        $this->start_controls_tab('item_style_normal', ['label' => \__('Normal', 'must-hotel-booking')]);
        $this->add_control('item_text_color', ['label' => \__('Text Color', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner' => 'color: {{VALUE}};']]);
        $this->add_control('item_background_color', ['label' => \__('Background Color', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner' => 'background-color: {{VALUE}};']]);
        $this->end_controls_tab();
        $this->start_controls_tab('item_style_hover', ['label' => \__('Hover', 'must-hotel-booking')]);
        $this->add_control('item_hover_text_color', ['label' => \__('Hover Color', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-link:hover, {{WRAPPER}} .must-hotel-booking-rooms-text-grid-link:focus-visible' => 'color: {{VALUE}};']]);
        $this->add_control('item_hover_background_color', ['label' => \__('Hover Background', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-link:hover, {{WRAPPER}} .must-hotel-booking-rooms-text-grid-link:focus-visible' => 'background-color: {{VALUE}};']]);
        $this->end_controls_tab();
        $this->start_controls_tab('item_style_current', ['label' => \__('Current', 'must-hotel-booking')]);
        $this->add_control('item_current_text_color', ['label' => \__('Current Color', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item.is-current .must-hotel-booking-rooms-text-grid-item-inner' => 'color: {{VALUE}};']]);
        $this->add_control('item_current_background_color', ['label' => \__('Current Background', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item.is-current .must-hotel-booking-rooms-text-grid-item-inner' => 'background-color: {{VALUE}};']]);
        $this->end_controls_tab();
        $this->end_controls_tabs();
        $this->add_group_control(\Elementor\Group_Control_Border::get_type(), ['name' => 'item_border', 'selector' => '{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner']);
        $this->add_responsive_control('item_border_radius', ['label' => \__('Border Radius', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SLIDER, 'size_units' => ['px'], 'range' => ['px' => ['min' => 0, 'max' => 80, 'step' => 1]], 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner' => 'border-radius: {{SIZE}}{{UNIT}};']]);
        $this->add_responsive_control('item_padding', ['label' => \__('Item Padding', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::DIMENSIONS, 'size_units' => ['px', '%', 'em', 'rem'], 'selectors' => ['{{WRAPPER}} .must-hotel-booking-rooms-text-grid-item-inner' => 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};']]);
        $this->add_control('transition_duration', ['label' => \__('Transition Duration (ms)', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::NUMBER, 'default' => 220, 'min' => 0, 'max' => 2000, 'step' => 10, 'selectors' => ['{{WRAPPER}}' => '--must-hotel-booking-rooms-text-grid-transition-duration: {{VALUE}}ms;']]);
        $this->end_controls_section();
    }

    protected function render(): void
    {
        $settings = $this->get_settings_for_display();
        $source = ($settings['source_mode'] ?? '') === 'selected_rooms' ? 'selected_rooms' : 'all_rooms';
        $displayMode = ($settings['display_mode'] ?? '') === 'individual_rooms' ? 'individual_rooms' : 'room_types';
        $limit = (int) ($settings['items_limit'] ?? 9);
        $limit = $limit <= 0 ? 0 : \max(1, \min(200, $limit));
        $behavior = \sanitize_key((string) ($settings['link_behavior'] ?? 'single_room_page'));
        if (!\in_array($behavior, ['single_room_page', 'custom_override_or_single_room_page', 'no_link'], true)) $behavior = 'single_room_page';
        $rooms = get_rooms_for_text_grid_widget_render($source, \is_array($settings['selected_rooms'] ?? null) ? $settings['selected_rooms'] : [], $limit, $displayMode);
        $this->add_render_attribute('wrapper', 'class', ['must-hotel-booking-widget', 'must-hotel-booking-rooms-text-grid-widget']);
        $this->add_render_attribute('wrapper', 'style', get_rooms_text_grid_wrapper_inline_styles());
        echo '<div ' . $this->get_render_attribute_string('wrapper') . '>';
        if (empty($rooms)) { echo '<p class="must-hotel-booking-rooms-text-grid-empty">' . \esc_html__('No accommodations found.', 'must-hotel-booking') . '</p></div>'; return; }
        echo '<ul class="must-hotel-booking-rooms-text-grid-list" role="list">';
        foreach ($rooms as $index => $room) {
            $name = \trim((string) ($room['name'] ?? ''));
            if ($name === '') continue;
            $url = get_rooms_text_grid_item_link_url($room, $behavior);
            $detailsUrl = get_rooms_text_grid_details_url($room);
            $isCurrent = isset($_GET['accommodation_type'])
                && \sanitize_key((string) \wp_unslash($_GET['accommodation_type'])) === (string) ($room['room_type_id'] ?? $room['id'] ?? '');
            echo '<li class="must-hotel-booking-rooms-text-grid-item' . ($isCurrent ? ' is-current' : '') . '">';
            echo '<div class="must-hotel-booking-rooms-text-grid-item-inner must-hotel-booking-rooms-text-grid-item-actions">';
            if ($url === '') { echo '<span class="must-hotel-booking-rooms-text-grid-primary must-hotel-booking-rooms-text-grid-text">' . \esc_html($name) . '</span>'; }
            else {
                $custom = \is_array($room['custom_link'] ?? null) ? $room['custom_link'] : [];
                $newTab = ($settings['open_in_new_tab'] ?? '') === 'yes' || ($behavior === 'custom_override_or_single_room_page' && !empty($custom['is_external']));
                $relParts = $newTab ? ['noopener', 'noreferrer'] : [];
                if ($behavior === 'custom_override_or_single_room_page' && !empty($custom['nofollow'])) $relParts[] = 'nofollow';
                $rel = !empty($relParts) ? ' rel="' . \esc_attr(\implode(' ', $relParts)) . '"' : '';
                $target = $newTab ? ' target="_blank"' : '';
                $current = $isCurrent ? ' aria-current="page"' : '';
                echo '<a class="must-hotel-booking-rooms-text-grid-primary must-hotel-booking-rooms-text-grid-link" href="' . \esc_url($url) . '"' . $target . $rel . $current . '>' . \esc_html($name) . '</a>';
            }
            if ($detailsUrl !== '') echo '<a class="must-hotel-booking-rooms-text-grid-details" href="' . \esc_url($detailsUrl) . '">' . \esc_html__('More Details', 'must-hotel-booking') . '</a>';
            echo '</div>';
            echo '</li>';
        }
        echo '</ul></div>';
    }
}
