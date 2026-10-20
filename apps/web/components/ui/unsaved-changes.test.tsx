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
it('keeps skip links and modified clicks from discarding a still-mounted dirty editor', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalUrl = window.location.href,
    originalState = window.history.state,
    host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Editor() {
    useUnsavedChanges(true);
    return createElement(
      'div',
      null,
      createElement('a', { href: '#unsaved-test-target' }, 'Skip to editor'),
      createElement('a', { href: '/leave-editor' }, 'Another page'),
      createElement('div', { id: 'unsaved-test-target' }, 'Editor'),
    );
  }
  try {
    await act(async () =>
      root.render(createElement(UnsavedChangesBoundary, null, createElement(Editor))),
    );
    const anchor = host.querySelector('a')!;
    const skip = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => {
      anchor.dispatchEvent(skip);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(skip.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const external = host.querySelectorAll('a')[1],
      target = vi.fn((event: Event) => event.preventDefault());
    external.addEventListener('click', target);
    await act(async () =>
      external.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }),
      ),
    );
    expect(target).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await act(async () =>
      external.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(target).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.history.replaceState(originalState, '', originalUrl);
  }
});
