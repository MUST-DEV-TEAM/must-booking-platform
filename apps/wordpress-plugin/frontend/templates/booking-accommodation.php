<?php

if (!\defined('ABSPATH')) {
    exit;
}

$must_accommodation_template_span = \MustHotelBooking\Core\BookingPerformanceMonitor::startSpan('template_render');
$view = \must_hotel_booking\get_accommodation_page_view_data();
$messages = isset($view['messages']) && \is_array($view['messages']) ? $view['messages'] : [];
$rooms = isset($view['rooms']) && \is_array($view['rooms']) ? $view['rooms'] : [];
$has_context = !empty($view['has_context']);
$is_valid = !empty($view['is_valid']);
$checkin = isset($view['checkin']) ? (string) $view['checkin'] : '';
$checkout = isset($view['checkout']) ? (string) $view['checkout'] : '';
$guests = isset($view['guests']) ? (int) $view['guests'] : 1;
$room_count = isset($view['room_count']) ? (int) $view['room_count'] : 0;
$resolved_room_count = isset($view['resolved_room_count']) ? (int) $view['resolved_room_count'] : 1;
$accommodation_type = isset($view['accommodation_type']) ? (string) $view['accommodation_type'] : 'standard-rooms';
$selected_rooms = isset($view['selected_rooms']) && \is_array($view['selected_rooms']) ? $view['selected_rooms'] : [];
$selected_room_count = isset($view['selected_room_count']) ? (int) $view['selected_room_count'] : 0;
$can_continue = !empty($view['can_continue']);
$selection_limit_reached = !empty($view['selection_limit_reached']);
$single_room_mode = !empty($view['single_room_mode']);
$no_rooms_message = isset($view['no_rooms_message']) ? (string) $view['no_rooms_message'] : \__('No rooms are available for the selected dates.', 'must-hotel-booking');
$selection_status_message = isset($view['selection_status_message']) ? (string) $view['selection_status_message'] : '';
$selection_status_tone = isset($view['selection_status_tone']) ? (string) $view['selection_status_tone'] : 'neutral';
$booking_url = isset($view['booking_url']) ? (string) $view['booking_url'] : \home_url('/booking');
$checkout_url = isset($view['checkout_url']) ? (string) $view['checkout_url'] : \home_url('/checkout');
$accommodation_url = isset($view['accommodation_url']) ? (string) $view['accommodation_url'] : \home_url('/booking-accommodation');
$max_booking_rooms = \function_exists('\must_hotel_booking\get_max_booking_rooms_limit') ? \must_hotel_booking\get_max_booking_rooms_limit() : 3;
$max_booking_guests = \function_exists('\must_hotel_booking\get_max_booking_guests_limit')
    ? \must_hotel_booking\get_max_booking_guests_limit()
    : 12;
$arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowRight.svg' : '';
$back_arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowLEFT.svg' : '';
$filter_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/poludown.svg' : '';
$bed_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/bed.svg' : '';
$results_date_range = \function_exists('\must_hotel_booking\format_booking_results_date_range')
    ? \must_hotel_booking\format_booking_results_date_range($checkin, $checkout)
    : \__('Select dates', 'must-hotel-booking');
$results_selection_summary = \function_exists('\must_hotel_booking\format_booking_results_selection_summary')
    ? \must_hotel_booking\format_booking_results_selection_summary($accommodation_type, $guests, $room_count)
    : \__('Standard Rooms / 1 Guests / 1 Room', 'must-hotel-booking');
$selection_target_label = \function_exists('\must_hotel_booking\format_booking_room_count_label')
    ? \must_hotel_booking\format_booking_room_count_label($resolved_room_count)
    : (string) $resolved_room_count;
$continue_label = \function_exists('\must_hotel_booking\get_accommodation_continue_label')
    ? \must_hotel_booking\get_accommodation_continue_label($can_continue, $selected_room_count, $resolved_room_count)
    : \sprintf(
        /* translators: %d is selected room count. */
        \_n('Continue with %d Room', 'Continue with %d Rooms', $selected_room_count, 'must-hotel-booking'),
        $selected_room_count
    );
