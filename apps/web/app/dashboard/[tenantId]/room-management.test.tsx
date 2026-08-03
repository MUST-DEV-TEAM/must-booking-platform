import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RoomManagement } from './room-management';

describe('RoomManagement', () => {
  it('uses the shared dashboard skeleton during its initial load', () => {
    const markup = renderToStaticMarkup(createElement(RoomManagement, { tenantId: 'tenant-1' }));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Loading rooms');
    expect(markup).toContain('must-skeleton');
  });
});
