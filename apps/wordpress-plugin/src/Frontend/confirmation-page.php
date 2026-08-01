<?php
namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustApiClient;

/** Handle the "cancel booking" form POST before any output. Reloads the page on success. */
function maybe_process_confirmation_cancellation(): string
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return '';
    $action = isset($_POST['must_confirmation_action']) ? \sanitize_key((string) $_POST['must_confirmation_action']) : '';
    if (!\in_array($action, ['prepare_cancellation', 'execute_cancellation'], true)) return '';
    $nonceAction = $action === 'execute_cancellation' ? 'must_confirm_cancellation' : 'must_prepare_cancellation';
    if (!isset($_POST['must_cancellation_nonce']) || !\wp_verify_nonce((string) \wp_unslash($_POST['must_cancellation_nonce']), $nonceAction)) {
        return \__('Your request could not be verified. Please try again.', 'must-hotel-booking');
    }
    $bookingId = isset($_GET['booking_id']) ? \sanitize_text_field((string) \wp_unslash($_GET['booking_id'])) : '';
    $token = isset($_GET['cancellationToken']) ? \sanitize_text_field((string) \wp_unslash($_GET['cancellationToken'])) : '';
    if ($bookingId === '') return \__('Booking not found.', 'must-hotel-booking');

    $current = MustApiClient::get('/public/bookings/' . \rawurlencode($bookingId));
    if (!$current['ok'] || !\is_array($current['body'])) {
        return \__('Booking not found.', 'must-hotel-booking');
    }
    $expectedVersion = (int) ($current['body']['version'] ?? 0);

    $result = MustApiClient::delete('/bookings/' . \rawurlencode($bookingId) . ($token !== '' ? '?cancellationToken=' . \rawurlencode($token) : ''), [
        'expectedVersion' => $expectedVersion, 'reason' => 'Guest cancellation',
    ], \wp_generate_uuid4());

    if (!$result['ok'] || !\is_array($result['body']) || empty($result['body']['ok'])) {
        return \__('This booking could not be cancelled. Please try again or contact the hotel.', 'must-hotel-booking');
    }

    $redirect = \add_query_arg(['booking_id' => $bookingId, 'cancellationToken' => $token], ManagedPages::getBookingConfirmationPageUrl());
    \wp_safe_redirect($redirect);
    exit;
}

/** @return array<string, mixed> room type/rate plan display names for a booking, looked up from the catalog. */
function get_booking_display_names(string $roomTypeId, string $ratePlanId): array
{
    foreach (get_must_room_types() as $roomType) {
        if ((string) ($roomType['id'] ?? '') !== $roomTypeId) continue;
        $ratePlanName = '';
        foreach ((array) ($roomType['ratePlans'] ?? []) as $ratePlan) {
            if ((string) ($ratePlan['id'] ?? '') === $ratePlanId) {
                $ratePlanName = (string) ($ratePlan['name'] ?? '');
            }
        }
        return ['room_name' => (string) ($roomType['name'] ?? ''), 'rate_plan_name' => $ratePlanName];
    }
    return ['room_name' => '', 'rate_plan_name' => ''];
}

