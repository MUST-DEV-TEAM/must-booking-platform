import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '@must/ui';
import { AuditLogView, navigation } from './page';

describe('Platform audit log page', () => {
  it('renders its loading state', () => {
    const markup = renderToStaticMarkup(
      createElement(AuditLogView, { auditLog: null, loading: true, onPageChange: vi.fn() }),
    );
    expect(markup).toContain('Loading audit log');
  });

  it('renders audit entries in an accessible table', () => {
    const markup = renderToStaticMarkup(
      createElement(AuditLogView, {
        loading: false,
        onPageChange: vi.fn(),
        auditLog: {
          items: [
            {
              id: 'entry-1',
              tenantId: 'tenant-1',
              action: 'platform.tenant.suspended',
              targetType: 'organization',
              targetId: 'tenant-1',
              actorType: 'PLATFORM_ADMIN',
              actorEmail: 'admin@example.com',
              createdAt: '2026-08-02T12:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 50,
          total: 1,
        },
      }),
    );
    expect(markup).toContain('Platform audit log');
    expect(markup).toContain('admin@example.com');
    expect(markup).toContain('tenant › suspended');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('scope="row"');
  });

  it('enables the next page when more audit entries exist', () => {
    const markup = renderToStaticMarkup(
      createElement(AuditLogView, {
        loading: false,
        onPageChange: vi.fn(),
        auditLog: { items: [], page: 1, pageSize: 50, total: 51 },
      }),
    );
    expect(markup).toContain('Page 1 of 2');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('>Next</button>');
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
    expect(markup).toContain('Overview');
    expect(markup).toContain('Tenants');
    expect(markup).toContain('Audit Log');
    expect(markup).toContain('admin@example.com');
  });
});
