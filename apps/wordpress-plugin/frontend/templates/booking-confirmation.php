<?php
if (!\defined('ABSPATH')) {
    exit;
}
$must_confirmation_template_span = \MustHotelBooking\Core\BookingPerformanceMonitor::startSpan('template_render');
$view = \must_hotel_booking\get_confirmation_page_view_data();
$success = !empty($view['success']);
$is_form_mode = !empty($view['is_form_mode']);
$can_confirm = !empty($view['can_confirm']);
$messages = isset($view['messages']) && \is_array($view['messages']) ? $view['messages'] : [];
$reservations = isset($view['reservations']) && \is_array($view['reservations']) ? $view['reservations'] : [];
$selected_rooms = isset($view['selected_rooms']) && \is_array($view['selected_rooms']) ? $view['selected_rooms'] : [];
$summary = isset($view['summary']) && \is_array($view['summary']) ? $view['summary'] : [];
$billing_form = isset($view['billing_form']) && \is_array($view['billing_form']) ? $view['billing_form'] : [];
$payment_method = isset($view['payment_method']) ? (string) $view['payment_method'] : '';
$payment_methods = isset($view['payment_methods']) && \is_array($view['payment_methods']) ? $view['payment_methods'] : [];
$pending_payment = isset($view['pending_payment']) && \is_array($view['pending_payment']) ? $view['pending_payment'] : [];
$is_pokpay_pending = (string) ($pending_payment['method'] ?? '') === 'pokpay'
    && (string) ($pending_payment['session_id'] ?? '') !== ''
    && !empty($pending_payment['reservation_ids'])
    && (string) ($pending_payment['checkout_mode'] ?? '') === 'embedded_sdk';
$confirmation_cta_label = isset($view['confirmation_cta_label']) ? (string) $view['confirmation_cta_label'] : \__('Confirm reservation', 'must-hotel-booking');
$primary_guest = isset($view['primary_guest']) && \is_array($view['primary_guest']) ? $view['primary_guest'] : null;
$total_price = isset($view['total_price']) ? (float) $view['total_price'] : 0.0;
$status_heading = isset($view['status_heading']) ? (string) $view['status_heading'] : \__('Booking Confirmed', 'must-hotel-booking');
$status_message = isset($view['status_message']) ? (string) $view['status_message'] : '';
$booking_url = isset($view['booking_url']) ? (string) $view['booking_url'] : \home_url('/booking');
$accommodation_url = isset($view['accommodation_url']) ? (string) $view['accommodation_url'] : \home_url('/booking-accommodation');
$checkout_url = isset($view['checkout_url']) ? (string) $view['checkout_url'] : \home_url('/checkout');
$confirmation_url = isset($view['confirmation_url']) ? (string) $view['confirmation_url'] : \home_url('/booking-confirmation');
$fixed_room_mode = !empty($view['fixed_room_mode']);
$applied_coupon_code = isset($view['applied_coupon_code']) ? (string) $view['applied_coupon_code'] : '';
$country_options = isset($view['country_options']) && \is_array($view['country_options']) ? $view['country_options'] : [];
$phone_country_code_options = isset($view['phone_country_code_options']) && \is_array($view['phone_country_code_options']) ? $view['phone_country_code_options'] : [];
$cancellation_review = isset($view['cancellation_review']) && \is_array($view['cancellation_review']) ? $view['cancellation_review'] : [];
$is_cancellation_review_layout = !empty($cancellation_review);
if (!empty($cancellation_review['message'])) {
    $messages = \array_values(\array_filter(
        $messages,
        static function ($message) use ($cancellation_review): bool {
            return (string) $message !== (string) ($cancellation_review['message'] ?? '');
        }
    ));
}
$can_show_cancellation_confirm_form = !empty($cancellation_review['eligible'])
    && empty($cancellation_review['manual_only'])
    && !empty($cancellation_review['execution_ready']);
$cancellation_request_action = isset($_GET['must_action'])
    ? \sanitize_key((string) \wp_unslash($_GET['must_action']))
    : '';
$cancellation_form_action = $cancellation_request_action === 'confirm_cancellation'
    ? 'execute_cancellation'
    : 'prepare_cancellation';
$cancellation_nonce_action = $cancellation_form_action === 'execute_cancellation'
    ? 'must_confirm_cancellation'
    : 'must_prepare_cancellation';
$cancellation_form_url = $confirmation_url;
$cancellation_context_selector = isset($_GET['access_context'])
    ? \sanitize_text_field((string) \wp_unslash($_GET['access_context']))
    : '';
