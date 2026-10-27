import { act } from 'react';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Chooses a date (`YYYY-MM-DD`) in a DateField the way a person does: open it, go to the month, press the day, Apply. */
export async function pickDate(trigger: HTMLElement | null, iso: string) {
  if (!trigger) throw new Error('The date field was not found.');
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  await act(async () => trigger.click());
  const shown = () => {
    const title =
      document.querySelector('[role="dialog"] h4, [data-slot="popover-content"] h4')?.textContent ??
      '';
    const [name, y] = title.split(' ');
    return { month: MONTHS.indexOf(name ?? '') + 1, year: Number(y) };
  };
  for (let i = 0; i < 400; i++) {
    const current = shown();
    const diff = (year - current.year) * 12 + (month - current.month);
    if (diff === 0 || current.month === 0) break;
    const button = document.querySelector<HTMLElement>(
      `button[aria-label="${diff > 0 ? 'Next month' : 'Previous month'}"]`,
    );
    if (!button) break;
    await act(async () => button.click());
  }
  const label = `Choose ${day} ${MONTHS[month - 1]} ${year}`;
  const cell = document.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
  if (!cell) throw new Error(`The calendar does not show ${label}.`);
  await act(async () => cell.click());
  const apply = [...document.querySelectorAll<HTMLElement>('button')].find(
    (b) => b.textContent === 'Apply',
  );
  if (!apply) throw new Error('The calendar has no Apply button.');
  await act(async () => apply.click());
}
