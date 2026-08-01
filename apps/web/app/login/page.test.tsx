import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import LoginPage from './page';

describe('Login page', () => {
  it('renders the Figma auth shell and login controls', () => {
    const markup = renderToStaticMarkup(createElement(LoginPage));

    expect(markup).toContain('Run every stay');
    expect(markup).toContain('with confidence.');
    expect(markup).toContain('Welcome back');
    expect(markup).toContain('Sign in with your hotel staff account');
    expect(markup).not.toContain('WordPress');
    expect(markup).toContain('Email address');
    expect(markup).toContain('Password');
    expect(markup).toContain('Remember this device for 30 days');
    expect(markup).toContain('Forgot password?');
    expect(markup).toContain('Protected hotel operations');
    expect(markup).toContain('Terms &amp; Conditions');
    expect(markup).toContain('Privacy Policy');
    expect(markup).toContain('mailto:dejvis@must.al');
    expect(markup).not.toContain('support@musthotel.com');
  });
});
