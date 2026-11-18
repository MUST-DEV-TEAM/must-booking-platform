// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsFrame } from '../../app/dashboard/settings-frame';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  document.body.replaceChildren();
});
async function render(element: React.ReactElement) {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  await act(async () => root.render(element));
  mounted.push(async () => act(async () => root.unmount()));
  return container;
}

describe('Settings menu', () => {
  it('groups the tabs, marks the current one and hides tabs without a page', async () => {
    const container = await render(
      createElement(SettingsFrame, { tenantId: 't', propertyId: 'p', tab: 'policies' }, 'Body'),
    );
    const menu = container.querySelector('nav[aria-label="Settings menu"]')!;
    const text = menu.textContent ?? '';
    for (const label of [
      'Start',
      'Hotel',
      'Booking',
      'Payments',
      'Connections',
      'Communication',
      'Account',
      'Applies to all your hotels',
      'Profile',
      'Contact and brand',
      'Team and roles',
      'Audit log',
    ])
      expect(text).toContain(label);
    expect(text).not.toContain('Taxes and fees');
    expect(menu.querySelector('a[aria-current="page"]')?.textContent).toBe('Policies');
    expect(
      menu.querySelector('a[href="/dashboard/t?propertyId=p&section=settings&settingsArea=team"]'),
    ).not.toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('Policies');
    expect(container.textContent).toContain('Body');
  });

  it('switches in place on a normal click and leaves a ctrl-click to the browser', async () => {
    const onNavigate = vi.fn();
    const container = await render(
      createElement(
        SettingsFrame,
        { tenantId: 't', propertyId: 'p', tab: 'overview', onNavigate },
        'Body',
      ),
    );
    const link = Array.from(container.querySelectorAll('nav a')).find(
      (anchor) => anchor.textContent === 'Emails',
    )!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => link.dispatchEvent(click));
    expect(onNavigate).toHaveBeenCalledWith('emails');
    expect(click.defaultPrevented).toBe(true);

    const ctrlClick = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    await act(async () => link.dispatchEvent(ctrlClick));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(ctrlClick.defaultPrevented).toBe(false);
  });
});
