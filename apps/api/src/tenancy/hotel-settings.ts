import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import {
  COUNTRY_CODES,
  checkBookingLimit,
  checkBookingWindow,
  checkWeekdays,
  checkSeason,
  type BookingLimitKey,
  normaliseOnlineProfiles,
  HOTEL_LANGUAGE_CODES,
  LANGUAGE_CODES,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  checkProfileCombination,
  checkProfileField,
  normaliseProfileValue,
  type ProfileFieldKey,
  LATE_ARRIVAL_MAX,
  OTHER_HOUSE_RULES_MAX,
  POLICY_CHOICES,
  type PolicyChoiceKey,
  type PolicyValues,
  checkIdDocuments,
  checkAcceptedAtHotel,
  checkPaymentOrder,
  checkPaymentSettings,
  BANK_TRANSFER_DAYS,
  checkIban,
  normaliseIban,
  type PaymentValues,
  checkMoneyAmount,
  checkPolicies,
  normaliseMoney,
  staleDependents,
} from '@must/domain-contracts';
export type HotelSettings = {
  dateFormat?: string;
  timeFormat?: string;
  weekStart?: string;
  numberFormat?: string;
  legalName?: string | null;
  taxNumber?: string | null;
  country?: string | null;
  defaultCurrency?: string | null;
  languages?: string[];
  website?: string | null;
  reservationsEmail?: string | null;
  description?: string | null;
  starRating?: number | null;
  chainName?: string | null;
  propertyType?: string | null;
  starRatingOfficial?: boolean;
  yearOpened?: number | null;
  yearRenovated?: number | null;
  summary?: string | null;
  tourismLicence?: string | null;
  vatRegistered?: boolean;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  directions?: string | null;
  nearestAirportCode?: string | null;
  nearestAirportKm?: number | null;
  accountingEmail?: string | null;
  mainContactName?: string | null;
  mainContactRole?: string | null;
  mainContactPhone?: string | null;
  mainContactEmail?: string | null;
  registeredSameAsHotel?: boolean;
  registeredStreet?: string | null;
  registeredCity?: string | null;
  registeredPostalCode?: string | null;
  phone?: string | null;
  supportEmail?: string | null;
  minNoticeHours?: number | null;
  seasonOpenFrom?: string | null;
  seasonOpenTo?: string | null;
  arrivalDays?: number[];
  departureDays?: number[];
  groupRequestForm?: boolean;
  groupRequestEmail?: string | null;
  minBookingAge?: number | null;
  childrenUpToAge?: number | null;
  infantsUpToAge?: number | null;
  askChildrenAges?: boolean;
  fillGapNights?: boolean;
  confirmationMode?: string;
  onRequestHours?: number | null;
  formPhone?: string;
  formCountry?: string;
  formAddress?: string;
  formArrivalTime?: string;
  formSpecialRequests?: string;
  formGuestNamePerRoom?: string;
  formCompany?: string;
  formMarketing?: string;
  accentColour?: string | null;
  onlineProfiles?: Record<string, string>;
  whatsappSameAsPhone?: boolean;
  whatsappNumber?: string | null;
  afterHoursPhone?: string | null;
  receptionOpen24h?: boolean;
  receptionFrom?: string | null;
  receptionTo?: string | null;
  allowSameDayBooking?: boolean;
  sameDayCutoffTime?: string | null;
  maxGuestsPerBooking?: number | null;
  maxRoomsPerBooking?: number | null;
  noShowRule?: string | null;
  earlyCheckInPolicy?: string | null;
  earlyCheckInUntil?: string | null;
  earlyCheckInNote?: string | null;
  lateCheckOutPolicy?: string | null;
  lateCheckOutUntil?: string | null;
  lateCheckOutNote?: string | null;
  checkInUntil?: string | null;
  checkOutFrom?: string | null;
  lateArrivalInstructions?: string | null;
  cotsPolicy?: string;
  cotsFee?: string | null;
  cotsMax?: number | null;
  extraBedsPolicy?: string;
  extraBedsFee?: string | null;
  extraBedsMax?: number | null;
  petsFeeType?: string | null;
  petsFee?: string | null;
  petsMax?: number | null;
  smokingPolicy?: string | null;
  partiesPolicy?: string | null;
  idAtArrival?: string;
  idDocuments?: string[];
  damageDepositAmount?: string | null;
  damageDepositMethod?: string | null;
  damageDepositRefundDays?: number | null;
  otherHouseRules?: string | null;
  paymentMethodOrder?: string[];
  paymentDefaultMethod?: string | null;
  acceptedAtHotel?: string[];
  paymentLinkValidDays?: number;
  bankTransferEnabled?: boolean;
  bankTransferDays?: number;
  bankAccountHolder?: string | null;
  bankIban?: string | null;
  bankBic?: string | null;
  bankName?: string | null;
  bankTransferNote?: string | null;
  paymentSecondReminderDays?: number | null;
  paymentLinkExpiryAction?: string;
  quietHoursFrom?: string | null;
  quietHoursTo?: string | null;
  childrenPolicy?: string | null;
  childrenPolicyNote?: string | null;
  petsPolicy?: string | null;
  petsPolicyNote?: string | null;
};
export const hotelFields = [
  { key: 'dateFormat', column: 'date_format', kind: 'text', max: 20 },
  { key: 'timeFormat', column: 'time_format', kind: 'format', max: 3 },
  { key: 'weekStart', column: 'week_start', kind: 'format', max: 6 },
  { key: 'numberFormat', column: 'number_format', kind: 'format', max: 10 },
  { key: 'legalName', column: 'legal_name', kind: 'profile', max: 200 },
  { key: 'taxNumber', column: 'tax_number', kind: 'profile', max: 100 },
  { key: 'country', column: 'country', kind: 'country', max: 2 },
  { key: 'defaultCurrency', column: 'default_currency', kind: 'currency', max: 3 },
  { key: 'languages', column: 'languages', kind: 'languages', max: 0 },
  { key: 'website', column: 'website', kind: 'profile', max: 500 },
  { key: 'reservationsEmail', column: 'reservations_email', kind: 'profile', max: 254 },
  { key: 'whatsappSameAsPhone', column: 'whatsapp_same_as_phone', kind: 'profile', max: 0 },
  { key: 'whatsappNumber', column: 'whatsapp_number', kind: 'profile', max: 20 },
  { key: 'afterHoursPhone', column: 'after_hours_phone', kind: 'profile', max: 20 },
  { key: 'receptionOpen24h', column: 'reception_open_24h', kind: 'profile', max: 0 },
  { key: 'receptionFrom', column: 'reception_from', kind: 'profile', max: 5 },
  { key: 'receptionTo', column: 'reception_to', kind: 'profile', max: 5 },
  { key: 'accentColour', column: 'accent_colour', kind: 'profile', max: 7 },
  { key: 'minNoticeHours', column: 'min_notice_hours', kind: 'limit', max: 0 },
  { key: 'seasonOpenFrom', column: 'season_open_from', kind: 'monthday', max: 5 },
  { key: 'seasonOpenTo', column: 'season_open_to', kind: 'monthday', max: 5 },
  { key: 'arrivalDays', column: 'arrival_days', kind: 'weekdays', max: 0 },
  { key: 'departureDays', column: 'departure_days', kind: 'weekdays', max: 0 },
  { key: 'groupRequestForm', column: 'group_request_form', kind: 'boolean', max: 0 },
  { key: 'groupRequestEmail', column: 'group_request_email', kind: 'email', max: 254 },
  { key: 'minBookingAge', column: 'min_booking_age', kind: 'limit', max: 0 },
  { key: 'childrenUpToAge', column: 'children_up_to_age', kind: 'limit', max: 0 },
  { key: 'infantsUpToAge', column: 'infants_up_to_age', kind: 'limit', max: 0 },
  { key: 'askChildrenAges', column: 'ask_children_ages', kind: 'boolean', max: 0 },
  { key: 'fillGapNights', column: 'fill_gap_nights', kind: 'boolean', max: 0 },
  { key: 'confirmationMode', column: 'confirmation_mode', kind: 'confirmation', max: 10 },
  { key: 'onRequestHours', column: 'on_request_hours', kind: 'limit', max: 0 },
  { key: 'formPhone', column: 'form_phone', kind: 'formfield', max: 8 },
  { key: 'formCountry', column: 'form_country', kind: 'formfield', max: 8 },
  { key: 'formAddress', column: 'form_address', kind: 'formfield', max: 8 },
  { key: 'formArrivalTime', column: 'form_arrival_time', kind: 'formfield', max: 8 },
  { key: 'formSpecialRequests', column: 'form_special_requests', kind: 'formfield', max: 8 },
  { key: 'formGuestNamePerRoom', column: 'form_guest_name_per_room', kind: 'formfield', max: 8 },
  { key: 'formCompany', column: 'form_company', kind: 'formfield', max: 8 },
  { key: 'formMarketing', column: 'form_marketing', kind: 'formfield', max: 8 },
  { key: 'onlineProfiles', column: 'online_profiles', kind: 'profiles', max: 0 },
  { key: 'description', column: 'description', kind: 'profile', max: 1000 },
  { key: 'starRating', column: 'star_rating', kind: 'stars', max: 0 },
  { key: 'chainName', column: 'chain_name', kind: 'profile', max: 120 },
  { key: 'propertyType', column: 'property_type', kind: 'profile', max: 30 },
  { key: 'starRatingOfficial', column: 'star_rating_official', kind: 'profile', max: 0 },
  { key: 'yearOpened', column: 'year_opened', kind: 'profile', max: 0 },
  { key: 'yearRenovated', column: 'year_renovated', kind: 'profile', max: 0 },
  { key: 'summary', column: 'summary', kind: 'profile', max: 160 },
  { key: 'tourismLicence', column: 'tourism_licence', kind: 'profile', max: 50 },
  { key: 'vatRegistered', column: 'vat_registered', kind: 'profile', max: 0 },
  { key: 'addressLine2', column: 'address_line_2', kind: 'profile', max: 200 },
  { key: 'city', column: 'city', kind: 'profile', max: 100 },
  { key: 'region', column: 'region', kind: 'profile', max: 100 },
  { key: 'postalCode', column: 'postal_code', kind: 'profile', max: 20 },
  { key: 'latitude', column: 'latitude', kind: 'profile', max: 0 },
  { key: 'longitude', column: 'longitude', kind: 'profile', max: 0 },
  { key: 'directions', column: 'directions', kind: 'profile', max: 300 },
  { key: 'nearestAirportCode', column: 'nearest_airport_code', kind: 'profile', max: 3 },
  { key: 'nearestAirportKm', column: 'nearest_airport_km', kind: 'profile', max: 0 },
  { key: 'accountingEmail', column: 'accounting_email', kind: 'profile', max: 254 },
  { key: 'mainContactName', column: 'main_contact_name', kind: 'profile', max: 120 },
  { key: 'mainContactRole', column: 'main_contact_role', kind: 'profile', max: 120 },
  { key: 'mainContactPhone', column: 'main_contact_phone', kind: 'profile', max: 20 },
  { key: 'mainContactEmail', column: 'main_contact_email', kind: 'profile', max: 254 },
  {
    key: 'registeredSameAsHotel',
    column: 'registered_same_as_hotel',
    kind: 'profile',
    max: 0,
  },
  { key: 'registeredStreet', column: 'registered_street', kind: 'profile', max: 200 },
  { key: 'registeredCity', column: 'registered_city', kind: 'profile', max: 100 },
  { key: 'registeredPostalCode', column: 'registered_postal_code', kind: 'profile', max: 20 },
  { key: 'allowSameDayBooking', column: 'same_day_booking_allowed', kind: 'boolean', max: 0 },
  { key: 'sameDayCutoffTime', column: 'same_day_cutoff_time', kind: 'time', max: 5 },
  { key: 'maxGuestsPerBooking', column: 'max_guests_per_booking', kind: 'limit', max: 0 },
  { key: 'maxRoomsPerBooking', column: 'max_rooms_per_booking', kind: 'limit', max: 0 },
  { key: 'noShowRule', column: 'no_show_rule', kind: 'no_show', max: 0 },
  { key: 'earlyCheckInPolicy', column: 'early_check_in_policy', kind: 'arrival', max: 0 },
  { key: 'earlyCheckInUntil', column: 'early_check_in_until', kind: 'time', max: 5 },
  { key: 'earlyCheckInNote', column: 'early_check_in_note', kind: 'text', max: 300 },
  { key: 'lateCheckOutPolicy', column: 'late_check_out_policy', kind: 'arrival', max: 0 },
  { key: 'lateCheckOutUntil', column: 'late_check_out_until', kind: 'time', max: 5 },
  { key: 'lateCheckOutNote', column: 'late_check_out_note', kind: 'text', max: 300 },
  { key: 'checkInUntil', column: 'check_in_until', kind: 'time', max: 5 },
  { key: 'checkOutFrom', column: 'check_out_from', kind: 'time', max: 5 },
  {
    key: 'lateArrivalInstructions',
    column: 'late_arrival_instructions',
    kind: 'text',
    max: LATE_ARRIVAL_MAX,
  },
  { key: 'cotsPolicy', column: 'cots_policy', kind: 'pchoice', max: 0 },
  { key: 'cotsFee', column: 'cots_fee', kind: 'pmoney', max: 0 },
  { key: 'cotsMax', column: 'cots_max', kind: 'limit', max: 0 },
  { key: 'extraBedsPolicy', column: 'extra_beds_policy', kind: 'pchoice', max: 0 },
  { key: 'extraBedsFee', column: 'extra_beds_fee', kind: 'pmoney', max: 0 },
  { key: 'extraBedsMax', column: 'extra_beds_max', kind: 'limit', max: 0 },
  { key: 'petsFeeType', column: 'pets_fee_type', kind: 'pchoice', max: 0 },
  { key: 'petsFee', column: 'pets_fee', kind: 'pmoney', max: 0 },
  { key: 'petsMax', column: 'pets_max', kind: 'limit', max: 0 },
  { key: 'smokingPolicy', column: 'smoking_policy', kind: 'pchoice', max: 0 },
  { key: 'partiesPolicy', column: 'parties_policy', kind: 'pchoice', max: 0 },
  { key: 'idAtArrival', column: 'id_at_arrival', kind: 'pchoice', max: 0 },
  { key: 'idDocuments', column: 'id_documents', kind: 'pmulti', max: 0 },
  { key: 'damageDepositAmount', column: 'damage_deposit_amount', kind: 'pmoney', max: 0 },
  { key: 'damageDepositMethod', column: 'damage_deposit_method', kind: 'pchoice', max: 0 },
  { key: 'damageDepositRefundDays', column: 'damage_deposit_refund_days', kind: 'limit', max: 0 },
  { key: 'otherHouseRules', column: 'other_house_rules', kind: 'text', max: OTHER_HOUSE_RULES_MAX },
  { key: 'paymentMethodOrder', column: 'payment_method_order', kind: 'pmulti', max: 0 },
  { key: 'paymentDefaultMethod', column: 'payment_default_method', kind: 'pchoice', max: 0 },
  { key: 'acceptedAtHotel', column: 'accepted_at_hotel', kind: 'pmulti', max: 0 },
  { key: 'paymentLinkValidDays', column: 'payment_link_valid_days', kind: 'limit', max: 0 },
  { key: 'bankTransferEnabled', column: 'bank_transfer_enabled', kind: 'boolean', max: 0 },
  { key: 'bankTransferDays', column: 'bank_transfer_days', kind: 'bank', max: 0 },
  { key: 'bankAccountHolder', column: 'bank_account_holder', kind: 'text', max: 120 },
  { key: 'bankIban', column: 'bank_iban', kind: 'bank', max: 0 },
  { key: 'bankBic', column: 'bank_bic', kind: 'bank', max: 0 },
  { key: 'bankName', column: 'bank_name', kind: 'text', max: 120 },
  { key: 'bankTransferNote', column: 'bank_transfer_note', kind: 'text', max: 300 },
  {
    key: 'paymentSecondReminderDays',
    column: 'payment_second_reminder_days',
    kind: 'limit',
    max: 0,
  },
  { key: 'paymentLinkExpiryAction', column: 'payment_link_expiry_action', kind: 'pchoice', max: 0 },
  { key: 'quietHoursFrom', column: 'quiet_hours_from', kind: 'time', max: 5 },
  { key: 'quietHoursTo', column: 'quiet_hours_to', kind: 'time', max: 5 },
  { key: 'childrenPolicy', column: 'children_policy', kind: 'policy', max: 0 },
  { key: 'childrenPolicyNote', column: 'children_policy_note', kind: 'text', max: 300 },
  { key: 'petsPolicy', column: 'pets_policy', kind: 'policy', max: 0 },
  { key: 'petsPolicyNote', column: 'pets_policy_note', kind: 'text', max: 300 },
] as const;
export const hotelColumns = Prisma.raw(
  hotelFields.map((f) => `${f.column} AS "${f.key}"`).join(','),
);
/** The one column list every property read and write returns (settings redesign P13). */
export const propertyColumns = Prisma.raw(
  `online_payment_hold_minutes AS "onlinePaymentHoldMinutes",auto_refund_on_free_cancellation AS "autoRefundOnFreeCancellation",deduct_payment_fee_on_guest_refund AS "deductPaymentFeeOnGuestRefund",clock_cancel_refund_policy AS "clockCancelRefundPolicy",clock_payment_folio AS "clockPaymentFolio",brand_colour AS "brandColour",email_footer_text AS "emailFooterText",terms_url AS "termsUrl",${hotelColumns.sql},logo_url AS "logoUrl", logo_dark_url AS "logoDarkUrl", icon_url AS "iconUrl", favicon_url AS "faviconUrl", cover_url AS "coverUrl", phone, support_email AS "supportEmail", booking_mode AS "bookingMode", min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights", check_in_time AS "checkInTime", check_out_time AS "checkOutTime", rules, advance_booking_days AS "advanceBookingDays", free_cancellation_days_before_arrival AS "freeCancellationDaysBeforeArrival", public_website_origin AS "publicWebsiteOrigin", json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"`,
);
const REQUIRED_HOTEL_FIELDS: Record<string, string> = {
  propertyType: 'Property type',
  city: 'City',
  country: 'Country',
};
const NON_NULL_POLICY_CHOICES: readonly string[] = [
  'cotsPolicy',
  'extraBedsPolicy',
  'idAtArrival',
  'paymentLinkExpiryAction',
];
export function hotelInput(raw: Record<string, unknown>): HotelSettings {
  const out: Record<string, unknown> = {};
  for (const f of hotelFields) {
    if (!Object.hasOwn(raw, f.key)) continue;
    let v = raw[f.key];
    const bad = (message: string): never => {
      throw new BadRequestException(message);
    };
    if (f.kind === 'bank') {
      // Bank transfer details (G-48): the number of days, the IBAN and the BIC.
      if (f.key === 'bankTransferDays') {
        if (
          !Number.isInteger(v) ||
          Number(v) < BANK_TRANSFER_DAYS.min ||
          Number(v) > BANK_TRANSFER_DAYS.max
        )
          bad(
            `Give guests between ${BANK_TRANSFER_DAYS.min} and ${BANK_TRANSFER_DAYS.max} days to transfer.`,
          );
      } else if (v === null || v === '') {
        v = null;
      } else if (f.key === 'bankIban') {
        const message = checkIban(v);
        if (message) bad(message);
        v = normaliseIban(v as string);
      } else {
        const bic = typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : '';
        if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic))
          bad('Enter a valid BIC (8 or 11 letters and digits), or leave it empty.');
        v = bic;
      }
    } else if (f.kind === 'limit') {
      v = v === '' ? null : v;
      const message = checkBookingLimit(f.key as BookingLimitKey, v);
      if (message) bad(message);
    } else if (f.kind === 'monthday') {
      v = v === '' ? null : v;
      if (v !== null && typeof v !== 'string') bad('Choose a real date for the season.');
    } else if (f.kind === 'weekdays') {
      if (Array.isArray(v)) v = [...new Set(v)];
      const message = checkWeekdays(v);
      if (message) bad(message);
      v = (v as number[]).sort();
    } else if (f.kind === 'profiles') {
      const result = normaliseOnlineProfiles(v);
      const first = Object.values(result.errors)[0];
      if (first) bad(first);
      v = result.value;
    } else if (f.kind === 'profile') {
      const key = f.key as ProfileFieldKey;
      v = normaliseProfileValue(key, v);
      const message = checkProfileField(key, v, {
        country: typeof raw.country === 'string' ? raw.country : null,
        year: new Date().getFullYear(),
      });
      if (message) bad(message);
      if (
        v === null &&
        (key === 'starRatingOfficial' ||
          key === 'vatRegistered' ||
          key === 'whatsappSameAsPhone' ||
          key === 'receptionOpen24h' ||
          key === 'registeredSameAsHotel')
      )
        bad('Choose yes or no.');
    } else if (f.kind === 'pmoney') {
      const money = normaliseMoney(v);
      const message = checkMoneyAmount(v);
      if (message) bad(message);
      v = money;
    } else if (f.kind === 'pmulti') {
      const message =
        f.key === 'paymentMethodOrder'
          ? checkPaymentOrder(v)
          : f.key === 'acceptedAtHotel'
            ? checkAcceptedAtHotel(v)
            : checkIdDocuments(v);
      if (message) bad(message);
      // The checkout order is the order the owner chose; the other lists are kept sorted.
      if (f.key !== 'paymentMethodOrder') v = [...(v as string[])].sort();
    } else if (f.kind === 'boolean') {
      if (typeof v !== 'boolean') bad('Choose yes or no.');
    } else if (f.kind === 'languages') {
      if (
        !Array.isArray(v) ||
        v.some(
          (x) =>
            typeof x !== 'string' ||
            !(LANGUAGE_CODES.includes(x) || HOTEL_LANGUAGE_CODES.includes(x)),
        )
      )
        bad('Choose languages from the list.');
      if ((v as unknown[]).length === 0) bad('Choose at least one language.');
      v = [...new Set(v as string[])].sort();
    } else if (v === null || v === '') {
      v = null;
    } else if (f.kind === 'stars') {
      if (
        !Number.isSafeInteger(v) ||
        Number(v) < 1 ||
        Number(v) > (f.kind === 'stars' ? 5 : 2147483647)
      )
        bad(
          f.kind === 'stars'
            ? 'Choose a star rating from 1 to 5.'
            : 'Enter a positive whole-number booking limit.',
        );
    } else {
      if (typeof v !== 'string') bad('Enter a valid ' + f.key + '.');
      v = (v as string).trim();
      if (!v) v = null;
      if (v && f.max && (v as string).length > f.max)
        bad(`Keep ${f.key} to ${f.max} characters or fewer.`);
      if (v && f.kind === 'country' && !(COUNTRY_CODES as readonly string[]).includes(v as string))
        bad('Choose a country from the ISO list.');
      if (
        v &&
        f.kind === 'currency' &&
        !(Intl as unknown as { supportedValuesOf: (key: string) => string[] })
          .supportedValuesOf('currency')
          .includes(v as string)
      )
        bad('Choose a currency from the list.');
      if (v && f.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v as string))
        bad('Enter a valid email address.');
      if (v && f.kind === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v as string))
        bad('Use a local time such as 15:00.');
      const choices =
        f.kind === 'no_show'
          ? ['charge_first_night', 'charge_nothing', 'flag_for_review']
          : f.kind === 'confirmation'
            ? ['instant', 'on_request']
            : f.kind === 'formfield'
              ? ['required', 'optional', 'hidden']
              : f.kind === 'arrival'
                ? ['not_offered', 'on_request', 'free_until']
                : f.kind === 'pchoice'
                  ? [...POLICY_CHOICES[f.key as PolicyChoiceKey]]
                  : f.kind === 'policy'
                    ? ['allowed', 'on_request', 'not_allowed']
                    : f.kind === 'format'
                      ? ((f.key === 'timeFormat'
                          ? TIME_FORMATS
                          : f.key === 'weekStart'
                            ? WEEK_STARTS
                            : NUMBER_FORMATS) as readonly string[])
                      : null;
      if (choices && v && !choices.includes(v as string)) bad('Choose a policy from the list.');
    }
    if (
      v === null &&
      (f.kind === 'confirmation' ||
        f.kind === 'formfield' ||
        f.kind === 'no_show' ||
        f.kind === 'arrival' ||
        (f.kind === 'pchoice' && NON_NULL_POLICY_CHOICES.includes(f.key)) ||
        f.kind === 'boolean' ||
        f.kind === 'format')
    )
      bad('Choose a policy from the list.');
    if (f.key === 'dateFormat' && !['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(String(v)))
      bad('Choose a supported hotel date format.');
    // These stay filled in once set: guests and emails depend on them. (A hotel that never set one can still
    // save other settings; the Profile form asks for them.)
    if (v === null && REQUIRED_HOTEL_FIELDS[f.key])
      throw new BadRequestException(`${REQUIRED_HOTEL_FIELDS[f.key]} is required.`);
    out[f.key] = v;
  }
  return out as HotelSettings;
}
export function checkHotelSettings(value: HotelSettings, changed: readonly string[] = []) {
  const year = new Date().getFullYear();
  if (['seasonOpenFrom', 'seasonOpenTo'].some((key) => changed.includes(key))) {
    const message = checkSeason(value.seasonOpenFrom, value.seasonOpenTo);
    if (message) throw new BadRequestException(message);
  }
  for (const key of ['taxNumber', 'region', 'postalCode', 'registeredPostalCode'] as const) {
    const current = value[key];
    if (current && (changed.includes(key) || changed.includes('country'))) {
      const message = checkProfileField(key, current, { country: value.country, year });
      if (message) throw new BadRequestException(message);
    }
  }
  if (
    [
      'yearOpened',
      'yearRenovated',
      'starRating',
      'starRatingOfficial',
      'latitude',
      'longitude',
      'whatsappSameAsPhone',
      'whatsappNumber',
      'receptionOpen24h',
      'receptionFrom',
      'receptionTo',
      'registeredSameAsHotel',
      'registeredStreet',
      'registeredCity',
    ].some((key) => changed.includes(key))
  ) {
    const problem = Object.values(checkProfileCombination(value))[0];
    if (problem) throw new BadRequestException(problem);
  }
  if (value.earlyCheckInPolicy === 'free_until' && !value.earlyCheckInUntil)
    throw new BadRequestException('Enter the free early check-in time.');
  if (value.lateCheckOutPolicy === 'free_until' && !value.lateCheckOutUntil)
    throw new BadRequestException('Enter the free late check-out time.');
  if (
    ['childrenUpToAge', 'infantsUpToAge'].some((key) => changed.includes(key)) &&
    checkBookingWindow(value).infantsUpToAge
  )
    throw new BadRequestException(checkBookingWindow(value).infantsUpToAge);
  if (Boolean(value.quietHoursFrom) !== Boolean(value.quietHoursTo))
    throw new BadRequestException('Enter both quiet-hours times, or leave both empty.');
  if (POLICY_KEYS.some((key) => changed.includes(key))) {
    const problem = Object.values(checkPolicies(value as PolicyValues))[0];
    if (problem) throw new BadRequestException(problem);
  }
}
/** Which saved fields make each payment rule run (a hotel that never set a field can still save the others). */
const PAYMENT_RULE_TRIGGERS: Record<string, readonly string[]> = {
  methods: ['paymentGateways'],
  paymentDefaultMethod: ['paymentDefaultMethod', 'paymentGateways'],
  acceptedAtHotel: ['acceptedAtHotel', 'paymentGateways'],
  paymentLinkValidDays: ['paymentLinkValidDays'],
  paymentSecondReminderDays: ['paymentSecondReminderDays', 'paymentLinkValidDays'],
};
/**
 * The first payment-method rule the change breaks, or null. `merged` is the saved hotel with the change applied;
 * `firstReminderDays` is the first payment reminder set in Emails (null when none is saved).
 */
