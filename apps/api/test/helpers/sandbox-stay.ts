// Real Clock sandbox tests must book future nights, and the self-service
// cancellation test needs an arrival inside the property's default 21-day
// window, so stays are fixed relative to today instead of to a calendar date.
const DAY_MS = 86_400_000;

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export const sandboxStay = { startsOn: isoDay(14), endsOn: isoDay(16) } as const;
export const sandboxSecondNight = isoDay(15);
export const sandboxMonth = sandboxStay.startsOn.slice(0, 7);

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
}