if ((bool) \preg_match('/\A[a-f0-9]{64}\z/i', $cancellation_context_selector)) {
    $cancellation_form_url = \add_query_arg(['access_context' => $cancellation_context_selector], $cancellation_form_url);
}
if ($can_show_cancellation_confirm_form && !empty($reservations)) {
    foreach ($reservations as $reservation) {
        if (!\is_array($reservation)) {
            continue;
        }
        $reservation_status = \sanitize_key((string) ($reservation['status'] ?? ''));
        if (\in_array($reservation_status, ['cancelled', 'completed', 'blocked'], true)) {
            $can_show_cancellation_confirm_form = false;
            break;
        }
    }
}
$arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowRight.svg' : '';
$back_arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowLEFT.svg' : '';
$dropdown_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/poludown.svg' : '';
$summary_currency = 'USD';
$fees_total = isset($summary['fees_total']) ? (float) $summary['fees_total'] : 0.0;
$discount_total = isset($summary['discount_total']) ? (float) $summary['discount_total'] : 0.0;
$room_subtotal = isset($summary['room_subtotal']) ? (float) $summary['room_subtotal'] : 0.0;
$subtotal_before_taxes = $room_subtotal + $fees_total - $discount_total;
$selected_country = isset($billing_form['country']) ? (string) $billing_form['country'] : '';
$selected_phone_country_code = isset($billing_form['phone_country_code']) ? (string) $billing_form['phone_country_code'] : \must_hotel_booking\get_checkout_default_phone_option_value();
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
$success_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/PatchCheckFill.svg' : '';
$success_offer_image_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/imgoffer.jpg' : '';
$paid_success_heading = \__('Thank You!', 'must-hotel-booking');
$paid_success_title = \__('Your payment has been successful', 'must-hotel-booking');
$paid_success_message = \__('Your booking confirmation has been sent to your email.', 'must-hotel-booking');
$confirmed_success_title = \__('Your booking has been successful', 'must-hotel-booking');
$confirmed_success_message = \__('Your booking confirmation has been sent to your email.', 'must-hotel-booking');
$hotel_payment_success_message = \__('Your booking confirmation has been sent to your email. Payment will be collected at the hotel.', 'must-hotel-booking');
$paid_success_cta_label = \__('Book Other', 'must-hotel-booking');
$is_confirmation_success_layout = false;
$confirmation_success_title = $paid_success_title;
$confirmation_success_message = $paid_success_message;
if ($success && !empty($reservations)) {
    $statuses = [];
    $payment_statuses = [];
    foreach ($reservations as $reservation) {
        if (!\is_array($reservation)) {
            continue;
        }
        $statuses[] = \sanitize_key((string) ($reservation['status'] ?? ''));
        $payment_statuses[] = \sanitize_key((string) ($reservation['payment_status'] ?? ''));
    }
    $statuses = \array_values(\array_unique(\array_filter(
        $statuses,
        static function ($status): bool {
            return $status !== '';
        }
    )));
    $payment_statuses = \array_values(\array_unique(\array_filter(
        $payment_statuses,
        static function ($status): bool {
            return $status !== '';
        }
    )));
    $has_paid_payment_status = \count($payment_statuses) === 1 && $payment_statuses[0] === 'paid';
    $has_confirmed_reservations = !empty($statuses);
    foreach ($statuses as $status) {
        if (!\MustHotelBooking\Core\ReservationStatus::isConfirmed((string) $status)) {
            $has_confirmed_reservations = false;
            break;
        }
    }
    $is_confirmation_success_layout = $has_confirmed_reservations;
    if ($has_paid_payment_status) {
        $confirmation_success_title = $paid_success_title;
        $confirmation_success_message = $paid_success_message;
    } elseif (\sanitize_key($payment_method) === 'pay_at_hotel') {
        $confirmation_success_title = $confirmed_success_title;
        $confirmation_success_message = $hotel_payment_success_message;
    } else {
        $confirmation_success_title = $confirmed_success_title;
        $confirmation_success_message = $confirmed_success_message;
    }
}
if (!empty($selected_rooms[0]['room']) && \is_array($selected_rooms[0]['room']) && !empty($selected_rooms[0]['room']['currency'])) {
    $summary_currency = (string) $selected_rooms[0]['room']['currency'];
} elseif (!empty($reservations[0]['currency'])) {
    $summary_currency = (string) $reservations[0]['currency'];
}
$format_money = static function (float $amount, string $currency = 'USD'): string {
    return \must_hotel_booking\format_frontend_money($amount, $currency);
};
$payment_method_icon_urls = \defined('MUST_HOTEL_BOOKING_URL')
    ? [
        'stripe' => MUST_HOTEL_BOOKING_URL . 'assets/img/stripe.svg',
        'pay_at_hotel' => MUST_HOTEL_BOOKING_URL . 'assets/img/CashStack.svg',
    ]
    : [];