/** The saved fields that make a payment rule run; a save touching none of them skips the payment checks. */
export const PAYMENT_TRIGGER_KEYS = [...new Set(Object.values(PAYMENT_RULE_TRIGGERS).flat())];
export function paymentChangeProblem(
  merged: HotelSettings & { paymentGateways?: PaymentValues['enabled'] },
  changed: readonly string[],
  firstReminderDays: number | null,
): string | null {
  const problems = checkPaymentSettings({
    enabled: merged.paymentGateways,
    paymentDefaultMethod: merged.paymentDefaultMethod,
    acceptedAtHotel: merged.acceptedAtHotel,
    paymentLinkValidDays: merged.paymentLinkValidDays,
    paymentSecondReminderDays: merged.paymentSecondReminderDays,
    firstReminderDays,
  });
  for (const [field, message] of Object.entries(problems))
    if (PAYMENT_RULE_TRIGGERS[field]?.some((key) => changed.includes(key))) return message;
  return null;
}
/** Policies keys whose change makes the cross-field rules run (and the stale dependents be cleared). */
const POLICY_KEYS = [
  'checkInUntil',
  'checkOutFrom',
  'cotsPolicy',
  'cotsFee',
  'cotsMax',
  'extraBedsPolicy',
  'extraBedsFee',
  'extraBedsMax',
  'petsPolicy',
  'petsFeeType',
  'petsFee',
  'petsMax',
  'idAtArrival',
  'idDocuments',
  'damageDepositAmount',
  'damageDepositMethod',
  'damageDepositRefundDays',
];
/**
 * The values that stop applying once a policy changes (a price on a cot that is now free, the documents when no ID is
 * asked for). Returned for the caller to save with the change, so nothing stale is shown to guests later.
 */
