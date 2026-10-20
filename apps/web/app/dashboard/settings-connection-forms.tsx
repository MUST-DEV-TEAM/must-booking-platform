'use client';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { FormField } from '../../components/ui/form-field';
import { FormSection } from '../../components/ui/form-section';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { SaveBar } from '../../components/ui/save-bar';
import { EmailBrandingPreview } from '../../components/ui/email-branding-preview';
import { useUnsavedChanges } from '../../components/ui/unsaved-changes';
import type { PaymentGateways, Property } from './settings-areas';

type Common = { property: Property; saving: boolean; canWrite: boolean };
export const validEmail = (s: string) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export const validPhone = (s: string) =>
  !s ||
  (/^\+?[\d ().-]+$/.test(s) &&
    s.replace(/\D/g, '').length >= 6 &&
    s.replace(/\D/g, '').length <= 15);
const webUrl = (s: string, originOnly = false) => {
  if (!s) return true;
  try {
    const u = new URL(s);
    return (
      ['https:', 'http:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      (!originOnly || (u.pathname === '/' && !u.search && !u.hash))
    );
  } catch {
    return false;
  }
};
export function BrandingSettings({
  property,
  saving,
  canWrite,
  onSave,
}: Common & { onSave: (update: Partial<Property>) => void }) {
  const initial = {
    logoUrl: property.logoUrl ?? '',
    supportEmail: property.supportEmail ?? '',
    phone: property.phone ?? '',
  };
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [property.logoUrl, property.supportEmail, property.phone]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useUnsavedChanges(canWrite && dirty);
  const errors = {
    logoUrl: webUrl(draft.logoUrl.trim()) ? null : 'Enter a full http or https logo URL.',
    supportEmail: validEmail(draft.supportEmail.trim())
      ? null
      : 'Enter an email address such as hello@hotel.com.',
    phone: validPhone(draft.phone.trim())
      ? null
      : 'Enter a phone number with 6 to 15 digits, optionally starting with +.',
  };
  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Email branding"
        description="Booking emails use these hotel details. Leave optional fields empty to omit them."
      >
        {(['logoUrl', 'supportEmail', 'phone'] as const).map((key) => (
          <FormField
            key={key}
            htmlFor={`branding-${key}`}
            label={
              { logoUrl: 'Logo URL', supportEmail: 'Support email', phone: 'Hotel phone' }[key]
            }
            error={dirty ? errors[key] : null}
          >
            <Input
              id={`branding-${key}`}
              disabled={!canWrite}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </FormField>
        ))}
      </FormSection>
      <EmailBrandingPreview
        name={property.name}
        logoUrl={webUrl(draft.logoUrl.trim()) ? draft.logoUrl.trim() : null}
        email={draft.supportEmail}
        phone={draft.phone}
      />
      {canWrite ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          canSave={!Object.values(errors).some(Boolean)}
          onDiscard={() => setDraft(initial)}
          onSave={() => {
            const update: Partial<Property> = {};
            for (const key of ['logoUrl', 'supportEmail', 'phone'] as const)
              if (draft[key] !== initial[key]) update[key] = draft[key].trim() || null;
            onSave(update);
          }}
        />
      ) : null}
    </div>
  );
}
export function PaymentSettings({
  property,
  saving,
  canWrite,
  onSave,
  connectedProviders,
  operationsHref,
}: Common & {
  onSave: (update: PaymentGateways) => void;
  connectedProviders: Set<string>;
  operationsHref: string;
}) {
  const [draft, setDraft] = useState(property.paymentGateways);
  useEffect(() => setDraft(property.paymentGateways), [property.paymentGateways]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(property.paymentGateways);
  useUnsavedChanges(canWrite && dirty);
  // There is no independent online-booking enable switch in the property contract.
  const error = !Object.values(draft).some(Boolean)
    ? 'Keep at least one payment method on so guests can complete an online booking.'
    : null;
  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Payment methods"
        description="Choose how guests can pay for bookings at this hotel."
      >
        {(['payAtHotel', 'stripe', 'pokpay'] as const).map((key) => (
          <FormField
            key={key}
            htmlFor={`payment-${key}`}
            label={{ payAtHotel: 'Pay at hotel', stripe: 'Stripe', pokpay: 'PokPay' }[key]}
            hint={
              {
                payAtHotel: 'Guests pay the hotel directly when they arrive.',
                stripe: 'Guests pay online by card through Stripe.',
                pokpay: 'Guests pay online through PokPay.',
              }[key]
            }
          >
            <Switch
              id={`payment-${key}`}
              checked={draft[key]}
              disabled={!canWrite}
              onCheckedChange={(checked) => setDraft({ ...draft, [key]: checked })}
            />
            {key !== 'payAtHotel' ? (
              <Badge variant="outline">
                {connectedProviders.has(key === 'stripe' ? 'STRIPE' : 'POKPAY')
                  ? 'Connected to this hotel'
                  : 'Not connected - unavailable to guests'}
              </Badge>
            ) : null}
          </FormField>
        ))}
        {error ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button variant="outline" asChild>
          <a href={operationsHref}>Open payment operations</a>
        </Button>
      </FormSection>
      {canWrite ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          canSave={!error}
          onDiscard={() => setDraft(property.paymentGateways)}
          onSave={() => onSave(draft)}
        />
      ) : null}
    </div>
  );
}
export function WebsiteSettings({
  property,
  saving,
  canWrite,
  clockManaged,
  onSave,
  pairingCode,
  pairing,
  onPair,
  onCopy,
}: Common & {
  clockManaged: boolean;
  onSave: (origin: string) => void;
  pairingCode: string | null;
  pairing: boolean;
  onPair: () => void;
  onCopy: () => void;
}) {
  const initial = property.publicWebsiteOrigin ?? '';
  const [origin, setOrigin] = useState(initial);
  useEffect(() => setOrigin(initial), [initial]);
  const dirty = origin !== initial;
  useUnsavedChanges(canWrite && dirty);
  const error = webUrl(origin.trim(), true)
    ? null
    : 'Enter only the http or https website address, without a path, login, query or fragment.';
  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Website connection"
        description="Connect the existing MUST Booking WordPress plugin to this hotel."
      >
        <Badge variant="outline">
          {property.wordpressConnectedAt ? 'WordPress paired' : 'Not connected'}
        </Badge>
        {property.wordpressConnectedAt ? (
          <p className="m-0 text-sm">
            Paired on {new Date(property.wordpressConnectedAt).toLocaleString()}
          </p>
        ) : null}
        {clockManaged ? (
          <p className="m-0 text-sm text-muted-foreground">
            Bookings are managed in Clock. Website pairing is managed here.
          </p>
        ) : null}
        <FormField
          htmlFor="website-origin"
          label="Public website origin"
          hint="Must match your WordPress site address. Required for guests to complete an online booking."
          error={dirty ? error : null}
        >
          <Input
            id="website-origin"
            value={origin}
            disabled={!canWrite}
            placeholder="https://your-hotel-site.com"
            onChange={(e) => setOrigin(e.target.value)}
          />
        </FormField>
        {!property.publicWebsiteOrigin ? (
          <p className="m-0 text-sm text-muted-foreground">Website address not set.</p>
        ) : null}
        {pairingCode ? (
          <FormField
            htmlFor="website-code"
            label="Connection code"
            hint="Expires in 30 minutes. Use once in the WordPress plugin. A new code replaces this one."
          >
            <Input id="website-code" value={pairingCode} readOnly />
            <Button variant="outline" onClick={onCopy}>
              Copy code
            </Button>
          </FormField>
        ) : null}
        {canWrite ? (
          <Button variant="outline" loading={pairing} onClick={onPair}>
            {pairingCode || property.wordpressConnectedAt
              ? 'Generate new code'
              : 'Generate connection code'}
          </Button>
        ) : null}
      </FormSection>
      {canWrite ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          canSave={!error}
          onDiscard={() => setOrigin(initial)}
          onSave={() => onSave(origin.trim())}
        />
      ) : null}
    </div>
  );
}
