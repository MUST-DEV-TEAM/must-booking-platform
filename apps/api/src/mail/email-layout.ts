import type { MailBrand } from '@must/domain-contracts';

export type EmailBrand = MailBrand;
export type EmailSummaryRow = { label: string; value: string };
export type SupportStyle = 'icon-grid' | 'plain';
export type SupportLink = { href: string; label: string };

export const MUST_BOOKING_BRAND: EmailBrand = {
  name: 'MUST Booking',
  supportEmail: 'support@mustbooking.com',
};

export function renderBrandedEmail(command: {
  subject: string;
  brand: EmailBrand;
  preheader?: string | null;
  eyebrow?: string | null;
  heading: string;
  greeting?: string | null;
  content: string;
  summaryRows?: EmailSummaryRow[];
  summaryHeading?: string;
  cta?: { url: string; label: string } | null;
  supportStyle?: SupportStyle;
  supportLinks?: SupportLink[];
  showBrandFooter?: boolean;
  footerNote?: string | null;
  platformFooter?: string | null;
}): string {
  const logo = renderLogoBlock(command.brand);
  const eyebrow = clean(command.eyebrow)
    ? `<p style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#58544a;">${escapeHtml(command.eyebrow!)}</p>`
    : '';
  const greeting = clean(command.greeting)
    ? `<p style="margin:0 0 18px 0;">${escapeHtml(command.greeting!)}.</p>`
    : '';
  const summary = renderSummaryRows(command.summaryRows ?? [], command.summaryHeading);
  const cta = command.cta ? renderCtaButton(command.cta) : '';
  const support = renderSupportBlock(
    command.brand,
    command.supportStyle ?? 'icon-grid',
    command.supportLinks,
  );
  const footer = renderFooter(command.brand, command.showBrandFooter ?? true, command.footerNote);
  const platformFooter = clean(command.platformFooter)
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-collapse:collapse;"><tr><td style="padding:20px 8px 0 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#a39a86;">${escapeHtml(command.platformFooter!)}</td></tr></table>`
    : '';
  const preheader = clean(command.preheader)
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f1ea;">${escapeHtml(command.preheader!)}</div>`
    : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(command.subject)}</title><!--[if mso]><style type="text/css">table {border-collapse: collapse;}</style><![endif]--></head><body style="margin:0;padding:0;background:#f4f1ea;">${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ea;border-collapse:collapse;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-collapse:collapse;background:#ffffff;border:1px solid #e2dccf;"><tr><td style="padding:40px 40px 28px 40px;">${logo}${eyebrow}<h1 style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.25;font-weight:700;color:#141414;mso-line-height-rule:exactly;">${escapeHtml(command.heading)}</h1><div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#141414;">${greeting}${command.content}</div>${summary}${cta}${support}</td></tr><tr><td style="border-top:1px solid #ece6d9;"></td></tr><tr><td>${footer}</td></tr></table>${platformFooter}</td></tr></table></body></html>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function renderRowValue(value: string): string {
  const lines = escapeHtml(value)
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return lines.length <= 1
    ? escapeHtml(value)
    : lines.join('<br><span style="display:inline-block;height:8px;"></span>');
}

function renderSummaryRows(rows: EmailSummaryRow[], heading = 'Booking Summary'): string {
  const normalized = rows.filter((row) => clean(row.label) && clean(row.value));
  if (!normalized.length) return '';
  const body = normalized
    .map(
      (row, index) =>
        `<tr><td style="padding:12px 16px;width:38%;vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#58544a;${index ? 'border-top:1px solid #e5dfd2;' : ''}">${escapeHtml(row.label)}</td><td style="padding:12px 16px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#141414;${index ? 'border-top:1px solid #e5dfd2;' : ''}">${renderRowValue(row.value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #d8d2c4;margin:28px 0 0 0;"><tr><td colspan="2" style="padding:12px 16px;background:#f7f4ec;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#141414;">${escapeHtml(heading)}</td></tr>${body}</table>`;
}

function renderLogoBlock(brand: EmailBrand): string {
  const name = clean(brand.name);
  const logoUrl = safeHttpUrl(brand.logoUrl);
  const websiteUrl = safeHttpUrl(brand.websiteUrl);
  const inner = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(name || 'Hotel logo')}" width="180" style="display:block;width:180px;max-width:180px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;" />`
    : name
      ? `<span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#141414;">${escapeHtml(name)}</span>`
      : '';
  if (!inner) return '';
  const linked = websiteUrl
    ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${inner}</a>`
    : inner;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;"><tr><td align="center">${linked}</td></tr></table>`;
}

