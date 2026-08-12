<?php

if (!\defined('ABSPATH')) {
    exit;
}

$must_checkout_template_span = \MustHotelBooking\Core\BookingPerformanceMonitor::startSpan('template_render');
$view = \must_hotel_booking\get_checkout_page_view_data();
$messages = isset($view['messages']) && \is_array($view['messages']) ? $view['messages'] : [];
$is_valid_context = !empty($view['is_valid_context']);
$selected_rooms = isset($view['selected_rooms']) && \is_array($view['selected_rooms']) ? $view['selected_rooms'] : [];
$summary = isset($view['summary']) && \is_array($view['summary']) ? $view['summary'] : [];
$guest_form = isset($view['guest_form']) && \is_array($view['guest_form']) ? $view['guest_form'] : [];
$checkout_url = isset($view['checkout_url']) ? (string) $view['checkout_url'] : \home_url('/checkout');
$booking_url = isset($view['booking_url']) ? (string) $view['booking_url'] : \home_url('/booking');
$accommodation_url = isset($view['accommodation_url']) ? (string) $view['accommodation_url'] : \home_url('/booking-accommodation');
$fixed_room_mode = !empty($view['fixed_room_mode']);
$arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? \must_hotel_booking_asset_url('assets/img/ArrowRight.svg') : '';
$back_arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? \must_hotel_booking_asset_url('assets/img/ArrowLEFT.svg') : '';
$dropdown_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? \must_hotel_booking_asset_url('assets/img/poludown.svg') : '';
$check_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? \must_hotel_booking_asset_url('assets/img/check.svg') : '';
$back_url = $fixed_room_mode ? $booking_url : $accommodation_url;
$selected_room_count = isset($view['selected_room_count']) ? (int) $view['selected_room_count'] : 0;
$show_room_guest_info = $selected_room_count > 1;
$checkin = isset($view['checkin']) ? (string) $view['checkin'] : '';
$checkout = isset($view['checkout']) ? (string) $view['checkout'] : '';
$guests = isset($view['guests']) ? (int) $view['guests'] : 1;
$room_count = isset($view['room_count']) ? (int) $view['room_count'] : 0;
$coupon_code = isset($view['coupon_code']) ? (string) $view['coupon_code'] : '';
$coupon_input_value = isset($view['coupon_input_value']) ? (string) $view['coupon_input_value'] : $coupon_code;
$applied_coupon_code = isset($view['applied_coupon_code']) ? (string) $view['applied_coupon_code'] : '';
$coupon_notice = isset($view['coupon_notice']) && \is_array($view['coupon_notice']) ? $view['coupon_notice'] : null;
$coupon_control_classes = 'must-checkout-coupon-control';

if ($coupon_input_value !== '' || $applied_coupon_code !== '') {
    $coupon_control_classes .= ' is-filled';
}

$country_options = isset($view['country_options']) && \is_array($view['country_options']) ? $view['country_options'] : [];
$phone_country_code_options = isset($view['phone_country_code_options']) && \is_array($view['phone_country_code_options']) ? $view['phone_country_code_options'] : [];
$room_guest_form = isset($guest_form['room_guests']) && \is_array($guest_form['room_guests']) ? $guest_form['room_guests'] : [];
$fees_total = isset($summary['fees_total']) ? (float) $summary['fees_total'] : 0.0;
$discount_total = isset($summary['discount_total']) ? (float) $summary['discount_total'] : 0.0;
$taxes_total = isset($summary['taxes_total']) ? (float) $summary['taxes_total'] : 0.0;
$total_price = isset($summary['total_price']) ? (float) $summary['total_price'] : 0.0;
$room_subtotal = isset($summary['room_subtotal']) ? (float) $summary['room_subtotal'] : 0.0;
$nights = isset($summary['nights']) ? (int) $summary['nights'] : 0;
$stay_days = $nights > 0 ? $nights + 1 : 0;
$selected_country = isset($guest_form['country']) ? (string) $guest_form['country'] : '';
$selected_phone_country_code = isset($guest_form['phone_country_code']) ? (string) $guest_form['phone_country_code'] : \must_hotel_booking\get_checkout_default_phone_option_value();
$phone_number = isset($guest_form['phone_number']) ? (string) $guest_form['phone_number'] : '';
$selected_phone_option = \MustHotelBooking\Frontend\get_checkout_phone_option_details($selected_phone_country_code);
$selected_country_option = null;

foreach ($country_options as $country_option) {
    if ((string) ($country_option['value'] ?? '') === $selected_country) {
        $selected_country_option = $country_option;
        break;
    }
}

