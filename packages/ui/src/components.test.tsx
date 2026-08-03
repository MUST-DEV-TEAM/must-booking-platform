// @vitest-environment jsdom
import { Home } from 'lucide-react';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, SidebarNavigation } from './components';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigation = [{ href: '/platform', label: 'Dashboard', icon: Home, current: true }] as const;

describe('dashboard shell', () => {
  it('renders a navigation icon when one is supplied', () => {
    const markup = renderToStaticMarkup(
      <SidebarNavigation items={navigation} userEmail="admin@example.com" />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<svg');
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
