import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import Home from './page';

describe('Home page', () => {
  it('renders the MUST Booking placeholder', () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toContain('MUST Booking');
    expect(markup).toContain('Tenant administration dashboard placeholder.');
  });
});
