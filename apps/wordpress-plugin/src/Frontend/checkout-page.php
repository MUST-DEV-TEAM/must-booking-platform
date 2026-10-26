<?php
namespace MustHotelBooking\Frontend;

use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustApiClient;

/**
 * The rates a Clock-connected room offers for the selected stay (for example Bed & breakfast or a
 * seasonal rate). Empty for any other hotel, or when the room has only one rate.
 *
 * @param array<string, mixed> $selection
 * @return array<int, array<string, mixed>>
 */
function get_selection_rate_offers(array $selection): array
{
    if (empty($selection['roomTypeId'])) return [];
    $response = MustApiClient::get('/public/rate-offers', [
        'roomTypeId' => (string) $selection['roomTypeId'],
        'startsOn' => (string) ($selection['checkin'] ?? ''),
        'endsOn' => (string) ($selection['checkout'] ?? ''),
        'adults' => (int) ($selection['adults'] ?? $selection['guests'] ?? 1),
        'children' => (int) ($selection['children'] ?? 0),
    ]);
    $offers = \is_array($response['body'] ?? null) ? ($response['body']['offers'] ?? []) : [];
    if (!$response['ok'] || !\is_array($offers) || \count($offers) < 2) return [];
    return \array_values($offers);
}

/**
 * Price the selected stay again under the rate the guest chose and keep that rate and its signed
 * quote in the selection. Returns the updated selection, or null when the rate cannot be priced.
 *
 * @param array<string, mixed> $selection
 * @return array<string, mixed>|null
 */
function apply_selection_rate_choice(array $selection, string $rateId): ?array
{
    foreach (get_selection_rate_offers($selection) as $offer) {
        if ((string) ($offer['rateId'] ?? '') !== $rateId) continue;
        $promoCode = (string) ($selection['promoCode'] ?? '');
        $quote = MustApiClient::post('/quotes', selection_quote_input($selection, $rateId, $promoCode));
        if ((!$quote['ok'] || !\is_array($quote['body'])) && $promoCode !== '') {
            // The coupon does not apply under this rate: price it without the coupon and say so.
            unset($selection['promoCode']);
            $selection['couponNotice'] = ['type' => 'error', 'message' => \__('Your coupon does not apply to this rate, so it was removed.', 'must-hotel-booking')];
            $quote = MustApiClient::post('/quotes', selection_quote_input($selection, $rateId, ''));
        }
        if (!$quote['ok'] || !\is_array($quote['body'])) return null;
        $selection['quote'] = $quote['body'];
        $selection['clockRateId'] = $rateId;
        $selection['ratePlanName'] = (string) ($offer['label'] ?? $selection['ratePlanName'] ?? '');
        return $selection;
    }
    return null;
}

/**
 * The quote request for the selected stay, under a rate and optionally a coupon code.
 *
 * @param array<string, mixed> $selection
 * @return array<string, mixed>
 */
function selection_quote_input(array $selection, string $rateId, string $promoCode): array
{
    $adults = (int) ($selection['adults'] ?? $selection['guests'] ?? 1);
    $children = (int) ($selection['children'] ?? 0);
    $quoteInput = [
        'roomTypeId' => $selection['roomTypeId'], 'ratePlanId' => $selection['ratePlanId'] ?? '',
        'startsOn' => $selection['checkin'], 'endsOn' => $selection['checkout'],
        'adults' => $adults, 'children' => $children, 'guestCount' => $adults + $children,
    ];
    if ($rateId !== '') $quoteInput['clockRateId'] = $rateId;
    if ($promoCode !== '') $quoteInput['promoCode'] = $promoCode;
    if (!empty($selection['roomId'])) $quoteInput['roomId'] = $selection['roomId'];
    return $quoteInput;
}

/**
 * Price the selected stay with a coupon code, or without one when the code is empty. Returns the selection
 * (re-priced when the code applies) and a notice for the guest.
 *
 * @param array<string, mixed> $selection
 * @return array{selection: array<string, mixed>, notice: array{type: string, message: string}}
 */
