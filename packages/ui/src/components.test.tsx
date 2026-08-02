import { Home } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, SidebarNavigation } from './components';

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

  it('renders the desktop header title and matching user menu', () => {
    const markup = renderToStaticMarkup(
      <AppShell navigation={navigation} title="Platform operations" userEmail="admin@example.com">
        <p>Dashboard content</p>
      </AppShell>,
    );

    expect(markup).toContain('Platform operations');
    expect(markup).toContain('admin@example.com');
    expect(markup).toContain('<button');
    expect(markup).toContain('Log out');
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

  it('defaults the brand link to /platform but lets a consumer override it', () => {
    const defaultMarkup = renderToStaticMarkup(<SidebarNavigation items={navigation} />);
    expect(defaultMarkup).toContain('href="/platform" aria-label="MUST Hotel home"');

    const overriddenMarkup = renderToStaticMarkup(
      <SidebarNavigation homeHref="/dashboard" items={navigation} />,
    );
    expect(overriddenMarkup).toContain('href="/dashboard" aria-label="MUST Hotel home"');
  });
});
