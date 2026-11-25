import type { EmailSendingProfile, SendingMode } from './email-sending-profile';

/** Brevo's SMTP relay, fixed by Brevo: a hotel only supplies its login and key. */
export const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
export const BREVO_SMTP_PORT = 587;

export const isBrevoSmtp = (profile: EmailSendingProfile) =>
  profile.mode === 'SMTP' && /(^|\.)brevo\.com$/i.test(profile.smtpHost ?? '');

/** Whether the saved setup is a Brevo one (the API key method or Brevo's SMTP relay). */
export const onBrevo = (profile: EmailSendingProfile) =>
  profile.mode === 'BREVO' || isBrevoSmtp(profile);

/** The method the Brevo setup starts on: the saved one, otherwise the API key. */
export const brevoStartMode = (profile: EmailSendingProfile): SendingMode =>
  isBrevoSmtp(profile) ? 'SMTP' : 'BREVO';
