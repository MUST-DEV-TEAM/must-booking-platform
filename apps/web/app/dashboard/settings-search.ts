import type { SettingsTab } from './settings-registry';

/** What "Find a setting" searches: a setting's name and the words people use for it. */
export const settingsSearchEntries: ReadonlyArray<{
  label: string;
  tab: SettingsTab;
  keywords: string;
}> = [
  { label: 'Hotel name', tab: 'profile', keywords: 'name title property' },
  { label: 'Address and country', tab: 'profile', keywords: 'location city street country' },
  { label: 'Time zone', tab: 'profile', keywords: 'timezone clock hours' },
  { label: 'Currency', tab: 'profile', keywords: 'money euro lek prices' },
  { label: 'Languages', tab: 'profile', keywords: 'translation guest language' },
  { label: 'Legal name and tax number', tab: 'profile', keywords: 'nuis vat tax id company legal' },
  { label: 'Star rating', tab: 'profile', keywords: 'stars category type' },
  { label: 'Phone and support email', tab: 'contact-brand', keywords: 'contact telephone mail' },
  { label: 'Website address', tab: 'contact-brand', keywords: 'url site domain' },
  { label: 'Logo and brand colour', tab: 'contact-brand', keywords: 'branding image color' },
  { label: 'Minimum and maximum stay', tab: 'booking-rules', keywords: 'nights stay length' },
  { label: 'Booking window', tab: 'booking-rules', keywords: 'advance days ahead' },
  { label: 'Same-day booking cutoff', tab: 'booking-rules', keywords: 'last minute today' },
  { label: 'Inventory mode', tab: 'booking-rules', keywords: 'room types individual mixed' },
  { label: 'Guests and rooms per booking', tab: 'booking-rules', keywords: 'limit maximum' },
  { label: 'Check-in and check-out', tab: 'policies', keywords: 'arrival departure early late' },
  { label: 'Free cancellation', tab: 'policies', keywords: 'cancel refund days before arrival' },
  { label: 'House rules', tab: 'policies', keywords: 'smoking quiet hours pets children' },
  { label: 'Pay at hotel', tab: 'payment-methods', keywords: 'cash arrival pay later' },
  { label: 'Online card payments', tab: 'payment-methods', keywords: 'stripe pokpay card' },
  { label: 'Payment hold time', tab: 'payment-methods', keywords: 'hold minutes pending' },
  { label: 'Property system (Clock PMS)', tab: 'integrations', keywords: 'clock pms folio sync' },
  { label: 'Website connection', tab: 'integrations', keywords: 'wordpress plugin managed pages' },
  { label: 'Email provider', tab: 'emails', keywords: 'smtp brevo resend sending domain' },
  { label: 'Guest and staff emails', tab: 'emails', keywords: 'templates confirmation' },
  { label: 'Staff and roles', tab: 'team', keywords: 'users invite permissions access' },
  { label: 'Plan and usage', tab: 'plan-usage', keywords: 'billing subscription limits' },
  { label: 'Audit log', tab: 'audit-log', keywords: 'history changes who changed' },
];

/** The settings that match what was typed; every word must appear in the name or its keywords. */
export function findSettings(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return settingsSearchEntries.filter((entry) => {
    const text = `${entry.label} ${entry.keywords}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
