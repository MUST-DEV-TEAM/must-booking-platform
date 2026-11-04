// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FloorMap, type FloorMapTable } from './floor-map';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

const t1: FloorMapTable = {
  id: 't1',
  label: 'T1',
  seats: '2 to 4 seats',
  x: 100,
  y: 70,
  w: 80,
  h: 80,
  shape: 'square',
};
const t2: FloorMapTable = { ...t1, id: 't2', label: 'T2', seats: '6 seats', x: 0, shape: 'round' };

async function mount(props: Partial<Parameters<typeof FloorMap>[0]> = {}) {
  const onMove = vi.fn();
  const onSelect = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(FloorMap, {
        width: 1000,
        height: 700,
        tables: [t1, t2],
        editable: true,
        gridSize: 10,
        onMove,
        onSelect,
        ...props,
      }),
    );
  });
  return { onMove, onSelect };
}
const tableEl = (label: string) =>
  document.querySelector<HTMLElement>(`[aria-label^="${label},"]`)!;
async function press(el: HTMLElement, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('FloorMap', () => {
  it('draws every table with its label and seats, placed by percentage of the canvas', async () => {
    await mount();
    expect(document.body.textContent).toContain('T1');
    expect(document.body.textContent).toContain('2 to 4 seats');
    const el = tableEl('T1');
    expect(el.style.left).toBe('10%');
    expect(el.style.width).toBe('8%');
    expect(tableEl('T2').style.borderRadius).toBe('50%');
  });

  it('moves a focused table one grid step per arrow key', async () => {
    const { onMove } = await mount();
    await press(tableEl('T1'), 'ArrowRight');
    expect(onMove).toHaveBeenCalledWith('t1', 110, 70);
    await press(tableEl('T1'), 'ArrowUp');
    expect(onMove).toHaveBeenLastCalledWith('t1', 100, 60);
  });

  it('does not report a move when the table is already against the edge', async () => {
    const { onMove } = await mount();
    await press(tableEl('T2'), 'ArrowLeft');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('selects a table with Enter or a click', async () => {
    const { onSelect } = await mount();
    await press(tableEl('T1'), 'Enter');
    expect(onSelect).toHaveBeenCalledWith('t1');
    await act(async () => tableEl('T2').click());
    expect(onSelect).toHaveBeenLastCalledWith('t2');
  });

  it('shows which table is selected', async () => {
    await mount({ selectedId: 't2' });
    expect(tableEl('T2').getAttribute('aria-pressed')).toBe('true');
    expect(tableEl('T1').getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores arrow keys when the map is read-only but still allows selecting', async () => {
    const { onMove, onSelect } = await mount({ editable: false });
    await press(tableEl('T1'), 'ArrowRight');
    await press(tableEl('T1'), 'Enter');
    expect(onMove).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('t1');
  });
});
