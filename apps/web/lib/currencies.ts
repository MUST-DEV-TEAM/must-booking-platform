/** ISO 4217 choices shared by hotel and restaurant setup. */
export const currencyOptions = Intl.supportedValuesOf('currency').map((code) => ({
  value: code,
  label: `${code} - ${new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code}`,
}));
