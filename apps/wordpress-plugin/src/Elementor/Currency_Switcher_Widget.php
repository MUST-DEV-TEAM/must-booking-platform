<?php

namespace MustHotelBooking\Elementor;

/** Header widget: lets guests see prices in another currency (display only; bookings use the hotel currency). */
class Currency_Switcher_Widget extends \Elementor\Widget_Base
{
    public function get_name(): string { return 'must-currency-switcher'; }
    public function get_title(): string { return \esc_html__('Currency Switcher', 'must-hotel-booking'); }
    public function get_icon(): string { return 'eicon-price-list'; }
    public function get_categories(): array { return ['must-hotel-booking', 'general']; }
    public function get_keywords(): array { return ['currency', 'converter', 'price', 'exchange', 'hotel']; }
    public function get_style_depends(): array { return ['must-hotel-booking-currency-switcher']; }
    public function get_script_depends(): array { return ['must-hotel-booking-currency-switcher']; }

    protected function register_controls(): void
    {
        $options = get_currency_switcher_currency_options();
        $this->start_controls_section('section_content', ['label' => \__('Currencies', 'must-hotel-booking')]);
        $this->add_control('currencies', ['label' => \__('Currencies guests can choose', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT2, 'multiple' => true, 'options' => $options, 'default' => ['EUR', 'USD', 'GBP', 'ALL'], 'label_block' => true]);
        $this->add_control('default_currency', ['label' => \__('Default currency', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::SELECT, 'options' => $options, 'default' => 'EUR', 'description' => \__('Shown until a guest picks another one. Use the hotel currency to show real prices by default.', 'must-hotel-booking')]);
        $this->add_control('approximate_note', ['label' => \__('Note under converted prices', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::TEXT, 'default' => \__('Converted prices are approximate. You pay in the hotel currency.', 'must-hotel-booking'), 'label_block' => true]);
        $this->end_controls_section();

        $this->start_controls_section('section_style', ['label' => \__('Style', 'must-hotel-booking'), 'tab' => \Elementor\Controls_Manager::TAB_STYLE]);
        $this->add_group_control(\Elementor\Group_Control_Typography::get_type(), ['name' => 'switcher_typography', 'selector' => '{{WRAPPER}} .must-currency-trigger']);
        $this->add_control('switcher_color', ['label' => \__('Text Color', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-currency-trigger' => 'color: {{VALUE}};']]);
        $this->add_control('switcher_background', ['label' => \__('Background', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::COLOR, 'selectors' => ['{{WRAPPER}} .must-currency-trigger' => 'background-color: {{VALUE}};']]);
        $this->add_group_control(\Elementor\Group_Control_Border::get_type(), ['name' => 'switcher_border', 'selector' => '{{WRAPPER}} .must-currency-trigger']);
        $this->add_responsive_control('switcher_padding', ['label' => \__('Padding', 'must-hotel-booking'), 'type' => \Elementor\Controls_Manager::DIMENSIONS, 'size_units' => ['px', 'em'], 'selectors' => ['{{WRAPPER}} .must-currency-trigger' => 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};']]);
        $this->end_controls_section();
    }

    protected function render(): void
    {
        $settings = $this->get_settings_for_display();
        $currencies = normalize_currency_switcher_list($settings['currencies'] ?? []);
        if ($currencies === []) return;
        $default = \strtoupper((string) ($settings['default_currency'] ?? ''));
        if (!\in_array($default, $currencies, true)) $default = $currencies[0];
        echo '<div class="must-currency-switcher" data-currencies="' . \esc_attr(\implode(',', $currencies)) . '" data-default="' . \esc_attr($default) . '" data-note="' . \esc_attr((string) ($settings['approximate_note'] ?? '')) . '">';
        $names = get_currency_switcher_currency_names();
        $globe = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
        $chevron = '<svg class="must-currency-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
        $check = '<svg class="must-currency-check" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2.5 7.5 3 3 6-6.5"/></svg>';
        $menuId = $this->get_id() . '-currency-menu';
        echo '<button type="button" class="must-currency-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="' . \esc_attr($menuId) . '" aria-label="' . \esc_attr__('Choose currency', 'must-hotel-booking') . '">' . $globe . '<span class="must-currency-current">' . \esc_html($default) . '</span>' . $chevron . '</button>';
        echo '<ul id="' . \esc_attr($menuId) . '" class="must-currency-menu" role="listbox" aria-label="' . \esc_attr__('Currency', 'must-hotel-booking') . '">';
        foreach ($currencies as $code) {
            echo '<li class="must-currency-option" role="option" data-value="' . \esc_attr($code) . '" aria-selected="' . ($code === $default ? 'true' : 'false') . '"><span class="must-currency-code">' . \esc_html($code) . '</span><span class="must-currency-name">' . \esc_html($names[$code] ?? $code) . '</span>' . $check . '</li>';
        }
        echo '</ul></div>';
    }
}
