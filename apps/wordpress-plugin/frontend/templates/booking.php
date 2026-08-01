<?php

if (!\defined('ABSPATH')) {
    exit;
}

$must_booking_template_span = \MustHotelBooking\Core\BookingPerformanceMonitor::startSpan('template_render');
$view = \must_hotel_booking\get_booking_page_view_data();
$messages = isset($view['messages']) && \is_array($view['messages']) ? $view['messages'] : [];
$rooms = isset($view['rooms']) && \is_array($view['rooms']) ? $view['rooms'] : [];
$checkin = isset($view['checkin']) ? (string) $view['checkin'] : '';
$checkout = isset($view['checkout']) ? (string) $view['checkout'] : '';
$guests = isset($view['guests']) ? (int) $view['guests'] : 1;
$room_count = isset($view['room_count']) ? (int) $view['room_count'] : 0;
$resolved_room_count = isset($view['resolved_room_count']) ? (int) $view['resolved_room_count'] : 1;
$max_booking_guests = isset($view['max_booking_guests']) ? (int) $view['max_booking_guests'] : 12;
$max_booking_rooms = isset($view['max_booking_rooms']) ? (int) $view['max_booking_rooms'] : 3;
$accommodation_type = isset($view['accommodation_type']) ? (string) $view['accommodation_type'] : 'standard-rooms';
$booking_categories = isset($view['booking_categories']) && \is_array($view['booking_categories']) ? $view['booking_categories'] : [];
$has_search = !empty($view['has_search']);
$is_valid = !empty($view['is_valid']);
$booking_url = isset($view['booking_url']) ? (string) $view['booking_url'] : \home_url('/booking');
$accommodation_url = isset($view['accommodation_url']) ? (string) $view['accommodation_url'] : \home_url('/booking-accommodation');
$checkout_url = isset($view['checkout_url']) ? (string) $view['checkout_url'] : \home_url('/checkout');
$fixed_room_mode = !empty($view['fixed_room_mode']);
$fixed_room_id = isset($view['fixed_room_id']) ? (int) $view['fixed_room_id'] : 0;
$fixed_room = isset($view['fixed_room']) && \is_array($view['fixed_room']) ? $view['fixed_room'] : [];
$fixed_room_name = isset($fixed_room['name']) ? (string) $fixed_room['name'] : '';
$fixed_room_type_id = isset($fixed_room['room_type_id']) ? (int) $fixed_room['room_type_id'] : $fixed_room_id;
$fixed_inventory_room_id = isset($fixed_room['physical_room_id']) ? (int) $fixed_room['physical_room_id'] : 0;
$fixed_room_category_label = isset($fixed_room['category_label']) ? (string) $fixed_room['category_label'] : '';
$fixed_room_description = isset($fixed_room['description']) ? (string) $fixed_room['description'] : '';
$fixed_room_max_guests = isset($fixed_room['max_guests']) ? (int) $fixed_room['max_guests'] : 0;
$fixed_room_room_size = isset($fixed_room['room_size']) ? (string) $fixed_room['room_size'] : '';
$fixed_room_beds = isset($fixed_room['beds']) ? (string) $fixed_room['beds'] : '';
$fixed_room_view_type = isset($fixed_room['view_type']) ? (string) $fixed_room['view_type'] : '';
$fixed_room_floor = isset($fixed_room['floor']) ? (int) $fixed_room['floor'] : 0;
$fixed_room_primary_image_url = isset($fixed_room['primary_image_url']) ? (string) $fixed_room['primary_image_url'] : '';
$calendar_layout = isset($view['calendar_layout']) ? (string) $view['calendar_layout'] : 'two_calendars';
$calendar_layout = \in_array($calendar_layout, ['one_calendar', 'two_calendars'], true) ? $calendar_layout : 'two_calendars';
$calendar_layout_class = $calendar_layout === 'one_calendar' ? ' is-one-calendar' : '';
$form_action_url = $fixed_room_mode ? \must_hotel_booking\get_checkout_page_url() : $accommodation_url;
$show_results_section = false;
$back_arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowLEFT.svg' : '';
$arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowRight.svg' : '';
$filter_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/poludown.svg' : '';
$bed_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/bed.svg' : '';
$contact_url = \home_url('/contact');
$step_heading = \__('Select your dates', 'must-hotel-booking');
$results_date_range = \function_exists('\must_hotel_booking\format_booking_results_date_range')
    ? \must_hotel_booking\format_booking_results_date_range($checkin, $checkout)
    : \__('Select dates', 'must-hotel-booking');