/** @return array<string, mixed> */
function get_confirmation_result_view_data(string $bookingId): array
{
    $error = maybe_process_confirmation_cancellation();
    $messages = $error !== '' ? [$error] : [];

    $token = isset($_GET['cancellationToken']) ? \sanitize_text_field((string) \wp_unslash($_GET['cancellationToken'])) : '';
    $reservations = [];
    $success = false;
    $statusMessage = \__('Your booking could not be found.', 'must-hotel-booking');
    $totalPrice = 0.0;
    $paymentMethod = '';
    $cancellationReview = [];

    $response = MustApiClient::get('/public/bookings/' . \rawurlencode($bookingId));
    if ($response['ok'] && \is_array($response['body'])) {
        $booking = $response['body'];
        $status = (string) ($booking['status'] ?? '');
        $apiPaymentMethod = (string) ($booking['paymentMethod'] ?? '');
        $paymentMethod = $apiPaymentMethod === 'PAY_AT_HOTEL' ? 'pay_at_hotel' : ($apiPaymentMethod === 'STRIPE_CHECKOUT' ? 'stripe' : '');
        $success = true;
        $totalPrice = isset($booking['total']['amount']) ? (float) $booking['total']['amount'] : 0.0;
        $names = get_booking_display_names((string) ($booking['roomTypeId'] ?? ''), (string) ($booking['ratePlanId'] ?? ''));
        $reservations[] = [
            'status' => $status,
            'payment_status' => $status === 'CONFIRMED' && $apiPaymentMethod === 'STRIPE_CHECKOUT' ? 'paid' : 'pending',
            'checkin' => (string) ($booking['startsOn'] ?? ''), 'checkout' => (string) ($booking['endsOn'] ?? ''),
            'guests' => 1, 'booking_id' => $bookingId,
            'room_name' => $names['room_name'], 'rate_plan_name' => $names['rate_plan_name'],
            'total_price' => $totalPrice,
        ];
        $statusMessage = match ($status) {
            'CONFIRMED' => \__('Your booking is confirmed.', 'must-hotel-booking'),
            'PAYMENT_PENDING' => \__('Your payment is still being processed. Please check back shortly.', 'must-hotel-booking'),
            'CANCELLED' => \__('This booking has been cancelled.', 'must-hotel-booking'),
            default => \__('Checking your booking status…', 'must-hotel-booking'),
        };
        $cancellationRequested = isset($_GET['must_action']) && \sanitize_key((string) \wp_unslash($_GET['must_action'])) !== '';
        if ($cancellationRequested && \in_array($status, ['CONFIRMED', 'PAYMENT_PENDING'], true)) {
            $cancellationReview = ['eligible' => true, 'manual_only' => false, 'execution_ready' => true, 'message' => '', 'paid_amount' => $totalPrice];
        }
    }

    return [
        'success' => $success, 'is_form_mode' => false, 'can_confirm' => false, 'messages' => $messages,
        'reservations' => $reservations, 'selected_rooms' => [], 'summary' => [], 'billing_form' => [],
        'payment_method' => $paymentMethod, 'payment_methods' => [], 'pending_payment' => [],
        'confirmation_cta_label' => \__('Confirm reservation', 'must-hotel-booking'),
        'primary_guest' => null, 'total_price' => $totalPrice,
        'status_heading' => \__('Booking status', 'must-hotel-booking'), 'status_message' => $statusMessage,
        'message' => $statusMessage,
        'booking_url' => get_booking_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(),
        'checkout_url' => get_checkout_page_url(), 'confirmation_url' => ManagedPages::getBookingConfirmationPageUrl(),
        'fixed_room_mode' => false, 'country_options' => [], 'phone_country_code_options' => [],
        'cancellation_review' => $cancellationReview,
        'booking_id' => $bookingId, 'cancellation_token' => $token,
    ];
}

