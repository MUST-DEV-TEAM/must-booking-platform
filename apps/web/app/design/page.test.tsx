import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/design' }));

import { DesignShell } from './design-shell';
import DesignShowcasePage from './page';

describe('Design showcase', () => {
  it('renders every component section with demo bookings only', () => {
    const markup = renderToStaticMarkup(<DesignShowcasePage />);

    for (const heading of [
      'Colors',
      'Typography',
      'Buttons',
      'Badges and statuses',
      'Form controls',
      'Cards and stats',
      'Alerts',
      'Table',
      'Tabs',
      'Dialogs and menus',
      'Loading and empty states',
    ]) {
      expect(markup).toContain(`>${heading}</h2>`);
    }
    expect(markup).toContain('MH-1042');
    expect(markup).not.toContain('EBR-');
  });

  it('links only to ready preview pages and leaves the live app with a full page load', () => {
    const markup = renderToStaticMarkup(
      <DesignShell>
        <p>child</p>
      </DesignShell>,
    );

    expect(markup).toContain('href="/design"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('href="/design/overview"');
    expect(markup).not.toContain('href="/dashboard');
    expect(markup).toContain('href="/platform"');
    expect(markup).toContain('<p>child</p>');
  });
});
