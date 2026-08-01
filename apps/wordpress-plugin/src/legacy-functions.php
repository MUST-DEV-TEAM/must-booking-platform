<?php

namespace must_hotel_booking;

if (!\function_exists(__NAMESPACE__ . '\format_booking_results_date_range')) {
    function format_booking_results_date_range(...$args)
    {
        return \MustHotelBooking\Frontend\format_booking_results_date_range(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\format_booking_results_selection_summary')) {
    function format_booking_results_selection_summary(...$args)
    {
        return \MustHotelBooking\Frontend\format_booking_results_selection_summary(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\format_booking_room_count_label')) {
    function format_booking_room_count_label(...$args)
    {
        return \MustHotelBooking\Frontend\format_booking_room_count_label(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\format_frontend_money')) {
    function format_frontend_money(...$args)
    {
        return \MustHotelBooking\Frontend\format_frontend_money(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_accommodation_continue_label')) {
    function get_accommodation_continue_label(...$args)
    {
        return \MustHotelBooking\Frontend\get_accommodation_continue_label(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_accommodation_page_view_data')) {
    function get_accommodation_page_view_data(...$args)
    {
        return \MustHotelBooking\Frontend\get_accommodation_page_view_data(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_booking_accommodation_page_url')) {
    function get_booking_accommodation_page_url(...$args)
    {
        return \MustHotelBooking\Frontend\get_booking_accommodation_page_url(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_booking_page_view_data')) {
    function get_booking_page_view_data(...$args)
    {
        return \MustHotelBooking\Frontend\get_booking_page_view_data(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_checkout_default_phone_option_value')) {
    function get_checkout_default_phone_option_value(...$args)
    {
        return \MustHotelBooking\Frontend\get_checkout_default_phone_option_value(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_checkout_page_url')) {
    function get_checkout_page_url(...$args)
    {
        return \MustHotelBooking\Frontend\get_checkout_page_url(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_checkout_page_view_data')) {
    function get_checkout_page_view_data(...$args)
    {
        return \MustHotelBooking\Frontend\get_checkout_page_view_data(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_confirmation_page_view_data')) {
    function get_confirmation_page_view_data(...$args)
    {
        return \MustHotelBooking\Frontend\get_confirmation_page_view_data(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_max_booking_guests_limit')) {
    function get_max_booking_guests_limit(...$args)
    {
        return \MustHotelBooking\Frontend\get_max_booking_guests_limit(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_max_booking_rooms_limit')) {
    function get_max_booking_rooms_limit(...$args)
    {
        return \MustHotelBooking\Frontend\get_max_booking_rooms_limit(...$args);
    }
}

if (!\function_exists(__NAMESPACE__ . '\get_single_room_page_view_data')) {
    function get_single_room_page_view_data(...$args)
    {
        return \MustHotelBooking\Frontend\get_single_room_page_view_data(...$args);
    }
}
