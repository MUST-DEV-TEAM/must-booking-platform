// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TimeField } from './time-field';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
HTMLElement.prototype.scrollTo = vi.fn();
describe('minimum arrival time', () => {
  it('hides earlier times and clamps a return to the minimum hour', async () => {
    const changes = vi.fn();
    function Example() {
      const [value, setValue] = useState('15:30');
      return createElement(TimeField, {
        label: 'Arrival',
        value,
        min: '15:30',
        onChange: (next) => {
          changes(next);
          setValue(next);
        },
      });
    }
    const container = document.body.appendChild(document.createElement('div')),
      root = createRoot(container);
    await act(async () => root.render(createElement(Example)));
    await act(async () => container.querySelector('button')!.click());
    const hours = () => document.querySelector('[role="listbox"][aria-label="Hours"]')!;
    const minutes = () => document.querySelector('[role="listbox"][aria-label="Minutes"]')!;
    expect([...hours().querySelectorAll('button')].some((b) => b.textContent === '14')).toBe(false);
    expect([...minutes().querySelectorAll('button')].some((b) => b.textContent === '20')).toBe(
      false,
    );
    await act(async () =>
      (
        [...hours().querySelectorAll('button')].find(
          (b) => b.textContent === '16',
        ) as HTMLButtonElement
      ).click(),
    );
    await act(async () =>
      (
        [...minutes().querySelectorAll('button')].find(
          (b) => b.textContent === '20',
        ) as HTMLButtonElement
      ).click(),
    );
    await act(async () =>
      (
        [...hours().querySelectorAll('button')].find(
          (b) => b.textContent === '15',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(changes).toHaveBeenLastCalledWith('15:30');
    expect(container.textContent).toContain('15:30');
    await act(async () => root.unmount());
    container.remove();
  });
});
