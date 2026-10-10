import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from '../_ui/button';
import ActionsDesignPage from './page';

describe('Actions design', () => {
  it('shows every variant in every state, role toolbars and the safety table', () => {
    const markup = renderToStaticMarkup(<ActionsDesignPage />);
    for (const heading of [
      'Buttons',
      'Icon buttons',
      'Split button',
      'Bulk toolbar',
      'Permission and action safety',
    ]) {
      expect(markup).toContain(`>${heading}</h2>`);
    }
    for (const role of ['Platform admin', 'Hotel staff', 'Finance staff', 'Booking agent']) {
      expect(markup).toContain(role);
    }
    expect(markup).toContain('Customer dashboard boundary');
    expect(markup).not.toContain('EBR-');
  });

  it('disables a loading button and marks it busy', () => {
    const markup = renderToStaticMarkup(<Button loading>Saving</Button>);
    expect(markup).toContain('disabled');
    expect(markup).toContain('aria-busy="true"');
  });
});
