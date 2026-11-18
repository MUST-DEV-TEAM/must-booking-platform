'use client';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { FormField } from '../../components/ui/form-field';
import { FormSection } from '../../components/ui/form-section';
import { HotelLogoPicker } from '../../components/ui/hotel-logo-picker';
import {
  PokpayConnectionPanel,
  type PokpayConnection,
} from '../../components/ui/pokpay-connection-panel';
import { Input } from '../../components/ui/input';
import { ColourField } from '../../components/ui/colour-field';
import { Switch } from '../../components/ui/switch';
import { TimeField } from '../../components/ui/time-field';
import { PhoneInput, parsePhone, phoneToString } from '../../components/ui/phone-input';
import {
  checkProfileCombination,
  checkProfileField,
  normaliseProfileValue,
  type ProfileFieldKey,
} from '@must/domain-contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { SaveBar } from '../../components/ui/save-bar';
import { EmailBrandingPreview } from '../../components/ui/email-branding-preview';
import { useUnsavedChanges } from '../../components/ui/unsaved-changes';
import type {
  ClockCancelRefundPolicy,
  ClockPaymentFolio,
  PaymentGateways,
  Property,
} from './settings-areas';
import { settingsAreaHref } from './settings-hub';

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
type BrandingDraft = {
  logoUrl: string;
  brandColour: string;
  emailFooterText: string;
  termsUrl: string;
  supportEmail: string;
  reservationsEmail: string;
  phone: string;
  whatsappSameAsPhone: boolean;
  whatsappNumber: string;
  afterHoursPhone: string;
  receptionOpen24h: boolean;
  receptionFrom: string;
  receptionTo: string;
  website: string;
};
const phoneKeys = ['phone', 'whatsappNumber', 'afterHoursPhone'] as const;
const textKeys = [
  'logoUrl',
  'supportEmail',
  'reservationsEmail',
  'phone',
  'whatsappNumber',
  'afterHoursPhone',
  'receptionFrom',
  'receptionTo',
  'website',
  'brandColour',
  'emailFooterText',
  'termsUrl',
] as const;
const shared = (key: ProfileFieldKey, text: string) =>
  text.trim()
    ? checkProfileField(key, normaliseProfileValue(key, text.trim()), {
        year: new Date().getFullYear(),
      })
    : null;

