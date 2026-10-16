'use client';

import { ChevronDown, ChevronsLeft, LogOut, Menu, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/utils';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';

/**
 * Application shell for the redesigned UI: collapsible sidebar (slide-over below 1024px), page
 * header with an account menu, and the content area. Same inputs as the legacy @must/ui AppShell
 * so a screen can switch by changing one import. Navigation items are plain links: every
 * destination is a full page load, as before.
 */

export type AppNavigationItem = {
  href: string;
  label: string;
  current?: boolean;
  icon?: LucideIcon;
  /** A count shown on the item (for example bookings that need attention). Hidden when 0. */
  badge?: number;
};

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border-2 border-primary bg-card text-primary">
        <svg aria-hidden="true" viewBox="0 0 40 40" className="size-7">
          <path
            d="M7 33V10.5C7 8.6 8.6 7 10.5 7h19c1.9 0 3.5 1.6 3.5 3.5V33"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="m12 27 8-11 8 11M20 16v17"
            fill="none"
            className="stroke-brass"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {compact ? null : (
        <div className="leading-tight">
          <div className="font-extrabold">MUST Hotel</div>
          <div className="text-xs text-muted-foreground">Reservation operations</div>
        </div>
      )}
    </div>
  );
}

async function logOut() {
  await fetch('/api/auth/logout', { credentials: 'include', method: 'POST' }).catch(
    () => undefined,
  );
  window.location.href = '/';
}

function initialsFromEmail(email: string | undefined) {
  const local = email?.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]?.[0], parts[1]?.[0]] : [local[0], local[1]];
  return (
    letters
      .filter((letter): letter is string => Boolean(letter))
      .join('')
      .toUpperCase() || '?'
  );
}

function NavLink({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: AppNavigationItem;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      aria-current={item.current ? 'page' : undefined}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-semibold text-muted-foreground no-underline outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        item.current && 'bg-secondary text-primary hover:bg-secondary hover:text-primary',
        collapsed && 'justify-center px-0',
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {item.badge ? (
        <span
          className={cn(
            'flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-5 font-bold text-primary-foreground',
            collapsed && 'absolute top-0.5 right-0.5 min-w-4 px-1 text-[10px] leading-4',
          )}
          aria-label={`${item.badge} need attention`}
        >
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
    </a>
  );
}

function NavList({
  items,
  collapsed,
  onNavigate,
}: {
  items: readonly AppNavigationItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto">
      {items.map((item) => (
        <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

function LogOutButton({ collapsed }: { collapsed?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Log out"
      onClick={() => void logOut()}
      className={cn(
        'flex w-full items-center gap-3 rounded-md bg-transparent px-3 py-2 text-sm font-semibold text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        collapsed && 'justify-center px-0',
      )}
    >
      <LogOut aria-hidden="true" className="size-4" />
      {collapsed ? null : 'Log out'}
    </button>
  );
}

export type AccountLink = { label: string; href: string };

export function AccountMenu({
  email,
  role,
  links = [],
  className,
}: {
  email?: string;
  role?: string;
  /** Pages listed in the menu above Log out (for example Profile, Settings). */
  links?: readonly AccountLink[];
  className?: string;
}) {
  const name = email ?? 'Signed-in user';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className={cn(
            'flex h-10 items-center gap-2 rounded-md border bg-card px-3 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
            className,
          )}
        >
          <Avatar className="size-6">
            <AvatarFallback className="text-[10px]">{initialsFromEmail(email)}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 leading-none sm:block">
            <span className="block max-w-44 truncate text-[13px] leading-4 font-bold">{name}</span>
            {role ? (
              <span className="mt-0.5 block truncate text-[11px] leading-3 text-muted-foreground">
                {role}
              </span>
            ) : null}
          </span>
          <ChevronDown aria-hidden="true" className="hidden size-4 text-muted-foreground sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
        {links.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <a href={link.href}>{link.label}</a>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void logOut()}>
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  navigation,
  title,
  userEmail,
  userRole,
  homeHref = '/dashboard',
  headerActions,
  accountLinks,
  children,
}: {
  navigation: readonly AppNavigationItem[];
  title: string;
  userEmail?: string;
  userRole?: string;
  homeHref?: string;
  headerActions?: ReactNode;
  accountLinks?: readonly AccountLink[];
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Publishes the real header height so sticky table headers sit directly under it.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--app-header-height', `${header.offsetHeight}px`);
    publish();
    // Without ResizeObserver the height is still published once; it just does not follow resizes.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(header);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--app-header-height');
    };
  }, []);

  // The theme hides focus outlines while the mouse is in use and keeps them for keyboard users.
  useEffect(() => {
    const root = document.documentElement;
    const keyboard = (event: KeyboardEvent) => {
      if (['Tab', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter', ' '].includes(event.key))
        root.dataset.inputModality = 'keyboard';
    };
    const pointer = () => {
      root.dataset.inputModality = 'pointer';
    };
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('pointerdown', pointer, true);
      delete root.dataset.inputModality;
    };
  }, []);


  return (
    <div className="flex min-h-screen">
      <a
        href="#app-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-md"
      >
        Skip to main content
      </a>
      <div className="sticky top-0 z-40 hidden h-screen shrink-0 lg:block">
        <aside
          className={cn(
            'relative flex h-screen flex-col gap-4 border-r bg-card p-3 transition-[width] duration-200',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          <div className={cn('flex min-h-10 items-center px-1 pt-1', collapsed && 'justify-center')}>
            <a
              href={homeHref}
              aria-label="MUST Hotel home"
              className="rounded-md text-inherit no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Brand compact={collapsed} />
            </a>
          </div>
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
            className="absolute top-6 -right-3 z-50 size-6 rounded-full bg-card shadow-xs"
          >
            <ChevronsLeft
              aria-hidden="true"
              className={cn('size-3.5 transition-transform', collapsed && 'rotate-180')}
            />
          </IconButton>
          <NavList items={navigation} collapsed={collapsed} />
          <div className="border-t pt-3">
            <LogOutButton collapsed={collapsed} />
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header ref={headerRef} className="sticky top-0 z-30 flex min-h-[68px] shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
          <h2 className="min-w-0 flex-[1_1_12rem] truncate text-xl font-extrabold tracking-tight">
            {title}
          </h2>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            {headerActions}
            <AccountMenu email={userEmail} role={userRole} links={accountLinks} />
            <Button
              variant="outline"
              size="icon"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden"
            >
              <Menu />
            </Button>
          </div>
        </header>
        <main
          id="app-main-content"
          tabIndex={-1}
          className="min-h-[calc(100vh-68px)] min-w-0 flex-1 bg-muted/30 px-4 py-5 outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" hideClose className="w-72 max-w-[90vw] p-0">
          <SheetTitle className="sr-only">Hotel workspace navigation</SheetTitle>
          <div className="flex h-full flex-col gap-4 bg-card p-3">
            <div className="flex items-center justify-between px-1 pt-1">
              <a href={homeHref} aria-label="MUST Hotel home" className="text-inherit no-underline">
                <Brand />
              </a>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
              >
                <X />
              </Button>
            </div>
            <NavList items={navigation} onNavigate={() => setDrawerOpen(false)} />
            <div className="border-t pt-3">
              <LogOutButton />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