function renderCtaButton(cta: { url: string; label: string }): string {
  const url = safeHttpUrl(cta.url);
  const label = clean(cta.label);
  if (!url || !label) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0 0;"><tr><td style="border-radius:2px;background:#141414;" bgcolor="#141414"><a href="${escapeHtml(url)}" style="display:block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.02em;color:#ffffff;text-decoration:none;" target="_blank">${escapeHtml(label)}</a></td></tr></table>`;
}

function supportIcon(href: string, glyph: string, label: string, glyphSize = 20): string {
  return `<td align="center" style="padding:0 20px;"><a href="${escapeHtml(href)}" style="text-decoration:none;" target="_blank"><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px auto;"><tr><td width="48" height="48" align="center" valign="middle" style="width:48px;height:48px;border:1px solid #141414;border-radius:24px;font-family:Arial,Helvetica,sans-serif;font-size:${glyphSize}px;${glyph === 'WWW' ? 'font-weight:700;' : ''}color:#141414;">${glyph}</td></tr></table><span style="display:block;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#141414;text-decoration:underline;">${escapeHtml(label)}</span></a></td>`;
}

function renderSupportBlock(brand: EmailBrand, style: SupportStyle, links?: SupportLink[]): string {
  const resolvedLinks = links?.filter((link) => safeHref(link.href) && clean(link.label)) ?? [];
  if (style === 'plain') {
    const plainLinks = (resolvedLinks.length ? resolvedLinks : defaultPlainLinks(brand)).map(
      (link) =>
        `<a href="${escapeHtml(link.href)}" style="color:#141414;text-decoration:underline;"${link.href.startsWith('http') ? ' target="_blank"' : ''}>${escapeHtml(link.label)}</a>`,
    );
    if (!plainLinks.length) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0 0;border:1px solid #ddd6c8;background:#faf7f0;"><tr><td style="padding:16px 18px;"><p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#141414;text-align:center;">Need Help?</p><p style="margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#141414;">${plainLinks.join(' &nbsp;|&nbsp; ')}</p></td></tr></table>`;
  }
  const email = clean(brand.supportEmail);
  const phone = clean(brand.phone);
  const websiteUrl = safeHttpUrl(brand.websiteUrl);
  const icons = [
    email && supportIcon(`mailto:${email}`, '&#9993;', 'Email'),
    phone && supportIcon(`tel:${phone.replace(/[^+\d]/g, '')}`, '&#9742;', 'Phone'),
    websiteUrl && supportIcon(websiteUrl, 'WWW', 'Website', 12),
  ].filter(Boolean);
  if (!icons.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0 0;border:1px solid #ddd6c8;background:#faf7f0;"><tr><td style="padding:24px 18px 22px 18px;text-align:center;"><p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#141414;text-align:center;">Need Help?</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${icons.join('')}</tr></table></td></tr></table>`;
}

function defaultPlainLinks(brand: EmailBrand): SupportLink[] {
  const email = clean(brand.supportEmail);
  const websiteUrl = safeHttpUrl(brand.websiteUrl);
  return [
    ...(email ? [{ href: `mailto:${email}`, label: email }] : []),
    ...(websiteUrl ? [{ href: websiteUrl, label: displayUrl(websiteUrl) }] : []),
  ];
}

function renderFooter(brand: EmailBrand, showBrand: boolean, footerNote?: string | null): string {
  const brandFooter = showBrand ? renderFooterMeta(brand) : '';
  const note = clean(footerNote)
    ? `<div style="${brandFooter ? 'margin-top:18px;' : 'margin-top:18px;'}font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#a39a86;"><p style="margin:0;">${footerNote}</p></div>`
    : '';
  if (!brandFooter && !note) return '';
  return `<div style="padding:${brandFooter ? '22px' : '0'} 40px 36px 40px;">${brandFooter}${note}</div>`;
}

function renderFooterMeta(brand: EmailBrand): string {
  const name = clean(brand.name);
  const address = clean(brand.address).replace(/\r?\n/g, ', ');
  const websiteUrl = safeHttpUrl(brand.websiteUrl);
  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  const parts = [
    name && `<p style="margin:0;font-weight:700;">${escapeHtml(name)}</p>`,
    address &&
      `<p style="margin:6px 0 0 0;"><a href="${escapeHtml(mapsUrl!)}" target="_blank" rel="noopener noreferrer" style="color:#141414;text-decoration:underline;">${escapeHtml(address)}</a></p>`,
    websiteUrl &&
      `<p style="margin:6px 0 0 0;"><a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#141414;text-decoration:underline;">${escapeHtml(displayUrl(websiteUrl))}</a></p>`,
  ].filter(Boolean);
  return parts.length
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#5f5a50;">${parts.join('')}</div>`
    : '';
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
function safeHref(value: string): boolean {
  return value.startsWith('mailto:') || value.startsWith('tel:') || !!safeHttpUrl(value);
}
function safeHttpUrl(value: string | null | undefined): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