?>
<?php \get_header(); ?>
<main class="must-hotel-booking-page must-hotel-booking-page-booking must-hotel-booking-page-accommodation must-booking-process-page">
    <div class="must-hotel-booking-container">
        <section class="must-booking-step-header">
            <h1 id="must-booking-step-heading"><?php echo \esc_html__('Available Accommodation', 'must-hotel-booking'); ?></h1>

            <div class="must-booking-stepper-wrap" aria-label="<?php echo \esc_attr__('Booking steps', 'must-hotel-booking'); ?>">
                <div class="must-booking-stepper">
                    <a href="<?php echo \esc_url($booking_url); ?>" class="must-booking-stepper-nav is-back">
                        <?php if ($back_arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($back_arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                        <span><?php echo \esc_html__('Back', 'must-hotel-booking'); ?></span>
                    </a>
                    <a href="<?php echo \esc_url($booking_url); ?>" class="must-booking-stepper-step is-link" data-step="1"><?php echo \esc_html__('Calendar', 'must-hotel-booking'); ?></a>
                    <span class="must-booking-stepper-step is-active" data-step="2"><?php echo \esc_html__('Select Accommodation', 'must-hotel-booking'); ?></span>
                    <span class="must-booking-stepper-step" data-step="3"><?php echo \esc_html__('Guest Information', 'must-hotel-booking'); ?></span>
                    <span class="must-booking-stepper-step" data-step="4"><?php echo \esc_html__('Review & Payment', 'must-hotel-booking'); ?></span>
                    <a
                        id="must-booking-stepper-next"
                        href="<?php echo \esc_url($can_continue ? $checkout_url : '#'); ?>"
                        class="must-booking-stepper-nav is-next<?php echo !$can_continue ? ' is-disabled' : ''; ?>"
                        aria-disabled="<?php echo $can_continue ? 'false' : 'true'; ?>"
                        <?php echo !$can_continue ? 'tabindex="-1"' : ''; ?>
                    >
                        <span><?php echo \esc_html__('Next', 'must-hotel-booking'); ?></span>
                        <?php if ($arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                    </a>
                </div>
            </div>
        </section>

        <div id="must-booking-live-messages" class="must-hotel-booking-messages" <?php echo empty($messages) ? 'hidden' : ''; ?>>
            <?php if (!empty($messages)) : ?>
                <?php foreach ($messages as $message) : ?>
                    <p><?php echo \esc_html((string) $message); ?></p>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <?php if (!$has_context || !$is_valid) : ?>
            <p>
                <a href="<?php echo \esc_url($booking_url); ?>">
                    <?php echo \esc_html__('Return to the calendar to choose valid dates.', 'must-hotel-booking'); ?>
                </a>
            </p>
        <?php else : ?>
            <section id="must-booking-results" class="must-hotel-booking-results">
                <div class="must-booking-results-toolbar">
                    <button type="button" class="must-booking-results-filter" data-filter-target="must-booking-accommodation-dates-panel" aria-expanded="false" aria-controls="must-booking-accommodation-dates-panel">
                        <span><?php echo \esc_html($results_date_range); ?></span>
                        <?php if ($filter_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($filter_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                    </button>

                    <button type="button" class="must-booking-results-filter" data-filter-target="must-booking-accommodation-party-panel" aria-expanded="false" aria-controls="must-booking-accommodation-party-panel">
                        <span><?php echo \esc_html($results_selection_summary); ?></span>
                        <?php if ($filter_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($filter_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                    </button>

                    <div id="must-booking-results-continue-slot">
                        <?php if ($can_continue) : ?>
                            <a href="<?php echo \esc_url($checkout_url); ?>" class="must-booking-results-continue">
                                <span><?php echo \esc_html($continue_label); ?></span>
                                <?php if ($arrow_icon_url !== '') : ?>
                                    <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                <?php endif; ?>
                            </a>
                        <?php endif; ?>
                    </div>
                </div>

                <p
                    id="must-booking-results-selection-note"
                    class="must-booking-results-selection-note<?php echo $selection_status_message === '' ? ' is-hidden' : ''; ?><?php echo $selection_status_tone !== '' ? ' is-' . \esc_attr($selection_status_tone) : ''; ?>"
                >
                    <?php echo \esc_html($selection_status_message); ?>
                </p>

                <div class="must-booking-results-filter-panels">
                    <form
                        id="must-booking-accommodation-dates-panel"
                        class="must-booking-results-filter-panel"
                        method="get"
                        action="<?php echo \esc_url(\must_hotel_booking\get_booking_accommodation_page_url()); ?>"
                        aria-label="<?php echo \esc_attr__('Update stay dates', 'must-hotel-booking'); ?>"
                        hidden
                    >
                        <input type="hidden" name="guests" value="<?php echo \esc_attr((string) $guests); ?>" />
                        <input type="hidden" name="room_count" value="<?php echo \esc_attr((string) $room_count); ?>" />
                        <input type="hidden" name="accommodation_type" value="<?php echo \esc_attr($accommodation_type); ?>" />

                        <div class="must-booking-results-filter-panel-copy">
                            <p class="must-booking-results-filter-panel-kicker"><?php echo \esc_html__('Stay Dates', 'must-hotel-booking'); ?></p>
                            <p class="must-booking-results-filter-panel-title"><?php echo \esc_html($results_date_range); ?></p>
                        </div>

                        <div class="must-booking-results-filter-panel-fields">
                            <label class="must-booking-results-filter-field">
                                <span><?php echo \esc_html__('Check-in', 'must-hotel-booking'); ?></span>
                                <input
                                    type="text"
                                    name="checkin"
                                    class="must-booking-results-filter-date-input must-booking-results-filter-checkin"
                                    value="<?php echo \esc_attr($checkin); ?>"
                                    placeholder="<?php echo \esc_attr__('Check-in', 'must-hotel-booking'); ?>"
                                    autocomplete="off"
                                    inputmode="none"
                                    required
                                />
                            </label>

                            <label class="must-booking-results-filter-field">
                                <span><?php echo \esc_html__('Check-out', 'must-hotel-booking'); ?></span>
                                <input
                                    type="text"
                                    name="checkout"
                                    class="must-booking-results-filter-date-input must-booking-results-filter-checkout"
                                    value="<?php echo \esc_attr($checkout); ?>"
                                    placeholder="<?php echo \esc_attr__('Check-out', 'must-hotel-booking'); ?>"
                                    autocomplete="off"
                                    inputmode="none"
                                    required
                                />
                            </label>
                        </div>

                        <div class="must-booking-results-filter-panel-actions">
                            <button type="submit" class="must-booking-results-filter-apply"><?php echo \esc_html__('Update Results', 'must-hotel-booking'); ?></button>
                        </div>
                    </form>

                    <form
                        id="must-booking-accommodation-party-panel"
                        class="must-booking-results-filter-panel"
                        method="get"
                        action="<?php echo \esc_url(\must_hotel_booking\get_booking_accommodation_page_url()); ?>"
                        aria-label="<?php echo \esc_attr__('Update guest and room details', 'must-hotel-booking'); ?>"
                        hidden
                    >
                        <input type="hidden" name="checkin" value="<?php echo \esc_attr($checkin); ?>" />
                        <input type="hidden" name="checkout" value="<?php echo \esc_attr($checkout); ?>" />
                        <input type="hidden" name="accommodation_type" value="<?php echo \esc_attr($accommodation_type); ?>" />

                        <div class="must-booking-results-filter-panel-copy">
                            <p class="must-booking-results-filter-panel-kicker"><?php echo \esc_html__('Guest Setup', 'must-hotel-booking'); ?></p>
                            <p class="must-booking-results-filter-panel-title"><?php echo \esc_html($results_selection_summary); ?></p>
                        </div>

                        <div class="must-booking-results-filter-panel-fields">
                            <label class="must-booking-results-filter-field">
                                <span><?php echo \esc_html__('Guests', 'must-hotel-booking'); ?></span>
                                <select name="guests">
                                    <?php for ($guest_option = 1; $guest_option <= $max_booking_guests; $guest_option++) : ?>
                                        <option value="<?php echo \esc_attr((string) $guest_option); ?>" <?php selected($guests, $guest_option); ?>>
                                            <?php echo \esc_html((string) $guest_option); ?>
                                        </option>
                                    <?php endfor; ?>
                                </select>
                            </label>

                            <label class="must-booking-results-filter-field">
                                <span><?php echo \esc_html__('Rooms', 'must-hotel-booking'); ?></span>
                                <select name="room_count">
                                    <option value="0" <?php selected($room_count, 0); ?>><?php echo \esc_html__('Auto', 'must-hotel-booking'); ?></option>
                                    <?php for ($room_option = 1; $room_option <= $max_booking_rooms; $room_option++) : ?>
                                        <option value="<?php echo \esc_attr((string) $room_option); ?>" <?php selected($room_count, $room_option); ?>>
                                            <?php echo \esc_html(\must_hotel_booking\format_booking_room_count_label($room_option)); ?>
                                        </option>
                                    <?php endfor; ?>
                                </select>
                            </label>
                        </div>

                        <div class="must-booking-results-filter-panel-actions">
                            <button type="submit" class="must-booking-results-filter-apply"><?php echo \esc_html__('Update Results', 'must-hotel-booking'); ?></button>
                        </div>
                    </form>
                </div>

                <?php if (empty($rooms)) : ?>
                    <p id="must-booking-no-rooms-message">
                        <?php echo \esc_html($no_rooms_message); ?>
                    </p>
                <?php else : ?>
                    <div id="must-booking-room-list" class="must-hotel-booking-room-list">
                        <?php foreach ($rooms as $room) : ?>
                            <?php
                            $room_id = isset($room['id']) ? (int) $room['id'] : 0;
                            $room_type_id = isset($room['room_type_id']) ? (int) $room['room_type_id'] : $room_id;
                            $inventory_room_id = isset($room['physical_room_id']) ? (int) $room['physical_room_id'] : 0;
                            $room_name = isset($room['name']) ? (string) $room['name'] : '';
                            $room_description = isset($room['description']) ? (string) $room['description'] : '';
                            $max_guests = isset($room['max_guests']) ? (int) $room['max_guests'] : 0;
                            $room_size = isset($room['room_size']) ? (string) $room['room_size'] : '';
                            $beds = isset($room['beds']) ? (string) $room['beds'] : '';
                            $view_type = isset($room['view_type']) ? (string) $room['view_type'] : '';
                            $floor = isset($room['floor']) ? (int) $room['floor'] : 0;
                            $base_price = isset($room['base_price']) ? (float) $room['base_price'] : 0.0;
                            $available_count = isset($room['available_count']) ? (int) $room['available_count'] : 0;
                            $currency = isset($room['currency']) ? (string) $room['currency'] : 'USD';
                            $primary_image_url = isset($room['primary_image_url']) ? (string) $room['primary_image_url'] : '';
                            $gallery_images = isset($room['gallery_images']) && \is_array($room['gallery_images']) ? $room['gallery_images'] : [];
                            $lightbox_images = isset($room['lightbox_images']) && \is_array($room['lightbox_images']) ? $room['lightbox_images'] : [];
                            $room_rules = isset($room['room_rules']) ? (string) $room['room_rules'] : '';
                            $amenities = isset($room['amenities']) && \is_array($room['amenities']) ? $room['amenities'] : [];
                            $people_icon_url = isset($room['people_icon_url']) ? (string) $room['people_icon_url'] : '';
                            $surface_icon_url = isset($room['surface_icon_url']) ? (string) $room['surface_icon_url'] : '';
                            $is_selected = !empty($room['is_selected']);
                            $selected_rate_plan_id = isset($room['selected_rate_plan_id']) ? (int) $room['selected_rate_plan_id'] : 0;
                            $rate_plans = isset($room['rate_plans']) && \is_array($room['rate_plans']) ? $room['rate_plans'] : [];
                            $primary_rate_plan = [];
                            $lightbox_json = \wp_json_encode($lightbox_images);
                            $lightbox_attr = \is_string($lightbox_json) ? \esc_attr($lightbox_json) : '[]';
                            $room_rules_lines = \preg_split('/\r\n|\r|\n/', $room_rules) ?: [];
                            $room_rules_lines = \array_values(
                                \array_filter(
                                    \array_map(
                                        static function ($line): string {
                                            return \trim((string) $line);
                                        },
                                        $room_rules_lines
                                    ),
                                    static function (string $line): bool {
                                        return $line !== '';
                                    }
                                )
                            );

                            if (empty($room_rules_lines) && $room_rules !== '') {
                                $room_rules_lines[] = $room_rules;
                            }

                            if (!empty($rate_plans)) {
                                foreach ($rate_plans as $rate_plan_option) {
                                    if (!\is_array($rate_plan_option)) {
                                        continue;
                                    }

                                    if (
                                        $selected_rate_plan_id > 0
                                        && (int) ($rate_plan_option['id'] ?? 0) === $selected_rate_plan_id
                                    ) {
                                        $primary_rate_plan = $rate_plan_option;
                                        break;
                                    }
                                }

                                if (empty($primary_rate_plan) && \is_array($rate_plans[0] ?? null)) {
                                    $primary_rate_plan = $rate_plans[0];
                                }
                            }

                            $nightly_price = \must_hotel_booking\format_frontend_money($base_price, $currency);
                            ?>
                            <div class="must-booking-accommodation-room-entry">
                                <article
                                    class="must-hotel-booking-room-card must-booking-accommodation-room-card<?php echo $is_selected ? ' is-selected' : ''; ?>"
                                    data-room-id="<?php echo \esc_attr((string) $room_id); ?>"
                                    data-lightbox-images="<?php echo $lightbox_attr; ?>"
                                    data-lightbox-title="<?php echo \esc_attr($room_name); ?>"
                                >
                                    <div class="must-booking-room-media">
                                        <?php if ($primary_image_url !== '') : ?>
                                            <button type="button" class="must-booking-room-image-trigger must-booking-room-image-trigger-main" data-lightbox-index="0">
                                                <img src="<?php echo \esc_url($primary_image_url); ?>" alt="<?php echo \esc_attr($room_name); ?>" loading="lazy" />
                                            </button>
                                        <?php else : ?>
                                            <div class="must-booking-room-media-placeholder"><?php echo \esc_html__('Image unavailable', 'must-hotel-booking'); ?></div>
                                        <?php endif; ?>
                                    </div>

                                    <div class="must-booking-room-content">
                                        <div class="must-booking-room-section must-booking-room-section-copy">
                                            <div class="must-booking-room-header">
                                                <h3><?php echo \esc_html($room_name !== '' ? $room_name : __('Room', 'must-hotel-booking')); ?></h3>

                                                <?php if ($available_count > 0) : ?>
                                                    <p class="must-booking-room-availability">
                                                        <?php
                                                        echo \esc_html(
                                                            \sprintf(
                                                                \_n('%d available', '%d available', $available_count, 'must-hotel-booking'),
                                                                $available_count
                                                            )
                                                        );
                                                        ?>
                                                    </p>
                                                <?php endif; ?>

                                                <?php if ($room_description !== '') : ?>
                                                    <p class="must-booking-room-description"><?php echo \esc_html($room_description); ?></p>
                                                <?php endif; ?>
                                            </div>
                                        </div>

                                        <div class="must-booking-room-section must-booking-room-section-media">
                                            <div class="must-booking-room-thumbs">
                                                <?php if (!empty($gallery_images)) : ?>
                                                    <?php foreach (\array_slice($gallery_images, 0, 3) as $gallery_image) : ?>
                                                        <?php
                                                        $gallery_image = (string) $gallery_image;
                                                        $thumb_index = \array_search($gallery_image, $lightbox_images, true);
                                                        $thumb_index = $thumb_index === false ? 0 : (int) $thumb_index;
                                                        ?>
                                                        <button type="button" class="must-booking-room-thumb must-booking-room-image-trigger" data-lightbox-index="<?php echo \esc_attr((string) $thumb_index); ?>">
                                                            <img src="<?php echo \esc_url($gallery_image); ?>" alt="" loading="lazy" />
                                                        </button>
                                                    <?php endforeach; ?>
                                                <?php endif; ?>

                                                <?php if (\count($gallery_images) < 3) : ?>
                                                    <?php for ($i = \count($gallery_images); $i < 3; $i++) : ?>
                                                        <span class="must-booking-room-thumb is-placeholder" aria-hidden="true"></span>
                                                    <?php endfor; ?>
                                                <?php endif; ?>
                                            </div>
                                        </div>

                                        <div class="must-booking-room-section must-booking-room-section-actions">
                                            <div class="must-booking-room-actions">
                                                <?php if (!empty($primary_rate_plan)) : ?>
                                                    <?php
                                                    $primary_rate_plan_id = isset($primary_rate_plan['id']) ? (int) $primary_rate_plan['id'] : 0;
                                                    $room_button_action = $is_selected ? 'remove_selected_room' : 'select_room';
                                                    $room_button_nonce = $is_selected
                                                        ? \wp_create_nonce('must_accommodation_remove_room_' . $room_id)
                                                        : \wp_create_nonce('must_accommodation_select_room');
                                                    $room_button_label = $is_selected
                                                        ? __('Remove Selection', 'must-hotel-booking')
                                                        : ($selection_limit_reached && !$single_room_mode
                                                            ? __('Selection Full', 'must-hotel-booking')
                                                            : __('Select', 'must-hotel-booking'));
                                                    $room_button_show_arrow = !$is_selected && !(!$is_selected && !$single_room_mode && $selection_limit_reached);
                                                    ?>
                                                    <form
                                                        class="must-hotel-booking-select-room-form"
                                                        method="post"
                                                        action="<?php echo \esc_url($accommodation_url); ?>"
                                                        data-room-id="<?php echo \esc_attr((string) $room_id); ?>"
                                                        data-rate-plan-id="<?php echo \esc_attr((string) $primary_rate_plan_id); ?>"
                                                        data-select-nonce="<?php echo \esc_attr(\wp_create_nonce('must_accommodation_select_room')); ?>"
                                                        data-remove-nonce="<?php echo \esc_attr(\wp_create_nonce('must_accommodation_remove_room_' . $room_id)); ?>"
                                                    >
                                                        <input type="hidden" name="must_accommodation_nonce" value="<?php echo \esc_attr($room_button_nonce); ?>" />
                                                        <input type="hidden" name="must_accommodation_action" value="<?php echo \esc_attr($room_button_action); ?>" />
                                                        <input type="hidden" name="room_id" value="<?php echo \esc_attr((string) ($inventory_room_id > 0 ? $room_type_id : $room_id)); ?>" />
                                                        <?php if ($inventory_room_id > 0) : ?>
                                                            <input type="hidden" name="inventory_room_id" value="<?php echo \esc_attr((string) $inventory_room_id); ?>" />
                                                        <?php endif; ?>
                                                        <input type="hidden" name="rate_plan_id" value="<?php echo \esc_attr((string) $primary_rate_plan_id); ?>" />
                                                        <input type="hidden" name="must_room_type_id" value="<?php echo \esc_attr((string) ($room['must_room_type_uuid'] ?? '')); ?>" />
                                                        <input type="hidden" name="must_room_id" value="<?php echo \esc_attr((string) ($room['must_room_uuid'] ?? '')); ?>" />
                                                        <input type="hidden" name="must_rate_plan_id" value="<?php echo \esc_attr((string) ($primary_rate_plan['must_rate_plan_uuid'] ?? '')); ?>" />
                                                        <input type="hidden" name="checkin" value="<?php echo \esc_attr($checkin); ?>" />
                                                        <input type="hidden" name="checkout" value="<?php echo \esc_attr($checkout); ?>" />
                                                        <input type="hidden" name="guests" value="<?php echo \esc_attr((string) $guests); ?>" />
                                                        <input type="hidden" name="room_count" value="<?php echo \esc_attr((string) $room_count); ?>" />
                                                        <input type="hidden" name="accommodation_type" value="<?php echo \esc_attr($accommodation_type); ?>" />
                                                        <button
                                                            type="submit"
                                                            class="must-booking-room-book-button<?php echo $is_selected ? ' is-selected' : ''; ?>"
                                                            <?php disabled(!$is_selected && !$single_room_mode && $selection_limit_reached); ?>
                                                        >
                                                            <span><?php echo \esc_html($room_button_label); ?></span>
                                                            <?php if ($arrow_icon_url !== '') : ?>
                                                                <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" <?php echo !$room_button_show_arrow ? 'hidden' : ''; ?> />
                                                            <?php endif; ?>
                                                        </button>
                                                    </form>
                                                <?php endif; ?>

                                                <button
                                                    type="button"
                                                    class="must-booking-room-details must-booking-room-modal-trigger"
                                                    data-room-inline-details-id="must-booking-room-inline-details-<?php echo \esc_attr((string) $room_id); ?>"
                                                    aria-expanded="false"
                                                    aria-controls="must-booking-room-inline-details-<?php echo \esc_attr((string) $room_id); ?>"
                                                >
                                                    <span><?php echo \esc_html__('Additional Details', 'must-hotel-booking'); ?></span>
                                                    <?php if ($bed_icon_url !== '') : ?>
                                                        <img src="<?php echo \esc_url($bed_icon_url); ?>" alt="" aria-hidden="true" />
                                                    <?php endif; ?>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </article>

                                <section id="must-booking-room-inline-details-<?php echo \esc_attr((string) $room_id); ?>" class="must-booking-room-inline-details" hidden>
                                    <div class="must-booking-room-inline-details-inner">
                                        <button type="button" class="must-booking-room-inline-details-close" data-room-inline-details-close="1" aria-label="<?php echo \esc_attr__('Close additional details', 'must-hotel-booking'); ?>"></button>
                                        <div class="must-booking-room-popup-layout">
                                            <div class="must-booking-room-popup-main">
                                                <?php if ($max_guests > 0 || $room_size !== '' || $beds !== '' || $view_type !== '' || $floor !== 0) : ?>
                                                    <div class="must-booking-room-popup-meta">
                                                        <?php if ($max_guests > 0) : ?>
                                                            <p>
                                                                <?php if ($people_icon_url !== '') : ?>
                                                                    <img src="<?php echo \esc_url($people_icon_url); ?>" alt="" aria-hidden="true" />
                                                                <?php endif; ?>
                                                                <span>
                                                                    <?php
                                                                    echo \esc_html(
                                                                        \sprintf(
                                                                            /* translators: %d is guest capacity. */
                                                                            __('%d Guests', 'must-hotel-booking'),
                                                                            $max_guests
                                                                        )
                                                                    );
                                                                    ?>
                                                                </span>
                                                            </p>
                                                        <?php endif; ?>

                                                        <?php if ($room_size !== '') : ?>
                                                            <p>
                                                                <?php if ($surface_icon_url !== '') : ?>
                                                                    <img src="<?php echo \esc_url($surface_icon_url); ?>" alt="" aria-hidden="true" />
                                                                <?php endif; ?>
                                                                <span><?php echo \esc_html($room_size); ?></span>
                                                            </p>
                                                        <?php endif; ?>
                                                        <?php if ($beds !== '') : ?>
                                                            <p><span><?php echo \esc_html($beds); ?></span></p>
                                                        <?php endif; ?>
                                                        <?php if ($view_type !== '') : ?>
                                                            <p><span><?php echo \esc_html($view_type); ?></span></p>
                                                        <?php endif; ?>
                                                        <?php if ($floor !== 0) : ?>
                                                            <p><span><?php echo \esc_html(\sprintf(__('Floor %d', 'must-hotel-booking'), $floor)); ?></span></p>
                                                        <?php endif; ?>
                                                    </div>
                                                <?php endif; ?>

                                                <?php if (!empty($room_rules_lines)) : ?>
                                                    <section class="must-booking-room-popup-section">
                                                        <h3><?php echo \esc_html__('Room Rules', 'must-hotel-booking'); ?></h3>
                                                        <ul class="must-booking-room-popup-rules">
                                                            <?php foreach ($room_rules_lines as $room_rules_line) : ?>
                                                                <li><?php echo \esc_html($room_rules_line); ?></li>
                                                            <?php endforeach; ?>
                                                        </ul>
                                                    </section>
                                                <?php endif; ?>

                                                <section class="must-booking-room-popup-section">
                                                    <h3><?php echo \esc_html($nightly_price . '/Night'); ?></h3>
                                                    <p><?php echo \esc_html__('Including Taxes & Fees', 'must-hotel-booking'); ?></p>
                                                </section>
                                            </div>

                                            <div class="must-booking-room-popup-side">
                                                <?php if (!empty($amenities)) : ?>
                                                    <section class="must-booking-room-popup-section">
                                                        <h3><?php echo \esc_html__('Amenities', 'must-hotel-booking'); ?></h3>
                                                        <div class="must-booking-room-popup-amenities">
                                                            <?php foreach ($amenities as $amenity) : ?>
                                                                <?php
                                                                $amenity_label = isset($amenity['label']) ? (string) $amenity['label'] : '';
                                                                $amenity_icon = isset($amenity['icon']) ? (string) $amenity['icon'] : '';
                                                                if ($amenity_label === '') {
                                                                    continue;
                                                                }
                                                                ?>
                                                                <div class="must-booking-room-popup-amenity">
                                                                    <span class="must-booking-room-popup-amenity-icon">
                                                                        <?php if ($amenity_icon !== '') : ?>
                                                                            <img src="<?php echo \esc_url($amenity_icon); ?>" alt="" aria-hidden="true" />
                                                                        <?php endif; ?>
                                                                    </span>
                                                                    <span><?php echo \esc_html($amenity_label); ?></span>
                                                                </div>
                                                            <?php endforeach; ?>
                                                        </div>
                                                    </section>
                                                <?php endif; ?>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </section>
        <?php endif; ?>
    </div>
</main>
<?php \get_footer(); ?>
<?php \MustHotelBooking\Core\BookingPerformanceMonitor::stopSpan($must_accommodation_template_span); ?>
