'use client';

import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Home,
  LogOut,
  Menu,
  MoreHorizontal,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ClassName = { className?: string };

function classNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> &
    ClassName & {
      variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    }
>(function Button({ className, variant = 'primary', ...props }, ref) {
  return (
    <button
      className={classNames('must-button', `must-button--${variant}`, className)}
      ref={ref}
      {...props}
    />
  );
});

export function TextInput({
  className,
  label,
  error,
  hint,
  id: suppliedId,
  startAdornment,
  endAdornment,
  'aria-describedby': suppliedDescribedBy,
  'aria-invalid': suppliedInvalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> &
  ClassName & {
    label: string;
    error?: string;
    hint?: string;
    startAdornment?: ReactNode;
    endAdornment?: ReactNode;
  }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [suppliedDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <label className="must-field" htmlFor={id}>
      <span className="must-field__label">{label}</span>
      <span className="must-input-wrap">
        {startAdornment ? (
          <span aria-hidden="true" className="must-input__adornment must-input__adornment--start">
            {startAdornment}
          </span>
        ) : null}
        <input
          {...props}
          aria-describedby={describedBy}
          aria-invalid={error ? true : suppliedInvalid}
          className={classNames(
            'must-input',
            startAdornment ? 'must-input--with-start' : undefined,
            endAdornment ? 'must-input--with-end' : undefined,
            error && 'must-input--error',
            className,
          )}
          id={id}
        />
        {endAdornment ? (
          <span className="must-input__adornment must-input__adornment--end">{endAdornment}</span>
        ) : null}
      </span>
      {hint ? (
        <span className="must-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="must-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function Card({ className, children }: ClassName & { children: ReactNode }) {
  return <section className={classNames('must-card', className)}>{children}</section>;
}

export function Alert({
  className,
  children,
  id,
  tone = 'info',
  role,
}: ClassName & {
  children: ReactNode;
  id?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  role?: 'status' | 'alert';
}) {
  return (
    <div
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      className={classNames('must-alert', `must-alert--${tone}`, className)}
      id={id}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
    >
      {children}
    </div>
  );
}

export function Badge({
  className,
  children,
  tone = 'neutral',
}: ClassName & { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return (
    <span className={classNames('must-badge', `must-badge--${tone}`, className)}>{children}</span>
  );
}

export function Stack({
  className,
  children,
  gap = 'md',
}: ClassName & { children: ReactNode; gap?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={classNames('must-stack', `must-stack--${gap}`, className)}>{children}</div>
  );
}

export type NavigationItem = { href: string; label: string; current?: boolean; icon?: LucideIcon };

export function NavigationSectionTabBar({
  children,
  label = 'Dashboard tabs',
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="must-navigation-section-tabs">
      {children}
    </nav>
  );
}

export function NavigationSectionTabItem({
  href,
  label,
  current = false,
}: {
  href: string;
  label: string;
  current?: boolean;
}) {
  return (
    <a
      aria-current={current ? 'page' : undefined}
      className="must-navigation-section-tab"
      href={href}
    >
      {label}
    </a>
  );
}

export function NavigationPagination({
  page,
  pageSize,
  total,
  onPageChange,
  label = 'Pagination',
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <nav aria-label={label} className="must-navigation-pagination">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="must-navigation-pagination__actions">
        <button
          className="must-button must-button--secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Previous
        </button>
        <button
          className="must-button must-button--secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function NavigationLinks({
  items,
  onNavigate,
}: {
  items: readonly NavigationItem[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main navigation" className="must-navigation-links">
      {items.map((item) => (
        <a
          aria-current={item.current ? 'page' : undefined}
          aria-label={item.label}
          href={item.href}
          key={item.href}
          onClick={onNavigate}
        >
          {item.icon ? <item.icon aria-hidden="true" size={18} strokeWidth={2} /> : null}
          <span className="must-navigation-link__label">{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

async function logOut() {
  await fetch('/api/auth/logout', { credentials: 'include', method: 'POST' }).catch(
    () => undefined,
  );
  window.location.href = '/';
}

function LogOutButton() {
  return (
    <button onClick={() => void logOut()} type="button">
      <LogOut aria-hidden="true" size={16} />
      <span className="must-rail-label">Log out</span>
    </button>
  );
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

/** Header account trigger: avatar + name/role, opening a small session-actions dropdown. */
function AccountMenu({ email, role }: { email?: string; role?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="must-account-menu">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="must-account-menu__trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden="true" className="must-avatar">
          {initialsFromEmail(email)}
        </span>
        <span className="must-account-menu__identity">
          <span className="must-account-menu__name">{email ?? 'Signed-in user'}</span>
          {role ? <span className="must-account-menu__role">{role}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" className="must-account-menu__chevron" size={16} />
      </button>
      {open ? (
        <div className="must-account-menu__dropdown" role="menu">
          <button
            className="must-account-menu__item must-account-menu__item--danger"
            onClick={() => void logOut()}
            role="menuitem"
            type="button"
          >
            <LogOut aria-hidden="true" size={16} />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarNavigation({
  items,
  className,
  userEmail,
  homeHref = '/platform',
}: {
  items: readonly NavigationItem[];
  userEmail?: string;
  homeHref?: string;
} & ClassName) {
  return (
    <aside className={classNames('must-sidebar-navigation', className)}>
      <a className="must-shell-brand" href={homeHref} aria-label="MUST Hotel home">
        <img alt="" src="/auth/portal-m-mark.svg" />
        <span className="must-rail-label">MUST Hotel</span>
      </a>
      <NavigationLinks items={items} />
      <div className="must-shell-profile">
        <span className="must-shell-profile__email">{userEmail ?? 'Signed-in user'}</span>
        <LogOutButton />
      </div>
    </aside>
  );
}

export function Heading({
  className,
  children,
  id,
  level = 1,
}: ClassName & { children: ReactNode; id?: string; level?: 1 | 2 | 3 }) {
  const Tag = `h${level}` as const satisfies keyof HTMLElementTagNameMap;
  return (
    <Tag className={classNames('must-heading', `must-heading--${level}`, className)} id={id}>
      {children}
    </Tag>
  );
}

export function Text({
  className,
  children,
  tone = 'primary',
}: ClassName & { children: ReactNode; tone?: 'primary' | 'secondary' }) {
  return <p className={classNames('must-text', `must-text--${tone}`, className)}>{children}</p>;
}

/** Mobile navigation. It replaces the desktop sidebar below the 768px mobile breakpoint. */
export function MobileDrawerNavigation({
  items,
  title = 'Navigation',
  homeHref,
  onOpenChange,
  open: controlledOpen,
  renderBottomNavigation = true,
}: {
  items: readonly NavigationItem[];
  title?: string;
  homeHref?: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  renderBottomNavigation?: boolean;
}) {
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const drawerId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }
    wasOpenRef.current = true;
    firstLinkRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const bottomNavigation = (
    <MobileBottomNavigation
      items={items}
      onMore={() => setOpen(true)}
      open={open}
      homeHref={homeHref}
    />
  );

  return (
    <>
      <div className="must-mobile-navigation">
        <Button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Open navigation"
          className="must-mobile-navigation__trigger"
          aria-controls={drawerId}
          onClick={() => setOpen(true)}
          ref={triggerRef}
          type="button"
          variant="ghost"
        >
          <Menu aria-hidden="true" size={20} />
          <span className="must-mobile-navigation__trigger-label">Menu</span>
        </Button>
        {open ? (
          <div className="must-drawer-backdrop" onMouseDown={() => setOpen(false)}>
            <div
              aria-labelledby={titleId}
              aria-modal="true"
              className="must-drawer"
              id={drawerId}
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="must-drawer__header">
                <h2 id={titleId}>{title}</h2>
                <Button
                  aria-label="Close navigation"
                  onClick={() => setOpen(false)}
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" size={18} />
                  Close
                </Button>
              </div>
              <nav aria-label="Main navigation" className="must-navigation-links">
                {items.map((item, index) => (
                  <a
                    aria-current={item.current ? 'page' : undefined}
                    aria-label={item.label}
                    href={item.href}
                    key={item.href}
                    onClick={() => setOpen(false)}
                    ref={index === 0 ? firstLinkRef : undefined}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        ) : null}
      </div>
      {renderBottomNavigation ? bottomNavigation : null}
    </>
  );
}

function MobileBottomNavigation({
  items,
  onMore,
  open,
  homeHref,
}: {
  items: readonly NavigationItem[];
  onMore: () => void;
  open: boolean;
  homeHref?: string;
}) {
  const homeItem = items.find((item) => item.label === 'Dashboard') ?? items[0];
  const bookingsItem = items.find(
    (item) => item.label === 'Bookings' || item.href.includes('section=reservations'),
  );
  const calendarItem = items.find((item) => item.label === 'Calendar');

  return (
    <nav aria-label="Mobile navigation" className="must-mobile-bottom-navigation">
      <MobileBottomNavigationItem
        current={homeItem?.current}
        href={homeHref ?? homeItem?.href ?? '/'}
        icon={Home}
        label="Home"
      />
      <MobileBottomNavigationItem item={bookingsItem} icon={ClipboardList} label="Bookings" />
      <MobileBottomNavigationItem item={calendarItem} icon={CalendarDays} label="Calendar" />
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="More navigation"
        className="must-mobile-bottom-navigation__item"
        onClick={onMore}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}

function MobileBottomNavigationItem({
  current,
  href,
  icon: Icon,
  item,
  label,
}: {
  current?: boolean;
  href?: string;
  icon: LucideIcon;
  item?: NavigationItem;
  label: string;
}) {
  if (!item && !href) {
    return (
      <span aria-disabled="true" className="must-mobile-bottom-navigation__item">
        <Icon aria-hidden="true" size={20} />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <a
      aria-current={(item?.current ?? current) ? 'page' : undefined}
      aria-label={label}
      className="must-mobile-bottom-navigation__item"
      href={href ?? item?.href ?? '/'}
    >
      <Icon aria-hidden="true" size={20} />
      <span>{label}</span>
    </a>
  );
}

/**
 * Top-level dashboard layout: desktop sidebar (hidden below 1024px) plus mobile drawer nav (shown
 * below 1024px), wrapping a scrollable content area. One composition point for every dashboard
 * screen rather than each page re-deriving the responsive nav split.
 */
export function AppShell({
  navigation,
  title,
  userEmail,
  userRole,
  homeHref,
  headerActions,
  children,
}: {
  navigation: readonly NavigationItem[];
  title: string;
  userEmail?: string;
  userRole?: string;
  homeHref?: string;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  return (
    <div className="must-app-shell">
      <a className="must-skip-link" href="#must-main-content">
        Skip to main content
      </a>
      <SidebarNavigation
        className="must-app-shell__sidebar"
        homeHref={homeHref}
        items={navigation}
        userEmail={userEmail}
      />
      <div className="must-app-shell__main">
        <header className="must-app-shell__header">
          <MobileDrawerNavigation
            homeHref={homeHref}
            items={navigation}
            onOpenChange={setMobileDrawerOpen}
            open={mobileDrawerOpen}
            renderBottomNavigation={false}
            title={title}
          />
          <div className="must-desktop-header">
            <Heading level={2}>{title}</Heading>
          </div>
          <div className="must-app-shell__header-actions">
            {headerActions}
            <AccountMenu email={userEmail} role={userRole} />
          </div>
        </header>
        <main className="must-app-shell__content" id="must-main-content" tabIndex={-1}>
          {children}
        </main>
        <MobileBottomNavigation
          homeHref={homeHref}
          items={navigation}
          onMore={() => setMobileDrawerOpen(true)}
          open={mobileDrawerOpen}
        />
      </div>
    </div>
  );
}
