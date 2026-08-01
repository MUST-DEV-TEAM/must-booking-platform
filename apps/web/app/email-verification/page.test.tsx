import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import EmailVerificationPage from './page';

describe('Email verification page', () => {
  it('renders the shared auth shell and verification state', () => {
    const markup = renderToStaticMarkup(createElement(EmailVerificationPage));

    expect(markup).toContain('Run every stay');
    expect(markup).toContain('Verify your email');
    expect(markup).toContain('Verifying your email');
    expect(markup).toContain('Contact administrator');
    expect(markup).toContain('Terms &amp; Conditions');
    expect(markup).toContain('Privacy Policy');
  });
});
