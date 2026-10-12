import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedNavigation = vi.hoisted(() => ({ usePathname: vi.fn(() => '/design') }));

vi.mock('next/navigation', () => mockedNavigation);

import { DesignShell } from './design-shell';
import DesignShowcasePage, { DesignShowcaseContent } from './page';

describe('Design showcase', () => {
  beforeEach(() => {
    mockedNavigation.usePathname.mockReturnValue('/design');
  });

  it('renders device controls around the single responsive design shell', () => {
    const markup = renderToStaticMarkup(
      <DesignShell>
        <DesignShowcasePage />
      </DesignShell>,
    );

    expect(markup).toContain('>Desktop</button>');
    expect(markup).toContain('>Tablet</button>');
    expect(markup).toContain('>Mobile</button>');
    expect(markup).toContain('data-preview-viewport="desktop"');
    expect(markup).toContain('aria-label="Design preview"');
    expect(markup).not.toContain('<iframe');
    expect(markup).not.toContain('previewFrame');
    expect(markup.match(/class="[^"]*design-root/g)).toHaveLength(1);
  });

  it('renders the neutral palette and organized status examples with demo data only', () => {
    const markup = renderToStaticMarkup(<DesignShowcaseContent />);

    for (const heading of [
      'Colors',
      'Typography',
      'Badges and statuses',
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
    expect(markup).not.toContain('>Form controls</h2>');
    expect(markup).toContain('Partially refunded');
    expect(markup).toContain('Provider / PMS');
    expect(markup).toContain('aria-label="Loading booking card"');
    expect(markup).toContain('aria-label="Loading booking table"');
    expect(markup).toContain('aria-label="Loading booking detail panel"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('design-progress-indeterminate');
    expect(markup).not.toContain('>Buttons</h2>');
    expect(markup).not.toContain('Responsive behavior');
    expect(markup).not.toContain('design-color-variant');
    expect(markup).not.toContain('>Pine</h3>');
    expect(markup).toContain('MH-1042');
    expect(markup).not.toContain('EBR-');
  });

  it('links only to ready preview pages and leaves the live app with a full page load', () => {
    mockedNavigation.usePathname.mockReturnValue('/design/navigation');
    const markup = renderToStaticMarkup(
      <DesignShell>
        <p>child</p>
      </DesignShell>,
    );

    expect(markup).toContain('href="/design"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('href="/design/overview"');
    expect(markup).not.toContain('href="/dashboard');
    expect(markup).not.toContain('href="/platform"');
    expect(markup).toContain('<p>child</p>');
  });
});
