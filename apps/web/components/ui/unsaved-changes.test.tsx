// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { UnsavedChangesBoundary, useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
it('keeps dirty edits until an explicit discard and clears the browser-close guard after save', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const changed = vi.fn(),
    host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Editor() {
    const [dirty, setDirty] = useState(false);
    const clean = useUnsavedChanges(dirty),
      { request } = useUnsavedNavigation();
    return createElement(
      'div',
      null,
      createElement('button', { onClick: () => setDirty(true) }, 'Edit'),
      createElement('button', { onClick: () => request(changed) }, 'Navigate'),
      createElement(
        'button',
        {
          onClick: () => {
            setDirty(false);
            clean();
          },
        },
        'Save',
      ),
    );
  }
  const click = async (text: string) => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent === text);
    expect(b).toBeTruthy();
    await act(async () => b!.click());
  };
  try {
    await act(async () =>
      root.render(createElement(UnsavedChangesBoundary, null, createElement(Editor))),
    );
    await click('Edit');
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await click('Navigate');
    expect(changed).not.toHaveBeenCalled();
    await click('Keep editing');
    expect(changed).not.toHaveBeenCalled();
    await click('Navigate');
    await click('Discard changes');
    expect(changed).toHaveBeenCalledOnce();
    await click('Edit');
    await click('Save');
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
