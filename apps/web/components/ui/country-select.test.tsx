// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { CountrySelect } from './country-select';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe('CountrySelect', () => {
  it('searches assigned countries, emits the code and preserves unknown as optional', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host),
      change = vi.fn();
    await act(async () =>
      root.render(createElement(CountrySelect, { value: null, onChange: change })),
    );
    expect(host.textContent).toContain('Not recorded');
    await act(async () => host.querySelector('button')!.click());
    const input = document.querySelector<HTMLInputElement>('input[placeholder]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Albania',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((e) => e.textContent?.includes('Albania'))!
        .querySelector('button')!
        .click(),
    );
    expect(change).toHaveBeenCalledWith('AL');
    await act(async () => root.unmount());
    host.remove();
  });
  it('shows recorded country and disables editing when read-only', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(createElement(CountrySelect, { value: 'AL', onChange: vi.fn(), disabled: true })),
    );
    expect(host.textContent).toContain('Albania');
    expect(host.querySelector('button')!.disabled).toBe(true);
    await act(async () => root.unmount());
    host.remove();
  });
});
