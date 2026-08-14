// Drop-in replacement for apps/api/src/mail/email-layout.ts
// Implements the finalized design: centered logo, no status pill, stacked date
// values with a small gap, centered icon-based support block, consolidated
// footer address, and protocol-stripped website display text.
// Same exports/signatures as the original — safe to swap in directly.

import type { MailBrand } from '@must/domain-contracts';

export type EmailBrand = MailBrand;

export type EmailSummaryRow = { label: string; value: string };

export const MUST_BOOKING_BRAND: EmailBrand = { name: 'MUST Booking' };

export function renderBrandedEmail(command: {
  subject: string;
  brand: EmailBrand;
  heading: string;
  greeting?: string | null;
  content: string;
  summaryRows?: EmailSummaryRow[];
  cta?: { url: string; label: string } | null;
}): string {
  const logo = renderLogoBlock(command.brand);
  const greeting = clean(command.greeting)
    ? `<p style="margin:0 0 18px 0;">${escapeHtml(command.greeting!)}.</p>`
    : '';
  const summary = renderSummaryRows(command.summaryRows ?? []);
  const cta = command.cta ? renderCtaButton(command.cta) : '';
  const support = renderSupportBlock(command.brand);
  const footer = renderFooterMeta(command.brand);
  const summaryHtml = summary ? `<div style="margin:28px 0 0 0;">${summary}</div>` : '';
  const supportHtml = support ? `<div style="margin:28px 0 0 0;">${support}</div>` : '';
  const footerHtml = footer ? `<div style="padding:22px 36px 32px 36px;">${footer}</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(command.subject)}</title></head><body style="margin:0; padding:0; background:#f4f1ea;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea; border-collapse:collapse;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px; border-collapse:collapse; background:#ffffff; border:1px solid #e2dccf;"><tr><td style="padding:36px 36px 24px 36px;">${logo}<h1 style="margin:0 0 18px 0; font-family:Arial, sans-serif; font-size:30px; line-height:1.2; color:#141414;">${escapeHtml(command.heading)}</h1><div style="font-family:Arial, sans-serif; font-size:16px; line-height:1.75; color:#141414;">${greeting}${command.content}</div>${summaryHtml}${cta}${supportHtml}</td></tr><tr><td style="border-top:1px solid #ece6d9;"></td></tr><tr><td>${footerHtml}</td></tr></table></td></tr></table></body></html>`;
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

// Multi-line row values (e.g. one date per line) render as stacked lines
// with a small gap, instead of a cramped run-on paragraph.
function renderRowValue(value: string): string {
  const lines = escapeHtml(value)
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length <= 1) return escapeHtml(value);
  return lines.join('<br><span style="display:inline-block; height:8px;"></span>');
}

function renderSummaryRows(rows: EmailSummaryRow[]): string {
  const normalized = rows.filter((row) => clean(row.label) && clean(row.value));
  if (!normalized.length) return '';
  const body = normalized
    .map(
      (row, index) =>
        `<tr><td style="padding:12px 16px; width:38%; vertical-align:top; font-family:Arial, sans-serif; font-size:14px; font-weight:600; color:#58544a;${index ? ' border-top:1px solid #e5dfd2;' : ''}">${escapeHtml(row.label)}</td><td style="padding:12px 16px; vertical-align:top; font-family:Arial, sans-serif; font-size:14px; color:#141414;${index ? ' border-top:1px solid #e5dfd2;' : ''}">${renderRowValue(row.value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border:1px solid #d8d2c4;"><tr><td colspan="2" style="padding:12px 16px; background:#f7f4ec; font-family:Arial, sans-serif; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#141414;">Booking Summary</td></tr>${body}</table>`;
}

function renderLogoBlock(brand: EmailBrand): string {
  const name = clean(brand.name);
  const logoUrl = safeHttpUrl(brand.logoUrl);
  const websiteUrl = safeHttpUrl(brand.websiteUrl);
  if (logoUrl) {
    const image = `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(name || 'Hotel logo')}" width="180" style="display:block; width:180px; max-width:180px; height:auto; border:0; outline:none; text-decoration:none; margin:0 auto;" />`;
    const wrapped = websiteUrl
      ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${image}</a>`
      : image;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;"><tr><td align="center">${wrapped}</td></tr></table>`;
  }
  if (!name) return '';
  const text = `<span style="font-family:Arial, sans-serif; font-size:18px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#141414;">${escapeHtml(name)}</span>`;
  const wrapped = websiteUrl
    ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${text}</a>`
    : text;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;"><tr><td align="center">${wrapped}</td></tr></table>`;
}

function renderCtaButton(cta: { url: string; label: string }): string {
  const url = safeHttpUrl(cta.url);
  const label = clean(cta.label);
  if (!url || !label) return '';
  return `<div style="margin:26px 0 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block; padding:14px 24px; background:#141414; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif; font-size:15px; font-weight:700; letter-spacing:0.02em;">${escapeHtml(label)}</a></div>`;
}

// A single circular glyph + label, used for each Need Help contact method.
function supportIcon(href: string, glyph: string, label: string, glyphSize = 20): string {
  return `<td align="center" style="padding:0 20px;"><a href="${escapeHtml(href)}" style="text-decoration:none;" target="_blank"><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px auto;"><tr><td width="48" height="48" align="center" valign="middle" style="width:48px; height:48px; border:1px solid #141414; border-radius:24px; font-family:Arial, sans-serif; font-size:${glyphSize}px; color:#141414;">${glyph}</td></tr></table><span style="display:block; font-family:Arial, sans-serif; font-size:13px; color:#141414; text-decoration:underline;">${escapeHtml(label)}</span></a></td>`;
}

function renderSupportBlock(brand: EmailBrand): string {
  const email = clean(brand.supportEmail);
  const phone = clean(brand.phone);
  const websiteUrl = safeHttpUrl(brand.websiteUrl);
  const icons = [
    email && supportIcon(`mailto:${email}`, '&#9993;', 'Email'),
    phone && supportIcon(`tel:${phone.replace(/[^+\d]/g, '')}`, '&#9742;', 'Phone'),
    websiteUrl && supportIcon(websiteUrl, 'WWW', 'Website', 12),
  ].filter(Boolean);
  if (!icons.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ddd6c8; background:#faf7f0;"><tr><td style="padding:24px 18px 22px 18px; text-align:center;"><p style="margin:0 0 16px 0; font-family:Arial, sans-serif; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#141414; text-align:center;">Need Help?</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${icons.join('')}</tr></table></td></tr></table>`;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function renderFooterMeta(brand: EmailBrand): string {
  const name = clean(brand.name);
  const address = clean(brand.address).replace(/\r?\n/g, ', ');
  const websiteUrl = safeHttpUrl(brand.websiteUrl);
  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  const parts = [
    name && `<p style="margin:0; font-weight:700;">${escapeHtml(name)}</p>`,
    address &&
      `<p style="margin:6px 0 0 0;"><a href="${escapeHtml(mapsUrl!)}" target="_blank" rel="noopener noreferrer" style="color:#141414; text-decoration:underline;">${escapeHtml(address)}</a></p>`,
    websiteUrl &&
      `<p style="margin:6px 0 0 0;"><a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#141414; text-decoration:underline;">${escapeHtml(displayUrl(websiteUrl))}</a></p>`,
  ].filter(Boolean);
  return parts.length
    ? `<div style="font-family:Arial, sans-serif; font-size:13px; line-height:1.7; color:#5f5a50;">${parts.join('')}</div>`
    : '';
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
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
