'use client';

import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  LayoutDashboard,
  Monitor,
  MousePointerClick,
  ListChecks,
  PanelLeft,
  Palette,
  Receipt,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  Tags,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from './_lib/utils';
import { Badge } from './_ui/badge';
import { Tabs, TabsList, TabsTrigger } from './_ui/tabs';
import { ThemeSwitcher } from './_ui/theme-switcher';

type DesignNavItem = { href: string; label: string; icon: typeof Palette; ready: boolean };

export const designNavigation: readonly DesignNavItem[] = [
  { href: '/design', label: 'Components', icon: Palette, ready: true },
  { href: '/design/navigation', label: 'Navigation', icon: PanelLeft, ready: true },
  { href: '/design/actions', label: 'Actions', icon: MousePointerClick, ready: true },
  { href: '/design/forms', label: 'Forms & filters', icon: SlidersHorizontal, ready: true },
  { href: '/design/overview', label: 'Overview', icon: LayoutDashboard, ready: false },
  { href: '/design/reservations', label: 'Reservations', icon: ListChecks, ready: false },
  { href: '/design/booking', label: 'Booking detail', icon: Receipt, ready: false },
  { href: '/design/availability', label: 'Availability', icon: CalendarDays, ready: false },
  { href: '/design/rates', label: 'Rates', icon: Tags, ready: false },
];

const viewportOptions = [
  { value: 'desktop', label: 'Desktop', width: 1440, icon: Monitor },
  { value: 'tablet', label: 'Tablet', width: 768, icon: Tablet },
  { value: 'mobile', label: 'Mobile', width: 390, icon: Smartphone },
] as const;

type PreviewViewport = (typeof viewportOptions)[number]['value'];

export function DesignShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isShowcase = pathname === '/design';
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const selectedViewport = viewportOptions.find((option) => option.value === viewport)!;

  useEffect(() => {
    if (!isShowcase) {
      delete document.documentElement.dataset.previewViewport;
      return;
    }

    document.documentElement.dataset.previewViewport = viewport;
    return () => {
      delete document.documentElement.dataset.previewViewport;
    };
  }, [isShowcase, viewport]);

  return (
    <div className={isShowcase ? 'design-preview-stage' : undefined}>
      <div
        className={cn(
          'design-preview-viewport @container/design-preview',
          isShowcase ? 'mx-auto' : 'w-full',
        )}
        style={isShowcase ? { width: `${selectedViewport.width}px` } : undefined}
        data-preview-viewport={isShowcase ? viewport : undefined}
      >
        {isShowcase ? (
          <section className="flex flex-col gap-3 border-b bg-card px-4 py-4 @sm/design-preview:flex-row @sm/design-preview:items-end @sm/design-preview:justify-between">
            <div className="space-y-1">
              <h1 className="text-xl font-extrabold tracking-tight">Dashboard preview</h1>
              <p className="text-sm text-muted-foreground">
                Switch the full page between desktop, tablet, and mobile widths.
              </p>
            </div>
            <Tabs
              value={viewport}
              onValueChange={(value) => {
                if (viewportOptions.some((option) => option.value === value)) {
                  setViewport(value as PreviewViewport);
                }
              }}
            >
              <TabsList aria-label="Preview size" className="h-10 w-full @sm/design-preview:w-fit">
                {viewportOptions.map(({ value, label, icon: Icon }) => (
                  <TabsTrigger key={value} value={value} className="px-3 @sm/design-preview:px-4">
                    <Icon aria-hidden="true" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </section>
        ) : null}

        <div className="design-root @container/design-preview flex">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card px-3 py-5 @lg/design-preview:flex">
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
            <ThemeSwitcher className="mb-2 w-full" />
            <a
              href="/design"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to components
            </a>
          </aside>
          <div className="min-w-0 flex-1">
            <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b bg-card px-4 py-3 @lg/design-preview:hidden">
              <span className="min-w-0 font-extrabold">
                MUST{' '}
                <span className="hidden font-medium text-muted-foreground @sm/design-preview:inline">
                  Design preview
                </span>
              </span>
              <div className="flex w-full items-center gap-3 @sm/design-preview:w-auto">
                <ThemeSwitcher className="w-full @sm/design-preview:w-40" />
                <a href="/design" className="shrink-0 text-sm font-semibold text-primary">
                  <span className="@sm/design-preview:hidden">Components</span>
                  <span className="hidden @sm/design-preview:inline">Back to components</span>
                </a>
              </div>
            </header>
            <main className="px-4 py-6 @sm/design-preview:px-8 @lg/design-preview:px-10 @lg/design-preview:py-8">
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
