// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MultiSelect, type MultiSelectOption } from './multi-select';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const groupedOptions: MultiSelectOption[] = [
  {
    value: 'bookings.view',
    label: 'View bookings',
    description: 'See booking details.',
    group: 'Bookings',
  },
  {
    value: 'bookings.cancel',
    label: 'Cancel bookings',
    description: 'Cancel existing bookings.',
    group: 'Bookings',
    disabled: true,
    disabledReason: 'You do not hold this permission',
  },
  {
    value: 'calendar.view',
    label: 'View calendar',
    description: 'See availability.',
    group: 'Calendar',
  },
];

afterEach(() => {
  document.body.replaceChildren();
});

function Harness({
  options,
  initialValue = [],
  onChange = () => {},
  ...props
}: {
  options: readonly MultiSelectOption[];
  initialValue?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  label: string;
  error?: string | boolean;
  disabled?: boolean;
  searchable?: boolean;
  emptyText?: string;
}) {
  const [value, setValue] = useState(initialValue);
  return createElement(MultiSelect, {
    options,
    value,
    onChange: (next) => {
      onChange(next);
      setValue(next);
    },
    ...props,
  });
}

async function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, unmount: () => act(async () => root.unmount()) };
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function open(label = 'Permissions') {
  const control = document.body.querySelector<HTMLElement>(
    `[role="combobox"][aria-label="${label}"]`,
  );
  if (!control) throw new Error(`Multi-select ${label} was not found.`);
  await click(control);
}

describe('MultiSelect', () => {
  it('shows removable label chips and selects or clears enabled options by group', async () => {
    const onChange = vi.fn();
    const { unmount } = await render(
      createElement(Harness, {
        options: groupedOptions,
        initialValue: ['bookings.view'],
        onChange,
        label: 'Permissions',
        placeholder: 'Choose permissions',
      }),
    );

    expect(document.body.textContent).toContain('View bookings');
    const removeChip = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Remove View bookings"]',
    )!;
    await click(removeChip);
    expect(onChange).toHaveBeenLastCalledWith([]);
    await open();
    expect(document.body.querySelector('[data-slot="multi-select-heading"]')?.textContent).toBe(
      'Choose permissions',
    );
    expect(document.body.querySelector('section[aria-label="Bookings"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Select all Bookings"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Clear Bookings"]')).not.toBeNull();

    const selectAll = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Select all Bookings"]',
    )!;
    await click(selectAll);
    expect(onChange).toHaveBeenLastCalledWith(['bookings.view']);

    const clear = document.body.querySelector<HTMLButtonElement>('[aria-label="Clear Bookings"]')!;
    await click(clear);
    expect(onChange).toHaveBeenLastCalledWith([]);
    await unmount();
  });

  it('defaults search on above eight options and filters by label and description', async () => {
    const options = Array.from({ length: 9 }, (_, index) => ({
      value: `option.${index}`,
      label: `Option ${index}`,
      description: index === 5 ? 'Find this special permission.' : 'Another description.',
      group: 'Settings',
    }));
    const { unmount } = await render(
      createElement(MultiSelect, {
        options,
        value: [],
        onChange: () => {},
        label: 'Permissions',
      }),
    );
    await open();
    const search = document.body.querySelector<HTMLInputElement>(
      '[aria-label="Search permissions"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), 'value')!.set!.call(
        search,
        'special permission',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.body.querySelector('[aria-label="Option 5"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Option 4"]')).toBeNull();
    await unmount();
  });

  it('supports arrow navigation, Space and Enter selection, Escape, and Backspace chip removal', async () => {
    const onChange = vi.fn();
    const { unmount } = await render(
      createElement(Harness, {
        options: groupedOptions,
        initialValue: ['calendar.view'],
        onChange,
        label: 'Permissions',
        searchable: false,
      }),
    );
    const control = document.body.querySelector<HTMLElement>('[role="combobox"]')!;
    await act(async () => {
      control.focus();
      control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const first = document.body.querySelector<HTMLButtonElement>(
      '[data-multi-select-option][aria-label="View bookings"]',
    )!;
    expect(document.activeElement).toBe(first);

    await act(async () => {
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith(['calendar.view', 'bookings.view']);

    const controlAfterSelect = document.body.querySelector<HTMLElement>('[role="combobox"]')!;
    await act(async () => {
      controlAfterSelect.focus();
      controlAfterSelect.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith(['calendar.view']);

    const currentOption = document.body.querySelector<HTMLButtonElement>(
      '[data-multi-select-option][aria-label="View bookings"]',
    )!;
    await act(async () => {
      currentOption.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cancel bookings');
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith(['calendar.view']);

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('View calendar');
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith([]);
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(controlAfterSelect.getAttribute('aria-expanded')).toBe('false');
    await unmount();
  });

  it('shows disabled reasons, an error state, and a disabled field', async () => {
    const onChange = vi.fn();
    const { unmount } = await render(
      createElement(MultiSelect, {
        options: groupedOptions,
        value: [],
        onChange,
        label: 'Permissions',
        error: 'Choose at least one permission.',
      }),
    );
    const control = document.body.querySelector('[role="combobox"]')!;
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain('Choose at least one permission.');
    await open();
    const disabled = document.body.querySelector<HTMLButtonElement>(
      '[data-multi-select-option][aria-label="Cancel bookings"]',
    )!;
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.getAttribute('title')).toBe('You do not hold this permission');
    await click(disabled);
    expect(onChange).not.toHaveBeenCalled();
    await unmount();

    const disabledRender = await render(
      createElement(MultiSelect, {
        options: groupedOptions,
        value: [],
        onChange,
        label: 'Disabled permissions',
        disabled: true,
      }),
    );
    expect(document.body.querySelector('[role="combobox"][aria-disabled="true"]')).not.toBeNull();
    await disabledRender.unmount();
  });

  it('lets a user remove an already selected permission they can no longer grant', async () => {
    const onChange = vi.fn();
    const options = [
      {
        value: 'bookings.view',
        label: 'View bookings',
        group: 'Bookings',
        disabledReason: 'You do not hold this permission',
      },
    ];
    const { unmount } = await render(
      createElement(Harness, {
        options,
        initialValue: ['bookings.view'],
        onChange,
        label: 'Permissions',
      }),
    );

    await open();
    expect(
      document.body
        .querySelector('[data-multi-select-option][aria-label="View bookings"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');
    await click(document.body.querySelector('[aria-label="Remove View bookings"]')!);
    expect(onChange).toHaveBeenLastCalledWith([]);
    await unmount();
  });
});
