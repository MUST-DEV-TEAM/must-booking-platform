// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordDirectory } from './record-directory';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});
describe('RecordDirectory', () => {
  it('sorts, selects, copies and opens rows without selector clicks opening them', async () => {
    const onRow = vi.fn(),
      writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    try {
      await act(async () =>
        root.render(
          createElement(RecordDirectory, {
            rows: [
              { id: 'b', name: 'Beta', n: 2 },
              { id: 'a', name: 'Alpha', n: 1 },
            ],
            columns: [
              { id: 'name', label: 'Name', value: (r) => r.name },
              { id: 'n', label: 'Count', value: (r) => r.n },
            ],
            storageKey: 'test.directory',
            onRow,
          }),
        ),
      );
      expect(document.querySelector('tbody tr')?.textContent).toContain('Alpha');
      await act(async () =>
        document.querySelector<HTMLButtonElement>('[aria-label="Select Alpha"]')!.click(),
      );
      expect(onRow).not.toHaveBeenCalled();
      const button = (text: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent === text,
        )!;
      await act(async () => button('Copy selected').click());
      expect(writeText).toHaveBeenCalledWith('"Name","Count"\r\n"Alpha","1"');
      await act(async () => button('Name').click());
      expect(document.querySelector('tbody tr')?.textContent).toContain('Beta');
      await act(async () => button('Alpha').click());
      expect(onRow).toHaveBeenCalledWith({ id: 'a', name: 'Alpha', n: 1 });
      await act(async () =>
        document.querySelector<HTMLButtonElement>('[aria-label="Compact rows"]')!.click(),
      );
      expect(JSON.parse(localStorage.getItem('test.directory')!).density).toBe('compact');
    } finally {
      await act(async () => root.unmount());
    }
  });
  it('shows its empty state without a dead table', async () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    try {
      await act(async () =>
        root.render(
          createElement(RecordDirectory<{ id: string }>, {
            rows: [],
            columns: [{ id: 'id', label: 'ID', value: (r) => r.id }],
            storageKey: 'empty',
            onRow: () => {},
            emptyTitle: 'No restrictions yet',
          }),
        ),
      );
      expect(document.body.textContent).toContain('No restrictions yet');
      expect(document.querySelector('table')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
  it('uses a server page without slicing the loaded records a second time', async () => {
    const host = document.body.appendChild(document.createElement('div')),
      root = createRoot(host),
      onPage = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(RecordDirectory<{ id: string; name: string }>, {
            rows: [{ id: 'b', name: 'Page two row' }],
            columns: [{ id: 'name', label: 'Name', value: (row) => row.name }],
            storageKey: 'test.server.directory',
            onRow: () => {},
            pagination: { page: 2, pageSize: 20, total: 70, onPage, onPageSize: vi.fn() },
          }),
        ),
      );
      expect(host.querySelector('tbody')!.textContent).toContain('Page two row');
      expect(host.textContent).toContain('70 items');
      expect(host.querySelector('[role="combobox"]')?.textContent).toContain('20');
      expect(host.querySelector('input[aria-label="Search this page"]')).not.toBeNull();
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click(),
      );
      expect(onPage).toHaveBeenCalledWith(3);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

it('passes only locally filtered visible rows to a shared visible action', async () => {
  const action = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  try {
    await act(async () =>
      root.render(
        createElement(RecordDirectory<{ id: string; name: string }>, {
          rows: [
            { id: 'a', name: 'Alpha' },
            { id: 'b', name: 'Beta' },
          ],
          columns: [{ id: 'name', label: 'Name', value: (r) => r.name }],
          storageKey: 'visible.action',
          onRow: () => {},
          visibleActions: (rows) => [
            { label: 'Mark visible', onSelect: () => action(rows.map((r) => r.id)) },
          ],
        }),
      ),
    );
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search records"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Beta',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === 'Mark visible')!
        .click(),
    );
    expect(action).toHaveBeenCalledWith(['b']);
  } finally {
    await act(async () => root.unmount());
  }
});
