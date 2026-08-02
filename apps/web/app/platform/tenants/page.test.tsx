import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TenantListView } from './page';

describe('Platform tenants page', () => {
  it('renders its loading state', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantListView, {
        tenants: [],
        loading: true,
        search: '',
        onSearchChange: vi.fn(),
      }),
    );
    expect(markup).toContain('Loading tenants');
    expect(markup).toContain('Search tenants');
  });

  it('renders tenant identity, owner, status, and detail links', () => {
    const markup = renderToStaticMarkup(
      createElement(TenantListView, {
        tenants: [
          {
            id: 'tenant-1',
            name: 'Acme Hotel',
            status: 'SUSPENDED',
            ownerEmail: 'owner@acme.test',
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        loading: false,
        search: 'Acme',
        onSearchChange: vi.fn(),
      }),
    );
    expect(markup).toContain('Acme Hotel');
    expect(markup).toContain('owner@acme.test');
    expect(markup).toContain('suspended');
    expect(markup).toContain('/platform/tenants/tenant-1');
  });
});
