import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PrivacyPage from './page';

describe('Privacy page', () => {
  it('renders generic non-legal placeholder copy in the auth shell', () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    expect(markup).toContain('Privacy Policy');
    expect(markup).toContain('not final legal text');
    expect(markup).toContain('Back to login');
  });
});
