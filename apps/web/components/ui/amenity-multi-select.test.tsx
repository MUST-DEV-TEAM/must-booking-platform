// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AmenityMultiSelect } from './amenity-multi-select';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());

async function render(props: Parameters<typeof AmenityMultiSelect>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(AmenityMultiSelect, props)));
  return () => act(async () => root.unmount());
}
async function click(selector: string) {
  const element = document.body.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => element.click());
}

describe('AmenityMultiSelect', () => {
  it('batches selection and chip removal until Save amenities', async () => {
    const onChange = vi.fn();
    const unmount = await render({
      options: [
        { value: 'wifi', label: 'Wi-Fi' },
        { value: 'pool', label: 'Pool' },
      ],
      value: ['wifi'],
      onChange,
    });
    await click('[aria-label="Remove Wi-Fi"]');
    expect(onChange).not.toHaveBeenCalled();
    await click('[role="combobox"]');
    await click('[role="checkbox"][aria-label="Pool"]');
    await act(async () =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    const save = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save amenities',
    )!;
    await act(async () => save.click());
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(['pool']);
    await unmount();
  });

  it('creates a custom amenity from search and keeps its label in the chip', async () => {
    const onCreate = vi.fn().mockResolvedValue('custom-id');
    const onChange = vi.fn();
    const unmount = await render({ options: [], value: [], onChange, onCreate });
    await click('[role="combobox"]');
    const search = document.body.querySelector<HTMLInputElement>(
      '[aria-label="Search amenities"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), 'value')!.set!.call(
        search,
        'Yoga mat',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const create = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === "Create 'Yoga mat'",
    )!;
    await act(async () => create.click());
    expect(onCreate).toHaveBeenCalledWith('Yoga mat', undefined);
    expect(document.body.querySelector('[aria-label="Remove Yoga mat"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await unmount();
  });

  it('shows compact read-only chips without editing controls', async () => {
    const unmount = await render({
      options: [
        {
          value: 'wifi',
          label: 'Wi-Fi',
          icon: createElement('span', { 'data-test-icon': true }, 'icon'),
        },
      ],
      value: ['wifi'],
      onChange: vi.fn(),
      readOnly: true,
    });
    expect(document.body.textContent).toContain('Wi-Fi');
    expect(document.body.querySelector('[data-test-icon]')).not.toBeNull();
    expect(document.body.querySelector('[role="combobox"]')).toBeNull();
    expect(document.body.querySelector('button')).toBeNull();
    await unmount();
  });
  it('removes a suggestion immediately after creating it, before saving', async () => {
    const onCreate = vi.fn().mockResolvedValue('new-safe');
    const unmount = await render({
      options: [],
      value: [],
      onChange: vi.fn(),
      onCreate,
      suggestions: [{ value: 'safe', label: 'Safe' }],
    });
    await click('[role="combobox"]');
    const suggestion = [
      ...document.body.querySelectorAll('section[aria-label="Suggested amenities"] button'),
    ].find((b) => b.textContent === 'Safe') as HTMLButtonElement;
    await act(async () => suggestion.click());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(document.body.querySelector('section[aria-label="Suggested amenities"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="Remove Safe"]')).not.toBeNull();
    await unmount();
  });
});