$phone_picker_display_label = \trim((string) ($selected_phone_option['country_code'] ?? '') . ' ' . (string) ($selected_phone_option['dial_code'] ?? ''));
$phone_picker_display_flag = isset($selected_phone_option['flag']) ? (string) $selected_phone_option['flag'] : '';
$country_picker_placeholder = \__('Country of Residence*', 'must-hotel-booking');
$country_picker_display_label = \is_array($selected_country_option)
    ? (string) ($selected_country_option['name'] ?? $country_picker_placeholder)
    : $country_picker_placeholder;
$country_picker_display_flag = \is_array($selected_country_option)
    ? (string) ($selected_country_option['flag'] ?? '')
    : '';
$country_picker_has_selection = \is_array($selected_country_option) && $selected_country !== '';
$phone_picker_search_placeholder = \__('Search code or country', 'must-hotel-booking');
$country_picker_search_placeholder = \__('Search country', 'must-hotel-booking');
$picker_no_results_label = \__('No matches found.', 'must-hotel-booking');
$show_honeypot = \MustHotelBooking\Engine\BookingAbuseProtection::shouldRenderHoneypotField();
$honeypot_field_name = $show_honeypot ? \MustHotelBooking\Engine\BookingAbuseProtection::getHoneypotFieldName() : '';
$checkout_price_breakdown_mode = \MustHotelBooking\Core\MustBookingConfig::get_checkout_price_breakdown_mode();

$summary_currency = 'USD';

if (!empty($selected_rooms[0]['room']) && \is_array($selected_rooms[0]['room']) && !empty($selected_rooms[0]['room']['currency'])) {
    $summary_currency = (string) $selected_rooms[0]['room']['currency'];
}

$format_money = static function (float $amount, string $currency = 'USD'): string {
    return \must_hotel_booking\format_frontend_money($amount, $currency);
};

$format_display_date = static function (string $date): string {
    $timestamp = \strtotime($date . ' 00:00:00');

    if ($timestamp === false) {
        return $date;
    }

    return \wp_date('D, M j Y', $timestamp);
};

