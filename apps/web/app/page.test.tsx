import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import Home from './page';

describe('Home page', () => {
  it('renders all signup fields', () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain('Start using MUST Booking');
    expect(markup).toContain('Organization name');
    expect(markup).toContain('First property name');
    expect(markup).toContain('Property address');
    expect(markup).toContain('Property timezone');
    expect(markup).toContain('Email address');
    expect(markup).toContain('Create free workspace');
  });
});
