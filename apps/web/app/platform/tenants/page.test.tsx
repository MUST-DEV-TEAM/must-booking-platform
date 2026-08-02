import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '@must/ui';
import { navigation, TenantListView } from './page';

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

  it('renders the complete platform navigation with the signed-in email', () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        navigation,
        title: 'Platform operations',
        userEmail: 'admin@example.com',
        children: null,
      }),
    );
    expect(markup.match(/href="\/platform\//g)).toHaveLength(2);
    expect(markup).toContain('Overview');
    expect(markup).toContain('Tenants');
    expect(markup).toContain('Audit Log');
    expect(markup).toContain('<svg');
    expect(markup).toContain('admin@example.com');
    expect(markup).not.toContain('Signed-in user');
  });
});
