import { renderToStaticMarkup } from 'react-dom/server';
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedNavigation = vi.hoisted(() => ({ usePathname: vi.fn(() => '/design'), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  ...mockedNavigation,
  useRouter: () => ({ push: mockedNavigation.push }),
}));

import { DesignShell } from './design-shell';
import DesignShowcasePage, { DesignShowcaseContent } from './page';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());

describe('Design showcase', () => {
  beforeEach(() => {
    mockedNavigation.usePathname.mockReturnValue('/design');
  });

  it('changes viewport through the Preview settings popover', async () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    try {
      await act(async () =>
        root.render(
          <DesignShell>
            <DesignShowcasePage />
          </DesignShell>,
        ),
      );
      await act(async () =>
        document.querySelector<HTMLButtonElement>('[aria-label="Preview settings"]')!.click(),
      );
      for (const label of ['Desktop', 'Tablet', 'Mobile']) {
        expect(
          [...document.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent === label),
        ).toBe(true);
      }
      const mobile = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
        (tab) => tab.textContent === 'Mobile',
      )!;
      await act(async () =>
        mobile.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })),
      );
      expect(document.querySelector('[data-preview-viewport="mobile"]')).not.toBeNull();
      expect(document.querySelectorAll('.ui-root')).toHaveLength(1);
      expect(document.querySelector('iframe')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
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
    expect(markup).toContain('ui-progress-indeterminate');
    expect(markup).not.toContain('>Buttons</h2>');
    expect(markup).not.toContain('Responsive behavior');
    expect(markup).not.toContain('design-color-variant');
    expect(markup).not.toContain('>Pine</h3>');
    expect(markup).toContain('MH-1042');
    expect(markup).not.toContain('EBR-');
  });

  it('navigates to ready preview pages using sidebar controls', async () => {
    mockedNavigation.usePathname.mockReturnValue('/design/navigation');
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    try {
      await act(async () =>
        root.render(
          <DesignShell>
            <p>child</p>
          </DesignShell>,
        ),
      );
      const components = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === 'Components',
      )!;
      await act(async () => components.click());
      expect(mockedNavigation.push).toHaveBeenCalledWith('/design');
      expect(document.querySelector('[aria-current="page"]')?.textContent).toContain('Navigation');
      expect(document.body.textContent).toContain('child');
      expect(document.querySelector('a[href^="/dashboard"], a[href="/platform"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
