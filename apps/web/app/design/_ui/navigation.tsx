'use client';

import {
  Bell,
  BedDouble,
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CirclePlus,
  CreditCard,
  FileText,
  Hotel,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Scale,
  Settings,
  Ticket,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../_lib/utils';
import { Avatar, AvatarFallback } from './avatar';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

/**
 * Navigation building blocks for the new dashboard: sidebar by role, mobile drawer, top header,
 * tab bar, breadcrumb, pagination and the notification / user-menu triggers. Icons come from
 * lucide-react like the rest of the app. Demo data only; nothing here reads real permissions.
 */

export type NavRole = 'admin' | 'staff' | 'finance' | 'agent' | 'readonly';

export type NavEntry = {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

const entries = {
  dashboard: { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  bookings: { id: 'bookings', label: 'Bookings', icon: CalendarCheck, badge: 4 },
  calendar: { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  hotels: { id: 'hotels', label: 'Hotels', icon: Hotel },
  inventory: { id: 'inventory', label: 'Inventory', icon: Package },
  payments: { id: 'payments', label: 'Payments', icon: CreditCard },
  events: { id: 'events', label: 'Events', icon: Ticket },
  staff: { id: 'staff', label: 'Staff', icon: Users },
  reports: { id: 'reports', label: 'Reports', icon: ChartColumn },
  settings: { id: 'settings', label: 'Settings', icon: Settings },
  invoices: { id: 'invoices', label: 'Invoices', icon: FileText },
  reconciliation: { id: 'reconciliation', label: 'Reconciliation', icon: Scale },
  manualBooking: { id: 'manual-booking', label: 'Manual Booking', icon: CirclePlus },
} satisfies Record<string, NavEntry>;

/** Which destinations each role sees. Mirrors the permission-aware nav in the design. */
export const navByRole: Record<NavRole, { label: string; items: NavEntry[] }> = {
  admin: {
    label: 'WordPress Admin',
    items: [
      entries.dashboard,
      entries.bookings,
      entries.calendar,
      entries.hotels,
      entries.inventory,
      entries.payments,
      entries.events,
      entries.staff,
      entries.reports,
      entries.settings,
    ],
  },
  staff: {
    label: 'Hotel Staff',
    items: [
      entries.dashboard,
      entries.bookings,
      entries.calendar,
      entries.events,
      entries.inventory,
      entries.reports,
    ],
  },
  finance: {
    label: 'Finance',
    items: [entries.payments, entries.invoices, entries.reports, entries.reconciliation],
  },
  agent: {
    label: 'Reservation Agent',
    items: [
      entries.dashboard,
      entries.bookings,
      entries.calendar,
      entries.events,
      entries.manualBooking,
      entries.reports,
    ],
  },
  readonly: {
    label: 'Read-only Staff',
    items: [entries.dashboard, entries.bookings, entries.calendar, entries.reports],
  },
};

export const demoUser = { name: 'Mira Kola', initials: 'MK' };

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <BedDouble className="size-5" />
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

/** One destination in the sidebar or drawer. States: default, hover, current, focus, disabled. */
export function SidebarItem({
  item,
  current = false,
  collapsed = false,
  disabled = false,
  className,
  ...props
}: {
  item: NavEntry;
  current?: boolean;
  collapsed?: boolean;
  disabled?: boolean;
} & Omit<ComponentProps<'button'>, 'children'>) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      disabled={disabled}
      title={collapsed ? item.label : undefined}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
        current && 'bg-secondary text-primary hover:bg-secondary hover:text-primary',
        collapsed && 'justify-center px-0',
        className,
      )}
      {...props}
    >
      <Icon className="size-4 shrink-0" />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {item.badge ? (
        <span
          className={cn(
            'rounded-full bg-primary px-1.5 text-[11px] leading-5 font-bold text-primary-foreground',
            collapsed &&
              'absolute top-0.5 right-1.5 min-w-4 px-1 text-center text-[10px] leading-4',
          )}
        >
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

function UserFooter({ role, collapsed }: { role: NavRole; collapsed?: boolean }) {
  return (
    <div className="space-y-1 border-t pt-3">
      <UserMenuTrigger role={role} compact={collapsed} className="w-full" />
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          collapsed && 'justify-center px-0',
        )}
        aria-label="Log out"
      >
        <LogOut className="size-4" />
        {collapsed ? null : 'Logout'}
      </button>
    </div>
  );
}

/** Desktop sidebar. Expanded by default, icon-only when collapsed. */
export function Sidebar({
  role = 'admin',
  current = 'dashboard',
  collapsed = false,
  onSelect,
  className,
}: {
  role?: NavRole;
  current?: string;
  collapsed?: boolean;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const { items } = navByRole[role];
  return (
    <aside
      className={cn(
        'flex h-full flex-col gap-4 border-r bg-card p-3',
        collapsed ? 'w-16' : 'w-60',
        className,
      )}
    >
      <div className={cn('px-1 pt-1', collapsed && 'flex justify-center')}>
        <Brand compact={collapsed} />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            current={item.id === current}
            collapsed={collapsed}
            onClick={() => onSelect?.(item.id)}
          />
        ))}
      </nav>
      <UserFooter role={role} collapsed={collapsed} />
    </aside>
  );
}