/** Handle the Review & Payment form POST before any output. Creates the booking on success. */
function maybe_process_confirm_booking_submission(): string
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return '';
    $action = isset($_POST['must_confirmation_action']) ? \sanitize_key((string) $_POST['must_confirmation_action']) : '';
    if ($action !== 'confirm_booking') return '';
    if (!isset($_POST['must_confirmation_nonce']) || !\wp_verify_nonce((string) \wp_unslash($_POST['must_confirmation_nonce']), 'must_confirm_booking')) {
        return \__('Your request could not be verified. Please try again.', 'must-hotel-booking');
    }
    $selection = get_current_booking_selection();
    if ($selection === null || !\is_array($selection['guestInfo'] ?? null)) {
        \wp_safe_redirect(get_checkout_page_url());
        exit;
    }

    $firstName = isset($_POST['first_name']) ? \sanitize_text_field((string) \wp_unslash($_POST['first_name'])) : '';
    $lastName = isset($_POST['last_name']) ? \sanitize_text_field((string) \wp_unslash($_POST['last_name'])) : '';
    $email = isset($_POST['email']) ? \sanitize_email((string) \wp_unslash($_POST['email'])) : '';
    $phoneCountryCode = isset($_POST['phone_country_code']) ? \sanitize_text_field((string) \wp_unslash($_POST['phone_country_code'])) : '';
    $phoneNumber = isset($_POST['phone_number']) ? \sanitize_text_field((string) \wp_unslash($_POST['phone_number'])) : '';
    $country = isset($_POST['country']) ? \sanitize_text_field((string) \wp_unslash($_POST['country'])) : '';
    $paymentMethod = isset($_POST['payment_method']) ? \sanitize_key((string) \wp_unslash($_POST['payment_method'])) : '';
    $phone = \trim($phoneCountryCode . ' ' . $phoneNumber);

    $streetAddress = isset($_POST['street_address']) ? \sanitize_text_field((string) \wp_unslash($_POST['street_address'])) : '';
    $addressLine2 = isset($_POST['address_line_2']) ? \sanitize_text_field((string) \wp_unslash($_POST['address_line_2'])) : '';
    $city = isset($_POST['city']) ? \sanitize_text_field((string) \wp_unslash($_POST['city'])) : '';
    $county = isset($_POST['county']) ? \sanitize_text_field((string) \wp_unslash($_POST['county'])) : '';
    $postcode = isset($_POST['postcode']) ? \sanitize_text_field((string) \wp_unslash($_POST['postcode'])) : '';
    $selection['guestInfo'] = [
        'firstName' => $firstName, 'lastName' => $lastName, 'email' => $email,
        'phoneCountryCode' => $phoneCountryCode, 'phoneNumber' => $phoneNumber, 'country' => $country,
        'streetAddress' => $streetAddress, 'addressLine2' => $addressLine2, 'city' => $city,
        'county' => $county, 'postcode' => $postcode,
    ];
    set_current_booking_selection($selection);

    if ($firstName === '' || $lastName === '' || $email === '') {
        return \__('Please fill in your name and email to continue.', 'must-hotel-booking');
    }
    if (!\in_array($paymentMethod, ['stripe', 'pay_at_hotel'], true)) {
        return \__('Please choose a payment method to continue.', 'must-hotel-booking');
    }

    $quote = $selection['quote'];
    $result = MustApiClient::post('/bookings', [
        'roomTypeId' => $selection['roomTypeId'],
        'ratePlanId' => $selection['ratePlanId'],
        'startsOn' => $selection['checkin'],
        'endsOn' => $selection['checkout'],
        'total' => $quote['total'],
        'quoteToken' => $quote['quoteToken'],
        'payAtHotel' => $paymentMethod === 'pay_at_hotel',
        'returnUrl' => ManagedPages::getBookingConfirmationPageUrl(),
        'guest' => [
            'firstName' => $firstName, 'lastName' => $lastName, 'email' => $email,
            'phone' => $phone !== '' ? $phone : null,
            'streetAddress' => $streetAddress !== '' ? $streetAddress : null,
            'addressLine2' => $addressLine2 !== '' ? $addressLine2 : null,
            'city' => $city !== '' ? $city : null,
            'county' => $county !== '' ? $county : null,
            'postcode' => $postcode !== '' ? $postcode : null,
        ],
    ], \wp_generate_uuid4());

    if (!$result['ok'] || !\is_array($result['body']) || empty($result['body']['ok'])) {
        return \__('We could not complete your booking. Please review your details and try again.', 'must-hotel-booking');
    }

    $booking = $result['body']['value'];
    clear_current_booking_selection();
    if (!empty($booking['checkoutUrl'])) {
        \wp_redirect((string) $booking['checkoutUrl']);
        exit;
    }
    \wp_safe_redirect(\add_query_arg(
        ['booking_id' => $booking['id'], 'cancellationToken' => (string) ($booking['cancellationToken'] ?? '')],
        ManagedPages::getBookingConfirmationPageUrl()
    ));
    exit;
}

