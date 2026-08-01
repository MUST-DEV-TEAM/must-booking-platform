import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ResetPasswordPage from './page';

describe('Reset password page', () => {
  it('renders the shared auth shell and password form', () => {
    const markup = renderToStaticMarkup(createElement(ResetPasswordPage));

    expect(markup).toContain('Run every stay');
    expect(markup).toContain('Secure your account.');
    expect(markup).toContain('CREATE NEW PASSWORD');
    expect(markup).toContain('New password');
    expect(markup).toContain('Confirm new password');
    expect(markup).toContain('Reset password');
    expect(markup).toContain('Cancel and return to sign in');
  });
});
