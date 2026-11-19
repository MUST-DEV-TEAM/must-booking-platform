'use client';

import { formatDateTime } from '../../lib/hotel-format';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { FormField } from '../../components/ui/form-field';
import { FormSection } from '../../components/ui/form-section';
import { HotelLogoPicker } from '../../components/ui/hotel-logo-picker';
import {
  PokpayConnectionPanel,
  type PokpayConnection,
} from '../../components/ui/pokpay-connection-panel';
import { Input, Textarea } from '../../components/ui/input';
import { Checkbox } from '../../components/ui/checkbox';
import { ColourField } from '../../components/ui/colour-field';
import { Switch } from '../../components/ui/switch';
import { TimeField } from '../../components/ui/time-field';
import { PhoneInput, parsePhone, phoneToString } from '../../components/ui/phone-input';
import {
  ONLINE_PROFILE_SITES,
  checkOnlineProfile,
  contrastWithWhite,
  darkerForWhiteText,
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
import { BrandPreview } from '../../components/ui/brand-preview';
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
/** The sites that can be asked for a review, and the private feedback page (same keys as the review-links API). */
const REVIEW_SITES = [
  { key: 'google', label: 'Google Business Profile' },
  { key: 'tripadvisor', label: 'Tripadvisor' },
  { key: 'booking_com', label: 'Booking.com' },
  { key: 'facebook', label: 'Facebook' },
] as const;
type ReviewDraft = Record<string, string | null>;
const reviewsKey = (tenantId: string, propertyId: string) =>
  ['dashboard', 'review-links', tenantId, propertyId] as const;

type BrandingDraft = {
  logoUrl: string;
  logoDarkUrl: string;
  iconUrl: string;
  faviconUrl: string;
  coverUrl: string;
  accountingEmail: string;
  mainContactName: string;
  mainContactRole: string;
  mainContactPhone: string;
  mainContactEmail: string;
  reviews: ReviewDraft;
  brandColour: string;
  emailFooterText: string;
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
  accentColour: string;
  profiles: Record<string, string>;
};
const phoneKeys = ['phone', 'whatsappNumber', 'afterHoursPhone', 'mainContactPhone'] as const;
const textKeys = [
  'logoUrl',
  'logoDarkUrl',
  'iconUrl',
  'faviconUrl',
  'coverUrl',
  'accountingEmail',
  'mainContactName',
  'mainContactRole',
  'mainContactPhone',
  'mainContactEmail',
  'supportEmail',
  'reservationsEmail',
  'phone',
  'whatsappNumber',
  'afterHoursPhone',
  'receptionFrom',
  'receptionTo',
  'website',
  'brandColour',
  'accentColour',
  'emailFooterText',
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
  const client = useQueryClient();
  const reviewQuery = useQuery({
    queryKey: reviewsKey(tenantId, property.id),
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${property.id}/review-links`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Review links could not be read.');
      return ((await response.json()) as { links: Record<string, string> }).links ?? {};
    },
  });
  const savedReviews: Record<string, string> = reviewQuery.data ?? {};
  const saveReviews = useMutation({
    mutationFn: async (links: Record<string, string>) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${property.id}/review-links`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(links),
        },
      );
      if (!response.ok) throw new Error('Review links could not be saved.');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: reviewsKey(tenantId, property.id) }),
  });
  const initial: BrandingDraft = {
    logoUrl: property.logoUrl ?? '',
    logoDarkUrl: property.logoDarkUrl ?? '',
    iconUrl: property.iconUrl ?? '',
    faviconUrl: property.faviconUrl ?? '',
    coverUrl: property.coverUrl ?? '',
    accountingEmail: property.accountingEmail ?? '',
    mainContactName: property.mainContactName ?? '',
    mainContactRole: property.mainContactRole ?? '',
    mainContactPhone: property.mainContactPhone ?? '',
    mainContactEmail: property.mainContactEmail ?? '',
    reviews: Object.fromEntries(
      [...REVIEW_SITES.map((site) => site.key), 'feedback'].map((key) => [
        key,
        savedReviews[key] ?? null,
      ]),
    ),
    brandColour: property.brandColour ?? '',
    emailFooterText: property.emailFooterText ?? '',
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
    accentColour: property.accentColour ?? '',
    profiles: Object.fromEntries(
      ONLINE_PROFILE_SITES.map((site) => [site.key, property.onlineProfiles?.[site.key] ?? '']),
    ),
  };
  const [draft, setDraft] = useState(initial);
  const savedText = JSON.stringify(initial);
  useEffect(() => setDraft(JSON.parse(savedText) as BrandingDraft), [savedText]);
  const dirty = JSON.stringify(draft) !== savedText;
  useUnsavedChanges(canWrite && dirty);
  const changed = (key: keyof BrandingDraft) =>
    JSON.stringify(draft[key]) !== JSON.stringify(initial[key]);
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
    accountingEmail: shared('accountingEmail', draft.accountingEmail),
    mainContactName: shared('mainContactName', draft.mainContactName),
    mainContactRole: shared('mainContactRole', draft.mainContactRole),
    mainContactPhone: shared('mainContactPhone', draft.mainContactPhone),
    mainContactEmail: shared('mainContactEmail', draft.mainContactEmail),
    ...Object.fromEntries(
      Object.entries(draft.reviews).map(([key, url]) => [
        `review-${key}`,
        url === null
          ? null
          : !url.trim()
            ? 'Enter the review link, or untick this.'
            : webUrl(url.trim()) && url.trim().startsWith('https://')
              ? null
              : 'Enter a full https:// address.',
      ]),
    ),
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
    accentColour: shared('accentColour', draft.accentColour),
    ...Object.fromEntries(
      ONLINE_PROFILE_SITES.map((site) => [
        `profile-${site.key}`,
        checkOnlineProfile(site.key, (draft.profiles[site.key] ?? '').trim()),
      ]),
    ),
  };
  const labels = {
    supportEmail: 'Guest contact email',
    reservationsEmail: 'Reservations email',
    phone: 'Phone',
    whatsappNumber: 'WhatsApp number',
    afterHoursPhone: 'After-hours phone',
    website: 'Website address',
    brandColour: 'Brand colour',
    accentColour: 'Accent colour',
    emailFooterText: 'Optional note',
    accountingEmail: 'Accounting email',
    mainContactName: 'Name',
    mainContactRole: 'Role',
    mainContactPhone: 'Phone',
    mainContactEmail: 'Email',
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
      {key === 'brandColour' || key === 'accentColour' ? (
        <ColourField
          id={`branding-${key}`}
          value={draft[key]}
          disabled={!canWrite}
          invalid={!!errors[key]}
          onChange={(colour) => setDraft({ ...draft, [key]: colour })}
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
  const picked = (url: string) => (webUrl(url.trim()) && url.trim() ? url.trim() : null);
  const profileNames = ONLINE_PROFILE_SITES.filter((site) =>
    (draft.profiles[site.key] ?? '').trim(),
  ).map((site) => site.label);
  // The email footer is built from what is saved elsewhere, so it cannot go out of date.
  const footerLines = [
    property.name,
    [property.address, property.city].filter(Boolean).join(', '),
    [draft.supportEmail.trim(), draft.phone.trim()].filter(Boolean).join(' · '),
    property.legalName
      ? `${property.legalName}${property.taxNumber ? ` · NUIS ${property.taxNumber}` : ''}`
      : '',
    profileNames.length ? `Follow us: ${profileNames.join(', ')}` : '',
  ].filter(Boolean);
  const ticked = Object.entries(draft.reviews).filter(([, url]) => url !== null);
  const setReview = (key: string, url: string | null) =>
    setDraft({ ...draft, reviews: { ...draft.reviews, [key]: url } });
  const reviewField = (key: string, label: string) => {
    const url = draft.reviews[key];
    const id = `branding-review-${key}`;
    return (
      <div key={key} className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id={id}
            checked={url !== null}
            disabled={!canWrite}
            onCheckedChange={(on) => setReview(key, on === true ? '' : null)}
          />
          {key === 'feedback' ? 'Private feedback' : `Ask guests for a review on ${label}`}
        </label>
        {url !== null ? (
          <FormField
            label={key === 'feedback' ? 'Private feedback link' : `${label} review link`}
            htmlFor={`${id}-url`}
            hint={
              key === 'feedback'
                ? 'A form where guests tell you how it went, before any public review.'
                : 'The "write a review" page, which is not the same as your profile address.'
            }
            error={
              JSON.stringify(url) !== JSON.stringify(initial.reviews[key])
                ? errors[`review-${key}`]
                : null
            }
          >
            <Input
              id={`${id}-url`}
              disabled={!canWrite}
              inputMode="url"
              placeholder="https://"
              value={url}
              onChange={(e) => setReview(key, e.target.value)}
            />
          </FormField>
        ) : null}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-muted-foreground">
        These details style this system and the emails it sends. They are not shown on your public
        website.
      </p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:items-start">
        <div className="flex flex-col gap-4">
          <FormSection
            title="Brand"
            description="Your logos, icon and colours. Used in emails, on the booking page and in this system."
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <HotelLogoPicker
                tenantId={tenantId}
                propertyId={property.id}
                kind="logo"
                value={draft.logoUrl}
                onChange={(logoUrl) => setDraft({ ...draft, logoUrl })}
                canManage={canWrite && canManagePhotos}
              />
              <HotelLogoPicker
                tenantId={tenantId}
                propertyId={property.id}
                kind="dark"
                value={draft.logoDarkUrl}
                onChange={(logoDarkUrl) => setDraft({ ...draft, logoDarkUrl })}
                canManage={canWrite && canManagePhotos}
              />
              <HotelLogoPicker
                tenantId={tenantId}
                propertyId={property.id}
                kind="icon"
                value={draft.iconUrl}
                onChange={(iconUrl) => setDraft({ ...draft, iconUrl })}
                canManage={canWrite && canManagePhotos}
              />
              <HotelLogoPicker
                tenantId={tenantId}
                propertyId={property.id}
                kind="favicon"
                value={draft.faviconUrl || draft.iconUrl}
                onChange={(faviconUrl) => setDraft({ ...draft, faviconUrl })}
                canManage={canWrite && canManagePhotos}
              />
            </div>
            <HotelLogoPicker
              tenantId={tenantId}
              propertyId={property.id}
              kind="cover"
              value={draft.coverUrl}
              onChange={(coverUrl) => setDraft({ ...draft, coverUrl })}
              canManage={canWrite && canManagePhotos}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {field('brandColour', 'Buttons and headings in emails, for example #224858.')}
              {field('accentColour', 'Optional second colour for links and highlights.')}
            </div>
            {(
              [
                ['brandColour', 'Brand colour'],
                ['accentColour', 'Accent colour'],
              ] as const
            ).map(([key, name]) =>
              /^#[0-9a-f]{6}$/i.test(draft[key]) && contrastWithWhite(draft[key]) < 4.5 ? (
                <p key={key} className="m-0 text-xs text-warning">
                  White text is hard to read on the {name.toLowerCase()}. Try{' '}
                  {darkerForWhiteText(draft[key])}.
                </p>
              ) : null,
            )}
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
          </FormSection>
          <FormSection
            title="Online profiles and reviews"
            description="The hotel's pages on other sites, and where guests are asked to review you. Full https addresses on that site only. Leave empty to leave one out."
          >
            {ONLINE_PROFILE_SITES.map((site) => {
              const reviewSite = REVIEW_SITES.find((entry) => entry.key === site.key);
              return (
                <div key={site.key} className="flex flex-col gap-3">
                  <FormField
                    label={site.label}
                    htmlFor={`branding-profile-${site.key}`}
                    error={
                      JSON.stringify(draft.profiles[site.key]) !==
                      JSON.stringify(initial.profiles[site.key])
                        ? errors[`profile-${site.key}`]
                        : null
                    }
                  >
                    <Input
                      id={`branding-profile-${site.key}`}
                      disabled={!canWrite}
                      inputMode="url"
                      placeholder="https://"
                      value={draft.profiles[site.key] ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          profiles: { ...draft.profiles, [site.key]: e.target.value },
                        })
                      }
                    />
                  </FormField>
                  {reviewSite ? reviewField(reviewSite.key, reviewSite.label) : null}
                </div>
              );
            })}
            {reviewField('feedback', 'Private feedback')}
            <p
              className={`m-0 text-xs ${ticked.length > 3 ? 'text-warning' : 'text-muted-foreground'}`}
            >
              {ticked.length > 3
                ? `${ticked.length} review links are ticked, but the after-stay email shows only the first 3, in the order listed here.`
                : 'The after-stay email shows up to 3 review links, in the order listed here.'}
            </p>
          </FormSection>
          <FormSection
            title="Email footer"
            description="Built from your saved details, so it never goes out of date. You can add one short note."
          >
            <div className="flex flex-col gap-0.5 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {footerLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
              <span className="mt-1 text-xs text-muted-foreground">
                Name, address, contact, legal name and tax number come from Profile and Contact and
                brand. Social links come from Online profiles above.
              </span>
            </div>
            <FormField
              label="Optional note"
              htmlFor="branding-emailFooterText"
              hint={`${draft.emailFooterText.length} / 300`}
              error={shown('emailFooterText')}
            >
              <Textarea
                id="branding-emailFooterText"
                rows={2}
                maxLength={300}
                disabled={!canWrite}
                value={draft.emailFooterText}
                onChange={(e) => setDraft({ ...draft, emailFooterText: e.target.value })}
              />
            </FormField>
          </FormSection>
          <FormSection
            title="Internal contacts"
            description="Never shown to guests. For MUST and for your accountant."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {field('accountingEmail', 'Where invoices and financial notices can be sent.')}
            </div>
            <p className="m-0 text-sm font-semibold">Main contact for MUST</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('mainContactName')}
              {field('mainContactRole')}
              {field('mainContactPhone')}
              {field('mainContactEmail')}
            </div>
          </FormSection>
        </div>
        <div className="xl:sticky xl:top-24">
          <BrandPreview
            name={property.name}
            logoUrl={picked(draft.logoUrl)}
            logoDarkUrl={picked(draft.logoDarkUrl)}
            iconUrl={picked(draft.iconUrl)}
            faviconUrl={picked(draft.faviconUrl)}
            coverUrl={picked(draft.coverUrl)}
            colour={draft.brandColour}
            accent={draft.accentColour}
            footerLines={footerLines}
            note={draft.emailFooterText}
            termsUrl={property.termsUrl ?? ''}
          />
        </div>
      </div>
      {canWrite ? (
        <SaveBar
          dirty={dirty}
          saving={saving || saveReviews.isPending}
          canSave={!Object.values(errors).some(Boolean)}
          onDiscard={() => setDraft(initial)}
          onSave={() => {
            const update: Record<string, unknown> = {};
            for (const key of textKeys)
              if (draft[key] !== initial[key])
                update[key] =
                  normaliseProfileValue(key as ProfileFieldKey, draft[key].trim()) ?? null;
            if (changed('profiles'))
              update.onlineProfiles = Object.fromEntries(
                Object.entries(draft.profiles)
                  .map(([site, url]) => [site, url.trim()])
                  .filter(([, url]) => url),
              );
            for (const key of ['whatsappSameAsPhone', 'receptionOpen24h'] as const)
              if (draft[key] !== initial[key]) update[key] = draft[key];
            if (Object.keys(update).length) onSave(update as Partial<Property>);
            if (changed('reviews'))
              saveReviews.mutate({
                // Links for other sites (the hotel's own website) are kept as they are.
                ...savedReviews,
                ...Object.fromEntries(
                  Object.entries(draft.reviews)
                    .filter(([, url]) => url !== null)
                    .map(([key, url]) => [key, (url as string).trim()]),
                ),
                ...Object.fromEntries(
                  Object.entries(draft.reviews)
                    .filter(([key, url]) => url === null && key in savedReviews)
                    .map(([key]) => [key, '']),
                ),
              });
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
          <p className="m-0 text-sm">Paired on {formatDateTime(property.wordpressConnectedAt)}</p>
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
