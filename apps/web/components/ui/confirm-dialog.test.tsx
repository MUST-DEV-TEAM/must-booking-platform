// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe('ConfirmDialog', () => {
  it('uses a caller-specific reason prompt and requires the reason before confirming', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host),
      confirm = vi.fn().mockResolvedValue(undefined);
    try {
      await act(async () =>
        root.render(
          createElement(ConfirmDialog, {
            open: true,
            onOpenChange: () => {},
            title: 'Retry email',
            description: 'Same approved message',
            confirmLabel: 'Retry',
            reasonLabel: 'Why retry',
            reasonRequired: true,
            reasonPlaceholder: 'Recorded with this email action',
            onConfirm: confirm,
          }),
        ),
      );
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent === 'Retry',
      )!;
      expect(button.disabled).toBe(true);
      const reason = document.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(reason.placeholder).toBe('Recorded with this email action');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          reason,
          'Provider recovered',
        );
        reason.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button.click());
      expect(confirm).toHaveBeenCalledWith('Provider recovered');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

it('uses a specific cancellation label for a non-destructive confirmation', async () => {
  const close = vi.fn(),
    root = createRoot(document.body.appendChild(document.createElement('div')));
  try {
    await act(async () =>
      root.render(
        createElement(ConfirmDialog, {
          open: true,
          onOpenChange: close,
          title: 'Export evidence',
          description: 'Export the selected records.',
          confirmLabel: 'Export',
          cancelLabel: 'Cancel',
          onConfirm: async () => {},
        }),
      ),
    );
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Cancel',
    )!;
    expect(cancel).toBeTruthy();
    await act(async () => cancel.click());
    expect(close).toHaveBeenCalledWith(false);
  } finally {
    await act(async () => root.unmount());
  }
});
