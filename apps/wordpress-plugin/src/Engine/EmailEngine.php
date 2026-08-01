<?php
namespace MustHotelBooking\Engine;
use MustHotelBooking\Core\ManagedPages;
use MustHotelBooking\Core\MustBookingConfig;
use MustHotelBooking\Engine\PublicBookingAccessService;
final class EmailEngine
{
    public const TEMPLATES_SETTING_KEY = 'email_templates';
    public static function getTemplatesSettingKey(): string
    {
        return self::TEMPLATES_SETTING_KEY;
    }
    /**
     * @return array<string, string>
     */
    public static function getTemplateLabels(): array
    {
        $labels = [];
        foreach (self::getTemplateDefinitions() as $templateKey => $definition) {
            $labels[$templateKey] = (string) ($definition['label'] ?? $templateKey);
        }
        return $labels;
    }
    /**
     * @return array<string, string>
     */
    public static function getTemplatePlaceholderLabels(): array
    {
        return [
            '{booking_id}' => \__('Booking reference shown to staff and guests.', 'must-hotel-booking'),
            '{guest_name}' => \__('Guest full name when available.', 'must-hotel-booking'),
            '{guest_email}' => \__('Guest email address.', 'must-hotel-booking'),
            '{room_name}' => \__('Accommodation or rate-plan name.', 'must-hotel-booking'),
            '{checkin}' => \__('Formatted check-in date.', 'must-hotel-booking'),
            '{checkout}' => \__('Formatted check-out date.', 'must-hotel-booking'),
            '{total_price}' => \__('Formatted booking total without currency code.', 'must-hotel-booking'),
            '{currency}' => \__('Hotel currency code.', 'must-hotel-booking'),
            '{payment_method}' => \__('Resolved payment method label.', 'must-hotel-booking'),
            '{payment_status}' => \__('Resolved payment status label.', 'must-hotel-booking'),
            '{hotel_name}' => \__('Configured hotel name.', 'must-hotel-booking'),
            '{hotel_address}' => \__('Configured hotel address.', 'must-hotel-booking'),
            '{hotel_google_maps_url}' => \__('Google Maps link for the configured hotel address.', 'must-hotel-booking'),
            '{hotel_email}' => \__('Configured booking/admin email.', 'must-hotel-booking'),
            '{hotel_phone}' => \__('Configured hotel phone.', 'must-hotel-booking'),
            '{hotel_phone_href}' => \__('Telephone link version of the hotel phone.', 'must-hotel-booking'),
            '{hotel_website}' => \__('Site home URL.', 'must-hotel-booking'),
            '{cancellation_url}' => \__('Guest cancellation/review link when available.', 'must-hotel-booking'),
            '{cancellation_action_label}' => \__('Cancellation CTA label based on the booking payment state.', 'must-hotel-booking'),
            '{cancellation_details}' => \__('Cancellation guidance shown in the email body.', 'must-hotel-booking'),
            '{email_footer_text}' => \__('Configured shared footer text.', 'must-hotel-booking'),
        ];
    }
    /**
     * @return array<int, string>
     */
    public static function getTemplatePlaceholders(): array
    {
        return \array_keys(self::getTemplatePlaceholderLabels());
    }
    /**
     * @return array<string, array<string, string>>
     */
    public static function getDefaultTemplates(): array
    {
        $templates = [];
        foreach (self::getTemplateDefinitions() as $templateKey => $definition) {
            $templates[$templateKey] = [
                'enabled' => isset($definition['enabled']) ? (int) $definition['enabled'] : 1,
                'subject' => (string) ($definition['subject'] ?? ''),
                'heading' => (string) ($definition['heading'] ?? ''),
                'body' => (string) ($definition['body'] ?? ''),
                'updated_at' => '',
            ];
        }
        return $templates;
    }
    /**
     * @return array<string, array<string, mixed>>
     */
    public static function getTemplates(): array
    {
        $defaults = self::getDefaultTemplates();
        $savedTemplates = MustBookingConfig::get_setting(self::getTemplatesSettingKey(), []);
        if (!\is_array($savedTemplates)) {
            $savedTemplates = [];
        }
        $templates = [];
        foreach ($defaults as $templateKey => $defaultTemplate) {
            $row = isset($savedTemplates[$templateKey]) && \is_array($savedTemplates[$templateKey])
                ? $savedTemplates[$templateKey]
                : [];
            $templates[$templateKey] = self::sanitizeTemplateRow($row, $defaultTemplate);
        }
        return $templates;
    }
    /**
     * @return array<string, mixed>
     */
    public static function getTemplate(string $templateKey): array
    {
        $templates = self::getTemplates();
        return $templates[$templateKey] ?? ['enabled' => 1, 'subject' => '', 'heading' => '', 'body' => '', 'updated_at' => ''];
    }
    /**
     * @param array<string, array<string, mixed>> $templates
     */
    public static function saveTemplates(array $templates): void
    {
        $defaults = self::getDefaultTemplates();
        $sanitizedTemplates = [];
        foreach ($defaults as $templateKey => $defaultTemplate) {
            $row = isset($templates[$templateKey]) && \is_array($templates[$templateKey])
                ? $templates[$templateKey]
                : [];
            if (!isset($row['updated_at'])) {
                $row['updated_at'] = \current_time('mysql');
            }
            $sanitizedTemplates[$templateKey] = self::sanitizeTemplateRow($row, $defaultTemplate);
        }
        MustBookingConfig::set_setting(self::getTemplatesSettingKey(), $sanitizedTemplates);
    }
    public static function resetTemplate(string $templateKey): bool
    {
        $templateKey = \sanitize_key($templateKey);
        $defaults = self::getDefaultTemplates();
        if (!isset($defaults[$templateKey])) {
            return false;
        }
        $templates = self::getTemplates();
        $templates[$templateKey] = \array_merge(
            $defaults[$templateKey],
            [
                'enabled' => 1,
                'updated_at' => \current_time('mysql'),
            ]
        );
        self::saveTemplates($templates);
        return true;
    }
    /**
     * @return array<string, array<string, mixed>>
     */
    public static function getTemplateRecords(): array
    {
        $records = [];
        $definitions = self::getTemplateDefinitions();
        $templates = self::getTemplates();
        foreach ($definitions as $templateKey => $definition) {
            $template = isset($templates[$templateKey]) && \is_array($templates[$templateKey]) ? $templates[$templateKey] : [];
            $records[$templateKey] = [
                'key' => $templateKey,
                'label' => (string) ($definition['label'] ?? $templateKey),
                'audience' => (string) ($definition['audience'] ?? 'guest'),
                'flow_type' => (string) ($definition['flow_type'] ?? 'general'),
                'trigger' => (string) ($definition['trigger'] ?? ''),
                'used_in_flow' => !empty($definition['used_in_flow']) ? 1 : 0,
                'enabled' => !empty($template['enabled']) ? 1 : 0,
                'subject' => (string) ($template['subject'] ?? ''),
                'heading' => (string) ($template['heading'] ?? ''),
                'body' => (string) ($template['body'] ?? ''),
                'updated_at' => (string) ($template['updated_at'] ?? ''),
                'default_subject' => (string) ($definition['subject'] ?? ''),
                'default_heading' => (string) ($definition['heading'] ?? ''),
                'default_body' => (string) ($definition['body'] ?? ''),
                'cta_label' => (string) ($definition['cta_label'] ?? ''),
            ];
        }
        return $records;
    }
    public static function registerHooks(): void
    {
        \add_action('must_hotel_booking/reservation_confirmed', [self::class, 'handleReservationConfirmedNotifications'], 10, 1);
        \add_action('must_hotel_booking/reservation_cancelled', [self::class, 'handleReservationCancelledNotifications'], 10, 1);
    }
    public static function handleReservationCreatedNotifications(int $reservationId): void
    {
        // Creation is not confirmation; retained as a compatibility callback only.
    }
    public static function handleReservationConfirmedNotifications(int $reservationId): void
    {
        if (!(new ReservationConfirmationService())->isNotificationEligible($reservationId)) {
            return;
        }
        self::sendConfirmedReservationNotifications($reservationId);
    }
    public static function handleReservationCancelledNotifications(int $reservationId): void
    {
        $reservation = self::getReservationForEmail($reservationId);
        if ($reservation === null) {
            return;
        }
        self::sendNotificationForTemplate('guest_booking_cancelled', $reservation, (string) ($reservation['guest_email'] ?? ''), 'automated');
        self::sendNotificationForTemplate('admin_booking_cancelled', $reservation, MustBookingConfig::get_booking_notification_email(), 'automated');
    }
    /**
     * @return array{success: bool, message: string}
     */
    public static function sendTestEmail(string $templateKey, string $recipientEmail, int $reservationId = 0): array
    {
        $templateKey = \sanitize_key($templateKey);
        $recipientEmail = \sanitize_email($recipientEmail);
        $definitions = self::getTemplateDefinitions();
        if (!isset($definitions[$templateKey])) {
            return [
                'success' => false,
                'message' => \__('Unknown email template.', 'must-hotel-booking'),
            ];
        }
        if (!\is_email($recipientEmail)) {
            return [
                'success' => false,
                'message' => \__('Please enter a valid test email address.', 'must-hotel-booking'),
            ];
        }
        $preview = self::renderTemplatePreview($templateKey, $reservationId, $recipientEmail);
        if (empty($preview['success'])) {
            return [
                'success' => false,
                'message' => (string) ($preview['message'] ?? \__('Unable to build the test email preview.', 'must-hotel-booking')),
            ];
        }
        $sent = self::dispatchEmail(
            $recipientEmail,
            '[TEST] ' . (string) ($preview['subject'] ?? ''),
            (string) ($preview['html'] ?? '')
        );
        \do_action(
            'must_hotel_booking/email_dispatch_result',
            [
                'success' => $sent,
                'template_key' => $templateKey,
                'recipient_email' => $recipientEmail,
                'reservation_id' => isset($preview['reservation_id']) ? (int) $preview['reservation_id'] : 0,
                'booking_id' => (string) ($preview['booking_id'] ?? ''),
                'email_mode' => 'test',
            ]
        );
        if (!$sent) {
            return [
                'success' => false,
                'message' => \sprintf(
                    /* translators: %s is the template label. */
                    \__('Unable to send test email for %s.', 'must-hotel-booking'),
                    (string) ($definitions[$templateKey]['label'] ?? $templateKey)
                ),
            ];
        }
        return [
            'success' => true,
            'message' => \sprintf(
                /* translators: 1: template label, 2: recipient email. */
                \__('Test email for %1$s sent to %2$s.', 'must-hotel-booking'),
                (string) ($definitions[$templateKey]['label'] ?? $templateKey),
                $recipientEmail
            ),
        ];
    }
    /**
     * @return array{success: bool, sent: int, failed: array<int, string>, message: string}
     */
    public static function sendAllTestEmails(string $recipientEmail, int $reservationId = 0): array
    {
        $recipientEmail = \sanitize_email($recipientEmail);
        $labels = self::getTemplateLabels();
        if (!\is_email($recipientEmail)) {
            return [
                'success' => false,
                'sent' => 0,
                'failed' => [],
                'message' => \__('Please enter a valid test email address.', 'must-hotel-booking'),
            ];
        }
        $sent = 0;
        $failed = [];
        $sentLabels = [];
        foreach (\array_keys(self::getTemplateDefinitions()) as $templateKey) {
            $result = self::sendTestEmail($templateKey, $recipientEmail, $reservationId);
            if (!empty($result['success'])) {
                $sent++;
                $sentLabels[] = (string) ($labels[$templateKey] ?? $templateKey);
                continue;
            }
            $failed[] = (string) ($labels[$templateKey] ?? $templateKey) . ': ' . (string) $result['message'];
        }
        if (empty($failed)) {
            return [
                'success' => true,
                'sent' => $sent,
                'failed' => [],
                'message' => \sprintf(
                    /* translators: 1: count, 2: recipient. */
                    \__('Sent %1$d test emails to %2$s.', 'must-hotel-booking'),
                    $sent,
                    $recipientEmail
                ) . ' ' . \implode(', ', $sentLabels),
            ];
        }
        return [
            'success' => false,
            'sent' => $sent,
            'failed' => $failed,
            'message' => \sprintf(
                /* translators: 1: success count, 2: failure count, 3: recipient. */
                \__('Sent %1$d test emails and %2$d failed for %3$s.', 'must-hotel-booking'),
                $sent,
                \count($failed),
                $recipientEmail
            ) . (!empty($sentLabels) ? ' ' . \__('Sent:', 'must-hotel-booking') . ' ' . \implode(', ', $sentLabels) : ''),
        ];
    }
    /**
     * @return array<string, mixed>
     */
    public static function renderTemplatePreview(string $templateKey, int $reservationId = 0, string $recipientEmail = ''): array
    {
        $templateKey = \sanitize_key($templateKey);
        $definitions = self::getTemplateDefinitions();
        if (!isset($definitions[$templateKey])) {
            return [
                'success' => false,
                'message' => \__('Unknown email template.', 'must-hotel-booking'),
            ];
        }
        $recipientEmail = \sanitize_email($recipientEmail);
        $reservation = $reservationId > 0 ? self::getReservationForEmail($reservationId) : null;
        if ($reservationId > 0 && !\is_array($reservation)) {
            return [
                'success' => false,
                'message' => \__('Selected reservation could not be loaded for preview.', 'must-hotel-booking'),
            ];
        }
        if (\is_array($reservation)) {
            $placeholders = self::buildReservationPlaceholders($reservation);
            if ($recipientEmail !== '') {
                $placeholders['{guest_email}'] = $recipientEmail;
            }
            $meta = [
                'reservation_id' => isset($reservation['id']) ? (int) $reservation['id'] : 0,
                'booking_id' => (string) ($reservation['booking_id'] ?? ''),
                'provider_metadata' => (string) ($reservation['provider_metadata'] ?? ''),
            ];
        } else {
            $placeholders = self::buildTestPlaceholders($templateKey, $recipientEmail !== '' ? $recipientEmail : 'preview@example.com');
            $meta = self::buildTestEmailMeta();
        }
        $rendered = self::renderTemplateEmail($templateKey, $placeholders, $meta);
        return [
            'success' => true,
            'template_key' => $templateKey,
            'subject' => (string) ($rendered['subject'] ?? ''),
            'html' => (string) ($rendered['html'] ?? ''),
            'placeholders' => $placeholders,
            'reservation_id' => isset($meta['reservation_id']) ? (int) $meta['reservation_id'] : 0,
            'booking_id' => (string) ($meta['booking_id'] ?? ''),
            'is_live_context' => \is_array($reservation),
        ];
    }
    private static function sendConfirmedReservationNotifications(int $reservationId): void
    {
        $reservation = self::getReservationForEmail($reservationId);
        if ($reservation === null) {
            return;
        }
        if (\sanitize_key((string) ($reservation['status'] ?? '')) !== 'confirmed') {
            return;
        }
        $templateKeys = self::resolveConfirmedTemplateKeys($reservation);
        self::sendNotificationForTemplate($templateKeys['guest'], $reservation, (string) ($reservation['guest_email'] ?? ''), 'automated');
        self::sendNotificationForTemplate($templateKeys['admin'], $reservation, MustBookingConfig::get_booking_notification_email(), 'automated');
    }
    public static function resendGuestReservationEmail(int $reservationId): bool
    {
        $reservation = self::getReservationForEmail($reservationId);
        $templateKeys = \is_array($reservation) ? self::resolveManualTemplateKeys($reservation) : null;
        if ($reservation === null || $templateKeys === null) {
            return false;
        }
        return self::sendNotificationForTemplate(
            $templateKeys['guest'],
            $reservation,
            (string) ($reservation['guest_email'] ?? ''),
            'manual'
        );
    }
    public static function resendAdminReservationEmail(int $reservationId): bool
    {
        $reservation = self::getReservationForEmail($reservationId);
        $templateKeys = \is_array($reservation) ? self::resolveManualTemplateKeys($reservation) : null;
        if ($reservation === null || $templateKeys === null) {
            return false;
        }
        return self::sendNotificationForTemplate(
            $templateKeys['admin'],
            $reservation,
            MustBookingConfig::get_booking_notification_email(),
            'manual'
        );
    }
    /**
     * @param array<string, mixed> $reservation
     */
    private static function sendNotificationForTemplate(string $templateKey, array $reservation, string $recipientEmail, string $emailMode = 'automated'): bool
    {
        $recipientEmail = \sanitize_email($recipientEmail);
        if (!\is_email($recipientEmail)) {
            return false;
        }
        $template = self::getTemplate($templateKey);
        if (empty($template['enabled'])) {
            \do_action(
                'must_hotel_booking/email_dispatch_result',
                [
                    'success' => false,
                    'template_key' => $templateKey,
                    'recipient_email' => $recipientEmail,
                    'reservation_id' => isset($reservation['id']) ? (int) $reservation['id'] : 0,
                    'booking_id' => (string) ($reservation['booking_id'] ?? ''),
                    'email_mode' => $emailMode,
                ]
            );
            return false;
        }
        $rendered = self::renderTemplateEmail(
            $templateKey,
            self::buildReservationPlaceholders($reservation),
            [
                'reservation_id' => isset($reservation['id']) ? (int) $reservation['id'] : 0,
                'booking_id' => (string) ($reservation['booking_id'] ?? ''),
                'provider_metadata' => (string) ($reservation['provider_metadata'] ?? ''),
            ]
        );
        $sent = self::dispatchEmail($recipientEmail, $rendered['subject'], $rendered['html']);
        \do_action(
            'must_hotel_booking/email_dispatch_result',
            [
                'success' => $sent,
                'template_key' => $templateKey,
                'recipient_email' => $recipientEmail,
                'reservation_id' => isset($reservation['id']) ? (int) $reservation['id'] : 0,
                'booking_id' => (string) ($reservation['booking_id'] ?? ''),
                'email_mode' => $emailMode,
            ]
        );
        return $sent;
    }
    /**
     * @param array<string, mixed> $reservation
     * @return array{guest: string, admin: string}
     */
    private static function resolveConfirmedTemplateKeys(array $reservation): array
    {
        $paymentMethod = self::normalizeStoredPaymentMethod((string) ($reservation['payment_method'] ?? ''));
        $paymentStatus = \sanitize_key((string) ($reservation['payment_status'] ?? ''));
        if ($paymentMethod === 'stripe' || $paymentStatus === 'paid') {
            return [
                'guest' => 'guest_booking_confirmed_paid',
                'admin' => 'admin_new_booking_paid',
            ];
        }
        return [
            'guest' => 'guest_booking_confirmed_pay_at_hotel',
            'admin' => 'admin_new_booking_pay_at_hotel',
        ];
    }
    /**
     * @param array<string, mixed> $reservation
     * @return array{guest: string, admin: string}|null
     */
    private static function resolveManualTemplateKeys(array $reservation): ?array
    {
        $status = \sanitize_key((string) ($reservation['status'] ?? ''));
        $paymentStatus = \sanitize_key((string) ($reservation['payment_status'] ?? ''));
        if ($status === 'cancelled') {
            return [
                'guest' => 'guest_booking_cancelled',
                'admin' => 'admin_booking_cancelled',
            ];
        }
        if ($status === 'confirmed' || $status === 'completed' || $paymentStatus === 'paid') {
            return self::resolveConfirmedTemplateKeys($reservation);
        }
        return null;
    }
    /**
     * @param array<string, string> $placeholders
     * @param array<string, scalar> $meta
     * @return array{subject: string, html: string}
     */
    private static function renderTemplateEmail(string $templateKey, array $placeholders, array $meta): array
    {
        $definitions = self::getTemplateDefinitions();
        $definition = $definitions[$templateKey] ?? [];
        $template = self::getTemplate($templateKey);
        $subject = self::renderPlainTextTemplate((string) ($template['subject'] ?? ''), $placeholders);
        $heading = self::renderPlainTextTemplate((string) ($template['heading'] ?? ($definition['heading'] ?? '')), $placeholders);
        $hotelName = $placeholders['{hotel_name}'] ?? '';
        $hotelWebsite = $placeholders['{hotel_website}'] ?? '';
        $logoUrl = MustBookingConfig::get_email_logo_url();
        $cta = self::buildCtaContext($templateKey, $meta);
        $layoutContext = [
            'email_subject' => $subject,
            'email_heading' => $heading !== '' ? $heading : $subject,
            'email_content' => self::renderTemplateBody((string) ($template['body'] ?? ''), $placeholders),
            'email_summary_rows' => EmailLayoutEngine::renderSummaryRows(self::buildSummaryRows($placeholders, $meta)),
            'email_cta_url' => (string) ($cta['url'] ?? ''),
            'email_cta_label' => (string) ($cta['label'] ?? ''),
            'email_logo_url' => $logoUrl,
            'email_logo_block' => EmailLayoutEngine::renderLogoBlock($logoUrl, (string) $hotelName, (string) $hotelWebsite),
            'email_button_color' => MustBookingConfig::get_email_button_color(),
            'email_footer_meta' => EmailLayoutEngine::renderFooterMeta([
                'hotel_name' => (string) ($placeholders['{hotel_name}'] ?? ''),
                'hotel_address' => (string) ($placeholders['{hotel_address}'] ?? ''),
                'hotel_google_maps_url' => (string) ($placeholders['{hotel_google_maps_url}'] ?? MustBookingConfig::get_google_maps_url()),
                'hotel_website' => (string) ($placeholders['{hotel_website}'] ?? ''),
                'email_footer_text' => (string) ($placeholders['{email_footer_text}'] ?? ''),
            ]),
            'email_support_block' => EmailLayoutEngine::renderSupportBlock([
                'hotel_email' => (string) ($placeholders['{hotel_email}'] ?? ''),
                'hotel_phone' => (string) ($placeholders['{hotel_phone}'] ?? ''),
                'hotel_phone_href' => (string) ($placeholders['{hotel_phone_href}'] ?? ''),
                'hotel_website' => (string) ($placeholders['{hotel_website}'] ?? ''),
            ]),
        ];
        return [
            'subject' => $subject,
            'html' => EmailLayoutEngine::renderEmail(
                MustBookingConfig::get_email_layout_type(),
                $layoutContext,
                MustBookingConfig::get_custom_email_layout_html()
            ),
        ];
    }
    /**
     * @param array<string, string> $placeholders
     */
    private static function renderPlainTextTemplate(string $template, array $placeholders): string
    {
        $rendered = \strtr($template, self::getPlaceholderReplacementMap($placeholders, false));
        $rendered = \sanitize_text_field($rendered);
        return $rendered !== '' ? $rendered : \__('Booking Update', 'must-hotel-booking');
    }
    /**
     * @param array<string, string> $placeholders
     */
    private static function renderTemplateBody(string $template, array $placeholders): string
    {
        $template = \str_replace(["\r\n", "\r"], "\n", $template);
        $containsHtml = (bool) \preg_match('/<\s*[a-z][^>]*>/i', $template);
        if ($containsHtml) {
            $rendered = \strtr($template, self::getPlaceholderReplacementMap($placeholders, true));
            return \force_balance_tags(self::sanitizeEmailHtml($rendered));
        }
        return \wpautop(\esc_html(\strtr($template, self::getPlaceholderReplacementMap($placeholders, false))));
    }
    /**
     * @param array<string, string> $placeholders
     * @return array<string, string>
     */
    private static function getPlaceholderReplacementMap(array $placeholders, bool $htmlSafe): array
    {
        $map = [];
        foreach ($placeholders as $placeholder => $value) {
            $map[$placeholder] = $htmlSafe ? \esc_html($value) : $value;
        }
        return $map;
    }
    /**
     * @param array<string, mixed> $reservation
     * @return array<string, string>
     */
    private static function buildReservationPlaceholders(array $reservation): array
    {
        $hotelPhone = MustBookingConfig::get_hotel_phone();
        $cancellationDetails = self::buildCancellationDetailsText($reservation);
        return [
            '{booking_id}' => self::resolveBookingId($reservation),
            '{guest_name}' => self::buildGuestName(
                (string) ($reservation['first_name'] ?? ''),
                (string) ($reservation['last_name'] ?? ''),
                (string) ($reservation['guest_email'] ?? '')
            ),
            '{guest_email}' => \sanitize_email((string) ($reservation['guest_email'] ?? '')),
            '{room_name}' => self::resolveRoomName($reservation),
            '{checkin}' => self::formatBookingDate((string) ($reservation['checkin'] ?? '')),
            '{checkout}' => self::formatBookingDate((string) ($reservation['checkout'] ?? '')),
            '{total_price}' => self::formatAmount((float) ($reservation['total_price'] ?? 0)),
            '{currency}' => MustBookingConfig::get_currency(),
            '{payment_method}' => self::formatPaymentMethodLabel(self::normalizeStoredPaymentMethod((string) ($reservation['payment_method'] ?? ''))),
            '{payment_status}' => self::formatPaymentStatusLabel((string) ($reservation['payment_status'] ?? '')),
            '{hotel_name}' => MustBookingConfig::get_hotel_name(),
            '{hotel_address}' => MustBookingConfig::get_hotel_address(),
            '{hotel_google_maps_url}' => MustBookingConfig::get_google_maps_url(),
            '{hotel_email}' => MustBookingConfig::get_booking_notification_email(),
            '{hotel_phone}' => $hotelPhone,
            '{hotel_phone_href}' => self::normalizePhoneHref($hotelPhone),
            '{hotel_website}' => (string) \home_url('/'),
            '{cancellation_url}' => self::buildGuestCancellationUrl($reservation),
            '{cancellation_action_label}' => self::getCancellationActionLabel($reservation),
            '{cancellation_details}' => $cancellationDetails,
            '{email_footer_text}' => MustBookingConfig::get_email_footer_text(),
        ];
    }
    /**
     * @return array<string, string>
     */
    private static function buildTestPlaceholders(string $templateKey, string $recipientEmail): array
    {
        $checkinTimestamp = \strtotime('+14 days', (int) \current_time('timestamp'));
        $checkoutTimestamp = \strtotime('+17 days', (int) \current_time('timestamp'));
        $hotelPhone = MustBookingConfig::get_hotel_phone();
        $paymentMethod = \strpos($templateKey, '_paid') !== false ? 'stripe' : 'pay_at_hotel';
        $paymentStatus = \strpos($templateKey, 'cancelled') !== false
            ? 'cancelled'
            : (\strpos($templateKey, '_paid') !== false ? 'paid' : 'unpaid');
        return [
            '{booking_id}' => 'TEST-1001',
            '{guest_name}' => 'Alex Morgan',
            '{guest_email}' => $recipientEmail,
            '{room_name}' => 'Ocean Suite',
            '{checkin}' => $checkinTimestamp ? \wp_date('F j, Y', $checkinTimestamp) : 'June 12, 2026',
            '{checkout}' => $checkoutTimestamp ? \wp_date('F j, Y', $checkoutTimestamp) : 'June 15, 2026',
            '{total_price}' => self::formatAmount(480.00),
            '{currency}' => MustBookingConfig::get_currency(),
            '{payment_method}' => self::formatPaymentMethodLabel($paymentMethod),
            '{payment_status}' => self::formatPaymentStatusLabel($paymentStatus),
            '{hotel_name}' => MustBookingConfig::get_hotel_name(),
            '{hotel_address}' => MustBookingConfig::get_hotel_address(),
            '{hotel_google_maps_url}' => MustBookingConfig::get_google_maps_url(),
            '{hotel_email}' => MustBookingConfig::get_booking_notification_email(),
            '{hotel_phone}' => $hotelPhone,
            '{hotel_phone_href}' => self::normalizePhoneHref($hotelPhone),
            '{hotel_website}' => (string) \home_url('/'),
            '{cancellation_url}' => '',
            '{cancellation_action_label}' => \__('Review cancellation options', 'must-hotel-booking'),
            '{cancellation_details}' => \__('You can review cancellation eligibility from the link below. The website will check the hotel cancellation policy before any cancellation or refund is confirmed.', 'must-hotel-booking'),
            '{email_footer_text}' => MustBookingConfig::get_email_footer_text(),
        ];
    }
    /**
     * @param array<string, string> $placeholders
     * @return array<int, array<string, string>>
     */
    private static function buildSummaryRows(array $placeholders, array $meta = []): array
    {
        $currency = (string) ($placeholders['{currency}'] ?? MustBookingConfig::get_currency());
        $priceBreakdownRows = self::renderEmailPriceBreakdownRows($meta, $currency);
        $rows = [
            ['label' => \__('Booking reference', 'must-hotel-booking'), 'value' => (string) ($placeholders['{booking_id}'] ?? '')],
            ['label' => \__('Guest', 'must-hotel-booking'), 'value' => (string) ($placeholders['{guest_name}'] ?? '')],
            ['label' => \__('Room/rate', 'must-hotel-booking'), 'value' => (string) ($placeholders['{room_name}'] ?? '')],
            ['label' => \__('Dates', 'must-hotel-booking'), 'value' => \trim((string) ($placeholders['{checkin}'] ?? '') . ' - ' . (string) ($placeholders['{checkout}'] ?? ''), ' -')],
            ...$priceBreakdownRows,
            ...self::buildPaymentSummaryRows($placeholders, $currency),
        ];
        return \array_values(\array_filter(
            $rows,
            static function (array $row): bool {
                return \trim((string) ($row['value'] ?? '')) !== '';
            }
        ));
    }
    /**
     * @param array<string, mixed> $meta
     * @return array<int, array<string, string>>
     */
    private static function renderEmailPriceBreakdownRows(array $meta, string $currency): array
    {
        if (MustBookingConfig::get_email_price_breakdown_mode() !== 'date_price_rows') {
            return [];
        }

        $metadata = \function_exists('MustHotelBooking\\Frontend\\get_reservation_provider_metadata')
            ? \MustHotelBooking\Frontend\get_reservation_provider_metadata([
                'provider_metadata' => (string) ($meta['provider_metadata'] ?? ''),
            ])
            : [];
        $rows = \function_exists('MustHotelBooking\\Frontend\\get_price_breakdown_rows_from_metadata')
            ? \MustHotelBooking\Frontend\get_price_breakdown_rows_from_metadata($metadata)
            : [];

        if (empty($rows)) {
            return [];
        }
        if (\count($rows) <= 1) {
            return [];
        }

        $summaryRows = [
            ['label' => \__('Price details', 'must-hotel-booking'), 'value' => \__('By date', 'must-hotel-booking')],
        ];

        foreach ($rows as $row) {
            $summaryRows[] = [
                'label' => self::formatBookingDate((string) ($row['date'] ?? '')),
                'value' => self::formatAmount((float) ($row['amount'] ?? 0.0)) . ' ' . $currency,
            ];
        }

        return $summaryRows;
    }
    /**
     * @param array<string, string> $placeholders
     * @return array<int, array<string, string>>
     */
    private static function buildPaymentSummaryRows(array $placeholders, string $currency): array
    {
        $total = \trim((string) ($placeholders['{total_price}'] ?? ''));
        $paymentStatus = (string) ($placeholders['{payment_status}'] ?? '');
        $paymentMethod = (string) ($placeholders['{payment_method}'] ?? '');
        $isPaid = \sanitize_key($paymentStatus) === 'paid';
        $totalValue = \trim($total . ' ' . $currency);

        return [
            ['label' => \__('Total price', 'must-hotel-booking'), 'value' => $totalValue],
            ['label' => \__('Paid', 'must-hotel-booking'), 'value' => $isPaid ? $totalValue : \trim(self::formatAmount(0.0) . ' ' . $currency)],
            ['label' => \__('Balance due', 'must-hotel-booking'), 'value' => $isPaid ? \trim(self::formatAmount(0.0) . ' ' . $currency) : $totalValue],
            ['label' => \__('Payment method', 'must-hotel-booking'), 'value' => $paymentMethod],
            ['label' => \__('Payment status', 'must-hotel-booking'), 'value' => $paymentStatus],
        ];
    }
    /**
     * @param array<string, scalar> $meta
     * @return array{label: string, url: string}
     */
    private static function buildCtaContext(string $templateKey, array $meta): array
    {
        $definition = self::getTemplateDefinitions()[$templateKey] ?? [];
        $audience = (string) ($definition['audience'] ?? 'guest');
        $label = (string) ($definition['cta_label'] ?? '');
        $reservationId = isset($meta['reservation_id']) ? (int) $meta['reservation_id'] : 0;
        if ($audience === 'admin') {
            if (\function_exists('MustHotelBooking\\Admin\\get_admin_reservation_detail_page_url') && $reservationId > 0) {
                $url = \MustHotelBooking\Admin\get_admin_reservation_detail_page_url($reservationId);
            } elseif (\function_exists('MustHotelBooking\\Admin\\get_admin_reservations_page_url')) {
                $url = \MustHotelBooking\Admin\get_admin_reservations_page_url();
            } else {
                $url = \admin_url('admin.php?page=must-hotel-booking-reservations');
            }
            return [
                'label' => $label !== '' ? $label : \__('Open reservation', 'must-hotel-booking'),
                'url' => $url,
            ];
        }
        $reservation = $reservationId > 0 ? self::getReservationForEmail($reservationId) : null;
        $url = \is_array($reservation)
            ? self::buildGuestPublicAccessUrl($reservation, PublicBookingAccessService::PURPOSE_VIEW_CONFIRMATION)
            : '';
        return [
            'label' => $label !== '' ? $label : \__('View booking', 'must-hotel-booking'),
            'url' => $url,
        ];
    }
    /**
     * @return array<string, scalar>
     */
    private static function buildTestEmailMeta(): array
    {
        return [
            'reservation_id' => 0,
            'booking_id' => 'TEST-1001',
        ];
    }
    private static function dispatchEmail(string $recipientEmail, string $subject, string $html): bool
    {
        $recipientEmail = \sanitize_email($recipientEmail);
        if (!\is_email($recipientEmail)) {
            return false;
        }
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        $fromEmail = MustBookingConfig::get_email_from_email();
        $fromName = MustBookingConfig::get_email_from_name();
        $replyTo = MustBookingConfig::get_email_reply_to();
        if (\is_email($fromEmail)) {
            $headers[] = 'From: ' . \wp_specialchars_decode($fromName, ENT_QUOTES) . ' <' . $fromEmail . '>';
        }
        if (\is_email($replyTo)) {
            $headers[] = 'Reply-To: ' . $replyTo;
        }
        return (bool) \wp_mail(
            $recipientEmail,
            $subject,
            $html,
            $headers
        );
    }
    /**
     * @return array<string, mixed>|null
     */
    private static function getReservationForEmail(int $reservationId): ?array
    {
        if ($reservationId <= 0) {
            return null;
        }
        $reservation = get_reservation_repository()->getReservationEmailData($reservationId);
        return \is_array($reservation) ? $reservation : null;
    }
    /**
     * @param array<string, mixed> $template
     * @param array<string, mixed> $defaults
     * @return array<string, mixed>
     */
    private static function sanitizeTemplateRow(array $template, array $defaults): array
    {
        $enabled = !empty($template['enabled']) ? 1 : (!empty($defaults['enabled']) ? 1 : 0);
        $subject = isset($template['subject']) ? \sanitize_text_field((string) $template['subject']) : '';
        $heading = isset($template['heading']) ? \sanitize_text_field((string) $template['heading']) : '';
        $body = isset($template['body']) ? \str_replace(["\r\n", "\r"], "\n", (string) $template['body']) : '';
        $updatedAt = isset($template['updated_at']) ? \sanitize_text_field((string) $template['updated_at']) : '';
        if ($subject === '') {
            $subject = (string) ($defaults['subject'] ?? '');
        }
        if ($heading === '') {
            $heading = (string) ($defaults['heading'] ?? '');
        }
        if (\trim($body) === '') {
            $body = (string) ($defaults['body'] ?? '');
        }
        return [
            'enabled' => $enabled,
            'subject' => $subject,
            'heading' => $heading,
            'body' => $body,
            'updated_at' => $updatedAt,
        ];
    }
    /**
     * @param array<string, mixed> $reservation
     */
    public static function buildGuestCancellationUrl(array $reservation): string
    {
        return self::buildGuestPublicAccessUrl($reservation, PublicBookingAccessService::PURPOSE_REVIEW_CANCELLATION);
    }