$render_payment_method_icon = static function (string $payment_method_key, string $payment_method_label) use ($payment_method_icon_urls): string {
    $payment_method_fallback_letter = \function_exists('mb_substr')
        ? (string) \mb_substr($payment_method_label, 0, 1)
        : (string) \substr($payment_method_label, 0, 1);
    $payment_method_fallback_letter = \function_exists('mb_strtoupper')
        ? (string) \mb_strtoupper($payment_method_fallback_letter)
        : \strtoupper($payment_method_fallback_letter);
    if (isset($payment_method_icon_urls[$payment_method_key]) && $payment_method_icon_urls[$payment_method_key] !== '') {
        return \sprintf(
            '<img class="must-confirmation-payment-option-icon-image must-confirmation-payment-option-icon-image--%1$s" src="%2$s" alt="" aria-hidden="true" />',
            \esc_attr($payment_method_key),
            \esc_url($payment_method_icon_urls[$payment_method_key])
        );
    }
    if ($payment_method_key === 'bank_transfer') {
        return '<svg class="must-confirmation-payment-option-icon-fallback-svg" viewBox="0 0 64 40" aria-hidden="true" focusable="false"><path d="M8 16 32 6l24 10v4H8v-4Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M14 22v10M26 22v10M38 22v10M50 22v10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M8 34h48" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
    }
    return \sprintf(
        '<span class="must-confirmation-payment-option-icon-fallback" aria-hidden="true">%s</span>',
        \esc_html($payment_method_fallback_letter)
    );
};
?>
<?php \get_header(); ?>
<main
    class="must-hotel-booking-page must-hotel-booking-page-booking-confirmation must-booking-process-page<?php echo ($is_confirmation_success_layout || $is_cancellation_review_layout) ? ' is-success-layout' : ''; ?>">
    <div class="must-hotel-booking-container">
        <?php if (!$is_confirmation_success_layout && !$is_cancellation_review_layout): ?>
            <section class="must-booking-step-header">
                <h1><?php echo \esc_html__('Review & Payment', 'must-hotel-booking'); ?></h1>
                <div class="must-booking-stepper-wrap"
                    aria-label="<?php echo \esc_attr__('Booking steps', 'must-hotel-booking'); ?>">
                    <div class="must-booking-stepper">
                        <a href="<?php echo \esc_url($checkout_url); ?>" class="must-booking-stepper-nav is-back">
                            <?php if ($back_arrow_icon_url !== ''): ?>
                                <img src="<?php echo \esc_url($back_arrow_icon_url); ?>" alt="" aria-hidden="true" />
                            <?php endif; ?>
                            <span><?php echo \esc_html__('Back', 'must-hotel-booking'); ?></span>
                        </a>
                        <a href="<?php echo \esc_url($booking_url); ?>" class="must-booking-stepper-step is-link"
                            data-step="1"><?php echo \esc_html__('Calendar', 'must-hotel-booking'); ?></a>
                        <?php if (!$fixed_room_mode): ?>
                            <a href="<?php echo \esc_url($accommodation_url); ?>" class="must-booking-stepper-step is-link"
                                data-step="2"><?php echo \esc_html__('Select Accommodation', 'must-hotel-booking'); ?></a>
                        <?php endif; ?>
                        <a href="<?php echo \esc_url($checkout_url); ?>" class="must-booking-stepper-step is-link"
                            data-step="3"><?php echo \esc_html__('Guest Information', 'must-hotel-booking'); ?></a>
                        <span class="must-booking-stepper-step is-active"
                            data-step="4"><?php echo \esc_html__('Review & Payment', 'must-hotel-booking'); ?></span>
                        <span class="must-booking-stepper-nav is-next" aria-disabled="true">
                            <span><?php echo \esc_html__('Next', 'must-hotel-booking'); ?></span>
                            <?php if ($arrow_icon_url !== ''): ?>
                                <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                            <?php endif; ?>
                        </span>
                    </div>
                </div>
            </section>
        <?php endif; ?>
        <?php if (!empty($messages)): ?>
            <div class="must-hotel-booking-messages">
                <?php foreach ($messages as $message): ?>
                    <p><?php echo \esc_html((string) $message); ?></p>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
        <?php if ($success && !empty($reservations)): ?>
            <?php if (!empty($cancellation_review)): ?>
                <?php
                $cancellation_reservation = isset($reservations[0]) && \is_array($reservations[0]) ? $reservations[0] : [];
                $cancellation_guest_name = \trim((string) ($cancellation_reservation['first_name'] ?? '') . ' ' . (string) ($cancellation_reservation['last_name'] ?? ''));
                $cancellation_checkin = (string) ($cancellation_reservation['checkin'] ?? '');
                $cancellation_checkout = (string) ($cancellation_reservation['checkout'] ?? '');
                $cancellation_nights = 1;
                $cancellation_checkin_time = $cancellation_checkin !== '' ? \strtotime($cancellation_checkin) : false;
                $cancellation_checkout_time = $cancellation_checkout !== '' ? \strtotime($cancellation_checkout) : false;
                if ($cancellation_checkin_time !== false && $cancellation_checkout_time !== false) {
                    $cancellation_nights = \max(1, (int) (($cancellation_checkout_time - $cancellation_checkin_time) / \DAY_IN_SECONDS));
                }
                $cancellation_paid_amount = isset($cancellation_review['paid_amount']) ? (float) $cancellation_review['paid_amount'] : 0.0;
                $cancellation_is_online_eligible = !empty($cancellation_review['eligible']) && empty($cancellation_review['manual_only']);
                $cancellation_heading = $cancellation_is_online_eligible
                    ? \__('Cancel your reservation', 'must-hotel-booking')
                    : \__('Cancellation requires hotel support', 'must-hotel-booking');
                $cancellation_review_message = isset($cancellation_review['message'])
                    ? (string) $cancellation_review['message']
                    : '';
                if ($cancellation_is_online_eligible) {
                    $cancellation_review_message = \__('This reservation is eligible for online cancellation. If you continue, the reservation will be cancelled and you will receive a full refund minus the payment processing fee.', 'must-hotel-booking');
                }
                ?>
                <section class="must-confirmation-paid-success must-cancellation-review-card"
                    aria-labelledby="must-cancellation-review-heading">
                    <div class="must-confirmation-paid-success-copy">
                        <div class="must-confirmation-paid-success-text">
                            <h1 id="must-cancellation-review-heading" class="must-confirmation-paid-success-heading">
                                <?php echo \esc_html($cancellation_heading); ?>
                            </h1>
                            <?php if ($cancellation_review_message !== ''): ?>
                                <p class="must-confirmation-paid-success-message">
                                    <?php echo \esc_html($cancellation_review_message); ?>
                                </p>
                            <?php endif; ?>
                        </div>
                        <?php if ($can_show_cancellation_confirm_form): ?>
                            <div class="must-confirmation-paid-success-actions">
                                <form method="post" action="<?php echo \esc_url($cancellation_form_url); ?>"
                                    class="must-cancellation-confirm-form"
                                    onsubmit="return window.confirm('<?php echo \esc_js(__('Cancellation is final. Cancel this booking now?', 'must-hotel-booking')); ?>');">
                                    <?php \wp_nonce_field($cancellation_nonce_action, 'must_cancellation_nonce'); ?>
                                    <input type="hidden" name="must_confirmation_action" value="<?php echo \esc_attr($cancellation_form_action); ?>" />
                                    <button type="submit" class="must-confirmation-submit must-cancellation-confirm-submit">
                                        <span><?php echo \esc_html__('Cancel reservation', 'must-hotel-booking'); ?></span>
                                        <?php if ($arrow_icon_url !== ''): ?>
                                            <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                        <?php endif; ?>
                                    </button>
                                </form>
                            </div>
                        <?php endif; ?>
                    </div>
                    <?php if ($success_offer_image_url !== ''): ?>
                        <div class="must-confirmation-paid-success-media">
                            <img src="<?php echo \esc_url($success_offer_image_url); ?>"
                                alt="<?php echo \esc_attr__('Hotel terrace view', 'must-hotel-booking'); ?>" />
                        </div>
                    <?php endif; ?>
                </section>
            <?php elseif ($is_confirmation_success_layout): ?>
                <section class="must-confirmation-paid-success" aria-labelledby="must-confirmation-paid-success-heading">
                    <div class="must-confirmation-paid-success-copy">
                        <div class="must-confirmation-paid-success-text">
                            <h1 id="must-confirmation-paid-success-heading" class="must-confirmation-paid-success-heading">
                                <?php echo \esc_html($paid_success_heading); ?>
                            </h1>
                            <p class="must-confirmation-paid-success-title">
                                <?php echo \esc_html($confirmation_success_title); ?>
                            </p>
                            <p class="must-confirmation-paid-success-message">
                                <?php echo \esc_html($confirmation_success_message); ?>
                            </p>
                        </div>
                        <?php if ($success_icon_url !== ''): ?>
                            <div class="must-confirmation-paid-success-icon-wrap" aria-hidden="true">
                                <img class="must-confirmation-paid-success-icon" src="<?php echo \esc_url($success_icon_url); ?>"
                                    alt="" />
                            </div>
                        <?php endif; ?>
                        <div class="must-confirmation-paid-success-actions">
                            <a href="<?php echo \esc_url($booking_url); ?>" class="must-confirmation-paid-success-link">
                                <span><?php echo \esc_html($paid_success_cta_label); ?></span>
                                <?php if ($arrow_icon_url !== ''): ?>
                                    <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                <?php endif; ?>
                            </a>
                        </div>
                    </div>
                    <?php if ($success_offer_image_url !== ''): ?>
                        <div class="must-confirmation-paid-success-media">
                            <img src="<?php echo \esc_url($success_offer_image_url); ?>"
                                alt="<?php echo \esc_attr__('Hotel terrace view', 'must-hotel-booking'); ?>" />
                        </div>
                    <?php endif; ?>
                </section>
            <?php else: ?>
                <section class="must-confirmation-success">
                    <div class="must-confirmation-success-head">
                        <h2><?php echo \esc_html($status_heading); ?></h2>
                        <strong><?php echo \esc_html($format_money($total_price, $summary_currency)); ?></strong>
                    </div>
                    <?php if ($status_message !== ''): ?>
                        <p class="must-confirmation-success-message"><?php echo \esc_html($status_message); ?></p>
                    <?php endif; ?>
                    <?php foreach ($reservations as $reservation): ?>
                        <div class="must-confirmation-success-card">
                            <p><strong><?php echo \esc_html((string) ($reservation['room_name'] ?? __('Room', 'must-hotel-booking'))); ?></strong>
                            </p>
                            <?php if (!empty($reservation['assigned_room_number'])): ?>
                                <p><?php echo \esc_html(\sprintf(__('Assigned Room: %s', 'must-hotel-booking'), (string) $reservation['assigned_room_number'])); ?>
                                </p>
                            <?php endif; ?>
                            <?php if (!empty($reservation['rate_plan_name'])): ?>
                                <p><?php echo \esc_html(\sprintf(__('Rate Plan: %s', 'must-hotel-booking'), (string) $reservation['rate_plan_name'])); ?>
                                </p>
                            <?php endif; ?>
                            <?php if (!empty($reservation['booking_id'])): ?>
                                <p><?php echo \esc_html(\sprintf(__('Booking ID: %s', 'must-hotel-booking'), (string) $reservation['booking_id'])); ?>
                                </p>
                            <?php endif; ?>
                            <p><?php echo \esc_html(\sprintf(__('Stay: %1$s to %2$s', 'must-hotel-booking'), (string) $reservation['checkin'], (string) $reservation['checkout'])); ?>
                            </p>
                            <p><?php echo \esc_html(\sprintf(__('Guests: %d', 'must-hotel-booking'), (int) $reservation['guests'])); ?>
                            </p>
                            <p><?php echo \esc_html(\sprintf(__('Room Total: %s', 'must-hotel-booking'), $format_money((float) $reservation['total_price'], $summary_currency))); ?>
                            </p>
                        </div>
                    <?php endforeach; ?>
                    <?php if (\is_array($primary_guest)): ?>
                        <div class="must-confirmation-success-guest">
                            <h3><?php echo \esc_html__('Guest Details', 'must-hotel-booking'); ?></h3>
                            <p><?php echo \esc_html(\trim((string) $primary_guest['first_name'] . ' ' . (string) $primary_guest['last_name'])); ?>
                            </p>
                            <p><?php echo \esc_html((string) $primary_guest['email']); ?></p>
                            <p><?php echo \esc_html((string) $primary_guest['phone']); ?></p>
                            <p><?php echo \esc_html((string) $primary_guest['country']); ?></p>
                        </div>
                    <?php endif; ?>
                </section>
            <?php endif; ?>
        <?php elseif ($is_form_mode): ?>
            <form method="post" action="<?php echo \esc_url($confirmation_url); ?>" class="must-confirmation-form">
                <?php \wp_nonce_field('must_confirm_booking', 'must_confirmation_nonce'); ?>
                <?php if ($show_honeypot && $honeypot_field_name !== ''): ?>
                    <div style="position:absolute !important;left:-10000px !important;top:auto !important;width:1px !important;height:1px !important;overflow:hidden !important;"
                        aria-hidden="true" role="presentation">
                        <label
                            for="must-confirmation-honeypot"><?php echo \esc_html__('Leave this field empty', 'must-hotel-booking'); ?></label>
                        <input id="must-confirmation-honeypot" type="text" name="<?php echo \esc_attr($honeypot_field_name); ?>"
                            value="" tabindex="-1" autocomplete="new-password" autocapitalize="off" autocorrect="off"
                            spellcheck="false" data-lpignore="true" data-1p-ignore="true" aria-hidden="true" />
                    </div>
                <?php endif; ?>
                <input type="hidden" name="applied_coupon_code" value="<?php echo \esc_attr($applied_coupon_code); ?>" />
                <?php if ($can_confirm): ?>
                    <div class="must-confirmation-layout">
                        <section class="must-confirmation-billing-panel">
                            <div class="must-confirmation-billing-inner">
                                <div class="must-confirmation-billing-section">
                                    <h2><?php echo \esc_html__('Billing Information', 'must-hotel-booking'); ?></h2>
                                    <div class="must-confirmation-form-grid">
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('First Name', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="first_name"
                                                value="<?php echo \esc_attr((string) ($billing_form['first_name'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('First Name*', 'must-hotel-booking'); ?>"
                                                required />
                                        </label>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Last Name', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="last_name"
                                                value="<?php echo \esc_attr((string) ($billing_form['last_name'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('Last Name*', 'must-hotel-booking'); ?>"
                                                required />
                                        </label>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Company Name (Optional)', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="company"
                                                value="<?php echo \esc_attr((string) ($billing_form['company'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('Company Name (Optional)', 'must-hotel-booking'); ?>" />
                                        </label>
                                        <div class="must-confirmation-field must-confirmation-field-select">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Country of Residence', 'must-hotel-booking'); ?></span>
                                            <div class="must-confirmation-picker must-confirmation-picker-country<?php echo $country_picker_has_selection ? '' : ' is-placeholder'; ?>"
                                                data-checkout-picker="1"
                                                data-picker-placeholder="<?php echo \esc_attr($country_picker_placeholder); ?>">
                                                <input type="hidden" name="country"
                                                    value="<?php echo \esc_attr($selected_country); ?>" data-picker-input="1" />
                                                <button type="button" class="must-confirmation-picker-toggle"
                                                    data-picker-toggle="1" aria-haspopup="listbox" aria-expanded="false"
                                                    aria-label="<?php echo \esc_attr__('Country of Residence', 'must-hotel-booking'); ?>">
                                                    <span class="must-confirmation-picker-toggle-copy">
                                                        <span
                                                            class="must-confirmation-picker-flag<?php echo $country_picker_has_selection ? '' : ' is-hidden'; ?>"
                                                            data-picker-selected-flag="1"><?php echo \esc_html($country_picker_display_flag); ?></span>
                                                        <span class="must-confirmation-picker-label"
                                                            data-picker-selected-label="1"><?php echo \esc_html($country_picker_display_label); ?></span>
                                                    </span>
                                                    <?php if ($dropdown_icon_url !== ''): ?>
                                                        <img class="must-picker-chevron"
                                                            src="<?php echo \esc_url($dropdown_icon_url); ?>" alt=""
                                                            aria-hidden="true" />
                                                    <?php endif; ?>
                                                </button>
                                                <div class="must-confirmation-picker-panel" data-picker-panel="1" hidden>
                                                    <div class="must-confirmation-picker-search-wrap">
                                                        <input type="text" class="must-confirmation-picker-search"
                                                            data-picker-search="1" value=""
                                                            placeholder="<?php echo \esc_attr($country_picker_search_placeholder); ?>"
                                                            aria-label="<?php echo \esc_attr($country_picker_search_placeholder); ?>" />
                                                    </div>
                                                    <div class="must-confirmation-picker-options" role="listbox">
                                                        <?php foreach ($country_options as $country_option): ?>
                                                            <?php
                                                            $country_option_value = isset($country_option['value']) ? (string) $country_option['value'] : '';
                                                            $country_option_code = isset($country_option['code']) ? (string) $country_option['code'] : '';
                                                            $country_option_name = isset($country_option['name']) ? (string) $country_option['name'] : '';
                                                            $country_option_dial_code = isset($country_option['dial_code']) ? (string) $country_option['dial_code'] : '';
                                                            $country_option_flag = isset($country_option['flag']) ? (string) $country_option['flag'] : '';
                                                            $country_option_search = \strtolower(\trim($country_option_code . ' ' . $country_option_name . ' ' . $country_option_dial_code));
                                                            $country_option_is_selected = $country_option_value === $selected_country;
                                                            ?>
                                                            <button type="button"
                                                                class="must-confirmation-picker-option<?php echo $country_option_is_selected ? ' is-selected' : ''; ?>"
                                                                data-picker-option="1"
                                                                data-value="<?php echo \esc_attr($country_option_value); ?>"
                                                                data-label="<?php echo \esc_attr($country_option_name); ?>"
                                                                data-flag="<?php echo \esc_attr($country_option_flag); ?>"
                                                                data-search="<?php echo \esc_attr($country_option_search); ?>"
                                                                role="option"
                                                                aria-selected="<?php echo $country_option_is_selected ? 'true' : 'false'; ?>">
                                                                <span class="must-confirmation-picker-option-flag"
                                                                    aria-hidden="true"><?php echo \esc_html($country_option_flag); ?></span>
                                                                <span class="must-confirmation-picker-option-copy">
                                                                    <span
                                                                        class="must-confirmation-picker-option-title"><?php echo \esc_html($country_option_name); ?></span>
                                                                    <span
                                                                        class="must-confirmation-picker-option-meta"><?php echo \esc_html(\trim($country_option_code . ' ' . $country_option_dial_code)); ?></span>
                                                                </span>
                                                            </button>
                                                        <?php endforeach; ?>
                                                        <p class="must-confirmation-picker-empty" data-picker-empty="1" hidden>
                                                            <?php echo \esc_html($picker_no_results_label); ?>
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Street Address', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="street_address"
                                                value="<?php echo \esc_attr((string) ($billing_form['street_address'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('Street Address*', 'must-hotel-booking'); ?>"
                                                required />
                                        </label>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Apartment, Suite, Unit, etc.', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="address_line_2"
                                                value="<?php echo \esc_attr((string) ($billing_form['address_line_2'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('Apartment, Suite, Unit, etc (Optional)', 'must-hotel-booking'); ?>" />
                                        </label>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Town / City', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="city"
                                                value="<?php echo \esc_attr((string) ($billing_form['city'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('Town / City*', 'must-hotel-booking'); ?>"
                                                required />
                                        </label>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('County', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="county"
                                                value="<?php echo \esc_attr((string) ($billing_form['county'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('County*', 'must-hotel-booking'); ?>"
                                                required />
                                        </label>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Postcode / ZIP', 'must-hotel-booking'); ?></span>
                                            <input type="text" name="postcode"
                                                value="<?php echo \esc_attr((string) ($billing_form['postcode'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('Postcode / ZIP*', 'must-hotel-booking'); ?>"
                                                required />
                                        </label>
                                        <div class="must-confirmation-field must-confirmation-field-phone">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Phone Number', 'must-hotel-booking'); ?></span>
                                            <div class="must-confirmation-phone-shell">
                                                <div class="must-confirmation-picker must-confirmation-picker-phone"
                                                    data-checkout-picker="1"
                                                    data-picker-placeholder="<?php echo \esc_attr($phone_picker_display_label); ?>">
                                                    <input type="hidden" name="phone_country_code"
                                                        value="<?php echo \esc_attr((string) ($selected_phone_option['value'] ?? $selected_phone_country_code)); ?>"
                                                        data-picker-input="1" />
                                                    <button type="button" class="must-confirmation-picker-toggle"
                                                        data-picker-toggle="1" aria-haspopup="listbox" aria-expanded="false"
                                                        aria-label="<?php echo \esc_attr__('Phone country code', 'must-hotel-booking'); ?>">
                                                        <span class="must-confirmation-picker-toggle-copy">
                                                            <span class="must-confirmation-picker-flag"
                                                                data-picker-selected-flag="1"><?php echo \esc_html($phone_picker_display_flag); ?></span>
                                                            <span class="must-confirmation-picker-label"
                                                                data-picker-selected-label="1"><?php echo \esc_html($phone_picker_display_label); ?></span>
                                                        </span>
                                                        <?php if ($dropdown_icon_url !== ''): ?>
                                                            <img class="must-picker-chevron"
                                                                src="<?php echo \esc_url($dropdown_icon_url); ?>" alt=""
                                                                aria-hidden="true" />
                                                        <?php endif; ?>
                                                    </button>
                                                    <div class="must-confirmation-picker-panel" data-picker-panel="1" hidden>
                                                        <div class="must-confirmation-picker-search-wrap">
                                                            <input type="text" class="must-confirmation-picker-search"
                                                                data-picker-search="1" value=""
                                                                placeholder="<?php echo \esc_attr($phone_picker_search_placeholder); ?>"
                                                                aria-label="<?php echo \esc_attr($phone_picker_search_placeholder); ?>" />
                                                        </div>
                                                        <div class="must-confirmation-picker-options" role="listbox">
                                                            <?php foreach ($phone_country_code_options as $phone_country_code_option): ?>
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
                                                                <button type="button"
                                                                    class="must-confirmation-picker-option<?php echo $phone_option_is_selected ? ' is-selected' : ''; ?>"
                                                                    data-picker-option="1"
                                                                    data-value="<?php echo \esc_attr($phone_option_value); ?>"
                                                                    data-label="<?php echo \esc_attr($phone_option_display_label); ?>"
                                                                    data-flag="<?php echo \esc_attr($phone_option_flag); ?>"
                                                                    data-search="<?php echo \esc_attr($phone_option_search); ?>"
                                                                    role="option"
                                                                    aria-selected="<?php echo $phone_option_is_selected ? 'true' : 'false'; ?>">
                                                                    <span class="must-confirmation-picker-option-flag"
                                                                        aria-hidden="true"><?php echo \esc_html($phone_option_flag); ?></span>
                                                                    <span class="must-confirmation-picker-option-copy">
                                                                        <span
                                                                            class="must-confirmation-picker-option-title"><?php echo \esc_html($phone_option_country_name); ?></span>
                                                                        <span
                                                                            class="must-confirmation-picker-option-meta"><?php echo \esc_html($phone_option_display_label); ?></span>
                                                                    </span>
                                                                </button>
                                                            <?php endforeach; ?>
                                                            <p class="must-confirmation-picker-empty" data-picker-empty="1"
                                                                hidden><?php echo \esc_html($picker_no_results_label); ?>
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <span class="must-confirmation-phone-divider" aria-hidden="true">|</span>
                                                <input type="text" name="phone_number"
                                                    value="<?php echo \esc_attr((string) ($billing_form['phone_number'] ?? '')); ?>"
                                                    placeholder="<?php echo \esc_attr__('Phone Number*', 'must-hotel-booking'); ?>"
                                                    inputmode="numeric" pattern="[0-9]*" autocomplete="tel-national" required />
                                            </div>
                                        </div>
                                        <label class="must-confirmation-field">
                                            <span
                                                class="screen-reader-text"><?php echo \esc_html__('Email Address', 'must-hotel-booking'); ?></span>
                                            <input type="email" name="email"
                                                value="<?php echo \esc_attr((string) ($billing_form['email'] ?? '')); ?>"
                                                placeholder="<?php echo \esc_attr__('Email Address*', 'must-hotel-booking'); ?>"
                                                required />
                                        </label>
                                    </div>
                                </div>
                                <div class="must-confirmation-special-section">
                                    <label class="must-confirmation-field must-confirmation-field-textarea">
                                        <span
                                            class="screen-reader-text"><?php echo \esc_html__('Special Requests', 'must-hotel-booking'); ?></span>
                                        <textarea name="special_requests" rows="4"
                                            placeholder="<?php echo \esc_attr__('Special Requests (Optional)', 'must-hotel-booking'); ?>"><?php echo \esc_textarea((string) ($billing_form['special_requests'] ?? '')); ?></textarea>
                                    </label>
                                </div>
                            </div>
                        </section>
                        <aside class="must-confirmation-side">
                            <section class="must-confirmation-order-table">
                                <div class="must-confirmation-order-head">
                                    <span><?php echo \esc_html__('Product', 'must-hotel-booking'); ?></span>
                                    <span><?php echo \esc_html__('Subtotal', 'must-hotel-booking'); ?></span>
                                </div>
                                <?php foreach ($selected_rooms as $selected_room_item): ?>
                                    <?php
                                    $room = isset($selected_room_item['room']) && \is_array($selected_room_item['room']) ? $selected_room_item['room'] : [];
                                    $pricing = isset($selected_room_item['pricing']) && \is_array($selected_room_item['pricing']) ? $selected_room_item['pricing'] : [];
                                    $room_name = isset($room['name']) ? (string) $room['name'] : \__('Room', 'must-hotel-booking');
                                    $rate_plan_name = isset($selected_room_item['rate_plan']['name']) ? (string) $selected_room_item['rate_plan']['name'] : '';
                                    $room_currency = isset($room['currency']) ? (string) $room['currency'] : $summary_currency;
                                    $room_total = isset($pricing['total_price']) ? (float) $pricing['total_price'] : (isset($room['dynamic_total_price']) ? (float) $room['dynamic_total_price'] : 0.0);
                                    ?>
                                    <div class="must-confirmation-order-row">
                                        <span>
                                            <?php echo \esc_html($room_name); ?>
                                            <?php if ($rate_plan_name !== ''): ?>
                                                <small><?php echo \esc_html(' - ' . $rate_plan_name); ?></small>
                                            <?php endif; ?>
                                        </span>
                                        <span><?php echo \esc_html($format_money($room_total, $room_currency)); ?></span>
                                    </div>
                                <?php endforeach; ?>
                                <div class="must-confirmation-order-row">
                                    <span><?php echo \esc_html__('Subtotal', 'must-hotel-booking'); ?></span>
                                    <span><?php echo \esc_html($format_money($subtotal_before_taxes, $summary_currency)); ?></span>
                                </div>
                                <?php if ($discount_total > 0.0): ?>
                                    <div class="must-confirmation-order-row">
                                        <span>
                                            <?php
                                            echo \esc_html(
                                                $applied_coupon_code !== ''
                                                ? \sprintf(__('Discount (%s)', 'must-hotel-booking'), \strtoupper($applied_coupon_code))
                                                : __('Discount Used', 'must-hotel-booking')
                                            );
                                            ?>
                                        </span>
                                        <span><?php echo \esc_html('-' . $format_money($discount_total, $summary_currency)); ?></span>
                                    </div>
                                <?php endif; ?>
                                <div class="must-confirmation-order-row is-total">
                                    <span><?php echo \esc_html__('Total', 'must-hotel-booking'); ?></span>
                                    <span><?php echo \esc_html($format_money($total_price, $summary_currency)); ?></span>
                                </div>
                            </section>
                            <section class="must-confirmation-payment-method">
                                <h2><?php echo \esc_html__('Payment Method', 'must-hotel-booking'); ?></h2>
                                <div class="must-confirmation-payment-box">
                                    <div class="must-confirmation-payment-options">
                                        <?php foreach ($payment_methods as $payment_method_key => $payment_method_meta): ?>
                                            <?php
                                            $payment_method_label = isset($payment_method_meta['label']) ? (string) $payment_method_meta['label'] : $payment_method_key;
                                            $payment_method_cta = __('Continue to secure payment', 'must-hotel-booking');
                                            $payment_method_tooltip = $payment_method_key === 'stripe'
                                                ? \__('Pay with Stripe', 'must-hotel-booking')
                                                : ($payment_method_key === 'pokpay'
                                                    ? \__('Pay with PokPay', 'must-hotel-booking')
                                                    : ($payment_method_key === 'pay_at_hotel'
                                                        ? \__('Pay with cash at hotel', 'must-hotel-booking')
                                                        : \sprintf(\__('Pay with %s', 'must-hotel-booking'), $payment_method_label)));
                                            ?>
                                            <label
                                                class="must-confirmation-payment-option must-confirmation-payment-option--<?php echo \esc_attr($payment_method_key); ?>"
                                                title="<?php echo \esc_attr($payment_method_tooltip); ?>">
                                                <input type="radio" name="payment_method"
                                                    value="<?php echo \esc_attr($payment_method_key); ?>"
                                                    data-cta-label="<?php echo \esc_attr($payment_method_cta); ?>"
                                                    aria-label="<?php echo \esc_attr($payment_method_tooltip); ?>" <?php checked($payment_method_key, $payment_method); ?> />
                                                <span class="must-confirmation-payment-option-visual" aria-hidden="true">
                                                    <span class="must-confirmation-payment-option-icon">
                                                        <?php echo $render_payment_method_icon($payment_method_key, $payment_method_label); ?>
                                                    </span>
                                                </span>
                                                <span
                                                    class="screen-reader-text"><?php echo \esc_html($payment_method_tooltip); ?></span>
                                            </label>
                                        <?php endforeach; ?>
                                    </div>
                                </div>

                            </section>
                            <section class="must-confirmation-policy-section">
                                <p class="must-confirmation-policy">
                                    <?php echo \esc_html__('Your personal data will be used to process your order, support your experience throughout this website, and for other purposes described in our privacy policy.', 'must-hotel-booking'); ?>
                                </p>
                            </section>
                            <?php if ($is_pokpay_pending): ?>
                                <section class="must-confirmation-pokpay-checkout"
                                    aria-labelledby="must-confirmation-pokpay-heading">
                                    <h2 id="must-confirmation-pokpay-heading">
                                        <?php echo \esc_html__('Secure PokPay payment', 'must-hotel-booking'); ?>
                                    </h2>
                                    <p class="must-confirmation-policy" data-pokpay-status>
                                        <?php echo \esc_html__('Loading secure PokPay checkout...', 'must-hotel-booking'); ?>
                                    </p>
                                    <div id="pok-payment-container" class="must-confirmation-pokpay-container"></div>
                                </section>
                            <?php else: ?>
                                <section class="must-confirmation-action">
                                    <button type="submit" name="must_confirmation_action" value="confirm_booking"
                                        class="must-confirmation-submit">
                                        <span><?php echo \esc_html($confirmation_cta_label); ?></span>
                                        <?php if ($arrow_icon_url !== ''): ?>
                                            <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                        <?php endif; ?>
                                    </button>
                                </section>
                            <?php endif; ?>
                        </aside>
                    </div>
                <?php else: ?>
                    <p><a
                            href="<?php echo \esc_url($checkout_url); ?>"><?php echo \esc_html__('Back to Guest Information', 'must-hotel-booking'); ?></a>
                    </p>
                <?php endif; ?>
            </form>
        <?php else: ?>
            <p><?php echo \esc_html((string) ($view['message'] ?? __('Reservation details are unavailable.', 'must-hotel-booking'))); ?>
            </p>
        <?php endif; ?>
    </div>
</main>
<?php \get_footer(); ?>
<?php \MustHotelBooking\Core\BookingPerformanceMonitor::stopSpan($must_confirmation_template_span); ?>
