'use client';

import { LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback } from './avatar';
import { Badge } from './badge';
import { Button } from './button';

export type PlatformNavItem = { href: string; label: string; icon: LucideIcon; current?: boolean };

function initials(name: string | null, email: string): string {
  const source = (name?.trim() || email).split(/[\s@.]+/).filter(Boolean);
  return ((source[0]?.[0] ?? '') + (source[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * Frame for the MUST Group platform console: a left menu (a scrolling row on small screens), a top
 * bar with who is signed in and their role, and the page. The console is separate from the hotel
 * dashboard, so it says so in the header.
 */
export function PlatformShell({
  nav,
  user,
  onSignOut,
  children,
}: {
  nav: readonly PlatformNavItem[];
  user: { name: string | null; email: string; roleName: string };
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <aside className="shrink-0 border-b bg-card md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-extrabold text-primary-foreground">
            M
          </span>
          <div className="leading-tight">
            <p className="m-0 text-sm font-extrabold">MUST Group</p>
            <p className="m-0 text-[11px] text-muted-foreground">Platform console</p>
          </div>
        </div>
        <nav
          aria-label="Platform console"
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible"
        >
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap text-muted-foreground no-underline outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4',
                item.current && 'bg-secondary text-foreground',
              )}
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 md:px-6">
          <Badge variant="muted">Staff only · not the hotel dashboard</Badge>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="m-0 text-sm font-semibold">{user.name ?? user.email}</p>
              <p className="m-0 text-[11px] text-muted-foreground">{user.roleName}</p>
            </div>
            <Avatar className="size-8">
              <AvatarFallback className="text-xs font-bold">
                {initials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
            <Button variant="outline" size="sm" onClick={onSignOut}>
              <LogOut aria-hidden="true" /> Sign out
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[96rem] flex-1 space-y-6 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
