/**
 * Currencies in official use today (ISO 4217). Old ones such as the Albanian "ALK", the Bulgarian lev (the euro
 * replaced it in 2026), funds, metals and test codes are left out of the pickers. The server still accepts any
 * real ISO code, so a hotel that saved an older one keeps it.
 */
const CURRENT =
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG'.split(
    ' ',
  );
const known = (() => {
  try {
    return new Set(Intl.supportedValuesOf('currency'));
  } catch {
    return null;
  }
})();

/** The currency codes to offer, in code order; a code this browser does not know is left out. */
export const currentCurrencyCodes: string[] = CURRENT.filter((code) => !known || known.has(code));

/** ISO 4217 choices shared by hotel and restaurant setup. */
export const currencyOptions = currentCurrencyCodes.map((code) => ({
  value: code,
  label: `${code} - ${new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code}`,
}));