/** @return array<string, mixed> */
function get_confirmation_review_view_data(): array
{
    $error = maybe_process_confirm_booking_submission();
    $messages = $error !== '' ? [$error] : [];
    $selection = get_current_booking_selection();
    $canConfirm = $selection !== null && \is_array($selection['guestInfo'] ?? null);
    $guestInfo = $canConfirm ? $selection['guestInfo'] : [];

    $selectedRooms = [];
    $summary = [];
    if ($canConfirm) {
        $quote = $selection['quote'];
        $total = (float) $quote['total']['amount'];
        $selectedRooms[] = [
            'room' => ['name' => (string) $selection['roomName'], 'currency' => (string) $quote['total']['currency']],
            'pricing' => ['total_price' => $total],
            'rate_plan' => ['name' => (string) $selection['ratePlanName']],
        ];
        $summary = ['total_price' => $total, 'fees_total' => 0.0, 'discount_total' => 0.0, 'taxes_total' => 0.0, 'room_subtotal' => $total];
    }

    $billingForm = [
        'first_name' => (string) ($guestInfo['firstName'] ?? ''), 'last_name' => (string) ($guestInfo['lastName'] ?? ''),
        'email' => (string) ($guestInfo['email'] ?? ''), 'phone_country_code' => (string) ($guestInfo['phoneCountryCode'] ?? ''),
        'phone_number' => (string) ($guestInfo['phoneNumber'] ?? ''), 'country' => (string) ($guestInfo['country'] ?? ''),
        'company' => '', 'street_address' => (string) ($guestInfo['streetAddress'] ?? ''),
        'address_line_2' => (string) ($guestInfo['addressLine2'] ?? ''),
        'city' => (string) ($guestInfo['city'] ?? ''), 'county' => (string) ($guestInfo['county'] ?? ''),
        'postcode' => (string) ($guestInfo['postcode'] ?? ''), 'special_requests' => '',
    ];

    return [
        'success' => false, 'is_form_mode' => true, 'can_confirm' => $canConfirm, 'messages' => $messages,
        'reservations' => [], 'selected_rooms' => $selectedRooms, 'summary' => $summary, 'billing_form' => $billingForm,
        'payment_method' => 'stripe',
        'payment_methods' => [
            'stripe' => ['label' => \__('Credit / Debit Card', 'must-hotel-booking')],
            'pay_at_hotel' => ['label' => \__('Pay at Hotel', 'must-hotel-booking')],
        ],
        'pending_payment' => [],
        'confirmation_cta_label' => \__('Confirm reservation', 'must-hotel-booking'),
        'primary_guest' => null, 'total_price' => isset($summary['total_price']) ? (float) $summary['total_price'] : 0.0,
        'status_heading' => \__('Booking status', 'must-hotel-booking'), 'status_message' => '', 'message' => '',
        'booking_url' => get_booking_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(),
        'checkout_url' => get_checkout_page_url(), 'confirmation_url' => ManagedPages::getBookingConfirmationPageUrl(),
        'fixed_room_mode' => false, 'country_options' => get_checkout_country_options(), 'phone_country_code_options' => get_checkout_phone_code_options(),
        'cancellation_review' => [],
        'booking_id' => '', 'cancellation_token' => '',
    ];
}

/** @return array<string, mixed> */
function get_confirmation_page_view_data(): array
{
    $bookingId = isset($_GET['booking_id']) ? \sanitize_text_field((string) \wp_unslash($_GET['booking_id'])) : '';
    if ($bookingId !== '') {
        return get_confirmation_result_view_data($bookingId);
    }
    return get_confirmation_review_view_data();
}

function enqueue_confirmation_page_assets(): void
{
    if (!ManagedPages::isCurrentPage('page_booking_confirmation_id', 'booking-confirmation')) return;
    enqueue_shared_booking_assets();
    \wp_enqueue_script('must-hotel-booking-confirmation', MUST_HOTEL_BOOKING_URL . 'assets/js/booking-confirmation.js', [], MUST_HOTEL_BOOKING_VERSION, true);
    \wp_enqueue_script('must-hotel-booking-phone-fields', MUST_HOTEL_BOOKING_URL . 'assets/js/booking-phone-fields.js', [], MUST_HOTEL_BOOKING_VERSION, true);
}
\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_confirmation_page_assets');