function apply_selection_promo(array $selection, string $code): array
{
    $rateId = (string) ($selection['clockRateId'] ?? '');
    $quote = MustApiClient::post('/quotes', selection_quote_input($selection, $rateId, $code));
    if ($code === '') {
        if ($quote['ok'] && \is_array($quote['body'])) {
            $selection['quote'] = $quote['body'];
            unset($selection['promoCode']);
        }
        return ['selection' => $selection, 'notice' => ['type' => 'info', 'message' => \__('Coupon removed.', 'must-hotel-booking')]];
    }
    if (!$quote['ok'] || !\is_array($quote['body'])) {
        $message = \is_array($quote['body'] ?? null) && \is_string($quote['body']['message'] ?? null) ? $quote['body']['message'] : '';
        return ['selection' => $selection, 'notice' => ['type' => 'error', 'message' => $message !== '' ? $message : \__('This coupon cannot be used for these dates.', 'must-hotel-booking')]];
    }
    $promo = \is_array($quote['body']['promo'] ?? null) ? $quote['body']['promo'] : null;
    if ($promo === null) {
        return ['selection' => $selection, 'notice' => ['type' => 'error', 'message' => \__('This coupon cannot be used for these dates.', 'must-hotel-booking')]];
    }
    $selection['quote'] = $quote['body'];
    $selection['promoCode'] = (string) ($promo['code'] ?? $code);
    return ['selection' => $selection, 'notice' => ['type' => 'success', 'message' => \__('Coupon applied.', 'must-hotel-booking')]];
}