    /** @param array<string, mixed> $reservation */
    private static function buildGuestPublicAccessUrl(array $reservation, string $purpose): string
    {
        $reservationId = isset($reservation['id']) ? (int) $reservation['id'] : 0;
        $reservationIds = self::resolveTrustedReservationGroup($reservation);
        if ($reservationId <= 0 || empty($reservationIds)) {
            return '';
        }

        return (new PublicBookingAccessService())->buildPublicUrl(
            ManagedPages::getBookingConfirmationPageUrl(),
            $reservationIds,
            $purpose,
            $purpose === PublicBookingAccessService::PURPOSE_REVIEW_CANCELLATION
                ? ['must_action' => 'review_cancellation']
                : []
        );
    }

    /** @param array<string, mixed> $reservation @return array<int, int> */
    private static function resolveTrustedReservationGroup(array $reservation): array
    {
        $reservationId = isset($reservation['id']) ? (int) $reservation['id'] : 0;
        if ($reservationId <= 0) {
            return [];
        }

        $payments = get_payment_repository()->getPaymentsForReservation($reservationId);
        $onlineCandidates = [];
        foreach ($payments as $payment) {
            if (!\is_array($payment)) {
                continue;
            }
            $candidateMethod = \sanitize_key((string) ($payment['method'] ?? ''));
            $candidateTransactionId = \sanitize_text_field((string) ($payment['transaction_id'] ?? ''));
            $candidateStatus = \sanitize_key((string) ($payment['status'] ?? ''));
            if (
                !\in_array($candidateMethod, ['stripe', 'pokpay'], true)
                || $candidateTransactionId === ''
                || \in_array($candidateStatus, ['failed', 'refunded', 'refund', 'cancelled'], true)
            ) {
                continue;
            }

            $candidateGroup = PublicBookingAccessService::normalizeReservationIds(
                get_payment_repository()->findReservationIdsByTransactionId($candidateTransactionId)
            );
            if (!\in_array($reservationId, $candidateGroup, true)) {
                continue;
            }
            $onlineCandidates[] = [
                'transaction_id' => $candidateTransactionId,
                'reservation_ids' => $candidateGroup,
            ];
        }
        if (!empty($onlineCandidates)) {
            $transactionIds = [];
            $candidateGroups = [];
            foreach ($onlineCandidates as $candidate) {
                $transactionId = (string) ($candidate['transaction_id'] ?? '');
                $group = PublicBookingAccessService::normalizeReservationIds((array) ($candidate['reservation_ids'] ?? []));
                if ($transactionId === '' || empty($group)) {
                    return [];
                }
                $transactionIds[$transactionId] = true;
                $candidateGroups[implode(',', $group)] = $group;
            }
            if (count($transactionIds) !== 1 || count($candidateGroups) !== 1) {
                return [];
            }
            return array_values($candidateGroups)[0];
        }

        $method = \sanitize_key((string) ($reservation['payment_method'] ?? ''));
        if (\in_array($method, ['stripe', 'pokpay'], true)) {
            // An online payment event without one unambiguous trusted
            // allocation must not receive a broad single-reservation grant.
            return [];
        }

        $bookingId = trim((string) ($reservation['booking_id'] ?? ''));
        if ($bookingId === '' || !method_exists(get_reservation_repository(), 'getConfirmationRowsByBookingId')) {
            return [];
        }
        $bookingRows = get_reservation_repository()->getConfirmationRowsByBookingId($bookingId);
        $bookingReservationIds = [];
        foreach ($bookingRows as $bookingRow) {
            if (is_array($bookingRow) && isset($bookingRow['id'])) {
                $bookingReservationIds[] = $bookingRow['id'];
            }
        }
        $bookingReservationIds = PublicBookingAccessService::normalizeReservationIds($bookingReservationIds);
        return in_array($reservationId, $bookingReservationIds, true) ? $bookingReservationIds : [];
    }
    /**
     * @param array<string, mixed> $reservation
     */
    private static function resolveBookingId(array $reservation): string
    {
        $bookingId = \trim((string) ($reservation['booking_id'] ?? ''));
        if ($bookingId !== '') {
            return $bookingId;
        }
        $reservationId = isset($reservation['id']) ? (int) $reservation['id'] : 0;
        return $reservationId > 0 ? 'RES-' . $reservationId : '';
    }
    /**
     * @param array<string, mixed> $reservation
     */
    private static function resolveRoomName(array $reservation): string
    {
        $roomName = \trim((string) ($reservation['room_name'] ?? ''));
        if ($roomName !== '') {
            return $roomName;
        }
        $ratePlanName = \trim((string) ($reservation['rate_plan_name'] ?? ''));
        return $ratePlanName !== '' ? $ratePlanName : \__('Room selection pending', 'must-hotel-booking');
    }
    private static function buildGuestName(string $firstName, string $lastName, string $fallbackEmail): string
    {
        $guestName = \trim($firstName . ' ' . $lastName);
        if ($guestName !== '') {
            return $guestName;
        }
        return $fallbackEmail !== '' ? $fallbackEmail : \__('Guest', 'must-hotel-booking');
    }
    private static function formatBookingDate(string $date): string
    {
        $timestamp = \strtotime($date . ' 00:00:00');
        if ($timestamp === false) {
            return $date;
        }
        return \wp_date('F j, Y', $timestamp);
    }
    private static function formatAmount(float $amount): string
    {
        return \number_format_i18n($amount, 2);
    }
    /**
     * @param array<string, mixed> $reservation
     */
    private static function getCancellationActionLabel(array $reservation): string
    {
        return \__('Review cancellation options', 'must-hotel-booking');
    }

