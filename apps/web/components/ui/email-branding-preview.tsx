import { FormSection } from './form-section';
/** Illustrates the identity fields used by booking emails, without sending an email. */
export function EmailBrandingPreview({
  name,
  logoUrl,
  email,
  phone,
  colour,
  footer,
}: {
  name: string;
  logoUrl: string | null;
  email: string | null;
  phone: string | null;
  colour?: string;
  footer?: string;
}) {
  return (
    <FormSection title="Booking email preview" description="Example only. No email is sent.">
      {logoUrl ? (
        <img src={logoUrl} alt={`${name} logo`} className="max-h-16 max-w-48 object-contain" />
      ) : null}
      <p className="m-0 font-semibold">{name}</p>
      <p className="m-0 text-sm">Your booking is confirmed.</p>
      <span
        className="w-fit rounded px-4 py-2 text-white"
        style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(colour ?? '') ? colour : '#141414' }}
      >
        View booking
      </span>
      {footer ? <p className="m-0 text-sm">{footer}</p> : null}
      <p className="m-0 text-sm text-muted-foreground">
        {[email, phone].filter(Boolean).join(' | ') || 'No contact details added.'}
      </p>
    </FormSection>
  );
}
