import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ForgotPasswordPage from './page';

describe('Forgot password page', () => {
  it('renders the shared auth shell and recovery form', () => {
    const markup = renderToStaticMarkup(createElement(ForgotPasswordPage));

    expect(markup).toContain('Run every stay');
    expect(markup).toContain('Forgot password?');
    expect(markup).toContain('SECURE ACCOUNT RECOVERY');
    expect(markup).toContain('Send reset link');
    expect(markup).toContain('Privacy-safe recovery');
    expect(markup).toContain('Terms &amp; Conditions');
    expect(markup).toContain('Privacy Policy');
  });
});
