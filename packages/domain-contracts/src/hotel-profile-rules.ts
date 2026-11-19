import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * The rules for the hotel Profile fields, written once. The Settings form shows these messages as
 * the owner types and the API refuses the same values, so the two can never disagree
 * (settings redesign plan, S0d and S2a).
 */
export const PROPERTY_TYPES = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'resort', label: 'Resort' },
  { value: 'boutique_hotel', label: 'Boutique hotel' },
  { value: 'apartment_hotel', label: 'Apartment hotel' },
  { value: 'apartments', label: 'Apartments' },
  { value: 'guesthouse', label: 'Guesthouse or B&B' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'villa', label: 'Villa' },
  { value: 'motel', label: 'Motel' },
  { value: 'campsite', label: 'Campsite or glamping' },
] as const;

export type ProfileFieldKey =
  | 'chainName'
  | 'propertyType'
  | 'starRatingOfficial'
  | 'yearOpened'
  | 'yearRenovated'
  | 'summary'
  | 'description'
  | 'legalName'
  | 'taxNumber'
  | 'tourismLicence'
  | 'vatRegistered'
  | 'addressLine2'
  | 'city'
  | 'region'
  | 'postalCode'
  | 'latitude'
  | 'longitude'
  | 'directions'
  | 'nearestAirportCode'
  | 'nearestAirportKm'
  | 'phone'
  | 'whatsappNumber'
  | 'afterHoursPhone'
  | 'whatsappSameAsPhone'
  | 'receptionOpen24h'
  | 'receptionFrom'
  | 'receptionTo'
  | 'website'
  | 'reservationsEmail'
  | 'supportEmail'
  | 'accentColour'
  | 'registeredSameAsHotel'
  | 'registeredStreet'
  | 'registeredCity'
  | 'registeredPostalCode';

export const PROFILE_FIELD_KEYS: readonly ProfileFieldKey[] = [
  'chainName',
  'propertyType',
  'starRatingOfficial',
  'yearOpened',
  'yearRenovated',
  'summary',
  'description',
  'legalName',
  'taxNumber',
  'tourismLicence',
  'vatRegistered',
  'addressLine2',
  'city',
  'region',
  'postalCode',
  'latitude',
  'longitude',
  'directions',
  'nearestAirportCode',
  'nearestAirportKm',
  'phone',
  'whatsappNumber',
  'afterHoursPhone',
  'whatsappSameAsPhone',
  'receptionOpen24h',
  'receptionFrom',
  'receptionTo',
  'website',
  'reservationsEmail',
  'supportEmail',
  'accentColour',
  'registeredSameAsHotel',
  'registeredStreet',
  'registeredCity',
  'registeredPostalCode',
];

/** ISO 639-1 language codes a hotel can say it speaks (G-59). */
export const LANGUAGE_CODES: readonly string[] = [
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bh',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'no',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh',
  'zu',
];

/**
 * The languages a hotel can pick from the list: those the Unicode CLDR project rates "modern" (fully
 * supported), as ISO 639-1 codes with the English name and the language's own name, written here so every
 * browser shows the same. The older, rarely spoken codes stay valid on the server so a hotel that saved one
 * keeps it; they are just not offered any more.
 */
