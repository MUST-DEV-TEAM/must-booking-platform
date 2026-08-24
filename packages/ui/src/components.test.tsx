// @vitest-environment jsdom
import { Home } from 'lucide-react';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AppShell,
  NavigationPagination,
  NavigationSectionTabBar,
  NavigationSectionTabItem,
  SidebarNavigation,
} from './components';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigation = [{ href: '/platform', label: 'Dashboard', icon: Home, current: true }] as const;
const mobileNavigation = [
  { href: '/dashboard', label: 'Dashboard', current: true },
  { href: '/dashboard/bookings', label: 'Bookings' },
  { href: '/dashboard/calendar', label: 'Calendar' },
  { href: '/dashboard/settings', label: 'Settings' },
] as const;
const fullMobileNavigation = [
  ...mobileNavigation,
  { href: '/dashboard/payments', label: 'Payments' },
  { href: '/dashboard/guests', label: 'Guests' },
  { href: '/dashboard/accommodations', label: 'Accommodations' },
  { href: '/dashboard/rates-pricing', label: 'Rates & Pricing' },
  { href: '/dashboard/staff', label: 'Staff' },
  { href: '/dashboard/reports', label: 'Reports' },
] as const;

describe('dashboard shell', () => {
  it('renders a navigation icon when one is supplied', () => {
    const markup = renderToStaticMarkup(
      <SidebarNavigation items={navigation} userEmail="admin@example.com" />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<svg');
    expect(markup).toContain('aria-label="Dashboard"');
  });

  it('renders the MUST Hotel brand and profile footer with a logout button', () => {
    const markup = renderToStaticMarkup(
      <SidebarNavigation items={navigation} userEmail="admin@example.com" />,
    );

    expect(markup).toContain('MUST Hotel');
    expect(markup).toContain('/auth/portal-m-mark.svg');
    expect(markup).toContain('admin@example.com');
    expect(markup).toContain('<button');
    expect(markup).toContain('Log out');
  });

  it('renders the desktop header title and a closed account menu trigger', () => {
    const markup = renderToStaticMarkup(
      <AppShell
        navigation={navigation}
        title="Platform operations"
        userEmail="admin@example.com"
        userRole="Admin"
      >
        <p>Dashboard content</p>
      </AppShell>,
    );

    expect(markup).toContain('Platform operations');
    expect(markup).toContain('admin@example.com');
    expect(markup).toContain('Admin');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('must-account-menu__dropdown');
  });

  it('renders the skip link before the shell and exposes its main target', () => {
    const markup = renderToStaticMarkup(
      <AppShell navigation={navigation} title="Platform operations">
        <p>Dashboard content</p>
      </AppShell>,
    );

    expect(markup.indexOf('class="must-skip-link"')).toBeLessThan(
      markup.indexOf('class="must-sidebar-navigation must-app-shell__sidebar"'),
    );
    expect(markup).toContain('href="#must-main-content"');
    expect(markup).toContain('id="must-main-content"');
    expect(markup).toContain('tabindex="-1"');
  });

  it('keeps the skip link and main target keyboard reachable', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(AppShell, {
          navigation,
          title: 'Platform operations',
          children: createElement('p', null, 'Dashboard content'),
        }),
      );
    });

    const skipLink = container.querySelector('.must-skip-link') as HTMLAnchorElement;
    const main = container.querySelector('#must-main-content') as HTMLElement;
    await act(async () => skipLink.focus());

    expect(document.activeElement).toBe(skipLink);
    expect(main.tabIndex).toBe(-1);
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders section tabs as linkable navigation with an active state', () => {
    const markup = renderToStaticMarkup(
      <NavigationSectionTabBar>
        <NavigationSectionTabItem href="/dashboard?t=overview" label="Overview" current />
        <NavigationSectionTabItem href="/dashboard?t=needs-attention" label="Needs Attention" />
      </NavigationSectionTabBar>,
    );

    expect(markup).toContain('aria-label="Dashboard tabs"');
    expect(markup).toContain('href="/dashboard?t=overview"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('Needs Attention');
  });

  it('renders paginated navigation with the current page and bounded controls', () => {
    const markup = renderToStaticMarkup(
      <NavigationPagination page={2} pageSize={20} total={45} onPageChange={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Pagination"');
    expect(markup).toContain('Page 2 of 3');
    expect(markup).toContain('>Previous</button>');
    expect(markup).toContain('>Next</button>');
  });

  it('renders supplied header actions in the shared header chrome', () => {
    const markup = renderToStaticMarkup(
      <AppShell
        headerActions={<button type="button">Notifications</button>}
        navigation={navigation}
        title="Platform operations"
      >
        <p>Dashboard content</p>
      </AppShell>,
    );

    expect(markup).toContain('must-app-shell__header-actions');
    expect(markup).toContain('Notifications');
  });

  it('renders mobile bottom navigation and a drawer trigger', () => {
    const markup = renderToStaticMarkup(
      <AppShell homeHref="/dashboard" navigation={mobileNavigation} title="Grand Hotel">
        <p>Dashboard content</p>
      </AppShell>,
    );

    expect(markup).toContain('aria-label="Mobile navigation"');
    expect(markup).toContain('>Home</span>');
    expect(markup).toContain('>Bookings</span>');
    expect(markup).toContain('>Calendar</span>');
    expect(markup).toContain('>More</span>');
    expect(markup).toContain('aria-label="Open navigation"');
  });

  it('opens the full navigation drawer from the mobile More action', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(AppShell, {
          homeHref: '/dashboard',
          navigation: fullMobileNavigation,
          title: 'Grand Hotel',
          children: createElement('p', null, 'Dashboard content'),
        }),
      );
    });

    const more = container.querySelector(
      '.must-mobile-bottom-navigation button[aria-label="More navigation"]',
    ) as HTMLButtonElement;
    await act(async () => {
      more.click();
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Close navigation"]')).not.toBeNull();
    expect(
      container.querySelector('[role="dialog"] nav[aria-label="Main navigation"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector('[role="dialog"] nav[aria-label="Main navigation"] a'),
    );
    const main = container.querySelector('#must-main-content') as HTMLElement;
    const bottomNavigation = container.querySelector(
      '.must-mobile-bottom-navigation',
    ) as HTMLElement;
    expect(main.compareDocumentPosition(bottomNavigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const drawerLinks = Array.from(
      container.querySelectorAll('[role="dialog"] nav[aria-label="Main navigation"] a'),
    );
    expect(drawerLinks).toHaveLength(10);
    expect(drawerLinks.map((link) => link.textContent?.trim())).toEqual(
      fullMobileNavigation.map((item) => item.label),
    );

    await act(async () => {
      (container.querySelector('[aria-label="Close navigation"]') as HTMLButtonElement).click();
    });
    expect(document.activeElement).toBe(
      container.querySelector('.must-mobile-navigation__trigger'),
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it('opens the account menu on click and reveals log out', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(AppShell, {
          navigation,
          title: 'Platform operations',
          userEmail: 'admin@example.com',
          children: createElement('p', null, 'Dashboard content'),
        }),
      );
    });

    const accountMenu = container.querySelector('.must-account-menu') as HTMLElement;
    const trigger = accountMenu.querySelector('.must-account-menu__trigger') as HTMLButtonElement;
    expect(accountMenu.textContent).not.toContain('Log out');

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(accountMenu.textContent).toContain('Log out');
    await act(async () => root.unmount());
  });

  it('defaults the brand link to /platform but lets a consumer override it', () => {
    const defaultMarkup = renderToStaticMarkup(<SidebarNavigation items={navigation} />);
    expect(defaultMarkup).toContain('href="/platform" aria-label="MUST Hotel home"');

    const overriddenMarkup = renderToStaticMarkup(
      <SidebarNavigation homeHref="/dashboard" items={navigation} />,
    );
    expect(overriddenMarkup).toContain('href="/dashboard" aria-label="MUST Hotel home"');
  });
});
