// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { DateField } from './date-field';
import { pickDate } from './date-field-test-utils';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ max, min, initial = '' }: { max?: string; min?: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  return createElement(
    'div',
    null,
    createElement(DateField, {
      id: 'when',
      'aria-label': 'When',
      value,
      onChange: setValue,
      max,
      min,
    }),
    createElement('output', { id: 'out' }, value),
  );
}

async function mount(props: { max?: string; min?: string; initial?: string } = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const client = new QueryClient();
  await act(async () => {
    createRoot(host).render(
      createElement(QueryClientProvider, { client }, createElement(Harness, props)),
    );
  });
  return host;
}

describe('DateField', () => {
  it('chooses a date in the shared calendar and reports it as YYYY-MM-DD', async () => {
    await mount();
    await pickDate(document.getElementById('when'), '2027-07-12');
    expect(document.getElementById('out')!.textContent).toBe('2027-07-12');
    document.body.replaceChildren();
  });

  it('can be cleared with the calendar’s Clear button', async () => {
    await mount();
    await pickDate(document.getElementById('when'), '2026-03-05');
    await act(async () => document.getElementById('when')!.click());
    const clear = [...document.querySelectorAll<HTMLElement>('button')].find(
      (b) => b.textContent === 'Clear',
    )!;
    await act(async () => clear.click());
    expect(document.getElementById('out')!.textContent).toBe('');
    document.body.replaceChildren();
  });

  it('does not accept a day after the latest allowed date', async () => {
    await mount({ max: '2026-06-10', initial: '2026-06-02' });
    await act(async () => document.getElementById('when')!.click());
    const late = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose 20 June 2026"]',
    )!;
    const early = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose 5 June 2026"]',
    )!;
    expect(late.getAttribute('aria-disabled')).toBe('true');
    expect(early.getAttribute('aria-disabled')).toBe('false');
    document.body.replaceChildren();
  });
});
