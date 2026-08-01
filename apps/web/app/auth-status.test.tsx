import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { AuthStatusView } from './auth-status';

describe('auth status views', () => {
  it('renders the session-expired state with a safe continuation path', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthStatusView, {
        reason: 'session-expired',
        returnTo: '/dashboard/acme?tab=rooms',
      }),
    );

    expect(markup).toContain('Your session expired');
    expect(markup).toContain('No sensitive action continued');
    expect(markup).toContain('/login?returnTo=%2Fdashboard%2Facme%3Ftab%3Drooms');
  });

  it('renders the logged-out confirmation state', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthStatusView, {
        reason: 'logged-out',
        returnTo: '/dashboard/acme?tab=rooms',
      }),
    );

    expect(markup).toContain('been signed out');
    expect(markup).toContain('Protected access closed');
    expect(markup).toContain('/login?returnTo=%2Fdashboard%2Facme%3Ftab%3Drooms');
    expect(markup).toContain('Return to hotel website');
  });

  it('starts logout confirmation with a loading state', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthStatusView, { reason: 'logout-confirmation' }),
    );

    expect(markup).toContain('End this session safely.');
    expect(markup).toContain('Checking the current administrator session');
  });
});
