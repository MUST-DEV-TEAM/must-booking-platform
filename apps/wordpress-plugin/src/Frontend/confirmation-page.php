<?php
namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustApiClient;

/** @param array<string, mixed> $request */
function get_confirmation_cancellation_form_url(string $confirmationUrl, array $request): string
{
    $args = [];
    $accessContext = isset($request['access_context'])
        ? \sanitize_text_field((string) \wp_unslash($request['access_context']))
        : '';
    if ((bool) \preg_match('/\A[a-f0-9]{64}\z/i', $accessContext)) {
        $args['access_context'] = $accessContext;
    }

    foreach (['booking_id', 'cancellationToken'] as $key) {
        $value = isset($request[$key])
            ? \sanitize_text_field((string) \wp_unslash($request[$key]))
            : '';
        if ($value !== '') {
            $args[$key] = $value;
        }
    }

    return $args === [] ? $confirmationUrl : \add_query_arg($args, $confirmationUrl);
}

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
function get_booking_display_names(string $roomTypeId, string $ratePlanId, string $startsOn = '', string $endsOn = ''): array
{
    foreach (get_must_room_types($startsOn, $endsOn) as $roomType) {
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
    $status = '';

    $response = MustApiClient::get('/public/bookings/' . \rawurlencode($bookingId));
    if ($response['ok'] && \is_array($response['body'])) {
        $booking = $response['body'];
        $status = (string) ($booking['status'] ?? '');
        $apiPaymentMethod = (string) ($booking['paymentMethod'] ?? '');
        $onlinePaymentMethod = \in_array($apiPaymentMethod, ['STRIPE_CHECKOUT', 'POKPAY'], true);
        $paymentMethod = $apiPaymentMethod === 'PAY_AT_HOTEL'
            ? 'pay_at_hotel'
            : ($apiPaymentMethod === 'STRIPE_CHECKOUT' ? 'stripe' : ($apiPaymentMethod === 'POKPAY' ? 'pokpay' : ''));
        $success = true;
        $totalPrice = isset($booking['total']['amount']) ? (float) $booking['total']['amount'] : 0.0;
        $names = get_booking_display_names(
            (string) ($booking['roomTypeId'] ?? ''),
            (string) ($booking['ratePlanId'] ?? ''),
            (string) ($booking['startsOn'] ?? ''),
            (string) ($booking['endsOn'] ?? '')
        );
        $reservations[] = [
            'status' => $status,
            'payment_status' => $status === 'CONFIRMED' && $onlinePaymentMethod ? 'paid' : 'pending',
            'checkin' => (string) ($booking['startsOn'] ?? ''), 'checkout' => (string) ($booking['endsOn'] ?? ''),
            'guests' => 1, 'booking_id' => $bookingId,
            'room_name' => $names['room_name'], 'rate_plan_name' => $names['rate_plan_name'],
            'total_price' => $totalPrice,
            'currency' => (string) ($booking['total']['currency'] ?? ''),
            'nightly_rates' => isset($booking['nightlyRates']) && \is_array($booking['nightlyRates'])
                ? $booking['nightlyRates']
                : [],
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
        'booking_id' => $bookingId, 'booking_status' => $status,
        'status_polling' => $status === 'PAYMENT_PENDING', 'cancellation_token' => $token,
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
    // The field is editable on this step too -- prefer a resubmitted value, falling
    // back to what Guest Information already stored (defensive; the form always
    // includes this field, so the fallback shouldn't normally be needed).
    $specialRequests = isset($_POST['special_requests'])
        ? \sanitize_textarea_field((string) \wp_unslash($_POST['special_requests']))
        : (string) ($selection['guestInfo']['specialRequests'] ?? '');
    $selection['guestInfo'] = [
        'firstName' => $firstName, 'lastName' => $lastName, 'email' => $email,
        'phoneCountryCode' => $phoneCountryCode, 'phoneNumber' => $phoneNumber, 'country' => $country,
        'streetAddress' => $streetAddress, 'addressLine2' => $addressLine2, 'city' => $city,
        'county' => $county, 'postcode' => $postcode, 'specialRequests' => $specialRequests,
    ];
    set_current_booking_selection($selection);

    if ($firstName === '' || $lastName === '' || $email === '') {
        return \__('Please fill in your name and email to continue.', 'must-hotel-booking');
    }
    if (!\in_array($paymentMethod, get_must_payment_methods((string) $selection['checkin'], (string) $selection['checkout']), true)) {
        return \__('Please choose a payment method to continue.', 'must-hotel-booking');
    }

    $quote = $selection['quote'];
    $bookingInput = [
        'roomTypeId' => $selection['roomTypeId'],
        'ratePlanId' => $selection['ratePlanId'],
        'startsOn' => $selection['checkin'],
        'endsOn' => $selection['checkout'],
        'total' => $quote['total'],
        'quoteToken' => $quote['quoteToken'],
        'paymentMethod' => $paymentMethod,
        'returnUrl' => ManagedPages::getBookingConfirmationPageUrl(),
        'guest' => [
            'firstName' => $firstName, 'lastName' => $lastName, 'email' => $email,
            'phone' => $phone !== '' ? $phone : null,
            'streetAddress' => $streetAddress !== '' ? $streetAddress : null,
            'addressLine2' => $addressLine2 !== '' ? $addressLine2 : null,
            'city' => $city !== '' ? $city : null,
            'county' => $county !== '' ? $county : null,
            'postcode' => $postcode !== '' ? $postcode : null,
            'specialRequests' => $specialRequests !== '' ? $specialRequests : null,
        ],
    ];
    if (!empty($selection['roomId'])) {
        $bookingInput['roomId'] = $selection['roomId'];
    }
    $result = MustApiClient::post('/bookings', $bookingInput, \wp_generate_uuid4());

    if (!$result['ok'] || !\is_array($result['body']) || empty($result['body']['ok'])) {
        return get_booking_creation_error_message($result);
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

/**
 * `POST /bookings` can fail two different ways: (1) a booking-domain rejection returned
 * inline with a 2xx status as `{ok:false, error:{code,message}}` (e.g. a payment provider
 * not being configured), or (2) an early validation `BadRequestException`, a real HTTP error
 * status with NestJS's standard flat `{statusCode,message,error}` body (e.g. an expired quote
 * token). Both `message` fields are always guest-safe sentences (same convention the rest of
 * the API uses). Check both shapes rather than a generic message that hides the real reason.
 * @param array{ok: bool, status: int, body: array<string, mixed>|null} $result
 */
function get_booking_creation_error_message(array $result): string
{
    $body = $result['body'];
    if (\is_array($body)) {
        $nested = \is_array($body['error'] ?? null) ? $body['error']['message'] ?? null : null;
        if (\is_string($nested) && $nested !== '') {
            return $nested;
        }
        $flat = $body['message'] ?? null;
        if (\is_string($flat) && $flat !== '') {
            return $flat;
        }
    }
    return \__('We could not complete your booking. Please review your details and try again.', 'must-hotel-booking');
}

/** @return array<string, array{label: string}> keyed by the property's actually-enabled payment methods, in catalog order */
function get_confirmation_payment_methods_view_data(string $startsOn = '', string $endsOn = ''): array
{
    $labels = [
        'stripe' => \__('Credit / Debit Card', 'must-hotel-booking'),
        'pokpay' => \__('PokPay', 'must-hotel-booking'),
        'pay_at_hotel' => \__('Pay at Hotel', 'must-hotel-booking'),
    ];
    $methods = [];
    foreach (get_must_payment_methods($startsOn, $endsOn) as $method) {
        if (isset($labels[$method])) {
            $methods[$method] = ['label' => $labels[$method]];
        }
    }
    return $methods;
}

/** @return array<string, mixed> */
function get_confirmation_review_view_data(): array
{
    $error = maybe_process_confirm_booking_submission();
    $messages = $error !== '' ? [$error] : [];
    $selection = get_current_booking_selection();
    $canConfirm = $selection !== null && \is_array($selection['guestInfo'] ?? null);
    $paymentMethods = get_confirmation_payment_methods_view_data(
        (string) ($selection['checkin'] ?? ''),
        (string) ($selection['checkout'] ?? '')
    );
    if ($canConfirm && empty($paymentMethods)) {
        $canConfirm = false;
        $messages[] = \__('Online booking is not available for this property right now. Please contact the hotel directly.', 'must-hotel-booking');
    }
    $guestInfo = $canConfirm ? $selection['guestInfo'] : [];

    $selectedRooms = [];
    $summary = [];
    if ($canConfirm) {
        $quote = $selection['quote'];
        $total = (float) $quote['total']['amount'];
        $selectedRooms[] = [
            'room' => ['name' => (string) $selection['roomName'], 'currency' => (string) $quote['total']['currency']],
            'pricing' => [
                'total_price' => $total,
                'nightly_rates' => isset($quote['nightlyRates']) && \is_array($quote['nightlyRates'])
                    ? $quote['nightlyRates']
                    : [],
            ],
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
        'postcode' => (string) ($guestInfo['postcode'] ?? ''),
        'special_requests' => (string) ($guestInfo['specialRequests'] ?? ''),
    ];

    return [
        'success' => false, 'is_form_mode' => true, 'can_confirm' => $canConfirm, 'messages' => $messages,
        'reservations' => [], 'selected_rooms' => $selectedRooms, 'summary' => $summary, 'billing_form' => $billingForm,
        'payment_method' => \array_key_first($paymentMethods) ?? '',
        'payment_methods' => $paymentMethods,
        'pending_payment' => [],
        'confirmation_cta_label' => \__('Confirm reservation', 'must-hotel-booking'),
        'primary_guest' => null, 'total_price' => isset($summary['total_price']) ? (float) $summary['total_price'] : 0.0,
        'status_heading' => \__('Booking status', 'must-hotel-booking'), 'status_message' => '', 'message' => '',
        'booking_url' => get_booking_page_url(), 'accommodation_url' => get_booking_accommodation_page_url(),
        'checkout_url' => get_checkout_page_url(), 'confirmation_url' => ManagedPages::getBookingConfirmationPageUrl(),
        'fixed_room_mode' => false, 'country_options' => get_checkout_country_options(), 'phone_country_code_options' => get_checkout_phone_code_options(),
        'cancellation_review' => [],
        'booking_id' => '', 'booking_status' => '', 'status_polling' => false, 'cancellation_token' => '',
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
    $bookingId = isset($_GET['booking_id']) ? \sanitize_text_field((string) \wp_unslash($_GET['booking_id'])) : '';
    \wp_localize_script('must-hotel-booking-confirmation', 'mustHotelBookingBookingStatus', [
        'ajaxUrl' => \admin_url('admin-ajax.php'),
        'nonce' => \wp_create_nonce('must_booking_confirmation_status'),
        'bookingId' => $bookingId,
        'strings' => [
            'confirmedHeading' => \__('Booking confirmed', 'must-hotel-booking'),
            'confirmedMessage' => \__('Your booking is confirmed.', 'must-hotel-booking'),
            'cancelledHeading' => \__('Booking cancelled', 'must-hotel-booking'),
            'cancelledMessage' => \__('This booking has been cancelled.', 'must-hotel-booking'),
        ],
    ]);
}

/** Poll the guest-scoped API status without exposing its session cookie or booking payload to the browser. */
function get_confirmation_booking_status(): void
{
    $nonce = isset($_POST['nonce']) ? (string) \wp_unslash($_POST['nonce']) : '';
    $bookingId = isset($_POST['booking_id']) ? \sanitize_text_field((string) \wp_unslash($_POST['booking_id'])) : '';
    if ($nonce === '' || !\wp_verify_nonce($nonce, 'must_booking_confirmation_status')) {
        \wp_send_json_error(['message' => \__('Your request could not be verified. Please refresh and try again.', 'must-hotel-booking')], 403);
    }
    if (\preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i', $bookingId) !== 1) {
        \wp_send_json_error(['message' => \__('Booking not found.', 'must-hotel-booking')], 400);
    }
    $response = MustApiClient::get('/public/bookings/' . \rawurlencode($bookingId));
    if (!$response['ok'] || !\is_array($response['body'])) {
        \wp_send_json_error(['message' => \__('Booking status could not be loaded. Please try again.', 'must-hotel-booking')], 502);
    }
    $status = isset($response['body']['status']) ? (string) $response['body']['status'] : '';
    \wp_send_json_success(['status' => $status]);
}
\add_action('wp_ajax_must_booking_confirmation_status', __NAMESPACE__ . '\\get_confirmation_booking_status');
\add_action('wp_ajax_nopriv_must_booking_confirmation_status', __NAMESPACE__ . '\\get_confirmation_booking_status');
\add_action('wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_confirmation_page_assets');
