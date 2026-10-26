/** A two-night stay starting `daysAhead` days from today (UTC), so sandbox tests never use a past date. */
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};
const start = shift(60);
export const STAY_STARTS_ON = iso(start);
export const STAY_ENDS_ON = iso(shift(62));
export const STAY_MONTH = STAY_STARTS_ON.slice(0, 7);
export const monthDays = () => {
  const [year, month] = STAY_MONTH.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
