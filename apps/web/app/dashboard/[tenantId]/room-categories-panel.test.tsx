// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomCategoriesPanel } from './room-categories-panel';
import type { RoomCategory, RoomType } from './room-management-types';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', TestResizeObserver);
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
});
const categories: RoomCategory[] = [
  {
    id: 'suite',
    name: 'Suites',
    description: 'Large rooms',
    sortOrder: 0,
    storefrontVisible: true,
    roomCount: 1,
    updatedAt: '2026-10-18T12:00:00Z',
  },
  {
    id: 'standard',
    name: 'Standard',
    description: null,
    sortOrder: 1,
    storefrontVisible: false,
    roomCount: 2,
  },
];
const roomTypes = [
  { id: 'king', name: 'King', categoryId: 'suite' },
  { id: 'twin', name: 'Twin', categoryId: null },
] as RoomType[];
async function mount(overrides: Partial<Parameters<typeof RoomCategoriesPanel>[0]> = {}) {
  const handlers = {
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onReorder: vi.fn().mockResolvedValue(undefined),
    onAssign: vi.fn().mockResolvedValue(undefined),
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(RoomCategoriesPanel, {
        categories,
        roomTypes,
        canManage: true,
        saving: false,
        ...handlers,
        ...overrides,
      }),
    ),
  );
  return handlers;
}
function button(text: string) {
  const b = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (e) => e.textContent?.trim() === text || e.getAttribute('aria-label') === text,
  );
  if (!b) throw new Error(`Missing button ${text}`);
  return b;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function input(selector: string, value: string) {
  await act(async () => {
    const el = document.body.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function menu() {
  await act(async () =>
    button('Actions for Suites').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    ),
  );
}
async function item(text: string) {
  await act(async () => {
    const el = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (e) => e.textContent === text,
    );
    if (!el) throw new Error(`Missing item ${text}`);
    el.click();
  });
}
describe('RoomCategoriesPanel', () => {
  it('renders singular and plural counts, a single switch per row, dates and search', async () => {
    await mount();
    expect(document.body.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(document.body.textContent).toContain('1 room type');
    expect(document.body.textContent).toContain('2 room types');
    expect(document.body.querySelectorAll('[role="switch"]')).toHaveLength(2);
    expect(document.body.querySelector('time')?.getAttribute('datetime')).toBe(
      categories[0].updatedAt,
    );
    await input('[aria-label="Search categories"]', 'large');
    expect(document.body.querySelectorAll('tbody tr')).toHaveLength(1);
  });
  it('validates names and keeps a rejected draft with its API error', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('Server refused category.'));
    await mount({ onCreate });
    await click('Add category');
    expect(button('Save category').disabled).toBe(true);
    await input('#category-name', 'sUiTeS');
    expect(document.body.textContent).toContain('already exists');
    await input('#category-name', 'x'.repeat(201));
    expect(document.body.textContent).toContain('at most 200');
    await input('#category-name', 'Garden');
    await click('Save category');
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Garden',
      description: '',
      storefrontVisible: true,
    });
    expect(document.body.textContent).toContain('Server refused category.');
    expect(document.body.querySelector('#category-name')).not.toBeNull();
  });
  it('edits with the same dialog', async () => {
    const h = await mount();
    await menu();
    await item('Edit');
    await input('#category-name', 'Ocean suites');
    await click('Save category');
    expect(h.onUpdate).toHaveBeenCalledWith('suite', {
      name: 'Ocean suites',
      description: 'Large rooms',
      storefrontVisible: true,
    });
  });
  it('reorders against the whole list while filtered', async () => {
    const h = await mount();
    await input('[aria-label="Search categories"]', 'Suites');
    await menu();
    await item('Move down');
    expect(h.onReorder).toHaveBeenCalledWith(['standard', 'suite']);
  });
  it('assigns through the shared multi-select', async () => {
    const h = await mount();
    await menu();
    await item('Manage room types');
    expect(
      document.body.querySelector('[role="combobox"][aria-label="Room types in category"]'),
    ).not.toBeNull();
    await act(async () =>
      document.body.querySelector<HTMLButtonElement>('[aria-label="Remove King"]')!.click(),
    );
    await click('Save room types');
    expect(h.onAssign).toHaveBeenCalledWith(categories[0], []);
  });
  it('confirms deletion and explains the assigned types are kept', async () => {
    const h = await mount();
    await menu();
    await item('Delete');
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('will become uncategorized');
    expect(document.body.textContent).toContain('will be kept');
    await click('Delete categories');
    expect(h.onDelete).toHaveBeenCalledWith(categories[0]);
  });
  it('applies the bulk storefront action', async () => {
    const h = await mount();
    await click('Select all categories');
    await click('Hide on storefront');
    expect(h.onUpdate).toHaveBeenCalledWith('suite', { storefrontVisible: false });
    expect(h.onUpdate).toHaveBeenCalledWith('standard', { storefrontVisible: false });
  });
  it('sorts by name and switches table density through the shared toolbar', async () => {
    await mount();
    await click('Name');
    expect(document.body.querySelector('tbody tr')?.textContent).toContain('Standard');
    await click('Compact rows');
    expect(document.body.querySelector('table')?.className).toContain('[&_td]:py-2');
    window.localStorage.clear();
  });
  it('gates all mutations in read-only mode', async () => {
    await mount({ canManage: false });
    expect(document.body.querySelector('[aria-label^="Actions for"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="Select all categories"]')).toBeNull();
    expect(
      [...document.body.querySelectorAll<HTMLButtonElement>('[role="switch"]')].every(
        (e) => e.disabled,
      ),
    ).toBe(true);
    expect(document.body.textContent).not.toContain('Add category');
  });
  it('provides an empty-state CTA', async () => {
    await mount({ categories: [] });
    expect(document.body.textContent).toContain('No categories yet');
    await click('Add category');
    expect(document.body.querySelector('#category-name')).not.toBeNull();
  });
});
