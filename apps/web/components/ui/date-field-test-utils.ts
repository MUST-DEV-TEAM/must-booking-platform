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

/**
 * Waits (inside `act`) until `find` returns something. A slow CI machine opens the popover and renders the
 * days later than a fast one, so looking once right after a click failed there ("The requested date field
 * did not open its calendar") while it passed on a fast machine.
 */
async function waitFor<T>(find: () => T | null | undefined, message: string): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() >= deadline) throw new Error(message);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

/** Chooses a date (`YYYY-MM-DD`) in a DateField the way a person does: open it, go to the month, press the day, Apply. */
export async function pickDate(trigger: HTMLElement | null, iso: string) {
  if (!trigger) throw new Error('The date field was not found.');
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  await act(async () => trigger.click());
  // Radix can retain a closed calendar while its exit animation finishes. Follow this
  // trigger's controlled popover instead of accidentally navigating that older calendar.
  const calendar = await waitFor(() => {
    const contentId = trigger.getAttribute('aria-controls');
    const element = contentId ? document.getElementById(contentId) : null;
    return element && element.getAttribute('data-state') === 'open' ? element : null;
  }, 'The requested date field did not open its calendar.');
  const shown = () => {
    const title = calendar.querySelector('h4')?.textContent ?? '';
    const [name, y] = title.split(' ');
    return { month: MONTHS.indexOf(name ?? '') + 1, year: Number(y) };
  };
  for (let i = 0; i < 400; i++) {
    const current = shown();
    const diff = (year - current.year) * 12 + (month - current.month);
    if (diff === 0 || current.month === 0) break;
    const button = calendar.querySelector<HTMLElement>(
      `button[aria-label="${diff > 0 ? 'Next month' : 'Previous month'}"]`,
    );
    if (!button) break;
    await act(async () => button.click());
  }
  const label = `Choose ${day} ${MONTHS[month - 1]} ${year}`;
  const cell = await waitFor(
    () => calendar.querySelector<HTMLElement>(`button[aria-label="${label}"]`),
    `The calendar does not show ${label}.`,
  );
  await act(async () => cell.click());
  const apply = await waitFor(
    () =>
      [...calendar.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Apply'),
    'The calendar has no Apply button.',
  );
  await act(async () => apply.click());
}
