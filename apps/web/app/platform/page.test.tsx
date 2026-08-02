import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppShell } from '@must/ui';
import { platformNavigation } from './page';

describe('Platform dashboard shell', () => {
  it('renders all platform destinations and the signed-in email', () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        navigation: platformNavigation,
        title: 'Platform operations',
        userEmail: 'admin@example.com',
        children: null,
      }),
    );

    expect(markup).toContain('Overview');
    expect(markup).toContain('Tenants');
    expect(markup).toContain('Audit Log');
    expect(markup).toContain('<svg');
    expect(markup).toContain('admin@example.com');
    expect(markup).not.toContain('Signed-in user');
  });
});
