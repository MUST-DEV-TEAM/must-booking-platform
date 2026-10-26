// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { PrimaryPhotoBadge, PrimaryPhotoButton } from './photo-primary';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe('primary photo controls', () => {
  it('selects using an icon-only accessible button', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onSelect = vi.fn();
    await act(async () =>
      root.render(createElement(PrimaryPhotoButton, { primary: false, photoNumber: 2, onSelect })),
    );
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Set photo 2 as primary photo');
    expect(button.textContent).toBe('');
    expect(container.querySelector('[title="Set as primary photo"]')).not.toBeNull();
    await act(async () => button.click());
    expect(onSelect).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
  it('marks the primary image with a filled star and no visible text', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(createElement(PrimaryPhotoBadge)));
    expect(container.querySelector('[aria-label="Primary photo"]')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
    expect(container.textContent).toBe('');
    await act(async () => root.unmount());
  });
});
