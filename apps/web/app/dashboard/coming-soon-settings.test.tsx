// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

import {
  CancellationPoliciesSoon,
  InvitationsSoon,
  PlanChangeSoon,
  SecuritySoon,
} from './coming-soon-settings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
});
async function mount(element: React.ReactElement) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}

it('shows the cancellation policies as coming soon, with today’s rule and a labelled example', async () => {
  const host = await mount(createElement(CancellationPoliciesSoon, { freeDays: 7 }));
  const text = host.textContent ?? '';
  expect(text).toContain('Coming soon');
  expect(text).toContain('free cancellation up to 7 days before arrival');
  expect(text).toContain('Example, not active');
  expect(text).toContain('Non-refundable');
  expect(host.querySelector('button')).toBeNull();
});
it('uses the singular for one day', async () => {
  const host = await mount(createElement(CancellationPoliciesSoon, { freeDays: 1 }));
  expect(host.textContent).toContain('up to 1 day before arrival');
});
it('shows invitations, security and plan changes as coming soon without any button', async () => {
  for (const [element, expected] of [
    [createElement(InvitationsSoon), 'Send an invitation again, or withdraw it.'],
    [createElement(SecuritySoon), 'There is always exactly one owner of the account.'],
    [createElement(PlanChangeSoon), 'Billing and invoices'],
  ] as const) {
    const host = await mount(element);
    expect(host.textContent).toContain('Coming soon');
    expect(host.textContent).toContain(expected);
    expect(host.querySelector('button')).toBeNull();
    await act(async () => root!.unmount());
    root = undefined;
    host.remove();
  }
});
