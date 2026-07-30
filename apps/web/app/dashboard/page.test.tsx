import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardShell } from './dashboard-shell';

describe('Dashboard page', () => {
  it('shows an email-verification gate for unverified accounts', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardShell, {
        initialUser: { id: 'user-1', email: 'owner@example.test', emailVerified: false },
      }),
    );

    expect(markup).toContain('Your MUST Booking dashboard');
    expect(markup).toContain('Your Free-plan workspace is ready.');
    expect(markup).toContain('Verify your email to invite staff');
  });

  it('removes the gate after email verification', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardShell, {
        initialUser: { id: 'user-1', email: 'owner@example.test', emailVerified: true },
      }),
    );

    expect(markup).not.toContain('Verify your email to invite staff');
  });
});
