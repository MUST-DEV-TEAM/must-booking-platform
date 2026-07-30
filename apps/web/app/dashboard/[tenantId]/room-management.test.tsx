import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RoomManagement } from './room-management';

describe('RoomManagement', () => {
  it('renders inventory setup controls under the tenant-scoped dashboard', () => {
    const markup = renderToStaticMarkup(createElement(RoomManagement, { tenantId: 'tenant-1' }));

    expect(markup).toContain('Rooms and room types');
    expect(markup).toContain('Select a property');
    expect(markup).toContain('Set up the sellable room types');
  });
});
