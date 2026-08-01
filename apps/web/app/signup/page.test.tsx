import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import SignupPage from './page';

describe('Signup page', () => {
  it('renders the simplified signup form', () => {
    const markup = renderToStaticMarkup(createElement(SignupPage));

    expect(markup).toContain('Create your workspace');
    expect(markup).toContain('Organization name');
    expect(markup).toContain('First property name');
    expect(markup).not.toContain('Property address');
    expect(markup).not.toContain('Property timezone');
  });
});
