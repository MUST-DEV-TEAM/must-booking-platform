// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { SortableTableHead } from './sortable-table-head';
import { Table, TableHeader, TableRow } from './table';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SortableTableHead', () => {
  it('announces the active sort direction and reports a sort request', async () => {
    const onSort = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          Table,
          undefined,
          createElement(
            TableHeader,
            undefined,
            createElement(
              TableRow,
              undefined,
              createElement(SortableTableHead, {
                label: 'Guest',
                active: true,
                direction: 'desc',
                onSort,
              }),
            ),
          ),
        ),
      );
    });

    expect(container.querySelector('th')?.getAttribute('aria-sort')).toBe('descending');
    await act(async () => {
      container.querySelector('button')?.click();
    });
    expect(onSort).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
