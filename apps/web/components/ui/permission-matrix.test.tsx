// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionMatrix, type PermissionCatalogItem } from './permission-matrix';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const catalog: PermissionCatalogItem[] = [
  {
    group: 'Bookings',
    key: 'bookings.view',
    label: 'View bookings',
    description: 'Read bookings.',
  },
  { group: 'Bookings', key: 'bookings.cancel', label: 'Cancel bookings', description: '' },
  { group: 'Guests', key: 'guests.view', label: 'View guests', description: '' },
];

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('PermissionMatrix', () => {
  it('groups catalog entries and reports checkbox changes', async () => {
    const changed = vi.fn();
    const { container, root } = mount({ onChange: changed });
    expect(container.querySelector('[aria-label="Bookings"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Guests"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(3);

    await act(async () => {
      container.querySelector<HTMLElement>('[aria-label="Cancel bookings"]')?.click();
    });
    expect(changed).toHaveBeenCalledWith(['bookings.cancel']);
    await unmount(root);
  });

  it('shows a reason for unavailable permissions and supports read-only mode', async () => {
    const { container, root } = mount({
      disabledReasons: { 'bookings.cancel': 'You do not have this permission.' },
    });
    const disabled = container.querySelector<HTMLElement>('[aria-label="Cancel bookings"]')!;
    expect(disabled.getAttribute('data-disabled')).toBe('');
    expect(container.textContent).toContain('You do not have this permission.');
    expect(
      container
        .querySelector<HTMLElement>('[aria-label="View bookings"]')
        ?.getAttribute('data-disabled'),
    ).toBeNull();
    await unmount(root);

    const readOnly = mount({ readOnly: true });
    expect(readOnly.container.querySelectorAll('[data-disabled=""]')).toHaveLength(3);
    await unmount(readOnly.root);
  });
});

function mount(
  options: {
    onChange?: (keys: string[]) => void;
    disabledReasons?: Record<string, string>;
    readOnly?: boolean;
  } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(PermissionMatrix, {
        catalog,
        selectedKeys: [],
        onChange: options.onChange ?? (() => undefined),
        disabledReasons: options.disabledReasons,
        readOnly: options.readOnly,
      }),
    ),
  );
  return { container, root };
}

async function unmount(root: ReturnType<typeof createRoot>) {
  await act(async () => root.unmount());
}
