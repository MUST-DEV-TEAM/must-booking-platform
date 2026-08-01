<?php
namespace MustHotelBooking\Engine;
final class EmailLayoutEngine
{
    public const DEFAULT_LAYOUT_TYPE = 'classic';
    /**
     * @return array<string, string>
     */
    public static function getLayoutTypeLabels(): array
    {
        return [
            'classic' => \__('Classic', 'must-hotel-booking'),
            'luxury' => \__('Luxury', 'must-hotel-booking'),
            'compact' => \__('Compact', 'must-hotel-booking'),
            'custom' => \__('Custom', 'must-hotel-booking'),
        ];
    }
    public static function normalizeLayoutType(string $layoutType): string
    {
        $layoutType = \sanitize_key($layoutType);
        $labels = self::getLayoutTypeLabels();
        return isset($labels[$layoutType]) ? $layoutType : self::DEFAULT_LAYOUT_TYPE;
    }
    /**
     * @return array<int, string>
     */
    public static function getSupportedLayoutPlaceholders(): array
    {
        return [
            '{email_subject}',
            '{email_heading}',
            '{email_content}',
            '{email_summary_rows}',
            '{email_cta_url}',
            '{email_cta_label}',
            '{email_logo_url}',
            '{email_logo_block}',
            '{email_button_color}',
            '{email_footer_meta}',
            '{email_support_block}',
        ];
    }
    public static function getStarterCustomLayoutHtml(): string
    {
        return <<<'HTML'
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{email_subject}</title>
</head>
<body style="margin:0; padding:0; background:#f4f1ea;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea; border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px; border-collapse:collapse; background:#ffffff;">
          <tr>
            <td style="padding:32px 32px 20px 32px;">
              {email_logo_block}
              <h1 style="margin:0 0 18px 0; font-family:Arial, sans-serif; font-size:30px; line-height:1.2; color:#141414;">{email_heading}</h1>
              <div style="font-family:Arial, sans-serif; font-size:16px; line-height:1.7; color:#141414;">
                {email_content}
              </div>
              <div style="margin-top:24px;">
                {email_summary_rows}
              </div>
              <div style="margin-top:24px;">
                <a href="{email_cta_url}" style="display:inline-block; padding:14px 24px; background:{email_button_color}; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif; font-size:15px; font-weight:600;">{email_cta_label}</a>
              </div>
              <div style="margin-top:28px;">
                {email_support_block}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px;">
              {email_footer_meta}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
HTML;
    }
    /**
     * @param array<int, array<string, string>> $rows
     */
    public static function renderSummaryRows(array $rows): string
    {
        $normalizedRows = [];
        foreach ($rows as $row) {
            if (!\is_array($row)) {
                continue;
            }
            $label = isset($row['label']) ? \trim((string) $row['label']) : '';
            $value = isset($row['value']) ? \trim((string) $row['value']) : '';
            if ($label === '' || $value === '') {
                continue;
            }
            $normalizedRows[] = [
                'label' => $label,
                'value' => $value,
            ];
        }
        if (empty($normalizedRows)) {
            return '';
        }
        $html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border:1px solid #d8d2c4;">';
        $html .= '<tr><td colspan="2" style="padding:12px 16px; background:#f7f4ec; font-family:Arial, sans-serif; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#141414;">' . \esc_html__('Booking Summary', 'must-hotel-booking') . '</td></tr>';
        foreach ($normalizedRows as $index => $row) {
            $borderStyle = $index > 0 ? ' border-top:1px solid #e5dfd2;' : '';
            $html .= '<tr>';
            $html .= '<td style="padding:12px 16px; width:38%; vertical-align:top; font-family:Arial, sans-serif; font-size:14px; font-weight:600; color:#58544a;' . $borderStyle . '">' . \esc_html($row['label']) . '</td>';
            $html .= '<td style="padding:12px 16px; vertical-align:top; font-family:Arial, sans-serif; font-size:14px; color:#141414;' . $borderStyle . '">' . \esc_html($row['value']) . '</td>';
            $html .= '</tr>';
        }
        $html .= '</table>';
        return $html;
    }
    public static function renderLogoBlock(string $logoUrl, string $hotelName, string $websiteUrl = ''): string
    {
        $logoUrl = \esc_url($logoUrl);
        $websiteUrl = \esc_url($websiteUrl);
        $hotelName = \trim($hotelName);

        if ($logoUrl !== '') {
            $imageHtml = '<img src="' . $logoUrl . '" alt="' . \esc_attr($hotelName !== '' ? $hotelName : \__('Hotel logo', 'must-hotel-booking')) . '" width="180" style="display:block; width:180px; max-width:180px; height:auto; border:0; outline:none; text-decoration:none;" />';

            if ($websiteUrl !== '') {
                $imageHtml = '<a href="' . $websiteUrl . '" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">' . $imageHtml . '</a>';
            }

            return '<div style="margin:0 0 24px 0;">' . $imageHtml . '</div>';
        }

        if ($hotelName === '') {
            return '';
        }

        if ($websiteUrl !== '') {
            return '<div style="margin:0 0 24px 0;"><a href="' . $websiteUrl . '" target="_blank" rel="noopener noreferrer" style="font-family:Arial, sans-serif; font-size:18px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#141414; text-decoration:none;">' . \esc_html($hotelName) . '</a></div>';
        }

        return '<div style="margin:0 0 24px 0; font-family:Arial, sans-serif; font-size:18px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#141414;">' . \esc_html($hotelName) . '</div>';
    }
    /**
     * @param array<string, string> $context
     */
    public static function renderFooterMeta(array $context): string
    {
        $hotelName = \trim((string) ($context['hotel_name'] ?? ''));
        $hotelAddress = \trim((string) ($context['hotel_address'] ?? ''));
        $footerText = \trim((string) ($context['email_footer_text'] ?? ''));
        $websiteUrl = \esc_url((string) ($context['hotel_website'] ?? ''));
        $mapsUrl = \esc_url((string) ($context['hotel_google_maps_url'] ?? ''));

        if ($mapsUrl === '' && $hotelAddress !== '') {
            $mapsQuery = \wp_strip_all_tags($hotelAddress);
            $mapsQuery = (string) \preg_replace('/\s+/', ' ', $mapsQuery);
            $mapsQuery = \trim($mapsQuery);

            if ($mapsQuery !== '') {
                $mapsUrl = \esc_url('https://www.google.com/maps/search/?api=1&query=' . \rawurlencode($mapsQuery));
            }
        }

        $parts = [];

        if ($footerText !== '') {
            $parts[] = '<p style="margin:0 0 10px 0;">' . \esc_html($footerText) . '</p>';
        }

        if ($hotelName !== '') {
            $parts[] = '<p style="margin:0; font-weight:700;">' . \esc_html($hotelName) . '</p>';
        }

        if ($hotelAddress !== '') {
            $addressHtml = \nl2br(\esc_html($hotelAddress));

            if ($mapsUrl !== '') {
                $addressHtml = '<a href="' . $mapsUrl . '" target="_blank" rel="noopener noreferrer" style="color:#141414; text-decoration:underline;">' . $addressHtml . '</a>';
            }

            $parts[] = '<p style="margin:6px 0 0 0;">' . $addressHtml . '</p>';
        }

        if ($websiteUrl !== '') {
            $parts[] = '<p style="margin:6px 0 0 0;"><a href="' . $websiteUrl . '" target="_blank" rel="noopener noreferrer" style="color:#141414; text-decoration:underline;">' . \esc_html($websiteUrl) . '</a></p>';
        }

        if (empty($parts)) {
            return '';
        }

        return '<div style="font-family:Arial, sans-serif; font-size:13px; line-height:1.7; color:#5f5a50;">' . \implode('', $parts) . '</div>';
    }
    /**
     * @param array<string, string> $context
     */
    public static function renderSupportBlock(array $context): string
    {
        $email = \sanitize_email((string) ($context['hotel_email'] ?? ''));
        $phone = \trim((string) ($context['hotel_phone'] ?? ''));
        $phoneHref = \trim((string) ($context['hotel_phone_href'] ?? ''));
        $websiteUrl = \esc_url((string) ($context['hotel_website'] ?? ''));
        $links = [];
        if ($email !== '') {
            $links[] = '<a href="mailto:' . \esc_attr($email) . '" style="color:#141414; text-decoration:underline;">' . \esc_html($email) . '</a>';
        }
        if ($phone !== '' && $phoneHref !== '') {
            $links[] = '<a href="' . \esc_attr($phoneHref) . '" style="color:#141414; text-decoration:underline;">' . \esc_html($phone) . '</a>';
        } elseif ($phone !== '') {
            $links[] = \esc_html($phone);
        }
        if ($websiteUrl !== '') {
            $links[] = '<a href="' . $websiteUrl . '" style="color:#141414; text-decoration:underline;">' . \esc_html($websiteUrl) . '</a>';
        }
        if (empty($links)) {
            return '';
        }
        return '<div style="padding:16px 18px; border:1px solid #ddd6c8; background:#faf7f0;"><p style="margin:0 0 8px 0; font-family:Arial, sans-serif; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#141414;">' . \esc_html__('Need Help?', 'must-hotel-booking') . '</p><p style="margin:0; font-family:Arial, sans-serif; font-size:14px; line-height:1.7; color:#141414;">' . \implode(' &nbsp;|&nbsp; ', $links) . '</p></div>';
    }
    /**
     * @param array<string, string> $context
     */
    public static function renderEmail(string $layoutType, array $context, string $customLayoutHtml = ''): string
    {
        $layoutType = self::normalizeLayoutType($layoutType);
        $context = self::normalizeContext($context);
        if ($layoutType === 'luxury') {
            return self::renderLuxuryLayout($context);
        }
        if ($layoutType === 'compact') {
            return self::renderCompactLayout($context);
        }
        if ($layoutType === 'custom') {
            return self::renderCustomLayout($context, $customLayoutHtml);
        }
        return self::renderClassicLayout($context);
    }
    /**
     * @param array<string, string> $context
     * @return array<string, string>
     */
    private static function normalizeContext(array $context): array
    {
        $defaults = [
            'email_subject' => '',
            'email_heading' => '',
            'email_content' => '',
            'email_summary_rows' => '',
            'email_cta_url' => '',
            'email_cta_label' => '',
            'email_logo_url' => '',
            'email_logo_block' => '',
            'email_button_color' => '#141414',
            'email_footer_meta' => '',
            'email_support_block' => '',
        ];
        $normalized = [];
        foreach ($defaults as $key => $defaultValue) {
            $value = isset($context[$key]) ? $context[$key] : $defaultValue;
            $normalized[$key] = \is_scalar($value) ? (string) $value : $defaultValue;
        }
        $buttonColor = \sanitize_hex_color($normalized['email_button_color']);
        $normalized['email_button_color'] = \is_string($buttonColor) && $buttonColor !== '' ? $buttonColor : '#141414';
        return $normalized;
    }
    /**
     * @param array<string, string> $context
     * @return array<string, string>
     */
    private static function getLayoutPlaceholderMap(array $context): array
    {
        return [
            '{email_subject}' => \esc_html($context['email_subject']),
            '{email_heading}' => \esc_html($context['email_heading']),
            '{email_content}' => $context['email_content'],
            '{email_summary_rows}' => $context['email_summary_rows'],
            '{email_cta_url}' => \esc_url($context['email_cta_url']),
            '{email_cta_label}' => \esc_html($context['email_cta_label']),
            '{email_logo_url}' => \esc_url($context['email_logo_url']),
            '{email_logo_block}' => $context['email_logo_block'],
            '{email_button_color}' => $context['email_button_color'],
            '{email_footer_meta}' => $context['email_footer_meta'],
            '{email_support_block}' => $context['email_support_block'],
        ];
    }
    /**
     * @param array<string, string> $context
     */
    private static function renderCustomLayout(array $context, string $customLayoutHtml): string
    {
        $template = \trim($customLayoutHtml) !== ''
            ? $customLayoutHtml
            : self::getStarterCustomLayoutHtml();
        return \strtr($template, self::getLayoutPlaceholderMap($context));
    }
    /**
     * @param array<string, string> $context
     */
    private static function renderClassicLayout(array $context): string
    {
        $buttonHtml = self::renderCtaButton($context['email_cta_url'], $context['email_cta_label'], $context['email_button_color']);
        $summaryHtml = $context['email_summary_rows'] !== ''
            ? '<div style="margin:28px 0 0 0;">' . $context['email_summary_rows'] . '</div>'
            : '';
        $supportHtml = $context['email_support_block'] !== ''
            ? '<div style="margin:28px 0 0 0;">' . $context['email_support_block'] . '</div>'
            : '';
        $footerHtml = $context['email_footer_meta'] !== ''
            ? '<div style="padding:0 36px 32px 36px;">' . $context['email_footer_meta'] . '</div>'
            : '';
        $content = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px; border-collapse:collapse; background:#ffffff; border:1px solid #e2dccf;">';
        $content .= '<tr><td style="padding:36px 36px 24px 36px;">';
        $content .= $context['email_logo_block'];
        $content .= '<h1 style="margin:0 0 18px 0; font-family:Arial, sans-serif; font-size:30px; line-height:1.2; color:#141414;">' . \esc_html($context['email_heading']) . '</h1>';
        $content .= '<div style="font-family:Arial, sans-serif; font-size:16px; line-height:1.75; color:#141414;">' . $context['email_content'] . '</div>';
        $content .= $summaryHtml;
        $content .= $buttonHtml;
        $content .= $supportHtml;
        $content .= '</td></tr>';
        $content .= '<tr><td style="border-top:1px solid #ece6d9;"></td></tr>';
        $content .= '<tr><td>' . $footerHtml . '</td></tr>';
        $content .= '</table>';
        return self::renderDocument($context['email_subject'], '#f4f1ea', $content, '32px 16px');
    }
    /**
     * @param array<string, string> $context
     */
    private static function renderLuxuryLayout(array $context): string
    {
        $buttonHtml = self::renderCtaButton($context['email_cta_url'], $context['email_cta_label'], $context['email_button_color'], ['text_color' => '#f7f0e1']);
        $summaryHtml = $context['email_summary_rows'] !== ''
            ? '<div style="margin:30px 0 0 0;">' . $context['email_summary_rows'] . '</div>'
            : '';
        $supportHtml = $context['email_support_block'] !== ''
            ? '<div style="margin:30px 0 0 0;">' . $context['email_support_block'] . '</div>'
            : '';
        $footerHtml = $context['email_footer_meta'] !== ''
            ? '<div style="padding:0 40px 34px 40px;">' . $context['email_footer_meta'] . '</div>'
            : '';
        $content = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px; border-collapse:collapse; background:#f7f0e1; border:1px solid #8c7a58;">';
        $content .= '<tr><td style="padding:20px 40px 0 40px; font-family:Georgia, serif; font-size:12px; letter-spacing:0.22em; text-transform:uppercase; color:#7a6a4c;">' . \esc_html__('MUST Hotel Booking', 'must-hotel-booking') . '</td></tr>';
        $content .= '<tr><td style="padding:22px 40px 24px 40px;">';
        $content .= $context['email_logo_block'];
        $content .= '<h1 style="margin:0 0 20px 0; font-family:Georgia, serif; font-size:36px; line-height:1.15; font-weight:400; color:#201a13;">' . \esc_html($context['email_heading']) . '</h1>';
        $content .= '<div style="font-family:Arial, sans-serif; font-size:16px; line-height:1.8; color:#2f281d;">' . $context['email_content'] . '</div>';
        $content .= $summaryHtml;
        $content .= $buttonHtml;
        $content .= $supportHtml;
        $content .= '</td></tr>';
        $content .= '<tr><td style="padding:0 40px 22px 40px;"><div style="height:1px; background:#b3a281;"></div></td></tr>';
        $content .= '<tr><td>' . $footerHtml . '</td></tr>';
        $content .= '</table>';
        return self::renderDocument($context['email_subject'], '#1b1611', $content, '36px 18px');
    }
    /**
     * @param array<string, string> $context
     */
    private static function renderCompactLayout(array $context): string
    {
        $buttonHtml = self::renderCtaButton($context['email_cta_url'], $context['email_cta_label'], $context['email_button_color'], ['padding' => '11px 18px', 'font_size' => '14px']);
        $summaryHtml = $context['email_summary_rows'] !== ''
            ? '<div style="margin:20px 0 0 0;">' . $context['email_summary_rows'] . '</div>'
            : '';
        $supportHtml = $context['email_support_block'] !== ''
            ? '<div style="margin:20px 0 0 0;">' . $context['email_support_block'] . '</div>'
            : '';
        $footerHtml = $context['email_footer_meta'] !== ''
            ? '<div style="padding:0 24px 22px 24px;">' . $context['email_footer_meta'] . '</div>'
            : '';
        $content = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px; border-collapse:collapse; background:#ffffff; border-left:6px solid ' . \esc_attr($context['email_button_color']) . ';">';
        $content .= '<tr><td style="padding:24px 24px 14px 24px;">';
        $content .= $context['email_logo_block'];
        $content .= '<h1 style="margin:0 0 14px 0; font-family:Arial, sans-serif; font-size:24px; line-height:1.25; color:#141414;">' . \esc_html($context['email_heading']) . '</h1>';
        $content .= '<div style="font-family:Arial, sans-serif; font-size:14px; line-height:1.7; color:#222222;">' . $context['email_content'] . '</div>';
        $content .= $summaryHtml;
        $content .= $buttonHtml;
        $content .= $supportHtml;
        $content .= '</td></tr>';
        $content .= '<tr><td style="padding:0 24px 16px 24px;"><div style="height:1px; background:#e8e3d8;"></div></td></tr>';
        $content .= '<tr><td>' . $footerHtml . '</td></tr>';
        $content .= '</table>';
        return self::renderDocument($context['email_subject'], '#eef1f3', $content, '24px 12px');
    }
    /**
     * @param array<string, string> $options
     */
    private static function renderCtaButton(string $url, string $label, string $buttonColor, array $options = []): string
    {
        $url = \esc_url($url);
        $label = \trim($label);
        if ($url === '' || $label === '') {
            return '';
        }
        $textColor = isset($options['text_color']) ? (string) $options['text_color'] : '#ffffff';
        $padding = isset($options['padding']) ? (string) $options['padding'] : '14px 24px';
        $fontSize = isset($options['font_size']) ? (string) $options['font_size'] : '15px';
        return '<div style="margin:26px 0 0 0;"><a href="' . $url . '" style="display:inline-block; padding:' . \esc_attr($padding) . '; background:' . \esc_attr($buttonColor) . '; color:' . \esc_attr($textColor) . '; text-decoration:none; font-family:Arial, sans-serif; font-size:' . \esc_attr($fontSize) . '; font-weight:700; letter-spacing:0.02em;">' . \esc_html($label) . '</a></div>';
    }
    private static function renderDocument(string $subject, string $backgroundColor, string $content, string $padding): string
    {
        return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' . \esc_html($subject) . '</title></head><body style="margin:0; padding:0; background:' . \esc_attr($backgroundColor) . ';"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' . \esc_attr($backgroundColor) . '; border-collapse:collapse;"><tr><td align="center" style="padding:' . \esc_attr($padding) . ';">' . $content . '</td></tr></table></body></html>';
    }
}
