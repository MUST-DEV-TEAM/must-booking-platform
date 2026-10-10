import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/design/navigation' }));

import { DesignShell } from './design-shell';
import DesignShowcasePage, { DesignShowcaseContent } from './page';

describe('Design showcase', () => {
  it('renders page-wide viewport controls at the top-level design route', () => {
    const markup = renderToStaticMarkup(<DesignShowcasePage />);

    expect(markup).toContain('>Desktop</button>');
    expect(markup).toContain('>Tablet</button>');
    expect(markup).toContain('>Mobile</button>');
    expect(markup).toContain('title="MUST dashboard preview · Desktop"');
    expect(markup).toContain('src="/design?previewFrame=1"');
  });

  it('renders the neutral palette and organized status examples with demo data only', () => {
    const markup = renderToStaticMarkup(<DesignShowcaseContent />);

    for (const heading of [
      'Colors',
      'Typography',
      'Badges and statuses',
      'Form controls',
      'Cards and stats',
      'Table',
      'Tabs',
      'Dialogs and menus',
    ]) {
      expect(markup).toContain(`>${heading}</h2>`);
    }
    for (const heading of [
      'Message components',
      'Toast notifications',
      'Progress bars',
      'Loading and processing',
      'Booking skeletons',
      'Empty and recovery states',
    ]) {
      expect(markup).toContain(`>${heading}</h3>`);
    }
    expect(markup).toContain('Alert banner</h4>');
    expect(markup).toContain('Inline alert</h4>');
    expect(markup).toContain('--primary');
    expect(markup).toContain('#18181b');
    expect(markup).toContain('--success');
    expect(markup).toContain('Inventory conflict');
    expect(markup).toContain('Partially refunded');
    expect(markup).toContain('Provider / PMS');
    expect(markup).not.toContain('>Buttons</h2>');
    expect(markup).not.toContain('Responsive behavior');
    expect(markup).not.toContain('design-color-variant');
    expect(markup).not.toContain('>Pine</h3>');
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