/** Same destinations as the sidebar, shown as a slide-over on tablet and phone. */
export function MobileDrawerPanel({
  role = 'admin',
  current = 'dashboard',
  onSelect,
  onClose,
  className,
}: {
  role?: NavRole;
  current?: string;
  onSelect?: (id: string) => void;
  onClose?: () => void;
  className?: string;
}) {
  const { items } = navByRole[role];
  return (
    <div className={cn('flex h-full w-72 flex-col gap-4 bg-card p-3 shadow-lg', className)}>
      <div className="flex items-center justify-between px-1 pt-1">
        <Brand />
        <Button variant="ghost" size="icon" aria-label="Close menu" onClick={onClose}>
          <X />
        </Button>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            current={item.id === current}
            onClick={() => onSelect?.(item.id)}
          />
        ))}
      </nav>
      <UserFooter role={role} />
    </div>
  );
}

export function NotificationTrigger({
  count = 0,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      className={cn('relative', className)}
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
    >
      <Bell />
      {count ? (
        <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-bold text-white">
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Button>
  );
}

export function UserMenuTrigger({
  role = 'admin',
  compact = false,
  className,
}: {
  role?: NavRole;
  compact?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${demoUser.name}`}
          className={cn(
            'flex h-9 items-center gap-2.5 rounded-md border bg-card px-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
            compact && 'justify-center border-transparent px-0',
            className,
          )}
        >
          <Avatar className="size-7">
            <AvatarFallback>{demoUser.initials}</AvatarFallback>
          </Avatar>
          {compact ? null : (
            <>
              <span className="min-w-0 flex-1 leading-none">
                <span className="block truncate text-sm leading-4 font-bold">{demoUser.name}</span>
                <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">
                  {navByRole[role].label}
                </span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{demoUser.name}</DropdownMenuLabel>
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Switch hotel</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Page title bar with context controls on the right. `onMenu` shows the phone/tablet menu button, last on the right. */
export function TopHeader({
  title,
  onMenu,
  actions,
  className,
}: {
  title: string;
  onMenu?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-center gap-3 border-b bg-card px-4 py-3 sm:px-6', className)}>
      <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        {onMenu ? (
          <Button variant="outline" size="icon" aria-label="Open menu" onClick={onMenu}>
            <Menu />
          </Button>
        ) : null}
      </div>
    </header>
  );
}

export type TabEntry = { id: string; label: string; icon?: LucideIcon; disabled?: boolean };

/** Underline tabs for switching views inside a page. Scrolls sideways when it does not fit. */
export function TabBar({
  tabs,
  current,
  onSelect,
  label = 'Sections',
}: {
  tabs: readonly TabEntry[];
  current: string;
  onSelect?: (id: string) => void;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map(({ id, label: text, icon: Icon, disabled }) => {
        const active = id === current;
        return (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onSelect?.(id)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
              active && 'border-primary text-primary hover:text-primary',
            )}
          >
            {Icon ? <Icon className="size-4" /> : null}
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** Compact segmented tabs for switching sub-views (a quieter alternative to TabBar). */
export function SectionTabs({
  tabs,
  current,
  onSelect,
  label = 'Views',
}: {
  tabs: readonly TabEntry[];
  current: string;
  onSelect?: (id: string) => void;
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1"
    >
      {tabs.map(({ id, label: text, icon: Icon, disabled }) => {
        const active = id === current;
        return (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onSelect?.(id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
              active && 'bg-card text-foreground shadow-sm',
            )}
          >
            {Icon ? <Icon className="size-4" /> : null}
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** Where you are in the app. The last item is the current page; on phones only it and its parent show. */
export function Breadcrumb({ items }: { items: readonly string[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-nowrap items-center gap-1.5 overflow-x-auto text-sm whitespace-nowrap text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const hiddenOnPhone = index < items.length - 2;
          return (
            <li
              key={item}
              className={cn(
                'shrink-0 items-center gap-1.5',
                hiddenOnPhone ? 'hidden sm:flex' : 'flex',
              )}
            >
              {index > 0 ? <ChevronRight className="size-3.5" /> : null}
              {last ? (
                <span aria-current="page" className="font-semibold text-foreground">
                  {item}
                </span>
              ) : (
                <a href="#breadcrumb" className="hover:text-foreground hover:underline">
                  {item}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Page numbers with previous/next and a range summary, e.g. "1–25 of 248". */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage?: (page: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = visiblePages(page, pageCount);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="First page"
          disabled={page === 1}
          onClick={() => onPage?.(1)}
          className="hidden sm:inline-flex"
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => onPage?.(page - 1)}
        >
          <ChevronLeft />
        </Button>
        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <span key={`gap-${index}`} className="px-1 text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={entry}
              variant={entry === page ? 'default' : 'outline'}
              size="icon"
              aria-label={`Page ${entry}`}
              aria-current={entry === page ? 'page' : undefined}
              onClick={() => onPage?.(entry)}
              className="hidden sm:inline-flex"
            >
              {entry}
            </Button>
          ),
        )}
        <span className="px-2 text-sm font-semibold sm:hidden">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={page === pageCount}
          onClick={() => onPage?.(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

/** Page numbers to show: first, last, the current page and its neighbours; a gap only hides 2+ pages. */
export function visiblePages(page: number, pageCount: number): Array<number | 'gap'> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const numbers = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const result: Array<number | 'gap'> = [];
  numbers.forEach((n, index) => {
    const previous = numbers[index - 1];
    if (previous !== undefined && n - previous === 2) result.push(previous + 1);
    else if (previous !== undefined && n - previous > 2) result.push('gap');
    result.push(n);
  });
  return result;
}
