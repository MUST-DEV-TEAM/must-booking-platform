// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  effectivePermissionItems,
  PermissionList,
  permissionMultiSelectOptions,
  type PermissionCatalogItem,
} from './permission-list';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const catalog: PermissionCatalogItem[] = [
  { group: 'Bookings', key: 'bookings.view', label: 'View bookings', description: 'See bookings.' },
  {
    group: 'Bookings',
    key: 'bookings.edit',
    label: 'Edit bookings',
    description: 'Change bookings.',
  },
  {
    group: 'Payments',
    key: 'payments.refund',
    label: 'Refund payments',
    description: 'Issue refunds.',
  },
];

afterEach(() => {
  document.body.replaceChildren();
});

async function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, unmount: () => act(async () => root.unmount()) };
}

describe('PermissionList', () => {
  it('shows granted and denied permissions as a compact grouped list with source badges', async () => {
    const permissions = effectivePermissionItems(catalog, [
      { key: 'bookings.view', granted: true, source: 'role' },
      { key: 'bookings.edit', granted: true, source: 'extra' },
      { key: 'payments.refund', granted: false, source: 'denied' },
      { key: 'reports.view', granted: false, source: 'none' },
    ]);
    const { container, unmount } = await render(
      createElement(PermissionList, {
        permissions,
        ariaLabel: 'Effective permissions',
      }),
    );

    expect(container.querySelector('section[aria-label="Bookings"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="Payments"]')).not.toBeNull();
    expect(container.textContent).toContain('View bookings');
    expect(container.textContent).toContain('Edit bookings');
    expect(container.textContent).toContain('Refund payments');
    expect(container.textContent).not.toContain('reports.view');
    expect(container.textContent).toContain('Role');
    expect(container.textContent).toContain('Extra');
    expect(container.textContent).toContain('Denied');
    expect(container.querySelector('[role="checkbox"], [role="combobox"]')).toBeNull();
    await unmount();
  });

  it('marks permissions the signed-in person does not hold with the disabled reason', () => {
    const options = permissionMultiSelectOptions(catalog, ['bookings.view']);
    expect(options[0]).toMatchObject({ value: 'bookings.view' });
    expect(options[0].disabled).toBeUndefined();
    expect(options[1]).toMatchObject({
      value: 'bookings.edit',
      disabledReason: 'You do not hold this permission',
    });
    expect(options[1].disabled).toBeUndefined();
  });
});
