'use client';

import {
  Activity,
  CalendarDays,
  ChartColumn,
  LayoutDashboard,
  Layers,
  Monitor,
  MousePointerClick,
  ListChecks,
  PanelLeft,
  PanelsTopLeft,
  Palette,
  Receipt,
  SlidersHorizontal,
  Smartphone,
  Table2,
  Tablet,
  Tags,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import {
  MobileDrawerPanel,
  navByRole,
  NotificationTrigger,
  Sidebar,
  TopHeader,
  UserMenuTrigger,
  type NavEntry,
} from './_ui/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '../../components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ThemeSwitcher } from './_ui/theme-switcher';

type DesignNavItem = { href: string; label: string; icon: typeof Palette; ready: boolean };

export const designNavigation: readonly DesignNavItem[] = [
  { href: '/design/overview', label: 'Overview', icon: LayoutDashboard, ready: true },
  { href: '/design', label: 'Components', icon: Palette, ready: true },
  { href: '/design/navigation', label: 'Navigation', icon: PanelLeft, ready: true },
  { href: '/design/actions', label: 'Actions', icon: MousePointerClick, ready: true },
  { href: '/design/forms', label: 'Forms & filters', icon: SlidersHorizontal, ready: true },
  { href: '/design/tables', label: 'Data Tables', icon: Table2, ready: true },
  { href: '/design/cards', label: 'Cards & panels', icon: PanelsTopLeft, ready: true },
  { href: '/design/overlays', label: 'Overlays & contextual UI', icon: Layers, ready: true },
  { href: '/design/timeline', label: 'Booking timeline', icon: Activity, ready: true },
  { href: '/design/charts', label: 'Charts & Analytics', icon: ChartColumn, ready: true },
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
type PreviewMode = 'app' | 'components';

type DesignPreviewContextValue = {
  dashboardName: string;
};

const DesignPreviewContext = createContext<DesignPreviewContextValue | null>(null);

export function useDesignPreviewContext() {
  const value = useContext(DesignPreviewContext);
  if (!value) throw new Error('useDesignPreviewContext must be used inside the design preview.');
  return value;
}

const previewRouteByBusinessSection: Record<string, string> = {
  dashboard: '/design/overview',
  bookings: '/design/tables',
  calendar: '/design/forms',
  hotels: '/design/cards',
  inventory: '/design/cards',
  payments: '/design/tables',
  events: '/design/timeline',
  staff: '/design/tables',
  reports: '/design/charts',
  settings: '/design/forms',
};

const businessSectionByPreviewRoute: Record<string, string> = {
  '/design': 'dashboard',
  '/design/overview': 'dashboard',
  '/design/navigation': 'dashboard',
  '/design/actions': 'bookings',
  '/design/forms': 'calendar',
  '/design/tables': 'bookings',
  '/design/cards': 'hotels',
  '/design/overlays': 'bookings',
  '/design/timeline': 'events',
  '/design/charts': 'reports',
};

const titleByPreviewRoute: Record<string, string> = {
  '/design': 'Components',
  '/design/overview': 'Main Dashboard',
  '/design/navigation': 'Navigation',
  '/design/actions': 'Actions',
  '/design/forms': 'Forms & filters',
  '/design/tables': 'Data Tables',
  '/design/cards': 'Cards & panels',
  '/design/overlays': 'Overlays & contextual UI',
  '/design/timeline': 'Booking timeline',
  '/design/charts': 'Charts & Analytics',
};

const componentNavItems: NavEntry[] = designNavigation
  .filter(({ href }) => href !== '/design/overview')
  .filter(({ ready }) => ready)
  .map(({ href, label, icon }) => ({
    id: href === '/design' ? 'components' : href.slice('/design/'.length),
    label,
    icon,
  }));

function PreviewModeSwitch({
  mode,
  onChange,
}: {
  mode: PreviewMode;
  onChange: (mode: PreviewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Preview area"
      className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/60 p-1"
    >
      {(
        [
          ['app', LayoutDashboard, 'App'],
          ['components', Palette, 'Components'],
        ] as const
      ).map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            'flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
            mode === value
              ? 'bg-card text-primary shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function DesignPreviewMenu({
  floating = false,
  mode,
  onModeChange,
  viewport,
  onViewportChange,
}: {
  floating?: boolean;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  viewport: PreviewViewport;
  onViewportChange: (viewport: PreviewViewport) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="default"
          size="icon"
          aria-label="Preview settings"
          title="Preview settings"
          className={cn('size-11 rounded-full shadow-md', !floating && 'mx-auto')}
        >
          <Palette aria-hidden="true" className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={floating ? 'top' : 'right'}
        align={floating ? 'start' : 'end'}
        sideOffset={12}
        className="max-h-[calc(100vh-2rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-2"
      >
        <div className="px-2 pb-3 pt-1">
          <p className="text-sm font-bold">Preview settings</p>
          <p className="text-xs text-muted-foreground">Choose an area, screen size and theme.</p>
        </div>
        <div className="border-t px-2 py-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Preview area</p>
          <PreviewModeSwitch mode={mode} onChange={onModeChange} />
        </div>
        <div className="border-t px-2 py-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Screen size</p>
          <Tabs
            value={viewport}
            onValueChange={(value) => {
              if (viewportOptions.some((option) => option.value === value)) {
                onViewportChange(value as PreviewViewport);
              }
            }}
          >
            <TabsList aria-label="Preview size" className="grid h-10 w-full grid-cols-3">
              {viewportOptions.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="gap-1 px-1 text-xs">
                  <Icon aria-hidden="true" className="size-3.5" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="border-t px-2 pt-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Preview theme</p>
          <ThemeSwitcher className="w-full" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DesignShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mode, setMode] = useState<PreviewMode>(
    pathname === '/design/overview' ? 'app' : 'components',
  );
  const activeMode: PreviewMode =
    pathname === '/design/overview' ? 'app' : pathname === '/design' ? 'components' : mode;
  const selectedViewport = viewportOptions.find((option) => option.value === viewport)!;
  const currentBusinessSection = businessSectionByPreviewRoute[pathname] ?? 'dashboard';
  const currentComponentId =
    pathname === '/design' ? 'components' : pathname.slice('/design/'.length);
  const dashboardName = 'Main Dashboard';
  const headerTitle = titleByPreviewRoute[pathname] ?? 'Dashboard';

  function navigateToBusinessSection(section: string) {
    const href = previewRouteByBusinessSection[section];
    if (href) {
      setMode('app');
      router.push(href);
    }
    setMobileMenuOpen(false);
  }

  function navigateToComponent(id: string) {
    const item = componentNavItems.find((entry) => entry.id === id);
    if (!item) return;
    const href = id === 'components' ? '/design' : `/design/${id}`;
    setMode('components');
    router.push(href);
    setMobileMenuOpen(false);
  }

  function switchMode(nextMode: PreviewMode) {
    setMode(nextMode);
    router.push(nextMode === 'app' ? '/design/overview' : '/design');
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    document.documentElement.dataset.previewViewport = viewport;
    return () => {
      delete document.documentElement.dataset.previewViewport;
    };
  }, [viewport]);

  useEffect(() => {
    const markKeyboardNavigation = (event: KeyboardEvent) => {
      if (
        ['Tab', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter', ' '].includes(event.key)
      ) {
        document.documentElement.dataset.inputModality = 'keyboard';
      }
    };
    const markPointerNavigation = () => {
      document.documentElement.dataset.inputModality = 'pointer';
    };

    document.addEventListener('keydown', markKeyboardNavigation, true);
    document.addEventListener('pointerdown', markPointerNavigation, true);
    return () => {
      document.removeEventListener('keydown', markKeyboardNavigation, true);
      document.removeEventListener('pointerdown', markPointerNavigation, true);
      delete document.documentElement.dataset.inputModality;
    };
  }, []);

  return pathname === '/design/pokpay-checkout' ? (
    <div className="design-preview-stage min-h-screen">
      <div className="ui-root min-h-screen bg-muted/30">
        <DesignPreviewContext.Provider value={{ dashboardName }}>
          {children}
        </DesignPreviewContext.Provider>
      </div>
    </div>
  ) : (
    <div className="design-preview-stage">
      <div
        className={cn(
          'design-preview-viewport @container/design-preview',
          viewport !== 'desktop' && 'mx-auto',
        )}
        style={{
          width: viewport === 'desktop' ? '100%' : `min(100%, ${selectedViewport.width}px)`,
        }}
        data-preview-viewport={viewport}
      >
        <div className="ui-root @container/design-preview flex min-h-screen">
          <div className="sticky top-0 z-40 hidden h-screen shrink-0 @lg/design-preview:block">
            <Sidebar
              role="admin"
              items={activeMode === 'app' ? navByRole.admin.items : componentNavItems}
              current={activeMode === 'app' ? currentBusinessSection : currentComponentId}
              onSelect={activeMode === 'app' ? navigateToBusinessSection : navigateToComponent}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
              footer={
                <DesignPreviewMenu
                  mode={activeMode}
                  onModeChange={switchMode}
                  viewport={viewport}
                  onViewportChange={setViewport}
                />
              }
              className="h-screen"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopHeader
              title={headerTitle}
              onMenu={() => setMobileMenuOpen(true)}
              menuClassName="@lg/design-preview:hidden"
              className="sticky top-0 z-30 min-h-[68px] shrink-0 bg-card/95 backdrop-blur"
              actions={
                <>
                  <NotificationTrigger count={3} />
                  <UserMenuTrigger role="admin" className="hidden @sm/design-preview:flex" />
                </>
              }
            />
            <main className="min-h-[calc(100vh-68px)] min-w-0 flex-1 bg-muted/30 px-4 py-5 @sm/design-preview:px-6 @lg/design-preview:px-8">
              <DesignPreviewContext.Provider value={{ dashboardName }}>
                {children}
              </DesignPreviewContext.Provider>
            </main>
          </div>
          <div className="fixed bottom-20 left-1 z-40 @lg/design-preview:hidden">
            <DesignPreviewMenu
              floating
              mode={activeMode}
              onModeChange={switchMode}
              viewport={viewport}
              onViewportChange={setViewport}
            />
          </div>
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetContent side="left" hideClose className="w-72 max-w-[90vw] p-0">
              <SheetTitle className="sr-only">Hotel workspace navigation</SheetTitle>
              <MobileDrawerPanel
                role="admin"
                items={activeMode === 'app' ? navByRole.admin.items : componentNavItems}
                current={activeMode === 'app' ? currentBusinessSection : currentComponentId}
                onSelect={activeMode === 'app' ? navigateToBusinessSection : navigateToComponent}
                onClose={() => setMobileMenuOpen(false)}
                className="w-full shadow-none"
              />
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}
