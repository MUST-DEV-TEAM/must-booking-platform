import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import Home from './page';

describe('Home page', () => {
  it('renders login and signup links in the shared auth shell', () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain('Welcome to MUST Hotel');
    expect(markup).toContain('One protected workspace for your reservation operations.');
    expect(markup).toContain('href="/login"');
    expect(markup).toContain('Login');
    expect(markup).toContain('href="/signup"');
    expect(markup).toContain('Sign up');
  });
});
