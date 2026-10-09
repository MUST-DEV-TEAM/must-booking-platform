'use client';

import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  Palette,
  Receipt,
  Tags,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from './_lib/utils';
import { Badge } from './_ui/badge';

type DesignNavItem = { href: string; label: string; icon: typeof Palette; ready: boolean };

export const designNavigation: readonly DesignNavItem[] = [
  { href: '/design', label: 'Components', icon: Palette, ready: true },
  { href: '/design/overview', label: 'Overview', icon: LayoutDashboard, ready: false },
  { href: '/design/reservations', label: 'Reservations', icon: ListChecks, ready: false },
  { href: '/design/booking', label: 'Booking detail', icon: Receipt, ready: false },
  { href: '/design/availability', label: 'Availability', icon: CalendarDays, ready: false },
  { href: '/design/rates', label: 'Rates', icon: Tags, ready: false },
];

export function DesignShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="design-root flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card px-3 py-5 lg:flex">
        <div className="flex items-center gap-2 px-2 pb-6">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BedDouble className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="font-extrabold">MUST</div>
            <div className="text-xs text-muted-foreground">Design preview</div>
          </div>
        </div>
        <nav aria-label="Design preview" className="flex flex-1 flex-col gap-1">
          {designNavigation.map(({ href, label, icon: Icon, ready }) => {
            const current = pathname === href;
            const content = (
              <>
                <Icon className="size-4" />
                <span className="flex-1">{label}</span>
                {ready ? null : <Badge variant="muted">Soon</Badge>}
              </>
            );
            const classes = cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold',
              current ? 'bg-secondary text-primary' : 'text-muted-foreground',
              ready ? 'hover:bg-muted hover:text-foreground' : 'cursor-default opacity-70',
            );
            return ready ? (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={classes}
              >
                {content}
              </Link>
            ) : (
              <span key={href} className={classes} aria-disabled="true">
                {content}
              </span>
            );
          })}
        </nav>
        {/* A full page load, so this page's Tailwind styles don't carry over to the live app. */}
        <a
          href="/platform"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to platform
        </a>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b bg-card px-4 py-3 lg:hidden">
          <span className="font-extrabold">
            MUST <span className="font-medium text-muted-foreground">Design preview</span>
          </span>
          <a href="/platform" className="text-sm font-semibold text-primary">
            Back to platform
          </a>
        </header>
        <main className="px-4 py-6 sm:px-8 lg:px-10 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