export function BrandingSettings({
  property,
  saving,
  canWrite,
  onSave,
  tenantId,
  canManagePhotos = false,
}: Common & {
  tenantId: string;
  canManagePhotos?: boolean;
  onSave: (update: Partial<Property>) => void;
}) {
  const initial: BrandingDraft = {
    logoUrl: property.logoUrl ?? '',
    brandColour: property.brandColour ?? '',
    emailFooterText: property.emailFooterText ?? '',
    termsUrl: property.termsUrl ?? '',
    supportEmail: property.supportEmail ?? '',
    reservationsEmail: property.reservationsEmail ?? '',
    phone: property.phone ?? '',
    whatsappSameAsPhone: property.whatsappSameAsPhone ?? true,
    whatsappNumber: property.whatsappNumber ?? '',
    afterHoursPhone: property.afterHoursPhone ?? '',
    receptionOpen24h: property.receptionOpen24h ?? true,
    receptionFrom: property.receptionFrom ?? '',
    receptionTo: property.receptionTo ?? '',
    website: property.website ?? '',
  };
  const [draft, setDraft] = useState(initial);
  const savedText = JSON.stringify(initial);
  useEffect(() => setDraft(JSON.parse(savedText) as BrandingDraft), [savedText]);
  const dirty = JSON.stringify(draft) !== savedText;
  useUnsavedChanges(canWrite && dirty);
  const changed = (key: keyof BrandingDraft) => draft[key] !== initial[key];
  const combination = checkProfileCombination({
    whatsappSameAsPhone: draft.whatsappSameAsPhone,
    whatsappNumber: draft.whatsappNumber.trim() || null,
    receptionOpen24h: draft.receptionOpen24h,
    receptionFrom: draft.receptionFrom || null,
    receptionTo: draft.receptionTo || null,
  });
  const errors: Record<string, string | null> = {
    brandColour:
      !draft.brandColour || /^#[0-9a-f]{6}$/i.test(draft.brandColour)
        ? null
        : 'Enter a colour such as #123ABC.',
    emailFooterText:
      draft.emailFooterText.length <= 300 ? null : 'Keep the footer to 300 characters or fewer.',
    termsUrl:
      !draft.termsUrl || (webUrl(draft.termsUrl) && draft.termsUrl.startsWith('https://'))
        ? null
        : 'Enter a full https terms link.',
    supportEmail:
      !draft.supportEmail.trim() && initial.supportEmail
        ? 'Enter the guest contact email.'
        : shared('supportEmail', draft.supportEmail),
    reservationsEmail: shared('reservationsEmail', draft.reservationsEmail),
    phone: shared('phone', draft.phone),
    whatsappNumber: draft.whatsappSameAsPhone
      ? null
      : (shared('whatsappNumber', draft.whatsappNumber) ?? combination.whatsappNumber ?? null),
    afterHoursPhone: shared('afterHoursPhone', draft.afterHoursPhone),
    receptionFrom: draft.receptionOpen24h
      ? null
      : (shared('receptionFrom', draft.receptionFrom) ?? combination.receptionFrom ?? null),
    receptionTo: draft.receptionOpen24h
      ? null
      : (shared('receptionTo', draft.receptionTo) ?? combination.receptionTo ?? null),
    website: shared('website', draft.website),
  };
  const labels = {
    supportEmail: 'Guest contact email',
    reservationsEmail: 'Reservations email',
    phone: 'Phone',
    whatsappNumber: 'WhatsApp number',
    afterHoursPhone: 'After-hours phone',
    website: 'Website address',
    brandColour: 'Brand colour',
    emailFooterText: 'Email footer text',
    termsUrl: 'Terms and conditions link',
  } as const;
  const shown = (key: keyof typeof errors) =>
    changed(key as keyof BrandingDraft) ||
    (dirty && ['whatsappNumber', 'receptionFrom', 'receptionTo'].includes(key))
      ? errors[key]
      : null;
  const field = (key: keyof typeof labels, hint?: string) => (
    <FormField
      key={key}
      htmlFor={`branding-${key}`}
      label={labels[key]}
      hint={hint}
      error={shown(key)}
    >
      {key === 'brandColour' ? (
        <ColourField
          id="branding-brandColour"
          value={draft.brandColour}
          disabled={!canWrite}
          invalid={!!errors.brandColour}
          onChange={(brandColour) => setDraft({ ...draft, brandColour })}
        />
      ) : (phoneKeys as readonly string[]).includes(key) ? (
        <PhoneInput
          id={`branding-${key}`}
          disabled={!canWrite}
          invalid={!!shown(key)}
          value={parsePhone(draft[key as (typeof phoneKeys)[number]])}
          onChange={(value) => setDraft({ ...draft, [key]: phoneToString(value) })}
        />
      ) : (
        <Input
          id={`branding-${key}`}
          disabled={!canWrite}
          value={draft[key as 'supportEmail']}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      )}
    </FormField>
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-muted-foreground">
        These details style this system and the emails it sends. They are not shown on your public
        website.
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        <div className="flex flex-col gap-4">
          <FormSection
            title="Logo and colour"
            description="Shown in the sidebar and at the top of booking emails."
          >
            <HotelLogoPicker
              tenantId={tenantId}
              propertyId={property.id}
              value={draft.logoUrl}
              onChange={(logoUrl) => setDraft({ ...draft, logoUrl })}
              canManage={canWrite && canManagePhotos}
            />
            {field('brandColour', 'Used for buttons and headings in emails, for example #224858.')}
          </FormSection>
          <FormSection
            title="Guest contact"
            description="Guests see these in booking emails and on the booking page. Leave a field empty to leave it out."
          >
            {field('supportEmail', 'Also the default reply-to address of guest emails.')}
            {field(
              'reservationsEmail',
              'Where new, changed and cancelled booking notices go by default.',
            )}
            {field('phone', 'Choose the country, then type the number.')}
            <FormField label="WhatsApp" layout="toggle" htmlFor="branding-whatsappSameAsPhone">
              <Switch
                id="branding-whatsappSameAsPhone"
                aria-label="WhatsApp is the same as the phone"
                disabled={!canWrite}
                checked={draft.whatsappSameAsPhone}
                onCheckedChange={(whatsappSameAsPhone) =>
                  setDraft({ ...draft, whatsappSameAsPhone })
                }
              />
            </FormField>
            <p className="m-0 -mt-2 text-xs text-muted-foreground">
              {draft.whatsappSameAsPhone
                ? 'Guests message the hotel on the phone number above.'
                : 'Guests message the hotel on the number below.'}
            </p>
            {draft.whatsappSameAsPhone ? null : field('whatsappNumber')}
            {field('afterHoursPhone', 'Used in pre-arrival and check-in day emails.')}
            <FormField
              label="Open 24 hours"
              layout="toggle"
              htmlFor="branding-receptionOpen24h"
              hint="Reception hours shown on the booking page and in the pre-arrival email."
            >
              <Switch
                id="branding-receptionOpen24h"
                disabled={!canWrite}
                checked={draft.receptionOpen24h}
                onCheckedChange={(receptionOpen24h) => setDraft({ ...draft, receptionOpen24h })}
              />
            </FormField>
            {draft.receptionOpen24h ? null : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Reception opens" error={shown('receptionFrom')}>
                  <TimeField
                    label="Reception opens"
                    value={draft.receptionFrom}
                    onChange={(receptionFrom) => setDraft({ ...draft, receptionFrom })}
                  />
                </FormField>
                <FormField
                  label="Reception closes"
                  hint="May be after midnight."
                  error={shown('receptionTo')}
                >
                  <TimeField
                    label="Reception closes"
                    value={draft.receptionTo}
                    onChange={(receptionTo) => setDraft({ ...draft, receptionTo })}
                  />
                </FormField>
              </div>
            )}
            {field('website', 'A full https address. Does not change the website connection.')}
            {field('termsUrl', `${draft.termsUrl.length} characters`)}
          </FormSection>
          <FormSection
            title="Email footer"
            description="A short line at the bottom of every email, such as the hotel address."
          >
            {field('emailFooterText', `${draft.emailFooterText.length}/300 characters`)}
          </FormSection>
        </div>
        <div className="lg:sticky lg:top-4">
          <EmailBrandingPreview
            name={property.name}
            logoUrl={webUrl(draft.logoUrl.trim()) ? draft.logoUrl.trim() : null}
            email={draft.supportEmail}
            phone={draft.phone}
            colour={draft.brandColour}
            footer={draft.emailFooterText}
            termsUrl={draft.termsUrl}
          />
        </div>
      </div>
      {canWrite ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          canSave={!Object.values(errors).some(Boolean)}
          onDiscard={() => setDraft(initial)}
          onSave={() => {
            const update: Record<string, unknown> = {};
            for (const key of textKeys)
              if (draft[key] !== initial[key])
                update[key] =
                  normaliseProfileValue(key as ProfileFieldKey, draft[key].trim()) ?? null;
            for (const key of ['whatsappSameAsPhone', 'receptionOpen24h'] as const)
              if (draft[key] !== initial[key]) update[key] = draft[key];
            onSave(update as Partial<Property>);
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
  connectedProviders,
  clockConnected = false,
  operationsHref,
  tenantId,
  onPropertySave,
  connection,
  assigned = false,
}: Common & {
  connectedProviders: Set<string>;
  clockConnected?: boolean;
  operationsHref: string;
  tenantId: string;
  onPropertySave: (update: Partial<Property>, gateways: PaymentGateways) => void;
  connection?: PokpayConnection;
  assigned?: boolean;
}) {
  const [draft, setDraft] = useState(property.paymentGateways);
  useEffect(() => setDraft(property.paymentGateways), [property.paymentGateways]);
  const [hold, setHold] = useState(String(property.onlinePaymentHoldMinutes ?? 30)),
    [autoRefund, setAutoRefund] = useState(property.autoRefundOnFreeCancellation ?? true),
    [keepFee, setKeepFee] = useState(property.deductPaymentFeeOnGuestRefund ?? true),
    [clockRefund, setClockRefund] = useState<ClockCancelRefundPolicy>(
      property.clockCancelRefundPolicy ?? 'NEVER',
    ),
    [clockFolio, setClockFolio] = useState<ClockPaymentFolio>(
      property.clockPaymentFolio ?? 'DEPOSIT',
    );
  useEffect(() => {
    setHold(String(property.onlinePaymentHoldMinutes ?? 30));
    setAutoRefund(property.autoRefundOnFreeCancellation ?? true);
    setKeepFee(property.deductPaymentFeeOnGuestRefund ?? true);
    setClockRefund(property.clockCancelRefundPolicy ?? 'NEVER');
    setClockFolio(property.clockPaymentFolio ?? 'DEPOSIT');
  }, [
    property.onlinePaymentHoldMinutes,
    property.autoRefundOnFreeCancellation,
    property.deductPaymentFeeOnGuestRefund,
    property.clockCancelRefundPolicy,
    property.clockPaymentFolio,
  ]);
  const holdError =
    !/^\d+$/.test(hold) || Number(hold) < 10 || Number(hold) > 1440
      ? 'Choose a hold between 10 and 1440 minutes.'
      : null;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(property.paymentGateways) ||
    hold !== String(property.onlinePaymentHoldMinutes ?? 30) ||
    autoRefund !== (property.autoRefundOnFreeCancellation ?? true) ||
    keepFee !== (property.deductPaymentFeeOnGuestRefund ?? true) ||
    clockRefund !== (property.clockCancelRefundPolicy ?? 'NEVER') ||
    clockFolio !== (property.clockPaymentFolio ?? 'DEPOSIT');
  useUnsavedChanges(canWrite && dirty);
  // There is no independent online-booking enable switch in the property contract.
  const error = !(draft.payAtHotel || draft.pokpay || draft.stripe)
    ? 'Keep at least one payment method on so guests can complete an online booking.'
    : null;
  return (
    <div className="flex flex-col gap-4">
      <FormSection
        title="Payment methods"
        description="Choose how guests can pay for bookings at this hotel."
      >
        {(['stripe', 'pokpay', 'payAtHotel'] as const).map((key) => (
          <FormField
            key={key}
            layout="toggle"
            htmlFor={`payment-${key}`}
            label={
              { payAtHotel: 'Pay at hotel', stripe: 'Stripe', pokpay: 'Pay online in full' }[key]
            }
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
        <FormField
          label="Unpaid online booking hold (minutes)"
          htmlFor="payment-hold"
          error={holdError}
        >
          <Input
            id="payment-hold"
            type="number"
            min={10}
            max={1440}
            value={hold}
            disabled={!canWrite}
            onChange={(e) => setHold(e.target.value)}
          />
        </FormField>
        <FormField
          layout="toggle"
          label="Automatically refund free cancellations"
          htmlFor="payment-auto-refund"
          hint="When off, a refund must be issued separately by staff with refund permission."
        >
          <Switch
            id="payment-auto-refund"
            checked={autoRefund}
            disabled={!canWrite}
            onCheckedChange={setAutoRefund}
          />
        </FormField>
        <FormField
          layout="toggle"
          label="A guest who cancels pays the payment fee"
          htmlFor="payment-keep-fee"
          hint="When a guest cancels on their own, the card payment fee is kept back from their refund. When the hotel cancels, the guest is always refunded in full. It is on unless you turn it off here. Say so in your booking terms, so guests know before they book."
        >
          <Switch
            id="payment-keep-fee"
            checked={keepFee}
            disabled={!canWrite}
            onCheckedChange={setKeepFee}
          />
        </FormField>
        {clockConnected ? (
          <FormField
            label="When the hotel cancels a booking in Clock"
            htmlFor="payment-clock-cancel-refund"
            hint="What happens to the guest's online payment. Outside the choice made here, staff refund by hand."
          >
            <Select
              value={clockRefund}
              disabled={!canWrite}
              onValueChange={(value) => setClockRefund(value as ClockCancelRefundPolicy)}
            >
              <SelectTrigger id="payment-clock-cancel-refund">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NEVER">Do not refund (staff decide)</SelectItem>
                <SelectItem value="FREE_WINDOW">
                  Refund in full inside the free-cancellation window
                </SelectItem>
                <SelectItem value="ALWAYS">Always refund in full</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
        {clockConnected ? (
          <FormField
            label="Where Clock records a website payment"
            htmlFor="payment-clock-folio"
            hint="A deposit folio is converted to an advance invoice by your reception. The booking's own folio needs no conversion, but no advance invoice is issued: the payment is only deducted from the final invoice."
          >
            <Select
              value={clockFolio}
              disabled={!canWrite}
              onValueChange={(value) => setClockFolio(value as ClockPaymentFolio)}
            >
              <SelectTrigger id="payment-clock-folio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEPOSIT">Deposit folio (advance invoice)</SelectItem>
                <SelectItem value="MAIN">Booking's own folio (nothing to convert)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
        <Button variant="outline" asChild>
          <a href={operationsHref}>Open payment operations</a>
        </Button>
      </FormSection>
      <PokpayConnectionPanel
        connection={connection}
        assigned={assigned}
        manageHref={canWrite ? settingsAreaHref(tenantId, property.id, 'integrations') : undefined}
      />
      {canWrite ? (
        <SaveBar
          dirty={dirty}
          saving={saving}
          canSave={!error && !holdError}
          onDiscard={() => {
            setDraft(property.paymentGateways);
            setHold(String(property.onlinePaymentHoldMinutes ?? 30));
            setAutoRefund(property.autoRefundOnFreeCancellation ?? true);
            setKeepFee(property.deductPaymentFeeOnGuestRefund ?? true);
            setClockRefund(property.clockCancelRefundPolicy ?? 'NEVER');
            setClockFolio(property.clockPaymentFolio ?? 'DEPOSIT');
          }}
          onSave={() =>
            onPropertySave(
              {
                onlinePaymentHoldMinutes: Number(hold),
                autoRefundOnFreeCancellation: autoRefund,
                deductPaymentFeeOnGuestRefund: keepFee,
                ...(clockConnected
                  ? { clockCancelRefundPolicy: clockRefund, clockPaymentFolio: clockFolio }
                  : {}),
              },
              draft,
            )
          }
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