export const HOTEL_LANGUAGES: ReadonlyArray<{ code: string; name: string; native: string }> = [
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া' },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycanca' },
  { code: 'be', name: 'Belarusian', native: 'Беларуская' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'bn', name: 'Bangla', native: 'বাংলা' },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski' },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'cy', name: 'Welsh', native: 'Cymraeg' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'eu', name: 'Basque', native: 'Euskara' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'ga', name: 'Irish', native: 'Gaeilge' },
  { code: 'gl', name: 'Galician', native: 'Galego' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'is', name: 'Icelandic', native: 'Íslenska' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ka', name: 'Georgian', native: 'ქართული' },
  { code: 'kk', name: 'Kazakh', native: 'Қазақша' },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ky', name: 'Kyrgyz', native: 'Кыргызча' },
  { code: 'lo', name: 'Lao', native: 'ລາວ' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'mk', name: 'Macedonian', native: 'Македонски' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mn', name: 'Mongolian', native: 'Монгол' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'my', name: 'Burmese', native: 'မြန်မာ' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'ps', name: 'Pashto', native: 'پښتو' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'sq', name: 'Albanian', native: 'Shqip' },
  { code: 'sr', name: 'Serbian', native: 'Српски' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'tl', name: 'Filipino', native: 'Filipino' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbekcha' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'zu', name: 'Zulu', native: 'isiZulu' },
  { code: 'mt', name: 'Maltese', native: 'Malti' },
  { code: 'lb', name: 'Luxembourgish', native: 'Lëtzebuergesch' },
  { code: 'fo', name: 'Faroese', native: 'Føroyskt' },
  { code: 'gd', name: 'Scottish Gaelic', native: 'Gàidhlig' },
  { code: 'br', name: 'Breton', native: 'Brezhoneg' },
  { code: 'fy', name: 'Western Frisian', native: 'Frysk' },
  { code: 'ht', name: 'Haitian Creole', native: 'Kreyòl ayisyen' },
  { code: 'mg', name: 'Malagasy', native: 'Malagasy' },
  { code: 'mi', name: 'Māori', native: 'Māori' },
  { code: 'sm', name: 'Samoan', native: 'Gagana Samoa' },
  { code: 'sn', name: 'Shona', native: 'chiShona' },
  { code: 'so', name: 'Somali', native: 'Soomaali' },
  { code: 'xh', name: 'Xhosa', native: 'isiXhosa' },
  { code: 'yo', name: 'Yoruba', native: 'Yorùbá' },
  { code: 'ig', name: 'Igbo', native: 'Igbo' },
  { code: 'ha', name: 'Hausa', native: 'Hausa' },
  { code: 'rw', name: 'Kinyarwanda', native: 'Kinyarwanda' },
  { code: 'tg', name: 'Tajik', native: 'Тоҷикӣ' },
  { code: 'tk', name: 'Turkmen', native: 'Türkmen' },
  { code: 'tt', name: 'Tatar', native: 'Татар' },
  { code: 'ug', name: 'Uyghur', native: 'ئۇيغۇرچە' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي' },
  { code: 'ku', name: 'Kurdish', native: 'Kurdî' },
  { code: 'eo', name: 'Esperanto', native: 'Esperanto' },
  { code: 'bo', name: 'Tibetan', native: 'བོད་ཡིག' },
  { code: 'jv', name: 'Javanese', native: 'Basa Jawa' },
  { code: 'su', name: 'Sundanese', native: 'Basa Sunda' },
  { code: 'ti', name: 'Tigrinya', native: 'ትግርኛ' },
  { code: 'wo', name: 'Wolof', native: 'Wolof' },
  { code: 'qu', name: 'Quechua', native: 'Runasimi' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्' },
  { code: 'ln', name: 'Lingala', native: 'Lingála' },
  { code: 'oc', name: 'Occitan', native: 'Occitan' },
  { code: 'lg', name: 'Ganda', native: 'Luganda' },
  { code: 'ny', name: 'Chichewa', native: 'Chichewa' },
  { code: 'st', name: 'Southern Sotho', native: 'Sesotho' },
  { code: 'tn', name: 'Tswana', native: 'Setswana' },
];
export const HOTEL_LANGUAGE_CODES: readonly string[] = HOTEL_LANGUAGES.map(
  (language) => language.code,
);

/** The languages shown first, because most hotels here speak them. */
export const COMMON_LANGUAGE_CODES = [
  'sq',
  'en',
  'it',
  'de',
  'fr',
  'el',
  'es',
  'tr',
  'ru',
] as const;

export const TIME_FORMATS = ['24h', '12h'] as const;
export const WEEK_STARTS = ['monday', 'sunday'] as const;
export const NUMBER_FORMATS = ['comma_dot', 'dot_comma'] as const;

export const FIRST_YEAR = 1800;
export const SUMMARY_MAX = 160;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 1000;

const TEXT_MAX: Partial<Record<ProfileFieldKey, number>> = {
  chainName: 120,
  summary: SUMMARY_MAX,
  description: DESCRIPTION_MAX,
  legalName: 200,
  tourismLicence: 50,
  addressLine2: 200,
  city: 100,
  region: 100,
  postalCode: 20,
  directions: 300,
  website: 500,
  reservationsEmail: 254,
  supportEmail: 254,
  registeredStreet: 200,
  registeredCity: 100,
  registeredPostalCode: 20,
};

const PHONE_KEYS: readonly ProfileFieldKey[] = ['phone', 'whatsappNumber', 'afterHoursPhone'];
const isPhoneKey = (key: ProfileFieldKey) => PHONE_KEYS.includes(key);

/** A phone as it is stored: international form with no spaces (E.164), or the text unchanged when it is not a valid number. */
export function toE164(text: string): string {
  const parsed = parsePhoneNumberFromString(text);
  return parsed?.isValid() ? parsed.number : text;
}

/** Albania's 12 counties (qarqe), the choices for Region when the country is Albania. */
export const ALBANIA_REGIONS = [
  'Berat',
  'Dibër',
  'Durrës',
  'Elbasan',
  'Fier',
  'Gjirokastër',
  'Korçë',
  'Kukës',
  'Lezhë',
  'Shkodër',
  'Tiranë',
  'Vlorë',
] as const;

const decimals = (value: number) => Math.abs(Math.round(value * 1e6) / 1e6 - value) < 1e-9;

/** Trims text, makes a tax number upper case without spaces, and turns empty text into null. */
export function normaliseProfileValue(key: ProfileFieldKey, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  let value = raw.trim();
  if (key === 'taxNumber') value = value.replace(/\s+/g, '').toUpperCase();
  if (key === 'nearestAirportCode') value = value.toUpperCase();
  if (isPhoneKey(key) && value) value = toE164(value);
  if (key === 'website' || key === 'reservationsEmail' || key === 'supportEmail')
    value = value.replace(/\s+/g, '');
  if (key === 'accentColour') value = value.toLowerCase();
  if (key === 'latitude' || key === 'longitude' || key === 'nearestAirportKm')
    return value === '' ? null : Number(value.replace(',', '.'));
  return value === '' ? null : value;
}

/** The message for one field's value, or null when it is fine. `year` is the current year. */
export function checkProfileField(
  key: ProfileFieldKey,
  value: unknown,
  context: { country?: string | null; year: number },
): string | null {
  if (value === null || value === undefined) return null;
  if (
    key === 'starRatingOfficial' ||
    key === 'vatRegistered' ||
    key === 'whatsappSameAsPhone' ||
    key === 'receptionOpen24h' ||
    key === 'registeredSameAsHotel'
  )
    return typeof value === 'boolean' ? null : 'Choose yes or no.';
  if (key === 'yearOpened' || key === 'yearRenovated')
    return Number.isInteger(value) &&
      (value as number) >= FIRST_YEAR &&
      (value as number) <= context.year
      ? null
      : `Choose a year from ${FIRST_YEAR} to ${context.year}.`;
  if (key === 'latitude' || key === 'longitude') {
    const limit = key === 'latitude' ? 90 : 180;
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.abs(value) <= limit &&
      decimals(value)
      ? null
      : `Enter a number from -${limit} to ${limit} with up to 6 decimals.`;
  }
  if (key === 'nearestAirportKm')
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 500 &&
      Math.abs(Math.round(value * 10) / 10 - value) < 1e-9
      ? null
      : 'Enter a distance from 0 to 500 km with at most 1 decimal.';
  if (typeof value !== 'string') return 'Enter text.';
  const max = TEXT_MAX[key];
  if (max && value.length > max) return `Keep this to ${max} characters or fewer.`;
  if (/[\r\n]/.test(value) && key !== 'description') return 'Use a single line.';
  if (/[<>\\`]/.test(value)) return 'Remove the characters < > \\ and `.';
  if (key === 'propertyType')
    return PROPERTY_TYPES.some((type) => type.value === value)
      ? null
      : 'Choose a property type from the list.';
  if (key === 'description' && value.length < DESCRIPTION_MIN)
    return `Write at least ${DESCRIPTION_MIN} characters, or leave it empty.`;
  if (isPhoneKey(key)) {
    const parsed = parsePhoneNumberFromString(value);
    return value.startsWith('+') && parsed?.isValid() && parsed.number === value
      ? null
      : 'Enter a full phone number with the country code, such as +355 69 123 4567.';
  }
  if (key === 'receptionFrom' || key === 'receptionTo')
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : 'Use a time such as 08:00.';
  if (key === 'accentColour')
    return /^#[0-9a-f]{6}$/.test(value) ? null : 'Enter a colour such as #224858.';
  if (key === 'supportEmail' || key === 'reservationsEmail')
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? null
      : 'Enter an email address such as hello@hotel.com.';
  if (key === 'website') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.'))
        throw new Error();
    } catch {
      return 'Enter a full https website address, such as https://hotel.com.';
    }
    return null;
  }
  if (key === 'nearestAirportCode')
    return /^[A-Z]{3}$/.test(value) ? null : 'Use the 3-letter airport code, such as TIA.';
  if (key === 'region' && context.country === 'AL')
    return (ALBANIA_REGIONS as readonly string[]).includes(value)
      ? null
      : 'Choose one of the 12 Albanian counties.';
  if (key === 'postalCode' || key === 'registeredPostalCode')
    return context.country === 'AL'
      ? /^\d{4}$/.test(value)
        ? null
        : 'An Albanian postal code has 4 digits.'
      : /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/.test(value)
        ? null
        : 'Enter a valid postal code.';
  if (key === 'taxNumber') {
    if (context.country === 'AL')
      return /^[A-Z]\d{8}[A-Z]$/.test(value)
        ? null
        : 'An Albanian NUIS is a letter, 8 digits and a letter, such as L12345678A.';
    return /^[A-Z0-9]{3,30}$/.test(value)
      ? null
      : 'Use 3 to 30 letters and digits, with no symbols.';
  }
  return null;
}

/** Rules that look at more than one field; returns messages by field. */
export function checkProfileCombination(values: {
  yearOpened?: number | null;
  yearRenovated?: number | null;
  starRating?: number | null;
  starRatingOfficial?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  whatsappSameAsPhone?: boolean;
  whatsappNumber?: string | null;
  receptionOpen24h?: boolean;
  receptionFrom?: string | null;
  receptionTo?: string | null;
  registeredSameAsHotel?: boolean;
  registeredStreet?: string | null;
  registeredCity?: string | null;
}): Partial<Record<ProfileFieldKey, string>> {
  const out: Partial<Record<ProfileFieldKey, string>> = {};
  if (
    values.yearOpened != null &&
    values.yearRenovated != null &&
    values.yearRenovated < values.yearOpened
  )
    out.yearRenovated = 'The last renovation cannot be before the year opened.';
  if (values.starRatingOfficial && !values.starRating)
    out.starRatingOfficial = 'Set a star rating first, or switch this off.';
  if ((values.latitude == null) !== (values.longitude == null))
    out.longitude = 'Enter both latitude and longitude, or leave both empty.';
  if (values.whatsappSameAsPhone === false && !values.whatsappNumber)
    out.whatsappNumber = 'Enter the WhatsApp number, or choose "Same as phone".';
  if (values.receptionOpen24h === false) {
    if (!values.receptionFrom) out.receptionFrom = 'Enter the opening time.';
    else if (!values.receptionTo) out.receptionTo = 'Enter the closing time.';
    else if (values.receptionFrom === values.receptionTo)
      out.receptionTo = 'Closing time must differ from opening time, or choose "Open 24 hours".';
  }
  if (values.registeredSameAsHotel === false) {
    if (!values.registeredStreet) out.registeredStreet = 'Enter the registered street address.';
    if (!values.registeredCity) out.registeredCity = 'Enter the registered city.';
  }
  return out;
}

/** The hotel's pages on other sites. Each address must be https and belong to that site. */
export const ONLINE_PROFILE_SITES = [
  {
    key: 'google',
    label: 'Google Business Profile',
    domains: ['google.com', 'google.al', 'g.page', 'goo.gl'],
  },
  {
    key: 'tripadvisor',
    label: 'Tripadvisor',
    domains: [
      'tripadvisor.com',
      'tripadvisor.co.uk',
      'tripadvisor.it',
      'tripadvisor.de',
      'tripadvisor.fr',
      'tripadvisor.es',
    ],
  },
  { key: 'booking_com', label: 'Booking.com', domains: ['booking.com'] },
  { key: 'facebook', label: 'Facebook', domains: ['facebook.com', 'fb.com', 'fb.me'] },
  { key: 'instagram', label: 'Instagram', domains: ['instagram.com'] },
  { key: 'tiktok', label: 'TikTok', domains: ['tiktok.com'] },
  { key: 'youtube', label: 'YouTube', domains: ['youtube.com', 'youtu.be'] },
] as const;
export type OnlineProfileKey = (typeof ONLINE_PROFILE_SITES)[number]['key'];
export type OnlineProfiles = Partial<Record<OnlineProfileKey, string>>;

/** The message for one profile address, or null when it is fine (empty is fine). */
export function checkOnlineProfile(key: OnlineProfileKey, value: string): string | null {
  const site = ONLINE_PROFILE_SITES.find((item) => item.key === key);
  if (!site) return 'Unknown site.';
  if (!value) return null;
  if (value.length > 500) return 'Keep the address to 500 characters or fewer.';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    if (!site.domains.some((domain) => host === domain || host.endsWith('.' + domain)))
      return `This is not a ${site.label} address. Use a link on ${site.domains[0]}.`;
  } catch {
    return 'Enter a full https address.';
  }
  return null;
}

/** Cleans a whole set of profiles from a form; returns the messages by site instead of throwing. */
export function normaliseOnlineProfiles(raw: unknown): {
  value: OnlineProfiles;
  errors: Partial<Record<OnlineProfileKey, string>>;
} {
  const value: OnlineProfiles = {};
  const errors: Partial<Record<OnlineProfileKey, string>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { value, errors: { google: 'Send the profiles as an object.' } };
  for (const [key, entry] of Object.entries(raw)) {
    const site = ONLINE_PROFILE_SITES.find((item) => item.key === key);
    if (!site) {
      errors.google = `Unknown site: ${key}.`;
      continue;
    }
    if (entry === null || entry === undefined || entry === '') continue;
    const text = typeof entry === 'string' ? entry.trim() : '';
    const message = text ? checkOnlineProfile(site.key, text) : 'Enter a full https address.';
    if (message) errors[site.key] = message;
    else value[site.key] = text;
  }
  return { value, errors };
}

/** How readable white text is on a colour (WCAG contrast ratio), and a darker colour that passes. */
export function contrastWithWhite(hex: string): number {
  const channel = (index: number) => {
    const v = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return 1.05 / (luminance + 0.05);
}
export function darkerForWhiteText(hex: string): string {
  let colour = hex;
  for (let i = 0; i < 40 && contrastWithWhite(colour) < 4.5; i += 1) {
    const parts = [0, 1, 2].map((index) =>
      Math.max(0, Math.floor(parseInt(colour.slice(1 + index * 2, 3 + index * 2), 16) * 0.92)),
    );
    colour = '#' + parts.map((part) => part.toString(16).padStart(2, '0')).join('');
  }
  return colour;
}
