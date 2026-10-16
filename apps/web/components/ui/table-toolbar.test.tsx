// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BulkBar, DensityToggle } from './table-toolbar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

describe('BulkBar', () => {
  it('shows nothing when no row is selected', async () => {
    const { container, unmount } = await render(createElement(BulkBar, { count: 0, onClear: () => {} }));
    expect(container.textContent).toBe('');
    await unmount();
  });

  it('shows the count, the actions and clears the selection', async () => {
    const onClear = vi.fn();
    const { container, unmount } = await render(
      createElement(BulkBar, { count: 3, onClear }, createElement('button', { type: 'button' }, 'Copy emails')),
    );
    expect(container.textContent).toContain('3 selected');
    expect(container.textContent).toContain('Copy emails');
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Clear selection')!.click();
    });
    expect(onClear).toHaveBeenCalled();
    await unmount();
  });
});

describe('DensityToggle', () => {
  it('names the row height it will switch to and reports being pressed when compact', async () => {
    const onToggle = vi.fn();
    const { container, unmount } = await render(createElement(DensityToggle, { compact: true, onToggle }));
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Comfortable rows');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await act(async () => button.click());
    expect(onToggle).toHaveBeenCalled();
    await unmount();
  });
});