$render_checkout_price_breakdown_rows = static function (array $pricing, string $currency) use ($format_money, $format_display_date): string {
    $rows = \function_exists('MustHotelBooking\\Frontend\\get_price_breakdown_rows_from_pricing')
        ? \MustHotelBooking\Frontend\get_price_breakdown_rows_from_pricing($pricing)
        : [];

    if (empty($rows)) {
        return '';
    }

    $html = '<div class="must-checkout-price-breakdown-rows">';
    $html .= '<div class="must-checkout-price-line is-breakdown-heading"><span>' . \esc_html__('Price details', 'must-hotel-booking') . '</span><span></span></div>';

    foreach ($rows as $row) {
        $date = isset($row['date']) ? (string) $row['date'] : '';
        $amount = isset($row['amount']) ? (float) $row['amount'] : 0.0;
        $html .= '<div class="must-checkout-price-line is-nightly-rate">';
        $html .= '<span>' . \esc_html($format_display_date($date)) . '</span>';
        $html .= '<span>' . \esc_html($format_money($amount, $currency)) . '</span>';
        $html .= '</div>';
    }

    $html .= '</div>';

    return $html;
};
?>
<?php \get_header(); ?>
<main class="must-hotel-booking-page must-hotel-booking-page-checkout must-booking-process-page<?php echo $fixed_room_mode ? ' is-fixed-room-flow' : ''; ?>">
    <div class="must-hotel-booking-container">
        <section class="must-booking-step-header">
            <h1><?php echo \esc_html__('Guest Information', 'must-hotel-booking'); ?></h1>

            <div class="must-booking-stepper-wrap" aria-label="<?php echo \esc_attr__('Booking steps', 'must-hotel-booking'); ?>">
                <div class="must-booking-stepper">
                    <a href="<?php echo \esc_url($back_url); ?>" class="must-booking-stepper-nav is-back">
                        <?php if ($back_arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($back_arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                        <span><?php echo \esc_html__('Back', 'must-hotel-booking'); ?></span>
                    </a>
                    <a href="<?php echo \esc_url($booking_url); ?>" class="must-booking-stepper-step is-link" data-step="1"><?php echo \esc_html__('Calendar', 'must-hotel-booking'); ?></a>
                    <?php if (!$fixed_room_mode) : ?>
                        <a href="<?php echo \esc_url($accommodation_url); ?>" class="must-booking-stepper-step is-link" data-step="2"><?php echo \esc_html__('Select Accommodation', 'must-hotel-booking'); ?></a>
                    <?php endif; ?>
                    <span class="must-booking-stepper-step is-active" data-step="3"><?php echo \esc_html__('Guest Information', 'must-hotel-booking'); ?></span>
                    <span class="must-booking-stepper-step" data-step="4"><?php echo \esc_html__('Review & Payment', 'must-hotel-booking'); ?></span>
                    <span class="must-booking-stepper-nav is-next" aria-disabled="true">
                        <span><?php echo \esc_html__('Next', 'must-hotel-booking'); ?></span>
                        <?php if ($arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                    </span>
                </div>
            </div>
        </section>

        <?php if (!empty($messages)) : ?>
            <div class="must-hotel-booking-messages">
                <?php foreach ($messages as $message) : ?>
                    <p><?php echo \esc_html((string) $message); ?></p>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <?php if (!$is_valid_context) : ?>
            <p>
                <a href="<?php echo \esc_url($back_url); ?>">
                    <?php echo \esc_html($fixed_room_mode ? __('Back to Calendar', 'must-hotel-booking') : __('Back to Select Accommodation', 'must-hotel-booking')); ?>
                </a>
            </p>
        <?php else : ?>
            <form method="post" action="<?php echo \esc_url($checkout_url); ?>" class="must-checkout-form">
                <?php \wp_nonce_field('must_checkout_complete', 'must_checkout_nonce'); ?>
                <?php if ($show_honeypot && $honeypot_field_name !== '') : ?>
                    <div style="position:absolute !important;left:-10000px !important;top:auto !important;width:1px !important;height:1px !important;overflow:hidden !important;" aria-hidden="true" role="presentation">
                        <label for="must-checkout-honeypot"><?php echo \esc_html__('Leave this field empty', 'must-hotel-booking'); ?></label>
                        <input id="must-checkout-honeypot" type="text" name="<?php echo \esc_attr($honeypot_field_name); ?>" value="" tabindex="-1" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" aria-hidden="true" />
                    </div>
                <?php endif; ?>
                <input type="hidden" name="checkin" value="<?php echo \esc_attr($checkin); ?>" />
                <input type="hidden" name="checkout" value="<?php echo \esc_attr($checkout); ?>" />
                <input type="hidden" name="guests" value="<?php echo \esc_attr((string) $guests); ?>" />
                <input type="hidden" name="room_count" value="<?php echo \esc_attr((string) $room_count); ?>" />
                <input type="hidden" name="applied_coupon_code" value="<?php echo \esc_attr($applied_coupon_code); ?>" />

                <section class="must-checkout-coupon-row">
                    <div class="<?php echo \esc_attr($coupon_control_classes); ?>">
                        <label class="screen-reader-text" for="must-checkout-coupon"><?php echo \esc_html__('Coupon Code', 'must-hotel-booking'); ?></label>
                        <input
                            id="must-checkout-coupon"
                            type="text"
                            name="coupon_code"
                            value="<?php echo \esc_attr($coupon_input_value); ?>"
                            placeholder="<?php echo \esc_attr__('Add Coupon', 'must-hotel-booking'); ?>"
                        />
                        <button
                            type="submit"
                            name="must_checkout_action"
                            value="preview_coupon"
                            class="must-checkout-coupon-submit"
                            formnovalidate
                            aria-label="<?php echo \esc_attr__('Apply Coupon', 'must-hotel-booking'); ?>"
                        >
                            <?php if ($check_icon_url !== '') : ?>
                                <img src="<?php echo \esc_url($check_icon_url); ?>" alt="" aria-hidden="true" />
                            <?php endif; ?>
                            <span class="screen-reader-text"><?php echo \esc_html__('Apply Coupon', 'must-hotel-booking'); ?></span>
                        </button>
                    </div>
                </section>

                <?php if (\is_array($coupon_notice) && (string) ($coupon_notice['message'] ?? '') !== '') : ?>
                    <div class="must-checkout-coupon-notice is-<?php echo \esc_attr((string) ($coupon_notice['type'] ?? 'info')); ?>">
                        <p><?php echo \esc_html((string) $coupon_notice['message']); ?></p>
                    </div>
                <?php endif; ?>

                <div class="must-checkout-room-stack">
                    <?php foreach ($selected_rooms as $index => $selected_room_item) : ?>
                        <?php
                        $room = isset($selected_room_item['room']) && \is_array($selected_room_item['room']) ? $selected_room_item['room'] : [];
                        $pricing = isset($selected_room_item['pricing']) && \is_array($selected_room_item['pricing']) ? $selected_room_item['pricing'] : [];
                        $room_id = isset($selected_room_item['room_id']) ? (int) $selected_room_item['room_id'] : 0;
                        $assigned_room_guests = isset($selected_room_item['assigned_guests']) ? \max(1, (int) $selected_room_item['assigned_guests']) : \max(1, $guests);
                        $room_name = isset($room['name']) ? (string) $room['name'] : \__('Room', 'must-hotel-booking');
                        $rate_plan_name = isset($selected_room_item['rate_plan']['name']) ? (string) $selected_room_item['rate_plan']['name'] : '';
                        $room_currency = isset($room['currency']) ? (string) $room['currency'] : 'USD';
                        $max_guests = isset($room['effective_max_guests'])
                            ? (int) $room['effective_max_guests']
                            : (isset($room['max_guests']) ? (int) $room['max_guests'] : 0);
                        $room_people_icon_url = isset($room['people_icon_url']) ? (string) $room['people_icon_url'] : '';
                        $room_primary_image_url = isset($room['primary_image_url']) ? (string) $room['primary_image_url'] : '';
                        $room_total = isset($pricing['total_price']) ? (float) $pricing['total_price'] : (isset($room['dynamic_total_price']) ? (float) $room['dynamic_total_price'] : 0.0);
                        $room_nights = isset($pricing['nights']) ? (int) $pricing['nights'] : $nights;
                        $room_guests = isset($room_guest_form[$room_id]) && \is_array($room_guest_form[$room_id]) ? $room_guest_form[$room_id] : [];
                        $room_guest_count = isset($room_guests['guest_count']) && (string) $room_guests['guest_count'] !== '' ? (string) $room_guests['guest_count'] : (string) $assigned_room_guests;
                        $room_guest_first_name = isset($room_guests['first_name']) ? (string) $room_guests['first_name'] : '';
                        $room_guest_last_name = isset($room_guests['last_name']) ? (string) $room_guests['last_name'] : '';
                        $room_fee_total = isset($pricing['fees_total']) ? (float) $pricing['fees_total'] : 0.0;
                        $room_discount_total = isset($pricing['discount_total']) ? (float) $pricing['discount_total'] : 0.0;
                        $room_tax_total = isset($pricing['taxes_total']) ? (float) $pricing['taxes_total'] : 0.0;
                        $room_accommodation_total = isset($pricing['room_subtotal']) ? (float) $pricing['room_subtotal'] : (isset($room['dynamic_room_subtotal']) ? (float) $room['dynamic_room_subtotal'] : 0.0);
                        $room_applied_coupon = isset($pricing['applied_coupon']) ? (string) $pricing['applied_coupon'] : $applied_coupon_code;
                        $room_rate = $room_nights > 0 ? $room_accommodation_total / $room_nights : $room_accommodation_total;
                        $room_subtotal_before_taxes = $room_accommodation_total + $room_fee_total - $room_discount_total;
                        $room_price_breakdown_rows_html = $checkout_price_breakdown_mode === 'date_price_rows'
                            ? $render_checkout_price_breakdown_rows($pricing, $room_currency)
                            : '';
                        $show_room_price_breakdown_rows = $room_price_breakdown_rows_html !== '';
                        ?>
                        <section class="must-checkout-room-card">
                            <div class="must-checkout-room-summary-pane">
                                <div class="must-checkout-room-summary-head">
                                    <h2><?php echo \esc_html__('Stay Summary', 'must-hotel-booking'); ?></h2>
                                    <p>
                                        <?php
                                        echo \esc_html(
                                            \sprintf(
                                                /* translators: %d is accommodation index. */
                                                __('Accommodation #%d', 'must-hotel-booking'),
                                                $index + 1
                                            )
                                        );
                                        ?>
                                    </p>
                                </div>

                                <div class="must-checkout-divider"></div>

                                <?php if ($rate_plan_name !== '') : ?>
                                    <p><?php echo \esc_html(\sprintf(__('Rate Plan: %s', 'must-hotel-booking'), $rate_plan_name)); ?></p>
                                    <div class="must-checkout-divider"></div>
                                <?php endif; ?>

                                <div class="must-checkout-stay-meta">
                                    <p>
                                        <?php
                                        echo \esc_html(
                                            \sprintf(
                                                /* translators: %s is formatted arrival date. */
                                                __('Arriving: %s', 'must-hotel-booking'),
                                                $format_display_date($checkin)
                                            )
                                        );
                                        ?>
                                    </p>
                                    <p>
                                        <?php
                                        echo \esc_html(
                                            \sprintf(
                                                /* translators: %s is formatted departure date. */
                                                __('Departing: %s', 'must-hotel-booking'),
                                                $format_display_date($checkout)
                                            )
                                        );
                                        ?>
                                    </p>
                                    <p>
                                        <?php
                                        echo \esc_html(
                                            \sprintf(
                                                /* translators: 1: days count, 2: nights count. */
                                                __('%1$d Days, %2$d Nights', 'must-hotel-booking'),
                                                $stay_days,
                                                $room_nights
                                            )
                                        );
                                        ?>
                                    </p>
                                </div>

                                <?php if ($show_room_guest_info) : ?>
                                    <div class="must-checkout-room-guest-info">
                                        <h3><?php echo \esc_html__('Guest Information', 'must-hotel-booking'); ?></h3>

                                        <div class="must-checkout-room-guest-fields">
                                            <label class="must-checkout-room-guest-shell must-checkout-room-guest-count-shell">
                                                <span class="screen-reader-text"><?php echo \esc_html__('Guests Number', 'must-hotel-booking'); ?></span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    max="<?php echo \esc_attr((string) \max(1, $max_guests > 0 ? $max_guests : $guests)); ?>"
                                                    name="room_guest_count[<?php echo \esc_attr((string) $room_id); ?>]"
                                                    value="<?php echo \esc_attr($room_guest_count); ?>"
                                                    placeholder="<?php echo \esc_attr__('Guests Number', 'must-hotel-booking'); ?>"
                                                />
                                                <?php if ($room_people_icon_url !== '') : ?>
                                                    <img src="<?php echo \esc_url($room_people_icon_url); ?>" alt="" aria-hidden="true" />
                                                <?php endif; ?>
                                            </label>

                                            <label class="must-checkout-room-guest-shell">
                                                <span class="screen-reader-text"><?php echo \esc_html__('First Name', 'must-hotel-booking'); ?></span>
                                                <input
                                                    type="text"
                                                    name="room_guest_first_name[<?php echo \esc_attr((string) $room_id); ?>]"
                                                    value="<?php echo \esc_attr($room_guest_first_name); ?>"
                                                    placeholder="<?php echo \esc_attr__('First Name (Optional)', 'must-hotel-booking'); ?>"
                                                />
                                            </label>

                                            <label class="must-checkout-room-guest-shell">
                                                <span class="screen-reader-text"><?php echo \esc_html__('Last Name', 'must-hotel-booking'); ?></span>
                                                <input
                                                    type="text"
                                                    name="room_guest_last_name[<?php echo \esc_attr((string) $room_id); ?>]"
                                                    value="<?php echo \esc_attr($room_guest_last_name); ?>"
                                                    placeholder="<?php echo \esc_attr__('Last Name (Optional)', 'must-hotel-booking'); ?>"
                                                />
                                            </label>
                                        </div>
                                    </div>
                                <?php endif; ?>
                            </div>

                            <div class="must-checkout-room-pricing-pane">
                                <div class="must-checkout-room-title-row">
                                    <div>
                                        <h3><?php echo \esc_html($room_name); ?></h3>
                                        <?php if ($rate_plan_name !== '') : ?>
                                            <p><?php echo \esc_html($rate_plan_name); ?></p>
                                        <?php endif; ?>
                                    </div>
                                    <strong><?php echo \esc_html($format_money($room_total, $room_currency)); ?></strong>
                                </div>

                                <div class="must-checkout-room-pricing-card">
                                    <div class="must-checkout-room-pricing-top">
                                        <div class="must-checkout-room-pricing-copy">
                                            <p><?php echo \esc_html__('Price Breakdown', 'must-hotel-booking'); ?></p>
                                            <p>
                                                <?php
                                                echo \esc_html(
                                                    \sprintf(
                                                        /* translators: %d is guests count. */
                                                        _n('%d Guest', '%d Guests', $assigned_room_guests, 'must-hotel-booking'),
                                                        $assigned_room_guests
                                                    )
                                                );
                                                ?>
                                            </p>
                                        </div>

                                        <?php if ($room_primary_image_url !== '') : ?>
                                            <div class="must-checkout-room-thumb">
                                                <img src="<?php echo \esc_url($room_primary_image_url); ?>" alt="<?php echo \esc_attr($room_name); ?>" loading="lazy" />
                                            </div>
                                        <?php endif; ?>
                                    </div>

                                    <div class="must-checkout-divider is-dark"></div>

                                    <div class="must-checkout-price-lines">
                                        <?php if ($show_room_price_breakdown_rows) : ?>
                                            <?php echo $room_price_breakdown_rows_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                                        <?php else : ?>
                                            <div class="must-checkout-price-line">
                                                <span><?php echo \esc_html__('Room Rate', 'must-hotel-booking'); ?></span>
                                                <span><?php echo \esc_html($format_money($room_rate, $room_currency)); ?></span>
                                            </div>
                                            <div class="must-checkout-price-line">
                                                <span><?php echo \esc_html__('Number of Nights', 'must-hotel-booking'); ?></span>
                                                <span><?php echo \esc_html((string) $room_nights); ?></span>
                                            </div>
                                        <?php endif; ?>
                                        <div class="must-checkout-price-line">
                                            <span><?php echo \esc_html__('Guests', 'must-hotel-booking'); ?></span>
                                            <span><?php echo \esc_html((string) $assigned_room_guests); ?></span>
                                        </div>
                                        <div class="must-checkout-divider is-dark"></div>
                                        <div class="must-checkout-price-line">
                                            <span><?php echo \esc_html__('Accommodation Total', 'must-hotel-booking'); ?></span>
                                            <span><?php echo \esc_html($format_money($room_accommodation_total, $room_currency)); ?></span>
                                        </div>
                                        <?php if ($room_discount_total > 0.0) : ?>
                                            <div class="must-checkout-price-line is-discount">
                                                <span>
                                                    <?php
                                                    echo \esc_html(
                                                        $room_applied_coupon !== ''
                                                            ? \sprintf(
                                                                /* translators: %s is the applied discount code. */
                                                                __('Discount (%s)', 'must-hotel-booking'),
                                                                \strtoupper($room_applied_coupon)
                                                            )
                                                            : __('Discount Used', 'must-hotel-booking')
                                                    );
                                                    ?>
                                                </span>
                                                <span><?php echo \esc_html('-' . $format_money($room_discount_total, $room_currency)); ?></span>
                                            </div>
                                        <?php endif; ?>
                                        <div class="must-checkout-price-line">
                                            <span><?php echo \esc_html__('Subtotal', 'must-hotel-booking'); ?></span>
                                            <span><?php echo \esc_html($format_money($room_subtotal_before_taxes, $room_currency)); ?></span>
                                        </div>
                                        <div class="must-checkout-divider is-dark"></div>
                                        <div class="must-checkout-price-line is-total">
                                            <span><?php echo \esc_html__('Total', 'must-hotel-booking'); ?></span>
                                            <span><?php echo \esc_html($format_money($room_total, $room_currency)); ?></span>
                                        </div>
                                        <p class="must-checkout-price-note"><?php echo \esc_html__('Including Taxes & Fees', 'must-hotel-booking'); ?></p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    <?php endforeach; ?>
                </div>

                <section class="must-checkout-total-band">
                    <div class="must-checkout-total-band-row">
                        <h2>
                            <?php
                            echo \esc_html(
                                $selected_room_count === 1
                                    ? __('Total for room', 'must-hotel-booking')
                                    : __('Total for rooms', 'must-hotel-booking')
                            );
                            ?>
                        </h2>
                        <strong><?php echo \esc_html($format_money($total_price, $summary_currency)); ?></strong>
                    </div>
                </section>

                <section class="must-checkout-guest-block">
                    <div class="must-checkout-guest-block-inner">
                        <div class="must-checkout-guest-section">
                            <h2><?php echo \esc_html__('Guest Information', 'must-hotel-booking'); ?></h2>

                            <div class="must-checkout-contact-grid">
                                <label class="must-checkout-field">
                                    <span class="screen-reader-text"><?php echo \esc_html__('First Name', 'must-hotel-booking'); ?></span>
                                    <input id="must-checkout-first-name" type="text" name="first_name" value="<?php echo \esc_attr((string) ($guest_form['first_name'] ?? '')); ?>" placeholder="<?php echo \esc_attr__('First Name*', 'must-hotel-booking'); ?>" required />
                                </label>

                                <label class="must-checkout-field">
                                    <span class="screen-reader-text"><?php echo \esc_html__('Last Name', 'must-hotel-booking'); ?></span>
                                    <input id="must-checkout-last-name" type="text" name="last_name" value="<?php echo \esc_attr((string) ($guest_form['last_name'] ?? '')); ?>" placeholder="<?php echo \esc_attr__('Last Name*', 'must-hotel-booking'); ?>" required />
                                </label>

                                <label class="must-checkout-field">
                                    <span class="screen-reader-text"><?php echo \esc_html__('Email', 'must-hotel-booking'); ?></span>
                                    <input id="must-checkout-email" type="email" name="email" value="<?php echo \esc_attr((string) ($guest_form['email'] ?? '')); ?>" placeholder="<?php echo \esc_attr__('Email*', 'must-hotel-booking'); ?>" required />
                                </label>

                                <div class="must-checkout-field must-checkout-field-phone">
                                    <span class="screen-reader-text"><?php echo \esc_html__('Phone Number', 'must-hotel-booking'); ?></span>
                                    <div class="must-checkout-phone-shell">
                                        <div
                                            class="must-checkout-picker must-checkout-picker-phone"
                                            data-checkout-picker="1"
                                            data-picker-placeholder="<?php echo \esc_attr($phone_picker_display_label); ?>"
                                        >
                                            <input type="hidden" name="phone_country_code" value="<?php echo \esc_attr((string) ($selected_phone_option['value'] ?? $selected_phone_country_code)); ?>" data-picker-input="1" />
                                            <button
                                                type="button"
                                                class="must-checkout-picker-toggle"
                                                data-picker-toggle="1"
                                                aria-haspopup="listbox"
                                                aria-expanded="false"
                                                aria-label="<?php echo \esc_attr__('Phone country code', 'must-hotel-booking'); ?>"
                                            >
                                                <span class="must-checkout-picker-toggle-copy">
                                                    <span class="must-checkout-picker-flag" data-picker-selected-flag="1"><?php echo \esc_html($phone_picker_display_flag); ?></span>
                                                    <span class="must-checkout-picker-label" data-picker-selected-label="1"><?php echo \esc_html($phone_picker_display_label); ?></span>
                                                </span>
                                                <?php if ($dropdown_icon_url !== '') : ?>
                                                    <img class="must-picker-chevron" src="<?php echo \esc_url($dropdown_icon_url); ?>" alt="" aria-hidden="true" />
                                                <?php endif; ?>
                                            </button>
                                            <div class="must-checkout-picker-panel" data-picker-panel="1" hidden>
                                                <div class="must-checkout-picker-search-wrap">
                                                    <input
                                                        type="text"
                                                        class="must-checkout-picker-search"
                                                        data-picker-search="1"
                                                        value=""
                                                        placeholder="<?php echo \esc_attr($phone_picker_search_placeholder); ?>"
                                                        aria-label="<?php echo \esc_attr($phone_picker_search_placeholder); ?>"
                                                    />
                                                </div>
                                                <div class="must-checkout-picker-options" role="listbox">
                                                    <?php foreach ($phone_country_code_options as $phone_country_code_option) : ?>
                                                        <?php
                                                        $phone_option_value = isset($phone_country_code_option['value']) ? (string) $phone_country_code_option['value'] : '';
                                                        $phone_option_country_code = isset($phone_country_code_option['country_code']) ? (string) $phone_country_code_option['country_code'] : '';
                                                        $phone_option_country_name = isset($phone_country_code_option['country_name']) ? (string) $phone_country_code_option['country_name'] : '';
                                                        $phone_option_dial_code = isset($phone_country_code_option['dial_code']) ? (string) $phone_country_code_option['dial_code'] : '';
                                                        $phone_option_flag = isset($phone_country_code_option['flag']) ? (string) $phone_country_code_option['flag'] : '';
                                                        $phone_option_display_label = \trim($phone_option_country_code . ' ' . $phone_option_dial_code);
                                                        $phone_option_search = \strtolower(\trim($phone_option_country_code . ' ' . $phone_option_country_name . ' ' . $phone_option_dial_code));
                                                        $phone_option_is_selected = $phone_option_value === (string) ($selected_phone_option['value'] ?? $selected_phone_country_code);
                                                        ?>
                                                        <button
                                                            type="button"
                                                            class="must-checkout-picker-option<?php echo $phone_option_is_selected ? ' is-selected' : ''; ?>"
                                                            data-picker-option="1"
                                                            data-value="<?php echo \esc_attr($phone_option_value); ?>"
                                                            data-label="<?php echo \esc_attr($phone_option_display_label); ?>"
                                                            data-flag="<?php echo \esc_attr($phone_option_flag); ?>"
                                                            data-search="<?php echo \esc_attr($phone_option_search); ?>"
                                                            role="option"
                                                            aria-selected="<?php echo $phone_option_is_selected ? 'true' : 'false'; ?>"
                                                        >
                                                            <span class="must-checkout-picker-option-flag" aria-hidden="true"><?php echo \esc_html($phone_option_flag); ?></span>
                                                            <span class="must-checkout-picker-option-copy">
                                                                <span class="must-checkout-picker-option-title"><?php echo \esc_html($phone_option_country_name); ?></span>
                                                                <span class="must-checkout-picker-option-meta"><?php echo \esc_html($phone_option_display_label); ?></span>
                                                            </span>
                                                        </button>
                                                    <?php endforeach; ?>
                                                    <p class="must-checkout-picker-empty" data-picker-empty="1" hidden><?php echo \esc_html($picker_no_results_label); ?></p>
                                                </div>
                                            </div>
                                        </div>
                                        <span class="must-checkout-phone-divider" aria-hidden="true">|</span>
                                        <input id="must-checkout-phone" type="text" name="phone_number" value="<?php echo \esc_attr($phone_number); ?>" placeholder="<?php echo \esc_attr__('Phone Number*', 'must-hotel-booking'); ?>" inputmode="numeric" pattern="[0-9]*" autocomplete="tel-national" required />
                                    </div>
                                </div>

                                <div class="must-checkout-field must-checkout-field-select">
                                    <span class="screen-reader-text"><?php echo \esc_html__('Country of Residence', 'must-hotel-booking'); ?></span>
                                    <div
                                        class="must-checkout-picker must-checkout-picker-country<?php echo $country_picker_has_selection ? '' : ' is-placeholder'; ?>"
                                        data-checkout-picker="1"
                                        data-picker-placeholder="<?php echo \esc_attr($country_picker_placeholder); ?>"
                                    >
                                        <input type="hidden" id="must-checkout-country" name="country" value="<?php echo \esc_attr($selected_country); ?>" data-picker-input="1" />
                                        <button
                                            type="button"
                                            class="must-checkout-picker-toggle"
                                            data-picker-toggle="1"
                                            aria-haspopup="listbox"
                                            aria-expanded="false"
                                            aria-label="<?php echo \esc_attr__('Country of Residence', 'must-hotel-booking'); ?>"
                                        >
                                            <span class="must-checkout-picker-toggle-copy">
                                                <span class="must-checkout-picker-flag<?php echo $country_picker_has_selection ? '' : ' is-hidden'; ?>" data-picker-selected-flag="1"><?php echo \esc_html($country_picker_display_flag); ?></span>
                                                <span class="must-checkout-picker-label" data-picker-selected-label="1"><?php echo \esc_html($country_picker_display_label); ?></span>
                                            </span>
                                            <?php if ($dropdown_icon_url !== '') : ?>
                                                <img class="must-picker-chevron" src="<?php echo \esc_url($dropdown_icon_url); ?>" alt="" aria-hidden="true" />
                                            <?php endif; ?>
                                        </button>
                                        <div class="must-checkout-picker-panel" data-picker-panel="1" hidden>
                                            <div class="must-checkout-picker-search-wrap">
                                                <input
                                                    type="text"
                                                    class="must-checkout-picker-search"
                                                    data-picker-search="1"
                                                    value=""
                                                    placeholder="<?php echo \esc_attr($country_picker_search_placeholder); ?>"
                                                    aria-label="<?php echo \esc_attr($country_picker_search_placeholder); ?>"
                                                />
                                            </div>
                                            <div class="must-checkout-picker-options" role="listbox">
                                                <?php foreach ($country_options as $country_option) : ?>
                                                    <?php
                                                    $country_option_value = isset($country_option['value']) ? (string) $country_option['value'] : '';
                                                    $country_option_code = isset($country_option['code']) ? (string) $country_option['code'] : '';
                                                    $country_option_name = isset($country_option['name']) ? (string) $country_option['name'] : '';
                                                    $country_option_dial_code = isset($country_option['dial_code']) ? (string) $country_option['dial_code'] : '';
                                                    $country_option_flag = isset($country_option['flag']) ? (string) $country_option['flag'] : '';
                                                    $country_option_search = \strtolower(\trim($country_option_code . ' ' . $country_option_name . ' ' . $country_option_dial_code));
                                                    $country_option_is_selected = $country_option_value === $selected_country;
                                                    ?>
                                                    <button
                                                        type="button"
                                                        class="must-checkout-picker-option<?php echo $country_option_is_selected ? ' is-selected' : ''; ?>"
                                                        data-picker-option="1"
                                                        data-value="<?php echo \esc_attr($country_option_value); ?>"
                                                        data-label="<?php echo \esc_attr($country_option_name); ?>"
                                                        data-flag="<?php echo \esc_attr($country_option_flag); ?>"
                                                        data-search="<?php echo \esc_attr($country_option_search); ?>"
                                                        role="option"
                                                        aria-selected="<?php echo $country_option_is_selected ? 'true' : 'false'; ?>"
                                                    >
                                                        <span class="must-checkout-picker-option-flag" aria-hidden="true"><?php echo \esc_html($country_option_flag); ?></span>
                                                        <span class="must-checkout-picker-option-copy">
                                                            <span class="must-checkout-picker-option-title"><?php echo \esc_html($country_option_name); ?></span>
                                                            <span class="must-checkout-picker-option-meta"><?php echo \esc_html(\trim($country_option_code . ' ' . $country_option_dial_code)); ?></span>
                                                        </span>
                                                    </button>
                                                <?php endforeach; ?>
                                                <p class="must-checkout-picker-empty" data-picker-empty="1" hidden><?php echo \esc_html($picker_no_results_label); ?></p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="must-checkout-payment-section">
                            <label class="must-checkout-consent">
                                <input type="checkbox" name="marketing_opt_in" value="1"<?php checked(!empty($guest_form['marketing_opt_in'])); ?> />
                                <span><?php echo \esc_html__('I consent to receive updates about Empire Beach Residence', 'must-hotel-booking'); ?></span>
                            </label>

                            <label class="must-checkout-field must-checkout-field-full must-checkout-field-textarea">
                                <span class="screen-reader-text"><?php echo \esc_html__('Special Requests', 'must-hotel-booking'); ?></span>
                                <textarea name="special_requests" rows="4" placeholder="<?php echo \esc_attr__('Special Requests (Optional)', 'must-hotel-booking'); ?>"><?php echo \esc_textarea((string) ($guest_form['special_requests'] ?? '')); ?></textarea>
                            </label>
                        </div>
                    </div>
                </section>

                <div class="must-checkout-submit-row">
                    <button type="submit" name="must_checkout_action" value="continue_to_confirmation" class="must-checkout-next-step">
                        <span><?php echo \esc_html__('Next Step', 'must-hotel-booking'); ?></span>
                        <?php if ($arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                    </button>
                </div>
            </form>
        <?php endif; ?>
    </div>
</main>
<?php \get_footer(); ?>
<?php \MustHotelBooking\Core\BookingPerformanceMonitor::stopSpan($must_checkout_template_span); ?>
