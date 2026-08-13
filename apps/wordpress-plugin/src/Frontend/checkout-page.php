<?php
namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustApiClient;

/** Handle the guest-information form submission before any output. Stores contact details and advances to the Review & Payment step. */
function maybe_process_checkout_submission(): string
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return '';
    $action = isset($_POST['must_checkout_action']) ? \sanitize_key((string) $_POST['must_checkout_action']) : '';
    if ($action !== 'continue_to_confirmation') return '';
    if (!isset($_POST['must_checkout_nonce']) || !\wp_verify_nonce((string) \wp_unslash($_POST['must_checkout_nonce']), 'must_checkout_complete')) {
        return \__('Your request could not be verified. Please try again.', 'must-hotel-booking');
    }
    $selection = get_current_booking_selection();
    if ($selection === null) {
        \wp_safe_redirect(get_booking_accommodation_page_url());
        exit;
    }

    $firstName = isset($_POST['first_name']) ? \sanitize_text_field((string) \wp_unslash($_POST['first_name'])) : '';
    $lastName = isset($_POST['last_name']) ? \sanitize_text_field((string) \wp_unslash($_POST['last_name'])) : '';
    $email = isset($_POST['email']) ? \sanitize_email((string) \wp_unslash($_POST['email'])) : '';
    $phoneCountryCode = isset($_POST['phone_country_code']) ? \sanitize_text_field((string) \wp_unslash($_POST['phone_country_code'])) : '';
    $phoneNumber = isset($_POST['phone_number']) ? \sanitize_text_field((string) \wp_unslash($_POST['phone_number'])) : '';
    $country = isset($_POST['country']) ? \sanitize_text_field((string) \wp_unslash($_POST['country'])) : '';
    $specialRequests = isset($_POST['special_requests']) ? \sanitize_textarea_field((string) \wp_unslash($_POST['special_requests'])) : '';
    if ($firstName === '' || $lastName === '' || $email === '') {
        return \__('Please fill in your name and email to continue.', 'must-hotel-booking');
    }

    $selection['guestInfo'] = [
        'firstName' => $firstName, 'lastName' => $lastName, 'email' => $email,
        'phoneCountryCode' => $phoneCountryCode, 'phoneNumber' => $phoneNumber, 'country' => $country,
        'specialRequests' => $specialRequests,
    ];
    set_current_booking_selection($selection);
    \wp_safe_redirect(ManagedPages::getBookingConfirmationPageUrl());
    exit;
}

/** @return array<string, mixed> */
function get_checkout_page_view_data(): array
{
    $error = maybe_process_checkout_submission();
    $messages = $error !== '' ? [$error] : [];
    $selection = get_current_booking_selection();
    $isValid = $selection !== null;

    $selectedRooms = [];
    $summary = [];
    if ($isValid) {
        $quote = $selection['quote'];
        $start = new \DateTimeImmutable((string) $selection['checkin']);
        $end = new \DateTimeImmutable((string) $selection['checkout']);
        $nights = \max(1, (int) $start->diff($end)->days);
        $total = (float) $quote['total']['amount'];
        $selectedRooms[] = [
            'room_id' => 1,
            'room' => ['name' => (string) $selection['roomName'], 'currency' => (string) $quote['total']['currency'], 'max_guests' => 0, 'primary_image_url' => ''],
            'pricing' => [
                'total_price' => $total, 'nights' => $nights, 'fees_total' => 0.0,
                'discount_total' => 0.0, 'taxes_total' => 0.0, 'room_subtotal' => $total,
                'nightly_rates' => isset($quote['nightlyRates']) && \is_array($quote['nightlyRates'])
                    ? $quote['nightlyRates']
                    : [],
            ],
            'rate_plan' => ['name' => (string) $selection['ratePlanName']],
            'assigned_guests' => 1,
        ];
        $summary = ['total_price' => $total, 'nights' => $nights, 'fees_total' => 0.0, 'discount_total' => 0.0, 'taxes_total' => 0.0, 'room_subtotal' => $total];
    }

    $guestInfo = $isValid && \is_array($selection['guestInfo'] ?? null) ? $selection['guestInfo'] : [];
    $guestForm = [
        'first_name' => (string) ($guestInfo['firstName'] ?? ''), 'last_name' => (string) ($guestInfo['lastName'] ?? ''),
        'email' => (string) ($guestInfo['email'] ?? ''), 'phone_country_code' => (string) ($guestInfo['phoneCountryCode'] ?? ''),
        'phone_number' => (string) ($guestInfo['phoneNumber'] ?? ''), 'country' => (string) ($guestInfo['country'] ?? ''),
        'special_requests' => (string) ($guestInfo['specialRequests'] ?? ''),
    ];

    return [
        'messages' => $messages, 'is_valid_context' => $isValid,
        'selected_rooms' => $selectedRooms, 'summary' => $summary, 'guest_form' => $guestForm,
        'checkout_url' => get_checkout_page_url(), 'booking_url' => get_booking_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(),
        'fixed_room_mode' => false, 'selected_room_count' => $isValid ? 1 : 0,
        'checkin' => $isValid ? (string) $selection['checkin'] : '', 'checkout' => $isValid ? (string) $selection['checkout'] : '',
        'guests' => 1, 'room_count' => 1,
        'country_options' => get_checkout_country_options(), 'phone_country_code_options' => get_checkout_phone_code_options(),
    ];
}

function enqueue_checkout_page_assets(): void
{
    if (!ManagedPages::isCurrentPage('page_checkout_id', 'checkout')) return;
    enqueue_shared_booking_assets();
    \wp_enqueue_script('must-hotel-booking-phone-fields', MUST_HOTEL_BOOKING_URL . 'assets/js/booking-phone-fields.js', [], MUST_HOTEL_BOOKING_VERSION, true);
}
\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_checkout_page_assets');
