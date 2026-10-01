// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Alert, Button } from './components';

describe('Alert', () => {
  it('keeps the plain markup when there is no title or action', () => {
    const markup = renderToStaticMarkup(<Alert tone="info">Saved.</Alert>);

    expect(markup).toContain('>Saved.</div>');
    expect(markup).not.toContain('must-alert--structured');
  });

  it('puts the title above a smaller description, with the action on its own side', () => {
    const markup = renderToStaticMarkup(
      <Alert
        action={<Button>View status</Button>}
        title="Payment provider unavailable"
        tone="warning"
      >
        New card payments are paused until it recovers.
      </Alert>,
    );

    expect(markup).toContain('must-alert--structured');
    expect(markup).toMatch(
      /must-alert__content.*must-alert__title.*Payment provider unavailable.*must-alert__body.*New card payments/s,
    );
    expect(markup).toMatch(/must-alert__action.*View status/s);
  });

  it('renders a title-only alert without an action wrapper', () => {
    const markup = renderToStaticMarkup(
      <Alert title="Heads up" tone="danger">
        Something needs attention.
      </Alert>,
    );

    expect(markup).toContain('must-alert__title');
    expect(markup).not.toContain('must-alert__action');
    expect(markup).toContain('role="alert"');
  });
});
