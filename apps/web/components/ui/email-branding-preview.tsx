'use client';
import { FormSection } from './form-section';
/** Illustrates the identity fields used by booking emails, without sending an email. */
export function EmailBrandingPreview({
  name,
  logoUrl,
  email,
  phone,
  colour,
  footer,
  termsUrl,
}: {
  name: string;
  logoUrl: string | null;
  email: string | null;
  phone: string | null;
  colour?: string;
  footer?: string;
  termsUrl?: string;
}) {
  const brandColour = /^#[0-9a-f]{6}$/i.test(colour ?? '') ? colour : '#141414';
  const safeTerms =
    termsUrl?.startsWith('https://') &&
    (() => {
      try {
        const u = new URL(termsUrl);
        return !u.username && !u.password;
      } catch {
        return false;
      }
    })();
  return (
    <FormSection title="Booking email preview" description="Example only. No email is sent.">
      {logoUrl ? (
        <img src={logoUrl} alt={`${name} logo`} className="max-h-16 max-w-48 object-contain" />
      ) : null}
      <p className="m-0 font-semibold">{name}</p>
      <p className="m-0 text-sm">Your booking is confirmed.</p>
      <span className="w-fit rounded px-4 py-2 text-white" style={{ backgroundColor: brandColour }}>
        View booking
      </span>
      <a
        href="#booking-email-preview"
        onClick={(e) => e.preventDefault()}
        className="w-fit text-sm underline"
        style={{ color: brandColour }}
      >
        View booking details
      </a>
      {safeTerms ? (
        <a
          href={termsUrl}
          onClick={(e) => e.preventDefault()}
          className="w-fit text-sm underline"
          style={{ color: brandColour }}
        >
          Terms and conditions
        </a>
      ) : null}
      {footer ? <p className="m-0 text-sm">{footer}</p> : null}
      <p className="m-0 text-sm text-muted-foreground">
        {[email, phone].filter(Boolean).join(' | ') || 'No contact details added.'}
      </p>
    </FormSection>
  );
}