export function policyCleanup(merged: HotelSettings, changed: readonly string[]): HotelSettings {
  if (!POLICY_KEYS.some((key) => changed.includes(key))) return {};
  const stale = staleDependents(merged as PolicyValues);
  return Object.fromEntries(
    Object.entries(stale).filter(([key]) => !changed.includes(key)),
  ) as HotelSettings;
}
export function hotelUpdates(input: HotelSettings) {
  return Prisma.join(
    hotelFields
      .filter((f) => Object.hasOwn(input, f.key))
      .map(
        (f) =>
          Prisma.sql`${Prisma.raw(f.column)}=${f.kind === 'weekdays' ? Prisma.sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input[f.key])}::jsonb)::smallint)` : f.kind === 'pmoney' ? Prisma.sql`${input[f.key]}::numeric` : f.kind === 'pmulti' ? Prisma.sql`ARRAY(SELECT item FROM jsonb_array_elements_text(${JSON.stringify(input[f.key])}::jsonb) WITH ORDINALITY AS t(item, position) ORDER BY position)` : f.kind === 'languages' ? Prisma.sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input[f.key])}::jsonb))` : f.kind === 'profiles' ? Prisma.sql`${JSON.stringify(input[f.key])}::jsonb` : input[f.key]}`,
      ),
  );
}
