import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import TermsPage from './page';

describe('Terms page', () => {
  it('renders generic non-legal placeholder copy in the auth shell', () => {
    const markup = renderToStaticMarkup(createElement(TermsPage));

    expect(markup).toContain('Terms &amp; Conditions');
    expect(markup).toContain('not final legal text');
    expect(markup).toContain('Back to login');
  });
});