$results_selection_summary = $fixed_room_mode && $fixed_room_name !== ''
    ? \sprintf(
        /* translators: 1: room name, 2: guest count, 3: room count label. */
        \__('%1$s / %2$d Guests / %3$s', 'must-hotel-booking'),
        $fixed_room_name,
        \max(1, $guests),
        \must_hotel_booking\format_booking_room_count_label(1)
    )
    : (\function_exists('\must_hotel_booking\format_booking_results_selection_summary')
    ? \must_hotel_booking\format_booking_results_selection_summary($accommodation_type, $guests, $room_count)
    : \__('Standard Rooms / 1 Guests / 1 Room', 'must-hotel-booking'));

$arrival_day = '--';
$arrival_month = '--';
$departure_day = '--';
$departure_month = '--';

if ($checkin !== '') {
    $checkin_timestamp = \strtotime($checkin . ' 00:00:00');

    if ($checkin_timestamp !== false) {
        $arrival_day = \wp_date('d', $checkin_timestamp);
        $arrival_month = \wp_date('F', $checkin_timestamp);
    }
}

if ($checkout !== '') {
    $checkout_timestamp = \strtotime($checkout . ' 00:00:00');

    if ($checkout_timestamp !== false) {
        $departure_day = \wp_date('d', $checkout_timestamp);
        $departure_month = \wp_date('F', $checkout_timestamp);
    }
}
?>
<?php \get_header(); ?>
<main class="must-hotel-booking-page must-hotel-booking-page-booking must-booking-process-page<?php echo $fixed_room_mode ? ' is-fixed-room-flow' : ''; ?><?php echo \esc_attr($calendar_layout_class); ?>">
    <div class="must-hotel-booking-container">
        <section class="must-booking-step-header">
            <h1 id="must-booking-step-heading"><?php echo \esc_html($step_heading); ?></h1>

            <div class="must-booking-stepper-wrap" aria-label="<?php echo \esc_attr__('Booking steps', 'must-hotel-booking'); ?>">
                <div class="must-booking-stepper">
                    <button type="button" id="must-booking-step-back" class="must-booking-stepper-nav is-back">
                        <?php if ($back_arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($back_arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                        <span><?php echo \esc_html__('Back', 'must-hotel-booking'); ?></span>
                    </button>
                    <span class="must-booking-stepper-step is-active" data-step="1"><?php echo \esc_html__('Calendar', 'must-hotel-booking'); ?></span>
                    <?php if (!$fixed_room_mode) : ?>
                        <span class="must-booking-stepper-step" data-step="2"><?php echo \esc_html__('Select Accommodation', 'must-hotel-booking'); ?></span>
                    <?php endif; ?>
                    <span class="must-booking-stepper-step" data-step="3"><?php echo \esc_html__('Guest Information', 'must-hotel-booking'); ?></span>
                    <span class="must-booking-stepper-step" data-step="4"><?php echo \esc_html__('Review & Payment', 'must-hotel-booking'); ?></span>
                    <button type="button" id="must-booking-step-next" class="must-booking-stepper-nav is-next">
                        <span><?php echo \esc_html__('Next', 'must-hotel-booking'); ?></span>
                        <?php if ($arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                    </button>
                </div>
            </div>
        </section>

        <form id="must-booking-search-form" class="must-booking-calendar-step-form" method="get" action="<?php echo \esc_url($form_action_url); ?>" data-calendar-layout="<?php echo \esc_attr($calendar_layout); ?>">
            <input id="must-booking-checkin" class="must-hotel-booking-checkin" type="hidden" name="checkin" value="<?php echo \esc_attr($checkin); ?>" />
            <input id="must-booking-checkout" class="must-hotel-booking-checkout" type="hidden" name="checkout" value="<?php echo \esc_attr($checkout); ?>" />
            <input id="must-booking-guests" class="must-hotel-booking-guests" type="hidden" name="guests" value="<?php echo \esc_attr((string) $guests); ?>" />
            <input id="must-booking-room-count" class="must-booking-room-count" type="hidden" name="room_count" value="<?php echo \esc_attr((string) ($fixed_room_mode ? 1 : $room_count)); ?>" />
            <?php if ($fixed_room_mode) : ?>
                <input id="must-booking-fixed-room-id" class="must-booking-hidden-room-id" type="hidden" name="room_id" value="<?php echo \esc_attr((string) ($fixed_inventory_room_id > 0 ? $fixed_room_type_id : $fixed_room_id)); ?>" />
                <?php if ($fixed_inventory_room_id > 0) : ?>
                    <input type="hidden" name="inventory_room_id" value="<?php echo \esc_attr((string) $fixed_inventory_room_id); ?>" />
                <?php endif; ?>
                <input type="hidden" name="accommodation_type" value="<?php echo \esc_attr($accommodation_type); ?>" />
            <?php endif; ?>

            <div class="must-booking-calendar-step-grid">
                <section class="must-booking-calendars-panel">
                    <div class="must-booking-calendars-panel-head">
                        <p><?php echo \esc_html__('Select Dates', 'must-hotel-booking'); ?></p>
                    </div>

                    <div class="must-booking-calendars-body">
                        <div class="must-booking-calendar-shell is-checkin">
                            <div class="must-booking-calendar-meta-row">
                                <button id="must-booking-cal-prev" type="button" class="must-booking-cal-shift must-booking-cal-shift-prev" aria-label="<?php echo \esc_attr__('Previous month', 'must-hotel-booking'); ?>">
                                    <?php if ($back_arrow_icon_url !== '') : ?>
                                        <img src="<?php echo \esc_url($back_arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                    <?php endif; ?>
                                </button>

                                <div class="must-booking-calendar-meta">
                                    <select class="must-booking-calendar-month-chip" id="must-booking-checkin-month"></select>
                                    <select class="must-booking-calendar-year-chip" id="must-booking-checkin-year"></select>
                                </div>

                                <button id="must-booking-cal-next-inline" type="button" class="must-booking-cal-shift must-booking-cal-shift-next must-booking-cal-next-inline" aria-label="<?php echo \esc_attr__('Next month', 'must-hotel-booking'); ?>">
                                    <?php if ($arrow_icon_url !== '') : ?>
                                        <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                    <?php endif; ?>
                                </button>
                            </div>

                            <div id="must-booking-checkin-calendar" class="must-booking-inline-calendar"></div>
                        </div>

                        <div class="must-booking-calendar-shell is-checkout">
                            <div class="must-booking-calendar-meta-row">
                                <div class="must-booking-calendar-meta">
                                    <select class="must-booking-calendar-month-chip" id="must-booking-checkout-month"></select>
                                    <select class="must-booking-calendar-year-chip" id="must-booking-checkout-year"></select>
                                </div>

                                <button id="must-booking-cal-next" type="button" class="must-booking-cal-shift must-booking-cal-shift-next" aria-label="<?php echo \esc_attr__('Next month', 'must-hotel-booking'); ?>">
                                    <?php if ($arrow_icon_url !== '') : ?>
                                        <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                    <?php endif; ?>
                                </button>
                            </div>

                            <div id="must-booking-checkout-calendar" class="must-booking-inline-calendar"></div>
                        </div>
                    </div>
                </section>

                <aside class="must-booking-step-summary">
                    <div class="must-booking-step-arrival-departure">
                        <div class="must-booking-step-date-box">
                            <span class="must-booking-step-date-label"><?php echo \esc_html__('Arrival', 'must-hotel-booking'); ?></span>
                            <span id="must-booking-arrival-day" class="must-booking-step-date-day"><?php echo \esc_html($arrival_day); ?></span>
                            <span id="must-booking-arrival-month" class="must-booking-step-date-month"><?php echo \esc_html($arrival_month); ?></span>
                        </div>
                        <div class="must-booking-step-date-box">
                            <span class="must-booking-step-date-label"><?php echo \esc_html__('Departure', 'must-hotel-booking'); ?></span>
                            <span id="must-booking-departure-day" class="must-booking-step-date-day"><?php echo \esc_html($departure_day); ?></span>
                            <span id="must-booking-departure-month" class="must-booking-step-date-month"><?php echo \esc_html($departure_month); ?></span>
                        </div>
                    </div>

                    <?php if ($fixed_room_mode && !empty($fixed_room)) : ?>
                        <section class="must-booking-fixed-room-summary" aria-label="<?php echo \esc_attr__('Selected room', 'must-hotel-booking'); ?>">
                            <div class="must-booking-fixed-room-media">
                                <?php if ($fixed_room_primary_image_url !== '') : ?>
                                    <img src="<?php echo \esc_url($fixed_room_primary_image_url); ?>" alt="<?php echo \esc_attr($fixed_room_name); ?>" loading="lazy" />
                                <?php else : ?>
                                    <div class="must-booking-fixed-room-placeholder"><?php echo \esc_html__('Selected Room', 'must-hotel-booking'); ?></div>
                                <?php endif; ?>
                            </div>

                            <div class="must-booking-fixed-room-copy">
                                <p class="must-booking-fixed-room-kicker"><?php echo \esc_html__('Selected Room', 'must-hotel-booking'); ?></p>
                                <h2><?php echo \esc_html($fixed_room_name); ?></h2>

                                <?php if ($fixed_room_category_label !== '' || $fixed_room_max_guests > 0 || $fixed_room_room_size !== '' || $fixed_room_beds !== '' || $fixed_room_view_type !== '' || $fixed_room_floor !== 0) : ?>
                                    <div class="must-booking-fixed-room-meta">
                                        <?php if ($fixed_room_category_label !== '') : ?>
                                            <span><?php echo \esc_html($fixed_room_category_label); ?></span>
                                        <?php endif; ?>
                                        <?php if ($fixed_room_max_guests > 0) : ?>
                                            <span>
                                                <?php
                                                echo \esc_html(
                                                    \sprintf(
                                                        /* translators: %d is guest capacity. */
                                                        __('Up to %d Guests', 'must-hotel-booking'),
                                                        $fixed_room_max_guests
                                                    )
                                                );
                                                ?>
                                            </span>
                                        <?php endif; ?>
                                        <?php if ($fixed_room_room_size !== '') : ?>
                                            <span><?php echo \esc_html($fixed_room_room_size); ?></span>
                                        <?php endif; ?>
                                        <?php if ($fixed_room_beds !== '') : ?>
                                            <span><?php echo \esc_html($fixed_room_beds); ?></span>
                                        <?php endif; ?>
                                        <?php if ($fixed_room_view_type !== '') : ?>
                                            <span><?php echo \esc_html($fixed_room_view_type); ?></span>
                                        <?php endif; ?>
                                        <?php if ($fixed_room_floor !== 0) : ?>
                                            <span><?php echo \esc_html(\sprintf(__('Floor %d', 'must-hotel-booking'), $fixed_room_floor)); ?></span>
                                        <?php endif; ?>
                                    </div>
                                <?php endif; ?>

                                <?php if ($fixed_room_description !== '') : ?>
                                    <p class="must-booking-fixed-room-description"><?php echo \esc_html($fixed_room_description); ?></p>
                                <?php endif; ?>
                            </div>
                        </section>
                    <?php else : ?>
                        <label class="must-booking-step-select-row" for="must-booking-accommodation-type">
                            <span><?php echo \esc_html__('Accommodation type', 'must-hotel-booking'); ?></span>
                            <select id="must-booking-accommodation-type" name="accommodation_type">
                                <?php foreach ($booking_categories as $category_value => $category_label) : ?>
                                    <option value="<?php echo \esc_attr((string) $category_value); ?>" <?php selected($accommodation_type, (string) $category_value); ?>>
                                        <?php echo \esc_html((string) $category_label); ?>
                                    </option>
                                <?php endforeach; ?>
                            </select>
                        </label>
                    <?php endif; ?>

                    <label class="must-booking-step-select-row" for="must-booking-guests-select">
                        <span><?php echo \esc_html__('Guests', 'must-hotel-booking'); ?></span>
                        <select id="must-booking-guests-select">
                            <?php for ($i = 1; $i <= $max_booking_guests; $i++) : ?>
                                <option value="<?php echo \esc_attr((string) $i); ?>" <?php selected($guests, $i); ?>>
                                    <?php echo \esc_html((string) $i); ?>
                                </option>
                            <?php endfor; ?>
                        </select>
                    </label>

                    <?php if (!$fixed_room_mode) : ?>
                        <label class="must-booking-step-select-row" for="must-booking-room-count-select">
                            <span><?php echo \esc_html__('Rooms', 'must-hotel-booking'); ?></span>
                            <select id="must-booking-room-count-select">
                                <option value="0" <?php selected($room_count, 0); ?>><?php echo \esc_html__('Auto', 'must-hotel-booking'); ?></option>
                                <?php for ($room_option = 1; $room_option <= $max_booking_rooms; $room_option++) : ?>
                                    <option value="<?php echo \esc_attr((string) $room_option); ?>" <?php selected($room_count, $room_option); ?>>
                                        <?php echo \esc_html(\must_hotel_booking\format_booking_room_count_label($room_option)); ?>
                                    </option>
                                <?php endfor; ?>
                            </select>
                        </label>
                    <?php endif; ?>

                    <button type="submit" class="must-booking-check-availability">
                        <span><?php echo \esc_html($fixed_room_mode ? __('Continue to Guest Information', 'must-hotel-booking') : __('Check Availability', 'must-hotel-booking')); ?></span>
                        <?php if ($arrow_icon_url !== '') : ?>
                            <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                        <?php endif; ?>
                    </button>
                </aside>
            </div>

            <div class="must-booking-calendar-legend">
                <span class="must-booking-calendar-legend-item">
                    <span class="must-booking-calendar-legend-box is-selected" aria-hidden="true"></span>
                    <span><?php echo \esc_html__('Selected Dates', 'must-hotel-booking'); ?></span>
                </span>
                <span class="must-booking-calendar-legend-item">
                    <span class="must-booking-calendar-legend-box is-unavailable" aria-hidden="true"></span>
                    <span><?php echo \esc_html__('No Availability', 'must-hotel-booking'); ?></span>
                </span>
            </div>
        </form>

        <div id="must-booking-live-messages" class="must-hotel-booking-messages" <?php echo empty($messages) ? 'hidden' : ''; ?>>
            <?php if (!empty($messages)) : ?>
                <?php foreach ($messages as $message) : ?>
                    <p><?php echo \esc_html((string) $message); ?></p>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <section
            id="must-booking-results"
            class="must-hotel-booking-results"
            <?php if (!$show_results_section) : ?>
                style="display:none;"
            <?php endif; ?>
        >
            <div class="must-booking-results-toolbar">
                <button type="button" id="must-booking-results-edit-dates" class="must-booking-results-filter">
                    <span id="must-booking-results-date-range"><?php echo \esc_html($results_date_range); ?></span>
                    <?php if ($filter_icon_url !== '') : ?>
                        <img src="<?php echo \esc_url($filter_icon_url); ?>" alt="" aria-hidden="true" />
                    <?php endif; ?>
                </button>

                <button type="button" id="must-booking-results-edit-summary" class="must-booking-results-filter">
                    <span id="must-booking-results-selection-summary"><?php echo \esc_html($results_selection_summary); ?></span>
                    <?php if ($filter_icon_url !== '') : ?>
                        <img src="<?php echo \esc_url($filter_icon_url); ?>" alt="" aria-hidden="true" />
                    <?php endif; ?>
                </button>
            </div>

            <p id="must-booking-loading" class="must-hotel-booking-loading" style="display:none;"></p>
            <p id="must-booking-no-rooms-message" <?php if (!($show_results_section && empty($rooms))) : ?>style="display:none;"<?php endif; ?>>
                <?php echo \esc_html__('No rooms are available for the selected dates.', 'must-hotel-booking'); ?>
            </p>
            <div id="must-booking-room-list" class="must-hotel-booking-room-list">
                <?php if ($show_results_section && !empty($rooms)) : ?>
                    <?php foreach ($rooms as $room) : ?>
                        <?php
                        $room_id = isset($room['id']) ? (int) $room['id'] : 0;
                        $room_type_id = isset($room['room_type_id']) ? (int) $room['room_type_id'] : $room_id;
                        $inventory_room_id = isset($room['physical_room_id']) ? (int) $room['physical_room_id'] : 0;
                        $room_name = isset($room['name']) ? (string) $room['name'] : '';
                        $room_description = isset($room['description']) ? (string) $room['description'] : '';
                        $max_guests = isset($room['max_guests']) ? (int) $room['max_guests'] : 0;
                        $available_count = isset($room['available_count']) ? (int) $room['available_count'] : 0;
                        $room_size = isset($room['room_size']) ? (string) $room['room_size'] : '';
                        $beds = isset($room['beds']) ? (string) $room['beds'] : '';
                        $view_type = isset($room['view_type']) ? (string) $room['view_type'] : '';
                        $floor = isset($room['floor']) ? (int) $room['floor'] : 0;
                        $primary_image_url = isset($room['primary_image_url']) ? (string) $room['primary_image_url'] : '';
                        $gallery_images = isset($room['gallery_images']) && \is_array($room['gallery_images']) ? $room['gallery_images'] : [];
                        $details_url = isset($room['details_url']) ? (string) $room['details_url'] : '';
                        $total_preview = isset($room['dynamic_total_price']) && $room['dynamic_total_price'] !== null
                            ? (float) $room['dynamic_total_price']
                            : (isset($room['price_preview_total']) && $room['price_preview_total'] !== null ? (float) $room['price_preview_total'] : null);
                        $rate_plans = isset($room['rate_plans']) && \is_array($room['rate_plans']) ? $room['rate_plans'] : [];
                        ?>
                        <article class="must-hotel-booking-room-card">
                            <div class="must-booking-room-media">
                                <?php if ($primary_image_url !== '') : ?>
                                    <img src="<?php echo \esc_url($primary_image_url); ?>" alt="<?php echo \esc_attr($room_name); ?>" loading="lazy" />
                                <?php else : ?>
                                    <div class="must-booking-room-media-placeholder"><?php echo \esc_html__('Image unavailable', 'must-hotel-booking'); ?></div>
                                <?php endif; ?>
                            </div>

                            <div class="must-booking-room-content">
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

                                    <?php if ($max_guests > 0 || $room_size !== '' || $beds !== '' || $view_type !== '' || $floor !== 0 || $total_preview !== null) : ?>
                                        <div class="must-booking-room-meta">
                                            <?php if ($max_guests > 0) : ?>
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
                                            <?php endif; ?>

                                            <?php if ($room_size !== '') : ?>
                                                <span><?php echo \esc_html($room_size); ?></span>
                                            <?php endif; ?>
                                            <?php if ($beds !== '') : ?>
                                                <span><?php echo \esc_html($beds); ?></span>
                                            <?php endif; ?>
                                            <?php if ($view_type !== '') : ?>
                                                <span><?php echo \esc_html($view_type); ?></span>
                                            <?php endif; ?>
                                            <?php if ($floor !== 0) : ?>
                                                <span><?php echo \esc_html(\sprintf(__('Floor %d', 'must-hotel-booking'), $floor)); ?></span>
                                            <?php endif; ?>

                                            <?php if ($total_preview !== null) : ?>
                                                <span>
                                                    <?php
                                                    $room_currency = isset($room['currency']) ? (string) $room['currency'] : 'USD';
                                                    echo \esc_html(
                                                        \sprintf(
                                                            /* translators: %s is estimated total price. */
                                                            __('Estimated Total: %s', 'must-hotel-booking'),
                                                            \must_hotel_booking\format_frontend_money($total_preview, $room_currency)
                                                        )
                                                    );
                                                    ?>
                                                </span>
                                            <?php endif; ?>
                                        </div>
                                    <?php endif; ?>
                                </div>

                                <div class="must-booking-room-thumbs">
                                    <?php if (!empty($gallery_images)) : ?>
                                        <?php foreach (\array_slice($gallery_images, 0, 3) as $gallery_image) : ?>
                                            <?php $gallery_image = (string) $gallery_image; ?>
                                            <span class="must-booking-room-thumb">
                                                <img src="<?php echo \esc_url($gallery_image); ?>" alt="" loading="lazy" />
                                            </span>
                                        <?php endforeach; ?>
                                    <?php endif; ?>

                                    <?php if (\count($gallery_images) < 3) : ?>
                                        <?php for ($i = \count($gallery_images); $i < 3; $i++) : ?>
                                            <span class="must-booking-room-thumb is-placeholder" aria-hidden="true"></span>
                                        <?php endfor; ?>
                                    <?php endif; ?>
                                </div>

                                <div class="must-booking-room-actions">
                                    <?php if (!empty($rate_plans)) : ?>
                                        <div class="must-booking-room-rate-plans">
                                            <?php foreach ($rate_plans as $rate_plan) : ?>
                                                <?php
                                                if (!\is_array($rate_plan)) {
                                                    continue;
                                                }

                                                $rate_plan_id = isset($rate_plan['id']) ? (int) $rate_plan['id'] : 0;
                                                $rate_plan_name = isset($rate_plan['name']) ? (string) $rate_plan['name'] : \__('Rate', 'must-hotel-booking');
                                                $rate_plan_description = isset($rate_plan['description']) ? (string) $rate_plan['description'] : '';
                                                $rate_plan_nightly_price = isset($rate_plan['nightly_price']) ? (float) $rate_plan['nightly_price'] : 0.0;
                                                $rate_plan_total_price = isset($rate_plan['total_price']) ? (float) $rate_plan['total_price'] : 0.0;
                                                ?>
                                                <div class="must-booking-room-rate-plan">
                                                    <div class="must-booking-room-rate-plan-copy">
                                                        <strong><?php echo \esc_html($rate_plan_name); ?></strong>
                                                        <span><?php echo \esc_html(\must_hotel_booking\format_frontend_money($rate_plan_nightly_price, (string) ($room['currency'] ?? 'USD'))); ?></span>
                                                    </div>

                                                    <?php if ($rate_plan_description !== '' || $rate_plan_total_price > 0.0) : ?>
                                                        <div class="must-booking-room-rate-plan-meta">
                                                            <?php if ($rate_plan_description !== '') : ?>
                                                                <p><?php echo \esc_html($rate_plan_description); ?></p>
                                                            <?php endif; ?>
                                                            <?php if ($rate_plan_total_price > 0.0) : ?>
                                                                <p>
                                                                    <?php
                                                                    echo \esc_html(
                                                                        \sprintf(
                                                                            __('Stay Total: %s', 'must-hotel-booking'),
                                                                            \must_hotel_booking\format_frontend_money($rate_plan_total_price, (string) ($room['currency'] ?? 'USD'))
                                                                        )
                                                                    );
                                                                    ?>
                                                                </p>
                                                            <?php endif; ?>
                                                        </div>
                                                    <?php endif; ?>

                                                    <form class="must-hotel-booking-select-room-form" method="post" action="<?php echo \esc_url($booking_url); ?>">
                                                        <?php \wp_nonce_field('must_booking_select_room', 'must_booking_nonce'); ?>
                                                        <input type="hidden" name="must_booking_action" value="select_room" />
                                                        <input type="hidden" name="room_id" value="<?php echo \esc_attr((string) ($inventory_room_id > 0 ? $room_type_id : $room_id)); ?>" />
                                                        <?php if ($inventory_room_id > 0) : ?>
                                                            <input type="hidden" name="inventory_room_id" value="<?php echo \esc_attr((string) $inventory_room_id); ?>" />
                                                        <?php endif; ?>
                                                        <input type="hidden" name="rate_plan_id" value="<?php echo \esc_attr((string) $rate_plan_id); ?>" />
                                                        <input class="must-booking-hidden-checkin" type="hidden" name="checkin" value="<?php echo \esc_attr($checkin); ?>" />
                                                        <input class="must-booking-hidden-checkout" type="hidden" name="checkout" value="<?php echo \esc_attr($checkout); ?>" />
                                                        <input class="must-booking-hidden-guests" type="hidden" name="guests" value="<?php echo \esc_attr((string) $guests); ?>" />
                                                        <input class="must-booking-hidden-accommodation-type" type="hidden" name="accommodation_type" value="<?php echo \esc_attr($accommodation_type); ?>" />
                                                        <button type="submit" class="must-booking-room-book-button">
                                                            <span><?php echo \esc_html__('Book Now', 'must-hotel-booking'); ?></span>
                                                            <?php if ($arrow_icon_url !== '') : ?>
                                                                <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                                                            <?php endif; ?>
                                                        </button>
                                                    </form>
                                                </div>
                                            <?php endforeach; ?>
                                        </div>
                                    <?php endif; ?>

                                    <?php if ($details_url !== '') : ?>
                                        <a class="must-booking-room-details" href="<?php echo \esc_url($details_url); ?>">
                                            <span><?php echo \esc_html__('Additional Details', 'must-hotel-booking'); ?></span>
                                            <?php if ($bed_icon_url !== '') : ?>
                                                <img src="<?php echo \esc_url($bed_icon_url); ?>" alt="" aria-hidden="true" />
                                            <?php endif; ?>
                                        </a>
                                    <?php endif; ?>
                                </div>
                            </div>
                        </article>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>
        </section>

        <section class="must-booking-contact-band">
            <div class="must-booking-contact-copy">
                <h3><?php echo \esc_html__('For More Information', 'must-hotel-booking'); ?></h3>
                <p><?php echo \esc_html__('For inquiries about our services or prices, please leave your email to us and we will be in touch within 24 hours.', 'must-hotel-booking'); ?></p>
            </div>
            <a class="must-booking-contact-link" href="<?php echo \esc_url($contact_url); ?>">
                <span><?php echo \esc_html__('Contact', 'must-hotel-booking'); ?></span>
                <?php if ($arrow_icon_url !== '') : ?>
                    <img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" />
                <?php endif; ?>
            </a>
        </section>
    </div>
</main>
<?php \get_footer(); ?>
<?php \MustHotelBooking\Core\BookingPerformanceMonitor::stopSpan($must_booking_template_span); ?>
