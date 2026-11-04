// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it, expect } from 'vitest';
import { TimeStrip } from './time-strip';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
});
async function mount() {
  function Fixture() {
    const [selected, setSelected] = useState<number[]>([]);
    return createElement(TimeStrip, {
      columns: [0, 15, 30, 45].map((value) => ({ value, label: String(value), group: 'Dinner' })),
      selected,
      onChange: setSelected,
    });
  }
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(createElement(Fixture)));
  return [...document.querySelectorAll<HTMLButtonElement>('button')];
}
const selected = () =>
  [...document.querySelectorAll('[aria-pressed="true"]')].map((el) =>
    el.getAttribute('aria-label'),
  );
it('selects moments, toggles Ctrl/Cmd columns and extends Shift ranges', async () => {
  const buttons = await mount();
  await act(async () => buttons[0].click());
  await act(async () =>
    buttons[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })),
  );
  expect(selected()).toEqual(['Dinner 0', 'Dinner 30']);
  await act(async () =>
    buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  );
  expect(selected()).toEqual(['Dinner 30']);
  await act(async () =>
    buttons[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
  );
  expect(selected()).toEqual(['Dinner 0', 'Dinner 15', 'Dinner 30', 'Dinner 45']);
});
it('supports Space, Enter, arrows and Shift+arrow from the keyboard', async () => {
  const buttons = await mount();
  await act(async () =>
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })),
  );
  await act(async () =>
    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(buttons[2]);
  expect(selected()).toEqual(['Dinner 15', 'Dinner 30']);
  await act(async () =>
    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
  );
  expect(document.activeElement).toBe(buttons[3]);
  await act(async () =>
    buttons[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ctrlKey: true }),
    ),
  );
  expect(selected()).toEqual(['Dinner 15', 'Dinner 30', 'Dinner 45']);
});