/** Handle the guest-information form submission before any output. Stores contact details and advances to the Review & Payment step. */
function maybe_process_checkout_submission(): string
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return '';
    $action = isset($_POST['must_checkout_action']) ? \sanitize_key((string) $_POST['must_checkout_action']) : '';
    if ($action !== 'continue_to_confirmation' && $action !== 'choose_rate' && $action !== 'preview_coupon') return '';
    if (!isset($_POST['must_checkout_nonce']) || !\wp_verify_nonce((string) \wp_unslash($_POST['must_checkout_nonce']), 'must_checkout_complete')) {
        return \__('Your request could not be verified. Please try again.', 'must-hotel-booking');
    }
    $selection = get_current_booking_selection();
    if ($selection === null) {
        \wp_safe_redirect(get_booking_accommodation_page_url());
        exit;
    }

    // A guest who picked another rate gets the stay priced again under it before anything else.
    $postedRateId = isset($_POST['clock_rate_id']) ? \sanitize_text_field((string) \wp_unslash($_POST['clock_rate_id'])) : '';
    if ($postedRateId !== '' && $postedRateId !== (string) ($selection['clockRateId'] ?? '')) {
        $repriced = apply_selection_rate_choice($selection, $postedRateId);
        if ($repriced === null) {
            return \__('That rate is no longer available for these dates. Please choose another.', 'must-hotel-booking');
        }
        $selection = $repriced;
        set_current_booking_selection($selection);
    }
    if ($action === 'preview_coupon') {
        $code = isset($_POST['coupon_code']) ? \sanitize_text_field((string) \wp_unslash($_POST['coupon_code'])) : '';
        $result = apply_selection_promo($selection, $code);
        $selection = $result['selection'];
        $selection['couponNotice'] = $result['notice'];
    }
    if ($action === 'choose_rate' || $action === 'preview_coupon') {
        // Reloading the page must not wipe what the guest already typed.
        $typed = \is_array($selection['guestInfo'] ?? null) ? $selection['guestInfo'] : [];
        foreach (['first_name' => 'firstName', 'last_name' => 'lastName', 'phone_country_code' => 'phoneCountryCode', 'phone_number' => 'phoneNumber', 'country' => 'country'] as $field => $key) {
            if (isset($_POST[$field])) $typed[$key] = \sanitize_text_field((string) \wp_unslash($_POST[$field]));
        }
        if (isset($_POST['email'])) $typed['email'] = \sanitize_email((string) \wp_unslash($_POST['email']));
        if (isset($_POST['special_requests'])) $typed['specialRequests'] = \sanitize_textarea_field((string) \wp_unslash($_POST['special_requests']));
        $selection['guestInfo'] = $typed;
        set_current_booking_selection($selection);
        \wp_safe_redirect(get_checkout_page_url());
        exit;
    }

    $hasOccupancyBreakdown = isset($selection['adults']) || isset($selection['children']);
    $adults = \max(1, (int) ($selection['adults'] ?? $selection['guests'] ?? 1));
    $children = \max(0, (int) ($selection['children'] ?? 0));
    $defaultGuestCount = $adults + $children;
    $postedGuestCounts = isset($_POST['room_guest_count']) && \is_array($_POST['room_guest_count'])
        ? \wp_unslash($_POST['room_guest_count'])
        : [];
    $postedGuestCount = $postedGuestCounts !== [] ? \reset($postedGuestCounts) : null;
    if ($postedGuestCount !== null && (!\is_scalar($postedGuestCount) || !\ctype_digit((string) $postedGuestCount) || (int) $postedGuestCount < 1)) {
        return \__('Please enter a valid number of guests.', 'must-hotel-booking');
    }
    $guestCount = $postedGuestCount === null || $hasOccupancyBreakdown
        ? $defaultGuestCount
        : (int) $postedGuestCount;

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
        'adults' => $adults, 'children' => $children, 'guestCount' => $guestCount,
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
        $guestInfo = \is_array($selection['guestInfo'] ?? null) ? $selection['guestInfo'] : [];
        $adults = \max(1, (int) ($selection['adults'] ?? $guestInfo['adults'] ?? $selection['guests'] ?? 1));
        $children = \max(0, (int) ($selection['children'] ?? $guestInfo['children'] ?? 0));
        $guestCount = $adults + $children;
        $quote = $selection['quote'];
        $start = new \DateTimeImmutable((string) $selection['checkin']);
        $end = new \DateTimeImmutable((string) $selection['checkout']);
        $nights = \max(1, (int) $start->diff($end)->days);
        $total = (float) $quote['total']['amount'];
        $promo = \is_array($quote['promo'] ?? null) ? $quote['promo'] : null;
        $discount = $promo !== null ? (float) ($promo['discount']['amount'] ?? 0) : 0.0;
        $original = $promo !== null ? (float) ($promo['originalTotal']['amount'] ?? $total + $discount) : $total;
        $selectedRooms[] = [
            'room_id' => 1,
            'room' => ['name' => (string) $selection['roomName'], 'currency' => (string) $quote['total']['currency'], 'max_guests' => $guestCount, 'primary_image_url' => ''],
            'pricing' => [
                'total_price' => $total, 'nights' => $nights, 'fees_total' => 0.0,
                'discount_total' => $discount, 'taxes_total' => 0.0, 'room_subtotal' => $original,
                'applied_coupon' => $promo !== null ? (string) ($promo['code'] ?? '') : '',
                'nightly_rates' => isset($quote['nightlyRates']) && \is_array($quote['nightlyRates'])
                    ? $quote['nightlyRates']
                    : [],
            ],
            'rate_plan' => ['name' => (string) $selection['ratePlanName']],
            'assigned_guests' => $guestCount,
        ];
        $summary = ['total_price' => $total, 'nights' => $nights, 'fees_total' => 0.0, 'discount_total' => $discount, 'taxes_total' => 0.0, 'room_subtotal' => $original];
    }

    $couponNotice = null;
    if ($isValid && \is_array($selection['couponNotice'] ?? null)) {
        $couponNotice = $selection['couponNotice'];
        unset($selection['couponNotice']);
        set_current_booking_selection($selection);
    }
    $appliedCoupon = $isValid && \is_array($selection['quote']['promo'] ?? null) ? (string) ($selection['quote']['promo']['code'] ?? '') : '';
    $rateOffers = $isValid ? get_selection_rate_offers($selection) : [];
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
        'guests' => $isValid ? $guestCount : 1,
        'adults' => $isValid ? $adults : 1, 'children' => $isValid ? $children : 0,
        'room_count' => 1,
        'applied_coupon_code' => $appliedCoupon, 'coupon_input_value' => $appliedCoupon, 'coupon_notice' => $couponNotice,
        'rate_offers' => $rateOffers,
        'selected_rate_id' => $rateOffers === [] ? '' : (string) ($selection['clockRateId'] ?? $rateOffers[0]['rateId'] ?? ''),
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
