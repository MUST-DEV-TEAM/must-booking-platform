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
      'Responsive behavior',
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
    expect(markup).toContain('>Neutral</h3>');
    expect(markup).toContain('>Pine</h3>');
    expect(markup).toContain('>Ocean</h3>');
    expect(markup).toContain('>Terracotta</h3>');
    expect(markup).toContain('Inventory conflict');
    expect(markup).toContain('Partially refunded');
    expect(markup).toContain('Provider / PMS');
    expect(markup).not.toContain('>Buttons</h2>');
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
    expect(markup).not.toContain('href="/platform"');
    expect(markup).toContain('<p>child</p>');
  });
});