    /**
     * @param array<string, mixed> $reservation
     */
    public static function canAutoCancelReservation(array $reservation): bool
    {
        unset($reservation);

        return false;
    }
    /**
     * @param array<string, mixed> $reservation
     */
    private static function buildCancellationDetailsText(array $reservation): string
    {
        $reservationId = isset($reservation['id']) ? (int) $reservation['id'] : 0;
        $details = $reservationId > 0 ? CancellationEngine::getPenaltyDetails($reservationId, \current_time('mysql')) : [];

        if (!empty($details['policy_name'])) {
            return \sprintf(
                /* translators: %s is policy name. */
                \__('You can review cancellation eligibility from the link below. The website will check the hotel cancellation policy before any cancellation or refund is confirmed. Cancellation policy: %s.', 'must-hotel-booking'),
                (string) $details['policy_name']
            );
        }

        return \__('You can review cancellation eligibility from the link below. The website will check the hotel cancellation policy before any cancellation or refund is confirmed.', 'must-hotel-booking');
    }
    private static function sanitizeEmailHtml(string $html): string
    {
        $allowed = \wp_kses_allowed_html('post');
        $globalAttrs = ['style' => true, 'class' => true, 'id' => true];
        $extraTags = [
            'table' => ['style' => true, 'class' => true, 'width' => true, 'border' => true, 'cellpadding' => true, 'cellspacing' => true, 'align' => true, 'role' => true],
            'tbody' => $globalAttrs,
            'thead' => $globalAttrs,
            'tfoot' => $globalAttrs,
            'tr' => $globalAttrs,
            'td' => ['style' => true, 'class' => true, 'colspan' => true, 'rowspan' => true, 'align' => true, 'valign' => true, 'width' => true],
            'th' => ['style' => true, 'class' => true, 'colspan' => true, 'rowspan' => true, 'align' => true, 'valign' => true, 'width' => true, 'scope' => true],
            'div' => $globalAttrs,
            'span' => $globalAttrs,
            'p' => ['style' => true, 'class' => true, 'align' => true],
            'a' => ['href' => true, 'style' => true, 'class' => true, 'target' => true, 'rel' => true, 'title' => true],
            'img' => ['src' => true, 'alt' => true, 'width' => true, 'height' => true, 'style' => true, 'class' => true],
            'h1' => $globalAttrs,
            'h2' => $globalAttrs,
            'h3' => $globalAttrs,
            'h4' => $globalAttrs,
            'ul' => $globalAttrs,
            'ol' => $globalAttrs,
            'li' => $globalAttrs,
            'br' => [],
            'hr' => ['style' => true, 'class' => true],
            'strong' => $globalAttrs,
            'em' => $globalAttrs,
        ];
        foreach ($extraTags as $tag => $attrs) {
            $allowed[$tag] = isset($allowed[$tag]) && \is_array($allowed[$tag])
                ? \array_merge($allowed[$tag], $attrs)
                : $attrs;
        }
        return \wp_kses($html, $allowed);
    }
    private static function normalizeStoredPaymentMethod(string $method): string
    {
        $method = \sanitize_key($method);
        return $method !== '' ? $method : 'not_set';
    }
    private static function formatPaymentMethodLabel(string $method): string
    {
        if ($method === 'stripe') {
            return \__('Stripe', 'must-hotel-booking');
        }
        if ($method === 'pokpay') {
            return \__('PokPay', 'must-hotel-booking');
        }
        if ($method === 'pay_at_hotel' || $method === 'cash') {
            return \__('Pay at hotel', 'must-hotel-booking');
        }
        return $method !== '' ? \ucwords(\str_replace('_', ' ', $method)) : \__('Not set', 'must-hotel-booking');
    }
    private static function formatPaymentStatusLabel(string $status): string
    {
        $status = \sanitize_key($status);
        if ($status === 'paid') {
            return \__('Paid', 'must-hotel-booking');
        }
        if ($status === 'unpaid') {
            return \__('Unpaid', 'must-hotel-booking');
        }
        if ($status === 'pending') {
            return \__('Pending', 'must-hotel-booking');
        }
        if ($status === 'cancelled') {
            return \__('Cancelled', 'must-hotel-booking');
        }
        return $status !== '' ? \ucwords(\str_replace('_', ' ', $status)) : \__('Not set', 'must-hotel-booking');
    }
    private static function normalizePhoneHref(string $phoneNumber): string
    {
        $phoneNumber = \trim($phoneNumber);
        if ($phoneNumber === '') {
            return '';
        }
        $normalized = (string) \preg_replace('/[^0-9+]/', '', $phoneNumber);
        return $normalized !== '' ? 'tel:' . $normalized : '';
    }
    /**
     * @return array<string, array<string, string>>
     */
    public static function getTemplateDefinitions(): array
    {
        return [
            'guest_booking_confirmed_paid' => [
                'label' => \__('Guest: Booking Confirmed (Paid)', 'must-hotel-booking'),
                'audience' => 'guest',
                'flow_type' => 'paid',
                'trigger' => \__('Sent when a reservation becomes confirmed with a paid online booking.', 'must-hotel-booking'),
                'used_in_flow' => true,
                'enabled' => 1,
                'heading' => \__('Your stay is confirmed', 'must-hotel-booking'),
                'cta_label' => \__('View booking', 'must-hotel-booking'),
                'subject' => \__('Paid booking {booking_id} confirmed at {hotel_name}', 'must-hotel-booking'),
                'body' => \__("<p>Hello {guest_name},</p><p>Thank you for choosing {hotel_name}. Your payment has been received and your reservation is confirmed.</p><p>Your stay in <strong>{room_name}</strong> is booked from <strong>{checkin}</strong> to <strong>{checkout}</strong>.</p><p>{cancellation_details}</p><p><a href=\"{cancellation_url}\">{cancellation_action_label}</a></p>", 'must-hotel-booking'),
            ],
            'guest_booking_confirmed_pay_at_hotel' => [
                'label' => \__('Guest: Booking Confirmed (Pay at Hotel)', 'must-hotel-booking'),
                'audience' => 'guest',
                'flow_type' => 'pay_at_hotel',
                'trigger' => \__('Sent when a reservation is confirmed with payment collected at the hotel.', 'must-hotel-booking'),
                'used_in_flow' => true,
                'enabled' => 1,
                'heading' => \__('Your stay is confirmed', 'must-hotel-booking'),
                'cta_label' => \__('View booking', 'must-hotel-booking'),
                'subject' => \__('Pay-at-hotel booking {booking_id} confirmed at {hotel_name}', 'must-hotel-booking'),
                'body' => \__("<p>Hello {guest_name},</p><p>Your reservation at {hotel_name} is confirmed.</p><p>Your stay in <strong>{room_name}</strong> is booked from <strong>{checkin}</strong> to <strong>{checkout}</strong>. Payment will be collected at the hotel.</p><p>{cancellation_details}</p><p><a href=\"{cancellation_url}\">{cancellation_action_label}</a></p>", 'must-hotel-booking'),
            ],
            'admin_new_booking_paid' => [
                'label' => \__('Admin: New Booking (Paid)', 'must-hotel-booking'),
                'audience' => 'admin',
                'flow_type' => 'paid',
                'trigger' => \__('Sent to staff when a paid booking is confirmed.', 'must-hotel-booking'),
                'used_in_flow' => true,
                'enabled' => 1,
                'heading' => \__('New paid booking received', 'must-hotel-booking'),
                'cta_label' => \__('Open reservation', 'must-hotel-booking'),
                'subject' => \__('New paid booking {booking_id} for {guest_name}', 'must-hotel-booking'),
                'body' => \__("<p>A new paid booking has been confirmed.</p><p><strong>Guest:</strong> {guest_name}<br /><strong>Email:</strong> {guest_email}<br /><strong>Room:</strong> {room_name}<br /><strong>Stay:</strong> {checkin} to {checkout}</p><p>{cancellation_details}</p>", 'must-hotel-booking'),
            ],
            'admin_new_booking_pay_at_hotel' => [
                'label' => \__('Admin: New Booking (Pay at Hotel)', 'must-hotel-booking'),
                'audience' => 'admin',
                'flow_type' => 'pay_at_hotel',
                'trigger' => \__('Sent to staff when a pay-at-hotel booking is confirmed.', 'must-hotel-booking'),
                'used_in_flow' => true,
                'enabled' => 1,
                'heading' => \__('New pay-at-hotel booking received', 'must-hotel-booking'),
                'cta_label' => \__('Open reservation', 'must-hotel-booking'),
                'subject' => \__('New pay-at-hotel booking {booking_id} for {guest_name}', 'must-hotel-booking'),
                'body' => \__("<p>A new reservation has been confirmed with payment to be collected at the hotel.</p><p><strong>Guest:</strong> {guest_name}<br /><strong>Email:</strong> {guest_email}<br /><strong>Room:</strong> {room_name}<br /><strong>Stay:</strong> {checkin} to {checkout}</p><p>{cancellation_details}</p>", 'must-hotel-booking'),
            ],
            'guest_booking_cancelled' => [
                'label' => \__('Guest: Booking Cancelled', 'must-hotel-booking'),
                'audience' => 'guest',
                'flow_type' => 'general',
                'trigger' => \__('Sent when a reservation is cancelled.', 'must-hotel-booking'),
                'used_in_flow' => true,
                'enabled' => 1,
                'heading' => \__('Your booking was cancelled', 'must-hotel-booking'),
                'cta_label' => \__('Review booking', 'must-hotel-booking'),
                'subject' => \__('Booking {booking_id} cancelled', 'must-hotel-booking'),
                'body' => \__("<p>Hello {guest_name},</p><p>Your booking for <strong>{room_name}</strong> from <strong>{checkin}</strong> to <strong>{checkout}</strong> has been cancelled.</p><p>If you need help with a new reservation, contact {hotel_name}.</p>", 'must-hotel-booking'),
            ],
            'admin_booking_cancelled' => [
                'label' => \__('Admin: Booking Cancelled', 'must-hotel-booking'),
                'audience' => 'admin',
                'flow_type' => 'general',
                'trigger' => \__('Sent to staff when a reservation is cancelled.', 'must-hotel-booking'),
                'used_in_flow' => true,
                'enabled' => 1,
                'heading' => \__('Booking cancelled', 'must-hotel-booking'),
                'cta_label' => \__('Open reservation', 'must-hotel-booking'),
                'subject' => \__('Booking {booking_id} cancelled by or for {guest_name}', 'must-hotel-booking'),
                'body' => \__("<p>A booking has been cancelled.</p><p><strong>Guest:</strong> {guest_name}<br /><strong>Email:</strong> {guest_email}<br /><strong>Room:</strong> {room_name}<br /><strong>Stay:</strong> {checkin} to {checkout}</p>", 'must-hotel-booking'),
            ],
        ];
    }
}
