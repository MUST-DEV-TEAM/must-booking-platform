'use client';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ALBANIA_REGIONS,
  BOOKING_LIMIT_RANGES,
  checkBookingLimit,
  checkBookingWindow,
  checkSeason,
  checkWeekdays,
  type BookingLimitKey,
  COMMON_LANGUAGE_CODES,
  COUNTRY_CODES,
  HOTEL_LANGUAGES,
  DESCRIPTION_MAX,
  PROFILE_FIELD_KEYS,
  PROPERTY_TYPES,
  ID_DOCUMENT_CHOICES,
  checkMoneyAmount,
  checkPolicies,
  type PolicyValues,
  SUMMARY_MAX,
  checkProfileCombination,
  checkProfileField,
  normaliseProfileValue,
  type ProfileFieldKey,
} from '@must/domain-contracts';
import {
  SettingsFields,
  type SettingValue,
  type SettingGroup,
  whenHolds,
} from '../../components/ui/settings-fields';
import { ruleOwnerLabel, ruleStatusLabel } from './booking-rules-owners';
import { timeZoneOptions, type Property } from './settings-areas';
/** "Albanian · Shqip": the English name and the language's own name, or just the name when they match. */
export function languageLabel(code: string) {
  const known = HOTEL_LANGUAGES.find((language) => language.code === code);
  if (known)
    return known.native.toLowerCase() === known.name.toLowerCase()
      ? known.name
      : `${known.name} · ${known.native}`;
  // A code saved long ago that is no longer offered: the browser's name for it.
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The common languages first, then the other modern ones by name. */
export function languageOptions() {
  const common = new Set<string>(COMMON_LANGUAGE_CODES);
  const rest = HOTEL_LANGUAGES.filter(({ code }) => !common.has(code))
    .map(({ code }) => ({ value: code, label: languageLabel(code) }))
    .sort((x, y) => x.label.localeCompare(y.label));
  return [
    ...COMMON_LANGUAGE_CODES.map((code) => ({
      value: code,
      label: languageLabel(code),
      group: 'Common',
    })),
    ...rest.map((item) => ({ ...item, group: 'All languages' })),
  ];
}
const options = (pairs: string[][]) => pairs.map(([value, label]) => ({ value, label }));
const arrival = options([
  ['not_offered', 'Not offered'],
  ['on_request', 'On request'],
  ['free_until', 'Free until a set time'],
]);
const policy = options([
  ['allowed', 'Allowed'],
  ['on_request', 'On request'],
  ['not_allowed', 'Not allowed'],
]);
const bedOptions = options([
  ['not_available', 'Not available'],
  ['free', 'Free'],
  ['paid', 'Paid'],
]);
const petFeeOptions = options([
  ['free', 'Free'],
  ['per_night', 'Per night'],
  ['per_stay', 'Per stay'],
]);
const smokingOptions = options([
  ['not_allowed', 'Not allowed'],
  ['designated_areas', 'Designated areas only'],
  ['allowed', 'Allowed'],
]);
const partiesOptions = options([
  ['not_allowed', 'Not allowed'],
  ['on_request', 'On request'],
  ['allowed', 'Allowed'],
]);
const idOptions = options([
  ['not_required', 'Not asked for'],
  ['main_guest', 'Main guest'],
  ['all_adults', 'All adults'],
]);
const depositMethodOptions = options([
  ['cash', 'Cash'],
  ['card', 'Card'],
]);
/** Saved and checked, but no guest page or email shows these yet (gap G-55). */
const NOT_SHOWN = 'Saved · not shown to guests yet';
export const hotelSettingGroups: Record<
  'general' | 'booking-rules' | 'check-in-out',
  SettingGroup[]
> = {
  general: [
    {
      title: 'Hotel identity',
      description: 'Shown to guests on the booking page, in emails and on your website.',
      fields: [
        {
          key: 'name',
          label: 'Hotel name',
          max: 120,
          required: true,
          span: 'half',
          counter: true,
          hint: 'Shown everywhere.',
        },
        {
          key: 'chainName',
          label: 'Chain or brand',
          max: 120,
          span: 'half',
          placeholder: 'Leave empty if independent',
          hint: 'Optional.',
        },
        {
          key: 'propertyType',
          label: 'Property type',
          kind: 'choice',
          options: PROPERTY_TYPES,
          required: true,
          span: 'half',
          hint: 'Used for booking page wording, website search data and channels.',
        },
        { key: 'starRating', label: 'Star rating', kind: 'stars', span: 'half' },
        {
          key: 'starRatingOfficial',
          label: 'Issued by the national tourism authority',
          kind: 'boolean',
          defaultValue: false,
          inlineWith: 'starRating',
        },
        {
          key: 'yearOpened',
          label: 'Year opened',
          kind: 'year',
          span: 'third',
          hint: 'Optional. 4 digits.',
        },
        {
          key: 'yearRenovated',
          label: 'Last renovated',
          kind: 'year',
          span: 'third',
          hint: 'Optional. Not before the year opened.',
        },
        {
          key: 'roomCount',
          label: 'Number of rooms',
          kind: 'static',
          span: 'third',
          suffix: 'from Accommodations',
          hint: 'Counted automatically, never typed.',
        },
        {
          key: 'summary',
          label: 'Short summary',
          max: SUMMARY_MAX,
          counter: true,
          hint: 'Shown in Google results and the website header.',
          span: 'full',
        },
        {
          key: 'description',
          label: 'Description',
          kind: 'textarea',
          max: DESCRIPTION_MAX,
          counter: true,
          hint: 'Plain text, 50 to 1000 characters, or leave empty.',
          span: 'full',
        },
      ],
    },
    {
      title: 'Location',
      description: 'Used for the "Find us" link, emails, your website and channels.',
      fields: [
        { key: 'address', label: 'Street address', max: 200, required: true, span: 'full' },
        {
          key: 'addressLine2',
          label: 'Address line 2',
          max: 200,
          span: 'full',
          placeholder: 'Building, floor (optional)',
        },
        { key: 'city', label: 'City', max: 100, required: true, span: 'third' },
        {
          key: 'region',
          label: 'Region (qark)',
          kind: 'region',
          max: 100,
          span: 'third',
          optionsByCountry: { AL: ALBANIA_REGIONS },
        },
        {
          key: 'postalCode',
          label: 'Postal code',
          max: 20,
          span: 'third',
          hint: 'Use the local postal code format.',
          hintByCountry: { AL: '4 digits.' },
        },
        {
          key: 'country',
          label: 'Country',
          kind: 'country',
          required: true,
          span: 'half',
          hint: 'Also sets the postal code format and suggests the time zone.',
        },
        {
          key: 'timezone',
          label: 'Time zone',
          kind: 'timezone',
          required: true,
          span: 'half',
          hint: 'Changing it shifts arrival times of existing bookings; you are asked to confirm.',
        },
        {
          key: 'mapPin',
          label: 'Map pin',
          kind: 'location',
          span: 'full',
          pin: {
            latKey: 'latitude',
            lngKey: 'longitude',
            addressKeys: ['address', 'city', 'postalCode', 'countryName'],
          },
        },
        { key: 'latitude', label: 'Latitude', kind: 'decimal', inlineWith: 'mapPin' },
        { key: 'longitude', label: 'Longitude', kind: 'decimal', inlineWith: 'mapPin' },
        {
          key: 'directions',
          label: 'Directions',
          max: 300,
          counter: true,
          span: 'third',
          hint: 'In the confirmation email.',
        },
        {
          key: 'nearestAirportCode',
          label: 'Nearest airport',
          max: 3,
          span: 'third',
          placeholder: 'TIA',
          hint: '3-letter code (Tirana: TIA).',
        },
        {
          key: 'nearestAirportKm',
          label: 'Distance to airport (km)',
          kind: 'decimal',
          span: 'third',
          hint: 'In km, 1 decimal.',
        },
      ],
    },
    {
      title: 'Legal and tax',
      description:
        'Printed in the footer of payment and refund emails. Clock still issues the fiscal invoices.',
      fields: [
        { key: 'legalName', label: 'Legal business name', max: 200, span: 'half' },
        {
          key: 'taxNumber',
          label: 'Tax number (NUIS)',
          max: 30,
          span: 'half',
          mono: true,
          placeholder: 'L12345678A',
          hint: '3 to 30 letters and digits.',
          hintByCountry: { AL: 'Letter, 8 digits, letter.' },
        },
        {
          key: 'tourismLicence',
          label: 'Tourism licence number',
          max: 50,
          span: 'half',
          placeholder: 'Optional',
          hint: 'Some countries require it on the website.',
        },
        {
          key: 'vatRegistered',
          label: 'VAT registered',
          kind: 'boolean',
          defaultValue: false,
          boxed: true,
          hint: 'Shown on receipts. Rates are set in Taxes and fees.',
        },
        {
          key: 'registeredSameAsHotel',
          label: 'Registered address is the same as the hotel address',
          kind: 'boolean',
          defaultValue: true,
          checkbox: true,
          span: 'full',
        },
        {
          key: 'registeredStreet',
          label: 'Registered street address',
          max: 200,
          whenOff: 'registeredSameAsHotel',
          required: true,
          span: 'full',
        },
        {
          key: 'registeredCity',
          label: 'Registered city',
          max: 100,
          whenOff: 'registeredSameAsHotel',
          required: true,
          span: 'half',
        },
        {
          key: 'registeredPostalCode',
          label: 'Registered postal code',
          max: 20,
          whenOff: 'registeredSameAsHotel',
          span: 'half',
        },
      ],
    },
    {
      title: 'Languages spoken at the hotel',
      description: 'Shown to guests on the booking page and your website.',
      fields: [
        {
          key: 'languages',
          label: 'Languages',
          kind: 'multi',
          defaultValue: [],
          hint: 'At least one. This does not translate booking pages or emails.',
          options: languageOptions(),
        },
      ],
    },
    {
      title: 'Currency',
      description: '',
      fields: [
        { key: 'defaultCurrency', label: 'Hotel currency', kind: 'currency', span: 'half' },
        { key: 'alsoShow', label: 'Also show prices in', kind: 'custom', span: 'half' },
        {
          key: 'exchangeRates',
          label: 'Exchange rates',
          kind: 'custom',
          span: 'full',
          hideLabel: true,
        },
      ],
    },
    {
      title: 'Formats',
      description: 'How dates, times and numbers look on staff screens and in reports.',
      fields: [
        {
          key: 'dateFormat',
          defaultValue: 'DD/MM/YYYY',
          label: 'Date format',
          kind: 'choice',
          options: options([
            ['DD/MM/YYYY', 'DD/MM/YYYY'],
            ['MM/DD/YYYY', 'MM/DD/YYYY'],
            ['YYYY-MM-DD', 'YYYY-MM-DD'],
          ]),
          hint: 'Shared by everyone working in this hotel.',
        },
        {
          key: 'timeFormat',
          label: 'Time format',
          kind: 'choice',
          defaultValue: '24h',
          options: options([
            ['24h', '24 hour (15:30)'],
            ['12h', '12 hour (3:30 PM)'],
          ]),
        },
        {
          key: 'weekStart',
          label: 'First day of the week',
          kind: 'choice',
          defaultValue: 'monday',
          options: options([
            ['monday', 'Monday'],
            ['sunday', 'Sunday'],
          ]),
          hint: 'Used by the Calendar.',
        },
        {
          key: 'numberFormat',
          label: 'Number format',
          kind: 'choice',
          defaultValue: 'comma_dot',
          options: options([
            ['comma_dot', '1,234.56'],
            ['dot_comma', '1.234,56'],
          ]),
        },
      ],
    },
  ],
  'booking-rules': [
    {
      title: 'Length of stay',
      description:
        'Applied to every booking, including staff bookings. Leave a limit empty for no limit.',
      fields: [
        {
          key: 'minStayNights',
          label: 'Minimum stay (nights)',
          kind: 'number',
          span: 'half',
          hint: '1 to 30 nights.',
        },
        {
          key: 'maxStayNights',
          label: 'Maximum stay (nights)',
          kind: 'number',
          span: 'half',
          hint: '1 to 365 nights, not below the minimum.',
        },
      ],
    },
    {
      title: 'Booking window and season',
      description:
        'How early guests must book, how far ahead they can, and the time of year you take bookings.',
      fields: [
        {
          key: 'minNoticeHours',
          label: 'Book at least (hours before check-in day)',
          kind: 'number',
          span: 'half',
          hint: '0 to 720 hours. 24 means the day before at the latest.',
        },
        {
          key: 'advanceBookingDays',
          label: 'Book up to (days ahead)',
          kind: 'number',
          span: 'half',
          hint: '1 to 730 days.',
        },
        {
          key: 'seasonOpenFrom',
          label: 'Open from',
          kind: 'monthday',
          span: 'half',
          hint: 'Leave both dates empty to be open all year.',
        },
        { key: 'seasonOpenTo', label: 'Open until', kind: 'monthday', span: 'half' },
      ],
    },
    {
      title: 'Same-day booking',
      description: 'Applied to guests and staff, using the hotel time zone.',
      fields: [
        {
          key: 'allowSameDayBooking',
          label: 'Allow same-day bookings',
          kind: 'boolean',
          defaultValue: true,
        },
        {
          key: 'sameDayCutoffTime',
          label: 'Same-day cutoff time',
          kind: 'time',
          span: 'half',
          hint: 'Optional. Same-day arrivals close at this local time.',
        },
      ],
    },
    {
      title: 'Arrival and departure days',
      description: 'Guests can only arrive and leave on the days switched on. At least one day.',
      fields: [
        {
          key: 'arrivalDays',
          label: 'Arrival days',
          kind: 'weekdays',
          defaultValue: ['1', '2', '3', '4', '5', '6', '7'],
        },
        {
          key: 'departureDays',
          label: 'Departure days',
          kind: 'weekdays',
          defaultValue: ['1', '2', '3', '4', '5', '6', '7'],
        },
      ],
    },
    {
      title: 'Group size',
      description:
        'Limits apply to a whole booking or multi-room order, including children. Leave empty for no extra limit.',
      fields: [
        {
          key: 'maxGuestsPerBooking',
          label: 'Maximum guests per booking',
          kind: 'number',
          span: 'half',
          hint: '1 to 50.',
        },
        {
          key: 'maxRoomsPerBooking',
          label: 'Maximum rooms per booking',
          kind: 'number',
          span: 'half',
          hint: '1 to 20.',
        },
      ],
    },
    {
      title: 'Group requests',
      description: 'What happens when a booking is bigger than the group size limits.',
      fields: [
        {
          key: 'groupRequestForm',
          label: 'Show a group request form',
          kind: 'boolean',
          defaultValue: false,
          hint: 'Guests who need more than these limits send a request instead.',
        },
        {
          key: 'groupRequestEmail',
          label: 'Send group requests to',
          max: 254,
          whenSet: 'groupRequestForm',
          placeholder: 'Leave empty to use the reservations email',
        },
      ],
    },
    {
      title: 'Guest ages',
      description:
        'Used to price and describe guests on the booking page. Leave a field empty for the usual value.',
      fields: [
        {
          key: 'minBookingAge',
          label: 'Minimum age to book',
          kind: 'number',
          span: 'third',
          placeholder: '18',
          hint: '16 to 25 years.',
        },
        {
          key: 'childrenUpToAge',
          connectedLock: 'locked',
          label: 'Children up to age',
          kind: 'number',
          span: 'third',
          placeholder: '12',
          hint: '1 to 17 years.',
        },
        {
          key: 'infantsUpToAge',
          connectedLock: 'locked',
          label: 'Infants up to age',
          kind: 'number',
          span: 'third',
          placeholder: '2',
          hint: '0 to 5 years, below the child limit.',
        },
        {
          key: 'askChildrenAges',
          connectedLock: 'locked',
          label: "Ask for the children's ages",
          kind: 'boolean',
          defaultValue: false,
          hint: 'Needed when a rate prices by age.',
        },
      ],
    },
    {
      title: 'Confirmation',
      description: 'How a new booking becomes confirmed.',
      fields: [
        {
          key: 'confirmationMode',
          connectedLock: 'locked',
          label: 'Confirm bookings',
          kind: 'cards',
          defaultValue: 'instant',
          options: [
            {
              value: 'instant',
              label: 'Instantly',
              description: 'The booking is confirmed as soon as the guest completes it.',
            },
            {
              value: 'on_request',
              label: 'On request',
              description:
                'Staff accept or decline. If nobody answers in time the booking is declined and the room is released. After acceptance the guest pays by payment link.',
            },
          ],
        },
        {
          key: 'onRequestHours',
          connectedLock: 'locked',
          label: 'Answer within (hours)',
          kind: 'number',
          span: 'half',
          placeholder: '24',
          hint: '1 to 48 hours. Empty means 24.',
          when: { key: 'confirmationMode', value: 'on_request' },
        },
      ],
    },
    {
      title: 'Booking form',
      description:
        'What guests are asked for. Email and the main guest name are always required. Marketing consent is never ticked in advance.',
      fields: [
        {
          key: 'formPhone',
          label: 'Phone number',
          kind: 'choice',
          span: 'half',
          defaultValue: 'required',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
        {
          key: 'formCountry',
          label: 'Country',
          kind: 'choice',
          span: 'half',
          defaultValue: 'required',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
        {
          key: 'formAddress',
          label: 'Address',
          kind: 'choice',
          span: 'half',
          defaultValue: 'hidden',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
        {
          key: 'formArrivalTime',
          label: 'Expected arrival time',
          kind: 'choice',
          span: 'half',
          defaultValue: 'hidden',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
        {
          key: 'formSpecialRequests',
          label: 'Special requests',
          kind: 'choice',
          span: 'half',
          defaultValue: 'optional',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
        {
          key: 'formGuestNamePerRoom',
          label: 'Guest name for each room',
          kind: 'choice',
          span: 'half',
          defaultValue: 'hidden',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
        {
          key: 'formCompany',
          label: 'Company name and tax number',
          kind: 'choice',
          span: 'half',
          defaultValue: 'hidden',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
        {
          key: 'formMarketing',
          label: 'Marketing consent',
          kind: 'choice',
          span: 'half',
          defaultValue: 'optional',
          options: options([
            ['required', 'Required'],
            ['optional', 'Optional'],
            ['hidden', 'Hidden'],
          ]),
        },
      ],
    },
    {
      title: 'Advanced',
      description: 'For hotels that want to sell every night.',
      fields: [
        {
          key: 'fillGapNights',
          connectedLock: 'hidden',
          label: 'Fill gap nights',
          kind: 'boolean',
          defaultValue: false,
          hint: 'Allow a shorter stay when it exactly fills a gap between two bookings.',
        },
      ],
    },
    {
      title: 'No-show guidance',
      description: 'Staff guidance only. Saving this policy never charges a guest.',
      fields: [
        {
          key: 'noShowRule',
          label: 'If a guest does not arrive',
          kind: 'choice',
          span: 'half',
          defaultValue: 'flag_for_review',
          options: options([
            ['charge_first_night', 'Charge first night'],
            ['charge_nothing', 'Charge nothing'],
            ['flag_for_review', 'Flag for review'],
          ]),
        },
      ],
    },
  ],
  'check-in-out': [
    {
      title: 'Check-in and check-out windows',
      description:
        'The standard times are above. Leave "until" or "from" empty when guests can arrive or leave at any time.',
      status: NOT_SHOWN,
      fields: [
        { key: 'checkInUntil', label: 'Check-in until', kind: 'time', span: 'half' },
        { key: 'checkOutFrom', label: 'Check-out from', kind: 'time', span: 'half' },
        {
          key: 'lateArrivalInstructions',
          label: 'Late arrival instructions',
          kind: 'textarea',
          max: 500,
          counter: true,
          span: 'full',
          hint: 'For example how to collect the key after the reception closes.',
        },
      ],
    },
    {
      title: 'Early check-in',
      description: 'Informational. Staff must agree any special arrangement with the guest.',
      status: NOT_SHOWN,
      fields: [
        {
          key: 'earlyCheckInPolicy',
          label: 'Early check-in',
          kind: 'choice',
          span: 'half',
          defaultValue: 'not_offered',
          options: arrival,
        },
        {
          key: 'earlyCheckInUntil',
          label: 'Free early check-in until',
          kind: 'time',
          span: 'half',
          when: { key: 'earlyCheckInPolicy', value: 'free_until' },
        },
        {
          key: 'earlyCheckInNote',
          label: 'Note for guests',
          max: 300,
          span: 'full',
          hint: 'Up to 300 characters.',
        },
      ],
    },
    {
      title: 'Late check-out',
      description: 'Informational. Staff must agree any special arrangement with the guest.',
      status: NOT_SHOWN,
      fields: [
        {
          key: 'lateCheckOutPolicy',
          label: 'Late check-out',
          kind: 'choice',
          span: 'half',
          defaultValue: 'not_offered',
          options: arrival,
        },
        {
          key: 'lateCheckOutUntil',
          label: 'Free late check-out until',
          kind: 'time',
          span: 'half',
          when: { key: 'lateCheckOutPolicy', value: 'free_until' },
        },
        {
          key: 'lateCheckOutNote',
          label: 'Note for guests',
          max: 300,
          span: 'full',
          hint: 'Up to 300 characters.',
        },
      ],
    },
    {
      title: 'Cots and extra beds',
      description: 'Per room. Prices are per night, in the hotel currency.',
      status: NOT_SHOWN,
      fields: [
        {
          key: 'cotsPolicy',
          label: 'Cots',
          kind: 'choice',
          span: 'half',
          defaultValue: 'not_available',
          options: bedOptions,
        },
        {
          key: 'cotsFee',
          label: 'Cot price per night',
          kind: 'decimal',
          span: 'half',
          when: { key: 'cotsPolicy', value: 'paid' },
          placeholder: '0.00',
        },
        {
          key: 'cotsMax',
          label: 'Cots per room',
          kind: 'number',
          span: 'half',
          when: { key: 'cotsPolicy', value: ['free', 'paid'] },
          hint: 'From 1 to 3.',
        },
        {
          key: 'extraBedsPolicy',
          label: 'Extra beds',
          kind: 'choice',
          span: 'half',
          defaultValue: 'not_available',
          options: bedOptions,
        },
        {
          key: 'extraBedsFee',
          label: 'Extra bed price per night',
          kind: 'decimal',
          span: 'half',
          when: { key: 'extraBedsPolicy', value: 'paid' },
          placeholder: '0.00',
        },
        {
          key: 'extraBedsMax',
          label: 'Extra beds per room',
          kind: 'number',
          span: 'half',
          when: { key: 'extraBedsPolicy', value: ['free', 'paid'] },
          hint: 'From 1 to 3.',
        },
      ],
    },
    {
      title: 'Children',
      description:
        'Optional information for guests. The ages that count as children and infants are set in Booking rules.',
      status: NOT_SHOWN,
      fields: [
        {
          key: 'childrenPolicy',
          label: 'Children',
          kind: 'choice',
          span: 'half',
          options: policy,
        },
        {
          key: 'childrenPolicyNote',
          label: 'Note for guests',
          max: 300,
          span: 'full',
          hint: 'Up to 300 characters.',
        },
      ],
    },
    {
      title: 'Pets',
      description: 'Assistance animals are always welcome, whatever you choose here.',
      status: NOT_SHOWN,
      fields: [
        {
          key: 'petsPolicy',
          label: 'Pets',
          kind: 'choice',
          span: 'half',
          options: policy,
        },
        {
          key: 'petsMax',
          label: 'Pets per room',
          kind: 'number',
          span: 'half',
          when: { key: 'petsPolicy', value: ['allowed', 'on_request'] },
          hint: 'From 1 to 5, or leave empty.',
        },
        {
          key: 'petsFeeType',
          label: 'Pet fee',
          kind: 'choice',
          span: 'half',
          when: { key: 'petsPolicy', value: ['allowed', 'on_request'] },
          options: petFeeOptions,
        },
        {
          key: 'petsFee',
          label: 'Pet fee amount',
          kind: 'decimal',
          span: 'half',
          when: [
            { key: 'petsPolicy', value: ['allowed', 'on_request'] },
            { key: 'petsFeeType', value: ['per_night', 'per_stay'] },
          ],
          placeholder: '0.00',
        },
        {
          key: 'petsPolicyNote',
          label: 'Note for guests',
          max: 300,
          span: 'full',
          hint: 'Up to 300 characters.',
        },
      ],
    },
    {
      title: 'House rules',
      description: 'Times are local to the hotel. Quiet hours can continue overnight.',
      status: NOT_SHOWN,
      fields: [
        {
          key: 'smokingPolicy',
          label: 'Smoking',
          kind: 'choice',
          span: 'half',
          options: smokingOptions,
        },
        {
          key: 'partiesPolicy',
          label: 'Parties and events',
          kind: 'choice',
          span: 'half',
          options: partiesOptions,
        },
        { key: 'quietHoursFrom', label: 'Quiet hours from', kind: 'time', span: 'half' },
        { key: 'quietHoursTo', label: 'Quiet hours until', kind: 'time', span: 'half' },
        {
          key: 'idAtArrival',
          label: 'ID at arrival',
          kind: 'choice',
          span: 'half',
          defaultValue: 'not_required',
          options: idOptions,
        },
        {
          key: 'idDocuments',
          label: 'Accepted documents',
          kind: 'multi',
          span: 'half',
          when: { key: 'idAtArrival', value: ['main_guest', 'all_adults'] },
          options: ID_DOCUMENT_CHOICES.map(({ value, label }) => ({ value, label })),
        },
        {
          key: 'otherHouseRules',
          label: 'Other house rules',
          kind: 'textarea',
          max: 1000,
          counter: true,
          span: 'full',
          hint: 'Plain text, up to 1000 characters.',
        },
      ],
    },
    {
      title: 'Damage deposit',
      description:
        'Leave the amount empty when you do not take a deposit. It is taken at the hotel; MUST does not charge it.',
      status: NOT_SHOWN,
      fields: [
        {
          key: 'damageDepositAmount',
          label: 'Deposit amount',
          kind: 'decimal',
          span: 'third',
          placeholder: '0.00',
          hint: 'In the hotel currency.',
        },
        {
          key: 'damageDepositMethod',
          label: 'Taken by',
          kind: 'choice',
          span: 'third',
          whenSet: 'damageDepositAmount',
          options: depositMethodOptions,
        },
        {
          key: 'damageDepositRefundDays',
          label: 'Refunded within (days)',
          kind: 'number',
          span: 'third',
          whenSet: 'damageDepositAmount',
          hint: 'From 1 to 30.',
        },
      ],
    },
    {
      title: 'Terms and conditions',
      description:
        'Guests are linked to these in booking emails and on the booking page. Each time you change a link it becomes a new numbered version, and a booking keeps the versions the guest accepted.',
      fields: [
        {
          key: 'termsUrl',
          label: 'Terms and conditions link',
          max: 500,
          span: 'full',
          placeholder: 'https://',
          hint: 'A full https:// address.',
        },
        {
          key: 'privacyUrl',
          label: 'Privacy policy link',
          max: 500,
          span: 'full',
          placeholder: 'https://',
          hint: 'A full https:// address.',
        },
        {
          key: 'requireTermsAcceptance',
          label: 'Guests must accept these to book',
          kind: 'boolean',
          defaultValue: false,
          span: 'full',
          hint: 'Your booking page must show the tick box and send the answer, otherwise guests cannot book. Leave off until it does.',
        },
      ],
    },
  ],
};
export function useHotelSettings(
  property: Property,
  area: keyof typeof hotelSettingGroups,
  canWrite: boolean,
  extras?: Record<string, ReactNode>,
  /** Values kept outside the form that its rules need (the standard check-in and check-out times). */
  context?: PolicyValues,
) {
  const savedLanguages = Array.isArray(property.languages) ? property.languages : [];
  const connected = property.pmsSource === 'CLOCK_PMS';
  const groups = hotelSettingGroups[area]
    .map((group) => ({
      ...group,
      fields: group.fields.filter((f) => !(connected && f.connectedLock === 'hidden')),
    }))
    .filter((group) => group.fields.length > 0)
    .map((group) => ({
      ...group,
      badge: area === 'booking-rules' ? ruleOwnerLabel(group.title, connected) : undefined,
      status: area === 'booking-rules' ? ruleStatusLabel(group.title) : group.status,
      fields: group.fields
        .map((f) => (connected && f.connectedLock === 'locked' ? { ...f, readOnly: true } : f))
        .map((f) =>
          f.kind === 'multi' && f.key === 'languages'
            ? {
                ...f,
                options: [
                  ...(f.options ?? []),
                  ...savedLanguages
                    .filter((code) => !f.options?.some((o) => o.value === code))
                    .map((code) => ({ value: code, label: languageLabel(code), group: 'Saved' })),
                ],
              }
            : f,
        ),
    }));
  const fields = groups.flatMap((g) => g.fields),
    saveable = fields.filter(
      (f) => f.kind !== 'static' && f.kind !== 'location' && f.kind !== 'custom',
    );
  const initial = () =>
    Object.fromEntries(
      fields.map((f) => {
        const v = (property as unknown as Record<string, unknown>)[f.key];
        return [
          f.key,
          Array.isArray(v)
            ? v.map(String)
            : typeof v === 'boolean'
              ? v
              : v === null || v === undefined
                ? (f.defaultValue ?? '')
                : String(v),
        ];
      }),
    ) as Record<string, SettingValue>;
  const [values, setValues] = useState(initial);
  const countryName = (code: unknown) => {
    try {
      return code ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code)) ?? '') : '';
    } catch {
      return '';
    }
  };
  const saved = initial(),
    savedText = JSON.stringify(saved);
  useEffect(() => setValues(JSON.parse(savedText)), [savedText]);
  const dirty = JSON.stringify(values) !== savedText,
    errors: Record<string, string> = {};
  for (const f of saveable) {
    const v = values[f.key];
    // A hidden field (its switch or choice says it does not apply) is never required.
    const shown =
      whenHolds(f.when, values) &&
      (!f.whenSet || Boolean(values[f.whenSet])) &&
      (!f.whenOff || values[f.whenOff] === false);
    if (f.required && shown && typeof v === 'string' && !v.trim()) {
      errors[f.key] = `Enter the ${f.label.toLowerCase()}.`;
      continue;
    }
    if (typeof v === 'string') {
      if (f.key === 'termsUrl' && v.trim() && !/^https:\/\/[^\s]+$/i.test(v.trim()))
        errors[f.key] = 'Enter a full https:// address.';
      if (f.key === 'name' && /[<>\\\r\n]/.test(v))
        errors[f.key] = 'Use a single line without < > or \\.';
      if (f.max && v.length > f.max) errors[f.key] = `Keep this to ${f.max} characters or fewer.`;
      if (f.kind === 'number' && v && f.key in BOOKING_LIMIT_RANGES) {
        const message = checkBookingLimit(
          f.key as BookingLimitKey,
          /^\d+$/.test(v) ? Number(v) : NaN,
        );
        if (message) errors[f.key] = message;
      } else if (
        f.kind === 'number' &&
        v &&
        (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 2147483647)
      )
        errors[f.key] = 'Enter a positive whole number, or leave empty.';
      if (f.kind === 'time' && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
        errors[f.key] = 'Use a time such as 15:00.';
    }
  }
  const changed = (key: string) => JSON.stringify(values[key]) !== JSON.stringify(saved[key]);
  const yearNow = new Date().getFullYear();
  const typed = (key: string): unknown => {
    const v = values[key];
    if (key === 'yearOpened' || key === 'yearRenovated') return v === '' ? null : Number(v);
    if (key === 'latitude' || key === 'longitude' || key === 'nearestAirportKm')
      return typeof v === 'string' ? normaliseProfileValue(key, v) : v;
    return typeof v === 'string' ? normaliseProfileValue(key as ProfileFieldKey, v) : v;
  };
  for (const key of PROFILE_FIELD_KEYS) {
    if (!(key in values)) continue;
    if (!changed(key) && !(key === 'taxNumber' && changed('country'))) continue;
    const message = checkProfileField(key, typed(key), {
      country: String(values.country || '') || null,
      year: yearNow,
    });
    if (message) errors[key] = message;
  }
  if (
    [
      'yearOpened',
      'yearRenovated',
      'starRating',
      'starRatingOfficial',
      'registeredSameAsHotel',
      'registeredStreet',
      'registeredCity',
    ].some(changed)
  )
    Object.assign(
      errors,
      checkProfileCombination({
        yearOpened: typed('yearOpened') as number | null,
        yearRenovated: typed('yearRenovated') as number | null,
        starRating: values.starRating ? Number(values.starRating) : null,
        starRatingOfficial: Boolean(values.starRating) && values.starRatingOfficial === true,
        ...('registeredSameAsHotel' in values
          ? {
              registeredSameAsHotel: values.registeredSameAsHotel !== false,
              registeredStreet: String(values.registeredStreet ?? '').trim() || null,
              registeredCity: String(values.registeredCity ?? '').trim() || null,
            }
          : {}),
      }),
    );
  for (const key of ['arrivalDays', 'departureDays'])
    if (key in values && changed(key) && checkWeekdays((values[key] as string[]).map(Number)))
      errors[key] = 'Choose at least one day.';
  if ((changed('minStayNights') || changed('maxStayNights')) && 'minStayNights' in values) {
    const stay = (key: string) => (/^\d+$/.test(String(values[key])) ? Number(values[key]) : null);
    const problem = checkBookingWindow({
      minStayNights: stay('minStayNights'),
      maxStayNights: stay('maxStayNights'),
    }).maxStayNights;
    if (problem) errors.maxStayNights = problem;
  }
  if ((changed('childrenUpToAge') || changed('infantsUpToAge')) && 'infantsUpToAge' in values) {
    const age = (key: string) => (/^\d+$/.test(String(values[key])) ? Number(values[key]) : null);
    const problem = checkBookingWindow({
      childrenUpToAge: age('childrenUpToAge'),
      infantsUpToAge: age('infantsUpToAge'),
    }).infantsUpToAge;
    if (problem) errors.infantsUpToAge = problem;
  }
  if (
    changed('groupRequestEmail') &&
    String(values.groupRequestEmail ?? '').trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.groupRequestEmail).trim())
  )
    errors.groupRequestEmail = 'Enter a valid email address.';
  if ((changed('seasonOpenFrom') || changed('seasonOpenTo')) && 'seasonOpenFrom' in values) {
    const season = checkSeason(
      String(values.seasonOpenFrom) || null,
      String(values.seasonOpenTo) || null,
    );
    if (season) errors.seasonOpenTo = season;
  }
  if (
    'timezone' in values &&
    changed('timezone') &&
    !timeZoneOptions(String(saved.timezone ?? '')).includes(String(values.timezone))
  )
    errors.timezone = 'Choose a time zone from the list.';
  if (changed('languages') && Array.isArray(values.languages) && values.languages.length === 0)
    errors.languages = 'Choose at least one language.';
  if (values.country && !(COUNTRY_CODES as readonly string[]).includes(String(values.country)))
    errors.country = 'Choose a country from the list.';
  for (const prefix of ['earlyCheckIn', 'lateCheckOut'])
    if (values[prefix + 'Policy'] === 'free_until' && !values[prefix + 'Until'])
      errors[prefix + 'Until'] = 'Enter the free-until time.';
  if (Boolean(values.quietHoursFrom) !== Boolean(values.quietHoursTo))
    errors.quietHoursTo = 'Enter both quiet-hours times, or leave both empty.';
  if ('cotsPolicy' in values) {
    const visible = (key: string) => {
      const f = fields.find((x) => x.key === key);
      return !!f && whenHolds(f.when, values) && (!f.whenSet || Boolean(values[f.whenSet]));
    };
    const whole = (key: string) =>
      /^\d+$/.test(String(values[key] ?? '')) ? Number(values[key]) : null;
    const text = (key: string) => String(values[key] ?? '').trim() || null;
    for (const key of ['cotsFee', 'extraBedsFee', 'petsFee', 'damageDepositAmount'])
      if (visible(key) && text(key)) {
        const message = checkMoneyAmount(text(key));
        if (message) errors[key] = message;
      }
    const problems = checkPolicies({
      ...context,
      checkInUntil: text('checkInUntil'),
      checkOutFrom: text('checkOutFrom'),
      cotsPolicy: text('cotsPolicy'),
      cotsFee: text('cotsFee'),
      cotsMax: whole('cotsMax'),
      extraBedsPolicy: text('extraBedsPolicy'),
      extraBedsFee: text('extraBedsFee'),
      extraBedsMax: whole('extraBedsMax'),
      petsPolicy: text('petsPolicy'),
      petsFeeType: text('petsFeeType'),
      petsFee: text('petsFee'),
      idAtArrival: text('idAtArrival'),
      idDocuments: Array.isArray(values.idDocuments) ? values.idDocuments : [],
      damageDepositAmount: text('damageDepositAmount'),
      damageDepositMethod: text('damageDepositMethod'),
      damageDepositRefundDays: whole('damageDepositRefundDays'),
    } satisfies PolicyValues);
    for (const [key, message] of Object.entries(problems))
      if (!errors[key] && (key === 'checkInUntil' || key === 'checkOutFrom' || visible(key)))
        errors[key] = message;
  }
  const update: Partial<Property> = {};
  for (const f of saveable)
    if (JSON.stringify(values[f.key]) !== JSON.stringify(saved[f.key])) {
      const v = values[f.key];
      (update as Record<string, unknown>)[f.key] =
        f.kind === 'weekdays'
          ? (v as string[]).map(Number).sort()
          : f.kind === 'number' || f.kind === 'year' || f.key === 'starRating'
            ? v === ''
              ? null
              : Number(v)
            : typeof v === 'string'
              ? (PROFILE_FIELD_KEYS as readonly string[]).includes(f.key)
                ? (normaliseProfileValue(f.key as ProfileFieldKey, v) as string | null)
                : v.trim() || null
              : v;
    }
  if (update.starRating === null && saved.starRatingOfficial === true)
    update.starRatingOfficial = false;
  return {
    dirty,
    errors,
    update,
    values,
    discard: () => setValues(initial()),
    /** The same form, restricted to the groups with these titles (so a page can interleave its own sections). */
    section: (...titles: string[]) => (
      <SettingsFields
        groups={groups
          .filter((group) => titles.includes(group.title))
          .map((group) => ({ ...group, compact: true }))}
        values={{ ...values, countryName: countryName(values.country) }}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        errors={errors}
        disabled={!canWrite}
        currencyLocked={property.defaultCurrencyLocked}
        currencyBadge={property.pmsSource === 'CLOCK_PMS' ? 'From Clock · Locked' : 'Locked'}
        extras={extras}
      />
    ),
    fields: (
      <SettingsFields
        groups={groups.map((group) => ({ ...group, compact: true }))}
        values={{ ...values, countryName: countryName(values.country) }}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        errors={errors}
        disabled={!canWrite}
        currencyLocked={property.defaultCurrencyLocked}
        currencyBadge={property.pmsSource === 'CLOCK_PMS' ? 'From Clock · Locked' : 'Locked'}
        extras={extras}
      />
    ),
  };
}
