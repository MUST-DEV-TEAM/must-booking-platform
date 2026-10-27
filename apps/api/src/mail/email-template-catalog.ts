import type { EmailTemplateKey } from './email-templates';
/** Explicit real senders; catalog authoring never invents a missing booking lifecycle or payment URL. */
const triggers: Partial<Record<EmailTemplateKey, string>> = {
  booking_confirmed: 'booking.confirmed',
  booking_confirmed_pay_at_hotel: 'booking.confirmed',
  booking_cancelled: 'booking.cancelled',
  refund_processed: 'booking.refund_processed',
  pre_arrival: 'guest.pre_arrival',
  booking_changed: 'guest.booking_changed',
  staff_booking_changed: 'booking.staff_changed',
  payment_received: 'guest.payment_received',
  staff_payment_received: 'staff.payment_received',
  payment_not_completed: 'guest.payment_not_completed',
  staff_payment_failed: 'staff.payment_not_completed',
  payment_pending: 'guest.payment_pending',
  payment_reminder: 'guest.payment_reminder',
  payment_link_expiring: 'guest.payment_link_expiring',
  check_in_day: 'guest.check_in_day',
  no_show_notice: 'guest.no_show_notice',
  post_stay: 'guest.post_stay',
  staff_new_booking: 'booking.staff_new',
  staff_booking_cancelled: 'booking.staff_cancelled',
  staff_refund_processed: 'owner.refund_alert',
  owner_alerts: 'owner.alert',
  owner_daily_summary: 'owner.daily_summary',
  staff_invitation: 'staff.invitation',
};
export function templateCatalog(key: EmailTemplateKey) {
  const audience =
    key.startsWith('staff_') || key.startsWith('owner_') ? 'Staff and owner' : 'Guest';
  return {
    audience,
    trigger: triggers[key] ?? null,
    triggerAvailable: !!triggers[key],
    unavailableReason: triggers[key]
      ? null
      : 'No sending trigger is implemented for this situation. Wording can be prepared; publishing is unavailable.',
  };
}
